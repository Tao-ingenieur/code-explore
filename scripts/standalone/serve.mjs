import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
export function startServer(directory = path.dirname(fileURLToPath(import.meta.url)), options = {}) {
const BUILD = path.resolve(directory, 'build')
const CATALOG = path.join(BUILD, 'projects/catalog.json')
const SUBMISSION = path.resolve(directory, 'output')
function insideOutput(target) {
  return fs.realpathSync(target).startsWith(`${fs.realpathSync(SUBMISSION)}${path.sep}`)
}
function diskCatalog() {
  const projects = []
  for (const entry of fs.readdirSync(SUBMISSION, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const descriptorPath = path.join(SUBMISSION, entry.name, 'project.json')
    if (!fs.existsSync(descriptorPath)) continue
    if (!insideOutput(descriptorPath)) throw new Error('Package link escapes output')
    const descriptor = JSON.parse(fs.readFileSync(descriptorPath, 'utf8'))
    if (descriptor.schemaVersion !== 2 || descriptor.id !== entry.name || !/^[a-z0-9][a-z0-9-]*$/.test(descriptor.id)) throw new Error(`无效的资料包描述：${entry.name}/project.json`)
    projects.push(descriptor)
  }
  projects.sort((a, b) => a.id.localeCompare(b.id))
  return { schemaVersion: 2, generatedBy: 'local-service', projects }
}

const portIndex = process.argv.indexOf('--port')
const port = options.port ?? Number(portIndex >= 0 ? process.argv[portIndex + 1] : process.env.PORT || 4173)
const root = BUILD
if (!fs.existsSync(path.join(root, 'index.html'))) throw new Error('缺少 build/index.html，请先在源码仓库运行 npm run build:app，再携带 dist 目录运行。')
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.ts': 'text/plain; charset=utf-8', '.tsx': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8', '.tex': 'text/plain; charset=utf-8', '.pdf': 'application/pdf',
  '.py': 'text/plain; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2',
}
const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', 'http://localhost')
    const decoded = decodeURIComponent(url.pathname)
    if (decoded === '/projects/catalog.json' && fs.existsSync(SUBMISSION)) {
      const body = JSON.stringify(diskCatalog())
      response.writeHead(200, { 'Content-Type': mime['.json'], 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
      response.end(request.method === 'HEAD' ? undefined : body)
      return
    }
    let target = path.resolve(root, `.${decoded === '/' ? '/index.html' : decoded}`)
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
      response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
      response.end('Forbidden')
      return
    }
    // An existing output package is authoritative, including missing files.
    // Static-only deployments can still read their build/projects copy.
    if (decoded.startsWith('/projects/')) {
      const relative = decoded.slice('/projects/'.length)
      const packageTarget = path.resolve(SUBMISSION, relative)
      if (!packageTarget.startsWith(`${SUBMISSION}${path.sep}`)) {
        response.writeHead(403)
        response.end('Forbidden')
        return
      }
      const projectId = relative.split('/')[0]
      if (relative === 'catalog.json') target = CATALOG
      else if (fs.existsSync(path.join(SUBMISSION, projectId))) target = packageTarget
      if (fs.existsSync(target)) {
        const allowedRoot = relative === 'catalog.json' ? path.dirname(CATALOG) : target === packageTarget ? SUBMISSION : BUILD
        const realTarget = fs.realpathSync(target)
        if (!realTarget.startsWith(`${fs.realpathSync(allowedRoot)}${path.sep}`)) {
          response.writeHead(403)
          response.end('Forbidden')
          return
        }
      }
    }
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      if (!path.extname(decoded)) target = path.join(root, 'index.html')
      else {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        response.end(`Not found: ${decoded}`)
        return
      }
    }
    const stat = fs.statSync(target)
    response.writeHead(200, {
      'Content-Type': mime[path.extname(target)] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    })
    if (request.method === 'HEAD') response.end()
    else fs.createReadStream(target).pipe(response)
  } catch (error) {
    response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end(error instanceof Error ? error.message : 'Bad request')
  }
})
server.listen(port, '127.0.0.1', () => {
  console.log(`Code Explore / 源码导航：http://127.0.0.1:${server.address().port}/`)
  console.log(`网站目录：${BUILD}`)
  console.log(`资料目录：${SUBMISSION}；按 Ctrl+C 停止。`)
})
server.on('error', error => {
  console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已被占用，请关闭旧服务或通过 --port 更换端口。` : error.message)
  process.exitCode = 1
})
if (options.handleSignals !== false) for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)))
}

return server
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) startServer()
