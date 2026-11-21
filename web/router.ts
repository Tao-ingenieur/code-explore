import type { ProjectDescriptor, Route, SourceReference } from './types'
import { savePosition } from './positions'

let activeProject: { id: string; snapshot: string } | null = null

export function setActiveProject(descriptor: ProjectDescriptor | null): void {
  activeProject = descriptor ? { id: descriptor.id, snapshot: descriptor.snapshot.id } : null
}

export function parseRoute(): Route {
  const raw = location.hash.slice(1) || '/projects'
  const question = raw.indexOf('?')
  const pathname = question >= 0 ? raw.slice(0, question) : raw
  const params = new URLSearchParams(question >= 0 ? raw.slice(question + 1) : '')
  const projectMatch = /^\/p\/([a-z0-9][a-z0-9-]*)(\/[^?]*)?$/.exec(pathname)
  if (projectMatch) {
    return { name: (projectMatch[2] || '/overview').replace(/\/$/, '') || '/overview', params, projectId: projectMatch[1], snapshot: params.get('snapshot') || undefined }
  }
  const comparisonMatch = /^\/compare\/([a-z0-9][a-z0-9-]*)$/.exec(pathname)
  if (comparisonMatch) return { name: '/compare', params, projectId: comparisonMatch[1], snapshot: params.get('snapshot') || undefined }
  const legacyViews = new Set(['/overview', '/files', '/search', '/guide', '/flow', '/case', '/coverage'])
  if (legacyViews.has(pathname)) return { name: '/projects', params: new URLSearchParams() }
  return { name: pathname.replace(/\/$/, '') || '/projects', params, snapshot: params.get('snapshot') || undefined }
}

function queryFor(params: Record<string, string | number | undefined>, snapshot?: string): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') query.set(key, String(value))
  }
  if (snapshot && !query.has('snapshot')) query.set('snapshot', snapshot)
  const suffix = query.toString()
  return suffix ? `?${suffix}` : ''
}

export function hashForProject(projectId: string, snapshot: string, name: string, params: Record<string, string | number | undefined> = {}): string {
  if (name === '/compare') return `#/compare/${projectId}${queryFor(params, snapshot)}`
  return `#/p/${projectId}${name}${queryFor(params, snapshot)}`
}

export function hashFor(name: string, params: Record<string, string | number | undefined> = {}, projectId?: string): string {
  if (name === '/projects') return '#/projects'
  const id = projectId || activeProject?.id
  if (!id) return '#/projects'
  const snapshot = id === activeProject?.id ? activeProject.snapshot : undefined
  return hashForProject(id, snapshot || '', name, params)
}

export function sourceHash(
  reference: { path: string; start?: number; end?: number; symbol?: string },
  context?: { chapter?: string; section?: string },
): string {
  return hashFor('/files', {
    path: reference.path,
    line: reference.start,
    end: reference.end !== reference.start ? reference.end : undefined,
    symbol: reference.symbol,
    chapter: context?.chapter,
    section: context?.section,
  })
}

export function referenceHash(reference: SourceReference, chapter?: string, section?: string): string {
  return sourceHash({ path: reference.path, start: reference.start, end: reference.end, symbol: reference.symbol }, { chapter, section })
}

export function guideHash(chapter: string, section?: string): string {
  return hashFor('/guide', { chapter, section })
}

export function navigate(name: string, params: Record<string, string | number | undefined> = {}): void {
  const next = hashFor(name, params)
  if (location.hash === next) dispatchEvent(new HashChangeEvent('hashchange'))
  else location.hash = next
}

export function replaceHash(name: string, params: Record<string, string | number | undefined> = {}): void {
  history.replaceState(null, '', hashFor(name, params))
  if (activeProject) savePosition(activeProject.id, activeProject.snapshot, location.hash)
  dispatchEvent(new Event('reading-position'))
}
