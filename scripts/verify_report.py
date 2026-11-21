#!/usr/bin/env python3
"""Compile-independent checks for all generated reports, including rendering."""
from __future__ import annotations
import json
from pathlib import Path
import re
import sys
import unicodedata
import fitz
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SUBMISSION = ROOT.parent / "dist" / "output"


def normalized(value: str) -> str:
    typography = value.translate(str.maketrans({"‘": "'", "’": "'", "“": '"', "”": '"'}))
    typography = re.sub(r"(?<=[A-Za-z])-\s*\n\s*(?=[A-Za-z])", "", typography)
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", typography))


def verify(project_id: str) -> dict:
    package = SUBMISSION / project_id
    descriptor = json.loads((package / "project.json").read_text(encoding="utf-8"))
    content = json.loads((package / descriptor["entries"]["content"]).read_text(encoding="utf-8"))
    compile_result = json.loads((package / "validation/report-compile.json").read_text(encoding="utf-8"))
    title = descriptor["report"]["title"]
    pdf_path = package / descriptor["report"]["pdf"]
    tex_path = package / descriptor["report"]["tex"]
    errors = []
    checks = []
    def check(condition, name, detail):
        if condition:
            checks.append({"name": name, "result": "passed", "detail": detail})
        else:
            errors.append(f"{name}：{detail}")
    check(pdf_path.exists() and pdf_path.read_bytes().startswith(b"%PDF"), "PDF 文件", str(pdf_path.relative_to(SUBMISSION)))
    check(tex_path.exists(), "TeX 源文件", str(tex_path.relative_to(SUBMISSION)))
    if errors:
        return {"project": project_id, "status": "failed", "errors": errors, "checks": checks}
    document = fitz.open(pdf_path)
    texts = [page.get_text() for page in document]
    all_text = normalized("\n".join(texts))
    check(not document.is_encrypted, "PDF 可读性", "未加密")
    check(document.metadata.get("title") == title, "PDF 元数据", f"标题为《{title}》，作者为空")
    check(document.page_count >= 10, "报告页数", f"{document.page_count} 页")
    check(all(len(text.strip()) >= 10 for text in texts), "空白页", "所有页面均有文本")
    check("�" not in "".join(texts), "文本编码", "未发现 U+FFFD")
    check(compile_result.get("overfullBoxWarnings") == 0, "排版警告", f"overfull={compile_result.get('overfullBoxWarnings')}")
    out = []
    for index, page in enumerate(document):
        for block in page.get_text("blocks"):
            x0, y0, x1, y1 = block[:4]
            if x0 < -1 or y0 < -1 or x1 > page.rect.width + 1 or y1 > page.rect.height + 1:
                out.append({"page": index + 1, "text": block[4][:100]})
    check(not out, "页面边界", "没有文本块越出 A4 页面" if not out else str(out[:5]))

    expected = []
    if descriptor["type"] == "comparison":
        body = content["comparison"]
        expected.append(("对比标题", body["title"]))
        for topic in body["topics"]:
            expected.extend([(f"主题 {topic['id']}", topic["title"]), (f"主题摘要 {topic['id']}", topic["summary"]), (f"差异 {topic['id']}", topic["difference"])])
        expected.extend([("场景任务", body["scenario"]["task"]), ("对比结论", body["conclusion"])])
    else:
        for chapter in content["chapters"]:
            expected.extend([(f"章节 {chapter['id']}", chapter["title"]), (f"摘要 {chapter['id']}", chapter["summary"])])
        for flow in content.get("flows") or [content["flow"]]:
            for step in flow["steps"]:
                expected.append((f"执行步骤 {step['id']}", step["title"]))
        if content.get("caseStudy"):
            expected.extend([("案例任务", content["caseStudy"]["task"]), ("案例结论", content["caseStudy"]["conclusion"])])
        for annotation in content["annotations"]:
            expected.append((f"核心符号 {annotation['path']}#{annotation['symbol']}", annotation["symbol"]))
        manifest = json.loads((package / descriptor["entries"]["manifest"]).read_text(encoding="utf-8"))
        for file in manifest["files"]:
            expected.append((f"文件索引 {file['path']}", file["path"]))
    expected.extend([("源码快照", content["project"]["source"]["snapshotSha256"]), ("内容版本", content["project"]["contentVersion"]), ("运行局限", content["project"]["source"]["runtimeNote"])])
    missing = [(name, value) for name, value in expected if normalized(value) not in all_text]
    check(not missing, "网站/PDF 同源", f"{len(expected)} 项同源字符串匹配" if not missing else str(missing[:10]))
    check(not re.search(r"(?:^|[\s\"'`(=])/(?:mnt|tmp|root|home)/", tex_path.read_text(encoding="utf-8"), re.M), "TeX 可移植性", "没有机器绝对路径")

    renders = package / "validation/report-renders"
    renders.mkdir(parents=True, exist_ok=True)
    selected = {0, 1, document.page_count - 1}
    for needle in ([content["comparison"]["topics"][0]["title"], content["comparison"]["scenario"]["title"]] if descriptor["type"] == "comparison" else [content["chapters"][0]["title"], content["flows"][0]["title"] if content.get("flows") else content["flow"]["title"]]):
        found = next((index for index, text in enumerate(texts) if index >= 4 and normalized(needle) in normalized(text)), None)
        if found is not None:
            selected.add(found)
    images = []
    for index in sorted(selected):
        pixmap = document[index].get_pixmap(matrix=fitz.Matrix(1.5, 1.5), alpha=False)
        target = renders / f"page-{index + 1:03d}.png"
        pixmap.save(target)
        images.append(target)
    thumbnails = []
    for target in images:
        image = Image.open(target).convert("RGB")
        image.thumbnail((520, 740))
        thumbnails.append((target, image.copy()))
    columns = 3
    rows = (len(thumbnails) + columns - 1) // columns
    sheet = Image.new("RGB", (columns * 550, rows * 790), "#eceee7")
    draw = ImageDraw.Draw(sheet)
    for index, (target, image) in enumerate(thumbnails):
        x = index % columns * 550 + 15
        y = index // columns * 790 + 30
        draw.text((x, 9 + index // columns * 790), target.stem, fill="#23332c")
        sheet.paste(image, (x, y))
    sheet.save(package / "validation/report-preview.png")
    check(len(images) >= 3, "PDF 渲染", f"已渲染 {len(images)} 页并生成预览")
    result = {
        "project": project_id, "status": "failed" if errors else "passed", "title": title, "pages": document.page_count,
        "sameSourceComparisons": len(expected), "missingComparisons": missing, "outOfBounds": out,
        "renderedPages": [index + 1 for index in sorted(selected)], "checks": checks, "errors": errors,
    }
    (package / "validation/report-checks.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return result


def main():
    ids = []
    if "--all" in sys.argv:
        for directory in sorted(SUBMISSION.iterdir()):
            if (directory / "project.json").exists():
                descriptor = json.loads((directory / "project.json").read_text(encoding="utf-8"))
                if descriptor.get("report"):
                    ids.append(descriptor["id"])
    else:
        if "--project" not in sys.argv or sys.argv.index("--project") + 1 >= len(sys.argv):
            raise ValueError("请通过 --project <项目标识> 或 --all 显式选择资料包。")
        ids = [sys.argv[sys.argv.index("--project") + 1]]
    results = [verify(project_id) for project_id in ids]
    for result in results:
        print(f"[{result['project']}] {result['status']}：{result.get('pages', 0)} 页，{result.get('sameSourceComparisons', 0)} 项同源检查")
        for error in result["errors"]:
            print(f"  错误：{error}", file=sys.stderr)
    if any(result["status"] == "failed" for result in results):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
