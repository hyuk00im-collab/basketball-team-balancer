"""인원/팀 데이터 모델 (SPEC.md §3 기준)."""

from datetime import date
from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field, field_validator

from skills import GUARD, FORWARD, SKILLS_BY_POSITION

Position = Literal["가드", "포워드"]


MIN_BIRTH_YEAR = 1930


def age_from_birth_year(birth_year: Optional[int]) -> Optional[int]:
    """현재 연도 기준 나이 (엑셀의 =YEAR(TODAY())-출생년도 와 동일)."""
    return date.today().year - birth_year if birth_year else None


class Member(BaseModel):
    id: str
    name: str
    birth_year: Optional[int] = None
    age: Optional[int] = None
    height_cm: Optional[int] = None
    position: Position
    skills: Dict[str, float] = Field(default_factory=dict)
    level: float = 0.0                 # 역량평균 (순수 역량)
    level_weighted: float = 0.0
    age_bonus: float = 0.0             # 55세 이상 보너스 (경기 어드밴티지)
    effective_level: float = 0.0       # level + age_bonus — 팀 밸런싱에 쓰는 실질 전력
    position_rank: Optional[int] = None  # 같은 포지션 안에서의 역량 순위 (1위부터)
    height_rank: Optional[int] = None    # 같은 포지션 안에서의 신장 순위 (1위부터)
    roles: Dict[str, float] = Field(default_factory=dict)
    is_guest: bool = False
    estimated: bool = False  # 역량 미입력 → 중앙값 대체 여부 (TEAM_BALANCE_SPEC.md §6)


class MemberInput(BaseModel):
    """웹 폼 개별 입력 (WEBAPP_SPEC.md §3.1 방식 B)."""

    name: str
    position: Position
    birth_year: Optional[int] = None
    age: Optional[int] = None
    height_cm: Optional[int] = None
    is_guest: bool = True
    skills: Dict[str, float] = Field(default_factory=dict)

    @field_validator("name")
    @classmethod
    def _name_required(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("이름은 필수입니다.")
        return v

    @field_validator("age")
    @classmethod
    def _age_range(cls, v):
        if v is not None and not (10 <= v <= 80):
            raise ValueError("나이는 10~80 사이여야 합니다.")
        return v

    @field_validator("birth_year")
    @classmethod
    def _birth_year_range(cls, v):
        if v is not None and not (MIN_BIRTH_YEAR <= v <= date.today().year):
            raise ValueError(f"출생년도는 {MIN_BIRTH_YEAR}~{date.today().year} 사이여야 합니다.")
        return v

    @field_validator("height_cm")
    @classmethod
    def _height_range(cls, v):
        if v is not None and not (140 <= v <= 230):
            raise ValueError("키는 140~230cm 사이여야 합니다.")
        return v

    @field_validator("skills")
    @classmethod
    def _skill_range(cls, v):
        for k, val in v.items():
            if val is None:
                continue
            if not (0 <= float(val) <= 5):
                raise ValueError(f"'{k}' 점수는 0~5 사이여야 합니다.")
        return v

    def resolved_age(self) -> Optional[int]:
        """출생년도가 있으면 현재 연도 기준으로 나이를 계산한다."""
        return age_from_birth_year(self.birth_year) or self.age

    def valid_skills(self) -> Dict[str, float]:
        """해당 포지션 항목만 남긴다 (SPEC.md §3)."""
        allowed = SKILLS_BY_POSITION[self.position]
        return {k: float(v) for k, v in self.skills.items() if k in allowed and v is not None}


class BalanceOptions(BaseModel):
    """편성 파라미터 (TEAM_BALANCE_SPEC.md §4.1)."""

    # 공개 배포를 고려해 상한을 둔다 (과도한 CPU 사용 방지)
    team_count: int = Field(3, ge=2, le=8)        # WEBAPP_SPEC.md §3.2 — 기본 K=3
    seed: Optional[int] = None                    # SPEC.md §5 — 재현 가능한 결과
    use_height: bool = True                       # 신장 편차 반영 여부(옵션)
    iterations: int = Field(3000, ge=0, le=20000)  # Hill Climbing 반복 횟수
    lambda_position: float = Field(1.0, ge=0, le=10)
    lambda_role: float = Field(0.6, ge=0, le=10)
    lambda_height: float = Field(0.3, ge=0, le=10)
    excluded_ids: List[str] = Field(default_factory=list)   # 편성 제외 인원
    locked: Dict[str, int] = Field(default_factory=dict)    # {member_id: team_index}
    separate_top_n: int = Field(3, ge=0, le=10)         # 1순위: 역량 상위 N명 분산 (0=해제)
    separate_height_top_n: int = Field(3, ge=0, le=10)  # 2순위: 신장 상위 N명 분산 (0=해제)
    height_positions: List[str] = Field(default_factory=lambda: ["포워드"])
    age_bonus_from: int = Field(55, ge=10, le=99)       # 이 나이부터 가중치 적용
    age_bonus: float = Field(0.5, ge=0, le=5)           # 55세 이상 가중치 → 실질 전력에 가산


class TeamSummary(BaseModel):
    avg_level: float
    sum_level: float
    avg_effective_level: float = 0.0
    sum_effective_level: float = 0.0
    bonus_players: int = 0          # 55세 이상 인원 수
    top_ranked: List[str] = Field(default_factory=list)   # 역량 상위권 표기 (예: "가드 1위")
    top_height: List[str] = Field(default_factory=list)   # 신장 상위권 표기 (예: "포워드 키 1위")
    guards: int
    forwards: int
    avg_height: Optional[float] = None
    roles: Dict[str, float] = Field(default_factory=dict)
    creators: int = 0


class Team(BaseModel):
    index: int
    name: str
    members: List[Member]
    summary: TeamSummary


class Metrics(BaseModel):
    """TEAM_BALANCE_SPEC.md §5 평가 지표."""

    level_deviation_rate: float          # 팀별 level_raw '합' 기준 (SPEC 정의, 인원수 동일할 때 유효)
    level_deviation_rate_avg: float = 0.0  # 팀별 '평균' 기준 (인원수가 다를 때의 실질 지표)
    equal_team_sizes: bool = True
    quota_violations: int
    role_balance_index: float
    height_gap: Optional[float] = None
    creation_shortage_teams: int = 0
    top_separation_violations: int = 0        # 1순위: 역량 상위 N명 겹침 (목표 0)
    height_separation_violations: int = 0     # 2순위: 신장 상위 N명 겹침 (목표 0)
    bonus_players: int = 0               # 55세 이상 인원 수
    objective: float = 0.0


class GenerateRequest(BaseModel):
    options: BalanceOptions = Field(default_factory=BalanceOptions)
    team_names: Optional[List[str]] = None


class RearrangeRequest(BaseModel):
    """결과 화면에서 인원을 손으로 옮긴 뒤의 팀 구성 (WEBAPP_SPEC.md §3.3 수동 조정)."""

    assignment: List[List[str]]                       # 팀별 인원 id 목록
    team_names: Optional[List[str]] = None
    options: Optional[BalanceOptions] = None          # 생략 시 마지막 편성 옵션을 재사용


class GenerateResponse(BaseModel):
    teams: List[Team]
    metrics: Metrics
    excluded: List[Member] = Field(default_factory=list)
    seed: int
    warnings: List[str] = Field(default_factory=list)
    manual: bool = False        # 자동 편성 결과를 손으로 조정한 상태인지
