"""나이 보너스와 포지션별 순위(역량·신장).

편성 규칙을 담당한다.
  1. 55세 이상은 경기 보너스를 받으므로 실질 전력이 그만큼 높다고 본다.
     → effective_level = level + age_bonus (기본 0.5점)
  2. 분산 제약 — 우선순위가 있다.
     1순위: 포지션별 **역량** 순위 1·2·3위를 서로 다른 팀에
     2순위: **포워드 신장** 순위 1·2·3위를 서로 다른 팀에
     두 제약이 충돌하면 1순위를 지키고 2순위를 완화한다(페널티 크기로 표현).

순위는 모두 순수 값 기준이다. 나이 보너스는 순위에 영향을 주지 않는다.
"""

from typing import Dict, List, Optional, Sequence, Tuple

from models import Member
from skills import FORWARD, GUARD

AGE_BONUS_FROM = 55
AGE_BONUS = 0.5
SEPARATE_TOP_N = 3          # 역량 순위 분산 인원 수
HEIGHT_TOP_N = 3            # 신장 순위 분산 인원 수
HEIGHT_POSITIONS = (FORWARD,)  # 신장 분산을 적용할 포지션

POSITIONS = (GUARD, FORWARD)


def age_bonus_for(
    age: Optional[int], threshold: int = AGE_BONUS_FROM, bonus: float = AGE_BONUS
) -> float:
    """55세 이상이면 보너스 점수를 돌려준다 (나이 미상은 0)."""
    return bonus if age is not None and age >= threshold else 0.0


def _by_level(members: Sequence[Member], position: str) -> List[Member]:
    """같은 포지션 인원을 역량 내림차순 정렬 (동점은 이름순 — 재현성 확보)."""
    return sorted(
        (m for m in members if m.position == position), key=lambda m: (-m.level, m.name)
    )


def _by_height(members: Sequence[Member], position: str) -> List[Member]:
    """같은 포지션 인원을 신장 내림차순 정렬 (키 미상은 순위에서 제외)."""
    return sorted(
        (m for m in members if m.position == position and m.height_cm),
        key=lambda m: (-m.height_cm, m.name),
    )


def annotate(
    members: Sequence[Member],
    threshold: int = AGE_BONUS_FROM,
    bonus: float = AGE_BONUS,
) -> List[Member]:
    """나이 보너스·실질 전력·포지션 내 역량/신장 순위를 채운 새 목록을 돌려준다."""
    level_rank: Dict[str, int] = {}
    height_rank: Dict[str, int] = {}
    for position in POSITIONS:
        for i, m in enumerate(_by_level(members, position), start=1):
            level_rank[m.id] = i
        for i, m in enumerate(_by_height(members, position), start=1):
            height_rank[m.id] = i

    out: List[Member] = []
    for m in members:
        gained = age_bonus_for(m.age, threshold, bonus)
        out.append(
            m.model_copy(
                update={
                    "age_bonus": gained,
                    "effective_level": round(m.level + gained, 3),
                    "position_rank": level_rank.get(m.id),
                    "height_rank": height_rank.get(m.id),
                }
            )
        )
    return out


# ------------------------------------------------------------- 분산 대상 그룹

def level_groups(
    members: Sequence[Member], top_n: int = SEPARATE_TOP_N
) -> Dict[str, List[str]]:
    """1순위 — 포지션별 역량 상위 top_n명의 id (순위 순)."""
    if top_n <= 0:
        return {}
    return {p: [m.id for m in _by_level(members, p)[:top_n]] for p in POSITIONS}


def height_groups(
    members: Sequence[Member],
    top_n: int = HEIGHT_TOP_N,
    positions: Sequence[str] = HEIGHT_POSITIONS,
) -> Dict[str, List[str]]:
    """2순위 — 지정 포지션(기본 포워드)의 신장 상위 top_n명의 id (순위 순)."""
    if top_n <= 0:
        return {}
    return {p: [m.id for m in _by_height(members, p)[:top_n]] for p in positions}


def ordered_groups(
    members: Sequence[Member],
    top_n: int = SEPARATE_TOP_N,
    height_top_n: int = HEIGHT_TOP_N,
    height_positions: Sequence[str] = HEIGHT_POSITIONS,
) -> List[Tuple[str, List[str]]]:
    """그리디 배치용 — 우선순위 순으로 (라벨, id 목록) 목록을 만든다."""
    groups: List[Tuple[str, List[str]]] = []
    for position, ids in level_groups(members, top_n).items():
        if ids:
            groups.append((f"{position} 역량", ids))
    for position, ids in height_groups(members, height_top_n, height_positions).items():
        if ids:
            groups.append((f"{position} 신장", ids))
    return groups


def _collisions(teams: Sequence[Sequence[Member]], ids: Sequence[str]) -> int:
    """해당 인원들이 같은 팀에 겹친 횟수 (모두 다른 팀이면 0)."""
    wanted = set(ids)
    placed = [idx for idx, team in enumerate(teams) for m in team if m.id in wanted]
    return len(placed) - len(set(placed))


def separation_violations(
    teams: Sequence[Sequence[Member]], top_n: int = SEPARATE_TOP_N
) -> int:
    """1순위 — 포지션별 역량 상위 N명의 분산 위반 건수."""
    if top_n <= 0:
        return 0
    everyone = [m for t in teams for m in t]
    return sum(_collisions(teams, ids) for ids in level_groups(everyone, top_n).values())


def height_separation_violations(
    teams: Sequence[Sequence[Member]],
    top_n: int = HEIGHT_TOP_N,
    positions: Sequence[str] = HEIGHT_POSITIONS,
) -> int:
    """2순위 — 신장 상위 N명의 분산 위반 건수."""
    if top_n <= 0:
        return 0
    everyone = [m for t in teams for m in t]
    return sum(
        _collisions(teams, ids)
        for ids in height_groups(everyone, top_n, positions).values()
    )


# ------------------------------------------------------------------ 표기 helper

def describe_rank(member: Member, top_n: int = SEPARATE_TOP_N) -> Optional[str]:
    """'가드 1위'처럼 역량 상위권 표기. 상위권이 아니면 None."""
    if member.position_rank and member.position_rank <= top_n:
        return f"{member.position} {member.position_rank}위"
    return None


def describe_height_rank(
    member: Member,
    top_n: int = HEIGHT_TOP_N,
    positions: Sequence[str] = HEIGHT_POSITIONS,
) -> Optional[str]:
    """'포워드 키 1위'처럼 신장 상위권 표기. 대상이 아니면 None."""
    if (
        member.position in positions
        and member.height_rank
        and member.height_rank <= top_n
    ):
        return f"{member.position} 키 {member.height_rank}위"
    return None
