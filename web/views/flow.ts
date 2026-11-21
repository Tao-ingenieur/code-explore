import { t } from '../i18n'
import type { AppContext, FlowStep, Route } from '../types';
import { loadSource } from '../data';
import { guideHash, hashFor, sourceHash } from '../router';
import { anchor, confidenceBadge, el, emptyState, errorState, evidenceCard, evidenceList, loadingState, pageHeader } from '../ui';
import { icon } from '../icons';
import type { ViewResult } from './files';
function flowTabs(active: 'flow' | 'case'): HTMLElement {
    const tabs = el('div', 'flow-mode-tabs');
    const flow = anchor(t("核心执行链"), hashFor('/flow'), active === 'flow' ? 'active' : '', 'flow');
    const walkthrough = anchor(t("贯穿案例"), hashFor('/case'), active === 'case' ? 'active' : '', 'terminal');
    tabs.append(flow, walkthrough);
    return tabs;
}
function sourcePreview(projectId: string, step: FlowStep, host: HTMLElement): {
    dispose: () => void;
} {
    const controller = new AbortController();
    host.append(loadingState(t("正在读取此步骤的源码片段…")));
    loadSource(projectId, step.path, controller.signal).then(text => {
        const lines = text.split(/\r\n|\r|\n/);
        const pre = el('pre', 'flow-source-code');
        const start = Math.max(1, step.startLine);
        const end = Math.min(lines.length, step.endLine, start + 23);
        for (let line = start; line <= end; line += 1) {
            const row = el('div', 'flow-source-line');
            row.append(el('span', 'flow-line-number', String(line)), el('code', '', lines[line - 1]));
            pre.append(row);
        }
        if (step.endLine > end)
            pre.append(el('div', 'flow-source-ellipsis', t("… 引用范围至 {0} 行，请打开完整源码继续阅读。", step.endLine)));
        host.replaceChildren(pre);
    }).catch(error => {
        if (!controller.signal.aborted)
            host.replaceChildren(errorState(error));
    });
    return { dispose: () => controller.abort() };
}
export function renderFlow(context: AppContext, route: Route): ViewResult {
    const chains = context.content.flows?.length ? context.content.flows : [context.content.flow];
    const requestedChain = route.params.get('chain');
    const activeChain = chains.find(chain => chain.id === requestedChain) || chains[0];
    const steps = activeChain.steps;
    const view = el('div', 'flow-page page-container');
    view.append(flowTabs('flow'));
    const heading = pageHeader('EXECUTION ATLAS', activeChain.title, activeChain.summary);
    const headerActions = el('div', 'flow-heading-actions');
    headerActions.append(el('span', 'evidence-version', t("{0} 个真实实现步骤", steps.length)), anchor(t("查看贯穿案例"), hashFor('/case'), 'button secondary', 'terminal'));
    heading.append(headerActions);
    view.append(heading);
    if (chains.length > 1) {
        const chainTabs = el('div', 'execution-chain-tabs');
        for (const chain of chains) {
            const link = anchor(chain.title, hashFor('/flow', { chain: chain.id }), chain.id === activeChain.id ? 'active' : '', 'branch');
            chainTabs.append(link);
        }
        view.append(chainTabs);
    }
    if (!steps.length) {
        view.append(emptyState(t("执行链尚未生成"), t("请在 content/flow.json 中添加经过源码验证的步骤。"), 'flow'));
        return { element: view };
    }
    const requestedStep = route.params.get('step');
    const step = steps.find(item => item.id === requestedStep) || steps[0];
    const layout = el('div', 'flow-layout');
    const stepNav = el('nav', 'flow-step-nav');
    stepNav.setAttribute('aria-label', t("核心执行链步骤"));
    for (const [index, item] of steps.entries()) {
        const link = anchor('', hashFor('/flow', { chain: chains.length > 1 ? activeChain.id : undefined, step: item.id }), `flow-step-link${item.id === step.id ? ' active' : ''}`);
        link.append(el('span', 'flow-step-number', String(index + 1).padStart(2, '0')));
        const text = el('div');
        text.append(el('strong', '', item.short || item.title), el('code', '', item.symbol));
        link.append(text, icon('chevron', 15));
        stepNav.append(link);
    }
    const note = el('div', 'flow-nav-note');
    note.append(icon('info', 16), el('p', '', t("主链描述代码可达路径，不代表模型每次都会选择同一工具或分支。")));
    stepNav.append(note);
    layout.append(stepNav);
    const detail = el('main', 'flow-detail');
    if (requestedStep && !steps.some(item => item.id === requestedStep)) {
        detail.append(el('div', 'inline-warning', t("未找到步骤“{0}”，已打开执行链起点。", requestedStep)));
    }
    const stepHeader = el('header', 'flow-detail-header');
    const stepIndex = steps.indexOf(step);
    stepHeader.append(el('span', 'eyebrow', `STEP ${String(stepIndex + 1).padStart(2, '0')} / ${String(steps.length).padStart(2, '0')}`), el('h2', '', step.title));
    stepHeader.append(el('p', '', step.description));
    detail.append(stepHeader);
    const io = el('div', 'flow-io-grid');
    const input = el('div', 'flow-io');
    input.append(el('span', '', t("进入时")), el('p', '', step.inputs));
    const output = el('div', 'flow-io');
    output.append(el('span', '', t("向后传递")), el('p', '', step.outputs));
    io.append(input, output);
    detail.append(io);
    const sourceSection = el('section', 'flow-source-section');
    const sourceHeader = el('div', 'flow-section-heading');
    sourceHeader.append(el('h3', '', t("这一步在哪里发生？")));
    sourceHeader.append(anchor(t("打开完整源码"), sourceHash({ path: step.path, start: step.startLine, end: step.endLine, symbol: step.symbol }), 'inline-link', 'code'));
    const sourceLocation = el('div', 'flow-source-location');
    sourceLocation.append(icon('file', 15), el('code', '', `${step.path}:${step.startLine}–${step.endLine}`), el('span', '', step.symbol));
    const previewHost = el('div', 'flow-source-preview');
    sourceSection.append(sourceHeader, sourceLocation, previewHost);
    detail.append(sourceSection);
    const preview = sourcePreview(context.descriptor.id, step, previewHost);
    const chapterLink = anchor(t("阅读这一机制的完整解读"), guideHash(step.chapter, step.section), 'flow-chapter-link');
    const chapter = context.content.chapters.find(item => item.id === step.chapter);
    if (chapter) {
        chapterLink.prepend(el('span', 'eyebrow', chapter.kicker));
        detail.append(chapterLink);
    }
    const branchSection = el('section', 'flow-branches');
    const branchHeading = el('div', 'flow-section-heading');
    branchHeading.append(el('h3', '', t("成功之外，控制流往哪里走？")));
    branchSection.append(branchHeading);
    let branchFilter = 'all';
    const branchFilters = el('div', 'branch-filters');
    const branchList = el('div', 'branch-list');
    function renderBranches(): void {
        branchList.replaceChildren();
        const branches = step.branches.filter(branch => branchFilter === 'all' || branch.tone === branchFilter);
        if (!branches.length)
            branchList.append(el('p', 'muted', t("此步骤没有该类型的显式分支；请查看其他步骤或完整源码。")));
        for (const branch of branches) {
            const reference = context.content.references.find(item => item.id === branch.evidence);
            const card = el('article', `branch-card branch-${branch.tone}`);
            const top = el('div', 'branch-card-top');
            top.append(el('span', 'branch-label', branch.label), el('code', '', branch.condition));
            card.append(top, el('p', '', branch.outcome));
            if (reference)
                card.append(evidenceCard(reference));
            branchList.append(card);
        }
    }
    const filters = [['all', t("全部路径")], ['success', t("成功")], ['failure', t("失败")], ['denied', t("拒绝授权")], ['cancelled', t("取消")]];
    for (const [id, label] of filters) {
        const button = el('button', 'branch-filter', label) as HTMLButtonElement;
        button.type = 'button';
        button.classList.toggle('active', id === branchFilter);
        button.addEventListener('click', () => {
            branchFilter = id;
            for (const sibling of branchFilters.children)
                sibling.classList.toggle('active', sibling === button);
            renderBranches();
        });
        branchFilters.append(button);
    }
    branchSection.append(branchFilters, branchList);
    renderBranches();
    detail.append(branchSection);
    const previousNext = el('div', 'flow-previous-next');
    if (stepIndex > 0)
        previousNext.append(anchor(t("上一步 · {0}", steps[stepIndex - 1].short), hashFor('/flow', { chain: chains.length > 1 ? activeChain.id : undefined, step: steps[stepIndex - 1].id }), 'button secondary', 'back'));
    else
        previousNext.append(el('span'));
    if (stepIndex < steps.length - 1)
        previousNext.append(anchor(t("下一步 · {0}", steps[stepIndex + 1].short), hashFor('/flow', { chain: chains.length > 1 ? activeChain.id : undefined, step: steps[stepIndex + 1].id }), 'button primary', 'arrow'));
    else
        previousNext.append(anchor(t("进入贯穿案例"), hashFor('/case'), 'button primary', 'terminal'));
    detail.append(previousNext);
    layout.append(detail);
    view.append(layout);
    return { element: view, dispose: () => preview.dispose() };
}
export function renderCase(context: AppContext): ViewResult {
    const study = context.content.caseStudy;
    const view = el('div', 'case-page page-container');
    view.append(flowTabs('case'));
    const heading = pageHeader('END-TO-END WALKTHROUGH', study.title, t("把用户输入、模型请求、工具权限、后续轮次和保存行为串成同一条可核查路径。"));
    view.append(heading);
    const premise = el('section', 'case-premise');
    const prompt = el('div', 'case-prompt');
    prompt.append(el('span', 'eyebrow', 'HYPOTHETICAL USER INPUT'), el('blockquote', '', study.task));
    const facts = el('div', 'case-premise-note');
    facts.append(confidenceBadge('runtime'), el('h2', '', t("这是静态走查，不是运行记录")));
    facts.append(el('p', '', study.premise));
    premise.append(prompt, facts);
    view.append(premise);
    const timeline = el('div', 'case-timeline');
    for (const [index, step] of study.steps.entries()) {
        const item = el('article', 'case-step');
        const marker = el('div', 'case-marker');
        marker.append(el('span', '', String(index + 1).padStart(2, '0')));
        const body = el('div', 'case-step-body');
        const top = el('div', 'case-step-top');
        top.append(el('span', 'eyebrow', step.stage), confidenceBadge(step.confidence));
        body.append(top, el('h2', '', step.title), el('p', 'case-narrative', step.narrative));
        const observation = el('div', 'case-observation');
        observation.append(el('strong', '', t("静态观察")), el('p', '', step.observation));
        body.append(observation, evidenceList(step.evidence, context.content));
        item.append(marker, body);
        timeline.append(item);
    }
    view.append(timeline);
    const alternatives = el('section', 'case-alternatives');
    alternatives.append(el('span', 'eyebrow', 'ALTERNATE PATHS'), el('h2', '', t("同一案例的失败、拒绝与取消")));
    const grid = el('div', 'case-alternative-grid');
    for (const alternative of study.alternatives) {
        const card = el('article', `branch-card branch-${alternative.tone}`);
        card.append(el('span', 'branch-label', alternative.label), el('code', '', alternative.condition), el('p', '', alternative.outcome));
        const reference = context.content.references.find(item => item.id === alternative.evidence);
        if (reference)
            card.append(evidenceCard(reference));
        grid.append(card);
    }
    alternatives.append(grid);
    view.append(alternatives);
    const conclusion = el('section', 'case-conclusion');
    conclusion.append(el('span', 'eyebrow', 'WHAT THE CHAIN ESTABLISHES'), el('h2', '', t("这条链真正说明了什么")));
    conclusion.append(el('p', '', study.conclusion));
    conclusion.append(anchor(t("返回核心执行链"), hashFor('/flow'), 'button primary', 'flow'));
    view.append(conclusion);
    return { element: view };
}
