import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const linkQueue = []
import { ROOT, BUILD, CATALOG, SUBMISSION, readJson, writeJson } from './lib.mjs'

const dist = BUILD
const mirrorStats = { copied: 0, unchanged: 0, removed: 0, copiedDirectories: 0 }
function sameFile(source, destination) {
  if (!fs.existsSync(destination) || !fs.statSync(destination).isFile() || fs.statSync(destination).size !== fs.statSync(source).size) return false
  const left = crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex')
  const right = crypto.createHash('sha256').update(fs.readFileSync(destination)).digest('hex')
  return left === right
}
function copyFile(source, destination) {
  if (sameFile(source, destination)) {
    mirrorStats.unchanged += 1
    return
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  if (fs.existsSync(destination)) fs.rmSync(destination)
  fs.copyFileSync(source, destination)
  mirrorStats.copied += 1
}
function mirrorDirectoryFallback(source, destination) {
  fs.rmSync(destination, { recursive: true, force: true })
  fs.mkdirSync(destination, { recursive: true })
  const expected = new Set(fs.readdirSync(source))
  for (const stale of fs.readdirSync(destination).filter(name => !expected.has(name))) {
    fs.rmSync(path.join(destination, stale), { recursive: true, force: true })
    mirrorStats.removed += 1
  }
  for (const name of expected) {
    const from = path.join(source, name)
    const to = path.join(destination, name)
    const stat = fs.statSync(from)
    if (stat.isDirectory()) mirrorDirectory(from, to)
    else if (stat.isFile()) copyFile(from, to)
  }
}
function mirrorDirectory(source, destination) {
  linkQueue.push([source, destination])
}
async function flushMirrors() {
  let cursor = 0
  async function worker() {
    while (cursor < linkQueue.length) {
      const [source, destination] = linkQueue[cursor++]
      fs.rmSync(destination, { recursive: true, force: true })
      try {
        await execFileAsync('cp', ['-a', `${source}${path.sep}.`, destination])
        mirrorStats.copiedDirectories += 1
      } catch {
        mirrorDirectoryFallback(source, destination)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, linkQueue.length) }, worker))
}
const catalog = readJson(CATALOG)
for (const descriptor of catalog.projects) {
  const packageRoot = path.join(SUBMISSION, descriptor.id)
  const target = path.join(dist, 'projects', descriptor.id)
  fs.mkdirSync(target, { recursive: true })
  copyFile(path.join(packageRoot, 'project.json'), path.join(target, 'project.json'))
  if (process.env.SKIP_BULK !== '1') for (const directory of ['index', 'report']) {
    if (fs.existsSync(path.join(packageRoot, directory))) mirrorDirectory(path.join(packageRoot, directory), path.join(target, directory))
  }
  if (descriptor.type !== 'comparison' && process.env.SKIP_BULK !== '1') {
    const source = path.join(packageRoot, descriptor.source.root)
    if (!fs.existsSync(source)) throw new Error(`缺少项目源码目录：${descriptor.id}/${descriptor.source.root}`)
    mirrorDirectory(source, path.join(target, descriptor.source.root))
  }
}
copyFile(CATALOG, path.join(dist, 'projects/catalog.json'))
for (const name of ['README.md', 'VALIDATION.md', 'CHANGELOG.md']) {
  if (fs.existsSync(path.join(ROOT, name))) copyFile(path.join(ROOT, name), path.join(dist, 'docs', name))
}
await flushMirrors()
fs.copyFileSync(path.join(dist, 'index.html'), path.join(dist, '404.html'))
writeJson(path.join(dist, 'static-deploy.json'), {
  schemaVersion: 2,
  entry: 'index.html',
  routing: 'hash-based; no rewrite required',
  catalog: 'projects/catalog.json',
  projects: catalog.projects.map(descriptor => ({ id: descriptor.id, snapshot: descriptor.snapshot.id, contentVersion: descriptor.contentVersion, report: descriptor.report?.pdf || null })),
  mirrorStats,
})
console.log(`静态资料包同步：并行复制目录 ${mirrorStats.copiedDirectories}，单文件更新 ${mirrorStats.copied}，复用 ${mirrorStats.unchanged}，移除 ${mirrorStats.removed}。`)
console.log(`完整网站已就绪：${catalog.projects.length} 套资料，入口 ../dist/build/index.html。`)
