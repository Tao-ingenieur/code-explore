export type Status = 'indexed' | 'summary' | 'deep' | 'pending'
export type Confidence = 'source' | 'inference' | 'runtime'

export interface SourceInfo {
  label: string
  commit: string | null
  snapshotSha256: string
  treeSha256: string
  scope: string
  suppliedFiles: number
  includedFiles: number
  totalLines: number
  runtimeStatus: string
  runtimeNote: string
  parseErrorCount: number
  duplicateGroups: string[][]
  generatedExclusions: string[]
}

export interface Project {
  title: string
  subtitle: string
  contentVersion: string
  analysisDate: string
  source: SourceInfo
  method: string[]
  exclusions: Array<{ path: string; kind: string; reason: string }>
  policies: string[]
}

export interface FileRecord {
  path: string
  name: string
  extension: string
  module: string
  moduleLabel: string
  purpose: string
  status: Status
  statusLabel: string
  analysisDepth: string
  verification: string
  unresolved: string[]
  bytes: number
  lines: number
  longestLine: number
  sha256: string
  symbolCount: number
  dependencies: string[]
  externalDependencies: string[]
  unresolvedDependencies: string[]
  dynamicImportCount: number
  parseErrors: Array<{ line: number; message: string }>
  relatedChapters: string[]
  annotationCount: number
  coverageClass?: string
  deepEligible?: boolean
  preview?: 'text' | 'markdown' | 'image' | 'binary'
  encoding?: string
  unsupportedReason?: string
  symlinkTarget?: string | null
}

export interface ModuleRecord {
  id: string
  label: string
  path: string
  description: string
  files: number
  lines: number
}

export interface Manifest {
  schemaVersion: number
  projectId?: string
  snapshotId?: string
  contentVersion: string
  source: SourceInfo
  stats: {
    files: number
    totalLines: number
    symbols: number
    parseErrorCount: number
    statusCounts: Record<Status, number>
    eligibleStatusCounts?: Record<Status, number>
    coverageClassCounts?: Record<string, number>
  }
  modules: ModuleRecord[]
  statusLabels: Record<Status, string>
  files: FileRecord[]
}

export interface SymbolRecord {
  id: string
  name: string
  qualifiedName: string
  kind: string
  path: string
  startLine: number
  endLine: number
  exported: boolean
  async: boolean
}

export interface SourceReference {
  id: string
  path: string
  start: number
  end: number
  symbol?: string
  label: string
  claim: string
  confidence: Confidence
}

export type ContentBlock =
  | { type: 'p'; text: string }
  | { type: 'list'; items: string[]; ordered?: boolean }
  | { type: 'callout'; title: string; text: string; tone: Confidence | 'warning' }
  | { type: 'table'; columns: string[]; rows: string[][] }
  | { type: 'code'; text: string; label?: string }

export interface ChapterSection {
  id: string
  title: string
  lead?: string
  body: ContentBlock[]
  evidence: string[]
}

export interface Chapter {
  id: string
  order: number
  kicker: string
  title: string
  summary: string
  scope: 'deep' | 'summary'
  sections: ChapterSection[]
}

export interface SymbolAnnotation {
  path: string
  symbol: string
  startLine?: number
  symbolId: string | null
  chapter: string
  section: string
  summary: string
}

export interface FlowBranch {
  id: string
  label: string
  condition: string
  outcome: string
  evidence: string
  tone: 'success' | 'failure' | 'denied' | 'cancelled' | 'info'
}

export interface FlowStep {
  id: string
  title: string
  short: string
  description: string
  path: string
  startLine: number
  endLine: number
  symbol: string
  chapter: string
  section: string
  inputs: string
  outputs: string
  branches: FlowBranch[]
}

export interface CaseStep {
  id: string
  stage: string
  title: string
  narrative: string
  evidence: string[]
  observation: string
  confidence: Confidence
}

export interface CoreContent {
  schemaVersion: number
  projectId?: string
  snapshotId?: string
  package?: ProjectDescriptor
  project: Project
  chapters: Chapter[]
  references: SourceReference[]
  flow: { id?: string; title: string; summary: string; steps: FlowStep[] }
  flows?: Array<{ id: string; title: string; summary: string; steps: FlowStep[] }>
  caseStudy: {
    title: string
    task: string
    premise: string
    steps: CaseStep[]
    alternatives: FlowBranch[]
    conclusion: string
  }
  annotations: SymbolAnnotation[]
}

export interface SearchDocument {
  id: string
  kind: 'file' | 'symbol' | 'analysis'
  symbolKind?: string
  title: string
  path?: string
  startLine?: number
  endLine?: number
  chapter?: string
  section?: string
  subtitle: string
  body: string
}

export interface Route {
  name: string
  params: URLSearchParams
  projectId?: string
  snapshot?: string
}

export interface AppContext {
  manifest: Manifest
  content: CoreContent
  descriptor: ProjectDescriptor
}

export interface ProjectDescriptor {
  schemaVersion: number
  id: string
  name: string
  shortName: string
  type: 'source-analysis' | 'comparison' | 'document-index'
  contentVersion: string
  analysisLevel: 'deep' | 'indexed' | 'comparison'
  snapshot: {
    id: string
    version: string | null
    commit: string | null
    archiveSha256: string
    treeSha256: string | null
    suppliedFiles: number
    includedFiles: number
    totalLines?: number
    parseErrorCount?: number
    duplicateGroups?: string[][]
    symlinkCount?: number
    packageManager?: string
    license?: string
  }
  source: {
    root: string
    defaultFile: string
    language: string
    licenseNote: string
  }
  entries: {
    manifest: string
    content: string
    search: string
    symbols: string
  }
  report: null | { title: string; pdf: string; tex: string }
  features: string[]
  analysisDate: string
  import?: Record<string, unknown>
  comparison?: {
    projectA: string
    projectB: string
    snapshotA: string
    snapshotB: string
  }
}

export interface PackageCheck {
  warnings: Array<{ message: string; args?: string[] }>
  unavailable: string[]
}

export interface Catalog {
  schemaVersion: number
  generatedBy: string
  projects: ProjectDescriptor[]
  packageChecks?: Record<string, PackageCheck>
}
