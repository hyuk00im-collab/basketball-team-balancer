"""약식 편성 엑셀 샘플/템플릿 생성기 (포지션 구분 없음 · 키 + 6항목)."""

import random
from datetime import date
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

# 6항목 (헤더 표시용, 슬래시 포함)
QUICK_SKILLS = ["슈팅", "드리블", "패스/시야", "수비", "리바운드", "체력/스피드"]

#  A: 이름 / B: 출생년도 / C: 나이(수식) / D: 키(cm) / E~J: 6항목 / K: 역량평균(수식)
LAYOUT = {
    "name": 1,          # A
    "birth_year": 2,    # B
    "age": 3,           # C  (수식)
    "height": 4,        # D
    "skill_start": 5,   # E~J (6항목)
    "level": 11,        # K  (수식)
}

NAMES = [
    "김민준", "이서준", "박도윤", "최시우", "정하준", "강주원", "조지호", "윤은우",
    "장선우", "임유준", "한지훈", "오건우", "서현우", "신도현", "권민재", "황준서",
    "안예준", "송지환", "홍성민", "문태윤",
]

EXAMPLE_ROW = 4
FIRST_DATA_ROW = 5
TEMPLATE_ROWS = 100

AUTO_FILL   = PatternFill("solid", fgColor="FFEDEFF3")
SKILL_FILL  = PatternFill("solid", fgColor="FFEAF0FF")
HEIGHT_FILL = PatternFill("solid", fgColor="FFE7F6F0")

COL_AGE         = get_column_letter(LAYOUT["age"])          # C
COL_HEIGHT      = get_column_letter(LAYOUT["height"])       # D
COL_SKILL_FIRST = get_column_letter(LAYOUT["skill_start"])  # E
COL_SKILL_LAST  = get_column_letter(LAYOUT["skill_start"] + 5)  # J
COL_LEVEL       = get_column_letter(LAYOUT["level"])        # K


def _age_formula(row: int) -> str:
    return f'=IF(B{row}="","",YEAR(TODAY())-B{row})'


def _level_formula(row: int) -> str:
    rng = f"{COL_SKILL_FIRST}{row}:{COL_SKILL_LAST}{row}"
    return (
        f'=IF(A{row}="","",'
        f'IF(COUNT({rng})=0,"",AVERAGE({rng})))'
    )


def build_workbook(rows: int = len(NAMES), seed: int = 7) -> Workbook:
    """샘플 데이터가 채워진 워크북. rows=0이면 빈 양식만 생성."""
    wb = Workbook()

    guide = wb.active
    guide.title = "작성안내"
    guide["A1"] = "이 시트는 안내용이며 프로그램 파싱 대상이 아닙니다."
    guide["A3"] = "1) '선수레벨' 시트 3행이 헤더, 4행은 예시행(파싱 제외), 5행부터 실제 데이터입니다."
    guide["A4"] = "2) 키(D열)는 cm 단위 정수를 입력합니다 (예: 178)."
    guide["A5"] = "3) 역량 점수(E~J열)는 0~5, 0.5 단위로 입력합니다."
    guide["A6"] = "4) 포지션 구분 없이 6가지 항목을 모든 인원에게 동일하게 적용합니다."
    guide["A8"] = "※ 회색 배경 열(C 나이, K 역량평균)은 수식 자동 계산 — 직접 입력하지 마세요."
    guide["A8"].font = Font(bold=True)
    guide.column_dimensions["A"].width = 72

    ws = wb.create_sheet("선수레벨")
    ws["A1"] = "농구 동호회 약식 선수 레벨 시트 (포지션 구분 없음 · 키 + 6항목)"
    ws["A2"] = "3행: 헤더 / 4행: 예시행(파싱 제외) / 5행부터 실제 데이터"

    # 헤더 행 (A~K)
    header_titles = ["이름", "출생년도", "나이", "키(cm)"] + QUICK_SKILLS + ["역량평균"]
    for col, title in enumerate(header_titles, start=1):
        cell = ws.cell(row=3, column=col, value=title)
        cell.font = Font(bold=True)
        cell.alignment = Alignment(wrap_text=True, vertical="center", horizontal="center")
    # 자동계산 열 색
    for col in (LAYOUT["age"], LAYOUT["level"]):
        ws.cell(row=3, column=col).fill = AUTO_FILL
    # 키 헤더 색
    ws.cell(row=3, column=LAYOUT["height"]).fill = HEIGHT_FILL
    # 역량 헤더 색
    for i in range(6):
        ws.cell(row=3, column=LAYOUT["skill_start"] + i).fill = SKILL_FILL
    ws.row_dimensions[3].height = 36

    # 예시행 (파싱 제외)
    this_year = date.today().year
    ws.cell(row=4, column=1, value="예시)홍길동")
    ws.cell(row=4, column=2, value=this_year - 32)
    ws.cell(row=4, column=3, value=_age_formula(4)).fill = AUTO_FILL
    ws.cell(row=4, column=4, value=178)
    for i in range(6):
        ws.cell(row=4, column=LAYOUT["skill_start"] + i, value=3.5)
    ws.cell(row=4, column=LAYOUT["level"], value=_level_formula(4)).fill = AUTO_FILL

    # 샘플 데이터
    rng = random.Random(seed)
    for offset in range(rows):
        row = FIRST_DATA_ROW + offset
        name = NAMES[offset % len(NAMES)]
        base = rng.choice([2.0, 2.5, 3.0, 3.5, 4.0])
        ws.cell(row=row, column=1, value=name)
        ws.cell(row=row, column=2, value=this_year - rng.randint(22, 48))
        ws.cell(row=row, column=4, value=rng.randint(165, 195))   # 키
        for i in range(6):
            score = min(5.0, max(0.0, base + rng.choice([-1.0, -0.5, 0, 0, 0.5, 1.0])))
            ws.cell(row=row, column=LAYOUT["skill_start"] + i, value=score)

    # 빈 행에도 수식 미리 배포
    last_row = FIRST_DATA_ROW + max(rows, TEMPLATE_ROWS) - 1
    for row in range(FIRST_DATA_ROW, last_row + 1):
        ws.cell(row=row, column=LAYOUT["age"], value=_age_formula(row)).fill = AUTO_FILL
        ws.cell(row=row, column=LAYOUT["level"], value=_level_formula(row)).fill = AUTO_FILL

    # 키 유효성 검사 (100~230 정수)
    height_range = f"{COL_HEIGHT}{FIRST_DATA_ROW}:{COL_HEIGHT}{last_row}"
    dv_h = DataValidation(
        type="whole", operator="between", formula1="100", formula2="230",
        allow_blank=True, showErrorMessage=True,
        errorTitle="키(cm)", error="100~230 사이의 정수를 입력하세요.",
    )
    ws.add_data_validation(dv_h)
    dv_h.add(height_range)

    # 역량 입력값 유효성 검사 (0~5, 0.5 단위)
    skill_range = f"{COL_SKILL_FIRST}{FIRST_DATA_ROW}:{COL_SKILL_LAST}{last_row}"
    first_cell  = f"{COL_SKILL_FIRST}{FIRST_DATA_ROW}"
    dv_s = DataValidation(
        type="custom",
        formula1=f"=AND({first_cell}>=0,{first_cell}<=5,MOD({first_cell}*2,1)=0)",
        showErrorMessage=True,
        errorTitle="역량 점수",
        error="0~5 사이, 0.5 단위로 입력하세요. (예: 0, 0.5, 1, …, 5)",
    )
    ws.add_data_validation(dv_s)
    dv_s.add(skill_range)

    # 열 너비 / 고정
    ws.column_dimensions["A"].width = 12
    ws.column_dimensions["B"].width = 10
    ws.column_dimensions["C"].width = 8
    ws.column_dimensions["D"].width = 8   # 키
    for i in range(6):
        ws.column_dimensions[get_column_letter(LAYOUT["skill_start"] + i)].width = 12
    ws.column_dimensions[COL_LEVEL].width = 10
    ws.freeze_panes = f"{COL_SKILL_FIRST}4"  # 이름~키 열 + 헤더 고정

    return wb


def save(path: Path, rows: int = len(NAMES)) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    build_workbook(rows).save(path)
    return path
