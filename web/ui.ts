import { t, getLocale } from './i18n'
import { icon } from './icons';
import type { Confidence, ContentBlock, CoreContent, SourceReference, Status } from './types';
import { referenceHash } from './router';
export function el(tag: string, className = '', text?: string): HTMLElement {
    const node = document.createElement(tag);
    if (className)
        node.className = className;
    if (text !== undefined)
        node.textContent = text;
    return node;
}
export function button(label: string, className = 'button', iconName?: string): HTMLButtonElement {
    const node = el('button', className) as HTMLButtonElement;
    node.type = 'button';
    if (iconName)
        node.append(icon(iconName, 16));
    node.append(document.createTextNode(label));
    return node;
}
export function anchor(label: string, href: string, className = '', iconName?: string): HTMLAnchorElement {
    const node = el('a', className) as HTMLAnchorElement;
    node.href = href;
    if (iconName)
        node.append(icon(iconName, 16));
    node.append(document.createTextNode(label));
    return node;
}
export function iconButton(name: string, label: string): HTMLButtonElement {
    const node = el('button', 'icon-button') as HTMLButtonElement;
    node.type = 'button';
    node.title = label;
    node.setAttribute('aria-label', label);
    node.append(icon(name, 17));
    return node;
}
export function statusBadge(status: Status, label?: string): HTMLElement {
    const labels: Record<Status, string> = {
        indexed: t("已索引"), summary: t("已概述"), deep: t("已深入分析"), pending: t("待验证"),
    };
    return el('span', `status-badge status-${status}`, label || labels[status]);
}
export function confidenceBadge(confidence: Confidence): HTMLElement {
    const labels = { source: t("源码事实"), inference: t("分析推断"), runtime: t("待运行验证") };
    return el('span', `confidence confidence-${confidence}`, labels[confidence]);
}
export function formatNumber(value: number): string {
    return new Intl.NumberFormat(getLocale()).format(value);
}
export function formatBytes(bytes: number): string {
    if (bytes < 1024)
        return `${bytes} B`;
    if (bytes < 1024 * 1024)
        return `${(bytes / 1024).toFixed(1)} KiB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}
export function shortHash(hash: string): string {
    return `${hash.slice(0, 12)}…${hash.slice(-6)}`;
}
let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(message: string, tone = 'default'): void {
    let region = document.querySelector<HTMLElement>('.toast-region');
    if (!region) {
        region = el('div', 'toast-region');
        region.setAttribute('role', 'status');
        region.setAttribute('aria-live', 'polite');
        document.body.append(region);
    }
    region.textContent = message;
    region.dataset.tone = tone;
    region.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => region.classList.remove('visible'), 2600);
}
export async function copyText(text: string, success = t("链接已复制")): Promise<void> {
    try {
        await navigator.clipboard.writeText(text);
        toast(success);
    }
    catch {
        const textarea = el('textarea', 'clipboard-fallback') as HTMLTextAreaElement;
        textarea.value = text;
        document.body.append(textarea);
        textarea.select();
        const copied = document.execCommand('copy');
        textarea.remove();
        toast(copied ? success : t("复制失败，请手动复制地址栏链接"), copied ? 'default' : 'error');
    }
}
export function emptyState(title: string, text: string, iconName = 'info'): HTMLElement {
    const node = el('div', 'empty-state');
    node.append(icon(iconName, 26));
    node.append(el('h3', '', title), el('p', '', text));
    return node;
}
export function errorState(error: unknown, retry?: () => void): HTMLElement {
    const node = el('div', 'error-state');
    node.setAttribute('role', 'alert');
    node.append(icon('alert', 25));
    node.append(el('h3', '', t("这部分内容暂时无法打开")));
    node.append(el('p', '', error instanceof Error ? error.message : String(error)));
    if (retry) {
        const retryButton = button(t("重新加载"), 'button secondary');
        retryButton.addEventListener('click', retry);
        node.append(retryButton);
    }
    return node;
}
export function loadingState(label = t("正在加载数据…")): HTMLElement {
    const node = el('div', 'loading-state');
    node.setAttribute('role', 'status');
    const spinner = el('span', 'spinner');
    node.append(spinner, el('span', '', label));
    return node;
}
export function renderBlocks(blocks: ContentBlock[]): DocumentFragment {
    const fragment = document.createDocumentFragment();
    for (const block of blocks) {
        if (block.type === 'p') {
            fragment.append(el('p', 'prose-paragraph', block.text));
        }
        else if (block.type === 'list') {
            const list = el(block.ordered ? 'ol' : 'ul', 'prose-list');
            for (const item of block.items)
                list.append(el('li', '', item));
            fragment.append(list);
        }
        else if (block.type === 'callout') {
            const callout = el('aside', `callout callout-${block.tone}`);
            callout.append(el('strong', '', block.title), el('p', '', block.text));
            fragment.append(callout);
        }
        else if (block.type === 'table') {
            const wrap = el('div', 'table-scroll');
            const table = el('table', 'prose-table');
            const head = el('thead');
            const row = el('tr');
            block.columns.forEach(column => row.append(el('th', '', column)));
            head.append(row);
            const body = el('tbody');
            for (const values of block.rows) {
                const tr = el('tr');
                values.forEach(value => tr.append(el('td', '', value)));
                body.append(tr);
            }
            table.append(head, body);
            wrap.append(table);
            fragment.append(wrap);
        }
        else if (block.type === 'code') {
            const figure = el('figure', 'prose-code');
            if (block.label)
                figure.append(el('figcaption', '', block.label));
            figure.append(el('pre', '', block.text));
            fragment.append(figure);
        }
    }
    return fragment;
}
export function evidenceList(ids: string[], content: CoreContent, chapter?: string, section?: string): HTMLElement {
    const wrap = el('div', 'evidence-list');
    for (const id of ids) {
        const reference = content.references.find(item => item.id === id);
        if (!reference)
            continue;
        wrap.append(evidenceCard(reference, chapter, section));
    }
    return wrap;
}
export function evidenceCard(reference: SourceReference, chapter?: string, section?: string): HTMLElement {
    const card = el('article', 'evidence-card');
    const top = el('div', 'evidence-top');
    top.append(confidenceBadge(reference.confidence), el('span', 'evidence-symbol', reference.symbol || t("源码范围")));
    const link = anchor('', referenceHash(reference, chapter, section), 'evidence-path');
    link.append(icon('code', 15));
    const pathText = el('span', '', `${reference.path}:${reference.start}–${reference.end}`);
    link.append(pathText, icon('arrow', 14));
    link.title = t("打开 {0}", reference.label);
    card.append(top, link, el('p', '', reference.claim));
    return card;
}
export function pageHeader(kicker: string, title: string, description: string): HTMLElement {
    const header = el('header', 'page-heading');
    header.append(el('span', 'eyebrow', kicker), el('h1', '', title), el('p', '', description));
    return header;
}
export function highlightText(text: string, terms: string[]): DocumentFragment {
    const fragment = document.createDocumentFragment();
    if (!terms.length) {
        fragment.append(document.createTextNode(text));
        return fragment;
    }
    const lower = text.toLocaleLowerCase();
    const ranges: Array<[
        number,
        number
    ]> = [];
    for (const term of terms) {
        const needle = term.toLocaleLowerCase();
        if (!needle)
            continue;
        let offset = 0;
        while (offset < text.length) {
            const index = lower.indexOf(needle, offset);
            if (index < 0)
                break;
            ranges.push([index, index + needle.length]);
            offset = index + needle.length;
        }
    }
    ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    let cursor = 0;
    for (const [start, end] of ranges) {
        if (start < cursor)
            continue;
        fragment.append(document.createTextNode(text.slice(cursor, start)));
        fragment.append(el('mark', '', text.slice(start, end)));
        cursor = end;
    }
    fragment.append(document.createTextNode(text.slice(cursor)));
    return fragment;
}
