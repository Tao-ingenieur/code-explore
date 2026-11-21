import { t } from '../i18n'
import { anchor, copyText, el } from '../ui'
import type { ViewResult } from './files'
import prompt from '../../docs/agent-prompt.md?raw'

export function renderPackageHelp(): ViewResult {
  const view = el('div', 'comparison-help page-container')
  view.append(el('span', 'eyebrow', 'PACKAGE GUIDE'), el('h1', '', t('资料包格式与 AI 提示词')),
    el('p', '', t('将下方完整提示词和源码 ZIP 交给 AI，生成包含 project.json 的分析目录，再返回资料库打开该目录。网站读取已有解读，不会自动分析原始源码。')))
  const cards = el('div', 'package-help-steps')
  for (const [title, body] of [
    [t('准备源码'), t('把源码 ZIP 放入 dist/input，填写提示词中的项目标识、名称和输入文件。')],
    [t('生成分析目录'), t('让 AI 将源码、分析和索引写入 dist/output/<project-id>，无需重新压缩。')],
    [t('选择目录并阅读'), t('选择含 project.json 的资料包根目录；校验通过后读取原文件，缺失时显示清单。')],
  ]) {
    const card = el('section'); card.append(el('h2', '', title), el('p', '', body)); cards.append(card)
  }
  const actions = el('div', 'comparison-help-actions')
  const copy = el('button', 'button primary', t('复制 AI 提示词')) as HTMLButtonElement
  copy.type = 'button'; copy.addEventListener('click', () => copyText(prompt))
  const download = anchor(t('下载格式说明'), 'docs/agent-prompt.md', 'button secondary', 'download')
  download.download = 'agent-prompt.md'
  actions.append(copy, download, anchor(t('返回项目列表'), '#/projects', 'button secondary', 'arrow'), anchor(t('对比资料包格式与 AI 提示词'), '#/compare-help', 'button secondary', 'branch'))
  view.append(cards, actions, el('pre', 'comparison-prompt-text', prompt))
  return { element: view }
}
