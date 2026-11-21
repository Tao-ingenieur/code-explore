import { t } from '../i18n'
import type { Catalog, CoreContent, ProjectDescriptor, Route, SourceReference } from '../types';
import { loadComparisonContent, loadCore, reportAsset } from '../data';
import { hashForProject } from '../router';
import { anchor, el, errorState, loadingState, shortHash } from '../ui';
import { icon } from '../icons';
import { createCodeViewer } from './files/code-viewer';
import { comparisonOrigin } from '../positions';
import type { ViewResult } from './files';
interface ComparisonReference extends SourceReference {
    project: 'A' | 'B';
}
interface ComparisonSide {
    implementation: string[];
    branches: string[];
    evidence: string[];
}
interface ComparisonTopic {
    id: string;
    title: string;
    summary: string;
    a: ComparisonSide;
    b: ComparisonSide;
    difference: string;
    tradeoffs: string;
    unknowns: string[];
}
interface ComparisonScenarioStep {
    stage: string;
    aText: string;
    aEvidence: string[];
    bText: string;
    bEvidence: string[];
}
interface ComparisonBody {
    title: string;
    topics: ComparisonTopic[];
    scenario: {
        title: string;
        task: string;
        premise: string;
        steps: ComparisonScenarioStep[];
    };
    conclusion: string;
}
type ComparisonContent = CoreContent & {
    comparison: ComparisonBody;
};
const dockSelections = new Map<string, Partial<Record<'A' | 'B', string>>>();
export function renderComparison({ descriptor, catalog, route }: {
    descriptor: ProjectDescriptor;
    catalog: Catalog;
    route: Route;
}): ViewResult {
    const view = el('div', 'comparison-page page-container');
    const requestedReturn = route.params.get('return');
    const returnTo = requestedReturn?.startsWith('#/compare?') ? requestedReturn : comparisonOrigin();
    view.append(loadingState(t("正在校验双方项目与对比资料…")));
    let disposed = false;
    const viewers = new Map<string, { dispose: () => void }>();
    const requests = { A: 0, B: 0 };
    loadComparisonContent(descriptor.id).then(raw => {
        if (disposed)
            return;
        const content = raw as ComparisonContent;
        const binding = descriptor.comparison;
        if (!binding)
            throw new Error(t("对比资料缺少 projectA/projectB 与双方快照绑定。"));
        const projectA = catalog.projects.find(item => item.id === binding.projectA);
        const projectB = catalog.projects.find(item => item.id === binding.projectB);
        if (!projectA || !projectB)
            throw new Error(t("对比所需项目缺失：{0}。请先导入对应资料包。", !projectA ? binding.projectA : binding.projectB));
        if (projectA.snapshot.id !== binding.snapshotA || projectB.snapshot.id !== binding.snapshotB) {
            throw new Error(t("双方快照不匹配。A 需要 {0}，B 需要 {1}；不能用其他版本替代。", binding.snapshotA, binding.snapshotB));
        }
        if (!content.comparison?.topics?.length)
            throw new Error(t("对比资料没有可展示的主题。"));
        render(content, projectA, projectB);
    }).catch(error => {
        if (!disposed) {
            view.classList.add('package-error-page');
            view.replaceChildren(errorState(error));
        }
    });
    function render(content: ComparisonContent, projectA: ProjectDescriptor, projectB: ProjectDescriptor): void {
        const body = content.comparison;
        const references = new Map(content.references.map(reference => [reference.id, reference as ComparisonReference]));
        const projects = { A: projectA, B: projectB };
        const requestedTopic = route.params.get('topic');
        const continuous = route.params.get('layout') === 'continuous';
        const activeTopic = body.topics.find(topic => topic.id === requestedTopic) || body.topics[0];
        const header = el('header', 'comparison-header');
        const titleBlock = el('div');
        titleBlock.append(el('span', 'eyebrow', 'SIDE-BY-SIDE ARCHITECTURE'), el('h1', '', body.title));
        titleBlock.append(el('p', '', t("双方各自实现、源码证据、关键分支与设计取舍分开展示；功能相似不等于实现相同，快照缺失不等于原产品能力缺失。")));
        header.append(titleBlock);
        if (descriptor.report) {
            const download = anchor(t("下载对比 PDF"), reportAsset(descriptor), 'button primary', 'download');
            download.setAttribute('download', '');
            header.append(download);
        }
        header.append(anchor(t('退出对比'), returnTo, 'button secondary', 'arrow'));
        view.replaceChildren(header);
        const versions = el('div', 'comparison-versions');
        for (const side of ['A', 'B'] as const) {
            const project = projects[side];
            const card = el('div', `comparison-version version-${side.toLowerCase()}`);
            card.append(el('span', 'comparison-side-label', t("项目 {0}", side)), el('strong', '', project.shortName));
            card.append(el('span', '', project.snapshot.version || t("未提供产品版本")));
            card.append(el('code', '', shortHash(project.snapshot.archiveSha256)));
            versions.append(card);
        }
        view.append(versions);
        const controls = el('div', 'comparison-controls');
        const split = anchor(t("主题对比"), hashForProject(descriptor.id, descriptor.snapshot.id, '/compare', { topic: activeTopic.id }), continuous ? '' : 'active', 'layers');
        const full = anchor(t("连续阅读"), hashForProject(descriptor.id, descriptor.snapshot.id, '/compare', { layout: 'continuous' }), continuous ? 'active' : '', 'book');
        controls.append(split, full);
        view.append(controls);
        const layout = el('div', 'comparison-layout');
        const navigation = el('nav', 'comparison-topic-nav');
        navigation.setAttribute('aria-label', t("对比主题"));
        for (const [index, topic] of body.topics.entries()) {
            const link = anchor('', hashForProject(descriptor.id, descriptor.snapshot.id, '/compare', { topic: topic.id }), `comparison-topic-link${!continuous && topic.id === activeTopic.id ? ' active' : ''}`);
            link.append(el('span', '', String(index + 1).padStart(2, '0')), el('strong', '', topic.title));
            navigation.append(link);
        }
        const scenarioLink = anchor(t("并排执行场景"), hashForProject(descriptor.id, descriptor.snapshot.id, '/compare', { topic: 'scenario' }), `comparison-topic-link scenario-link${requestedTopic === 'scenario' ? ' active' : ''}`, 'flow');
        navigation.append(scenarioLink);
        layout.append(navigation);
        const detail = el('main', 'comparison-detail');
        layout.append(detail);
        view.append(layout);
        const dockKey = `${descriptor.id}@${descriptor.snapshot.id}`;
        const selections = dockSelections.get(dockKey) || {};
        dockSelections.set(dockKey, selections);
        const dock = el('section', 'comparison-source-dock');
        dock.hidden = true;
        dock.setAttribute('aria-label', t('双侧源码证据'));
        const dockHeading = el('header', 'source-dock-heading');
        dockHeading.append(el('strong', '', t('双侧源码证据')), el('span', '', t('点击证据仅更新对应一侧，另一侧保持位置。')));
        const expandDock = el('button', 'button secondary compact', t('展开面板')) as HTMLButtonElement;
        expandDock.type = 'button';
        expandDock.addEventListener('click', () => {
            const expanded = dock.classList.toggle('expanded');
            expandDock.textContent = expanded ? t('收起面板') : t('展开面板');
        });
        const closeDock = el('button', 'button secondary compact', t('关闭面板')) as HTMLButtonElement;
        closeDock.type = 'button';
        closeDock.addEventListener('click', () => { dock.hidden = true; view.classList.remove('has-source-dock'); });
        dockHeading.append(anchor(t('返回阅读位置'), returnTo, 'button secondary compact', 'arrow'), expandDock, closeDock);
        const dockSides = el('div', 'source-dock-sides');
        const panes = { A: el('section', 'source-dock-pane'), B: el('section', 'source-dock-pane') };
        for (const side of ['A', 'B'] as const) {
            panes[side].dataset.dockSide = side;
            panes[side].append(el('p', 'source-dock-empty', t('选择 {0} 侧的源码证据', side)));
            dockSides.append(panes[side]);
        }
        dock.append(dockHeading, dockSides);
        view.append(dock);
        async function showEvidence(id: string, side: 'A' | 'B'): Promise<void> {
            const reference = references.get(id);
            if (!reference || reference.project !== side) return;
            const project = projects[side];
            const pane = panes[side];
            const request = ++requests[side];
            selections[side] = id;
            dock.hidden = false;
            view.classList.add('has-source-dock');
            viewers.get(side)?.dispose();
            viewers.delete(side);
            const paneHeading = el('header', 'source-dock-pane-heading');
            paneHeading.append(el('strong', '', `${side} · ${project.shortName}`), el('code', '', `${reference.path}:${reference.start}–${reference.end}`));
            const fullLink = anchor(t('在项目内打开'), hashForProject(project.id, project.snapshot.id, '/files', { path: reference.path, line: reference.start, end: reference.end }), 'inline-link', 'external');
            paneHeading.append(fullLink);
            const host = el('div', 'source-dock-viewer');
            host.append(loadingState(t('正在读取该侧源码…')));
            pane.replaceChildren(paneHeading, host);
            try {
                const context = await loadCore(project.id);
                if (disposed || request !== requests[side]) return;
                const file = context.manifest.files.find(item => item.path === reference.path);
                if (!file) throw new Error(t('索引中没有这个文件'));
                const viewer = createCodeViewer(project.id, file, { line: reference.start, end: reference.end }, (line, end) => {
                    fullLink.href = hashForProject(project.id, project.snapshot.id, '/files', { path: reference.path, line, end });
                });
                viewers.set(side, viewer);
                host.replaceChildren(viewer.element);
                await viewer.ready;
            } catch (error) {
                if (!disposed && request === requests[side]) host.replaceChildren(errorState(error));
            }
        }
        function evidenceButton(id: string, side: 'A' | 'B'): HTMLElement {
            const reference = references.get(id);
            if (!reference || reference.project !== side)
                return el('span', 'error-text', t('证据 {0} 缺失', id));
            const button = el('button', 'evidence-path comparison-evidence-button') as HTMLButtonElement;
            button.type = 'button';
            button.dataset.reference = id;
            button.dataset.side = side;
            button.append(icon('code', 14), el('span', '', `${reference.path}:${reference.start}–${reference.end}`));
            button.title = reference.claim;
            button.addEventListener('click', () => { void showEvidence(id, side); });
            return button;
        }
        function renderSide(side: 'A' | 'B', data: ComparisonSide, topicId: string): HTMLElement {
            const project = projects[side];
            const card = el('section', `comparison-side comparison-side-${side.toLowerCase()}`);
            const heading = el('div', 'comparison-side-heading');
            heading.append(el('span', 'comparison-side-label', t("项目 {0}", side)), el('h2', '', project.shortName), el('code', '', project.snapshot.version || project.snapshot.id));
            card.append(heading);
            for (const paragraph of data.implementation)
                card.append(el('p', '', paragraph));
            if (data.branches.length) {
                const list = el('ul', 'comparison-branch-list');
                data.branches.forEach(branch => list.append(el('li', '', branch)));
                card.append(el('h3', '', t("关键分支")), list);
            }
            const evidence = el('div', 'comparison-evidence-list');
            data.evidence.forEach(id => evidence.append(evidenceButton(id, side)));
            card.append(evidence);
            card.dataset.topic = topicId;
            return card;
        }
        function renderTopic(topic: ComparisonTopic, continuousMode = false): HTMLElement {
            const article = el('article', 'comparison-topic');
            article.id = `comparison-${topic.id}`;
            article.append(el('span', 'eyebrow', continuousMode ? 'COMPARISON TOPIC' : `TOPIC ${String(body.topics.indexOf(topic) + 1).padStart(2, '0')} / ${String(body.topics.length).padStart(2, '0')}`));
            article.append(el('h2', '', topic.title), el('p', 'comparison-topic-summary', topic.summary));
            const sides = el('div', 'comparison-sides');
            sides.append(renderSide('A', topic.a, topic.id), renderSide('B', topic.b, topic.id));
            article.append(sides);
            const analysis = el('div', 'comparison-analysis-grid');
            const difference = el('section');
            difference.append(el('h3', '', t("真正的差异")), el('p', '', topic.difference));
            const tradeoffs = el('section');
            tradeoffs.append(el('h3', '', t("适用条件与设计取舍")), el('p', '', topic.tradeoffs));
            analysis.append(difference, tradeoffs);
            article.append(analysis);
            const unknown = el('details', 'comparison-unknowns');
            unknown.append(el('summary', '', t("无法由当前快照确定的事项 · {0}", topic.unknowns.length)));
            const list = el('ul');
            topic.unknowns.forEach(item => list.append(el('li', '', item)));
            unknown.append(list);
            article.append(unknown);
            return article;
        }
        function renderScenario(): HTMLElement {
            const scenario = body.scenario;
            const article = el('article', 'comparison-scenario comparison-topic');
            article.id = 'comparison-scenario';
            article.append(el('span', 'eyebrow', 'SHARED TASK · SEPARATE IMPLEMENTATIONS'), el('h2', '', scenario.title));
            const premise = el('div', 'comparison-scenario-premise');
            premise.append(el('blockquote', '', scenario.task), el('p', '', scenario.premise));
            article.append(premise);
            for (const step of scenario.steps) {
                const row = el('section', 'comparison-scenario-step');
                row.append(el('h3', '', step.stage));
                const sides = el('div', 'comparison-sides');
                for (const side of ['A', 'B'] as const) {
                    const project = projects[side];
                    const card = el('div', `comparison-side comparison-side-${side.toLowerCase()}`);
                    card.append(el('span', 'comparison-side-label', `${side} · ${project.shortName}`), el('p', '', side === 'A' ? step.aText : step.bText));
                    for (const id of side === 'A' ? step.aEvidence : step.bEvidence)
                        card.append(evidenceButton(id, side));
                    sides.append(card);
                }
                row.append(sides);
                article.append(row);
            }
            return article;
        }
        if (continuous) {
            for (const topic of body.topics)
                detail.append(renderTopic(topic, true));
            detail.append(renderScenario());
        }
        else if (requestedTopic === 'scenario') {
            detail.append(renderScenario());
        }
        else {
            detail.append(renderTopic(activeTopic));
            if (requestedTopic && requestedTopic !== activeTopic.id)
                detail.prepend(el('div', 'inline-warning', t("未找到对比主题“{0}”，已打开第一主题。", requestedTopic)));
        }
        const conclusion = el('section', 'comparison-conclusion');
        conclusion.append(el('span', 'eyebrow', 'EVIDENCE-BOUND CONCLUSION'), el('h2', '', t("对比结论")), el('p', '', body.conclusion));
        detail.append(conclusion);
        for (const side of ['A', 'B'] as const) if (selections[side]) void showEvidence(selections[side]!, side);
        if (requestedTopic && requestedTopic !== 'scenario' && !continuous) {
            requestAnimationFrame(() => document.getElementById(`comparison-${activeTopic.id}`)?.scrollIntoView({ block: 'start' }));
        }
    }
    return { element: view, dispose: () => { disposed = true; viewers.forEach(viewer => viewer.dispose()); } };
}
