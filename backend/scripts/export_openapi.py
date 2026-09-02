import json
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = Path(__file__).resolve().parents[2]
OUT_PATH = REPO_ROOT / "docs" / "openapi.json"


def main() -> None:
    sys.path.insert(0, str(PROJECT_ROOT))
    from app.main import app

    spec = app.openapi()
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)

    OUT_PATH.write_text(
        json.dumps(spec, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    print(OUT_PATH)


if __name__ == "__main__":
    main()
