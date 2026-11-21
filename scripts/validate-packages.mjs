import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { VALIDATION, SUBMISSION, STATUS_LABELS, argument, readJson, writeJson, toPosix } from './lib.mjs'

fs.mkdirSync(SUBMISSION, { recursive: true })

const strict = process.argv.includes('--strict')
const results = []
const descriptors = []
const selectedProject = argument('project')
if (process.argv.includes('--project') && (!selectedProject || selectedProject.startsWith('--'))) throw new Error('请在 --project 后指定项目 ID。')
const descriptorPaths = new Map()
for (const entry of fs.readdirSync(SUBMISSION, { withFileTypes: true })) {
  const file = path.join(SUBMISSION, entry.name, 'project.json')
  if (entry.isDirectory() && fs.existsSync(file)) descriptorPaths.set(entry.name, file)
}
if (selectedProject) {
  const descriptorFile = descriptorPaths.get(selectedProject)
  if (!descriptorFile) throw new Error(`项目目录不存在：${selectedProject}`)
  const descriptor = readJson(descriptorFile)
  descriptors.push(descriptor)
  if (descriptor.type === 'comparison') {
    for (const id of new Set([descriptor.comparison?.projectA, descriptor.comparison?.projectB])) {
      if (id !== selectedProject && descriptorPaths.has(id)) descriptors.push(readJson(descriptorPaths.get(id)))
    }
  }
} else {
  for (const file of descriptorPaths.values()) descriptors.push(readJson(file))
}
descriptors.sort((a, b) => a.id.localeCompare(b.id))
const descriptorMap = new Map(descriptors.map(item => [item.id, item]))

function walk(root) {
  const files = []
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(absolute)
      else if (entry.isFile() || entry.isSymbolicLink()) files.push(absolute)
    }
  }
  visit(root)
  return files.sort()
}
function validatePackage(descriptor) {
  const root = path.join(SUBMISSION, descriptor.id)
  const errors = []
  const warnings = []
  const checks = []
  const check = (condition, message) => { if (!condition) errors.push(message) }
  const record = (name, detail) => checks.push({ name, result: 'passed', detail })
  check(descriptor.schemaVersion === 2, '资料包 schemaVersion 不是 2')
  check(descriptor.id === path.basename(root), '目录与项目 ID 不一致')
  check(descriptor.snapshot?.id && descriptor.snapshot?.archiveSha256, '缺少快照身份')
  const content = readJson(path.join(root, descriptor.entries.content))
  check(content.projectId === descriptor.id, '内容项目身份不一致')
  check(content.snapshotId === descriptor.snapshot.id, '内容快照身份不一致')
  check(content.package?.contentVersion === descriptor.contentVersion, '内容版本不一致')

  let fileMap = new Map()
  const symbolsByFile = new Map()
  if (descriptor.type !== 'comparison') {
    const manifest = readJson(path.join(root, descriptor.entries.manifest))
    check(manifest.projectId === descriptor.id && manifest.snapshotId === descriptor.snapshot.id, '清单项目或快照不一致')
    const source = path.resolve(root, descriptor.source.root)
    const disk = walk(source)
    const diskPaths = disk.map(file => toPosix(path.relative(source, file)))
    fileMap = new Map(manifest.files.map(file => [file.path, file]))
    check(fileMap.size === manifest.files.length, '清单存在重复路径')
    for (const relative of diskPaths) check(fileMap.has(relative), `磁盘文件未纳入清单：${relative}`)
    for (const relative of fileMap.keys()) check(diskPaths.includes(relative), `清单存在磁盘外文件：${relative}`)
    check(diskPaths.length === manifest.files.length, '磁盘与清单文件数不一致')
    record('文件清单', `${diskPaths.length} 个文件，差集为空`)
    let totalLines = 0
    let hashCount = 0
    for (const file of manifest.files) {
      const absolute = path.join(source, file.path)
      if (!fs.existsSync(absolute)) continue
      const buffer = fs.readFileSync(absolute)
      const hash = crypto.createHash('sha256').update(buffer).digest('hex')
      check(hash === file.sha256, `文件哈希变化：${file.path}`)
      check(buffer.length === file.bytes, `文件字节数变化：${file.path}`)
      hashCount += 1
      if (file.preview === 'text' || file.preview === 'markdown') {
        let text = ''
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer) } catch { check(file.encoding === 'unsupported', `编码状态未标注：${file.path}`); continue }
        const lines = text ? text.split(/\r\n|\r|\n/).length - (text.endsWith('\n') || text.endsWith('\r') ? 1 : 0) : 0
        check(lines === file.lines, `行数不一致：${file.path} ${file.lines} != ${lines}`)
        totalLines += lines
      } else {
        check(Boolean(file.unsupportedReason), `不支持预览但未说明原因：${file.path}`)
      }
      check(STATUS_LABELS[file.status], `未知分析状态：${file.path}`)
      check(Boolean(file.purpose && file.moduleLabel), `文件用途或模块为空：${file.path}`)
      const symbolFile = path.join(root, descriptor.entries.symbols, `${file.path}.json`)
      check(fs.existsSync(symbolFile), `缺少符号分片：${file.path}`)
      if (!fs.existsSync(symbolFile)) continue
      const symbols = readJson(symbolFile)
      symbolsByFile.set(file.path, symbols)
      check(symbols.length === file.symbolCount, `符号计数不一致：${file.path}`)
      for (const symbol of symbols) {
        check(symbol.path === file.path, `符号所属文件错误：${symbol.id}`)
        check(Number.isInteger(symbol.startLine) && symbol.startLine >= 1 && symbol.startLine <= symbol.endLine && symbol.endLine <= file.lines, `符号范围无效：${symbol.id}`)
      }
      for (const dependency of file.dependencies) check(fileMap.has(dependency), `内部依赖不存在：${file.path} -> ${dependency}`)
    }
    check(totalLines === manifest.stats.totalLines, `文本总行数不一致：${totalLines} != ${manifest.stats.totalLines}`)
    const symbolCount = [...symbolsByFile.values()].reduce((sum, symbols) => sum + symbols.length, 0)
    check(symbolCount === manifest.stats.symbols, `总符号数不一致：${symbolCount}`)
    record('原文与行号', `${hashCount} 个文件哈希、文本行数及预览状态有效`)
    record('符号索引', `${symbolCount} 个符号范围有效`)
    const computedStatus = Object.fromEntries(Object.keys(STATUS_LABELS).map(status => [status, manifest.files.filter(file => file.status === status).length]))
    check(JSON.stringify(computedStatus) === JSON.stringify(manifest.stats.statusCounts), '状态统计与文件记录不一致')
    const search = readJson(path.join(root, descriptor.entries.search))
    const expected = manifest.files.length + symbolCount + content.chapters.length + content.chapters.reduce((sum, chapter) => sum + chapter.sections.length, 0)
    check(search.documents.length === expected, `搜索记录不完整：${search.documents.length} != ${expected}`)
    check(search.projectId === descriptor.id && search.snapshotId === descriptor.snapshot.id, '搜索索引身份不一致')
    record('全量搜索', `${search.documents.length} 条记录属于当前项目与快照`)
  }

  const referenceMap = new Map(content.references.map(reference => [reference.id, reference]))
  check(referenceMap.size === content.references.length, '存在重复证据 ID')
  for (const reference of content.references) {
    let targetDescriptor = descriptor
    let targetFiles = fileMap
    if (descriptor.type === 'comparison') {
      targetDescriptor = descriptorMap.get(reference.project === 'A' ? descriptor.comparison.projectA : descriptor.comparison.projectB)
      check(Boolean(targetDescriptor), `对比证据缺少项目：${reference.id}`)
      if (!targetDescriptor) continue
      const relatedManifest = readJson(path.join(SUBMISSION, targetDescriptor.id, targetDescriptor.entries.manifest))
      targetFiles = new Map(relatedManifest.files.map(file => [file.path, file]))
    }
    const file = targetFiles.get(reference.path)
    check(Boolean(file), `证据文件不存在：${reference.id} ${reference.path}`)
    if (!file) continue
    check(Number.isInteger(reference.start) && Number.isInteger(reference.end) && reference.start >= 1 && reference.start <= reference.end && reference.end <= file.lines, `证据范围无效：${reference.id} ${reference.path}:${reference.start}-${reference.end}`)
    check(['source', 'inference', 'runtime'].includes(reference.confidence), `证据置信类型无效：${reference.id}`)
    if (reference.symbol && descriptor.type !== 'comparison') {
      const symbols = symbolsByFile.get(reference.path) || []
      const tail = reference.symbol.split('.').at(-1)
      check(symbols.some(symbol => symbol.id === reference.symbol || symbol.qualifiedName === reference.symbol || symbol.name === reference.symbol || symbol.name === tail), `证据符号未找到：${reference.id} ${reference.symbol}`)
    }
  }
  record('源码证据', `${content.references.length} 条引用路径、范围与置信类型有效`)

  const chapterMap = new Map(content.chapters.map(chapter => [chapter.id, chapter]))
  check(chapterMap.size === content.chapters.length, '存在重复章节 ID')
  for (const chapter of content.chapters) {
    for (const section of chapter.sections) {
      check(Array.isArray(section.body) && section.body.length >= 2, `小节正文不足：${chapter.id}/${section.id}`)
      for (const id of section.evidence || []) check(referenceMap.has(id), `小节证据不存在：${chapter.id}/${section.id} ${id}`)
    }
  }
  const chains = content.flows?.length ? content.flows : [content.flow]
  for (const chain of chains) {
    for (const step of chain.steps) {
      const file = fileMap.get(step.path)
      check(Boolean(file), `执行链文件不存在：${chain.id}/${step.id}`)
      if (file) check(step.startLine >= 1 && step.startLine <= step.endLine && step.endLine <= file.lines, `执行链范围无效：${step.id}`)
      check(chapterMap.has(step.chapter), `执行链章节不存在：${step.id}`)
      check(chapterMap.get(step.chapter)?.sections.some(section => section.id === step.section), `执行链小节不存在：${step.id}`)
      for (const branch of step.branches) check(referenceMap.has(branch.evidence), `执行链分支证据不存在：${step.id}/${branch.id}`)
    }
  }
  for (const annotation of content.annotations) {
    check(fileMap.has(annotation.path), `符号解读文件不存在：${annotation.path}`)
    const symbols = symbolsByFile.get(annotation.path) || []
    check(symbols.some(symbol => symbol.id === annotation.symbolId), `符号解读目标未解析：${annotation.path} ${annotation.symbol}`)
    check(chapterMap.has(annotation.chapter), `符号解读章节不存在：${annotation.path} ${annotation.symbol}`)
  }
  if (content.caseStudy) {
    for (const step of content.caseStudy.steps) for (const id of step.evidence) check(referenceMap.has(id), `案例证据不存在：${step.id} ${id}`)
    for (const branch of content.caseStudy.alternatives) check(referenceMap.has(branch.evidence), `案例替代路径证据不存在：${branch.id}`)
  }
  record('章节与关联链接', `${content.chapters.length} 个专题、${chains.length} 条执行链、${content.annotations.length} 个核心符号绑定`)

  if (descriptor.type === 'comparison') {
    const binding = descriptor.comparison
    const a = descriptorMap.get(binding.projectA)
    const b = descriptorMap.get(binding.projectB)
    check(Boolean(a && b), '对比关联项目缺失')
    if (a) check(a.snapshot.id === binding.snapshotA, '项目 A 快照不匹配')
    if (b) check(b.snapshot.id === binding.snapshotB, '项目 B 快照不匹配')
    const body = content.comparison
    check(Boolean(body?.topics?.length), '缺少对比主题')
    for (const topic of body.topics) {
      check(topic.a.implementation.length > 0 && topic.b.implementation.length > 0, `对比双方实现说明不足：${topic.id}`)
      check(topic.a.evidence.length > 0 && topic.b.evidence.length > 0, `对比双方证据不足：${topic.id}`)
      check(Boolean(topic.difference && topic.tradeoffs && topic.unknowns.length), `对比差异与边界不足：${topic.id}`)
      for (const id of [...topic.a.evidence, ...topic.b.evidence]) check(referenceMap.has(id), `对比主题证据不存在：${topic.id} ${id}`)
    }
    check(body.scenario.steps.length >= 4, '并排执行场景步骤不足')
    record('对比绑定', `${body.topics.length} 个主题、${body.scenario.steps.length} 个并排场景步骤`)
  }
  if (strict && warnings.length) errors.push(...warnings)
  const result = { project: descriptor.id, snapshot: descriptor.snapshot.id, status: errors.length ? 'failed' : 'passed', checks, errors, warnings }
  writeJson(path.join(root, 'validation/data-checks.json'), result)
  return result
}

const selectedDescriptors = selectedProject ? descriptors.filter(item => item.id === selectedProject) : descriptors
if (selectedProject && !selectedDescriptors.length) throw new Error(`项目目录不存在：${selectedProject}`)
for (const descriptor of selectedDescriptors) results.push(validatePackage(descriptor))
const summary = { scope: selectedProject || 'all', status: results.some(result => result.status === 'failed') ? 'failed' : 'passed', packages: results.map(result => ({ project: result.project, status: result.status, checks: result.checks.length, errors: result.errors.length })) }
writeJson(path.join(VALIDATION, 'package-checks.json'), summary)
for (const result of results) {
  console.log(`[${result.project}] ${result.status}：${result.checks.length} 组检查，${result.errors.length} 个错误`)
  result.errors.forEach(error => console.error(`  错误：${error}`))
}
if (summary.status === 'failed') process.exit(1)
