import { t, getLocale } from '../i18n'
import type { AppContext, Route, SearchDocument } from '../types';
import { loadSearch } from '../data';
import { guideHash, hashFor, replaceHash, sourceHash } from '../router';
import { anchor, el, emptyState, errorState, formatNumber, highlightText, iconButton, loadingState } from '../ui';
import { icon } from '../icons';
import type { ViewResult } from './files';
interface RankedResult {
    document: SearchDocument;
    score: number;
}
function normalize(value: string): string {
    return value.normalize('NFKC').toLocaleLowerCase();
}
function searchDocuments(documents: SearchDocument[], query: string): RankedResult[] {
    const terms = normalize(query).split(/\s+/).filter(Boolean);
    if (!terms.length)
        return [];
    const results: RankedResult[] = [];
    for (const document of documents) {
        const title = normalize(document.title);
        const path = normalize(document.path || '');
        const body = normalize(document.body);
        if (!terms.every(term => title.includes(term) || path.includes(term) || body.includes(term)))
            continue;
        let score = 0;
        for (const term of terms) {
            if (title === term)
                score += 140;
            else if (title.startsWith(term))
                score += 70;
            else if (title.includes(term))
                score += 38;
            if (path.includes(term))
                score += 18;
            if (body.includes(term))
                score += 6;
        }
        if (document.kind === 'analysis')
            score += 2;
        results.push({ document, score });
    }
    return results.sort((a, b) => b.score - a.score || a.document.title.localeCompare(b.document.title, getLocale()));
}
function resultLink(document: SearchDocument): string {
    if (document.kind === 'file')
        return hashFor('/files', { path: document.path });
    if (document.kind === 'symbol')
        return sourceHash({ path: document.path!, start: document.startLine, end: document.endLine, symbol: document.id.slice('symbol:'.length) });
    return guideHash(document.chapter!, document.section);
}
function snippet(document: SearchDocument, terms: string[]): string {
    const source = document.body.replace(/\s+/g, ' ').trim();
    const lower = source.toLocaleLowerCase();
    let index = -1;
    let matched = '';
    for (const term of terms) {
        index = lower.indexOf(term.toLocaleLowerCase());
        if (index >= 0) {
            matched = term;
            break;
        }
    }
    if (index < 0)
        return source.slice(0, 180);
    const start = Math.max(0, index - 65);
    const end = Math.min(source.length, index + matched.length + 115);
    return `${start > 0 ? '…' : ''}${source.slice(start, end)}${end < source.length ? '…' : ''}`;
}
export function renderSearch(context: AppContext, route: Route): ViewResult {
    const view = el('div', 'search-page page-container narrow-container');
    const heading = el('header', 'search-heading');
    heading.append(el('span', 'eyebrow', 'GLOBAL SEARCH'), el('h1', '', t("搜索整个源码快照")));
    heading.append(el('p', '', t("路径、文件用途、{0} 个符号与全部人工解读。搜索不依赖当前打开的文件。", formatNumber(context.manifest.stats.symbols))));
    view.append(heading);
    const form = el('form', 'global-search-form') as HTMLFormElement;
    form.setAttribute('role', 'search');
    form.append(icon('search', 21));
    const input = el('input') as HTMLInputElement;
    input.type = 'search';
    input.placeholder = t("输入路径、函数、类或中文概念");
    input.setAttribute('aria-label', t("全量搜索关键词"));
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.value = route.params.get('q') || '';
    const clear = iconButton('close', t("清空搜索"));
    clear.classList.add('search-clear');
    form.append(input, clear);
    const submit = el('button', 'button primary', t("搜索")) as HTMLButtonElement;
    submit.type = 'submit';
    form.append(submit);
    view.append(form);
    const filters = el('div', 'search-filters');
    const filterDefinitions = [
        ['all', t("全部")], ['file', t("文件")], ['symbol', t("函数／类／符号")], ['analysis', t("解读正文")],
    ];
    let activeFilter = route.params.get('type') || 'all';
    if (!filterDefinitions.some(([id]) => id === activeFilter))
        activeFilter = 'all';
    const filterButtons = new Map<string, HTMLButtonElement>();
    for (const [id, label] of filterDefinitions) {
        const filter = el('button', 'search-filter', label) as HTMLButtonElement;
        filter.type = 'button';
        filter.dataset.filter = id;
        filter.addEventListener('click', () => {
            activeFilter = id;
            updateUrl();
            run();
        });
        filterButtons.set(id, filter);
        filters.append(filter);
    }
    view.append(filters);
    const summary = el('div', 'search-summary');
    summary.setAttribute('aria-live', 'polite');
    view.append(summary);
    const resultsContainer = el('div', 'search-results');
    view.append(resultsContainer);
    let documents: SearchDocument[] = [];
    let loadingError = '';
    let disposed = false;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    function updateUrl(): void {
        replaceHash('/search', { q: input.value.trim(), type: activeFilter === 'all' ? undefined : activeFilter });
    }
    function renderLanding(): void {
        summary.textContent = t("输入关键词后，将同时检索文件、符号与解读。支持中文和字面特殊字符。");
        resultsContainer.replaceChildren();
        const landing = el('div', 'search-landing');
        const tips = el('div', 'search-tip-card');
        tips.append(el('h2', '', t("检索口径")));
        const list = el('ul');
        [t("文件名与完整仓库相对路径"), t("函数、类、方法、接口及其他 AST 声明"), t("专题标题、正文、证据说明与分析边界")].forEach(item => list.append(el('li', '', item)));
        tips.append(list);
        landing.append(tips);
        const suggestions = el('div', 'search-suggestions');
        suggestions.append(el('h2', '', t("从核心符号开始")));
        for (const annotation of context.content.annotations.slice(0, 6)) {
            const link = anchor('', hashFor('/search', { q: annotation.symbol }), 'suggestion-row');
            link.append(el('code', '', annotation.symbol), el('span', '', annotation.summary), icon('arrow', 15));
            suggestions.append(link);
        }
        for (const chapter of context.content.chapters.slice(0, 2)) {
            const link = anchor('', hashFor('/search', { q: chapter.kicker }), 'suggestion-row');
            link.append(el('span', 'suggestion-analysis', t("解读")), el('span', '', chapter.title), icon('arrow', 15));
            suggestions.append(link);
        }
        landing.append(suggestions);
        resultsContainer.append(landing);
    }
    function run(): void {
        if (disposed)
            return;
        const query = input.value.trim();
        for (const [id, filter] of filterButtons) {
            filter.classList.toggle('active', id === activeFilter);
            filter.setAttribute('aria-pressed', String(id === activeFilter));
            const baseLabel = filterDefinitions.find(([filterId]) => filterId === id)![1];
            filter.textContent = baseLabel;
        }
        if (loadingError) {
            summary.textContent = t("搜索索引加载失败");
            resultsContainer.replaceChildren(errorState(new Error(loadingError), loadIndex));
            return;
        }
        if (!query) {
            renderLanding();
            return;
        }
        const started = performance.now();
        const matches = searchDocuments(documents, query);
        const counts = Object.fromEntries(['file', 'symbol', 'analysis'].map(kind => [kind, matches.filter(item => item.document.kind === kind).length]));
        for (const [id, filter] of filterButtons) {
            if (id !== 'all')
                filter.textContent = `${filterDefinitions.find(([filterId]) => filterId === id)![1]} ${counts[id] || 0}`;
        }
        const filtered = activeFilter === 'all' ? matches : matches.filter(item => item.document.kind === activeFilter);
        summary.textContent = t("“{0}”命中 {1} 条 · {2} ms", query, filtered.length, Math.max(1, Math.round(performance.now() - started)));
        resultsContainer.replaceChildren();
        if (!filtered.length) {
            const empty = emptyState(t("没有找到匹配内容"), t("已搜索完整索引。请检查拼写、减少空格分隔的条件，或切换到“全部”类型。特殊字符按字面处理。"), 'search');
            const reset = el('button', 'button secondary', t("清除类型筛选")) as HTMLButtonElement;
            reset.type = 'button';
            reset.addEventListener('click', () => {
                activeFilter = 'all';
                updateUrl();
                run();
            });
            if (activeFilter !== 'all')
                empty.append(reset);
            resultsContainer.append(empty);
            return;
        }
        const terms = query.split(/\s+/).filter(Boolean);
        const limit = 250;
        const list = el('div', 'search-result-list');
        for (const { document } of filtered.slice(0, limit)) {
            const result = anchor('', resultLink(document), 'search-result');
            const kindLabel = document.kind === 'file' ? t("文件") : document.kind === 'symbol' ? document.symbolKind || t("符号") : t("解读");
            const kind = el('span', `result-kind result-${document.kind}`, kindLabel);
            const main = el('div', 'search-result-main');
            const title = el('div', 'search-result-title');
            title.append(highlightText(document.title, terms));
            const subtitle = el('div', 'search-result-subtitle', document.subtitle);
            const context = el('p', 'search-result-context');
            context.append(highlightText(snippet(document, terms), terms));
            main.append(title, subtitle, context);
            result.append(kind, main, icon('arrow', 17));
            list.append(result);
        }
        resultsContainer.append(list);
        if (filtered.length > limit) {
            resultsContainer.append(el('p', 'result-limit-note', t("完整搜索共命中 {0} 条，当前显示评分最高的前 {1} 条。请增加关键词缩小范围。", filtered.length, limit)));
        }
    }
    form.addEventListener('submit', event => {
        event.preventDefault();
        clearTimeout(debounce);
        updateUrl();
        run();
    });
    input.addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
            updateUrl();
            run();
        }, 140);
    });
    clear.addEventListener('click', () => {
        input.value = '';
        input.focus();
        updateUrl();
        run();
    });
    function loadIndex(): void {
        loadingError = '';
        resultsContainer.replaceChildren(loadingState(t("正在加载全量搜索索引…")));
        summary.textContent = t("正在准备完整索引…");
        loadSearch(context.descriptor.id).then(loaded => {
            if (disposed)
                return;
            documents = loaded;
            run();
            if (route.params.get('q'))
                input.focus();
        }).catch(error => {
            if (disposed)
                return;
            loadingError = error instanceof Error ? error.message : String(error);
            run();
        });
    }
    loadIndex();
    return {
        element: view,
        dispose() {
            disposed = true;
            clearTimeout(debounce);
        },
    };
}
