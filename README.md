# Code Explore / 源码导航

用于阅读、搜索和对比源码及配套解读的本地静态网站。网站加载已经生成的分析资料包；自身不调用 LLM，也不自动生成深度解读。

## 下载与首次运行

```bash
git clone https://github.com/Tao-ingenieur/code-explore.git code-explorer/repo
cd code-explorer/repo
npm ci
npm run build:app
cd ../dist
node serve.mjs --port 4173
```

打开 http://127.0.0.1:4173/ 。首次构建会生成相邻的 `dist`，空资料库也可运行；推荐将标准资料包放入 `dist/output/<项目ID>/`，刷新首页后直接阅读，无需目录授权。其他位置的目录可手动接入。原始源码 ZIP 需要先交给 Agent 分析，网站不会自动分析。

两份可直接交给 Agent 的完整提示词：

- [单项目源码分析资料包 Prompt](docs/agent-prompt.md)：输入源码 ZIP，生成独立分析目录。
- [双项目对比资料包 Prompt](docs/comparison-prompt.md)：输入两份源码 ZIP 及各自的 `project.json`，生成第三份对比目录。

本 GitHub 仓库仅发布程序源码、脚本、测试及提示词，不包含源码资料包、分析报告、构建产物或 `node_modules`。`package.json` 中的 `private: true` 用于阻止误发布到 npm，与 GitHub 仓库的公开状态无关。

## 界面语言

产品名称为 **Code Explore / 源码导航**。右上角可切换中文和 English，浏览器保存选择；切换保持当前项目和链接位置。界面导航、按钮、筛选项、提示和错误信息支持双语。源码、解读正文、项目名称和随包报告保持原始内容，不调用翻译 API。

界面词典位于 `web/translations.ts`，语言逻辑位于 `web/i18n.ts`。新增界面文案应通过 `t()` 引用，并同时补充英文翻译。

## 阅读与对比界面

首页提供紧凑的资料包卡片、继续阅读、项目首页、清除阅读记录和报告下载。专题解读先显示章节目录；进入章节后可使用章节导航、随滚动定位的小节目录和可折叠的源码证据。

首页主要入口“刷新本地资料包”直接刷新服务中的 output 项目，无需浏览器目录授权。“打开其他目录（需授权）”使用浏览器 File System Access API 选择其他目录，并直接读取原文件。需要支持目录授权的 Chrome/Edge 和安全上下文（例如本地 http://127.0.0.1）。浏览器可能显示“查看和复制”等授权提示，这是浏览器固定措辞；网站不会把整份资料复制到其他目录或浏览器存储，也不使用上传式目录选择。

选择含 `project.json` 的目录后，检查资料可用性。仅必要入口（project.json、解读 content、非对比项目的 manifest）缺失或不可解析、核心结构不兼容及不安全路径等问题阻止接入。源码、符号分片、搜索索引或已声明报告缺失，以及身份/版本差异，仅在项目卡片显示可展开的告警清单，仍允许打开。缺少搜索或符号索引时对应结果为空；缺少源码时仅在打开该文件时提示，已有解读不受影响。身份不一致的资料需由提供方确认，网站不会替用户修正证据。网站不自动分析原始源码。单项目格式与完整 AI 提示词可在 `#/package-help` 网页中查看、复制或下载；双项目资料说明位于 `#/compare-help`。

IndexedDB 仅保存目录句柄和项目元数据，不持久保存新接入资料的 File/Blob 内容。导入、重新授权和移除项目后只更新当前页面，不整页刷新，保留当次目录授权。浏览器之后若收回权限，点击卡片上的“重新授权目录”；目录句柄保存在浏览器中并不保证读取权限永久有效。此前通过本地系统窗口接入的项目也需要重新授权并选择同一资料包目录，随后改用浏览器句柄。磁盘内容更新后刷新重新读取；描述或索引变更后应重新接入校验。

每次接入一个项目，允许外包装目录，超过50,000条目的目录会拒绝。文件齐全不代表语义或业务正确。不支持目录授权时明确提示，不退回上传。API 参考：[Chrome 官方说明](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)。

`dist/output` 中的项目由本地服务实时扫描并直接从磁盘提供，卡片标记为“服务读取”，新增或修改资料包后刷新网页即可，无需重新生成目录索引或再次授权。服务优先读取 output 中的现有项目，不回退到 build 中同 ID 的过期文件。已有同 ID 的浏览器目录登记不再覆盖服务入口，阅读位置仍按项目与快照保留。这些是用户已有资料，没有内置预置项目，也没有“恢复预置项目”按钮。同 ID 的服务项目优先使用服务入口；未由服务提供的项目仍可重新选择目录接入，无需先移除。卡片的“移除项目”只移除浏览器登记或隐藏已有磁盘项目，不删除原目录；想重新添加时再次选择该资料包目录。旧版本的整份浏览器副本仍可移除，或成功选择同ID原目录后替换；新接入不新增整份副本。移除源码项目不会级联删除对比包。“项目阅读”和品牌标题均返回资料库，不自动打开最近项目。

“双项目对比”先选择项目 A 和项目 B；任意两个已打开的源码或文档项目均可并排阅读。每侧有独立的总览、源码、专题解读、搜索和执行链入口，可分别定位文件、符号、证据行号；阅读位置按项目保存，也可以单独打开当前页。可点击“专注阅读”隐藏选择与说明，扩大阅读区域；窄屏上下排列。此工作区不自动生成差异结论或函数匹配，也不是文本 diff 工具。

第三份专题对比资料包是可选的。生成方法、完整字段结构和自检要求见 [对比资料包 AI 提示词](docs/comparison-prompt.md)，网站也提供可复制说明页面；从已选 A/B 进入说明页会附带两个项目的描述和快照。用户把提示词与两份源码 ZIP 交给 AI，拿到对比目录后，可直接在双项目对比页点击“打开对比资料包目录”，也可从资料库导入。第三份资料选择器始终显示，只有 A/B 角色顺序、项目 ID、快照均匹配的专题对比包可打开；其他包显示不匹配原因。选择项目或导入后立即更新候选项，无需刷新页面。

专题对比保留主题、连续阅读、执行场景及 A/B 证据源码面板；点击证据只更新对应一侧。对比包从双栏工作区打开后可返回原 A/B 选择。没有第三个资料包时，双栏阅读仍可正常使用。

## 目录与 Git 范围

```text
code-explorer/
├── repo/                    # 本 GitHub 程序仓库
│   ├── index.html           # Vite 的 HTML 源码入口
│   ├── web/                 # TypeScript、CSS 和界面组件
│   ├── scripts/             # 导入、索引、报告、构建和校验脚本
│   ├── tests/               # 单元测试及浏览器测试
│   ├── docs/                # 单项目及对比资料生成提示词
│   └── node_modules/        # 本地依赖，由 Git 排除
└── dist/                    # 本地数据和生成产物，不上传程序仓库
    ├── input/               # 原始 ZIP
    ├── output/              # 独立分析资料包
    ├── serve.mjs            # 独立运行入口，不依赖 repo
    ├── README.md            # 运行包使用说明
    ├── build/               # 编译后的网站及 projects/catalog.json
    └── validation/          # 测试时自动生成，可删除，不是运行依赖
```

下文命令均在 `repo` 内执行，因此外层产物路径使用 `../dist/...`。路径相对于仓库布局解析，移动整个 `code-explorer` 不影响程序。

`index.html` 是需要提交的源码，保留在 Vite 项目根目录；`web/main.ts` 是它引用的前端入口。编译后的 HTML 写入 `../dist/build/index.html`，不提交 Git。

## 环境

- Node.js 20+、npm 10+；依赖版本由 `package-lock.json` 锁定。
- 仅预览已有构建：只需 Node.js，不需安装依赖。
- 索引 Python 文件、解压 ZIP 或生成报告：需要 Python 3。Node 脚本在 Windows 调用 `python`，其他系统调用 `python3`，也支持用 `PYTHON` 环境变量指定解释器。
- PDF 编译另需 Tectonic 或 XeLaTeX 及中文字体；报告验证另需 PyMuPDF 和 Pillow。当前没有统一锁定 Python/TeX 环境，不能声称 PDF 跨机器构建已完全复现。

## 预览已有网站

从 `repo` 进入外层 `dist` 后运行；也可直接在 `dist` 打开终端执行启动命令。运行包无需源码目录或 node_modules：

```powershell
cd ..\dist
node serve.mjs --port 4173
```

打开 http://127.0.0.1:4173/ 。服务器以脚本所在目录为基准，读取 `build` 中的网站；优先从 `output` 读取现有资料包；没有对应 output 项目时兼容 build 中的静态副本。更新服务脚本后需重启服务。整个 dist 可移动到其他目录或机器，运行只需 Node.js 20+。

在源码仓库内也保留 `node scripts/serve.mjs --port 4173` 和 `npm run preview`。`npm run build:app` 自动将独立服务器与运行说明复制到外层 dist；没有前端构建时应先执行该命令。

## 开发与前端编译

```bash
npm ci
npm run dev
```

开发服务启动前自动生成项目目录，地址为 http://127.0.0.1:5173/ 。资料包放在 `../dist/output/<project-id>/`；空目录会生成空项目列表，不附带任何示例源码或报告。

```bash
npm run build:app
npm run preview
```

`build:app` 执行 TypeScript 检查、项目目录生成和前端编译，输出到 `../dist/build`。它校验目录描述和必要数据入口，但不执行逐文件完整性校验。预览仍需外部 `../dist/output`，不能将仅含前端的构建目录当作完整资料部署包。

## 完整静态部署

```bash
npm run build
```

先执行逐文件资料校验，再编译前端并复制资料包，生成包含源码、索引、报告的完整 `../dist/build`，可部署到静态服务器。输入不完整时应先补齐资料，不能删除清单条目或重建索引来掩盖缺失。具体资料包的检查结论只存于外层 `dist`。

## 客户交给 Agent 的接入材料

使用 [自包含 Agent Prompt](docs/agent-prompt.md)。任务、资料包格式、完整示例、命令和验收要求均在这一份文件中。填写 ZIP 文件名、项目 ID 和显示名称后交给任意能读写文件的 Agent；它无需访问导航程序源码，完整资料包只写入指定的 dist/output 子目录。

## 新资料包

原始 ZIP 存入 `../dist/input`。使用 Python 解压，输出目录非空时不会覆盖：

```bash
python scripts/extract_archive.py ../dist/input/example.zip --output ../dist/output/05-example/source
```

Linux/macOS 可将上面的 `python` 换为 `python3`。为项目添加 `project.json` 及分析配置后：

```bash
npm run data:import -- --project 05-example
npm run catalog
```

导入器生成结构索引；人工解读、执行链、证据和报告由 Agent 提供。当前沿用 schemaVersion 2，尚未实现不同 Agent 输出的通用转换器。详见 `docs/agent-prompt.md` 中的内嵌资料包规范。

资料包均是外部输入，程序不内置具体源码或报告。`data:generate` 会重建各资料包索引；仅在原始源码与完整分析配置均已准备好时执行，避免覆盖已有解读。

## 报告与测试

```bash
npm run report -- --project <project-id>
npm run typecheck
npm run test:i18n
npm run test:packages
npm run test:browser
```

报告源文件及 PDF 放在对应资料包的 `report/`。浏览器测试结果写入 `../dist/validation`，资料包专属检查仍写在各包的 `validation/`。

通用浏览器测试使用拦截响应检查空列表、错误目录和不完整路由，不依赖外部资料。数据驱动的集成检查从当前目录自动选择资料包，不假设名称、数量或源码结构；没有适用输入时跳过并报告。运行测试需要 Playwright Chromium，或用 `CHROMIUM_PATH` 指定 Chrome/Edge 可执行文件。

`npm test` 执行程序类型检查、界面词典、目录接入单元测试及浏览器回归。`test:data` 单独执行严格资料校验，不属于默认程序测试；`verify` 会重建数据和报告，再完整构建及测试，存在写入行为，不是只读检查。验证职责和执行方法见 `VALIDATION.md`；每次运行的结果及具体资料包问题写入外层 `dist/validation` 或资料包自身的 `validation`。

## 保留与同步

程序源码、脚本、测试、文档、HTML 入口、配置及 `package-lock.json` 应提交。`node_modules`、生成数据和本地产物不提交；依赖通过 `npm ci` 重建。

远程仓库由使用者配置，程序不绑定任何固定 GitHub 项目。`dist/validation` 是测试时生成的可清理目录，不属于程序源码，也不是运行依赖。
