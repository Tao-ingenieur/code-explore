import { t } from '../i18n'
import type { AppContext } from '../types';
import { anchor, el, formatNumber, shortHash, statusBadge } from '../ui';
import { icon } from '../icons';
import { guideHash, hashFor } from '../router';
import { reportAsset } from '../data';
export function renderOverview({ manifest, content, descriptor }: AppContext): HTMLElement {
    const view = el('div', 'overview page-container');
    const hero = el('section', 'overview-hero');
    const heroMain = el('div', 'hero-copy');
    const overline = el('div', 'hero-overline');
    overline.append(el('span', 'live-dot'), document.createTextNode(descriptor.analysisLevel === 'deep' ? t("证据驱动 · 人工静态解读") : t("自动索引 · 尚未深度解读")));
    heroMain.append(overline);
    const title = el('h1', '', t("读懂 {0}，\n从一行真实资料开始。", descriptor.shortName));
    title.setAttribute('aria-label', t("读懂 {0}，从一行真实资料开始。", descriptor.shortName));
    heroMain.append(title);
    heroMain.append(el('p', 'hero-description', t("把 {0} 行文本拆成可检索的文件、符号与执行路径。每个重要结论都能返回原始资料，每个分析边界都清楚标注。", formatNumber(manifest.stats.totalLines))));
    const search = el('form', 'hero-search') as HTMLFormElement;
    search.setAttribute('role', 'search');
    const searchIcon = icon('search', 20);
    const input = el('input') as HTMLInputElement;
    input.type = 'search';
    input.name = 'q';
    input.placeholder = t("试试搜索一个文件、函数，或“权限”");
    input.setAttribute('aria-label', t("搜索完整源码索引与解读"));
    const submit = el('button', 'search-submit') as HTMLButtonElement;
    submit.type = 'submit';
    submit.append(icon('arrow', 19));
    submit.setAttribute('aria-label', t("开始搜索"));
    search.append(searchIcon, input, submit);
    search.addEventListener('submit', event => {
        event.preventDefault();
        location.hash = hashFor('/search', { q: input.value.trim() });
    });
    heroMain.append(search);
    const suggestions = el('div', 'hero-suggestions');
    suggestions.append(el('span', '', t("从这里开始")));
    const suggestedAnnotations = content.annotations.slice(0, 3);
    for (const annotation of suggestedAnnotations) {
        suggestions.append(anchor(annotation.symbol, hashFor('/search', { q: annotation.symbol }), 'text-chip'));
    }
    if (content.chapters[0])
        suggestions.append(anchor(content.chapters[0].kicker, guideHash(content.chapters[0].id), 'text-chip'));
    heroMain.append(suggestions);
    const heroActions = el('div', 'hero-actions');
    if (descriptor.features.includes('flows'))
        heroActions.append(anchor(t("沿执行链阅读"), hashFor('/flow'), 'button primary', 'flow'));
    const defaultFile = descriptor.source.defaultFile || content.flow.steps[0]?.path || manifest.files[0]?.path;
    if (defaultFile)
        heroActions.append(anchor(t("打开源码工作台"), hashFor('/files', { path: defaultFile }), 'button ghost-light', 'code'));
    heroMain.append(heroActions);
    const snapshot = el('aside', 'snapshot-card');
    const snapshotTop = el('div', 'snapshot-top');
    snapshotTop.append(el('span', 'mono-label', 'SOURCE SNAPSHOT'), statusBadge('deep', t("已固定版本")));
    snapshot.append(snapshotTop);
    snapshot.append(el('h2', '', descriptor.source.language));
    const snapshotList = el('dl', 'snapshot-list');
    const entries = [
        [t("附件 SHA-256"), shortHash(descriptor.snapshot.archiveSha256)],
        [t("资料版本"), descriptor.snapshot.version || (descriptor.snapshot.commit || t("未提供 Git 提交号"))],
        [t("内容版本"), `analysis-${descriptor.contentVersion}`],
        [t("运行状态"), t("示例系统未运行")],
    ];
    for (const [label, value] of entries) {
        const row = el('div');
        row.append(el('dt', '', label), el('dd', '', value));
        snapshotList.append(row);
    }
    snapshot.append(snapshotList);
    if (descriptor.report) {
        const reportLink = anchor(t("下载同版本 PDF"), reportAsset(descriptor), 'snapshot-report', 'download');
        reportLink.setAttribute('download', '');
        snapshot.append(reportLink);
        snapshot.append(el('p', 'snapshot-note', t("报告与网站读取同一份结构化解读。")));
    }
    else {
        snapshot.append(el('p', 'snapshot-note', t("这是自动索引资料包，没有人工深度分析报告。")));
    }
    hero.append(heroMain, snapshot);
    view.append(hero);
    const stats = el('section', 'stats-strip');
    const statItems = [
        [formatNumber(manifest.stats.files), t("完整纳入文件"), t("资料包全量清点")],
        [formatNumber(manifest.stats.totalLines), t("原始源码行"), t("保留物理行号")],
        [formatNumber(manifest.stats.symbols), t("AST 提取符号"), t("索引不等于深读")],
        [String(content.chapters.length), t("同源解读专题"), t("网站与 PDF 一致")],
    ];
    for (const [value, label, note] of statItems) {
        const item = el('div', 'stat-item');
        item.append(el('strong', '', value), el('span', '', label), el('small', '', note));
        stats.append(item);
    }
    view.append(stats);
    const flowSection = el('section', 'overview-section');
    const flowHeading = el('div', 'section-heading');
    const flowHeadingText = el('div');
    flowHeadingText.append(el('span', 'eyebrow', 'THE EXECUTION PATH'), el('h2', '', t("一条主线，而不是一堆文件")));
    flowHeading.append(flowHeadingText, anchor(t("查看全部步骤与替代路径"), hashFor('/flow'), 'inline-link', 'arrow'));
    flowSection.append(flowHeading);
    flowSection.append(el('p', 'section-intro', content.flow.summary || t("从真实入口出发，逐跳检查上下文、模型、工具与结束条件。")));
    const flowRail = el('div', 'overview-flow-rail');
    const selectedSteps = content.flow.steps.filter((_, index) => index % 2 === 0).slice(0, 6);
    for (const [index, step] of selectedSteps.entries()) {
        const card = anchor('', hashFor('/flow', { step: step.id }), 'overview-flow-card');
        card.append(el('span', 'flow-number', String(index + 1).padStart(2, '0')));
        card.append(el('strong', '', step.short || step.title));
        card.append(el('code', '', step.symbol));
        card.append(icon('arrow', 17));
        flowRail.append(card);
    }
    if (!selectedSteps.length)
        flowRail.append(el('p', 'muted', t("执行链数据尚未生成。")));
    flowSection.append(flowRail);
    if (content.flow.steps.length)
        view.append(flowSection);
    const readingGrid = el('div', 'overview-two-column');
    const chapterSection = el('section', 'overview-section chapter-preview-section');
    const chapterHeading = el('div', 'section-heading');
    chapterHeading.append(el('h2', '', t("按机制建立理解")), anchor(t("全部专题"), hashFor('/guide'), 'inline-link', 'arrow'));
    chapterSection.append(chapterHeading);
    const chapterList = el('div', 'chapter-preview-list');
    for (const chapter of [...content.chapters].sort((a, b) => a.order - b.order).slice(0, 4)) {
        const item = anchor('', guideHash(chapter.id), 'chapter-preview');
        item.append(el('span', 'chapter-index', String(chapter.order).padStart(2, '0')));
        const text = el('div');
        text.append(el('span', 'eyebrow', chapter.kicker), el('h3', '', chapter.title), el('p', '', chapter.summary));
        item.append(text, icon('arrow', 18));
        chapterList.append(item);
    }
    chapterSection.append(chapterList);
    readingGrid.append(chapterSection);
    const boundary = el('aside', 'boundary-card');
    boundary.append(el('span', 'eyebrow', 'READ WITH EVIDENCE'), el('h2', '', t("知道结论，\n也知道它停在哪里。")));
    const boundaryItems = [
        ['source', t("源码事实"), t("控制流、条件与数据结构可由所引行号直接支持。")],
        ['inference', t("分析推断"), t("跨文件组合得到的解释，不伪装成直接事实。")],
        ['runtime', t("待运行验证"), t("功能开关、外部服务与真实时序不被静态阅读替代。")],
    ];
    for (const [tone, label, text] of boundaryItems) {
        const row = el('div', 'boundary-item');
        row.append(el('span', `confidence confidence-${tone}`, label), el('p', '', text));
        boundary.append(row);
    }
    boundary.append(anchor(t("查看范围、排除项与未验证事项"), hashFor('/coverage'), 'button ghost-light', 'layers'));
    readingGrid.append(boundary);
    view.append(readingGrid);
    const footer = el('footer', 'site-footer');
    footer.append(el('span', '', t("{0} · 内容版本 {1}", content.project.title, content.project.contentVersion)));
    footer.append(el('span', '', t("静态分析日期 {0} · 示例系统未执行", content.project.analysisDate)));
    view.append(footer);
    return view;
}
