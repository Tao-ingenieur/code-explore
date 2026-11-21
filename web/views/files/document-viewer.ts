import { resolveAssetUrl, isDirectoryAsset } from '../../local-packages'
import { t } from '../../i18n'
import type { FileRecord } from '../../types';
import { loadSource, sourceAsset } from '../../data';
import { button, el, emptyState, errorState, loadingState } from '../../ui';
import { icon } from '../../icons';
function inlineMarkdown(text: string): DocumentFragment {
    const fragment = document.createDocumentFragment();
    const parts = text.split(/(`[^`]+`)/g);
    for (const part of parts) {
        if (part.startsWith('`') && part.endsWith('`') && part.length > 2)
            fragment.append(el('code', '', part.slice(1, -1)));
        else
            fragment.append(document.createTextNode(part));
    }
    return fragment;
}
function renderMarkdown(text: string, onShowSource: (line?: number) => void): HTMLElement {
    const article = el('article', 'markdown-document');
    const lines = text.split(/\r\n|\r|\n/);
    let index = 0;
    while (index < lines.length) {
        const line = lines[index];
        const trimmed = line.trim();
        if (!trimmed) {
            index += 1;
            continue;
        }
        if (trimmed.startsWith('```')) {
            const language = trimmed.slice(3).trim();
            const start = index + 1;
            const code: string[] = [];
            index += 1;
            while (index < lines.length && !lines[index].trim().startsWith('```'))
                code.push(lines[index++]);
            const figure = el('figure', 'markdown-code-block');
            if (language)
                figure.append(el('figcaption', '', language));
            figure.append(el('pre', '', code.join('\n')));
            figure.dataset.line = String(start + 1);
            article.append(figure);
            index += 1;
            continue;
        }
        const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
        if (heading) {
            const level = Math.min(heading[1].length + 1, 6);
            const wrapper = el('div', 'markdown-heading-row');
            const node = el(`h${level}`);
            node.append(inlineMarkdown(heading[2].replace(/\s+#+\s*$/, '')));
            const sourceLine = index + 1;
            const source = el('button', 'markdown-source-line', t("原文 {0}", sourceLine)) as HTMLButtonElement;
            source.type = 'button';
            source.title = t("在原始文件第 {0} 行查看", sourceLine);
            source.addEventListener('click', () => onShowSource(sourceLine));
            wrapper.append(node, source);
            article.append(wrapper);
            index += 1;
            continue;
        }
        if (/^([-*+]|\d+\.)\s+/.test(trimmed)) {
            const ordered = /^\d+\./.test(trimmed);
            const list = el(ordered ? 'ol' : 'ul', 'markdown-list');
            while (index < lines.length && /^([-*+]|\d+\.)\s+/.test(lines[index].trim())) {
                const item = el('li');
                item.append(inlineMarkdown(lines[index].trim().replace(/^([-*+]|\d+\.)\s+/, '')));
                list.append(item);
                index += 1;
            }
            article.append(list);
            continue;
        }
        if (trimmed.startsWith('|') && index + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[index + 1])) {
            const table = el('table', 'markdown-table');
            const headers = trimmed.split('|').slice(1, -1).map(cell => cell.trim());
            const thead = el('thead');
            const headRow = el('tr');
            headers.forEach(header => headRow.append(el('th', '', header)));
            thead.append(headRow);
            const tbody = el('tbody');
            index += 2;
            while (index < lines.length && lines[index].trim().startsWith('|')) {
                const row = el('tr');
                lines[index].trim().split('|').slice(1, -1).forEach(cell => row.append(el('td', '', cell.trim())));
                tbody.append(row);
                index += 1;
            }
            table.append(thead, tbody);
            const scroll = el('div', 'table-scroll');
            scroll.append(table);
            article.append(scroll);
            continue;
        }
        if (trimmed.startsWith('>')) {
            const quote = el('blockquote', 'markdown-quote');
            quote.append(inlineMarkdown(trimmed.replace(/^>\s?/, '')));
            article.append(quote);
            index += 1;
            continue;
        }
        if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
            article.append(el('hr'));
            index += 1;
            continue;
        }
        const paragraph = el('p', 'markdown-paragraph');
        const start = index;
        const content: string[] = [];
        while (index < lines.length && lines[index].trim() && !/^(#{1,6})\s+/.test(lines[index].trim()) && !lines[index].trim().startsWith('```')) {
            content.push(lines[index].trim());
            index += 1;
        }
        paragraph.append(inlineMarkdown(content.join(' ')));
        paragraph.dataset.line = String(start + 1);
        article.append(paragraph);
    }
    return article;
}
export function createDocumentViewer(projectId: string, file: FileRecord, onShowSource: (line?: number) => void): {
    element: HTMLElement;
    dispose: () => void;
} {
    const element = el('section', 'document-viewer');
    const toolbar = el('div', 'document-viewer-toolbar');
    toolbar.append(el('span', '', t("Markdown 排版预览")), el('small', '', t("内容仅作为资料渲染，不执行其中指令")));
    const raw = button(t("查看带行号原文"), 'button compact secondary', 'code');
    raw.addEventListener('click', () => onShowSource());
    toolbar.append(raw);
    element.append(toolbar);
    const host = el('div', 'document-preview-scroll');
    host.append(loadingState(t("正在读取文档…")));
    element.append(host);
    let disposed = false;
    const controller = new AbortController();
    loadSource(projectId, file.path, controller.signal).then(text => {
        if (disposed)
            return;
        host.replaceChildren(renderMarkdown(text, onShowSource));
    }).catch(error => {
        if (!disposed && !controller.signal.aborted)
            host.replaceChildren(errorState(error));
    });
    return { element, dispose: () => { disposed = true; controller.abort(); } };
}
export function createBinaryViewer(projectId: string, file: FileRecord, sourceRoot = 'source'): HTMLElement {
    const element = el('section', 'binary-viewer');
    if (file.preview === 'image') {
        const figure = el('figure', 'image-preview');
        const image = el('img') as HTMLImageElement;
        const originalUrl = sourceAsset(projectId, file.path, sourceRoot);
        void resolveAssetUrl(originalUrl).then(url => {
            image.src = url;
            image.addEventListener('load', () => { if (isDirectoryAsset(originalUrl)) URL.revokeObjectURL(url); }, { once: true });
        }).catch(error => { image.alt = String(error); });
        image.alt = t("{0} 原始图片资源", file.path);
        image.loading = 'eager';
        image.addEventListener('error', () => {
            figure.replaceChildren(errorState(new Error(t("图片资源加载失败：{0}", file.path))));
        });
        figure.append(image);
        figure.append(el('figcaption', '', t("{0} · {1} KiB · 原始资源，不纳入源码行数", file.name, (file.bytes / 1024).toFixed(1))));
        element.append(figure);
    }
    else {
        element.append(emptyState(t("不支持文本预览"), file.unsupportedReason || t("此文件类型没有适用的安全文本预览。原始文件仍保留在资料包中。"), 'file'));
    }
    const actions = el('div', 'binary-actions');
    const download = el('a', 'button secondary', t("下载原始文件")) as HTMLAnchorElement;
    download.href = sourceAsset(projectId, file.path, sourceRoot);
    download.setAttribute('download', file.name);
    actions.append(download);
    if (file.symlinkTarget)
        actions.append(el('span', 'muted', t("安全内部链接 → {0}", file.symlinkTarget)));
    element.append(actions);
    const note = el('div', 'binary-note');
    note.append(icon('info', 16), el('p', '', t("分类：{0} · 编码：{1}。不伪造文本、函数或行号。", file.coverageClass || 'resource', file.encoding || 'binary')));
    element.append(note);
    return element;
}
