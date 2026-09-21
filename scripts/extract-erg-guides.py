from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from pypdf import PdfReader


def clean(text: str) -> str:
    text = text.replace("\ufffd", "-").replace("\u2022", "-")
    text = re.sub(r"\r", "", text)
    text = re.sub(r"Page\s+\d+", "", text, flags=re.IGNORECASE)
    text = re.sub(r"ERG\s+2024", "", text, flags=re.IGNORECASE)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def section(text: str, start: str, endings: list[str]) -> str:
    match = re.search(start, text, flags=re.IGNORECASE)
    if not match:
        return ""
    tail = text[match.end():]
    positions = []
    for ending in endings:
        candidate = re.search(ending, tail, flags=re.IGNORECASE)
        if candidate:
            positions.append(candidate.start())
    if positions:
        tail = tail[: min(positions)]
    return clean(tail)


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: extract-erg-guides.py INPUT_DIRECTORY OUTPUT_JSON")
    source = Path(sys.argv[1])
    output = Path(sys.argv[2])
    records = []
    for pdf in sorted(source.glob("Guide_*.pdf")):
        guide = int(pdf.stem.split("_")[-1])
        raw = "\n".join((page.extract_text() or "") for page in PdfReader(pdf).pages)
        raw = clean(raw)
        heading = re.search(r"GUIDE\s+(.+?)\s+%d\b" % guide, raw, flags=re.IGNORECASE | re.DOTALL)
        title = clean(heading.group(1)) if heading else f"Guide {guide}"
        records.append({
            "guide": guide,
            "title": title,
            "health": section(raw, r"(?m)^HEALTH\s*$", [r"(?m)^FIRE OR EXPLOSION\s*$", r"(?m)^PUBLIC SAFETY\s*$"]),
            "fireExplosion": section(raw, r"(?m)^FIRE OR EXPLOSION\s*$", [r"(?m)^HEALTH\s*$", r"(?m)^PUBLIC SAFETY\s*$"]),
            "publicSafety": section(raw, r"(?m)^PUBLIC SAFETY\s*$", [r"(?m)^PROTECTIVE CLOTHING\s*$"]),
            "protectiveClothing": section(raw, r"(?m)^PROTECTIVE CLOTHING\s*$", [r"(?m)^EVACUATION\s*$"]),
            "evacuation": section(raw, r"(?m)^EVACUATION\s*$", [r"(?m)^EMERGENCY RESPONSE\s*$"]),
            "fireResponse": section(raw, r"(?m)^EMERGENCY RESPONSE\s+FIRE\s*$", [r"(?m)^SPILL OR LEAK\s*$"]),
            "spillLeak": section(raw, r"(?m)^SPILL OR LEAK\s*$", [r"(?m)^FIRST AID\s*$"]),
            "firstAid": section(raw, r"(?m)^FIRST AID\s*$", []),
        })
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"guides": len(records), "output": str(output)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
