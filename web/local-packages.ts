import { t } from './i18n'
import type { ProjectDescriptor } from './types'

export interface DirectoryHandle {
  kind: 'directory'
  name: string
  entries(): AsyncIterableIterator<[string, DirectoryHandle | ReadFileHandle]>
  getDirectoryHandle(name: string): Promise<DirectoryHandle>
  getFileHandle(name: string): Promise<ReadFileHandle>
  queryPermission?(options: { mode: 'read' }): Promise<PermissionState>
  requestPermission?(options: { mode: 'read' }): Promise<PermissionState>
}
interface ReadFileHandle { kind: 'file'; getFile(): Promise<File> }
type StoredPackage = { warnings?: string[]; unavailable?: string[]; id: string; descriptor: ProjectDescriptor; handle?: DirectoryHandle; nativeConnection?: { token: string; name: string }; prefix?: string; files?: Array<[string, Blob]> }
const mounted = new Map<string, { value: StoredPackage; needsPermission: boolean; urls: Map<string, string> }>()
const VIRTUAL_PATH = '__directory_files/'
function safePath(path: string): boolean {
  return !!path && !path.startsWith('/') && !/[\\:\x00]/.test(path) && !path.split('/').some(part => part === '..' || part === '.' || !part)
}
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('code-explore.packages.v1', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('packages', { keyPath: 'id' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
async function storedPackages(): Promise<StoredPackage[]> {
  const database = await openDatabase()
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction('packages', 'readonly').objectStore('packages').getAll()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  } finally { database.close() }
}
async function persist(value: StoredPackage | string): Promise<void> {
  const database = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction('packages', 'readwrite')
      const store = tx.objectStore('packages')
      if (typeof value === 'string') store.delete(value)
      else store.put(value)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally { database.close() }
}
function mount(value: StoredPackage, needsPermission = false): void {
  mounted.get(value.id)?.urls.forEach(url => URL.revokeObjectURL(url))
  mounted.set(value.id, { value, needsPermission, urls: new Map() })
}
export function preferServerPackage(id: string): void {
  mounted.get(id)?.urls.forEach(url => URL.revokeObjectURL(url))
  mounted.delete(id)
}
export async function restoreLocalPackages(excludedIds: Set<string>): Promise<ProjectDescriptor[]> {
  excludedIds.forEach(preferServerPackage)
  try {
    for (const value of await storedPackages()) {
      if (excludedIds.has(value.id)) {
        // A retained directory registration means this project was re-added
        // after its server card was hidden. Preserve that visible membership.
        showServerProject(value.id)
        continue
      }
      const granted = value.nativeConnection ? false : !value.handle || !value.handle.queryPermission || await value.handle.queryPermission({ mode: 'read' }).catch(() => 'prompt') === 'granted'
      mount(value, !granted)
    }
  } catch { /* Disabled IndexedDB must not block server-backed packages. */ }
  return [...mounted.values()].filter(item => !excludedIds.has(item.value.id)).map(item => item.value.descriptor)
}
export function packageWarnings(id: string): string[] { return mounted.get(id)?.value.warnings || [] }
export function isUnavailableAsset(id: string, path: string): boolean { return mounted.get(id)?.value.unavailable?.includes(path) || false }
export function isLocalPackage(id: string): boolean { return mounted.has(id) }
export function needsDirectoryPermission(id: string): boolean { return mounted.get(id)?.needsPermission || false }
export function isLegacyCopy(id: string): boolean { return !!mounted.get(id)?.value.files }
export function localAsset(id: string, path: string): string | undefined {
  const project = mounted.get(id)
  if (!project) return undefined
  if (!safePath(path)) throw new Error(t('资料包资源路径越界。'))
  if (project.value.nativeConnection) throw new Error(t('请返回项目列表，重新授权原目录的读取权限。'))
  if (project.value.handle) return new URL(VIRTUAL_PATH + encodeURIComponent(id) + '/' + path.split('/').map(encodeURIComponent).join('/'), document.baseURI).href
  // Legacy copies remain removable/readable. New imports never write File/Blob content to IndexedDB.
  const file = project.value.files?.find(([name]) => name === path)?.[1]
  if (!file) throw new Error(t('本地资料包缺少文件：{0}', path))
  let url = project.urls.get(path)
  if (!url) { url = URL.createObjectURL(file); project.urls.set(path, url) }
  return url
}
export async function readDirectoryAsset(url: string): Promise<Blob | undefined> {
  const base = new URL(VIRTUAL_PATH, document.baseURI)
  const request = new URL(url, document.baseURI)
  if (request.origin !== base.origin || !request.pathname.startsWith(base.pathname)) return undefined
  const [id, ...parts] = request.pathname.slice(base.pathname.length).split('/').map(decodeURIComponent)
  const path = parts.join('/')
  if (!safePath(path)) throw new Error(t('资料包资源路径越界。'))
  const project = mounted.get(id)
  if (!project?.value.handle || project.needsPermission) throw new Error(t('请返回项目列表，重新授权原目录的读取权限。'))
  if (isUnavailableAsset(id, path)) {
    if (path === project.value.descriptor.entries.search) return new Blob([JSON.stringify({ documents: [] })], { type: 'application/json' })
    if (path.startsWith(project.value.descriptor.entries.symbols)) return new Blob(['[]'], { type: 'application/json' })
  }
  let directory = project.value.handle
  const segments = ((project.value.prefix || '') + path).split('/')
  for (const segment of segments.slice(0, -1)) directory = await directory.getDirectoryHandle(segment)
  const file = await (await directory.getFileHandle(segments.at(-1)!)).getFile()
  const type = /\.pdf$/i.test(path) ? 'application/pdf' : /\.svg$/i.test(path) ? 'image/svg+xml' : /\.png$/i.test(path) ? 'image/png' : /\.jpe?g$/i.test(path) ? 'image/jpeg' : /\.webp$/i.test(path) ? 'image/webp' : /\.json$/i.test(path) ? 'application/json' : 'text/plain;charset=utf-8'
  return file.slice(0, file.size, type)
}
export function isDirectoryAsset(url: string): boolean {
  const base = new URL(VIRTUAL_PATH, document.baseURI)
  const request = new URL(url, document.baseURI)
  return request.origin === base.origin && request.pathname.startsWith(base.pathname)
}
export async function resolveAssetUrl(url: string): Promise<string> {
  const file = await readDirectoryAsset(url)
  return file ? URL.createObjectURL(file) : url
}
export async function removeLocalPackage(id: string): Promise<void> {
  await persist(id)
  mounted.get(id)?.urls.forEach(url => URL.revokeObjectURL(url))
  mounted.delete(id)
}
export async function pickDirectory(): Promise<DirectoryHandle> {
  const picker = (window as unknown as { showDirectoryPicker?: (options: { mode: 'read'; id: string }) => Promise<DirectoryHandle> }).showDirectoryPicker
  if (!picker) throw new Error(t('当前浏览器不支持直接目录读取。请使用支持目录授权的 Chrome 或 Edge，或直接打开本地服务已有的项目。'))
  return picker.call(window, { mode: 'read', id: 'code-explore-package' })
}
export async function inspectDirectory(handle: DirectoryHandle): Promise<{ descriptor: ProjectDescriptor; prefix: string; warnings: string[]; unavailable: string[] }> {
  const files = new Map<string, ReadFileHandle>()
  const queue: Array<[DirectoryHandle, string]> = [[handle, '']]
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const [directory, prefix] = queue[cursor]
    for await (const [name, child] of directory.entries()) {
      const path = prefix + name
      if (!safePath(path)) throw new Error(t('目录包含不安全或重复的相对路径：{0}', path))
      if (child.kind === 'directory') queue.push([child, path + '/'])
      else files.set(path, child)
      if (files.size + queue.length > 50000) throw new Error(t('资料包文件过多，请使用本地脚本接入。'))
    }
  }
  const roots = [...files.keys()].filter(path => /(^|\/)project\.json$/.test(path)).sort((a, b) => a.split('/').length - b.split('/').length)
  if (!roots.length) throw new Error(t('所选目录没有 project.json；请先让 AI 生成标准分析资料包。'))
  if (roots[1] && roots[1].split('/').length === roots[0].split('/').length) throw new Error(t('一次只能打开一个项目资料包。'))
  const prefix = roots[0].slice(0, -'project.json'.length)
  const missing: string[] = []
  const warnings: string[] = []
  const unavailable: string[] = []
  const json = async (path: string, required = true) => {
    if (!safePath(path)) throw new Error(t('资料包资源路径越界。'))
    const handle = files.get(prefix + path)
    if (!handle) { (required ? missing : unavailable).push(path); return undefined }
    const file = await handle.getFile()
    if (file.size > 64 * 1024 * 1024) throw new Error(t('资料包文件过多，请使用本地脚本接入。'))
    try { return JSON.parse(await file.text()) } catch {
      if (required) throw new Error(t('资料包 JSON 格式无效：{0}', path))
      warnings.push(t('资料包 JSON 格式无效：{0}', path)); unavailable.push(path); return undefined
    }
  }
  const descriptor = await json('project.json') as ProjectDescriptor
  if (descriptor?.schemaVersion !== 2 || !/^[a-z0-9][a-z0-9-]*$/.test(descriptor.id) || !descriptor.name || !descriptor.shortName || !descriptor.snapshot?.id || !descriptor.snapshot.archiveSha256 || !descriptor.contentVersion || !Array.isArray(descriptor.features) || !descriptor.entries || !descriptor.source || !['source-analysis', 'document-index', 'comparison'].includes(descriptor.type)) throw new Error(t('资料包描述不完整或格式不兼容。'))
  for (const path of [...Object.values(descriptor.entries), descriptor.source.root, descriptor.report?.pdf, descriptor.report?.tex].filter(Boolean) as string[]) if (typeof path !== 'string' || !safePath(path.replace(/\/$/, ''))) throw new Error(t('资料包资源路径越界。'))
  const content = await json(descriptor.entries.content)
  const search = await json(descriptor.entries.search, false)
  if (search && !Array.isArray(search.documents)) { warnings.push(t('搜索索引不可用，其他内容仍可阅读。')); unavailable.push(descriptor.entries.search) }
  const manifest = descriptor.type === 'comparison' ? undefined : await json(descriptor.entries.manifest)
  for (const data of [content, search, manifest].filter(Boolean)) if (data.projectId !== descriptor.id || data.snapshotId !== descriptor.snapshot.id) warnings.push(t('资料包身份或快照不一致。'))
  for (const data of [search, manifest].filter(Boolean)) if (data.contentVersion && data.contentVersion !== descriptor.contentVersion) warnings.push(t('资料包索引与解读的内容版本不一致。'))
  if (content && content.package?.contentVersion !== descriptor.contentVersion) warnings.push(t('资料包索引与解读的内容版本不一致。'))
  if (!missing.length && (!content || typeof content !== 'object' || Array.isArray(content) || (descriptor.type !== 'comparison' && !manifest))) throw new Error(t('资料包描述不完整或格式不兼容。'))
  if (manifest) {
    if (!Array.isArray(manifest.files)) throw new Error(t('资料包描述不完整或格式不兼容。'))
    if (manifest.contentVersion !== descriptor.contentVersion) warnings.push(t('资料包索引与解读的内容版本不一致。'))
    for (const file of manifest.files) {
      if (typeof file.path !== 'string' || !safePath(file.path)) throw new Error(t('资料包资源路径越界。'))
      for (const path of [(descriptor.source.root ? descriptor.source.root.replace(/\/$/, '') + '/' : '') + file.path, descriptor.entries.symbols.replace(/\/$/, '') + '/' + file.path + '.json']) if (!files.has(prefix + path)) unavailable.push(path)
    }
  }
  if (descriptor.report) for (const path of [descriptor.report.pdf, descriptor.report.tex]) if (!files.has(prefix + path)) unavailable.push(path)
  if (missing.length) throw new Error(t('资料包不满足要求，未接入。缺少以下文件：') + '\n' + missing.join('\n'))
  if (descriptor.type === 'comparison') {
    const binding = descriptor.comparison
    if (!binding?.projectA || !binding.projectB || !binding.snapshotA || !binding.snapshotB || binding.projectA === binding.projectB) warnings.push(t('对比资料缺少有效的双方项目与快照绑定。'))
    if (!Array.isArray(content.references) || !content.comparison?.topics?.length || !content.comparison?.scenario || typeof content.comparison.conclusion !== 'string') warnings.push(t('对比资料缺少主题、证据、执行场景或结论。'))
  }
  for (const path of unavailable) warnings.push(t('本地资料包缺少或无法使用文件：{0}', path))
  return { descriptor, prefix, warnings: [...new Set(warnings)], unavailable: [...new Set(unavailable)] }
}
export async function importLocalDirectory(handle: DirectoryHandle, builtInIds: Set<string>): Promise<ProjectDescriptor> {
  const result = await inspectDirectory(handle)
  if (builtInIds.has(result.descriptor.id)) result.warnings.push(t('资料库已有同标识服务项目，将优先通过服务读取。'))
  const value: StoredPackage = { id: result.descriptor.id, ...result, handle }
  try { await persist(value) } catch { throw new Error(t('无法保存目录授权；请检查浏览器是否支持文件系统句柄及 IndexedDB。')) }
  mount(value)
  return result.descriptor
}
export async function reconnectDirectory(id: string): Promise<ProjectDescriptor> {
  const project = mounted.get(id)
  if (project?.value.nativeConnection) {
    const handle = await pickDirectory()
    const result = await inspectDirectory(handle)
    if (result.descriptor.id !== id) throw new Error(t('资料包身份或快照不一致。'))
    const value: StoredPackage = { id, ...result, handle }
    await persist(value); mount(value); return result.descriptor
  }
  if (!project?.value.handle) throw new Error(t('请重新选择原目录，以替换旧版浏览器副本。'))
  const handle = project.value.handle
  if (handle.requestPermission && await handle.requestPermission({ mode: 'read' }) !== 'granted') throw new Error(t('未获得目录读取权限。'))
  const result = await inspectDirectory(handle)
  if (result.descriptor.id !== id) throw new Error(t('资料包身份或快照不一致。'))
  const value: StoredPackage = { id, ...result, handle }
  await persist(value); mount(value)
  return result.descriptor
}
const HIDDEN_SERVER_KEY = 'code-explore.hidden-server-projects.v1'
export function hiddenServerProjects(): Set<string> {
  try {
    const value = JSON.parse(localStorage.getItem(HIDDEN_SERVER_KEY) || '[]')
    return new Set(Array.isArray(value) ? value.filter(id => typeof id === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(id)) : [])
  } catch { return new Set() }
}
export function hideServerProject(id: string): void {
  const hidden = hiddenServerProjects()
  hidden.add(id)
  localStorage.setItem(HIDDEN_SERVER_KEY, JSON.stringify([...hidden]))
}
export function showServerProject(id: string): void {
  const hidden = hiddenServerProjects()
  hidden.delete(id)
  localStorage.setItem(HIDDEN_SERVER_KEY, JSON.stringify([...hidden]))
}
