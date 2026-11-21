# 对比资料包生成提示词（Code Explore / 源码导航）

把本提示词、项目 A 的源码 ZIP、项目 B 的源码 ZIP 交给能读写文件的 AI。还需要两个已分析项目的 project.json；若从网站选定 A/B 后复制提示词，末尾会自动附带这两份描述。ZIP 是交给 AI 的输入，网站最终打开的是生成后的目录，无需压缩。

下面是可直接交给 AI 的完整任务。

## 任务

根据两份实际源码，生成一份可被 Code Explore 读取的独立专题对比资料包。面向有编程基础的读者，说明相同任务在双方如何实现、分支与失败行为有何不同、各自取舍与无法验证的边界。只生成资料，不修改两份源码；不需要编写网站，也不需要外部数据库或 LLM 接口。对比包无需复制双方源码、符号索引或单项目报告。

输出到 dist/output/<comparison-id>/；若用户指定其他位置则遵从该位置。交付一个可直接选择打开的目录，至少包含 project.json、index/content.json、index/search.json。无需 ZIP，无需 PDF；报告可选，未生成时 report 必须为 null。

## 输入身份与证据

1. 必须从用户给出的两份 project.json 或本提示词末尾的元数据读取 projectA.id、projectB.id 及双方 snapshot.id，不得按名称猜测。没有元数据时先索取，不能编造绑定。
2. 核对 ZIP 与所绑定的源码快照。优先核验 archiveSha256；若原资料采用不同封装，需根据原清单逐文件核对，不能仅凭目录名断言同版本。无法核实则说明缺什么，不得产出假装匹配的最终包。
3. 所有路径均与对应项目文件索引中的 path 一致，不含 source.root 前缀、绝对路径或解压外包装目录。项目 A/B 的角色与输入顺序一致。
4. 重要结论必须附源码证据：路径、1 起始物理行号 start/end、claim、confidence。confidence 只允许 source（源码事实）、inference（分析推断）、runtime（待运行验证）。runtime 不表示测试已通过。未执行检查不得写为通过。
5. 核心主题按实际代码确定；可比较入口、配置、模型调用、主循环、工具权限与调度、上下文、持久化、并发取消、扩展等。不存在的能力明确说明，不硬套 Agent 概念。非 Agent 项目应选择相应领域的主题。
6. 每个主题分别解释 A/B 实现及关键分支，再说明 difference、tradeoffs 和 unknowns。不得只列函数名或用通用知识代替源码分析。
7. 选择一个双方均可合理讨论的任务，给出并排执行场景，包括成功以及失败、拒绝或取消路径；静态走查必须明确标为静态推演。

## project.json 格式

下面是字段齐全的示意模板。示例 ID、哈希、名称、日期须替换为真实信息；projectA/projectB 和 snapshotA/snapshotB 必须原样使用输入项目描述的值。

```json
{
  "schemaVersion": 2,
  "id": "comparison-a-b",
  "name": "项目 A 与项目 B 的实现对比",
  "shortName": "A / B 对比",
  "type": "comparison",
  "contentVersion": "1.0.0",
  "analysisLevel": "comparison",
  "snapshot": {
    "id": "comparison:REPLACE_WITH_64_HEX_SHA256",
    "version": null,
    "commit": null,
    "archiveSha256": "REPLACE_WITH_64_HEX_SHA256",
    "treeSha256": null,
    "suppliedFiles": 0,
    "includedFiles": 0
  },
  "comparison": {
    "projectA": "project-a",
    "projectB": "project-b",
    "snapshotA": "COPY_PROJECT_A_SNAPSHOT_ID",
    "snapshotB": "COPY_PROJECT_B_SNAPSHOT_ID"
  },
  "source": {
    "root": "",
    "defaultFile": "",
    "language": "专题对比资料",
    "licenseNote": "遵循双方源码的原始许可与来源说明。"
  },
  "entries": {
    "manifest": "",
    "content": "index/content.json",
    "search": "index/search.json",
    "symbols": ""
  },
  "report": null,
  "features": ["comparison"],
  "analysisDate": "YYYY-MM-DD"
}
```

id 只能包含小写字母、数字和连字符，并以字母或数字开头；不能与两个源码项目或已有服务器项目 ID 重复。目录名应与 id 一致。对比包自己的快照标识可使用对 comparison 正文与 references 进行稳定 JSON 序列化后的 SHA-256，snapshot.archiveSha256 记录该摘要，snapshot.id 为 comparison: 加摘要。不得将该摘要冒充任一源码 ZIP 的摘要。

## index/content.json 格式

字段名、大小写和数组结构必须遵守下列模板。package 应填入完整 project.json 对象，不使用字符串代替。references 是全局证据表，主题和场景通过 ID 引用；project 必须为大写 A 或 B。sections、flows 等空数组不代表完成额外分析。

```json
{
  "schemaVersion": 2,
  "projectId": "comparison-a-b",
  "snapshotId": "comparison:REPLACE_WITH_64_HEX_SHA256",
  "package": {},
  "project": {
    "title": "项目 A 与项目 B 的实现对比",
    "subtitle": "基于固定源码快照的静态对比",
    "contentVersion": "1.0.0",
    "analysisDate": "YYYY-MM-DD",
    "method": ["逐项核对引用与控制流，区分事实、推断和待验证行为。"],
    "exclusions": [],
    "policies": ["未执行的测试不写为通过。"]
  },
  "chapters": [],
  "references": [
    {"id":"a-entry","project":"A","path":"src/main.ts","start":1,"end":10,"label":"A 的入口","claim":"请替换为这段源码直接支持的具体结论。","confidence":"source"},
    {"id":"b-entry","project":"B","path":"src/main.ts","start":1,"end":10,"label":"B 的入口","claim":"请替换为这段源码直接支持的具体结论。","confidence":"source"}
  ],
  "comparison": {
    "title": "项目 A 与项目 B 的实现对比",
    "topics": [
      {
        "id":"startup",
        "title":"启动与入口",
        "summary":"用实际源码解释本主题。",
        "a":{"implementation":["A 的实现说明"],"branches":["A 的进入条件、提前返回或异常路径"],"evidence":["a-entry"]},
        "b":{"implementation":["B 的实现说明"],"branches":["B 的进入条件、提前返回或异常路径"],"evidence":["b-entry"]},
        "difference":"具体实现差异，而不是笼统优劣评价。",
        "tradeoffs":"适用条件、收益与代价。",
        "unknowns":["需实际运行才能确认的事项。"]
      }
    ],
    "scenario": {
      "title":"同一任务的双方执行过程",
      "task":"选定一个与源码能力相符的任务。",
      "premise":"注明入口、配置、静态走查性质与必要假设。",
      "steps":[
        {"stage":"进入系统","aText":"A 的执行过程","aEvidence":["a-entry"],"bText":"B 的执行过程","bEvidence":["b-entry"]}
      ]
    },
    "conclusion":"连贯、受证据限制的对比结论，必须为字符串。"
  },
  "flow":{"title":"","summary":"","steps":[]},
  "flows":[],
  "caseStudy":null,
  "annotations":[]
}
```

模板只有一个主题和一个步骤，用于演示数据结构；最终应根据实际源码充分展开；scenario.steps 至少包含 4 个有证据支持的步骤，并覆盖正常与替代路径。模板中的 package={}、假路径、占位结论和占位哈希都必须替换，不能原样交付。若可运行性、来源或验证记录需补充，可写入 project 的 method/policies，以及主题 unknowns 和场景 premise；可以附加 README 或 VALIDATION，但不能依赖网站不识别的自定义字段来展示核心正文。

## index/search.json 格式

```json
{
  "schemaVersion": 2,
  "projectId": "comparison-a-b",
  "snapshotId": "comparison:REPLACE_WITH_64_HEX_SHA256",
  "documents": []
}
```

此搜索入口为资料包兼容入口。专题对比页目前按主题和场景导航，不提供该对比包的独立全文搜索，可保留 documents=[]，但不能声称已实现对比全文检索。两个原项目的源码与解读搜索由各自的搜索索引提供。

## 自检与交付

- 三个 JSON 可解析；入口文件真实存在；projectId/snapshotId/contentVersion 与完整 package 描述一致。
- 双方绑定与输入元数据完全一致，证据路径确实存在于对应项目，1 <= start <= end <= 文件物理行数。
- 证据 ID 唯一；所有 a/aEvidence 只能引用 project=A 的证据，b/bEvidence 同理，无悬空引用。
- topics 非空，每个 implementation/branches/evidence/unknowns 都是数组；scenario.steps 是数组，conclusion 为字符串。
- 用生成程序把完整 descriptor 写入 content.package，避免手抄造成两份版本不一致。提交可复用的校验命令或记录实际执行的校验，不得捏造运行结果。
- 输出目录不含缓存、凭证、机器绝对路径及双方源码副本。最后给出目录位置、主题数量、证据数量和未验证事项。

## 在网站中使用

先打开项目 A 和 B 各自的分析目录，再从首页“打开资料包目录”导入第三个对比目录。在“双项目对比”选择相同顺序的 A/B，网站只列出双方 ID、顺序及快照完全匹配的专题对比资料。选择后点击“打开专题比较”。没有第三份资料包，也可以使用双栏的源码阅读、搜索和定位。
