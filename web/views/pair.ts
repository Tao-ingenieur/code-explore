import { t } from '../i18n'
import type { Catalog, ProjectDescriptor, Route } from '../types'
import { anchor, copyText, el } from '../ui'
import { hashForProject } from '../router'
import { savedPosition } from '../positions'
import { importLocalDirectory, inspectDirectory, pickDirectory, isLocalPackage, needsDirectoryPermission, reconnectDirectory } from '../local-packages'
import { updateLibraryProject } from '../data'
import { matchingComparisons, pairHash } from '../comparison-selection'
import type { ViewResult } from './files'
import comparisonPrompt from '../../docs/comparison-prompt.md?raw'

function helpHash(a?: ProjectDescriptor, b?: ProjectDescriptor): string {
  return '#/compare-help' + (a && b ? '?' + new URLSearchParams({ a: a.id, b: b.id }) : '')
}
export function renderPairWorkspace(catalog: Catalog, route: Route): ViewResult {
  const view = el('div', 'pair-page page-container')
  const projects = catalog.projects.filter(item => item.type !== 'comparison')
  const a = projects.find(item => item.id === route.params.get('a'))
  const b = projects.find(item => item.id === route.params.get('b'))
  const heading = el('header', 'pair-heading')
  heading.append(el('h1', '', t('双项目对比')), el('p', '', t('选择项目 A 和 B，即可并排阅读、搜索和定位；专题比较可选加载第三份对比资料包。')))
  view.append(heading)
  const form = el('form', 'pair-selection') as HTMLFormElement
  const selectors: HTMLSelectElement[] = []
  for (const [side, current] of [['A', a], ['B', b]] as const) {
    const label = el('label')
    label.append(el('span', '', t('项目 {0}', side)))
    const select = el('select') as HTMLSelectElement
    select.dataset.testid = `project-${side.toLowerCase()}`
    const placeholder = el('option', '', t('请选择项目')) as HTMLOptionElement
    placeholder.value = ''; select.append(placeholder)
    for (const project of projects) {
      const option = el('option', '', project.name) as HTMLOptionElement
      option.value = project.id; select.append(option)
    }
    select.value = current?.id || ''
    label.append(select); selectors.push(select); form.append(label)
  }
  const submit = el('button', 'button primary', t('打开并排阅读')) as HTMLButtonElement
  submit.type = 'submit'
  const swap = el('button', 'button secondary', t('交换 A / B')) as HTMLButtonElement
  swap.type = 'button'
  swap.addEventListener('click', () => {
    const value = selectors[0].value; selectors[0].value = selectors[1].value; selectors[1].value = value; refresh()
  })
  const feedback = el('p', 'pair-feedback')
  feedback.setAttribute('role', 'status')
  let refreshComparisons = (_preferred = '') => {}
  const refresh = () => {
    const same = !!selectors[0].value && selectors[0].value === selectors[1].value
    submit.disabled = !selectors[0].value || !selectors[1].value || same
    feedback.textContent = same ? t('请选择两个不同的项目。') : ''
    refreshComparisons()
  }
  selectors.forEach(select => select.addEventListener('change', refresh)); refresh()
  form.addEventListener('submit', event => {
    event.preventDefault()
    const nextA = projects.find(item => item.id === selectors[0].value)
    const nextB = projects.find(item => item.id === selectors[1].value)
    if (!nextA || !nextB || nextA.id === nextB.id) return
    const hash = pairHash(nextA, nextB)
    if (location.hash === hash) dispatchEvent(new HashChangeEvent('hashchange'))
    else location.hash = hash
  })
  form.append(swap, submit); view.append(form, feedback)
  const note = el('section', 'pair-package-note')
  const explanation = el('details') as HTMLDetailsElement
  explanation.open = !a || !b
  explanation.append(el('summary', '', t('第三份对比资料包是可选的')), el('p', '', t('并排阅读无需对比包，也不会自动生成比较结论。需要架构差异、设计取舍和证据对照时，可让 AI 读取两份源码 ZIP，按格式生成独立对比目录，然后直接在本页打开该对比目录。')))
  note.append(explanation, anchor(t('对比资料包格式与 AI 提示词'), helpHash(a, b), 'button secondary compact', 'book'))
  view.append(note)
  const optional = el('section', 'pair-optional-comparison')
  const importStatus = el('p', 'pair-comparison-import-status')
  importStatus.setAttribute('role', 'status')
  refreshComparisons = (preferred = '') => {
    const previous = preferred || optional.querySelector<HTMLSelectElement>('select')?.value || ''
    const selectedA = projects.find(item => item.id === selectors[0].value)
    const selectedB = projects.find(item => item.id === selectors[1].value)
    const validPair = selectedA && selectedB && selectedA.id !== selectedB.id
    const matches = validPair ? matchingComparisons(catalog, selectedA, selectedB) : []
    const packages = catalog.projects.filter(item => item.type === 'comparison')
    optional.replaceChildren()
    const label = el('label', '', t('专题对比资料（可选）'))
    const select = el('select') as HTMLSelectElement
    select.dataset.testid = 'comparison-package'
    const none = el('option', '', t('仅并排阅读（无需第三包）')) as HTMLOptionElement
    none.value = ''; select.append(none)
    const reasons = el('ul', 'comparison-package-mismatches')
    for (const item of packages) {
      const matched = matches.some(match => match.id === item.id)
      const reason = !validPair ? t('请先选择项目 A 和 B。')
        : item.comparison?.projectA !== selectedA.id || item.comparison?.projectB !== selectedB.id
          ? t('项目 A/B 或顺序不匹配') : t('双方快照不匹配')
      const option = el('option', '', item.name + (matched ? '' : ' — ' + reason)) as HTMLOptionElement
      option.value = item.id; option.disabled = !matched; select.append(option)
      if (!matched) reasons.append(el('li', '', item.name + '：' + reason))
    }
    select.value = matches.some(item => item.id === previous) ? previous : ''
    label.append(select)
    const open = el('button', 'button secondary compact', t('打开专题比较')) as HTMLButtonElement
    open.type = 'button'
    const updateOpen = () => {
      open.disabled = !select.value
      open.textContent = select.value && needsDirectoryPermission(select.value) ? t('重新授权并打开对比') : t('打开专题比较')
    }
    select.addEventListener('change', updateOpen); updateOpen()
    open.addEventListener('click', async () => {
      const selected = matches.find(item => item.id === select.value)
      if (!selected || !validPair) return
      try {
        let current = selected
        if (needsDirectoryPermission(selected.id)) {
          current = await reconnectDirectory(selected.id)
          await updateLibraryProject(current)
          if (!matchingComparisons(catalog, selectedA, selectedB).some(item => item.id === current.id)) {
            refreshComparisons(); return
          }
        }
        location.hash = hashForProject(current.id, current.snapshot.id, '/compare', { return: pairHash(selectedA, selectedB) })
      } catch (error) { importStatus.textContent = error instanceof Error ? error.message : String(error) }
    })
    const importButton = el('button', 'button primary compact', t('打开对比资料包目录')) as HTMLButtonElement
    importButton.type = 'button'; importButton.dataset.testid = 'open-comparison-directory'
    importButton.addEventListener('click', async () => {
      try {
        importButton.disabled = true
        const handle = await pickDirectory()
        importStatus.textContent = t('正在校验原目录，文件不会复制或上传…')
        const inspected = await inspectDirectory(handle)
        if (inspected.descriptor.type !== 'comparison') throw new Error(t('请选择 type 为 comparison 的对比资料包；源码项目请从资料库打开。'))
        const descriptor = await importLocalDirectory(handle, new Set(catalog.projects.filter(item => !isLocalPackage(item.id)).map(item => item.id)))
        await updateLibraryProject(descriptor)
        importStatus.textContent = t('对比资料包已导入；匹配当前 A/B 时可选择并打开。')
        refreshComparisons(descriptor.id)
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) importStatus.textContent = error instanceof Error ? error.message : String(error)
      } finally { importButton.disabled = false }
    })
    optional.append(label, open, importButton)
    if (!validPair) optional.append(el('p', '', t('请先选择项目 A 和 B。')))
    else if (!matches.length) optional.append(el('p', '', t('暂无匹配的专题对比资料；仍可完整使用下方双栏阅读。交换 A/B 后也可检查另一方向的对比资料。')))
    if (reasons.childElementCount) optional.append(reasons)
    optional.append(importStatus)
  }
  refreshComparisons(); view.append(optional)
  const cleanups: Array<() => void> = []
  if (projects.length < 2) view.append(el('p', 'inline-warning', t('请先打开至少两个源码或文档资料包目录。')))
  if ((route.params.has('a') && !a) || (route.params.has('b') && !b)) view.append(el('p', 'inline-warning', t('链接中的项目不存在，请重新选择。')))
  if (!a || !b || a.id === b.id) return { element: view }
  if ((route.params.has('sa') && route.params.get('sa') !== a.snapshot.id) || (route.params.has('sb') && route.params.get('sb') !== b.snapshot.id)) {
    view.append(el('p', 'inline-warning', t('项目快照已变化，请重新选择并打开；不会用其他版本替代原对比。')))
    return { element: view }
  }
  const focus = el('button', 'button secondary compact pair-focus-button', t('专注阅读')) as HTMLButtonElement
  focus.type = 'button'
  focus.addEventListener('click', () => {
    const active = view.classList.toggle('pair-focused')
    focus.textContent = active ? t('显示项目选择') : t('专注阅读')
  })
  view.append(focus)
  const columns = el('div', 'pair-columns')
  for (const [side, project] of [['A', a], ['B', b]] as const) {
    const pane = el('section', 'pair-reader')
    pane.dataset.readerSide = side
    const title = el('header', 'pair-reader-title')
    title.append(el('strong', '', side + ' · ' + project.name), el('small', '', project.snapshot.id))
    const toolbar = el('nav', 'pair-reader-toolbar')
    toolbar.setAttribute('aria-label', t('{0} 侧阅读导航', side))
    const frame = el('iframe', 'pair-reader-frame') as HTMLIFrameElement
    frame.title = t('{0} 侧项目：{1}', side, project.name)
    const urlFor = (hash: string) => { const url = new URL(document.baseURI); url.hash = hash; return url.href }
    const initial = savedPosition(project.id, project.snapshot.id) || hashForProject(project.id, project.snapshot.id, project.features.includes('guide') ? '/guide' : '/files')
    frame.src = urlFor(initial)
    const items = [['/overview', t('项目总览'), 'files'], ['/files', t('源码'), 'files'], ['/guide', t('专题解读'), 'guide'], ['/search', t('全量搜索'), 'search'], ['/flow', t('执行链'), 'flows']]
    for (const [name, label, feature] of items) {
      if (!project.features.includes(feature) && name !== '/search') continue
      const button = el('button', 'button secondary compact', label) as HTMLButtonElement
      button.type = 'button'
      button.addEventListener('click', () => {
        const params: Record<string, string> = {}
        if (name === '/guide') {
          const current = new URLSearchParams(frame.contentWindow?.location.hash.split('?')[1] || '')
          for (const key of ['chapter', 'section']) if (current.get(key)) params[key] = current.get(key)!
        }
        frame.contentWindow?.location.replace(urlFor(hashForProject(project.id, project.snapshot.id, name, params)))
      })
      toolbar.append(button)
    }
    const separate = anchor(t('单独打开'), urlFor(initial), 'inline-link', 'external')
    separate.target = '_blank'; separate.rel = 'noopener'
    const updateLink = () => {
      try {
        const current = frame.contentWindow?.location
        if (current?.origin === location.origin && current.hash.startsWith(`#/p/${project.id}/`)) separate.href = current.href
      } catch { /* Do not read a frame after an external navigation. */ }
    }
    frame.addEventListener('load', () => { updateLink(); frame.contentWindow?.addEventListener('hashchange', updateLink); frame.contentWindow?.addEventListener('reading-position', updateLink) })
    cleanups.push(() => { frame.contentWindow?.removeEventListener('hashchange', updateLink); frame.contentWindow?.removeEventListener('reading-position', updateLink) })
    toolbar.append(separate)
    pane.append(title, toolbar, frame); columns.append(pane)
  }
  view.append(columns)
  return { element: view, dispose: () => cleanups.forEach(cleanup => cleanup()) }
}

export function renderComparisonHelp(catalog: Catalog, route: Route): ViewResult {
  const view = el('div', 'comparison-help page-container')
  view.append(el('h1', '', t('对比资料包格式与 AI 提示词')), el('p', '', t('把下方提示词和两份源码 ZIP 交给 AI。选择过两个项目时，复制内容会自动附带准确的项目 ID 与快照；生成后打开对比目录即可。')))
  const participants = ['a', 'b'].map(side => catalog.projects.find(item => item.id === route.params.get(side) && item.type !== 'comparison'))
  const metadata = participants.every(Boolean) ? '\n\n## 本次选择的项目（保留 ID 和快照，不得猜测）\n```json\n' + JSON.stringify({ projectA: participants[0], projectB: participants[1] }, null, 2) + '\n```\n' : ''
  const prompt = comparisonPrompt + metadata
  const actions = el('div', 'comparison-help-actions')
  const copy = el('button', 'button primary', t('复制 AI 提示词')) as HTMLButtonElement
  copy.type = 'button'; copy.addEventListener('click', () => copyText(prompt))
  const download = anchor(t('下载格式说明'), 'docs/comparison-prompt.md', 'button secondary', 'download')
  download.setAttribute('download', '')
  actions.append(copy, download, anchor(t('返回项目选择'), participants.every(Boolean) ? pairHash(participants[0]!, participants[1]!) : '#/compare', 'button secondary', 'arrow'))
  if (!metadata) view.append(el('p', 'inline-warning', t('请先在对比页选择两个项目，或向 AI 提供两个项目各自的 project.json，才能正确绑定比较结果。')))
  view.append(actions, el('pre', 'comparison-prompt-text', prompt))
  return { element: view }
}
