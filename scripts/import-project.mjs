import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import ts from 'typescript'
import { ROOT, PYTHON, STATUS_LABELS, argument, projectDirectory, projectSource, readJson, writeJson, toPosix } from './lib.mjs'

const project = projectDirectory()
const { descriptor, root: source } = projectSource(project)
const analysisDirectory = path.join(project, 'analysis')
const indexDirectory = path.join(project, 'index')
fs.mkdirSync(indexDirectory, { recursive: true })
const previousManifestPath = path.join(indexDirectory, 'manifest.json')
const previousSymbolsPath = path.join(indexDirectory, 'symbols.json')
const previousManifest = fs.existsSync(previousManifestPath) ? readJson(previousManifestPath) : null
const previousSymbols = fs.existsSync(previousSymbolsPath) ? readJson(previousSymbolsPath) : {}
const previousByPath = new Map((previousManifest?.files || []).map(file => [file.path, file]))
const reuseSyntax = (previousManifest?.syntaxVersion || 1) === 1
fs.mkdirSync(path.join(indexDirectory, 'symbols'), { recursive: true })
function optionalJson(name, fallback) {
  const file = path.join(analysisDirectory, name)
  return fs.existsSync(file) ? readJson(file) : fallback
}
const modules = optionalJson('modules.json', [{ id: 'root', label: '项目资料', path: '', description: '项目根目录。' }])
const overrides = optionalJson('file-overrides.json', {})
const references = optionalJson('references.json', [])
const chapters = optionalJson('chapters.json', [])
const flows = optionalJson('flows.json', [])
const legacyFlow = optionalJson('flow.json', flows[0] || { title: '执行链', summary: '', steps: [] })
const caseStudy = optionalJson('case.json', null)
const annotations = optionalJson('symbol-annotations.json', [])
const reportProject = optionalJson('report-project.json', null)

const scriptExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.rs', '.sh', '.bash'])
const textExtensions = new Set([
  ...scriptExtensions, '.md', '.mdx', '.txt', '.json', '.jsonl', '.yaml', '.yml', '.toml', '.ini', '.cfg',
  '.xml', '.sql', '.css', '.scss', '.html', '.vue', '.svelte', '.csv', '.tsv', '.lock', '.patch', '.diff',
  '.gitignore', '.dockerignore', '.editorconfig', '.gitattributes', '.prettierignore', '.oxlintrc', '.npmrc',
])
const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg', '.ico'])
const binaryExtensions = new Set(['.mp3', '.aac', '.wav', '.mp4', '.woff', '.woff2', '.ttf', '.otf', '.pdf', '.zip', '.gz', '.br', '.ds_store'])
const translationPattern = /^README\.[^.]+\.md$/i
const lockNames = new Set(['bun.lock', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'flake.lock', 'cargo.lock', 'go.sum'])

function walk(directory) {
  const entries = []
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name)
      if (entry.isDirectory()) visit(absolute)
      else if (entry.isFile() || entry.isSymbolicLink()) entries.push(absolute)
    }
  }
  visit(directory)
  return entries.sort((a, b) => toPosix(path.relative(directory, a)).localeCompare(toPosix(path.relative(directory, b))))
}
if (!fs.existsSync(source)) throw new Error(`项目源码目录不存在：${source}`)
const absoluteFiles = walk(source)
const sourcePaths = new Set(absoluteFiles.map(file => toPosix(path.relative(source, file))))
const workspacePackages = new Map()
for (const absolute of absoluteFiles) {
  const relative = toPosix(path.relative(source, absolute))
  if (relative.endsWith('package.json')) {
    try {
      const json = JSON.parse(fs.readFileSync(absolute, 'utf8'))
      if (json.name) workspacePackages.set(json.name, path.posix.dirname(relative))
    } catch { /* Parse diagnostics are retained in the file record. */ }
  }
}

const pythonFiles = absoluteFiles.filter(file => file.endsWith('.py'))
let pythonSyntax = {}
if (pythonFiles.length) {
  const output = execFileSync(PYTHON, [path.join(ROOT, 'scripts/extract_python.py'), source], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  pythonSyntax = JSON.parse(output)
}

function moduleFor(relative) {
  return [...modules].sort((a, b) => b.path.length - a.path.length).find(module => relative.startsWith(module.path)) || modules[0]
}
function coverageClass(relative) {
  const name = path.posix.basename(relative)
  const extension = path.posix.extname(relative).toLowerCase()
  const segments = relative.split('/')
  if (name === '.DS_Store' || name.startsWith('._')) return 'system-metadata'
  if (segments.some(part => ['node_modules', 'vendor', 'third_party'].includes(part)) || relative.startsWith('patches/')) return 'third-party'
  if (translationPattern.test(name)) return 'translation'
  if (lockNames.has(name) || extension === '.lock') return 'lockfile'
  if (segments.includes('generated') || segments.includes('fixtures') && relative.includes('/test-generated/')) return 'generated'
  if (imageExtensions.has(extension) || binaryExtensions.has(extension)) return 'resource'
  if (segments.some(part => ['test', 'tests', 'e2e', 'component-tests', 'test-browser', '__tests__'].includes(part)) || /\.(test|spec)\.[^.]+$/.test(relative)) return 'test'
  if (['.md', '.mdx', '.txt', '.rst'].includes(extension)) return 'document'
  if (['.json', '.jsonl', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.xml', '.css', '.sql'].includes(extension) || name.startsWith('.')) return 'config'
  return 'source'
}
function eligible(kind) {
  return ['source', 'config', 'document'].includes(kind)
}
function previewFor(relative, kind) {
  const extension = path.posix.extname(relative).toLowerCase()
  if (imageExtensions.has(extension)) return 'image'
  if (['.md', '.mdx'].includes(extension)) return 'markdown'
  if (textExtensions.has(extension) || !extension || kind === 'config' || kind === 'document') return 'text'
  return 'binary'
}
function languageFor(relative) {
  return ({ '.ts': 'TypeScript', '.tsx': 'React TypeScript', '.js': 'JavaScript', '.py': 'Python', '.rs': 'Rust', '.sh': 'Shell' })[path.posix.extname(relative)] || '文本'
}
function automaticPurpose(relative, module, kind) {
  if (kind === 'resource') return `${module.label}中的原始资源；保留清单与下载，不参与深入分析覆盖率。`
  if (kind === 'translation') return `${module.label}中的重复翻译说明；保留原文索引，不参与深入分析覆盖率。`
  if (kind === 'lockfile') return `${module.label}中的依赖锁定文件；用于版本审计，不参与深入分析覆盖率。`
  if (kind === 'test') return `${module.label}中的测试或测试设施；已索引，不计入核心源码深入覆盖率。`
  if (kind === 'third-party') return `${module.label}中的第三方或补丁资料；不计入原创核心深入覆盖率。`
  if (kind === 'generated') return `${module.label}中的生成代码；保留结构索引，不参与深入分析覆盖率。`
  if (kind === 'system-metadata') return `${module.label}中的系统元数据；不支持内容预览，不参与分析覆盖。`
  if (kind === 'document') return `${module.label}中的说明文档；提取标题结构，未自动生成深度解读。`
  if (kind === 'config') return `${module.label}中的配置或构建资料；已索引，具体职责待人工概述。`
  return `${module.label}中的${languageFor(relative)}实现；具体职责待人工概述（自动归类）。`
}

function scriptKind(relative) {
  const extension = path.posix.extname(relative)
  if (extension === '.tsx') return ts.ScriptKind.TSX
  if (['.js', '.jsx', '.mjs', '.cjs'].includes(extension)) return ts.ScriptKind.JSX
  return ts.ScriptKind.TS
}
function hasModifier(node, kind) {
  return Boolean(ts.canHaveModifiers(node) && ts.getModifiers(node)?.some(item => item.kind === kind))
}
function resolveDependency(fromFile, specifier) {
  const candidates = []
  if (specifier.startsWith('.')) {
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier))
    const withoutJs = base.replace(/\.(js|jsx|mjs|cjs)$/, '')
    candidates.push(base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, `${base}.json`, `${withoutJs}.ts`, `${withoutJs}.tsx`, `${withoutJs}.js`, `${withoutJs}.jsx`, `${base}/index.ts`, `${base}/index.tsx`, `${base}/index.js`, `${withoutJs}/index.ts`, `${withoutJs}/index.tsx`, `${withoutJs}/index.js`)
  } else {
    const workspace = [...workspacePackages.keys()].sort((a, b) => b.length - a.length).find(name => specifier === name || specifier.startsWith(`${name}/`))
    if (workspace) {
      const root = workspacePackages.get(workspace)
      const rest = specifier === workspace ? '' : specifier.slice(workspace.length + 1).replace(/\.(js|jsx)$/, '')
      for (const base of [`${root}/src/${rest}`, `${root}/${rest}`]) {
        candidates.push(`${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}/index.ts`, `${base}/index.tsx`, `${base}/index.js`, base)
      }
      candidates.push(`${root}/package.json`)
    }
  }
  return candidates.find(candidate => sourcePaths.has(candidate)) || null
}
function extractTypeScript(relative, text) {
  const ast = ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true, scriptKind(relative))
  const symbols = []
  const dependencies = new Set()
  const externalDependencies = new Set()
  const unresolvedDependencies = new Set()
  let dynamicImportCount = 0
  const lineAt = position => ast.getLineAndCharacterOfPosition(position).line + 1
  function displayName(name) {
    if (!name) return null
    if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text
    return null
  }
  function addSymbol(node, name, kind, prefix = '', exported = false) {
    if (!name) return
    const qualifiedName = prefix ? `${prefix}.${name}` : name
    symbols.push({ id: `${relative}#${qualifiedName}@${lineAt(node.getStart(ast))}`, name, qualifiedName, kind, path: relative, startLine: lineAt(node.getStart(ast)), endLine: lineAt(node.end), exported: exported || hasModifier(node, ts.SyntaxKind.ExportKeyword), async: hasModifier(node, ts.SyntaxKind.AsyncKeyword), extractor: 'typescript-ast' })
  }
  function addDependency(specifier) {
    const internal = resolveDependency(relative, specifier)
    if (internal) dependencies.add(internal)
    else if (specifier.startsWith('.')) unresolvedDependencies.add(specifier)
    else externalDependencies.add(specifier)
  }
  function visit(node, classPrefix = '') {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) addDependency(node.moduleSpecifier.text)
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const expression = node.moduleReference.expression
      if (expression && ts.isStringLiteral(expression)) addDependency(expression.text)
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        dynamicImportCount += 1
        const argument = node.arguments[0]
        if (argument && ts.isStringLiteral(argument)) addDependency(argument.text)
      } else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
        const argument = node.arguments[0]
        if (argument && ts.isStringLiteral(argument)) addDependency(argument.text)
      }
    }
    if (ts.isFunctionDeclaration(node)) {
      addSymbol(node, displayName(node.name) || (hasModifier(node, ts.SyntaxKind.DefaultKeyword) ? 'default' : null), 'function')
      ts.forEachChild(node, child => visit(child)); return
    }
    if (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)) {
      const name = displayName(node.name)
      addSymbol(node, name, ts.isClassDeclaration(node) ? 'class' : 'interface')
      ts.forEachChild(node, child => visit(child, name || classPrefix)); return
    }
    if (ts.isMethodDeclaration(node) || ts.isMethodSignature(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
      addSymbol(node, displayName(node.name), ts.isGetAccessorDeclaration(node) ? 'getter' : ts.isSetAccessorDeclaration(node) ? 'setter' : 'method', classPrefix)
      ts.forEachChild(node, child => visit(child)); return
    }
    if (ts.isConstructorDeclaration(node)) {
      addSymbol(node, 'constructor', 'constructor', classPrefix)
      ts.forEachChild(node, child => visit(child)); return
    }
    if (ts.isPropertyDeclaration(node) || ts.isPropertySignature(node)) {
      const initializer = node.initializer
      const kind = initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) ? 'function' : 'property'
      if (kind === 'function' || classPrefix) addSymbol(node, displayName(node.name), kind, classPrefix)
      ts.forEachChild(node, child => visit(child)); return
    }
    if (ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node) || ts.isModuleDeclaration(node)) {
      addSymbol(node, displayName(node.name), ts.isTypeAliasDeclaration(node) ? 'type' : ts.isEnumDeclaration(node) ? 'enum' : 'namespace')
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const statement = node.parent.parent
      const topLevel = ts.isVariableStatement(statement) && ts.isSourceFile(statement.parent)
      const initializer = node.initializer
      const directFunction = initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
      const wrappedFunction = initializer && ts.isCallExpression(initializer) && ts.isIdentifier(initializer.expression)
        && ['useCallback', 'memoize', 'memoizeWithLRU', 'memoizeAsync', 'once'].includes(initializer.expression.text)
        && initializer.arguments.some(argument => ts.isArrowFunction(argument) || ts.isFunctionExpression(argument))
      if (topLevel || directFunction || wrappedFunction) addSymbol(statement, node.name.text, directFunction || wrappedFunction ? 'function' : 'variable', classPrefix, topLevel && hasModifier(statement, ts.SyntaxKind.ExportKeyword))
    }
    ts.forEachChild(node, child => visit(child, classPrefix))
  }
  visit(ast)
  symbols.sort((a, b) => a.startLine - b.startLine || a.qualifiedName.localeCompare(b.qualifiedName))
  return { symbols, dependencies: [...dependencies].sort(), externalDependencies: [...externalDependencies].sort(), unresolvedDependencies: [...unresolvedDependencies].sort(), dynamicImportCount, parseErrors: ast.parseDiagnostics.map(item => ({ line: lineAt(item.start || 0), message: ts.flattenDiagnosticMessageText(item.messageText, ' ') })) }
}
function extractHeadings(relative, text) {
  const symbols = []
  text.split(/\r\n|\r|\n/).forEach((line, index) => {
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (match) symbols.push({ id: `${relative}#heading-${index + 1}@${index + 1}`, name: match[2], qualifiedName: match[2], kind: 'heading', path: relative, startLine: index + 1, endLine: index + 1, exported: true, async: false, extractor: 'markdown-headings' })
  })
  return symbols
}
function extractRust(relative, text) {
  const symbols = []
  text.split(/\r\n|\r|\n/).forEach((line, index) => {
    const match = /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(fn|struct|enum|trait|mod)\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(line)
    if (match) symbols.push({ id: `${relative}#${match[2]}@${index + 1}`, name: match[2], qualifiedName: match[2], kind: match[1] === 'fn' ? 'function' : match[1], path: relative, startLine: index + 1, endLine: index + 1, exported: !line.trimStart().startsWith('fn'), async: false, extractor: 'line-parser' })
  })
  return symbols
}
function collectText(value) {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(collectText).join('\n')
  if (value && typeof value === 'object') return Object.entries(value).filter(([key]) => !['id', 'evidence', 'ref', 'reference'].includes(key)).map(([, item]) => collectText(item)).join('\n')
  return ''
}

const relatedByFile = new Map()
for (const chapter of chapters) for (const section of chapter.sections || []) for (const id of section.evidence || []) {
  const reference = references.find(item => item.id === id)
  if (!reference) continue
  if (!relatedByFile.has(reference.path)) relatedByFile.set(reference.path, new Set())
  relatedByFile.get(reference.path).add(chapter.id)
}
const files = []
const symbolsByFile = {}
const searchDocuments = []
const hashGroups = new Map()
const treeHasher = crypto.createHash('sha256')
let totalLines = 0
let parseErrorCount = 0
const decoder = new TextDecoder('utf-8', { fatal: true })

for (const absolute of absoluteFiles) {
  const relative = toPosix(path.relative(source, absolute))
  const stat = fs.lstatSync(absolute)
  const linkTarget = stat.isSymbolicLink() ? fs.readlinkSync(absolute) : null
  if (linkTarget) {
    const resolved = path.resolve(path.dirname(absolute), linkTarget)
    if (resolved !== source && !resolved.startsWith(`${source}${path.sep}`)) throw new Error(`符号链接越界：${relative} -> ${linkTarget}`)
  }
  const buffer = fs.readFileSync(absolute)
  const hash = crypto.createHash('sha256').update(buffer).digest('hex')
  treeHasher.update(`${relative}\0${hash}\n`)
  if (!hashGroups.has(hash)) hashGroups.set(hash, [])
  hashGroups.get(hash).push(relative)
  const kind = coverageClass(relative)
  const module = moduleFor(relative)
  const override = overrides[relative] || {}
  let preview = previewFor(relative, kind)
  let text = ''
  let encoding = preview === 'text' || preview === 'markdown' ? 'utf-8' : 'binary'
  let unsupportedReason = preview === 'binary' || preview === 'image' ? (preview === 'image' ? '图片资源，提供原始预览与下载。' : '二进制或系统资料，不提供文本预览；可下载原文件。') : ''
  if (preview === 'text' || preview === 'markdown') {
    try { text = decoder.decode(buffer) } catch {
      preview = 'binary'
      encoding = 'unsupported'
      unsupportedReason = '不是有效 UTF-8 文本；保留原始字节与下载，不做乱码展示。'
    }
  }
  const lines = text ? text.split(/\r\n|\r|\n/).length - (text.endsWith('\n') || text.endsWith('\r') ? 1 : 0) : 0
  const longestLine = text ? Math.max(0, ...text.split(/\r\n|\r|\n/).map(line => line.length)) : 0
  totalLines += lines
  let syntax = { symbols: [], dependencies: [], externalDependencies: [], unresolvedDependencies: [], dynamicImportCount: 0, parseErrors: [] }
  const previous = previousByPath.get(relative)
  if (reuseSyntax && previous?.sha256 === hash && Object.hasOwn(previousSymbols, relative)) {
    syntax = {
      symbols: previousSymbols[relative], dependencies: previous.dependencies || [], externalDependencies: previous.externalDependencies || [],
      unresolvedDependencies: previous.unresolvedDependencies || [], dynamicImportCount: previous.dynamicImportCount || 0, parseErrors: previous.parseErrors || [],
    }
  } else if (text && ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(path.posix.extname(relative))) syntax = extractTypeScript(relative, text)
  else if (text && relative.endsWith('.py')) syntax = { ...syntax, symbols: pythonSyntax[relative]?.symbols || [], parseErrors: pythonSyntax[relative]?.parseErrors || [] }
  else if (text && relative.endsWith('.rs')) syntax = { ...syntax, symbols: extractRust(relative, text) }
  else if (text && ['.md', '.mdx'].includes(path.posix.extname(relative))) syntax = { ...syntax, symbols: extractHeadings(relative, text) }
  parseErrorCount += syntax.parseErrors.length
  symbolsByFile[relative] = syntax.symbols
  const symbolDestination = path.join(indexDirectory, 'symbols', `${relative}.json`)
  if (!(reuseSyntax && previous?.sha256 === hash && symbolFileUsable(symbolDestination))) writeJson(symbolDestination, syntax.symbols)
  const status = override.status || 'indexed'
  if (!STATUS_LABELS[status]) throw new Error(`${relative}: 未知状态 ${status}`)
  const deepEligible = eligible(kind)
  const record = {
    path: relative, name: path.posix.basename(relative), extension: path.posix.extname(relative), module: module.id, moduleLabel: module.label,
    purpose: override.purpose || automaticPurpose(relative, module, kind), status, statusLabel: STATUS_LABELS[status],
    analysisDepth: override.analysisDepth || (status === 'deep' || status === 'pending' ? 'deep' : status), verification: override.verification || 'not-run',
    unresolved: override.unresolved || [], coverageClass: kind, deepEligible, preview, encoding, unsupportedReason,
    symlinkTarget: linkTarget, bytes: buffer.byteLength, lines, longestLine, sha256: hash, symbolCount: syntax.symbols.length,
    dependencies: syntax.dependencies, externalDependencies: syntax.externalDependencies, unresolvedDependencies: syntax.unresolvedDependencies,
    dynamicImportCount: syntax.dynamicImportCount, parseErrors: syntax.parseErrors, relatedChapters: [...(relatedByFile.get(relative) || [])],
    annotationCount: annotations.filter(item => item.path === relative).length,
  }
  files.push(record)
  searchDocuments.push({ id: `file:${relative}`, kind: 'file', title: record.name, path: relative, subtitle: `${module.label} · ${record.statusLabel}`, body: `${relative}\n${record.purpose}\n${record.unresolved.join('\n')}` })
  for (const symbol of syntax.symbols) searchDocuments.push({ id: `symbol:${symbol.id}`, kind: 'symbol', symbolKind: symbol.kind, title: symbol.qualifiedName, path: relative, startLine: symbol.startLine, endLine: symbol.endLine, subtitle: `${symbol.kind} · ${relative}:${symbol.startLine}`, body: `${symbol.name}\n${symbol.qualifiedName}\n${relative}` })
}
function symbolFileUsable(file) {
  if (!fs.existsSync(file)) return false
  try {
    return Array.isArray(readJson(file))
  } catch {
    return false
  }
}
const expectedSymbolFiles = new Set(absoluteFiles.map(file => `${toPosix(path.relative(source, file))}.json`))
function removeStaleSymbols(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      removeStaleSymbols(absolute)
      if (!fs.readdirSync(absolute).length) fs.rmdirSync(absolute)
    } else {
      const relative = toPosix(path.relative(path.join(indexDirectory, 'symbols'), absolute))
      if (!expectedSymbolFiles.has(relative)) fs.rmSync(absolute)
    }
  }
}
removeStaleSymbols(path.join(indexDirectory, 'symbols'))
for (const chapter of chapters) {
  searchDocuments.push({ id: `chapter:${chapter.id}`, kind: 'analysis', title: chapter.title, chapter: chapter.id, subtitle: `专题解读 · ${chapter.kicker || ''}`, body: `${chapter.summary || ''}\n${collectText(chapter.sections || [])}` })
  for (const section of chapter.sections || []) {
    const evidenceText = (section.evidence || []).map(id => references.find(ref => ref.id === id)?.claim || '').join('\n')
    searchDocuments.push({ id: `section:${chapter.id}/${section.id}`, kind: 'analysis', title: `${chapter.title} · ${section.title}`, chapter: chapter.id, section: section.id, subtitle: `解读章节 · ${chapter.kicker || ''}`, body: `${collectText(section.body || [])}\n${evidenceText}` })
  }
}
const duplicateGroups = [...hashGroups.values()].filter(group => group.length > 1)
const statusCounts = Object.fromEntries(Object.keys(STATUS_LABELS).map(status => [status, files.filter(file => file.status === status).length]))
const eligibleStatusCounts = Object.fromEntries(Object.keys(STATUS_LABELS).map(status => [status, files.filter(file => file.deepEligible && file.status === status).length]))
const coverageClassCounts = Object.fromEntries([...new Set(files.map(file => file.coverageClass))].map(kind => [kind, files.filter(file => file.coverageClass === kind).length]))
const moduleStats = modules.map(module => ({ ...module, files: files.filter(file => file.module === module.id).length, eligibleFiles: files.filter(file => file.module === module.id && file.deepEligible).length, lines: files.filter(file => file.module === module.id).reduce((sum, file) => sum + file.lines, 0) })).filter(module => module.files)
const resolvedAnnotations = annotations.map(annotation => {
  const candidates = symbolsByFile[annotation.path] || []
  const symbol = candidates.find(item => item.qualifiedName === annotation.symbol && (!annotation.startLine || item.startLine === annotation.startLine)) || candidates.find(item => item.name === annotation.symbol && (!annotation.startLine || item.startLine === annotation.startLine))
  return { ...annotation, symbolId: symbol?.id || null }
})
const treeSha256 = treeHasher.digest('hex')
const snapshot = { ...descriptor.snapshot, includedFiles: files.length, treeSha256, totalLines, parseErrorCount, duplicateGroups, symlinkCount: files.filter(file => file.symlinkTarget).length }
const generatedDescriptor = { ...descriptor, snapshot }
writeJson(path.join(project, 'project.json'), generatedDescriptor)
const manifest = {
  schemaVersion: 2, syntaxVersion: 1, projectId: descriptor.id, snapshotId: snapshot.id, contentVersion: descriptor.contentVersion, source: snapshot,
  stats: { files: files.length, totalLines, symbols: Object.values(symbolsByFile).flat().length, statusCounts, eligibleStatusCounts, coverageClassCounts, parseErrorCount },
  modules: moduleStats, statusLabels: STATUS_LABELS, files,
}
const content = {
  schemaVersion: 2, projectId: descriptor.id, snapshotId: snapshot.id, package: generatedDescriptor,
  project: reportProject || {
    title: descriptor.name, subtitle: '', contentVersion: descriptor.contentVersion, analysisDate: descriptor.analysisDate,
    source: { label: descriptor.source.language, commit: snapshot.commit, snapshotSha256: snapshot.archiveSha256, treeSha256, scope: '完整纳入清单', suppliedFiles: snapshot.suppliedFiles, includedFiles: files.length, totalLines, parseErrorCount, duplicateGroups, generatedExclusions: [], runtimeStatus: 'not-run', runtimeNote: '示例项目未由导航站执行；运行行为需另行验证。' },
    method: ['完整清单与静态结构提取', '核心执行链人工静态阅读', '网站与报告使用同源 JSON'], exclusions: [], policies: ['自动索引不等于深入分析。'],
  },
  chapters, references, flow: legacyFlow, flows, caseStudy, annotations: resolvedAnnotations,
}
writeJson(path.join(indexDirectory, 'manifest.json'), manifest)
writeJson(path.join(indexDirectory, 'content.json'), content)
writeJson(path.join(indexDirectory, 'symbols.json'), symbolsByFile)
writeJson(path.join(indexDirectory, 'search.json'), { schemaVersion: 2, projectId: descriptor.id, snapshotId: snapshot.id, contentVersion: descriptor.contentVersion, documents: searchDocuments })
console.log(`[${descriptor.id}] ${files.length} 个文件，${manifest.stats.symbols} 个符号，${searchDocuments.length} 条搜索记录，${totalLines} 行文本。`)
console.log(`覆盖分类 ${JSON.stringify(coverageClassCounts)}；AST/解析诊断 ${parseErrorCount}；快照树 ${treeSha256.slice(0, 16)}。`)
