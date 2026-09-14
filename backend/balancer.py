"""팀 편성 알고리즘 (TEAM_BALANCE_SPEC.md §4).

구현 순서
  1. 고정 배정(잠금) 인원 배치
  2. **정회원 우선 배정** — 게스트를 빼고 정회원만으로 팀을 먼저 채운다.
     (팀별 정회원 수는 최대한 같게 맞춘다.)
  3. 남은 자리를 게스트로 채운다.
  4. 무작위 2인 스왑 Hill Climbing 으로 §4.1 목적함수를 개선한다.
     정회원 우선 배정을 유지하기 위해 스왑은 같은 신분끼리만(정회원↔정회원,
     게스트↔게스트) 허용한다.

배정은 단순 라운드로빈이 아니라 **무작위성을 가진 그리디(GRASP)** 다.
  - 인원 순서: 실질 전력 내림차순에 약간의 흔들림(jitter)을 준다.
  - 팀 선택: '평균에서 가장 덜 벗어나는' 팀만 고르지 않고, 상위 후보군(RCL)
    안에서 무작위로 고른다. `randomness=0` 이면 완전한 그리디가 된다.
  - 초기해를 `restarts` 번 만들어 각각 최적화한 뒤 가장 좋은 것을 채택한다.

수렴 기준은 전체 평균이다. 각 팀의 **역량·나이·신장** 합계가
`전체 1인 평균 × 팀 인원` 에 가까워지도록 배정한다.
밸런싱에 쓰는 전력은 `effective_level`(= 역량평균 + 55세 이상 보너스)이다.
"""

import math
import random
import statistics
from dataclasses import dataclass
from typing import Callable, Dict, List, Optional, Sequence, Set, Tuple

import ranking
from models import BalanceOptions, Member
from skills import GUARD, ROLE_CLUSTERS

CREATION_TOP_RATIO = 0.30   # TEAM_BALANCE_SPEC.md §4.4 — 창출형 상위 N%
QUOTA_PENALTY = 2.0
CREATION_PENALTY = 3.0
SEPARATION_PENALTY = 10.0         # 1순위: 역량 상위권 분산 (사실상 하드 제약)
HEIGHT_SEPARATION_PENALTY = 5.0   # 2순위: 신장 상위권 분산 (충돌 시 이쪽을 먼저 양보)

AGE_SCALE = 10.0      # 나이 10살 = 1.0 단위로 정규화
HEIGHT_SCALE = 10.0   # 신장 10cm = 1.0 단위로 정규화
ORDER_JITTER = 0.25   # 배정 순서 흔들림의 기준 표준편차 (randomness 에 비례)

Assignment = List[List[Member]]


@dataclass
class Context:
    """목적함수·그리디 배정에 필요한 값 묶음."""

    options: BalanceOptions
    sizes: Sequence[int]
    targets: Sequence[float]
    creation_threshold: float
    creators_available: int
    top_n: int
    height_top_n: int
    height_positions: Sequence[str]
    avg_level: float = 0.0            # 1인당 전체 평균 — 팀 평균이 여기로 수렴해야 한다
    avg_age: Optional[float] = None
    avg_height: Optional[float] = None


# ---------------------------------------------------------------- 보조 계산

def team_sizes(total: int, k: int) -> List[int]:
    """전체 인원을 K등분하고 나머지는 라운드로빈 배분 (WEBAPP_SPEC.md §3.2)."""
    base, rem = divmod(total, k)
    return [base + (1 if i < rem else 0) for i in range(k)]


def guard_targets(members: Sequence[Member], sizes: Sequence[int]) -> List[float]:
    """팀별 기대 가드 인원수 (전체 가드 비율 기준)."""
    total = len(members)
    guards = sum(1 for m in members if m.position == GUARD)
    if total == 0:
        return [0.0 for _ in sizes]
    return [guards * s / total for s in sizes]


def quota_violations(teams: Assignment, targets: Sequence[float]) -> int:
    """TEAM_BALANCE_SPEC.md §4.3 — 기대 가드 수 대비 ±1명 초과 팀 수."""
    count = 0
    for team, target in zip(teams, targets):
        guards = sum(1 for m in team if m.position == GUARD)
        if abs(guards - target) > 1.0 + 1e-9:
            count += 1
    return count


def creation_threshold(members: Sequence[Member]) -> float:
    """창출 역할군 상위 CREATION_TOP_RATIO 진입 점수."""
    scores = sorted((m.roles.get("creation", 0.0) for m in members), reverse=True)
    if not scores:
        return 0.0
    n = max(1, int(round(len(scores) * CREATION_TOP_RATIO)))
    return scores[n - 1]


def creation_shortage(teams: Assignment, threshold: float, available: int) -> int:
    """창출형 인원이 0명인 팀 수 (창출형 총원이 팀 수보다 적으면 계산 제외)."""
    if available < len(teams):
        return 0
    return sum(
        1
        for team in teams
        if not any(m.roles.get("creation", 0.0) >= threshold for m in team)
    )


def _pvariance(values: Sequence[float]) -> float:
    return statistics.pvariance(values) if len(values) > 1 else 0.0


def _mean(values: Sequence[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def _mean_or_none(values: Sequence[float]) -> Optional[float]:
    return _mean(values) if values else None


def _team_means(
    teams: Assignment, pick: Callable[[Member], Optional[float]]
) -> List[float]:
    """값이 있는 인원만 골라 팀별 평균을 낸다. 한 팀이라도 비면 빈 목록."""
    means: List[float] = []
    for team in teams:
        vals = [v for v in (pick(m) for m in team) if v]
        if not vals:
            return []
        means.append(_mean(vals))
    return means


def objective(teams: Assignment, ctx: Context) -> float:
    """TEAM_BALANCE_SPEC.md §4.1 목적함수 (낮을수록 좋음)."""
    options = ctx.options

    # 전력은 나이 보너스를 반영한 effective_level 로 맞춘다
    levels = [_mean([m.effective_level for m in t]) for t in teams if t]
    cost = _pvariance(levels)

    ratios = [sum(1 for m in t if m.position == GUARD) / len(t) for t in teams if t]
    cost += options.lambda_position * _pvariance(ratios)

    for cluster in ROLE_CLUSTERS:
        avgs = [_mean([m.roles.get(cluster, 0.0) for m in t]) for t in teams if t]
        cost += options.lambda_role * _pvariance(avgs) / len(ROLE_CLUSTERS)

    if options.use_height:
        # 10cm 단위로 스케일 정규화
        heights = _team_means(teams, lambda m: m.height_cm)
        if heights:
            cost += options.lambda_height * _pvariance(
                [h / HEIGHT_SCALE for h in heights]
            )

    if options.use_age:
        # 10살 단위로 스케일 정규화
        ages = _team_means(teams, lambda m: m.age)
        if ages:
            cost += options.lambda_age * _pvariance([a / AGE_SCALE for a in ages])

    cost += QUOTA_PENALTY * quota_violations(teams, ctx.targets)
    cost += CREATION_PENALTY * creation_shortage(
        teams, ctx.creation_threshold, ctx.creators_available
    )
    cost += SEPARATION_PENALTY * ranking.separation_violations(teams, ctx.top_n)
    cost += HEIGHT_SEPARATION_PENALTY * ranking.height_separation_violations(
        teams, ctx.height_top_n, ctx.height_positions
    )
    return cost


# ---------------------------------------------------------------- 팀 누적 상태

@dataclass
class _State:
    """배정 도중의 팀 누적값 (평균 수렴 계산용)."""

    size: int = 0
    guards: int = 0
    level: float = 0.0
    age_sum: float = 0.0
    age_n: int = 0
    height_sum: float = 0.0
    height_n: int = 0

    def add(self, m: Member) -> None:
        self.size += 1
        self.level += m.effective_level
        if m.position == GUARD:
            self.guards += 1
        if m.age:
            self.age_sum += m.age
            self.age_n += 1
        if m.height_cm:
            self.height_sum += m.height_cm
            self.height_n += 1


def _fit_cost(state: _State, m: Member, ctx: Context) -> float:
    """m 을 이 팀에 넣었을 때 '팀 합계 − 전체평균×인원' 의 제곱 편차.

    역량·나이·신장 세 축을 함께 본다. 값이 작을수록 그 팀의 평균이
    전체 평균에 가깝게 유지된다.
    """
    options = ctx.options
    gap = (state.level + m.effective_level) - ctx.avg_level * (state.size + 1)
    cost = gap * gap

    if options.use_age and ctx.avg_age is not None and m.age:
        gap_age = (state.age_sum + m.age) - ctx.avg_age * (state.age_n + 1)
        cost += options.lambda_age * (gap_age / AGE_SCALE) ** 2

    if options.use_height and ctx.avg_height is not None and m.height_cm:
        gap_h = (state.height_sum + m.height_cm) - ctx.avg_height * (state.height_n + 1)
        cost += options.lambda_height * (gap_h / HEIGHT_SCALE) ** 2

    return cost


def _quota_ok(state: _State, m: Member, size: int, target: float) -> bool:
    """가드/포워드가 기대치 ±1명 안에 들어오는지 (TEAM_BALANCE_SPEC.md §4.3)."""
    if m.position == GUARD:
        return state.guards + 1 <= target + 1.0 + 1e-9
    forwards = state.size - state.guards
    return forwards + 1 <= (size - target) + 1.0 + 1e-9


def _pick(
    pool: Sequence[int],
    costs: Dict[int, float],
    rng: random.Random,
    randomness: float,
) -> int:
    """상위 후보군(RCL)에서 무작위로 고른다 — GRASP 방식.

    randomness=0 이면 최소 비용 팀만(완전 그리디), 1 이면 후보 전체에서 균등 추출.
    """
    lo = min(costs[i] for i in pool)
    hi = max(costs[i] for i in pool)
    limit = lo + max(0.0, randomness) * (hi - lo)
    rcl = [i for i in pool if costs[i] <= limit + 1e-9]
    return rng.choice(rcl or list(pool))


# ---------------------------------------------------------------- 배정 알고리즘

def _phase_capacity(
    states: Sequence[_State], sizes: Sequence[int], remaining: int, rng: random.Random
) -> List[int]:
    """이번 단계에서 각 팀이 채울 수 있는 최대 인원 (최대한 균등하게).

    정회원 단계에서는 정회원이 한 팀에 몰리지 않도록 상한을 만들어 준다.
    """
    caps = [s.size for s in states]
    for _ in range(remaining):
        pool = [i for i in range(len(sizes)) if caps[i] < sizes[i]]
        if not pool:
            break
        rng.shuffle(pool)  # 동수일 때 어느 팀이 한 명 더 받을지는 무작위
        caps[min(pool, key=lambda i: caps[i])] += 1
    return caps


def _place_top_ranked(
    teams: Assignment,
    states: List[_State],
    caps: Sequence[int],
    top_groups: Sequence[Tuple[str, List[str]]],
    by_id: Dict[str, Member],
    placed: Set[str],
    ctx: Context,
    rng: random.Random,
    accept: Callable[[Member], bool],
) -> None:
    """분산 대상 그룹을 우선순위 순서대로 서로 다른 팀에 하나씩 배치한다.

    앞선 그룹에서 이미 자리를 잡은 인원(또는 고정 배정된 인원)이 있으면
    그 팀은 해당 그룹에서 제외한다. 자리가 없으면 제약을 완화한다.
    이번 단계(정회원/게스트) 대상이 아닌 인원은 건너뛴다.
    """
    for _label, ids in top_groups:
        wanted = set(ids)
        used = {idx for idx, team in enumerate(teams) for m in team if m.id in wanted}
        for member_id in ids:
            member = by_id.get(member_id)
            if member_id in placed or member is None or not accept(member):
                continue
            open_teams = [i for i in range(len(teams)) if states[i].size < caps[i]]
            candidates = [i for i in open_teams if i not in used]
            if not candidates:  # 팀 수보다 상위권이 많은 경우 등 — 제약 완화
                candidates = open_teams
            if not candidates:
                continue
            costs = {i: _fit_cost(states[i], member, ctx) for i in candidates}
            chosen = _pick(candidates, costs, rng, ctx.options.randomness)
            teams[chosen].append(member)
            states[chosen].add(member)
            placed.add(member_id)
            used.add(chosen)


def _fill(
    members: Sequence[Member],
    teams: Assignment,
    states: List[_State],
    caps: Sequence[int],
    ctx: Context,
    rng: random.Random,
) -> None:
    """남은 인원을 '평균에서 덜 벗어나는 팀' 위주로, 약간의 무작위성과 함께 배정."""
    randomness = ctx.options.randomness
    jitter = ORDER_JITTER * randomness
    ordered = sorted(
        members,
        key=lambda m: (
            -(m.effective_level + (rng.gauss(0, jitter) if jitter else 0.0)),
            m.name,
        ),
    )
    for m in ordered:
        open_teams = [i for i in range(len(teams)) if states[i].size < caps[i]]
        if not open_teams:
            break
        # 쿼터를 지키는 팀 우선, 없으면 완화(fallback) — TEAM_BALANCE_SPEC.md §4.3
        fitting = [
            i
            for i in open_teams
            if _quota_ok(states[i], m, ctx.sizes[i], ctx.targets[i])
        ]
        pool = fitting or open_teams
        costs = {i: _fit_cost(states[i], m, ctx) for i in pool}
        chosen = _pick(pool, costs, rng, randomness)
        teams[chosen].append(m)
        states[chosen].add(m)


def greedy_assign(
    members: Sequence[Member],
    ctx: Context,
    rng: random.Random,
    preassigned: Optional[Dict[str, int]] = None,
    top_groups: Optional[Sequence[Tuple[str, List[str]]]] = None,
) -> Assignment:
    """고정 배정 → **정회원 전원 배정** → 게스트로 잔여 자리 채우기."""
    sizes = ctx.sizes
    k = len(sizes)
    teams: Assignment = [[] for _ in range(k)]
    states = [_State() for _ in range(k)]
    preassigned = preassigned or {}
    by_id = {m.id: m for m in members}
    placed: Set[str] = set()

    # 1) 고정 배정
    for m in members:
        idx = preassigned.get(m.id)
        if idx is not None and 0 <= idx < k and len(teams[idx]) < sizes[idx]:
            teams[idx].append(m)
            states[idx].add(m)
            placed.add(m.id)

    # 2) 정회원 먼저 → 3) 게스트 순서로 단계 배정
    if ctx.options.members_first:
        phases: List[Callable[[Member], bool]] = [
            lambda m: not m.is_guest,
            lambda m: m.is_guest,
        ]
    else:
        phases = [lambda m: True]

    for accept in phases:
        waiting = [m for m in members if m.id not in placed and accept(m)]
        if not waiting:
            continue
        caps = _phase_capacity(states, sizes, len(waiting), rng)
        if top_groups:  # 상위권 분산은 각 단계 안에서 먼저 처리
            _place_top_ranked(
                teams, states, caps, top_groups, by_id, placed, ctx, rng, accept
            )
        _fill(
            [m for m in waiting if m.id not in placed], teams, states, caps, ctx, rng
        )
        placed.update(m.id for m in waiting)

    return teams


def hill_climb(
    teams: Assignment,
    ctx: Context,
    rng: random.Random,
    locked_ids: Optional[Set[str]] = None,
    iterations: Optional[int] = None,
) -> Tuple[Assignment, float]:
    """무작위 2인 스왑을 반복하며 목적함수가 개선될 때만 채택한다.

    분산 제약은 목적함수의 큰 페널티로 들어가 있으므로 제약을 깨는 스왑은 자연히
    기각된다. 역량(10.0) > 신장(5.0) 순으로 페널티를 두어, 두 제약이 동시에
    만족될 수 없을 때는 신장 쪽을 먼저 양보한다.

    `members_first` 가 켜져 있으면 정회원↔정회원, 게스트↔게스트 스왑만 허용해
    팀별 정회원 수 균등 배분을 그대로 유지한다.
    """
    locked_ids = locked_ids or set()
    current = [list(t) for t in teams]
    best_cost = objective(current, ctx)
    k = len(current)
    if k < 2:
        return current, best_cost

    budget = ctx.options.iterations if iterations is None else iterations
    same_status = ctx.options.members_first
    for _ in range(max(0, budget)):
        a, b = rng.sample(range(k), 2)
        movable_a = [i for i, m in enumerate(current[a]) if m.id not in locked_ids]
        movable_b = [i for i, m in enumerate(current[b]) if m.id not in locked_ids]
        if not movable_a or not movable_b:
            continue
        i = rng.choice(movable_a)
        j = rng.choice(movable_b)
        if same_status and current[a][i].is_guest != current[b][j].is_guest:
            continue  # 정회원/게스트 배분 비율이 깨지지 않게 한다
        current[a][i], current[b][j] = current[b][j], current[a][i]
        cost = objective(current, ctx)
        if cost < best_cost - 1e-12:
            best_cost = cost
        else:
            current[a][i], current[b][j] = current[b][j], current[a][i]  # 롤백
    return current, best_cost


def snake_draft(members: Sequence[Member], k: int) -> Assignment:
    """베이스라인 비교용 스네이크 드래프트 (TEAM_BALANCE_SPEC.md §4.2)."""
    teams: Assignment = [[] for _ in range(k)]
    ordered = sorted(members, key=lambda m: (-m.effective_level, m.name))
    for round_idx, chunk_start in enumerate(range(0, len(ordered), k)):
        chunk = ordered[chunk_start : chunk_start + k]
        order = range(k) if round_idx % 2 == 0 else reversed(range(k))
        for team_idx, m in zip(order, chunk):
            teams[team_idx].append(m)
    return teams


def balance(
    members: Sequence[Member], options: BalanceOptions
) -> Tuple[Assignment, int, float]:
    """무작위 초기해 여러 개 → 각각 Hill Climbing → 가장 좋은 해 채택.

    (팀 배정, 사용된 seed, 목적함수 값) 반환. 같은 seed 면 결과도 같다.
    """
    seed = options.seed if options.seed is not None else random.randrange(1_000_000_000)
    rng = random.Random(seed)

    k = max(1, options.team_count)
    pool = ranking.annotate(members, options.age_bonus_from, options.age_bonus)
    top_n = max(0, min(options.separate_top_n, k))
    height_top_n = max(0, min(options.separate_height_top_n, k))
    height_positions = tuple(options.height_positions)
    top_groups = ranking.ordered_groups(pool, top_n, height_top_n, height_positions)

    sizes = team_sizes(len(pool), k)
    threshold = creation_threshold(pool)
    ctx = Context(
        options=options,
        sizes=sizes,
        targets=guard_targets(pool, sizes),
        creation_threshold=threshold,
        creators_available=sum(
            1 for m in pool if m.roles.get("creation", 0.0) >= threshold
        ),
        top_n=top_n,
        height_top_n=height_top_n,
        height_positions=height_positions,
        avg_level=_mean([m.effective_level for m in pool]),
        avg_age=_mean_or_none([m.age for m in pool if m.age]),
        avg_height=_mean_or_none([m.height_cm for m in pool if m.height_cm]),
    )

    locked = {mid: idx for mid, idx in options.locked.items() if 0 <= idx < k}
    locked_ids = set(locked)

    # 반복 예산은 재시작 횟수만큼 나눠 쓴다 (전체 계산량은 그대로).
    restarts = max(1, options.restarts)
    per_run = max(0, options.iterations) // restarts

    best_teams: Optional[Assignment] = None
    best_cost = math.inf
    for _ in range(restarts):
        teams = greedy_assign(pool, ctx, rng, preassigned=locked, top_groups=top_groups)
        teams, cost = hill_climb(teams, ctx, rng, locked_ids, iterations=per_run)
        if cost < best_cost:
            best_teams, best_cost = teams, cost
    return best_teams if best_teams is not None else [[] for _ in range(k)], seed, best_cost
