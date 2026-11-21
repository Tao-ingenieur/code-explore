import fs from 'node:fs'
import path from 'node:path'
import { CATALOG, SUBMISSION, readJson, writeJson } from './lib.mjs'

fs.mkdirSync(SUBMISSION, { recursive: true })

const descriptors = []
const errors = []
for (const entry of fs.readdirSync(SUBMISSION, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const file = path.join(SUBMISSION, entry.name, 'project.json')
  if (!fs.existsSync(file)) continue
  try {
    const descriptor = readJson(file)
    if (descriptor.schemaVersion !== 2) throw new Error('schemaVersion 必须为 2')
    if (descriptor.id !== entry.name) throw new Error(`目录名与项目 ID 不一致：${entry.name} != ${descriptor.id}`)
    if (!descriptor.snapshot?.id || !descriptor.snapshot?.archiveSha256) throw new Error('缺少快照身份')
    if (!descriptor.entries?.content || !descriptor.entries?.search) throw new Error('缺少内容或搜索入口')
    for (const [key, value] of Object.entries(descriptor.entries)) {
      if (typeof value !== 'string' || value.includes('..') || path.isAbsolute(value)) throw new Error(`入口路径不安全：${key}`)
    }
    for (const required of [descriptor.entries.content, descriptor.entries.search]) {
      if (!fs.existsSync(path.join(SUBMISSION, entry.name, required))) throw new Error(`缺少生成数据：${required}`)
    }
    if (descriptor.type !== 'comparison' && !fs.existsSync(path.join(SUBMISSION, entry.name, descriptor.entries.manifest))) throw new Error('缺少文件清单')
    if (descriptor.report && !process.argv.includes('--allow-missing-reports')) {
      if (!fs.existsSync(path.join(SUBMISSION, entry.name, descriptor.report.pdf))) throw new Error(`缺少 PDF：${descriptor.report.pdf}`)
      if (!fs.existsSync(path.join(SUBMISSION, entry.name, descriptor.report.tex))) throw new Error(`缺少 TeX：${descriptor.report.tex}`)
    }
    descriptors.push(descriptor)
  } catch (error) {
    errors.push(`${entry.name}: ${error instanceof Error ? error.message : error}`)
  }
}
descriptors.sort((a, b) => a.id.localeCompare(b.id))
for (const descriptor of descriptors.filter(item => item.type === 'comparison')) {
  const binding = descriptor.comparison
  if (!binding) {
    errors.push(`${descriptor.id}: 对比资料缺少双方绑定`)
    continue
  }
  for (const [id, snapshot] of [[binding.projectA, binding.snapshotA], [binding.projectB, binding.snapshotB]]) {
    const related = descriptors.find(item => item.id === id)
    if (!related) errors.push(`${descriptor.id}: 缺少关联项目 ${id}`)
    else if (related.snapshot.id !== snapshot) errors.push(`${descriptor.id}: ${id} 快照不匹配，需要 ${snapshot}，实际 ${related.snapshot.id}`)
  }
}
if (errors.length) {
  console.error(errors.map(error => `错误：${error}`).join('\n'))
  process.exit(1)
}
const catalog = { schemaVersion: 2, generatedBy: 'build-catalog.mjs', projects: descriptors }
writeJson(CATALOG, catalog)
console.log(`项目目录已生成：${descriptors.map(item => `${item.id}@${item.snapshot.id}`).join(', ')}`)
