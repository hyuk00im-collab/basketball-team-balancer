"""역량 항목 정의 및 역할군(Role Cluster) 매핑.

근거 문서:
  - SPEC.md §2 (가드/포워드 역량 10항목)
  - TEAM_BALANCE_SPEC.md §2 (역할군 재분류)
"""

GUARD = "가드"
FORWARD = "포워드"
POSITIONS = (GUARD, FORWARD)

# SPEC.md §2 — 열 순서 그대로 (E~N, O~X)
GUARD_SKILLS = [
    "볼핸들링·드리블",
    "코트비전·패스센스",
    "3점슈팅",
    "미드레인지 풀업슈팅",
    "퍼스트스텝·돌파력",
    "속공전개능력",
    "온볼수비(맨투맨)",
    "스틸·패스인터셉트",
    "경기운영·템포조절",
    "자유투능력",
]

FORWARD_SKILLS = [
    "리바운드",
    "포스트업득점력",
    "인사이드피니시",
    "수비능력",
    "박스아웃·몸싸움",
    "스크린능력",
    "자유투",
    "미드레인지 슈팅",
    "패싱센스",
    "블록슛",
]

SKILLS_BY_POSITION = {GUARD: GUARD_SKILLS, FORWARD: FORWARD_SKILLS}

# TEAM_BALANCE_SPEC.md §2.1 / §2.2
# 4개 역할군은 포지션 간 비교가 가능하도록 공통 키를 사용한다.
#   scoring(득점) / creation(창출) / defense(수비) / impact(가드=스피드·전환, 포워드=골밑장악)
ROLE_CLUSTERS = ("scoring", "creation", "defense", "impact")

ROLE_CLUSTER_LABELS = {
    "scoring": "득점",
    "creation": "창출",
    "defense": "수비",
    "impact": "전환/골밑",
}

ROLE_MAP = {
    GUARD: {
        "scoring": ["3점슈팅", "미드레인지 풀업슈팅", "자유투능력"],
        "creation": ["볼핸들링·드리블", "코트비전·패스센스", "경기운영·템포조절"],
        "defense": ["온볼수비(맨투맨)", "스틸·패스인터셉트"],
        "impact": ["퍼스트스텝·돌파력", "속공전개능력"],
    },
    FORWARD: {
        "scoring": ["포스트업득점력", "인사이드피니시", "미드레인지 슈팅", "자유투"],
        "creation": ["패싱센스", "스크린능력"],
        "defense": ["수비능력"],
        "impact": ["리바운드", "박스아웃·몸싸움", "블록슛"],
    },
}

# TEAM_BALANCE_SPEC.md §3.2 — level_weighted 기본 가중치
ROLE_WEIGHTS = {"scoring": 0.30, "creation": 0.25, "defense": 0.25, "impact": 0.20}


def role_scores(position: str, skills: dict) -> dict:
    """포지션별 skills 딕셔너리에서 4개 역할군 평균 점수를 산출한다."""
    mapping = ROLE_MAP[position]
    out = {}
    for cluster, items in mapping.items():
        vals = [float(skills[i]) for i in items if skills.get(i) is not None]
        out[cluster] = round(sum(vals) / len(vals), 4) if vals else 0.0
    return out


def level_raw(position: str, skills: dict) -> float:
    """SPEC.md §3 — 포지션 10항목 단순 평균."""
    items = SKILLS_BY_POSITION[position]
    vals = [float(skills[i]) for i in items if skills.get(i) is not None]
    return round(sum(vals) / len(vals), 3) if vals else 0.0


def level_weighted(position: str, skills: dict) -> float:
    """TEAM_BALANCE_SPEC.md §3.2 — 역할군 균형 가중 평균(보조 지표)."""
    rs = role_scores(position, skills)
    return round(sum(rs[c] * ROLE_WEIGHTS[c] for c in ROLE_CLUSTERS), 3)
