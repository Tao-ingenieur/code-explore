#!/usr/bin/env python3
"""Extract Python symbols with ast.parse only; never import or execute project code."""
import ast
import json
from pathlib import Path
import sys

root = Path(sys.argv[1]).resolve()
result = {}
for file in sorted(root.rglob("*.py")):
    relative = file.relative_to(root).as_posix()
    try:
        text = file.read_text(encoding="utf-8")
        tree = ast.parse(text, filename=relative)
    except (UnicodeError, SyntaxError) as error:
        result[relative] = {"symbols": [], "parseErrors": [{"line": getattr(error, "lineno", 1) or 1, "message": str(error)}]}
        continue
    symbols = []
    def visit(node, prefix=""):
        for child in getattr(node, "body", []):
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                qualified = f"{prefix}.{child.name}" if prefix else child.name
                kind = "class" if isinstance(child, ast.ClassDef) else "function"
                if prefix and kind == "function":
                    kind = "method"
                symbols.append({
                    "id": f"{relative}#{qualified}@{child.lineno}",
                    "name": child.name,
                    "qualifiedName": qualified,
                    "kind": kind,
                    "path": relative,
                    "startLine": child.lineno,
                    "endLine": getattr(child, "end_lineno", child.lineno),
                    "exported": not child.name.startswith("_"),
                    "async": isinstance(child, ast.AsyncFunctionDef),
                    "extractor": "python-ast",
                })
                if isinstance(child, ast.ClassDef):
                    visit(child, qualified)
    visit(tree)
    result[relative] = {"symbols": symbols, "parseErrors": []}
print(json.dumps(result, ensure_ascii=False))
