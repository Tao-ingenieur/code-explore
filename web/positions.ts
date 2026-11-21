const RECENT_KEY = 'source-atlas.recent.v2'
const POSITION_PREFIX = 'source-atlas.position.v2.'

export interface RecentProject {
  id: string
  snapshot: string
  lastOpened: number
  lastHash?: string
}

function read<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key)
    return value ? JSON.parse(value) as T : fallback
  } catch {
    return fallback
  }
}
function write(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* Private browsing can disable persistence. */ }
}

export function recentProjects(): RecentProject[] {
  return read<RecentProject[]>(RECENT_KEY, []).filter(item => item && typeof item.id === 'string' && typeof item.snapshot === 'string')
}

export function rememberOpened(projectId: string, snapshot: string, hash?: string): void {
  const recent = recentProjects().filter(item => item.id !== projectId)
  recent.unshift({ id: projectId, snapshot, lastOpened: Date.now(), lastHash: hash })
  write(RECENT_KEY, recent.slice(0, 12))
}

export function savePosition(projectId: string, snapshot: string, hash: string): void {
  if (!hash.startsWith('#/')) return
  write(`${POSITION_PREFIX}${projectId}@${snapshot}`, { hash, updatedAt: Date.now() })
  const recent = recentProjects()
  const current = recent.find(item => item.id === projectId)
  if (current) {
    current.lastHash = hash
    current.lastOpened = Date.now()
    current.snapshot = snapshot
    write(RECENT_KEY, [current, ...recent.filter(item => item.id !== projectId)])
  }
}

export function savedPosition(projectId: string, snapshot: string): string | undefined {
  const value = read<{ hash?: string }>(`${POSITION_PREFIX}${projectId}@${snapshot}`, {})
  return typeof value.hash === 'string' && value.hash.includes(encodeURIComponent(projectId)) ? value.hash : undefined
}

export function lastOpenedProject(): RecentProject | undefined {
  return recentProjects()[0]
}

export function clearPosition(projectId: string, snapshot: string): void {
  try { localStorage.removeItem(`${POSITION_PREFIX}${projectId}@${snapshot}`) } catch { /* Storage is optional. */ }
  write(RECENT_KEY, recentProjects().filter(item => item.id !== projectId))
}
const RETURN_KEY = 'code-explore.comparison-return'
export function rememberComparisonOrigin(): void {
  if (location.hash.startsWith('#/compare/')) return
  try { sessionStorage.setItem(RETURN_KEY, location.hash.startsWith('#/p/') ? location.hash : '#/projects') } catch { /* Storage is optional. */ }
}
export function comparisonOrigin(): string {
  try {
    const value = sessionStorage.getItem(RETURN_KEY)
    return value?.startsWith('#/p/') ? value : '#/projects'
  } catch { return '#/projects' }
}
