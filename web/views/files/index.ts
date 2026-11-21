import { t } from '../../i18n'
import type { AppContext, Route, SymbolRecord } from '../../types';
import { loadSymbols, sourceAsset } from '../../data';
import { hashFor, replaceHash } from '../../router';
import { anchor, copyText, el, emptyState, errorState, iconButton, loadingState, statusBadge } from '../../ui';
import { icon } from '../../icons';
import { renderFileTree } from './tree';
import { createCodeViewer } from './code-viewer';
import { findSymbol, renderInspector, renderSymbolList } from './inspector';
import { createBinaryViewer, createDocumentViewer } from './document-viewer';
export interface ViewResult {
    element: HTMLElement;
    dispose?: () => void;
}
function positiveInteger(value: string | null): number | undefined {
    if (!value || !/^\d+$/.test(value))
        return undefined;
    const parsed = Number(value);
    return parsed > 0 && Number.isSafeInteger(parsed) ? parsed : undefined;
}
export function renderFiles(context: AppContext, route: Route): ViewResult {
    const { manifest, content } = context;
    const defaultPath = context.descriptor.source.defaultFile || content.flow.steps[0]?.path || manifest.files[0]?.path || '';
    const selectedPath = route.params.get('path') || defaultPath;
    if (!route.params.get('path') && selectedPath)
        replaceHash('/files', { path: selectedPath });
    const file = manifest.files.find(item => item.path === selectedPath);
    const workspace = el('div', 'source-workspace');
    workspace.append(renderFileTree(context.descriptor.id, manifest, selectedPath));
    const center = el('main', 'source-center');
    workspace.append(center);
    let viewer: {
        dispose: () => void;
    } | undefined;
    let disposed = false;
    if (!file) {
        center.append(emptyState(t("索引中没有这个文件"), t("请求路径：{0}。文件可能未纳入当前资料包索引，或链接已经损坏。", selectedPath || t("（空）")), 'alert'));
        center.append(anchor(t("在全量索引中搜索"), hashFor('/search', { q: selectedPath }), 'button primary', 'search'));
        workspace.append(el('aside', 'inspector-panel'));
        return { element: workspace };
    }
    const currentFile = file;
    const fileHeader = el('header', 'source-file-header');
    const pathBlock = el('div', 'source-path-block');
    const breadcrumb = el('div', 'source-breadcrumb');
    breadcrumb.append(el('span', '', file.moduleLabel), icon('chevron', 12), el('span', '', file.path));
    pathBlock.append(breadcrumb);
    const fileTitle = el('div', 'source-file-title');
    fileTitle.append(el('h1', '', file.name), statusBadge(file.status));
    pathBlock.append(fileTitle);
    const headerActions = el('div', 'source-header-actions');
    const copy = iconButton('link', t("复制此文件的可恢复链接"));
    copy.addEventListener('click', () => copyText(location.href));
    const raw = anchor(t("原始文件"), sourceAsset(context.descriptor.id, file.path, context.descriptor.source.root), 'button compact secondary', 'download');
    raw.setAttribute('download', file.name);
    const panelToggle = iconButton('book', t("显示或隐藏联动解读"));
    panelToggle.setAttribute('aria-pressed', 'true');
    headerActions.append(copy, raw, panelToggle);
    fileHeader.append(pathBlock, headerActions);
    center.append(fileHeader);
    const viewTabs = el('div', 'source-view-tabs');
    const tabParams = Object.fromEntries(route.params.entries());
    delete tabParams.line;
    delete tabParams.end;
    delete tabParams.view;
    const sourceTab = anchor(file.preview === 'markdown' ? t("原文") : file.preview === 'text' ? t("源码") : t("资源"), hashFor('/files', file.preview === 'markdown' ? { ...tabParams, view: 'source' } : tabParams), 'source-view-tab');
    const symbolTab = anchor(t("符号 {0}", file.symbolCount), hashFor('/files', { ...tabParams, view: 'symbols' }), 'source-view-tab');
    const showSymbols = route.params.get('view') === 'symbols';
    const showMarkdown = file.preview === 'markdown' && route.params.get('view') !== 'source' && !showSymbols;
    if (file.preview === 'markdown') {
        const previewTab = anchor(t("预览"), hashFor('/files', { ...tabParams, view: 'preview' }), `source-view-tab${showMarkdown ? ' active' : ''}`);
        viewTabs.append(previewTab);
    }
    sourceTab.classList.toggle('active', !showSymbols && !showMarkdown);
    symbolTab.classList.toggle('active', showSymbols);
    sourceTab.setAttribute('aria-current', showSymbols || showMarkdown ? 'false' : 'page');
    symbolTab.setAttribute('aria-current', showSymbols ? 'page' : 'false');
    const fileMeta = el('span', 'source-view-meta', t("{0} 行 · 最长行 {1} 字符", file.lines.toLocaleString('zh-CN'), file.longestLine.toLocaleString('zh-CN')));
    viewTabs.append(sourceTab, symbolTab, fileMeta);
    center.append(viewTabs);
    const contentArea = el('div', 'source-content-area');
    center.append(contentArea);
    const inspectorHost = el('div', 'inspector-host');
    workspace.append(inspectorHost);
    if (window.innerWidth < 1100)
        workspace.classList.add('inspector-hidden');
    panelToggle.setAttribute('aria-pressed', String(!workspace.classList.contains('inspector-hidden')));
    panelToggle.addEventListener('click', () => {
        workspace.classList.toggle('inspector-hidden');
        panelToggle.setAttribute('aria-pressed', String(!workspace.classList.contains('inspector-hidden')));
    });
    const requestedSymbol = route.params.get('symbol');
    let symbolData: SymbolRecord[] = [];
    let symbolError = '';
    const symbolPromise = loadSymbols(context.descriptor.id, file.path).then(symbols => {
        symbolData = symbols;
    }).catch(error => {
        symbolError = error instanceof Error ? error.message : String(error);
    });
    function mountInspector(): void {
        if (disposed)
            return;
        inspectorHost.replaceChildren(renderInspector(currentFile, content, symbolData, requestedSymbol, symbolError || undefined, route.params.get('chapter') || undefined, route.params.get('section') || undefined));
    }
    if (showSymbols) {
        contentArea.append(loadingState(t("正在读取此文件的 AST 符号…")));
        symbolPromise.then(() => {
            if (disposed)
                return;
            contentArea.replaceChildren();
            if (symbolError)
                contentArea.append(errorState(new Error(symbolError)));
            else
                contentArea.append(renderSymbolList(file, symbolData, content));
            mountInspector();
        });
    }
    else if (file.preview === 'binary' || file.preview === 'image') {
        contentArea.replaceChildren(createBinaryViewer(context.descriptor.id, file, context.descriptor.source.root));
        mountInspector();
    }
    else if (showMarkdown) {
        const documentViewer = createDocumentViewer(context.descriptor.id, file, line => {
            const params = Object.fromEntries(route.params.entries());
            params.view = 'source';
            if (line)
                params.line = String(line);
            else
                delete params.line;
            delete params.end;
            location.hash = hashFor('/files', params);
        });
        viewer = documentViewer;
        contentArea.replaceChildren(documentViewer.element);
        mountInspector();
    }
    else {
        contentArea.append(loadingState(t("正在准备源码视图…")));
        symbolPromise.then(() => {
            if (disposed)
                return;
            let line = positiveInteger(route.params.get('line'));
            let end = positiveInteger(route.params.get('end'));
            if (!line && requestedSymbol && symbolData.length) {
                const symbol = findSymbol(symbolData, requestedSymbol);
                if (symbol) {
                    line = symbol.startLine;
                    end = symbol.endLine;
                }
            }
            const codeViewer = createCodeViewer(context.descriptor.id, file, { line, end, symbol: requestedSymbol || undefined }, (start, selectedEnd) => {
                const params = Object.fromEntries(route.params.entries());
                params.line = String(start);
                if (selectedEnd && selectedEnd !== start)
                    params.end = String(selectedEnd);
                else
                    delete params.end;
                if (file.preview === 'markdown')
                    params.view = 'source';
                else
                    delete params.view;
                replaceHash('/files', params);
            });
            viewer = codeViewer;
            contentArea.replaceChildren(codeViewer.element);
            codeViewer.ready.then(() => {
                codeViewer.element.dataset.ready = 'true';
            }).catch(() => {
                codeViewer.element.dataset.ready = 'error';
            });
            mountInspector();
        });
    }
    return {
        element: workspace,
        dispose() {
            disposed = true;
            viewer?.dispose();
        },
    };
}
