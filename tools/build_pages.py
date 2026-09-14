"""GitHub Pages 로 올릴 정적 사이트를 만든다.

서버 없이 브라우저에서 도는 버전이라, 프론트엔드와 함께 backend/*.py 도 그대로
복사한다. Pyodide 가 그 파일들을 받아 FastAPI 앱을 브라우저 안에서 실행한다.

사용법: python tools/build_pages.py [출력폴더]   (기본 site/)
"""

import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND_FILES = [
    "skills.py", "models.py", "ranking.py", "balancer.py",
    "evaluator.py", "parser.py", "sample_sheet.py",
    "quick_parser.py", "quick_sample_sheet.py",
    "main.py",
]


def build(out: Path) -> Path:
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)

    # 프론트엔드 전체
    shutil.copytree(ROOT / "frontend", out, dirs_exist_ok=True)

    # 브라우저에서 실행할 백엔드 코드
    backend_out = out / "backend"
    backend_out.mkdir()
    for name in BACKEND_FILES:
        shutil.copy2(ROOT / "backend" / name, backend_out / name)

    # Jekyll 처리를 끄지 않으면 _ 로 시작하는 경로가 무시된다
    (out / ".nojekyll").write_text("", encoding="utf-8")

    files = sorted(p.relative_to(out).as_posix() for p in out.rglob("*") if p.is_file())
    print(f"built: {out}  ({len(files)} files)")
    for f in files:
        print("  " + f)
    return out


if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "site"
    build(target)
