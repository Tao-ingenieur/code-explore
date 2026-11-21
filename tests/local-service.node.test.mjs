import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { startServer } from '../scripts/standalone/serve.mjs'

test('local service discovers output packages and reads current disk files instead of stale build copies', async () => {
  const parent = fileURLToPath(new URL('../../dist/validation/', import.meta.url))
  fs.mkdirSync(parent, { recursive: true })
  const root = fs.mkdtempSync(path.join(parent, 'local-service-'))
  const write = (relative, content) => {
    const target = path.join(root, relative)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content)
  }
  write('build/index.html', '<h1>app</h1>')
  write('build/projects/catalog.json', JSON.stringify({ schemaVersion: 2, projects: [] }))
  write('build/projects/sample/source/main.ts', 'stale source')
  write('output/sample/project.json', JSON.stringify({ schemaVersion: 2, id: 'sample', name: 'Sample' }))
  write('output/sample/source/main.ts', 'current source')
  const server = startServer(root, { port: 0, handleSignals: false })
  try {
    await once(server, 'listening')
    const base = `http://127.0.0.1:${server.address().port}`
    const catalog = async () => (await fetch(base + '/projects/catalog.json')).json()
    assert.deepEqual((await catalog()).projects.map(p => p.id), ['sample'])
    const sourceUrl = base + '/projects/sample/source/main.ts'
    assert.equal(await (await fetch(sourceUrl)).text(), 'current source')
    write('output/sample/source/main.ts', 'updated source')
    assert.equal(await (await fetch(sourceUrl)).text(), 'updated source')
    write('output/second/project.json', JSON.stringify({ schemaVersion: 2, id: 'second' }))
    assert.equal((await catalog()).projects.length, 2)
    fs.unlinkSync(path.join(root, 'output/sample/source/main.ts'))
    assert.equal((await fetch(sourceUrl)).status, 404, 'missing disk files must not fall back to stale build data')
    fs.renameSync(path.join(root, 'output'), path.join(root, 'output-disabled'))
    assert.deepEqual((await catalog()).projects, [])
    assert.equal(await (await fetch(sourceUrl)).text(), 'stale source', 'static-only deployments remain supported')
  } finally {
    await new Promise(resolve => server.close(resolve))
    assert.equal(path.dirname(root), path.resolve(parent))
    fs.rmSync(root, { recursive: true, force: true })
  }
})
