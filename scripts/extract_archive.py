#!/usr/bin/env python3
"""Safely extract an input archive without executing or overwriting source files."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
from zipfile import ZipFile

parser = argparse.ArgumentParser()
parser.add_argument("archive")
parser.add_argument("--output", required=True, help="Empty directory for original source files")
parser.add_argument("--manifest", help="Extraction manifest outside source root")
args = parser.parse_args()
archive = Path(args.archive).resolve()
output = Path(args.output).resolve()
if output.exists() and any(output.iterdir()):
    raise SystemExit("输出目录非空；拒绝覆盖。请选择新的空目录。")
output.mkdir(parents=True, exist_ok=True)
manifest_path = Path(args.manifest).resolve() if args.manifest else output.parent / "import-manifest.json"
if output == archive or output in archive.parents:
    raise SystemExit("输出目录不能覆盖输入压缩包。")
manifest = {
    "archiveName": archive.name,
    "archiveSha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
    "files": [], "symlinks": [], "skipped": [],
}
with ZipFile(archive) as zipped:
    entries = zipped.infolist()
    if len(entries) > 100_000 or sum(item.file_size for item in entries) > 2_000_000_000:
        raise SystemExit("条目数或解压后体积超过安全上限。")
    for info in entries:
        relative = PurePosixPath(info.filename)
        mode = (info.external_attr >> 16) & 0o170000
        if relative.is_absolute() or ".." in relative.parts or "\\" in info.filename:
            raise SystemExit(f"不安全的归档路径：{info.filename}")
        target = (output / relative).resolve()
        if output != target and output not in target.parents:
            raise SystemExit(f"路径越出解包目录：{info.filename}")
        if info.flag_bits & 1:
            manifest["skipped"].append({"path": str(relative), "reason": "encrypted entry"})
            continue
        if info.is_dir():
            target.mkdir(parents=True, exist_ok=True)
            continue
        if info.file_size > 300_000_000 or info.file_size / max(info.compress_size, 1) > 200:
            manifest["skipped"].append({"path": str(relative), "reason": "abnormal size or compression ratio"})
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        if mode == 0o120000:
            link = zipped.read(info).decode("utf-8")
            resolved = (target.parent / link).resolve()
            if output not in resolved.parents and resolved != output:
                manifest["skipped"].append({"path": str(relative), "target": link, "reason": "symlink escapes extraction root"})
                continue
            target.symlink_to(link)
            manifest["symlinks"].append({"path": str(relative), "target": link})
        elif mode in (0, 0o100000):
            data = zipped.read(info)
            target.write_bytes(data)
            manifest["files"].append({"path": str(relative), "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
        else:
            manifest["skipped"].append({"path": str(relative), "reason": f"special entry mode {oct(mode)}"})
for link in output.rglob("*"):
    if link.is_symlink() and output not in link.resolve().parents:
        raise SystemExit(f"符号链接链越界：{link}")
manifest["regularFiles"] = len(manifest["files"])
manifest["safeSymlinks"] = len(manifest["symlinks"])
manifest_path.parent.mkdir(parents=True, exist_ok=True)
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"安全解包完成：{manifest['regularFiles']} 个普通文件，{manifest['safeSymlinks']} 个内部链接，跳过 {len(manifest['skipped'])} 项。")
print(f"清单：{manifest_path}")
