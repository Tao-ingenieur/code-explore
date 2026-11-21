import type { Catalog, ProjectDescriptor } from './types'
export function matchingComparisons(catalog: Catalog, a: ProjectDescriptor, b: ProjectDescriptor): ProjectDescriptor[] {
  return catalog.projects.filter(item => item.type === 'comparison' && item.comparison?.projectA === a.id && item.comparison.projectB === b.id && item.comparison.snapshotA === a.snapshot.id && item.comparison.snapshotB === b.snapshot.id)
}
export function pairHash(a: ProjectDescriptor, b: ProjectDescriptor): string {
  return '#/compare?' + new URLSearchParams({ a: a.id, b: b.id, sa: a.snapshot.id, sb: b.snapshot.id })
}
