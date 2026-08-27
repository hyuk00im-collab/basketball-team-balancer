"""농구 팀 편성 웹앱 — FastAPI 진입점 (WEBAPP_SPEC.md §5 API 설계)."""

import io
import secrets
import sys
import threading
import time
from pathlib import Path
from typing import Dict, List, Optional

BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR))  # backend 모듈을 최상위 이름으로 import

from fastapi import Body, Depends, FastAPI, File, HTTPException, Request, UploadFile  # noqa: E402
from fastapi.responses import FileResponse, StreamingResponse  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402
from openpyxl import Workbook  # noqa: E402

import parser as xlsx_parser  # noqa: E402
import ranking  # noqa: E402
import sample_sheet  # noqa: E402
from balancer import balance  # noqa: E402
from evaluator import build_teams, evaluate  # noqa: E402
from models import (  # noqa: E402
    BalanceOptions,
    GenerateRequest,
    GenerateResponse,
    Member,
    MemberInput,
    Metrics,
    RearrangeRequest,
)
from skills import (  # noqa: E402
    FORWARD_SKILLS,
    GUARD_SKILLS,
    ROLE_CLUSTER_LABELS,
    ROLE_MAP,
    level_raw,
    level_weighted,
    role_scores,
)

FRONTEND_DIR = BASE_DIR.parent / "frontend"

app = FastAPI(title="농구 팀 편성 웹앱", version="1.0.0")


# ------------------------------------------------------------------ 세션 저장소
# MVP: 로컬 단일 사용자 기준 메모리 저장 (WEBAPP_SPEC.md §1)
class Store:
    def __init__(self) -> None:
        self.members: List[Member] = []
        self.last_result: Optional[GenerateResponse] = None
        self.last_options: Optional[BalanceOptions] = None
        self._guest_seq = 0

    def unique_id(self, base: str) -> str:
        used = {m.id for m in self.members}
        if base not in used:
            return base
        n = 2
        while f"{base}_{n}" in used:
            n += 1
        return f"{base}_{n}"

    def next_guest_id(self) -> str:
        self._guest_seq += 1
        return self.unique_id(f"guest_{self._guest_seq}")

    def resolved(self) -> List[Member]:
        """결측 역량을 중앙값으로 대체하고(§6) 나이 보너스·포지션 순위를 채운 목록."""
        return ranking.annotate(xlsx_parser.impute(self.members))


# 방문자(브라우저)별로 독립된 저장소를 둔다. 공개 배포 시 남의 명단이 섞이지 않도록.
SESSION_COOKIE = "btb_session"
SESSION_TTL = 12 * 3600      # 12시간 미사용 시 정리
MAX_SESSIONS = 300           # 메모리 상한 (가장 오래된 세션부터 정리)
MAX_MEMBERS = 200            # 세션당 인원 상한
MAX_UPLOAD_BYTES = 4 * 1024 * 1024


class SessionRegistry:
    """세션 id → Store. 오래된 세션은 접근 시점에 정리한다."""

    def __init__(self) -> None:
        self._stores: Dict[str, Store] = {}
        self._seen: Dict[str, float] = {}
        self._lock = threading.Lock()

    def get(self, sid: str) -> Store:
        with self._lock:
            self._prune()
            store = self._stores.get(sid)
            if store is None:
                store = Store()
                self._stores[sid] = store
            self._seen[sid] = time.time()
            return store

    def _prune(self) -> None:
        now = time.time()
        for sid in [s for s, seen in self._seen.items() if now - seen > SESSION_TTL]:
            self._stores.pop(sid, None)
            self._seen.pop(sid, None)
        while len(self._stores) > MAX_SESSIONS:
            oldest = min(self._seen, key=self._seen.get)
            self._stores.pop(oldest, None)
            self._seen.pop(oldest, None)


sessions = SessionRegistry()


@app.middleware("http")
async def session_middleware(request: Request, call_next):
    sid = request.cookies.get(SESSION_COOKIE) or ""
    if not sid.isalnum() and not all(c.isalnum() or c in "-_" for c in sid):
        sid = ""
    if not sid:
        sid = secrets.token_urlsafe(18)
    request.state.store = sessions.get(sid)

    response = await call_next(request)
    https = request.headers.get("x-forwarded-proto", request.url.scheme) == "https"
    response.set_cookie(
        SESSION_COOKIE, sid,
        max_age=SESSION_TTL, httponly=True, samesite="lax", secure=https, path="/",
    )
    return response


def get_store(request: Request) -> Store:
    return request.state.store


StoreDep = Depends(get_store)


# ------------------------------------------------------------------ 페이지
@app.get("/", include_in_schema=False)
def page_index() -> FileResponse:
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/result", include_in_schema=False)
def page_result() -> FileResponse:
    return FileResponse(FRONTEND_DIR / "result.html")


# ------------------------------------------------------------------ API
@app.get("/api/skills")
def get_skills() -> Dict:
    """포지션별 역량 항목과 역할군 매핑 (프론트 동적 폼 생성용)."""
    return {
        "positions": ["가드", "포워드"],
        "skills": {"가드": GUARD_SKILLS, "포워드": FORWARD_SKILLS},
        "roles": ROLE_MAP,
        "role_labels": ROLE_CLUSTER_LABELS,
    }


@app.get("/api/members", response_model=List[Member])
def list_members(store: Store = StoreDep) -> List[Member]:
    return store.resolved()


@app.post("/api/members", response_model=Member, status_code=201)
def add_member(payload: MemberInput, store: Store = StoreDep) -> Member:
    if len(store.members) >= MAX_MEMBERS:
        raise HTTPException(status_code=400, detail=f"인원은 최대 {MAX_MEMBERS}명까지 등록할 수 있습니다.")
    skills = payload.valid_skills()
    estimated = len(skills) < 10
    member = Member(
        id=store.next_guest_id(),
        name=payload.name,
        birth_year=payload.birth_year,
        age=payload.resolved_age(),
        height_cm=payload.height_cm,
        position=payload.position,
        skills=skills,
        level=level_raw(payload.position, skills),
        level_weighted=level_weighted(payload.position, skills),
        roles=role_scores(payload.position, skills),
        is_guest=payload.is_guest,
        estimated=estimated,
    )
    store.members.append(member)
    resolved = {m.id: m for m in store.resolved()}
    return resolved[member.id]


@app.delete("/api/members/{member_id}", status_code=204)
def delete_member(member_id: str, store: Store = StoreDep) -> None:
    before = len(store.members)
    store.members = [m for m in store.members if m.id != member_id]
    if len(store.members) == before:
        raise HTTPException(status_code=404, detail="해당 인원을 찾을 수 없습니다.")


@app.delete("/api/members", status_code=204)
def clear_members(store: Store = StoreDep) -> None:
    store.members = []
    store.last_result = None
    store.last_options = None


@app.get("/api/sample")
def download_sample(empty: bool = False) -> StreamingResponse:
    """SPEC.md 형식의 샘플 엑셀 다운로드.

    파일을 미리 만들어두지 않고 요청 시점에 생성하므로 나이 수식의 기준 연도와
    열 구성이 항상 현재 스펙과 일치한다. `empty=true`면 데이터 없이 양식만 준다.
    """
    rows = 0 if empty else len(sample_sheet.NAMES)
    buffer = io.BytesIO()
    sample_sheet.build_workbook(rows).save(buffer)
    buffer.seek(0)
    filename = "basketball_level_template.xlsx" if empty else sample_sheet.FILENAME
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.post("/api/upload")
async def upload(file: UploadFile = File(...), store: Store = StoreDep) -> Dict:
    if not (file.filename or "").lower().endswith((".xlsx", ".xlsm")):
        raise HTTPException(status_code=400, detail="xlsx 파일만 업로드할 수 있습니다.")
    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"파일이 너무 큽니다. {MAX_UPLOAD_BYTES // (1024 * 1024)}MB 이하로 올려주세요.",
        )
    try:
        parsed, warnings = xlsx_parser.parse_workbook(data)
    except Exception as exc:  # noqa: BLE001 - 파싱 실패 원인을 그대로 전달
        raise HTTPException(status_code=400, detail=f"파일 파싱 실패: {exc}") from exc

    if len(store.members) + len(parsed) > MAX_MEMBERS:
        raise HTTPException(
            status_code=400,
            detail=f"인원은 최대 {MAX_MEMBERS}명까지 등록할 수 있습니다. "
                   f"(현재 {len(store.members)}명 + 파일 {len(parsed)}명)",
        )

    added = []
    for m in parsed:
        m.id = store.unique_id(m.id)
        store.members.append(m)
        added.append(m)

    resolved = {m.id: m for m in store.resolved()}
    return {
        "added": [resolved[m.id].model_dump() for m in added],
        "members": [m.model_dump() for m in store.resolved()],
        "warnings": warnings,
    }


def build_warnings(
    groups: List[List[Member]], metrics: Metrics, options: BalanceOptions
) -> List[str]:
    """편성/수동 조정 결과에 붙일 안내 문구 (자동·수동 공통)."""
    sizes = [len(g) for g in groups]
    warnings: List[str] = []

    if sizes and max(sizes) - min(sizes) > 1:
        warnings.append(
            f"팀별 인원수가 {'-'.join(str(n) for n in sizes)}명으로 2명 이상 차이납니다."
        )
    elif sizes and max(sizes) != min(sizes):
        warnings.append(
            f"인원 {sum(sizes)}명이 {len(groups)}로 나누어떨어지지 않아 팀별 인원수가 1명씩 차이납니다."
        )

    if metrics.quota_violations:
        warnings.append(
            f"포지션 쿼터(±1명)를 벗어난 팀이 {metrics.quota_violations}개 있습니다. 가드/포워드 비율이 치우쳐 있는지 확인해 주세요."
        )
    if metrics.creation_shortage_teams:
        warnings.append(
            f"창출형(볼 배급) 인원이 없는 팀이 {metrics.creation_shortage_teams}개 있습니다."
        )
    if metrics.top_separation_violations:
        warnings.append(
            f"포지션별 역량 상위 {options.separate_top_n}명 중 같은 팀에 겹친 경우가 "
            f"{metrics.top_separation_violations}건 있습니다."
        )
    if metrics.height_separation_violations:
        warnings.append(
            f"포워드 신장 상위 {options.separate_height_top_n}명 중 같은 팀에 겹친 경우가 "
            f"{metrics.height_separation_violations}건 있습니다. (역량 상위권 분산이 1순위라 양보된 결과일 수 있습니다.)"
        )
    if metrics.bonus_players:
        warnings.append(
            f"{options.age_bonus_from}세 이상 {metrics.bonus_players}명은 가중치 "
            f"{options.age_bonus:g}점을 반영해 실질 전력 +{options.age_bonus:g}로 계산했습니다."
        )
    if any(m.estimated for g in groups for m in g):
        warnings.append("역량 미입력 인원은 동일 포지션 중앙값으로 추정한 값(추정)을 사용했습니다.")
    return warnings


@app.post("/api/teams/generate", response_model=GenerateResponse)
def generate(
    req: GenerateRequest = Body(default_factory=GenerateRequest),
    store: Store = StoreDep,
) -> GenerateResponse:
    options = req.options
    everyone = store.resolved()
    excluded_ids = set(options.excluded_ids)
    pool = [m for m in everyone if m.id not in excluded_ids]

    if len(pool) < options.team_count:
        raise HTTPException(
            status_code=400,
            detail=f"{options.team_count}팀 편성에는 최소 {options.team_count}명이 필요합니다. (현재 {len(pool)}명)",
        )

    top_n = max(0, min(options.separate_top_n, options.team_count))
    assignment, seed, cost = balance(pool, options)
    teams = build_teams(assignment, req.team_names, top_n)
    metrics = evaluate(assignment, cost, top_n)

    result = GenerateResponse(
        teams=teams,
        metrics=metrics,
        excluded=[m for m in everyone if m.id in excluded_ids],
        seed=seed,
        warnings=build_warnings(assignment, metrics, options),
        manual=False,
    )
    store.last_options = options
    store.last_result = result
    return result


@app.post("/api/teams/rearrange", response_model=GenerateResponse)
def rearrange(req: RearrangeRequest, store: Store = StoreDep) -> GenerateResponse:
    """결과 화면에서 인원을 손으로 옮긴 팀 구성으로 요약·지표를 다시 계산한다.

    편성 알고리즘은 돌리지 않고, 받은 배치를 그대로 평가만 한다.
    """
    options = req.options or store.last_options or BalanceOptions()
    everyone = ranking.annotate(
        store.resolved(), options.age_bonus_from, options.age_bonus
    )
    by_id = {m.id: m for m in everyone}

    seen: set = set()
    groups: List[List[Member]] = []
    for team_ids in req.assignment:
        group: List[Member] = []
        for member_id in team_ids:
            member = by_id.get(member_id)
            if member is None:
                raise HTTPException(status_code=400, detail=f"없는 인원입니다: {member_id}")
            if member_id in seen:
                raise HTTPException(status_code=400, detail=f"인원이 중복 배정되었습니다: {member.name}")
            seen.add(member_id)
            group.append(member)
        groups.append(group)

    if not groups or all(not g for g in groups):
        raise HTTPException(status_code=400, detail="배정된 인원이 없습니다.")
    empty = [i + 1 for i, g in enumerate(groups) if not g]
    if empty:
        raise HTTPException(
            status_code=400,
            detail=f"{', '.join(str(i) for i in empty)}팀이 비게 됩니다. 최소 1명은 남겨 주세요.",
        )

    top_n = max(0, min(options.separate_top_n, len(groups)))
    teams = build_teams(groups, req.team_names, top_n)
    metrics = evaluate(groups, 0.0, top_n)

    result = GenerateResponse(
        teams=teams,
        metrics=metrics,
        excluded=[m for m in everyone if m.id not in seen],
        seed=store.last_result.seed if store.last_result else 0,
        warnings=build_warnings(groups, metrics, options),
        manual=True,
    )
    store.last_result = result
    return result


@app.get("/api/teams/result", response_model=GenerateResponse)
def last_result(store: Store = StoreDep) -> GenerateResponse:
    if store.last_result is None:
        raise HTTPException(status_code=404, detail="편성 결과가 없습니다. 먼저 팀 편성을 실행해 주세요.")
    return store.last_result


@app.post("/api/teams/export")
def export_xlsx(
    team_names: Optional[List[str]] = Body(default=None, embed=True),
    store: Store = StoreDep,
) -> StreamingResponse:
    """편성 결과를 xlsx로 재출력 (WEBAPP_SPEC.md §4 P2)."""
    if store.last_result is None:
        raise HTTPException(status_code=404, detail="편성 결과가 없습니다.")

    result = store.last_result

    def team_label(idx: int, fallback: str) -> str:
        if team_names and idx < len(team_names) and str(team_names[idx]).strip():
            return str(team_names[idx]).strip()
        return fallback

    wb = Workbook()
    ws = wb.active
    ws.title = "팀편성결과"
    ws.append(
        ["팀", "이름", "포지션", "역량평균", "나이보너스", "실질전력", "역량순위",
         "신장순위", "출생년도", "나이", "키(cm)", "게스트", "추정값"]
    )
    for idx, team in enumerate(result.teams):
        label = team_label(idx, team.name)
        for m in team.members:
            ws.append(
                [
                    label,
                    m.name,
                    m.position,
                    m.level,
                    m.age_bonus or "",
                    m.effective_level,
                    m.position_rank,
                    m.height_rank,
                    m.birth_year,
                    m.age,
                    m.height_cm,
                    "Y" if m.is_guest else "",
                    "Y" if m.estimated else "",
                ]
            )

    ws2 = wb.create_sheet("팀요약")
    ws2.append(
        ["팀", "인원", "평균레벨", "평균실질전력", "실질전력합", "55세이상",
         "가드", "포워드", "평균키", "창출형"]
    )
    for idx, team in enumerate(result.teams):
        s = team.summary
        ws2.append(
            [
                team_label(idx, team.name),
                len(team.members),
                s.avg_level,
                s.avg_effective_level,
                s.sum_effective_level,
                s.bonus_players,
                s.guards,
                s.forwards,
                s.avg_height,
                s.creators,
            ]
        )
    ws2.append([])
    ws2.append(["레벨 편차율(%)", result.metrics.level_deviation_rate])
    ws2.append(["포지션 쿼터 위반 팀 수", result.metrics.quota_violations])
    ws2.append(["역할군 균형 지수", result.metrics.role_balance_index])
    ws2.append(["역량 상위권 분산 위반", result.metrics.top_separation_violations])
    ws2.append(["신장 상위권 분산 위반", result.metrics.height_separation_violations])
    ws2.append(["신장 편차(cm)", result.metrics.height_gap])
    ws2.append(["랜덤 시드", result.seed])

    buffer = io.BytesIO()
    wb.save(buffer)
    buffer.seek(0)
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="team_result.xlsx"'},
    )


app.mount("/static", StaticFiles(directory=FRONTEND_DIR / "static"), name="static")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)
