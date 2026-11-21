import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
const exports = {}
const source = fs.readFileSync(new URL('../web/comparison-selection.ts', import.meta.url), 'utf8')
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, URLSearchParams })
const a = { id: 'first', snapshot: { id: 'snapshot:a' } }
const b = { id: 'second', snapshot: { id: 'snapshot:b' } }
const good = { id: 'pair', type: 'comparison', comparison: { projectA: a.id, projectB: b.id, snapshotA: a.snapshot.id, snapshotB: b.snapshot.id } }
test('topic packages match both IDs, role order and snapshots', () => {
  const catalog = { projects: [good, { ...good, id: 'stale', comparison: { ...good.comparison, snapshotB: 'old' } }] }
  assert.deepEqual(Array.from(exports.matchingComparisons(catalog, a, b), item => item.id), ['pair'])
  assert.equal(exports.matchingComparisons(catalog, b, a).length, 0)
})
test('any two projects produce a shareable snapshot-bound pair link', () => {
  const hash = exports.pairHash(a, b)
  const query = new URLSearchParams(hash.split('?')[1])
  assert.equal(query.get('a'), a.id); assert.equal(query.get('b'), b.id)
  assert.equal(query.get('sa'), a.snapshot.id); assert.equal(query.get('sb'), b.snapshot.id)
})
