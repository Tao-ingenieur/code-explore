#!/usr/bin/env python3
"""Audit configured package entries and report missing inputs without altering them."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT.parent / "dist"
OUTPUT = DIST / "output"
VALIDATION = DIST / "validation"
results = []
catalog = json.loads((DIST / "build/projects/catalog.json").read_text(encoding="utf-8"))
for descriptor in catalog["projects"]:
    package = OUTPUT / descriptor["id"]
    missing = []
    for entry in descriptor["entries"].values():
        if isinstance(entry, str) and not (package / entry).exists():
            missing.append(entry)
    source_count = None
    if descriptor["type"] != "comparison":
        source = package / descriptor["source"]["root"]
        manifest = json.loads((package / descriptor["entries"]["manifest"]).read_text(encoding="utf-8"))
        source_count = len(manifest["files"])
        missing += [str(Path(descriptor["source"]["root"]) / f["path"]) for f in manifest["files"] if not (source / f["path"]).is_file()]
    reports = {}
    for kind, relative in (descriptor.get("report") or {}).items():
        if kind not in {"pdf", "tex"} or not isinstance(relative, str):
            continue
        file = package / relative
        reports[kind] = file.is_file() and (kind != "pdf" or file.read_bytes().startswith(b"%PDF"))
        if not reports[kind]:
            missing.append(relative)
    results.append({"id": descriptor["id"], "manifestFiles": source_count, "reports": reports, "missing": missing})

result = {
    "scope": "package presence and report signatures; not semantic or browser verification",
    "status": "incomplete-inputs" if any(p["missing"] for p in results) else "passed",
    "packages": results,
}
VALIDATION.mkdir(parents=True, exist_ok=True)
(VALIDATION / "delivery-checks.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
for package in results:
    print(f"{package['id']}: {len(package['missing'])} missing; reports={package['reports']}")
print(result["status"])
raise SystemExit(1 if result["status"] != "passed" else 0)
