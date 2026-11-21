import fs from 'node:fs'
import path from 'node:path'

// Read-only availability checks for the same resources checked by directory import.
export function inspectPackage(root, descriptor) {
  const warnings = []
  const unavailable = new Set()
  const warn = (message, ...args) => {
    if (!warnings.some(item => item.message === message && JSON.stringify(item.args) === JSON.stringify(args))) warnings.push({ message, args })
  }
  const safe = relative => typeof relative === 'string' && relative.length > 0 && !/^[\\/]|[\\:\x00]/.test(relative) && !relative.split('/').some(part => !part || part === '..' || part === '.')
  const exists = relative => {
    if (!safe(relative)) return false
    const target = path.resolve(root, relative)
    try { return fs.statSync(target).isFile() && fs.realpathSync(target).startsWith(fs.realpathSync(root) + path.sep) } catch { return false }
  }
  const missing = relative => {
    unavailable.add(relative)
    warn('本地资料包缺少或无法使用文件：{0}', relative)
  }
  const json = relative => {
    if (!exists(relative)) { missing(relative); return undefined }
    try { return JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8')) } catch {
      warn('资料包 JSON 格式无效：{0}', relative)
      unavailable.add(relative)
      return undefined
    }
  }
  if (!descriptor.entries || !descriptor.source) {
    warn('资料包描述不完整或格式不兼容。')
    return { warnings, unavailable: [] }
  }
  const content = json(descriptor.entries.content)
  const search = json(descriptor.entries.search)
  const manifest = descriptor.type === 'comparison' ? undefined : json(descriptor.entries.manifest)
  if (search && !Array.isArray(search.documents)) {
    warn('搜索索引不可用，其他内容仍可阅读。')
    unavailable.add(descriptor.entries.search)
  }
  for (const data of [content, search, manifest].filter(Boolean)) {
    if (data.projectId !== descriptor.id || data.snapshotId !== descriptor.snapshot?.id) warn('资料包身份或快照不一致。')
  }
  for (const data of [search, manifest].filter(Boolean)) {
    if (data.contentVersion && data.contentVersion !== descriptor.contentVersion) warn('资料包索引与解读的内容版本不一致。')
  }
  if (content && content.package?.contentVersion !== descriptor.contentVersion) warn('资料包索引与解读的内容版本不一致。')
  if (manifest) {
    if (!Array.isArray(manifest.files)) warn('资料包描述不完整或格式不兼容。')
    else for (const file of manifest.files) {
      if (!safe(file.path)) { warn('目录包含不安全或重复的相对路径：{0}', String(file.path)); continue }
      for (const relative of [descriptor.source.root ? descriptor.source.root.replace(/\/$/, '') + '/' + file.path : file.path, descriptor.entries.symbols.replace(/\/$/, '') + '/' + file.path + '.json']) {
        if (!exists(relative)) missing(relative)
      }
    }
    if (manifest.contentVersion !== descriptor.contentVersion) warn('资料包索引与解读的内容版本不一致。')
  }
  if (descriptor.report) for (const relative of [descriptor.report.pdf, descriptor.report.tex]) if (!exists(relative)) missing(relative)
  if (descriptor.type === 'comparison') {
    const binding = descriptor.comparison
    if (!binding?.projectA || !binding.projectB || !binding.snapshotA || !binding.snapshotB || binding.projectA === binding.projectB) warn('对比资料缺少有效的双方项目与快照绑定。')
    if (!Array.isArray(content?.references) || !content?.comparison?.topics?.length || !content.comparison.scenario || typeof content.comparison.conclusion !== 'string') warn('对比资料缺少主题、证据、执行场景或结论。')
  }
  return { warnings, unavailable: [...unavailable] }
}
