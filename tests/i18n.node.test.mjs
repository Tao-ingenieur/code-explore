import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
function compile(relative) {
  return ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
}
const dictionaryModule = { exports: {} }
vm.runInNewContext(compile('web/translations.ts'), { exports: dictionaryModule.exports })
const english = dictionaryModule.exports.english
function load(language) {
  const stored = new Map(language ? [['code-explore.language', language]] : [])
  const document = { documentElement: { lang: '' }, title: '' }
  const exports = {}
  vm.runInNewContext(compile('web/i18n.ts'), {
    exports, document,
    localStorage: { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value) },
    require: () => ({ english }),
  })
  return { ...exports, stored, document }
}

test('language defaults, brand names and persisted preference', () => {
  const app = load()
  assert.equal(app.getLanguage(), 'zh')
  assert.equal(app.t('源码导航'), '源码导航')
  app.setLanguage('en')
  assert.equal(app.t('源码导航'), 'Code Explore')
  assert.equal(app.document.documentElement.lang, 'en-US')
  assert.equal(load(app.stored.get('code-explore.language')).getLanguage(), 'en')
})

test('placeholders interpolate once and preserve package content', () => {
  const app = load('en')
  assert.equal(app.t('{0} 个文件 · {1} 个符号', 12, 34), '12 files · 34 symbols')
  const source = '源码原文 <tag> {1} function hello() {}'
  assert.equal(app.t('内容 {0}', source), 'Content ' + source)
  app.setLanguage('zh')
  assert.equal(app.t('内容 {0}', source), '内容 ' + source)
})

test('all translated messages preserve their placeholder sets', () => {
  for (const [key, value] of Object.entries(english)) {
    const placeholders = text => [...new Set(text.match(/\{\d+\}/g) || [])].sort()
    assert.deepEqual(placeholders(value), placeholders(key), key)
  }
})

test('every static t() call has an English translation', () => {
  let checked = 0
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) walk(file)
      else if (file.endsWith('.ts') && !['i18n.ts', 'translations.ts'].includes(entry.name)) {
        const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
        function visit(node) {
          if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 't' && ts.isStringLiteral(node.arguments[0])) {
            assert.ok(Object.hasOwn(english, node.arguments[0].text), `${file}: ${node.arguments[0].text}`)
            checked++
          }
          ts.forEachChild(node, visit)
        }
        visit(source)
      }
    }
  }
  walk(path.join(root, 'web'))
  assert.ok(checked > 0)
})
