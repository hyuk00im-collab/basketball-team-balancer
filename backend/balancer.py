"""팀 편성 알고리즘 (TEAM_BALANCE_SPEC.md §4).

구현 순서: 포지션별 상위권 분산 배치 → 그리디 최소편차 배정으로 초기해 생성
→ 무작위 2인 스왑 Hill Climbing으로 §4.1 목적함수를 개선한다.

밸런싱에 쓰는 전력은 `effective_level`(= 역량평균 + 55세 이상 보너스)이다.
"""

import random
import statistics
from dataclasses import dataclass
from typing import Dict, List, Optional, Sequence, Set, Tuple

import ranking
from models import BalanceOptions, Member
from skills import GUARD, ROLE_CLUSTERS

CREATION_TOP_RATIO = 0.30   # TEAM_BALANCE_SPEC.md §4.4 — 창출형 상위 N%
QUOTA_PENALTY = 2.0
CREATION_PENALTY = 3.0
SEPARATION_PENALTY = 10.0         # 1순위: 역량 상위권 분산 (사실상 하드 제약)
HEIGHT_SEPARATION_PENALTY = 5.0   # 2순위: 신장 상위권 분산 (충돌 시 이쪽을 먼저 양보)

Assignment = List[List[Member]]


@dataclass
class Context:
    """목적함수 계산에 필요한 값 묶음."""

    options: BalanceOptions
    targets: Sequence[float]
    creation_threshold: float
    creators_available: int
    top_n: int
    height_top_n: int
    height_positions: Sequence[str]


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
        heights = []
        for t in teams:
            vals = [m.height_cm for m in t if m.height_cm]
            if vals:
                heights.append(_mean(vals) / 10.0)  # 10cm 단위로 스케일 정규화
        if len(heights) == len(teams):
            cost += options.lambda_height * _pvariance(heights)

    cost += QUOTA_PENALTY * quota_violations(teams, ctx.targets)
    cost += CREATION_PENALTY * creation_shortage(
        teams, ctx.creation_threshold, ctx.creators_available
    )
    cost += SEPARATION_PENALTY * ranking.separation_violations(teams, ctx.top_n)
    cost += HEIGHT_SEPARATION_PENALTY * ranking.height_separation_violations(
        teams, ctx.height_top_n, ctx.height_positions
    )
    return cost


# ---------------------------------------------------------------- 배정 알고리즘

def _place_top_ranked(
    teams: Assignment,
    totals: List[float],
    sizes: Sequence[int],
    top_groups: Sequence[Tuple[str, List[str]]],
    by_id: Dict[str, Member],
    placed: Set[str],
    rng: random.Random,
) -> None:
    """분산 대상 그룹을 우선순위 순서대로 서로 다른 팀에 하나씩 배치한다.

    앞선 그룹에서 이미 자리를 잡은 인원(또는 고정 배정된 인원)이 있으면
    그 팀은 해당 그룹에서 제외한다. 자리가 없으면 제약을 완화한다.
    """
    for _label, ids in top_groups:
        used = {
            idx
            for idx, team in enumerate(teams)
            for m in team
            if m.id in set(ids)
        }
        for member_id in ids:
            if member_id in placed:
                continue
            member = by_id.get(member_id)
            if member is None:
                continue
            candidates = [
                i for i in range(len(teams)) if i not in used and len(teams[i]) < sizes[i]
            ]
            if not candidates:  # 팀 수보다 상위권이 많은 경우 등 — 제약 완화
                candidates = [i for i in range(len(teams)) if len(teams[i]) < sizes[i]]
            best = min(totals[i] for i in candidates)
            chosen = rng.choice([i for i in candidates if totals[i] <= best + 1e-9])
            teams[chosen].append(member)
            totals[chosen] += member.effective_level
            placed.add(member_id)
            used.add(chosen)


def greedy_assign(
    members: Sequence[Member],
    sizes: Sequence[int],
    targets: Sequence[float],
    rng: random.Random,
    preassigned: Optional[Dict[str, int]] = None,
    top_groups: Optional[Sequence[Tuple[str, List[str]]]] = None,
) -> Assignment:
    """고정 배정 → 상위권 분산(역량 → 신장 순) → 나머지는 '총점이 낮은 팀'에 배정."""
    k = len(sizes)
    teams: Assignment = [[] for _ in range(k)]
    totals = [0.0] * k
    preassigned = preassigned or {}
    by_id = {m.id: m for m in members}
    placed: Set[str] = set()

    # 1) 고정 배정
    for m in members:
        idx = preassigned.get(m.id)
        if idx is not None and 0 <= idx < k and len(teams[idx]) < sizes[idx]:
            teams[idx].append(m)
            totals[idx] += m.effective_level
            placed.add(m.id)

    # 2) 포지션별 상위권 분산
    if top_groups:
        _place_top_ranked(teams, totals, sizes, top_groups, by_id, placed, rng)

    # 3) 나머지 그리디 배정
    ordered = sorted(
        (m for m in members if m.id not in placed),
        key=lambda m: (-m.effective_level, m.name),
    )
    for m in ordered:
        open_teams = [i for i in range(k) if len(teams[i]) < sizes[i]]
        # 쿼터를 지키는 팀 우선, 없으면 완화(fallback) — TEAM_BALANCE_SPEC.md §4.3
        fitting = []
        for i in open_teams:
            guards = sum(1 for x in teams[i] if x.position == GUARD)
            if m.position == GUARD:
                ok = guards + 1 <= targets[i] + 1.0 + 1e-9
            else:
                forwards = len(teams[i]) - guards
                ok = forwards + 1 <= (sizes[i] - targets[i]) + 1.0 + 1e-9
            if ok:
                fitting.append(i)
        pool = fitting or open_teams
        best = min(totals[i] for i in pool)
        candidates = [i for i in pool if totals[i] <= best + 1e-9]
        chosen = rng.choice(candidates)
        teams[chosen].append(m)
        totals[chosen] += m.effective_level
    return teams


def hill_climb(
    teams: Assignment,
    ctx: Context,
    rng: random.Random,
    locked_ids: Optional[Set[str]] = None,
) -> Tuple[Assignment, float]:
    """무작위 2인 스왑을 반복하며 목적함수가 개선될 때만 채택한다.

    분산 제약은 목적함수의 큰 페널티로 들어가 있으므로 제약을 깨는 스왑은 자연히
    기각된다. 역량(10.0) > 신장(5.0) 순으로 페널티를 두어, 두 제약이 동시에
    만족될 수 없을 때는 신장 쪽을 먼저 양보한다.
    """
    locked_ids = locked_ids or set()
    current = [list(t) for t in teams]
    best_cost = objective(current, ctx)
    k = len(current)
    if k < 2:
        return current, best_cost

    for _ in range(max(0, ctx.options.iterations)):
        a, b = rng.sample(range(k), 2)
        movable_a = [i for i, m in enumerate(current[a]) if m.id not in locked_ids]
        movable_b = [i for i, m in enumerate(current[b]) if m.id not in locked_ids]
        if not movable_a or not movable_b:
            continue
        i = rng.choice(movable_a)
        j = rng.choice(movable_b)
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
    """그리디 초기해 → Hill Climbing 최적화. (팀 배정, 사용된 seed, 목적함수 값) 반환."""
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
        targets=guard_targets(pool, sizes),
        creation_threshold=threshold,
        creators_available=sum(
            1 for m in pool if m.roles.get("creation", 0.0) >= threshold
        ),
        top_n=top_n,
        height_top_n=height_top_n,
        height_positions=height_positions,
    )

    locked = {mid: idx for mid, idx in options.locked.items() if 0 <= idx < k}
    teams = greedy_assign(
        pool, sizes, ctx.targets, rng, preassigned=locked, top_groups=top_groups
    )
    teams, cost = hill_climb(teams, ctx, rng, set(locked))
    return teams, seed, cost
