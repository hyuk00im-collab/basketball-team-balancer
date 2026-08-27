"""SPEC.md 형식의 샘플 엑셀을 파일로 저장한다 (backend/sample_sheet.py 의 CLI 래퍼).

사용법:
    python tools/make_sample_xlsx.py [출력경로] [인원수]

기본 출력: sample/basketball_level_sheet.xlsx (24명)
인원수 0 을 주면 데이터 없이 양식(헤더 + 예시행 + 수식)만 만듭니다.
웹 화면의 '샘플 파일 다운로드' 버튼은 같은 코드를 그대로 사용합니다.
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from sample_sheet import FILENAME, NAMES, save  # noqa: E402

if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "sample" / FILENAME
    rows = int(sys.argv[2]) if len(sys.argv) > 2 else len(NAMES)
    save(target, rows)
    print(f"saved: {target}  ({rows} members)")
