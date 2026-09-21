from __future__ import annotations

import json
import re
import sqlite3
import sys
from pathlib import Path

import ctranslate2
from argostranslate import package


FIELDS = (
    "description",
    "health_haz",
)


def clean(value: str | None) -> str:
    return re.sub(r"\n{3,}", "\n\n", re.sub(r"[ \t]+", " ", (value or "").replace("\r", ""))).strip()


def chunks(value: str, maximum: int = 420) -> list[str]:
    parts: list[str] = []
    for paragraph in re.split(r"\n+", clean(value)):
        sentences = re.split(r"(?<=[.!?])\s+(?=[A-Z0-9])", paragraph)
        for sentence in sentences:
            sentence = sentence.strip()
            while len(sentence) > maximum:
                cut = sentence.rfind(" ", 0, maximum)
                if cut < maximum // 2:
                    cut = maximum
                parts.append(sentence[:cut].strip())
                sentence = sentence[cut:].strip()
            if sentence:
                parts.append(sentence)
    return parts


def main() -> None:
    if len(sys.argv) != 4:
        raise SystemExit("usage: translate-cameo-locally.py SQLITE TRANSLATION_CACHE TSV")
    database_path, cache_path, tsv_path = map(Path, sys.argv[1:])
    cache = json.loads(cache_path.read_text(encoding="utf-8-sig"))
    con = sqlite3.connect(database_path)
    unique_un = {
        line.split("\t")[1].zfill(4)
        for line in tsv_path.read_text(encoding="utf-8-sig").splitlines()[1:]
        if len(line.split("\t")) > 1
    }
    fields: list[str] = []
    for un in sorted(unique_un):
        rows = con.execute(
            f"select {','.join('c.' + field for field in FIELDS)} "
            "from chemical_unna cu join chemicals c on c.id=cu.chem_id where cu.unna_id=? order by cu.sort,c.name",
            (int(un),),
        ).fetchall()
        if len(rows) != 1:
            continue
        for value in rows[0]:
            value = clean(value)
            if value and value not in cache:
                fields.append(value)
    fields = list(dict.fromkeys(fields))
    installed = [item for item in package.get_installed_packages() if item.from_code == "en" and item.to_code == "ru"]
    if not installed:
        raise RuntimeError("Argos English-Russian package is not installed")
    pkg = installed[0]
    translator = ctranslate2.Translator(str(pkg.package_path / "model"), device="cpu", compute_type="int8", inter_threads=2)
    split_fields = [chunks(value) for value in fields]
    unique_parts = list(dict.fromkeys(part for field in split_fields for part in field))
    translated_parts: dict[str, str] = {}
    batch_size = 192
    for offset in range(0, len(unique_parts), batch_size):
        batch = unique_parts[offset: offset + batch_size]
        tokenized = [pkg.tokenizer.encode(part) for part in batch]
        results = translator.translate_batch(tokenized, replace_unknowns=True, max_batch_size=64, batch_type="tokens", beam_size=1, num_hypotheses=1)
        for source, result in zip(batch, results):
            translated_parts[source] = clean(pkg.tokenizer.decode(result.hypotheses[0]))
        if offset % (batch_size * 10) == 0:
            print(f"{min(offset + batch_size, len(unique_parts))}/{len(unique_parts)} fragments", flush=True)
    for source, parts in zip(fields, split_fields):
        cache[source] = clean(" ".join(translated_parts[part] for part in parts))
    cache_path.write_text(json.dumps(cache, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"translatedFields": len(fields), "translatedFragments": len(unique_parts), "cacheEntries": len(cache)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
