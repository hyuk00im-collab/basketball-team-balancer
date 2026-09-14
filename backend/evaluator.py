"""편성 결과 평가 지표 (TEAM_BALANCE_SPEC.md §5)."""

import statistics
from typing import List, Optional, Sequence

import ranking
from balancer import creation_shortage, creation_threshold, guard_targets, quota_violations
from models import Member, Metrics, Team, TeamSummary
from skills import CENTER, FORWARD, GUARD, ROLE_CLUSTERS

_POSITION_ORDER = {GUARD: 0, FORWARD: 1, CENTER: 2}


def _mean(values: Sequence[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def summarize(team: Sequence[Member], top_n: int = ranking.SEPARATE_TOP_N) -> TeamSummary:
    heights = [m.height_cm for m in team if m.height_cm]
    ages = [m.age for m in team if m.age]
    roles = {
        c: round(_mean([m.roles.get(c, 0.0) for m in team]), 2) for c in ROLE_CLUSTERS
    }
    labels = [ranking.describe_rank(m, top_n) for m in team]
    height_labels = [ranking.describe_height_rank(m) for m in team]
    return TeamSummary(
        avg_level=round(_mean([m.level for m in team]), 2),
        sum_level=round(sum(m.level for m in team), 2),
        avg_effective_level=round(_mean([m.effective_level for m in team]), 2),
        sum_effective_level=round(sum(m.effective_level for m in team), 2),
        bonus_players=sum(1 for m in team if m.age_bonus),
        top_ranked=[x for x in labels if x],
        top_height=[x for x in height_labels if x],
        guards=sum(1 for m in team if m.position == GUARD),
        forwards=sum(1 for m in team if m.position == FORWARD),
        centers=sum(1 for m in team if m.position == CENTER),
        regulars=sum(1 for m in team if not m.is_guest),
        guests=sum(1 for m in team if m.is_guest),
        avg_height=round(_mean(heights), 1) if heights else None,
        avg_age=round(_mean(ages), 1) if ages else None,
        roles=roles,
        creators=0,
    )


def build_teams(
    assignment: Sequence[Sequence[Member]],
    names: Optional[List[str]] = None,
    top_n: int = ranking.SEPARATE_TOP_N,
) -> List[Team]:
    all_members = [m for t in assignment for m in t]
    threshold = creation_threshold(all_members)
    teams: List[Team] = []
    for idx, group in enumerate(assignment):
        members = sorted(group, key=lambda m: (_POSITION_ORDER.get(m.position, 9), -m.effective_level, m.name))
        summary = summarize(members, top_n)
        summary.creators = sum(
            1 for m in members if m.roles.get("creation", 0.0) >= threshold
        )
        name = names[idx] if names and idx < len(names) and names[idx].strip() else f"{idx + 1}팀"
        teams.append(Team(index=idx, name=name, members=members, summary=summary))
    return teams


def evaluate(
    assignment: Sequence[Sequence[Member]],
    objective_value: float = 0.0,
    top_n: int = ranking.SEPARATE_TOP_N,
) -> Metrics:
    groups = [list(t) for t in assignment if t]
    if not groups:
        return Metrics(
            level_deviation_rate=0.0, quota_violations=0, role_balance_index=0.0
        )

    all_members = [m for t in groups for m in t]

    # 편차는 나이 보너스를 반영한 실질 전력 기준으로 본다
    sums = [sum(m.effective_level for m in t) for t in groups]
    mean_sum = _mean(sums)
    dev_rate = ((max(sums) - min(sums)) / mean_sum * 100) if mean_sum else 0.0

    # 팀 인원수가 다르면 합계 기준 편차는 인원수 차이만으로도 벌어지므로
    # 평균 기준 편차율을 함께 산출한다.
    avgs = [_mean([m.effective_level for m in t]) for t in groups]
    mean_avg = _mean(avgs)
    dev_rate_avg = ((max(avgs) - min(avgs)) / mean_avg * 100) if mean_avg else 0.0

    targets = guard_targets(all_members, [len(t) for t in groups])
    violations = quota_violations(groups, targets)

    role_index = 0.0
    for cluster in ROLE_CLUSTERS:
        avgs_c = [_mean([m.roles.get(cluster, 0.0) for m in t]) for t in groups]
        role_index += statistics.pstdev(avgs_c) if len(avgs_c) > 1 else 0.0

    height_means = []
    for t in groups:
        vals = [m.height_cm for m in t if m.height_cm]
        if vals:
            height_means.append(_mean(vals))
    height_gap = (
        round(max(height_means) - min(height_means), 1) if len(height_means) == len(groups) else None
    )

    age_means = []
    for t in groups:
        vals = [m.age for m in t if m.age]
        if vals:
            age_means.append(_mean(vals))
    age_gap = (
        round(max(age_means) - min(age_means), 1) if len(age_means) == len(groups) else None
    )

    # 정회원이 팀별로 고르게 나뉘었는지 (정회원 우선 배정이 지켜졌는지)
    regulars = [sum(1 for m in t if not m.is_guest) for t in groups]

    threshold = creation_threshold(all_members)
    creators_available = sum(
        1 for m in all_members if m.roles.get("creation", 0.0) >= threshold
    )

    return Metrics(
        level_deviation_rate=round(dev_rate, 2),
        level_deviation_rate_avg=round(dev_rate_avg, 2),
        equal_team_sizes=len({len(t) for t in groups}) == 1,
        quota_violations=violations,
        role_balance_index=round(role_index, 3),
        height_gap=height_gap,
        age_gap=age_gap,
        guest_spread=max(regulars) - min(regulars),
        creation_shortage_teams=creation_shortage(groups, threshold, creators_available),
        top_separation_violations=ranking.separation_violations(groups, top_n),
        height_separation_violations=ranking.height_separation_violations(groups),
        bonus_players=sum(1 for m in all_members if m.age_bonus),
        objective=round(objective_value, 5),
    )
