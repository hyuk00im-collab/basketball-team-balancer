"""약식 편성 엑셀 파서 (포지션 구분 없음 · 6항목)."""

import io
import re
import statistics
from datetime import date
from typing import Dict, List, Optional, Tuple

from openpyxl import load_workbook

from quick_sample_sheet import LAYOUT, QUICK_SKILLS

# 헤더명 → 내부 key (슬래시·띄어쓰기 포함 표기 허용)
HEADER_ALIAS: Dict[str, str] = {
    "슈팅": "슈팅",
    "드리블": "드리블",
    "볼핸들링": "드리블",
    "패스/시야": "패스",
    "패스": "패스",
    "패스시야": "패스",
    "수비": "수비",
    "리바운드": "리바운드",
    "체력/스피드": "체력",
    "체력": "체력",
    "스피드": "체력",
}

# 약식 6항목 key 목록 (순서 고정)
QUICK_KEYS = ["슈팅", "드리블", "패스", "수비", "리바운드", "체력"]

DATA_SHEET = "선수레벨"
HEADER_SCAN_ROWS = 12
EXAMPLE_MARK = "예시"
MAX_BLANK_ROWS = 20
MIN_BIRTH_YEAR = 1930


def _norm(value) -> str:
    return re.sub(r"\s+", "", str(value or ""))


def _to_int(value) -> Optional[int]:
    try:
        if value is None or str(value).strip() == "":
            return None
        return int(round(float(value)))
    except (TypeError, ValueError):
        return None


def _to_float(value) -> Optional[float]:
    try:
        if value is None or str(value).strip() == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _cell(row: Tuple, col: Optional[int]):
    if not col or col > len(row):
        return None
    return row[col - 1]


def _is_example(name: str) -> bool:
    return _norm(name).lstrip("(").startswith(EXAMPLE_MARK)


def _resolve_columns(header: Tuple) -> Tuple[Dict, Dict[str, int]]:
    """헤더 행에서 열 위치를 탐색한다."""
    found: Dict[str, int] = {}
    skill_cols: Dict[str, int] = {}

    for col, raw in enumerate(header, start=1):
        key = _norm(raw)
        if not key:
            continue
        if key in ("이름",):
            found.setdefault("name", col)
        elif key in ("출생년도", "출생연도", "생년"):
            found.setdefault("birth_year", col)
        elif key == "나이":
            found.setdefault("age", col)
        elif key.startswith("키"):
            found.setdefault("height", col)
        elif key == "역량평균":
            found.setdefault("level", col)
        elif key in HEADER_ALIAS:
            skill_cols.setdefault(HEADER_ALIAS[key], col)

    # 헤더를 전혀 못 찾으면 고정 레이아웃 사용
    if not skill_cols:
        for i, sk in enumerate(QUICK_KEYS):
            skill_cols[sk] = LAYOUT["skill_start"] + i

    columns = {
        "name":       found.get("name",       LAYOUT["name"]),
        "birth_year": found.get("birth_year"),
        "age":        found.get("age",        LAYOUT["age"]),
        "height":     found.get("height",     LAYOUT.get("height")),
        "level":      found.get("level",      LAYOUT["level"]),
    }
    return columns, skill_cols


def _find_header_row(ws, max_col: int) -> Tuple[int, Tuple]:
    """'이름' 컬럼이 있는 행을 헤더로 찾는다."""
    fallback: Tuple = ()
    for idx, row in enumerate(
        ws.iter_rows(min_row=1, max_row=HEADER_SCAN_ROWS, max_col=max_col, values_only=True),
        start=1,
    ):
        keys = {_norm(v) for v in row}
        if "이름" in keys:
            return idx, row
        if idx == 3:
            fallback = row
    return 3, fallback


def parse_workbook(data: bytes) -> Tuple[List[Dict], List[str]]:
    """업로드된 xlsx 바이트를 약식 인원 목록(dict 리스트)으로 변환한다.

    반환: (인원 목록, 경고 메시지 목록)
    인원 dict 형식: { name, skills: {key: float}, level: float, is_guest: bool }
    """
    warnings: List[str] = []
    wb = load_workbook(io.BytesIO(data), data_only=True, read_only=True)

    if DATA_SHEET in wb.sheetnames:
        ws = wb[DATA_SHEET]
    else:
        ws = wb[wb.sheetnames[0]]
        warnings.append(
            f"'{DATA_SHEET}' 시트를 찾지 못해 '{ws.title}' 시트를 사용했습니다."
        )

    max_col = max(ws.max_column or 0, LAYOUT["level"])
    header_row, header = _find_header_row(ws, max_col)
    columns, skill_cols = _resolve_columns(header)

    this_year = date.today().year
    members: List[Dict] = []
    blanks = 0

    for row_idx, row in enumerate(
        ws.iter_rows(min_row=header_row + 1, max_col=max_col, values_only=True),
        start=header_row + 1,
    ):
        name = _cell(row, columns["name"])
        if name is None or str(name).strip() == "":
            blanks += 1
            if blanks >= MAX_BLANK_ROWS:
                break
            continue
        blanks = 0

        name = str(name).strip()
        if _is_example(name):
            continue

        # 역량 수집
        skills: Dict[str, float] = {}
        for key in QUICK_KEYS:
            val = _to_float(_cell(row, skill_cols.get(key)))
            if val is not None:
                skills[key] = max(0.0, min(5.0, val))

        if not skills:
            warnings.append(f"{row_idx}행 '{name}': 역량 항목이 없어 건너뜁니다.")
            continue

        # 누락 항목은 입력된 값의 평균으로 대체
        filled_vals = list(skills.values())
        median_val = round(statistics.median(filled_vals), 3) if filled_vals else 3.0
        estimated = len(skills) < len(QUICK_KEYS)
        if estimated:
            for key in QUICK_KEYS:
                if key not in skills:
                    skills[key] = median_val
            warnings.append(f"{row_idx}행 '{name}': 역량 일부 누락 — 중앙값({median_val})으로 대체했습니다.")

        level = round(sum(skills[k] for k in QUICK_KEYS) / len(QUICK_KEYS), 3)

        # 나이
        birth_year = _to_int(_cell(row, columns["birth_year"])) if columns["birth_year"] else None
        if birth_year is not None and not (MIN_BIRTH_YEAR <= birth_year <= this_year):
            warnings.append(f"{row_idx}행 '{name}': 출생년도 {birth_year}는 범위를 벗어나 무시합니다.")
            birth_year = None
        age = (this_year - birth_year) if birth_year else _to_int(_cell(row, columns["age"]))

        height_cm = _to_int(_cell(row, columns.get("height")))
        if height_cm is not None and not (100 <= height_cm <= 230):
            warnings.append(f"{row_idx}행 '{name}': 키 {height_cm}cm는 범위를 벗어나 무시합니다.")
            height_cm = None

        members.append({
            "name":       name,
            "skills":     skills,
            "level":      level,
            "is_guest":   False,
            "estimated":  estimated,
            "age":        age,
            "birth_year": birth_year,
            "height_cm":  height_cm,
        })

    wb.close()
    if not members:
        warnings.append(
            "읽어들인 인원이 없습니다. '이름' 컬럼명이 있는 헤더 행과 "
            "그 아래 인원 데이터가 있는지 확인해 주세요."
        )
    return members, warnings
