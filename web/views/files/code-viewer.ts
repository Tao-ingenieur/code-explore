import { t } from '../../i18n'
import type { FileRecord } from '../../types';
import { loadSource } from '../../data';
import { copyText, el, iconButton, loadingState, toast } from '../../ui';
import { icon } from '../../icons';
export interface CodeFocus {
    line?: number;
    end?: number;
    symbol?: string;
}
interface CodeViewer {
    element: HTMLElement;
    ready: Promise<void>;
    dispose: () => void;
}
const LINE_HEIGHT = 24;
const LONG_LINE_LIMIT = 2000;
const expandedLongLines = new Set<string>();
function appendHighlightedCode(parent: HTMLElement, text: string): void {
    const pattern = /(\/\*[\s\S]*?\*\/|\/\/.*$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:abstract|as|async|await|break|case|catch|class|const|constructor|continue|default|delete|do|else|enum|export|extends|false|finally|for|from|function|if|implements|import|in|instanceof|interface|let|new|null|of|private|protected|public|readonly|return|satisfies|static|super|switch|this|throw|true|try|type|typeof|undefined|var|void|while|yield)\b|\b\d+(?:\.\d+)?\b)/g;
    let cursor = 0;
    for (const match of text.matchAll(pattern)) {
        const index = match.index;
        if (index > cursor)
            parent.append(document.createTextNode(text.slice(cursor, index)));
        const token = match[0];
        let className = 'token-number';
        if (token.startsWith('//') || token.startsWith('/*'))
            className = 'token-comment';
        else if (/^["'`]/.test(token))
            className = 'token-string';
        else if (/^[A-Za-z]/.test(token))
            className = 'token-keyword';
        parent.append(el('span', className, token));
        cursor = index + token.length;
    }
    if (cursor < text.length)
        parent.append(document.createTextNode(text.slice(cursor)));
}
export function createCodeViewer(projectId: string, file: FileRecord, focus: CodeFocus, onLocation: (start: number, end?: number) => void): CodeViewer {
    const element = el('section', 'code-viewer');
    const toolbar = el('div', 'code-toolbar');
    const locationLabel = el('span', 'code-location', focus.line ? t("定位到第 {0} 行", focus.line) : t("原始源码 · 物理行号"));
    const hint = el('span', 'code-toolbar-hint', t("点击行号选择 · Shift 点击选择范围"));
    const copyLocation = iconButton('link', t("复制当前源码位置链接"));
    toolbar.append(locationLabel, hint, copyLocation);
    element.append(toolbar);
    const viewport = el('div', 'code-viewport');
    viewport.tabIndex = 0;
    viewport.setAttribute('role', 'region');
    viewport.setAttribute('aria-label', t("{0} 源码，共 {1} 行", file.path, file.lines));
    element.append(viewport);
    viewport.append(loadingState(t("正在读取 {0}…", file.path)));
    const controller = new AbortController();
    let disposed = false;
    let frame = 0;
    let lines: string[] = [];
    let selectionStart = Math.max(1, focus.line || 1);
    let selectionEnd = Math.max(selectionStart, focus.end || selectionStart);
    let anchorLine = selectionStart;
    let surface: HTMLElement | undefined;
    let resizeObserver: ResizeObserver | undefined;
    copyLocation.addEventListener('click', () => copyText(location.href));
    function scheduleRender(): void {
        if (frame || disposed || !surface)
            return;
        frame = requestAnimationFrame(() => {
            frame = 0;
            renderVisibleLines();
        });
    }
    function renderVisibleLines(): void {
        if (!surface || disposed)
            return;
        const first = Math.max(0, Math.floor(viewport.scrollTop / LINE_HEIGHT) - 14);
        const count = Math.ceil(viewport.clientHeight / LINE_HEIGHT) + 28;
        const last = Math.min(lines.length - 1, first + count);
        surface.replaceChildren();
        surface.style.height = `${lines.length * LINE_HEIGHT}px`;
        for (let index = first; index <= last; index += 1) {
            const lineNumber = index + 1;
            const line = el('div', 'code-line');
            line.style.top = `${index * LINE_HEIGHT}px`;
            line.dataset.line = String(lineNumber);
            if (lineNumber >= selectionStart && lineNumber <= selectionEnd)
                line.classList.add('is-reference');
            if (lineNumber === selectionStart)
                line.classList.add('is-current');
            const number = el('button', 'line-number', String(lineNumber)) as HTMLButtonElement;
            number.type = 'button';
            number.tabIndex = -1;
            number.title = t("第 {0} 行；Shift 点击可选择范围", lineNumber);
            number.setAttribute('aria-label', t("选择第 {0} 行", lineNumber));
            number.addEventListener('click', event => {
                if (event.shiftKey) {
                    selectionStart = Math.min(anchorLine, lineNumber);
                    selectionEnd = Math.max(anchorLine, lineNumber);
                }
                else {
                    anchorLine = lineNumber;
                    selectionStart = lineNumber;
                    selectionEnd = lineNumber;
                }
                onLocation(selectionStart, selectionEnd);
                locationLabel.textContent = selectionStart === selectionEnd ? t("已选择第 {0} 行", selectionStart) : t("已选择 {0}–{1} 行", selectionStart, selectionEnd);
                renderVisibleLines();
            });
            const content = el('code', 'line-content');
            const original = lines[index];
            const expansionKey = `${projectId}:${file.path}:${lineNumber}`;
            const isExpanded = expandedLongLines.has(expansionKey);
            if (original.length > LONG_LINE_LIMIT && !isExpanded) {
                appendHighlightedCode(content, original.slice(0, LONG_LINE_LIMIT));
                const expand = el('button', 'long-line-toggle', t("… 此行共 {0} 字符，展开", original.length.toLocaleString('zh-CN'))) as HTMLButtonElement;
                expand.type = 'button';
                expand.addEventListener('click', () => {
                    expandedLongLines.add(expansionKey);
                    renderVisibleLines();
                    toast(t("已展开完整原始行；可再次点击折叠"));
                });
                content.append(expand);
            }
            else {
                appendHighlightedCode(content, original);
                if (original.length > LONG_LINE_LIMIT) {
                    const collapse = el('button', 'long-line-toggle', t("折叠长行")) as HTMLButtonElement;
                    collapse.type = 'button';
                    collapse.addEventListener('click', () => {
                        expandedLongLines.delete(expansionKey);
                        renderVisibleLines();
                    });
                    content.append(collapse);
                }
            }
            line.append(number, content);
            surface.append(line);
        }
    }
    viewport.addEventListener('scroll', scheduleRender, { passive: true });
    const ready = loadSource(projectId, file.path, controller.signal).then(text => {
        if (disposed)
            return;
        lines = text.split(/\r\n|\r|\n/);
        if (lines.length > 1 && lines.at(-1) === '')
            lines.pop();
        if (lines.length !== file.lines) {
            console.warn(t("行数校验不一致：{0}，索引 {1}，读取 {2}", file.path, file.lines, lines.length));
        }
        if (selectionStart > lines.length) {
            toast(t("请求行号超出文件范围，已定位到末行（共 {0} 行）", lines.length), 'error');
            selectionStart = Math.max(1, lines.length);
            selectionEnd = selectionStart;
            anchorLine = selectionStart;
            onLocation(selectionStart);
        }
        selectionEnd = Math.min(selectionEnd, lines.length);
        viewport.replaceChildren();
        surface = el('div', 'code-surface');
        viewport.append(surface);
        renderVisibleLines();
        if (focus.line) {
            requestAnimationFrame(() => {
                if (disposed)
                    return;
                viewport.scrollTop = Math.max(0, (selectionStart - 1) * LINE_HEIGHT - viewport.clientHeight * 0.38);
                viewport.scrollLeft = 0;
                scheduleRender();
            });
        }
        resizeObserver = new ResizeObserver(scheduleRender);
        resizeObserver.observe(viewport);
    }).catch(error => {
        if (disposed || controller.signal.aborted)
            return;
        viewport.replaceChildren();
        const failure = el('div', 'source-error');
        failure.setAttribute('role', 'alert');
        failure.append(icon('alert', 25), el('h3', '', t("源码加载失败")), el('p', '', error instanceof Error ? error.message : String(error)));
        const retry = el('button', 'button secondary', t("重新读取")) as HTMLButtonElement;
        retry.type = 'button';
        retry.addEventListener('click', () => location.reload());
        failure.append(retry);
        viewport.append(failure);
        throw error;
    });
    ready.catch(() => undefined);
    return {
        element,
        ready,
        dispose() {
            disposed = true;
            controller.abort();
            cancelAnimationFrame(frame);
            resizeObserver?.disconnect();
        },
    };
}
