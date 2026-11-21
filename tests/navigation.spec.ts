import { test, expect } from '@playwright/test'

const emptyCatalog = { schemaVersion: 2, projects: [] }

test('空目录可以显示项目列表，不假定任何资料包存在', async ({ page }) => {
  await page.route('**/projects/catalog.json', route => route.fulfill({ json: emptyCatalog }))
  await page.goto('/#/projects')
  await expect(page.locator('.project-catalog')).toBeVisible()
  await expect(page.locator('.project-card')).toHaveCount(0)
})

test('不兼容的目录版本显示错误', async ({ page }) => {
  await page.route('**/projects/catalog.json', route => route.fulfill({ json: { schemaVersion: -1, projects: [] } }))
  await page.goto('/#/projects')
  await expect(page.locator('.package-error-page')).toContainText('格式不兼容')
})

test('目录 JSON 损坏时提供错误反馈', async ({ page }) => {
  await page.route('**/projects/catalog.json', route => route.fulfill({ contentType: 'application/json', body: '{broken' }))
  await page.goto('/#/projects')
  await expect(page.locator('.package-error-page')).toContainText('JSON 格式无效')
})

test('未指定项目的旧阅读链接回到列表，不选择固定项目', async ({ page }) => {
  await page.route('**/projects/catalog.json', route => route.fulfill({ json: emptyCatalog }))
  await page.goto('/#/files')
  await expect(page.locator('.project-catalog')).toBeVisible()
  await expect(page.locator('.project-card')).toHaveCount(0)
})

test('项目列表按实际目录展示，不假定名称或数量', async ({ page, request }) => {
  const response = await request.get('/projects/catalog.json')
  expect(response.ok()).toBeTruthy()
  const catalog = await response.json()
  await page.goto('/#/projects')
  await expect(page.locator('.project-catalog')).toBeVisible()
  await expect(page.locator('.project-card')).toHaveCount(catalog.projects.length)
  for (const descriptor of catalog.projects) {
    await expect(page.locator(`[data-project-id="${descriptor.id}"]`)).toContainText(descriptor.name)
  }
})

test('可打开和关闭目录中动态选择的源码资料包', async ({ page, request }) => {
  const catalog = await (await request.get('/projects/catalog.json')).json()
  const descriptor = catalog.projects.find((item: { type: string }) => item.type !== 'comparison')
  test.skip(!descriptor, '没有可用于集成检查的源码资料包')
  await page.goto('/#/projects')
  await page.locator(`[data-project-id="${descriptor.id}"] [data-action="open-project"]`).click()
  await expect(page.locator('.overview-hero')).toBeVisible()
  const previous = page.url()
  await page.locator('.header-close').click()
  await expect(page.locator('.project-catalog')).toBeVisible()
  await page.locator(`[data-project-id="${descriptor.id}"] [data-action="open-project"]`).click()
  await expect(page.locator('.overview-hero')).toBeVisible()
  expect(page.url()).toBe(previous)
})

test('资料包声明的报告可下载；未声明报告时跳过', async ({ request }) => {
  const catalog = await (await request.get('/projects/catalog.json')).json()
  const descriptors = catalog.projects.filter((item: { report?: unknown }) => item.report)
  test.skip(!descriptors.length, '没有声明报告的资料包')
  for (const descriptor of descriptors) {
    for (const kind of ['pdf', 'tex']) {
      const relative = descriptor.report[kind].split('/').map(encodeURIComponent).join('/')
      const response = await request.get(`/projects/${descriptor.id}/${relative}`)
      expect(response.ok()).toBeTruthy()
      if (kind === 'pdf') expect((await response.body()).subarray(0, 4).toString()).toBe('%PDF')
      else expect((await response.body()).length).toBeGreaterThan(0)
    }
  }
})


test('直接目录接入只保存授权，支持刷新、同 ID 重接及非必要缺失告警', async ({ page }) => {
  let nativeRequests = 0
  await page.route('**/__native/**', route => { nativeRequests++; return route.abort() })
  const descriptor = {
    schemaVersion: 2, id: 'directory-example', name: 'Directory import example', shortName: 'Directory example',
    type: 'source-analysis', analysisLevel: 'indexed', contentVersion: '1',
    snapshot: { id: 'snapshot:directory-example', archiveSha256: 'example', includedFiles: 1, totalLines: 1 },
    source: { root: 'source', language: 'TypeScript', defaultFile: 'main.ts' },
    entries: { manifest: 'index/manifest.json', content: 'index/content.json', search: 'index/search.json', symbols: 'index/symbols/' },
    features: ['files'], report: null,
  }
  await page.route('**/projects/catalog.json', route => route.fulfill({ json: { schemaVersion: 2, projects: [{ ...descriptor, name: 'Preset directory example' }] } }))
  // OPFS provides genuine structured-cloneable directory handles. The OS chooser is mocked only in this test.
  await page.addInitScript(() => {
    (window as any).showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('fixture', { create: true })
  })
  await page.goto('/#/projects')
  await page.evaluate(async descriptor => {
    const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle('fixture', { create: true })
    const write = async (path: string, content: unknown) => {
      const parts = path.split('/'); let parent = directory
      for (const part of parts.slice(0, -1)) parent = await parent.getDirectoryHandle(part, { create: true })
      const writable = await (await parent.getFileHandle(parts.at(-1)!, { create: true })).createWritable()
      await writable.write(typeof content === 'string' ? content : JSON.stringify(content)); await writable.close()
    }
    await write('project.json', descriptor)
    await write('index/manifest.json', { projectId: descriptor.id, snapshotId: descriptor.snapshot.id, contentVersion: '1', modules: [{ id: 'main', label: 'Main', files: 1 }], stats: { files: 1, symbols: 0, totalLines: 1, statusCounts: { indexed: 0, summary: 1, deep: 0, pending: 0 } }, statusLabels: { indexed: '已索引', summary: '已概述', deep: '已深入分析', pending: '待验证' }, files: [{ path: 'main.ts', name: 'main.ts', module: 'main', moduleLabel: 'Main', status: 'summary', purpose: 'Fixture', preview: 'text', lines: 1, longestLine: 19, symbolCount: 0, bytes: 19, dependencies: [], externalDependencies: [], unresolvedDependencies: [], unresolved: [], relatedChapters: [], parseErrors: [] }] })
    await write('index/content.json', { projectId: descriptor.id, snapshotId: descriptor.snapshot.id, package: descriptor, project: { contentVersion: '1' }, references: [], annotations: [], chapters: [], flow: { steps: [] } })
    await write('index/search.json', { projectId: descriptor.id, snapshotId: descriptor.snapshot.id, documents: [] })
    await write('index/symbols/main.ts.json', [])
    await write('source/main.ts', 'export const n = 1;')
  }, descriptor)
  await page.locator('[data-project-id="directory-example"] .remove-project').click()
  await expect(page.locator('[data-project-id="directory-example"]')).toHaveCount(0)
  await page.evaluate(() => { (window as any).__directoryPageMarker = 'before-import' })
  await page.getByTestId('open-package-directory').click()
  await expect(page.locator('[data-project-id="directory-example"]')).toContainText('原目录直读')
  expect(await page.evaluate(() => (window as any).__directoryPageMarker)).toBe('before-import')
  await expect(page.locator('[data-project-id="directory-example"] [data-action="open-project"]')).toBeEnabled()
  const keys = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const req = indexedDB.open('code-explore.packages.v1', 1); req.onsuccess = () => resolve(req.result); req.onerror = reject })
    const values = await new Promise<any[]>((resolve, reject) => { const req = db.transaction('packages').objectStore('packages').getAll(); req.onsuccess = () => resolve(req.result); req.onerror = reject })
    db.close(); return values.map(value => Object.keys(value))
  })
  expect(keys[0]).toContain('handle'); expect(keys[0]).not.toContain('files')
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const req = indexedDB.open('code-explore.packages.v1', 1); req.onsuccess = () => resolve(req.result) })
    await new Promise<void>(resolve => {
      const tx = db.transaction('packages', 'readwrite'); const store = tx.objectStore('packages'); const read = store.get('directory-example')
      read.onsuccess = () => { const record = read.result; delete record.handle; record.nativeConnection = { token: 'old-server-token', name: 'fixture' }; store.put(record) }
      tx.oncomplete = () => resolve()
    }); db.close()
  })
  await page.reload()
  await expect(page.locator('[data-project-id="directory-example"] [data-action="open-project"]')).toBeDisabled()
  await page.evaluate(() => { (window as any).__directoryPageMarker = 'before-reconnect' })
  await page.getByRole('button', { name: '重新授权目录' }).click()
  await expect(page.locator('[data-project-id="directory-example"] [data-action="open-project"]')).toBeEnabled()
  expect(await page.evaluate(() => (window as any).__directoryPageMarker)).toBe('before-reconnect')
  expect(nativeRequests).toBe(0)

  await page.goto('/#/p/directory-example/files?path=main.ts&snapshot=' + encodeURIComponent(descriptor.snapshot.id))
  await expect(page.locator('.code-line')).toContainText('export const n = 1;')
  await page.evaluate(async () => {
    const file = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('fixture')).getDirectoryHandle('source')
    const writable = await (await file.getFileHandle('main.ts')).createWritable()
    await writable.write('export const n = 2;'); await writable.close()
  })
  await page.reload()
  await expect(page.locator('.code-line')).toContainText('export const n = 2;')
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('link', { name: '原始文件', exact: true }).click()
  expect((await downloadEvent).suggestedFilename()).toBe('main.ts')
  await page.goto('/#/projects')

  await page.reload()
  await expect(page.locator('[data-project-id="directory-example"]')).toContainText('原目录直读')
  await page.locator('[data-project-id="directory-example"] .remove-project').click()
  await expect(page.locator('[data-project-id="directory-example"]')).toHaveCount(0)
  const original = await page.evaluate(async () => (await (await (await (await navigator.storage.getDirectory()).getDirectoryHandle('fixture')).getDirectoryHandle('source')).getFileHandle('main.ts')).getFile().then(file => file.text()))
  expect(original).toBe('export const n = 2;')
  await expect(page.getByRole('button', { name: '恢复预置项目', exact: true })).toHaveCount(0)
  await page.evaluate(async () => { const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle('fixture'); await (await (await directory.getDirectoryHandle('index')).getDirectoryHandle('symbols')).removeEntry('main.ts.json') })
  await page.getByTestId('open-package-directory').click()
  await expect(page.locator('[data-project-id="directory-example"] .package-import-warnings')).toContainText('index/symbols/main.ts.json')
  await expect(page.locator('[data-project-id="directory-example"] [data-action="open-project"]')).toBeEnabled()
  await page.goto('/#/p/directory-example/files?path=main.ts&snapshot=' + encodeURIComponent(descriptor.snapshot.id))
  await expect(page.locator('.code-line')).toContainText('export const n = 2;')
})

test('任意两个项目可在无专题包时并排阅读，并生成带身份的 AI 提示词', async ({ page, request }) => {
  const catalog = await (await request.get('/projects/catalog.json')).json()
  const sources = catalog.projects.filter((item: { type: string }) => item.type !== 'comparison')
  test.skip(sources.length < 2, '需要至少两个资料包')
  const a = sources[0], b = sources.at(-1)
  await page.goto('/#/compare')
  await expect(page.getByRole('button', { name: '打开并排阅读', exact: true })).toBeDisabled()
  await page.getByTestId('project-a').selectOption(a.id)
  await page.getByTestId('project-b').selectOption(b.id)
  await page.getByRole('button', { name: '打开并排阅读', exact: true }).click()
  await expect(page.locator('.pair-reader')).toHaveCount(2)
  await expect(page.frameLocator('[data-reader-side="A"] iframe').locator('.app-main')).toBeVisible()
  await expect(page.frameLocator('[data-reader-side="B"] iframe').locator('.app-main')).toBeVisible()
  await expect(page.frameLocator('[data-reader-side="A"] iframe').locator('.app-header')).toBeHidden()
  const paneA = page.locator('[data-reader-side="A"]')
  const paneB = page.locator('[data-reader-side="B"]')
  await paneA.getByRole('button', { name: '全量搜索', exact: true }).click()
  await paneB.getByRole('button', { name: '全量搜索', exact: true }).click()
  const frameA = page.frameLocator('[data-reader-side="A"] iframe')
  const frameB = page.frameLocator('[data-reader-side="B"] iframe')
  const queryA = a.source.defaultFile.split('/').at(-1)
  const queryB = b.source.defaultFile.split('/').at(-1)
  await frameA.getByRole('searchbox').fill(queryA)
  await frameA.getByRole('button', { name: '搜索', exact: true }).click()
  await frameB.getByRole('searchbox').fill(queryB)
  await frameB.getByRole('button', { name: '搜索', exact: true }).click()
  await expect(frameA.locator('.search-result')).not.toHaveCount(0)
  await expect(frameB.locator('.search-result')).not.toHaveCount(0)
  await frameA.locator('.search-result:has(.result-file)').first().click()
  await expect(frameA.locator('.code-line')).not.toHaveCount(0)
  await expect(frameB.getByRole('searchbox')).toHaveValue(queryB)
  await frameA.locator('.code-line[data-line="2"] .line-number').click()
  await page.reload()
  await expect(frameA.locator('.code-line.is-current[data-line="2"]')).toBeVisible()
  await expect(frameB.getByRole('searchbox')).toHaveValue(queryB)
  await page.getByRole('link', { name: '对比资料包格式与 AI 提示词', exact: true }).click()
  await expect(page.locator('.comparison-prompt-text')).toContainText(a.snapshot.id)
  await expect(page.locator('.comparison-prompt-text')).toContainText(b.snapshot.id)
  const guide = await request.get('/docs/comparison-prompt.md')
  expect(guide.ok()).toBeTruthy()
})

test('匹配的第三份资料可选打开，返回仍保留所选项目', async ({ page, request }) => {
  const catalog = await (await request.get('/projects/catalog.json')).json()
  const comparison = catalog.projects.find((item: { type: string }) => item.type === 'comparison')
  test.skip(!comparison, '没有专题对比资料')
  await page.goto('/#/compare')
  await page.getByTestId('project-a').selectOption(comparison.comparison.projectA)
  await page.getByTestId('project-b').selectOption(comparison.comparison.projectB)
  await page.getByRole('button', { name: '打开并排阅读', exact: true }).click()
  await page.getByTestId('comparison-package').selectOption(comparison.id)
  await page.getByRole('button', { name: '打开专题比较', exact: true }).click()
  await expect(page.locator('.comparison-topic')).not.toHaveCount(0)
  await page.getByRole('link', { name: '退出对比', exact: true }).click()
  await expect(page.getByTestId('project-a')).toHaveValue(comparison.comparison.projectA)
  await expect(page.getByTestId('project-b')).toHaveValue(comparison.comparison.projectB)
})


test('项目对比返回资料库，单项目导入说明提供网页和完整提示词', async ({ page }) => {
  await page.route('**/projects/catalog.json', route => route.fulfill({ json: emptyCatalog }))
  await page.goto('/#/compare')
  await page.getByRole('link', { name: '项目阅读', exact: true }).click()
  await expect(page.locator('.project-catalog')).toBeVisible()
  await page.getByRole('link', { name: '查看资料包格式与导入说明', exact: true }).click()
  await expect(page.getByRole('heading', { name: '资料包格式与 AI 提示词', exact: true })).toBeVisible()
  await expect(page.locator('.comparison-prompt-text')).toContainText('最终 index 字段级契约')
  await expect(page.getByRole('button', { name: '复制 AI 提示词', exact: true })).toBeVisible()
  await page.getByRole('link', { name: '返回项目列表', exact: true }).click()
  await expect(page.locator('.project-catalog')).toBeVisible()
  await page.getByRole('link', { name: '资料包格式说明', exact: true }).click()
  await expect(page).toHaveURL(/#\/package-help$/)
})




test('对比页始终提供第三份目录入口，导入后直接选择并提示不匹配原因', async ({ page, request }) => {
  const catalog = await (await request.get('/projects/catalog.json')).json()
  const original = catalog.projects.find((item: any) => item.type === 'comparison')
  test.skip(!original, '需要一份真实专题对比资料作为内容样本')
  const content = await (await request.get('/projects/' + original.id + '/' + original.entries.content)).json()
  const descriptor = { ...original, id: 'comparison-directory-test', name: 'Directory comparison fixture', report: null }
  content.projectId = descriptor.id; content.package = descriptor
  await page.route('**/projects/catalog.json', route => route.fulfill({ json: { ...catalog, projects: catalog.projects.filter((item: any) => item.type !== 'comparison') } }))
  await page.addInitScript(() => {
    (window as any).showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('comparison-fixture', { create: true })
  })
  await page.goto('/#/compare')
  await expect(page.getByTestId('comparison-package')).toBeVisible()
  await expect(page.getByTestId('open-comparison-directory')).toBeVisible()
  await expect(page.getByRole('button', { name: '打开专题比较', exact: true })).toBeDisabled()
  await page.getByTestId('project-a').selectOption(descriptor.comparison.projectA)
  await page.getByTestId('project-b').selectOption(descriptor.comparison.projectB)
  await page.evaluate(async ({ descriptor, content }) => {
    const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle('comparison-fixture', { create: true })
    const write = async (path: string, value: unknown) => {
      let parent = directory; const parts = path.split('/')
      for (const part of parts.slice(0, -1)) parent = await parent.getDirectoryHandle(part, { create: true })
      const writable = await (await parent.getFileHandle(parts.at(-1)!, { create: true })).createWritable()
      await writable.write(JSON.stringify(value)); await writable.close()
    }
    await write('project.json', descriptor)
    await write(descriptor.entries.content, content)
    await write(descriptor.entries.search, { projectId: descriptor.id, snapshotId: descriptor.snapshot.id, documents: [] })
    ;(window as any).__comparisonPageMarker = 'unchanged'
  }, { descriptor, content })
  await page.getByTestId('open-comparison-directory').click()
  await expect(page.getByTestId('comparison-package')).toHaveValue(descriptor.id)
  expect(await page.evaluate(() => (window as any).__comparisonPageMarker)).toBe('unchanged')
  await page.getByRole('button', { name: '交换 A / B', exact: true }).click()
  await expect(page.locator('.comparison-package-mismatches')).toContainText('项目 A/B 或顺序不匹配')
  await expect(page.getByTestId('comparison-package').locator('option[value="comparison-directory-test"]')).toHaveAttribute('disabled', '')
  await page.getByRole('button', { name: '交换 A / B', exact: true }).click()
  await page.getByTestId('comparison-package').selectOption(descriptor.id)
  await page.getByRole('button', { name: '打开专题比较', exact: true }).click()
  await expect(page.locator('.comparison-topic')).not.toHaveCount(0)
})
