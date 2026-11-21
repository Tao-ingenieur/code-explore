import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import ts from 'typescript'

const source = fs.readFileSync(new URL('../web/local-packages.ts', import.meta.url), 'utf8')
function createApp() {
  const saved = new Map()
  const storage = new Map()
  const indexedDB = { open() {
    const request = {}
    queueMicrotask(() => {
      request.result = { createObjectStore() {}, close() {}, transaction() {
        const tx = { objectStore() { return {
          getAll() { const read = {}; queueMicrotask(() => { read.result = [...saved.values()]; read.onsuccess() }); return read },
          put(value) { saved.set(value.id, value); queueMicrotask(() => tx.oncomplete()) },
          delete(id) { saved.delete(id); queueMicrotask(() => tx.oncomplete()) },
        } } }
        return tx
      } }
      request.onupgradeneeded(); request.onsuccess()
    })
    return request
  } }
  const exports = {}
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, {
    exports, indexedDB, Blob, URL, document: { baseURI: 'http://localhost/app/' },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    require: () => ({ t: (key, ...values) => key.replace(/\{(\d+)\}/g, (_, n) => String(values[n])) }),
  })
  return { ...exports, saved }
}
test('server projects supersede saved directory permissions and use HTTP, including after explicit reconnect', async () => {
  const app = createApp()
  const d = descriptor()
  let permissionChecks = 0
  app.saved.set(d.id, { id: d.id, descriptor: d, handle: { async queryPermission() { permissionChecks++; return 'prompt' } } })
  app.hideServerProject(d.id)
  const exports = {}
  const requested = []
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../web/data.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, URL, Response, document: { baseURI: 'http://localhost/app/' },
    require: name => name === './local-packages' ? app : { t: key => key },
    fetch: async url => {
      requested.push(url)
      return new Response(url.endsWith('catalog.json') ? JSON.stringify({ schemaVersion: 2, projects: [d] }) : 'server source')
    },
  })
  const catalog = await exports.loadCatalog()
  assert.equal(catalog.projects.length, 1)
  assert.equal(app.isLocalPackage(d.id), false)
  assert.equal(app.needsDirectoryPermission(d.id), false)
  assert.equal(permissionChecks, 0)
  assert.equal(await exports.loadSource(d.id, 'main.ts'), 'server source')
  assert.ok(requested.includes('http://localhost/app/projects/sample/source/main.ts'))
  assert.ok(app.saved.has(d.id), 'old registration is retained without requesting its permission')
  await app.importLocalDirectory(makeDirectory().handle, new Set([d.id]))
  await exports.updateLibraryProject({ ...d, name: 'directory override' })
  assert.equal(app.isLocalPackage(d.id), false)
  assert.equal(catalog.projects[0].name, d.name)
  await exports.removeLibraryProject(d.id)
  assert.equal(catalog.projects.length, 0)
  assert.equal(app.saved.has(d.id), false, 'explicit removal clears the old registration so migration cannot restore it again')
  await app.restoreLocalPackages(new Set([d.id]))
  assert.equal(app.hiddenServerProjects().has(d.id), true)
})

test('hidden server projects without a retained directory registration stay hidden', async () => {
  const app = createApp()
  app.hideServerProject('sample')
  await app.restoreLocalPackages(new Set(['sample']))
  assert.equal(app.hiddenServerProjects().has('sample'), true)
})
function descriptor() {
  return { schemaVersion: 2, id: 'sample', name: 'Sample', shortName: 'Sample', type: 'source-analysis', analysisLevel: 'indexed', contentVersion: '1', snapshot: { id: 'snapshot-1', archiveSha256: 'test' }, source: { root: 'source', language: 'TypeScript' }, entries: { manifest: 'index/manifest.json', content: 'index/content.json', search: 'index/search.json', symbols: 'index/symbols/' }, report: null, features: ['files'] }
}
function makeDirectory(transform = () => {}) {
  const d = descriptor()
  const entries = new Map([['project.json', JSON.stringify(d)], ['source/main.ts', 'export const value = 1;\n'], ['index/symbols/main.ts.json', '[]']])
  entries.set('index/manifest.json', JSON.stringify({ projectId: d.id, snapshotId: d.snapshot.id, contentVersion: d.contentVersion, files: [{ path: 'main.ts' }] }))
  entries.set('index/content.json', JSON.stringify({ projectId: d.id, snapshotId: d.snapshot.id, package: d }))
  entries.set('index/search.json', JSON.stringify({ projectId: d.id, snapshotId: d.snapshot.id, documents: [] }))
  transform(entries)
  const directory = (prefix = '') => ({
    kind: 'directory', name: prefix || 'sample',
    async queryPermission() { return 'granted' }, async requestPermission() { return 'granted' },
    async *entries() {
      const names = new Set([...entries.keys()].filter(path => path.startsWith(prefix)).map(path => path.slice(prefix.length).split('/')[0]))
      for (const name of names) {
        if (entries.has(prefix + name)) yield [name, { kind: 'file', async getFile() { return new File([entries.get(prefix + name)], name) } }]
        else yield [name, directory(prefix + name + '/')]
      }
    },
    async getDirectoryHandle(name) { return directory(prefix + name + '/') },
    async getFileHandle(name) {
      if (!entries.has(prefix + name)) throw new Error('Missing file')
      return { kind: 'file', async getFile() { return new File([entries.get(prefix + name)], name) } }
    },
  })
  return { handle: directory(), entries }
}

test('new connections store only handle/metadata and read changed original files on demand', async () => {
  const app = createApp()
  const directory = makeDirectory()
  assert.equal((await app.importLocalDirectory(directory.handle, new Set())).id, 'sample')
  const stored = app.saved.get('sample')
  assert.ok(stored.handle)
  assert.equal(Object.hasOwn(stored, 'files'), false)
  const url = app.localAsset('sample', 'source/main.ts')
  assert.equal(await (await app.readDirectoryAsset(url)).text(), 'export const value = 1;\n')
  directory.entries.set('source/main.ts', 'export const value = 2;\n')
  assert.equal(await (await app.readDirectoryAsset(url)).text(), 'export const value = 2;\n')
  assert.equal((await app.restoreLocalPackages(new Set())).length, 1)
  await app.removeLocalPackage('sample')
  assert.equal(app.isLocalPackage('sample'), false)
  assert.equal(directory.entries.get('source/main.ts'), 'export const value = 2;\n')
})

test('missing project.json and unsafe directory paths are rejected', async () => {
  await assert.rejects(createApp().importLocalDirectory(makeDirectory(files => files.delete('project.json')).handle, new Set()), /project.json/)
  await assert.rejects(createApp().importLocalDirectory(makeDirectory(files => files.set('../escape.txt', 'bad')).handle, new Set()), /不安全/)
})

test('missing source, symbols, search and reports warn without blocking reading', async () => {
  const app = createApp()
  const directory = makeDirectory(files => {
    files.delete('source/main.ts'); files.delete('index/symbols/main.ts.json'); files.delete('index/search.json')
    const d = descriptor(); d.report = { pdf: 'report/missing.pdf', tex: 'report/missing.tex' }; files.set('project.json', JSON.stringify(d))
  })
  await app.importLocalDirectory(directory.handle, new Set())
  for (const name of ['source/main.ts', 'index/symbols/main.ts.json', 'index/search.json', 'report/missing.pdf']) assert.ok(app.packageWarnings('sample').some(w => w.includes(name)))
  assert.deepEqual(JSON.parse(await (await app.readDirectoryAsset(app.localAsset('sample', 'index/search.json'))).text()), { documents: [] })
  assert.deepEqual(JSON.parse(await (await app.readDirectoryAsset(app.localAsset('sample', 'index/symbols/main.ts.json'))).text()), [])
  assert.ok(await app.readDirectoryAsset(app.localAsset('sample', 'index/content.json')))
  await assert.rejects(app.readDirectoryAsset(app.localAsset('sample', 'source/main.ts')), /Missing file/)
  await app.restoreLocalPackages(new Set()); assert.ok(app.packageWarnings('sample').length)
})

test('essential entries and unsafe paths block, identity/version differences only warn', async () => {
  const duplicate = createApp()
  await duplicate.importLocalDirectory(makeDirectory().handle, new Set(['sample']))
  assert.ok(duplicate.packageWarnings('sample').some(w => /同标识/.test(w)))
  for (const name of ['index/content.json', 'index/manifest.json']) await assert.rejects(createApp().importLocalDirectory(makeDirectory(files => files.delete(name)).handle, new Set()), /缺少/)
  const app = createApp()
  await app.importLocalDirectory(makeDirectory(files => files.set('index/content.json', JSON.stringify({ projectId: 'sample', snapshotId: 'other' }))).handle, new Set())
  assert.ok(app.packageWarnings('sample').some(w => /快照不一致/.test(w)))
  const malformed = createApp()
  await malformed.importLocalDirectory(makeDirectory(files => files.set('index/search.json', '{bad')).handle, new Set())
  assert.ok(malformed.packageWarnings('sample').some(w => /JSON/.test(w)))
})

test('entry path escape and multiple package roots are rejected', async () => {
  await assert.rejects(createApp().importLocalDirectory(makeDirectory(files => { const d = descriptor(); d.entries.content = '../outside.json'; files.set('project.json', JSON.stringify(d)) }).handle, new Set()), /越界/)
  await assert.rejects(createApp().importLocalDirectory(makeDirectory(files => { const d = files.get('project.json'); files.delete('project.json'); files.set('one/project.json', d); files.set('two/project.json', d) }).handle, new Set()), /一次只能/)
})

test('permission loss shows a reconnect state and can be reauthorized', async () => {
  const app = createApp()
  const directory = makeDirectory()
  await app.importLocalDirectory(directory.handle, new Set())
  directory.handle.queryPermission = async () => 'prompt'
  await app.restoreLocalPackages(new Set())
  assert.equal(app.needsDirectoryPermission('sample'), true)
  await assert.rejects(app.readDirectoryAsset(app.localAsset('sample', 'source/main.ts')), /重新授权/)
  await app.reconnectDirectory('sample')
  assert.equal(app.needsDirectoryPermission('sample'), false)
})


test('legacy native connections require browser reauthorization and remain removable', async () => {
  const app = createApp()
  app.saved.set('sample', { id: 'sample', descriptor: descriptor(), prefix: '', nativeConnection: { token: 'retired', name: 'sample' } })
  assert.equal((await app.restoreLocalPackages(new Set())).length, 1)
  assert.equal(app.needsDirectoryPermission('sample'), true)
  assert.throws(() => app.localAsset('sample', 'source/main.ts'), /重新授权/)
  await app.removeLocalPackage('sample')
  assert.equal(app.saved.size, 0)
})

function diskDirectory(directory) {
  return { kind: 'directory', name: path.basename(directory),
    async *entries() {
      for (const item of await fs.promises.readdir(directory, { withFileTypes: true })) {
        const full = path.join(directory, item.name)
        if (item.isDirectory()) yield [item.name, diskDirectory(full)]
        else if (item.isFile()) yield [item.name, { kind: 'file', async getFile() { return new File([await fs.promises.readFile(full)], item.name) } }]
      }
    },
    async getDirectoryHandle(name) { return diskDirectory(path.join(directory, name)) },
    async getFileHandle(name) { const full = path.join(directory, name); return { kind: 'file', async getFile() { return new File([await fs.promises.readFile(full)], name) } } },
  }
}
test('available output packages remain importable without changing their contents', async t => {
  const output = new URL('../../dist/output/', import.meta.url)
  const directories = fs.existsSync(output) ? fs.readdirSync(output, { withFileTypes: true }).filter(entry => entry.isDirectory() && fs.existsSync(new URL(entry.name + '/project.json', output))) : []
  if (!directories.length) { t.skip('No external packages available'); return }
  const { fileURLToPath } = await import('node:url')
  for (const entry of directories) {
    const directory = new URL(entry.name + '/', output)
    const expected = JSON.parse(fs.readFileSync(new URL('project.json', directory), 'utf8'))
    const app = createApp()
    const imported = await app.importLocalDirectory(diskDirectory(fileURLToPath(directory)), new Set())
    assert.equal(imported.id, expected.id)
    t.diagnostic(expected.id + ': imported, ' + app.packageWarnings(expected.id).length + ' warnings')
  }
})
