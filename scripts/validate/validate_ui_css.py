#!/usr/bin/env python3
import re
import sys
from pathlib import Path


FORBIDDEN = {
    "box-shadow": "shadows are forbidden",
    "text-shadow": "shadows are forbidden",
    "filter: blur": "blur is forbidden",
    "backdrop-filter": "blur is forbidden",
    "linear-gradient": "gradients are forbidden",
    "radial-gradient": "gradients are forbidden",
}


def main() -> int:
    paths = [Path(arg) for arg in sys.argv[1:]]
    if not paths:
        print("usage: validate_ui_css.py <css-file> [...]", file=sys.stderr)
        return 2

    failures: list[str] = []
    combined = ""
    for path in paths:
        text = path.read_text(encoding="utf-8")
        combined += text + "\n"
        for token, message in FORBIDDEN.items():
            if token in text:
                failures.append(f"{path}: {message}: {token}")
        for match in re.finditer(r"border-radius\s*:\s*([^;]+)", text):
            value = match.group(1).strip()
            if value not in {"var(--radius)", "0", "0px"}:
                failures.append(f"{path}: border-radius must use var(--radius) or 0")
    if "--surface" not in combined or "--ink" not in combined:
        failures.append("required theme tokens missing")

    if failures:
        print("\n".join(failures), file=sys.stderr)
        return 1

    print("UI CSS validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
