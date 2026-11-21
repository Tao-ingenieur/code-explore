import { t } from '../i18n'
import type { AppContext, Route } from '../types';
import { anchor, copyText, el, emptyState, evidenceList, iconButton, pageHeader, renderBlocks } from '../ui';
import { guideHash, hashFor, replaceHash } from '../router';
import { reportAsset } from '../data';
import type { ViewResult } from './files';
export function renderGuide(context: AppContext, route: Route): ViewResult {
    const chapters = [...context.content.chapters].sort((a, b) => a.order - b.order);
    const view = el('div', 'guide-layout page-container');
    const sidebar = el('aside', 'guide-sidebar');
    const sidebarHeader = el('div', 'guide-sidebar-heading');
    sidebarHeader.append(el('span', 'eyebrow', 'READING MAP'), el('h2', '', t("机制解读")));
    sidebar.append(sidebarHeader);
    const navigation = el('nav', 'guide-chapter-nav');
    navigation.setAttribute('aria-label', t("解读专题"));
    const requestedChapter = route.params.get('chapter');
    const chapter = chapters.find(item => item.id === requestedChapter) || chapters[0];
    navigation.append(anchor(t('全部章节'), hashFor('/guide'), `guide-index-link${!requestedChapter ? ' active' : ''}`));
    for (const item of chapters) {
        const link = anchor('', guideHash(item.id), `guide-chapter-link${requestedChapter && item.id === chapter?.id ? ' active' : ''}`);
        link.append(el('span', 'chapter-nav-number', String(item.order).padStart(2, '0')));
        const text = el('div');
        text.append(el('span', '', item.kicker), el('strong', '', item.title));
        link.append(text);
        navigation.append(link);
    }
    sidebar.append(navigation);
    const report = context.descriptor.report ? anchor(t("下载同版本 PDF"), reportAsset(context.descriptor), 'guide-report-link', 'download') : el('span', 'project-no-report', t("自动索引资料 · 无深度报告"));
    if (context.descriptor.report)
        report.setAttribute('download', '');
    sidebar.append(report);
    view.append(sidebar);
    const article = el('article', 'guide-article');
    if (!chapters.length) {
        article.append(emptyState(t("还没有解读数据"), t("请检查 content/chapters.json 并重新生成数据。"), 'book'));
        view.append(article);
        return { element: view };
    }
    if (requestedChapter && !chapters.some(item => item.id === requestedChapter)) {
        article.append(emptyState(t("没有找到这个解读章节"), t("章节标识“{0}”不在当前内容版本中。请从左侧选择有效章节。", requestedChapter), 'alert'));
        view.append(article);
        return { element: view };
    }
    if (!requestedChapter) {
        view.classList.add('guide-index-layout');
        article.append(pageHeader('READING MAP', t('章节目录'), t('按主题阅读解读，或沿核心执行链追踪源码。每章保留证据链接与阅读位置。')));
        const cards = el('div', 'chapter-card-grid');
        for (const item of chapters) {
            const card = anchor('', guideHash(item.id), 'chapter-card');
            const evidenceCount = new Set(item.sections.flatMap(section => section.evidence)).size;
            card.append(el('span', 'eyebrow', String(item.order).padStart(2, '0') + ' · ' + item.kicker), el('h2', '', item.title), el('p', '', item.summary));
            card.append(el('small', '', t('{0} 节 · {1} 处证据', item.sections.length, evidenceCount)));
            cards.append(card);
        }
        article.append(cards);
        view.append(article);
        return { element: view };
    }
    const heading = pageHeader(chapter.kicker, chapter.title, chapter.summary);
    const chapterMeta = el('div', 'chapter-meta');
    chapterMeta.append(el('span', '', t("第 {0} 章", String(chapter.order).padStart(2, '0'))));
    chapterMeta.append(el('span', '', t("{0} 节", chapter.sections.length)));
    chapterMeta.append(el('span', '', chapter.scope === 'deep' ? t("深入分析") : t("职责概述")));
    chapterMeta.append(el('span', '', t("内容 {0}", context.content.project.contentVersion)));
    heading.append(chapterMeta);
    const chapterActions = el('div', 'chapter-actions');
    chapterActions.append(anchor(t('全部章节'), hashFor('/guide'), 'button secondary', 'layers'));
    chapterActions.append(anchor(t("沿执行链查看"), hashFor('/flow'), 'button secondary', 'flow'));
    const copyChapter = iconButton('link', t("复制本章链接"));
    copyChapter.addEventListener('click', () => copyText(new URL(guideHash(chapter.id), location.href).toString()));
    chapterActions.append(copyChapter);
    heading.append(chapterActions);
    article.append(heading);
    const requestedSection = route.params.get('section');
    if (requestedSection && !chapter.sections.some(item => item.id === requestedSection)) {
        article.append(el('div', 'inline-warning', t("未找到小节“{0}”；已保留本章内容，请从目录选择有效位置。", requestedSection)));
    }
    for (const [index, section] of chapter.sections.entries()) {
        const sectionElement = el('section', 'guide-section');
        sectionElement.id = `chapter-${chapter.id}-${section.id}`;
        sectionElement.dataset.section = section.id;
        const sectionHeading = el('div', 'guide-section-heading');
        const number = el('span', 'section-number', `${String(chapter.order).padStart(2, '0')}.${String(index + 1).padStart(2, '0')}`);
        const title = el('h2', '', section.title);
        const copy = iconButton('link', t("复制“{0}”小节链接", section.title));
        copy.addEventListener('click', () => {
            replaceHash('/guide', { chapter: chapter.id, section: section.id });
            copyText(location.href);
        });
        sectionHeading.append(number, title, copy);
        sectionElement.append(sectionHeading);
        if (section.lead)
            sectionElement.append(el('p', 'section-lead', section.lead));
        sectionElement.append(renderBlocks(section.body));
        if (section.evidence.length) {
            const evidence = el('details', 'section-evidence') as HTMLDetailsElement;
            evidence.open = true;
            const evidenceHeading = el('summary', 'evidence-heading');
            evidenceHeading.append(el('span', '', t("源码证据 {0}", section.evidence.length)), el('small', '', t("点击路径，在对应行号继续阅读")));
            evidence.append(evidenceHeading, evidenceList(section.evidence, context.content, chapter.id, section.id));
            sectionElement.append(evidence);
        }
        article.append(sectionElement);
    }
    const chapterIndex = chapters.indexOf(chapter);
    const previousNext = el('nav', 'chapter-previous-next');
    previousNext.setAttribute('aria-label', t("上一章与下一章"));
    if (chapterIndex > 0) {
        const previous = chapters[chapterIndex - 1];
        const link = anchor('', guideHash(previous.id), 'chapter-previous');
        link.append(el('span', '', t("上一章")), el('strong', '', previous.title));
        previousNext.append(link);
    }
    else
        previousNext.append(el('span'));
    if (chapterIndex < chapters.length - 1) {
        const next = chapters[chapterIndex + 1];
        const link = anchor('', guideHash(next.id), 'chapter-next');
        link.append(el('span', '', t("下一章")), el('strong', '', next.title));
        previousNext.append(link);
    }
    article.append(previousNext);
    view.append(article);
    const toc = el('aside', 'guide-toc');
    toc.append(el('span', 'eyebrow', 'ON THIS PAGE'));
    const tocNav = el('nav');
    for (const [index, section] of chapter.sections.entries()) {
        const link = anchor(`${String(index + 1).padStart(2, '0')} ${section.title}`, guideHash(chapter.id, section.id));
        link.addEventListener('click', event => {
            event.preventDefault();
            replaceHash('/guide', { chapter: chapter.id, section: section.id });
            document.getElementById(`chapter-${chapter.id}-${section.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        link.dataset.tocSection = section.id;
        tocNav.append(link);
    }
    toc.append(tocNav);
    const relatedCase = anchor(t("打开贯穿案例"), hashFor('/case'), 'toc-case-link', 'terminal');
    toc.append(relatedCase);
    view.append(toc);
    if (requestedSection && chapter.sections.some(item => item.id === requestedSection)) {
        requestAnimationFrame(() => {
            document.getElementById(`chapter-${chapter.id}-${requestedSection}`)?.scrollIntoView({ block: 'start' });
        });
    }
    const observer = new IntersectionObserver(entries => {
        const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (!visible) return;
        const selected = (visible.target as HTMLElement).dataset.section;
        tocNav.querySelectorAll<HTMLAnchorElement>('a').forEach(link => {
            const active = link.dataset.tocSection === selected;
            link.classList.toggle('active', active);
            if (active) link.setAttribute('aria-current', 'location');
            else link.removeAttribute('aria-current');
        });
    }, { rootMargin: '-90px 0px -55% 0px', threshold: 0 });
    article.querySelectorAll('.guide-section').forEach(section => observer.observe(section));
    return { element: view, dispose: () => observer.disconnect() };
}
