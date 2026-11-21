import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const PYTHON = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3')

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const DIST = path.resolve(ROOT, '../dist')
export const BUILD = path.join(DIST, 'build')
export const VALIDATION = path.join(DIST, 'validation')
export const CATALOG = path.join(BUILD, 'projects/catalog.json')
export const SUBMISSION = path.join(DIST, 'output')

export function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : fallback
}

export function projectDirectory(id = argument('project')) {
  if (!id || !/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error('请通过 --project <有效项目标识> 指定资料包。')
  const directory = path.resolve(SUBMISSION, id)
  if (path.dirname(directory) !== SUBMISSION) throw new Error('项目目录越界。')
  return directory
}

export function projectSource(project) {
  const descriptor = readJson(path.join(project, 'project.json'))
  const root = path.resolve(project, descriptor.source?.root || 'source')
  if (root !== project && !root.startsWith(`${project}${path.sep}`)) throw new Error('源码根目录越界。')
  return { descriptor, root }
}

export function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(`JSON 解析失败：${file}（${error instanceof Error ? error.message : error}）`)
  }
}

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.tmp-${process.pid}`
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`)
    fs.renameSync(temporary, file)
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true })
  }
}

export function toPosix(value) {
  return value.split(path.sep).join('/')
}

export function walkFiles(root) {
  const result = []
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) walk(absolute)
      else if (entry.isFile()) result.push(absolute)
    }
  }
  walk(root)
  return result.sort((a, b) => toPosix(path.relative(root, a)).localeCompare(toPosix(path.relative(root, b))))
}

export function assetUrl(...parts) {
  return parts.join('/').split('/').map(encodeURIComponent).join('/')
}

export const STATUS_LABELS = {
  indexed: '已索引',
  summary: '已概述',
  deep: '已深入分析',
  pending: '待验证',
}
