import { defineConfig, type Plugin } from 'vite'
import fs from 'node:fs'
import path from 'node:path'

const navigatorRoot = path.resolve(__dirname)
const submissionRoot = path.resolve(navigatorRoot, '../dist/output')
const buildRoot = path.resolve(navigatorRoot, '../dist/build')
const mime: Record<string, string> = {
  '.json': 'application/json; charset=utf-8', '.ts': 'text/plain; charset=utf-8', '.tsx': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8', '.pdf': 'application/pdf', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.woff2': 'font/woff2', '.tex': 'text/plain; charset=utf-8',
}

function projectPackages(): Plugin {
  return {
    name: 'isolated-project-packages',
    closeBundle() {
      fs.copyFileSync(path.join(navigatorRoot, 'scripts/standalone/serve.mjs'), path.resolve(buildRoot, '../serve.mjs'))
      fs.copyFileSync(path.join(navigatorRoot, 'scripts/standalone/package-checks.mjs'), path.resolve(buildRoot, '../package-checks.mjs'))
      fs.copyFileSync(path.join(navigatorRoot, 'scripts/standalone/README.md'), path.resolve(buildRoot, '../README.md'))
      fs.mkdirSync(path.join(buildRoot, 'docs'), { recursive: true })
      for (const name of ['agent-prompt.md', 'comparison-prompt.md']) fs.copyFileSync(path.join(navigatorRoot, 'docs', name), path.join(buildRoot, 'docs', name))
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (!request.url?.startsWith('/projects/')) return next()
        try {
          const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
          if (pathname === '/projects/catalog.json') {
            response.setHeader('Content-Type', mime['.json'])
            fs.createReadStream(path.join(buildRoot, 'projects/catalog.json')).pipe(response)
            return
          }
          const parts = pathname.split('/').filter(Boolean)
          const projectId = parts[1]
          if (!/^[a-z0-9][a-z0-9-]*$/.test(projectId) || parts.includes('..')) {
            response.statusCode = 400
            response.end('Invalid package path')
            return
          }
          const packageRoot = path.resolve(submissionRoot, projectId)
          const target = path.resolve(packageRoot, parts.slice(2).join('/'))
          if (!target.startsWith(`${packageRoot}${path.sep}`) || !fs.existsSync(target) || !fs.statSync(target).isFile()) return next()
          const realTarget = fs.realpathSync(target)
          if (!realTarget.startsWith(`${fs.realpathSync(packageRoot)}${path.sep}`)) {
            response.statusCode = 403
            response.end('Package link escapes source root')
            return
          }
          response.setHeader('Content-Type', mime[path.extname(target)] || 'application/octet-stream')
          response.setHeader('X-Content-Type-Options', 'nosniff')
          fs.createReadStream(target).pipe(response)
        } catch {
          response.statusCode = 400
          response.end('Invalid package URL')
        }
      })
    },
  }
}

export default defineConfig(() => ({
  base: './',
  publicDir: false,
  plugins: [projectPackages()],
  build: {
    outDir: buildRoot,
    target: 'es2022',
    sourcemap: false,
    emptyOutDir: false,
    chunkSizeWarningLimit: 700,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
}))
