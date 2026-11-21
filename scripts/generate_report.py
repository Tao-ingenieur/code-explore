#!/usr/bin/env python3
"""Build the TeX/PDF report from the exact data consumed by the website."""

from __future__ import annotations

import datetime as dt
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
SUBMISSION = ROOT.parent / "dist" / "output"
DATA = Path()
REPORT = Path()
TEX_DIR = Path()
VALIDATION = Path()
PACKAGE_DIR = Path()
TITLE = ""
DESCRIPTOR: dict[str, Any] = {}


def load(name: str) -> Any:
    return json.loads((DATA / name).read_text(encoding="utf-8"))


manifest: dict[str, Any] = {}
content: dict[str, Any] = {}
project: dict[str, Any] = {}
references: dict[str, dict[str, Any]] = {}
chapters: list[dict[str, Any]] = []


def configure(project_id: str) -> None:
    global DATA, REPORT, TEX_DIR, VALIDATION, PACKAGE_DIR, TITLE, DESCRIPTOR
    global manifest, content, project, references, chapters
    PACKAGE_DIR = SUBMISSION / project_id
    DESCRIPTOR = json.loads((PACKAGE_DIR / "project.json").read_text(encoding="utf-8"))
    DATA = PACKAGE_DIR / "index"
    REPORT = PACKAGE_DIR / "report"
    TEX_DIR = REPORT / "tex"
    VALIDATION = PACKAGE_DIR / "validation"
    TITLE = DESCRIPTOR["report"]["title"]
    if DESCRIPTOR["type"] == "comparison":
        configure_comparison()
        return
    manifest = load("manifest.json")
    content = load("content.json")
    project = content["project"]
    references = {item["id"]: item for item in content["references"]}
    chapters = sorted(content["chapters"], key=lambda item: item["order"])


def configure_comparison() -> None:
    global manifest, content, project, references, chapters
    original = load("content.json")
    body = original["comparison"]
    binding = DESCRIPTOR["comparison"]
    names = {}
    for side in ("a", "b"):
        related_id = binding[f"project{side.upper()}"]
        related = json.loads((SUBMISSION / related_id / "project.json").read_text(encoding="utf-8"))
        names[side] = related.get("shortName") or related.get("name") or related_id
    converted_chapters = []
    for index, topic in enumerate(body["topics"], 1):
        sections = []
        for side in ("a", "b"):
            data = topic[side]
            blocks = [{"type": "p", "text": text} for text in data["implementation"]]
            if data["branches"]:
                blocks.append({"type": "list", "items": data["branches"]})
            sections.append({"id": f"project-{side}", "title": f"项目 {side.upper()} · {names[side]}", "lead": "双方实现分开陈述，不把功能相似写成实现相同。", "body": blocks, "evidence": data["evidence"]})
        sections.append({"id": "differences", "title": "差异、适用条件与未确定项", "lead": topic["difference"], "body": [{"type": "p", "text": topic["tradeoffs"]}, {"type": "callout", "tone": "runtime", "title": "无法由当前快照确定", "text": "；".join(topic["unknowns"])}], "evidence": []})
        converted_chapters.append({"id": topic["id"], "order": index, "kicker": "双项目架构对比", "title": topic["title"], "summary": topic["summary"], "scope": "deep", "sections": sections})
    def scenario_flow(side: str) -> dict[str, Any]:
        steps = []
        for index, step in enumerate(body["scenario"]["steps"], 1):
            evidence_id = step[f"{side}Evidence"][0]
            ref = next(item for item in original["references"] if item["id"] == evidence_id)
            related = binding[f"project{side.upper()}"]
            steps.append({"id": f"{side}-{index}", "title": step["stage"], "short": step["stage"], "description": step[f"{side}Text"], "path": ref["path"], "startLine": ref["start"], "endLine": ref["end"], "symbol": ref.get("symbol", "源码范围"), "sourceProject": related, "chapter": converted_chapters[0]["id"], "section": f"project-{side}", "inputs": "共享任务场景中的这一阶段", "outputs": "见该侧实际实现的后续状态", "branches": []})
        return {"id": f"scenario-{side}", "title": body["scenario"]["title"] + f" · 项目 {side.upper()}（{names[side]}）", "summary": body["scenario"]["task"] + "\n" + body["scenario"]["premise"], "steps": steps}
    content = {
        "chapters": converted_chapters,
        "references": original["references"],
        "flow": scenario_flow("a"),
        "flows": [scenario_flow("a"), scenario_flow("b")],
        "caseStudy": None,
        "comparisonConclusion": body["conclusion"],
        "annotations": [],
    }
    project = original["project"]
    references = {item["id"]: item for item in content["references"]}
    chapters = converted_chapters
    manifest = {"stats": {"files": 0, "totalLines": 0, "symbols": 0, "statusCounts": {"indexed": 0, "summary": 0, "deep": 0, "pending": 0}}, "files": [], "modules": []}

TEX_ESCAPES = {
    "\\": r"\textbackslash{}",
    "&": r"\&",
    "%": r"\%",
    "$": r"\$",
    "#": r"\#",
    "_": r"\_",
    "{": r"\{",
    "}": r"\}",
    "~": r"\textasciitilde{}",
    "^": r"\textasciicircum{}",
}


def tex(value: Any) -> str:
    text = re.sub(r"\s+", " ", str(value)).strip()
    escaped = "".join(TEX_ESCAPES.get(char, char) for char in text)
    # Permit clean line breaks inside long identifiers without changing their text.
    escaped = escaped.replace(r"\_", r"\_{\srcbreak}")
    escaped = re.sub(r"(?<=[./:=,;<>()\[\]-])", r"\\srcbreak ", escaped)
    escaped = re.sub(r"(?<=[a-z])(?=[A-Z])", r"\\srcbreak ", escaped)
    def break_hex(match: re.Match[str]) -> str:
        value = match.group(0)
        return r"\srcbreak ".join(value[index:index + 12] for index in range(0, len(value), 12))
    escaped = re.sub(r"(?<![A-Za-z0-9])([0-9a-fA-F]{24,})(?![A-Za-z0-9])", break_hex, escaped)
    return escaped


def mono(value: Any) -> str:
    return rf"\texttt{{\small {tex(value)}}}"


def source_location(ref: dict[str, Any]) -> str:
    return rf"\nolinkurl{{{ref['path']}:{ref['start']}-{ref['end']}}}"


def evidence(ids: list[str]) -> str:
    if not ids:
        return ""
    output = [r"\begin{evidenceblock}", r"\textbf{源码证据}\par"]
    for ref_id in ids:
        ref = references[ref_id]
        confidence = {"source": "源码事实", "inference": "分析推断", "runtime": "待运行验证"}[ref["confidence"]]
        symbol = f" · {mono(ref['symbol'])}" if ref.get("symbol") else ""
        side = f"项目 {ref['project']} · " if ref.get("project") else ""
        output.append(
            r"\noindent\textbf{" + confidence + r"}\quad " + side + tex(ref["claim"]) + r"\par"
            + r"{\footnotesize " + source_location(ref) + symbol + r"\par}\medskip"
        )
    output.append(r"\end{evidenceblock}")
    return "\n".join(output)


def block(item: dict[str, Any]) -> str:
    kind = item["type"]
    if kind == "p":
        return tex(item["text"]) + "\n"
    if kind == "list":
        environment = "enumerate" if item.get("ordered") else "itemize"
        rows = "\n".join(r"\item " + tex(value) for value in item["items"])
        return "\\begin{" + environment + "}\n" + rows + "\n\\end{" + environment + "}\n"
    if kind == "callout":
        colors = {"source": "factbg", "inference": "inferencebg", "runtime": "runtimebg", "warning": "runtimebg"}
        labels = {"source": "源码事实", "inference": "分析推断", "runtime": "待运行验证", "warning": "边界提醒"}
        return (
            rf"\begin{{callout}}{{{colors[item['tone']]}}}"
            rf"\textbf{{{tex(item['title'])}}}{{\footnotesize\hfill {labels[item['tone']]}}}\par"
            + tex(item["text"])
            + "\n" + rf"\end{{callout}}" + "\n"
        )
    if kind == "table":
        columns = item["columns"]
        width = 0.88 / max(1, len(columns))
        spec = "".join(r">{\raggedright\arraybackslash}p{" + f"{width:.3f}" + r"\textwidth}" for _ in columns)
        rows = [
            r"\begin{longtable}{@{} " + spec + r" @{}}",
            r"\toprule",
            " & ".join(r"\textbf{" + tex(value) + "}" for value in columns) + r" \\",
            r"\midrule\endfirsthead",
            r"\toprule",
            " & ".join(r"\textbf{" + tex(value) + "}" for value in columns) + r" \\",
            r"\midrule\endhead",
            r"\midrule\multicolumn{" + str(len(columns)) + r"}{r}{续下页}\\\endfoot",
            r"\bottomrule\endlastfoot",
        ]
        for values in item["rows"]:
            rows.append(" & ".join(tex(value) for value in values) + r" \\")
            rows.append(r"\addlinespace[2pt]")
        rows.append(r"\end{longtable}")
        return "\n".join(rows) + "\n"
    if kind == "code":
        label = rf"\textbf{{{tex(item['label'])}}}\par" if item.get("label") else ""
        return (
            label + r"\begin{Verbatim}[fontsize=\footnotesize,breaklines,breakanywhere,frame=leftline,rulecolor=\color{forest}]" + "\n"
            + item["text"].rstrip() + "\n" + r"\end{Verbatim}" + "\n"
        )
    raise ValueError(f"Unsupported block type: {kind}")


def source_excerpt(path: str, start: int, end: int, maximum: int = 8, project_id: str | None = None) -> str:
    package = SUBMISSION / (project_id or DESCRIPTOR["id"])
    descriptor = DESCRIPTOR if project_id is None or project_id == DESCRIPTOR["id"] else json.loads((package / "project.json").read_text(encoding="utf-8"))
    source = package / descriptor.get("source", {}).get("root", "source") / path
    if not source.exists():
        return ""
    lines = source.read_text(encoding="utf-8").splitlines()
    selected = []
    for number in range(start, min(end, start + maximum - 1, len(lines)) + 1):
        line = lines[number - 1]
        if len(line) > 240:
            line = line[:240] + " … [长行截断；原始文件未修改]"
        selected.append(f"{number:>5}  {line}")
    if end > start + maximum - 1:
        selected.append(f"       … 引用范围至第 {end} 行")
    return (
        r"\begin{Verbatim}[fontsize=\scriptsize,breaklines,breakanywhere,frame=leftline,rulecolor=\color{forest}]" + "\n"
        + "\n".join(selected) + "\n" + r"\end{Verbatim}"
    )


def build_tex() -> str:
    out: list[str] = []
    add = out.append
    add(r"""% Generated from content/*.json by scripts/generate_report.py.
% Compile with Tectonic 0.15+ or XeLaTeX. No absolute source paths are embedded.
\documentclass[10pt,a4paper]{article}
\usepackage{fontspec}
\usepackage{xeCJK}
\setmainfont{DejaVu Serif}
\setsansfont{DejaVu Sans}
\setmonofont{DejaVu Sans Mono}
\setCJKmainfont{Noto Serif CJK SC}
\setCJKsansfont{Noto Sans CJK SC}
\setCJKmonofont{Noto Sans Mono CJK SC}
\usepackage[a4paper,left=20mm,right=20mm,top=22mm,bottom=22mm]{geometry}
\usepackage{xcolor}
\usepackage{longtable,booktabs,array,tabularx}
\usepackage{enumitem}
\usepackage{fancyhdr}
\usepackage{titlesec}
\usepackage{framed}
\usepackage{fvextra}
\usepackage{xurl}
\usepackage{microtype}
\usepackage[unicode]{hyperref}
\newcommand{\srcbreak}{\discretionary{}{}{}}
\definecolor{forest}{HTML}{183A35}
\definecolor{paper}{HTML}{F7F7F2}
\definecolor{ink}{HTML}{1D2724}
\definecolor{secondary}{HTML}{525D57}
\definecolor{rule}{HTML}{DEDFD6}
\definecolor{factbg}{HTML}{EAF0E5}
\definecolor{inferencebg}{HTML}{F5EFDF}
\definecolor{runtimebg}{HTML}{F7EAE2}
\definecolor{codebg}{HTML}{F2F4ED}
\hypersetup{pdftitle={REPORT_TITLE},pdfsubject={源码执行链、机制解读与覆盖索引},pdfauthor={},pdfcreator={同源结构化报告生成器},colorlinks=true,linkcolor=forest,urlcolor=forest,pdfstartview=FitH}
\pagestyle{fancy}
\fancyhf{}
\fancyhead[L]{\small HEADER_TITLE}
\fancyhead[R]{\small analysis-CONTENT_VERSION}
\fancyfoot[C]{\small\thepage}
\renewcommand{\headrulewidth}{0.3pt}
\titleformat{\section}{\Large\bfseries\color{forest}}{\thesection}{0.8em}{}
\titleformat{\subsection}{\large\bfseries\color{forest}}{\thesubsection}{0.8em}{}
\titleformat{\subsubsection}{\normalsize\bfseries}{\thesubsubsection}{0.8em}{}
\titlespacing*{\section}{0pt}{18pt}{10pt}
\titlespacing*{\subsection}{0pt}{14pt}{7pt}
\makeatletter
\renewcommand*\l@subsection{\@dottedtocline{2}{1.5em}{3.4em}}
\renewcommand{\@pnumwidth}{2.5em}
\renewcommand{\@tocrmarg}{3.2em}
\makeatother
\setlist{leftmargin=2.2em,itemsep=3pt,topsep=4pt,parsep=2pt}
\setlength{\parindent}{2em}
\setlength{\parskip}{4pt}
\linespread{1.22}
\emergencystretch=2em
\sloppy
\newenvironment{callout}[1]{\def\FrameCommand{\color{forest}\vrule width 2pt \hspace{8pt}}\begin{framed}\color{ink}\small}{\end{framed}\par\medskip}
\newenvironment{evidenceblock}{\begin{framed}\small\color{secondary}\setlength{\parindent}{0pt}}{\end{framed}\par\medskip}
\renewcommand{\arraystretch}{1.25}
\setlength{\LTpre}{8pt}
\setlength{\LTpost}{8pt}
\begin{document}
\color{ink}
\begin{titlepage}
\pagecolor{forest}
\color{white}
\vspace*{35mm}
{\small SOURCE ATLAS · EVIDENCE-DRIVEN READING\par}
\vspace{14mm}
{\fontsize{31}{40}\selectfont\bfseries REPORT_TITLE\par}
\vspace{8mm}
{\Large 从项目资料，到可核查的源码证据\par}
\vspace{18mm}
{\large 章节 · 源码证据 · 执行路径 · 覆盖范围\par}
\vfill
\noindent\begin{minipage}{\textwidth}
\small
\makebox[28mm][l]{源码快照}\nolinkurl{SNAPSHOT_HASH}\par
\makebox[28mm][l]{内容版本}analysis-CONTENT_VERSION\par
\makebox[28mm][l]{静态分析日期}ANALYSIS_DATE\par
\makebox[28mm][l]{报告性质}RUNTIME_NOTE\par
\end{minipage}
\par\vspace{10mm}
\noindent\parbox{\textwidth}{\small 网站与本报告读取同一份结构化解读数据。}\par
\end{titlepage}
\pagecolor{paper}
\color{ink}
\setcounter{page}{1}
\section*{报告说明}
\addcontentsline{toc}{section}{报告说明}
""")
    add(r"\subsection*{项目定位与源码版本}")
    add(tex(project["source"]["label"]) + "。网站提供交互式定位；本报告使用相同的结构化分析数据，提供离线阅读与索引。\n")
    add(r"\begin{itemize}")
    if project["source"].get("commit"):
        add(r"\item Git 提交：" + mono(project["source"]["commit"]) + "。")
    add(r"\item 原始附件 SHA-256：\nolinkurl{" + project["source"]["snapshotSha256"] + "}。")
    add(r"\item 纳入范围为 " + mono(project["source"]["scope"]) + f"，共 {manifest['stats']['files']} 个文件、{manifest['stats']['totalLines']} 行；索引记录 {manifest['stats']['symbols']} 个符号。")
    add(r"\item " + tex(project["source"]["runtimeNote"]))
    add(r"\end{itemize}")
    add(r"\subsection*{方法与证据口径}")
    for method in project["method"]:
        add(r"\begin{itemize}\item " + tex(method) + r"\end{itemize}")
    add(r"\begin{longtable}{@{}p{24mm}p{135mm}@{}}")
    add(r"\textbf{标记} & \textbf{含义}\\\midrule")
    add("源码事实 & 可由所引执行语句、类型或返回分支直接核查；不表示已经运行。\\\\")
    add("分析推断 & 由多个源码位置组合出的解释，可能有运行时补救或其他路径。\\\\")
    add("待运行验证 & 依赖真实构建、外部服务、文件系统、时序或用户操作，静态阅读不能替代。\\\\")
    add(r"\end{longtable}")
    add(r"\tableofcontents\clearpage")

    for chapter in chapters:
        add(r"\section{第 " + f"{chapter['order']:02d}" + " 章 · " + tex(chapter["title"]) + "}")
        add(r"\noindent{\color{secondary}" + tex(chapter["kicker"]) + r" · " + ("深入分析" if chapter["scope"] == "deep" else "职责概述") + r"}\par\medskip")
        add(tex(chapter["summary"]) + "\n")
        for section in chapter["sections"]:
            add(r"\subsection{" + tex(section["title"]) + "}")
            if section.get("lead"):
                add(r"\noindent{\color{secondary}" + tex(section["lead"]) + r"}\par\medskip")
            for item in section["body"]:
                add(block(item))
            add(evidence(section["evidence"]))
        add(r"\clearpage")

    flows = content.get("flows") or [content["flow"]]
    for flow in flows:
        add(r"\section{" + tex(flow["title"]) + "}")
        add(tex(flow["summary"]))
        add(r"\begin{framed}\small 每一个步骤都关联真实文件、符号、行号与机制章节；分支描述代码可达路径，不是实际运行日志。\end{framed}")
        for index, step in enumerate(flow["steps"], 1):
            add(r"\subsection{步骤 " + f"{index:02d}" + " · " + tex(step["title"]) + "}")
            add(tex(step["description"]))
            add(r"\begin{longtable}{@{}p{22mm}p{140mm}@{}}")
            add("进入时 & " + tex(step["inputs"]) + r"\\")
            add("向后传递 & " + tex(step["outputs"]) + r"\\")
            add("实现位置 & " + mono(step["symbol"]) + " · " + source_location({"path": step["path"], "start": step["startLine"], "end": step["endLine"]}) + r"\\")
            add("关联章节 & " + tex(next(chapter["title"] for chapter in chapters if chapter["id"] == step["chapter"])) + " / " + tex(step["section"]) + r"\\")
            add(r"\end{longtable}")
            add(source_excerpt(step["path"], step["startLine"], step["endLine"], project_id=step.get("sourceProject")))
            if step["branches"]:
                add(r"\subsubsection*{成功与替代路径}")
                for branch in step["branches"]:
                    ref = references[branch["evidence"]]
                    add(r"\begin{framed}\small\textbf{" + tex(branch["label"]) + r"}\quad" + mono(branch["condition"]) + r"\par" + tex(branch["outcome"]) + r"\par{\footnotesize " + source_location(ref) + r"}\end{framed}")

    study = content.get("caseStudy")
    if study:
        add(r"\clearpage\section{贯穿案例：" + tex(study["title"]) + "}")
        add(r"\begin{framed}\textbf{假设的用户输入}\par\large“" + tex(study["task"]) + r"”\end{framed}")
        add(r"\begin{callout}{runtimebg}\textbf{案例前提与验证范围}\par" + tex(study["premise"]) + r"\end{callout}")
        for step in study["steps"]:
            add(r"\subsection{" + tex(step["stage"] + " · " + step["title"]) + "}")
            add(tex(step["narrative"]))
            add(r"\begin{framed}\small\textbf{案例观察}：" + tex(step["observation"]) + r"\end{framed}")
            add(evidence(step["evidence"]))
        add(r"\subsection{成功之外的替代路径}")
        for branch in study["alternatives"]:
            ref = references[branch["evidence"]]
            add(r"\begin{framed}\small\textbf{" + tex(branch["label"]) + r"}\quad" + mono(branch["condition"]) + r"\par" + tex(branch["outcome"]) + r"\par{\footnotesize " + source_location(ref) + r"}\end{framed}")
        add(r"\subsection{案例结论}")
        add(tex(study["conclusion"]))

    if DESCRIPTOR["type"] != "comparison":
        add(r"\clearpage\section{覆盖统计、范围与排除项}")
        status_names = {"indexed": "已索引", "summary": "已概述", "deep": "已深入分析", "pending": "待验证"}
        add(r"\subsection{覆盖状态}")
        add(r"\begin{longtable}{@{}p{30mm}p{25mm}p{100mm}@{}}状态 & 文件数 & 口径\\\midrule")
        descriptions = {
            "indexed": "自动清单、符号与静态关系，不声称人工分析。",
            "summary": "有人工职责概述，未展开全部分支。",
            "deep": "核心机制有连贯解释与行号证据。",
            "pending": "已有分析，但仍有明确待验证事项。",
        }
        for status in ("indexed", "summary", "deep", "pending"):
            add(f"{status_names[status]} & {manifest['stats']['statusCounts'][status]} & {tex(descriptions[status])}\\\\")
        add(r"\end{longtable}")
        add(r"\subsection{排除、重复与静态关系边界}")
        for policy in project["policies"]:
            add(r"\begin{itemize}\item " + tex(policy) + r"\end{itemize}")
        for exclusion in project["exclusions"]:
            add(r"\begin{framed}\small" + mono(exclusion["path"]) + " · " + tex(exclusion["reason"]) + r"\end{framed}")
        if project["source"].get("duplicateGroups"):
            duplicate_paths = [path for group in project["source"]["duplicateGroups"] for path in group]
            add(f"检测到 {len(project['source']['duplicateGroups'])} 组重复内容，共 {len(duplicate_paths)} 个文件。它们全部保留并索引，未据此推断生成方式或调用关系。")
        add(r"\subsection{模块与目录地图}")
        add(r"\scriptsize\begin{longtable}{@{}p{25mm}p{38mm}p{13mm}p{16mm}p{50mm}@{}}模块 & 目录 & 文件 & 源码行 & 职责\\\midrule\endhead")
        for module in manifest["modules"]:
            add(" & ".join([tex(module["label"]), mono(module["path"]), str(module["files"]), str(module["lines"]), tex(module["description"])]) + r"\\")
        add(r"\end{longtable}\normalsize")

        add(r"\clearpage\section{核心函数与符号索引}")
        add("以下索引只列已绑定人工解读的核心符号。完整符号搜索保留在网站中；进入条目可沿章节阅读输入、状态、分支和边界。\n")
        add(r"\scriptsize\begin{longtable}{@{}p{48mm}p{47mm}p{16mm}p{40mm}@{}}文件与定义行 & 符号 & 类型 & 解读章节\\\toprule\endfirsthead\toprule文件与定义行 & 符号 & 类型 & 解读章节\\\midrule\endhead")
        for annotation in content["annotations"]:
            symbol_id = annotation.get("symbolId") or ""
            symbols = json.loads((DATA / "symbols" / f"{annotation['path']}.json").read_text(encoding="utf-8"))
            symbol = next(item for item in symbols if item["id"] == symbol_id)
            line = symbol["startLine"]
            chapter = next(item for item in chapters if item["id"] == annotation["chapter"])
            add(r"\nolinkurl{" + annotation["path"] + ":" + str(line) + "} & " + mono(annotation["symbol"]) + " & " + tex(symbol["kind"]) + " & " + tex(chapter["title"] + " / " + annotation["section"]) + r"\\")
        add(r"\end{longtable}\normalsize")

        add(r"\clearpage\section{未验证事项}")
        add(tex(project["source"]["runtimeNote"]) + "\n")
        add("以下是文件中显式登记的未验证问题。它们是后续实验计划，不是已经通过的测试，也不意味着已经观察到对应故障。\n")
        add(r"\begin{longtable}{@{}p{60mm}p{100mm}@{}}文件 & 未验证事项\\\toprule\endfirsthead\toprule文件 & 未验证事项\\\midrule\endhead")
        for file in manifest["files"]:
            for question in file.get("unresolved", []):
                add(r"\nolinkurl{" + file["path"] + "} & " + tex(question) + r"\\")
        add(r"\end{longtable}")

        add(r"\clearpage\section{全文件覆盖索引}")
        add(f"本索引覆盖纳入范围的全部 {manifest['stats']['files']} 个文件。路径、模块、状态、物理行数和符号数来自生成清单；逐文件用途、依赖、哈希与完整符号资料请使用网站。自动归类用途不代表深入分析。\n")
        add(r"\scriptsize\begin{longtable}{@{}>{\raggedright\arraybackslash}p{68mm}>{\raggedright\arraybackslash}p{25mm}>{\raggedright\arraybackslash}p{18mm}>{\raggedleft\arraybackslash}p{13mm}>{\raggedleft\arraybackslash}p{13mm}@{}}")
        add(r"\textbf{路径} & \textbf{模块} & \textbf{状态} & \textbf{行数} & \textbf{符号}\\\toprule\endfirsthead")
        add(r"\textbf{路径} & \textbf{模块} & \textbf{状态} & \textbf{行数} & \textbf{符号}\\\midrule\endhead")
        add(r"\midrule\multicolumn{5}{r}{续下页}\\\endfoot\bottomrule\endlastfoot")
        for file in manifest["files"]:
            add(r"\nolinkurl{" + file["path"] + "} & " + tex(file["moduleLabel"]) + " & " + status_names[file["status"]] + f" & {file['lines']} & {file['symbolCount']}" + r"\\")
        add(r"\end{longtable}\normalsize")

    else:
        add(r"\clearpage\section{双方资料绑定与对比边界}")
        binding = DESCRIPTOR["comparison"]
        add("本报告只比较明确绑定的两个项目快照。对比资料不包含双方源码副本；每个证据都通过项目标识与快照身份解析。\n")
        add(r"\begin{longtable}{@{}p{30mm}p{125mm}@{}}项目 & 快照绑定\\\midrule")
        add("项目 A & " + tex(binding["projectA"] + " · " + binding["snapshotA"]) + r"\\")
        add("项目 B & " + tex(binding["projectB"] + " · " + binding["snapshotB"]) + r"\\")
        add(r"\end{longtable}")
        add("对比主题是人工静态复核结果，不自动生成任意项目之间的架构结论。缺失源码或运行验证不被改写为原产品缺少能力，也不据此宣布某一方更先进或更安全。\n")
        add(r"\subsection{对比结论}")
        add(tex(content["comparisonConclusion"]))
    add(r"\vfill\begin{center}{\small 内容版本 analysis-CONTENT_VERSION · 快照 SNAPSHOT_SHORT · 网站与 PDF 同源}\end{center}")
    add(r"\end{document}")
    document = "\n".join(out)
    replacements = {
        "HEADER_TITLE": tex("双项目架构对比" if DESCRIPTOR["type"] == "comparison" else TITLE),
        "REPORT_TITLE": tex(TITLE),
        "CONTENT_VERSION": tex(project["contentVersion"]),
        "SNAPSHOT_HASH": project["source"]["snapshotSha256"],
        "SNAPSHOT_SHORT": project["source"]["snapshotSha256"][:12],
        "ANALYSIS_DATE": tex(project["analysisDate"]),
        "RUNTIME_NOTE": tex(project["source"]["runtimeNote"]),
    }
    for key, value in replacements.items():
        document = document.replace(key, value)
    document = re.sub(r"\\par(?!indent\b|skip\b|box\b)(?=[^\s\\{}])", r"\\par{}", document)
    document = re.sub(r"(\\[A-Za-z]+)(?=[㐀-鿿])", r"\1{}", document)
    return document


def compile_report(tex_file: Path) -> tuple[Path, str, str]:
    tectonic = os.environ.get("TECTONIC") or shutil.which("tectonic")
    xelatex = shutil.which("xelatex")
    if not tectonic and not xelatex:
        raise RuntimeError("未找到 TeX 编译器。请安装 Tectonic 0.15+ 或 XeLaTeX，并安装 Noto CJK 与 DejaVu 字体。")
    timestamp = int(dt.datetime.fromisoformat(project["analysisDate"]).replace(tzinfo=dt.timezone.utc).timestamp())
    env = os.environ.copy()
    env.update({"SOURCE_DATE_EPOCH": str(timestamp), "TZ": "UTC", "NO_COLOR": "1"})
    with tempfile.TemporaryDirectory(prefix="agent-report-") as temporary:
        build = Path(temporary)
        if tectonic:
            command = [tectonic, "--keep-logs", "--print", "--outdir", str(build), str(tex_file)]
            compiler = f"Tectonic ({tectonic})"
        else:
            command = [xelatex, "-interaction=nonstopmode", "-halt-on-error", "-output-directory", str(build), str(tex_file)]
            compiler = f"XeLaTeX ({xelatex})"
        completed = subprocess.run(command, cwd=SUBMISSION, env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=600)
        if completed.returncode != 0 and xelatex and tectonic:
            command = [xelatex, "-interaction=nonstopmode", "-halt-on-error", "-output-directory", str(build), str(tex_file)]
            compiler = f"XeLaTeX fallback ({xelatex})"
            completed = subprocess.run(command, cwd=SUBMISSION, env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=600)
        if not tectonic and completed.returncode == 0:
            completed = subprocess.run(command, cwd=SUBMISSION, env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=600)
        log = completed.stdout + "\n"
        log_file = build / "main.log"
        if log_file.exists():
            log += log_file.read_text(encoding="utf-8", errors="replace")
        log = log.replace(str(ROOT), "<repo>").replace(str(SUBMISSION), "<packages>").replace(str(build), "<build>")
        log = re.sub(r"(?<![:\w])/(?:usr|home|root|tmp|private|mnt)/[^\s`]+", "<system-path>", log)
        pdf = build / "main.pdf"
        if completed.returncode != 0 or not pdf.exists():
            (VALIDATION / "report-build.log").write_text(log, encoding="utf-8")
            raise RuntimeError(f"TeX 编译失败（exit {completed.returncode}），详见 validation/report-build.log")
        destination = REPORT / f"{TITLE}.pdf"
        shutil.copyfile(pdf, destination)
        return destination, compiler, log


def build_one(project_id: str) -> None:
    configure(project_id)
    TEX_DIR.mkdir(parents=True, exist_ok=True)
    VALIDATION.mkdir(parents=True, exist_ok=True)
    tex_file = TEX_DIR / "main.tex"
    tex_file.write_text(build_tex(), encoding="utf-8")
    print(f"TeX 已生成：{tex_file.relative_to(SUBMISSION)}")
    destination, compiler, log = compile_report(tex_file)
    (VALIDATION / "report-build.log").write_text(log, encoding="utf-8")
    overfull = len(re.findall(r"Overfull \\[hv]box", log))
    metadata = {
        "status": "compiled",
        "project": project_id,
        "compiler": re.sub(r"\(.*\)", "(path omitted)", compiler).strip(),
        "contentVersion": project["contentVersion"],
        "sourceSnapshot": project["source"]["snapshotSha256"],
        "pdf": destination.name,
        "bytes": destination.stat().st_size,
        "tex": "report/tex/main.tex",
        "overfullBoxWarnings": overfull,
    }
    (VALIDATION / "report-compile.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"PDF 已生成：{destination.name}（{destination.stat().st_size / 1024 / 1024:.2f} MiB）")
    print(f"编译器：{metadata['compiler']}；overfull 警告 {overfull}。")


def main() -> int:
    if "--all" in sys.argv:
        for directory in sorted(SUBMISSION.iterdir()):
            descriptor_path = directory / "project.json"
            if not directory.is_dir() or not descriptor_path.exists():
                continue
            descriptor = json.loads(descriptor_path.read_text(encoding="utf-8"))
            if descriptor.get("report"):
                build_one(descriptor["id"])
        return 0
    if "--project" not in sys.argv or sys.argv.index("--project") + 1 >= len(sys.argv):
        raise ValueError("请通过 --project <项目标识> 或 --all 显式选择资料包。")
    project_id = sys.argv[sys.argv.index("--project") + 1]
    build_one(project_id)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"报告生成失败：{error}", file=sys.stderr)
        raise
