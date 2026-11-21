import { t } from '../../i18n'
import type { CoreContent, FileRecord, SymbolAnnotation, SymbolRecord } from '../../types';
import { anchor, confidenceBadge, el, formatBytes, formatNumber, renderBlocks, statusBadge } from '../../ui';
import { guideHash, hashFor, sourceHash } from '../../router';
export function findSymbol(symbols: SymbolRecord[], requested: string | null): SymbolRecord | undefined {
    if (!requested)
        return undefined;
    return symbols.find(symbol => symbol.id === requested)
        || symbols.find(symbol => symbol.qualifiedName === requested)
        || symbols.find(symbol => symbol.name === requested);
}
export function findAnnotation(content: CoreContent, symbol: SymbolRecord | undefined): SymbolAnnotation | undefined {
    if (!symbol)
        return undefined;
    return content.annotations.find(annotation => annotation.symbolId === symbol.id)
        || content.annotations.find(annotation => annotation.path === symbol.path && annotation.symbol === symbol.qualifiedName)
        || content.annotations.find(annotation => annotation.path === symbol.path && annotation.symbol === symbol.name);
}
export function renderInspector(file: FileRecord, content: CoreContent, symbols: SymbolRecord[], requestedSymbol: string | null, symbolError?: string, chapterId?: string, sectionId?: string): HTMLElement {
    const panel = el('aside', 'inspector-panel');
    const heading = el('div', 'panel-heading inspector-heading');
    const title = el('div');
    title.append(el('span', 'eyebrow', 'LINKED NOTES'), el('h2', '', t("联动解读")));
    heading.append(title, statusBadge(file.status));
    panel.append(heading);
    const scroll = el('div', 'inspector-scroll');
    panel.append(scroll);
    if (chapterId) {
        const chapter = content.chapters.find(item => item.id === chapterId);
        const section = chapter?.sections.find(item => item.id === sectionId) || chapter?.sections[0];
        if (chapter && section) {
            const excerpt = el('section', 'inspector-chapter');
            const back = anchor(t("返回完整章节"), guideHash(chapter.id, section.id), 'inline-link', 'back');
            excerpt.append(back, el('span', 'eyebrow', chapter.kicker), el('h3', '', section.title));
            excerpt.append(renderBlocks(section.body.slice(0, 2)));
            excerpt.append(anchor(t("在阅读视图中打开"), guideHash(chapter.id, section.id), 'button secondary full-width', 'book'));
            scroll.append(excerpt);
        }
    }
    if (requestedSymbol) {
        const symbolSection = el('section', 'inspector-section symbol-inspector');
        symbolSection.append(el('span', 'eyebrow', 'SYMBOL LOOKUP'));
        if (symbolError) {
            symbolSection.append(el('h3', '', t("符号索引加载失败")), el('p', '', symbolError));
        }
        else {
            const symbol = findSymbol(symbols, requestedSymbol);
            if (!symbol) {
                symbolSection.append(el('h3', '', t("没有找到该符号")));
                symbolSection.append(el('p', 'muted', t("当前文件已加载 {0} 个 AST 符号，但“{1}”不在其中。它不等同于“该文件没有解读”。", symbols.length, requestedSymbol)));
            }
            else {
                const titleRow = el('div', 'symbol-title-row');
                titleRow.append(el('code', '', symbol.qualifiedName), el('span', 'symbol-kind', symbol.kind));
                symbolSection.append(titleRow);
                symbolSection.append(el('p', 'muted', t("定义范围 {0}–{1} 行 · {2}", symbol.startLine, symbol.endLine, symbol.exported ? t("已导出") : t("文件内部"))));
                const locate = anchor(t("定位符号定义"), sourceHash({ path: file.path, start: symbol.startLine, end: symbol.endLine, symbol: symbol.id }, { chapter: chapterId, section: sectionId }), 'button secondary full-width', 'code');
                symbolSection.append(locate);
                const annotation = findAnnotation(content, symbol);
                if (annotation) {
                    const note = el('div', 'symbol-note');
                    note.append(el('strong', '', t("这个符号有专门解读")), el('p', '', annotation.summary));
                    note.append(anchor(t("跳到对应说明"), guideHash(annotation.chapter, annotation.section), 'inline-link', 'arrow'));
                    symbolSection.append(note);
                }
                else {
                    const none = el('div', 'subtle-empty');
                    none.append(el('strong', '', t("符号已索引，但尚无专门解读")));
                    none.append(el('p', '', t("定义位置来自 AST 提取；没有据此推断它的运行时行为。")));
                    symbolSection.append(none);
                }
            }
        }
        scroll.append(symbolSection);
    }
    const fileInfo = el('section', 'inspector-section file-inspector');
    fileInfo.append(el('span', 'eyebrow', 'FILE RESPONSIBILITY'), el('h3', '', file.name), el('p', 'file-purpose', file.purpose));
    const facts = el('dl', 'file-facts');
    for (const [label, value] of [
        [t("所属模块"), file.moduleLabel],
        [t("源码规模"), t("{0} 行 · {1}", formatNumber(file.lines), formatBytes(file.bytes))],
        [t("符号数量"), t("{0} 个（AST）", file.symbolCount)],
        [t("验证状态"), file.verification === 'not-run' ? t("未运行示例系统") : file.verification],
    ]) {
        const row = el('div');
        row.append(el('dt', '', label), el('dd', '', value));
        facts.append(row);
    }
    fileInfo.append(facts);
    if (file.unresolved.length) {
        const pending = el('div', 'pending-box');
        pending.append(el('strong', '', t("明确待验证")));
        const list = el('ul');
        file.unresolved.forEach(item => list.append(el('li', '', item)));
        pending.append(list);
        fileInfo.append(pending);
    }
    scroll.append(fileInfo);
    const related = el('section', 'inspector-section');
    related.append(el('span', 'eyebrow', 'RELATED CHAPTERS'), el('h3', '', t("这个文件出现在哪些解读里？")));
    if (file.relatedChapters.length) {
        const list = el('div', 'related-chapter-list');
        for (const id of file.relatedChapters) {
            const chapter = content.chapters.find(item => item.id === id);
            if (!chapter)
                continue;
            const relevantSection = chapter.sections.find(section => section.evidence.some(refId => content.references.find(ref => ref.id === refId)?.path === file.path));
            const item = anchor('', guideHash(chapter.id, relevantSection?.id), 'related-chapter');
            item.append(el('span', '', chapter.kicker), el('strong', '', chapter.title));
            list.append(item);
        }
        related.append(list);
    }
    else {
        related.append(el('div', 'subtle-empty', t("这个文件还没有人工解读。当前可见的用途、符号与依赖属于索引信息，不表示已深入分析。")));
    }
    scroll.append(related);
    const dependencies = el('details', 'inspector-section dependency-details');
    dependencies.append(el('summary', '', t("静态依赖 {0} · 外部说明符 {1}", file.dependencies.length, file.externalDependencies.length)));
    const dependencyBody = el('div', 'dependency-body');
    if (file.dynamicImportCount)
        dependencyBody.append(el('p', 'muted', t("另有 {0} 处动态 import；静态边不代表完整运行时调用。", file.dynamicImportCount)));
    for (const dependency of file.dependencies) {
        dependencyBody.append(anchor(dependency, hashFor('/files', { path: dependency }), 'dependency-link', 'file'));
    }
    if (file.externalDependencies.length) {
        const external = el('div', 'external-dependencies');
        external.append(el('strong', '', t("外部／尚未解析的模块说明符")));
        for (const dependency of file.externalDependencies.slice(0, 30))
            external.append(el('code', '', dependency));
        if (file.externalDependencies.length > 30)
            external.append(el('span', '', t("另有 {0} 项", file.externalDependencies.length - 30)));
        dependencyBody.append(external);
    }
    if (file.unresolvedDependencies.length) {
        const unresolved = el('div', 'external-dependencies');
        unresolved.append(el('strong', '', t("相对导入未在当前快照中解析")));
        file.unresolvedDependencies.forEach(item => unresolved.append(el('code', '', item)));
        dependencyBody.append(unresolved);
    }
    dependencies.append(dependencyBody);
    scroll.append(dependencies);
    const provenance = el('details', 'inspector-section provenance-details');
    provenance.append(el('summary', '', t("源码完整性")));
    const hash = el('code', 'file-hash', file.sha256);
    provenance.append(el('p', '', 'SHA-256'), hash);
    if (file.parseErrors.length)
        provenance.append(el('p', 'error-text', t("{0} 条 AST 解析诊断，请查看 COVERAGE。", file.parseErrors.length)));
    else
        provenance.append(el('p', 'muted', t("TypeScript AST 解析无诊断；原始文件按字节复制。")));
    scroll.append(provenance);
    return panel;
}
export function renderSymbolList(file: FileRecord, symbols: SymbolRecord[], content: CoreContent): HTMLElement {
    const section = el('section', 'symbol-list-view');
    const header = el('div', 'symbol-list-header');
    header.append(el('span', 'eyebrow', 'ABSTRACT SYNTAX TREE'), el('h2', '', t("符号索引 · {0}", symbols.length)));
    header.append(el('p', '', t("函数、类、方法、接口与主要声明由 TypeScript AST 提取。选择定义可定位源码；有人工解读的符号另有入口。")));
    section.append(header);
    if (!symbols.length) {
        section.append(el('div', 'empty-state', t("此文件没有提取到受支持的符号声明。这不代表文件为空，也不代表已有解读。")));
        return section;
    }
    const list = el('div', 'symbol-list');
    for (const symbol of symbols) {
        const annotation = findAnnotation(content, symbol);
        const row = el('article', 'symbol-list-row');
        const main = anchor('', sourceHash({ path: file.path, start: symbol.startLine, end: symbol.endLine, symbol: symbol.id }), 'symbol-list-main');
        const name = el('div', 'symbol-list-name');
        name.append(el('code', '', symbol.qualifiedName), el('span', 'symbol-kind', symbol.kind));
        main.append(name, el('span', 'muted', t("{0}–{1} 行", symbol.startLine, symbol.endLine)));
        row.append(main);
        const actions = el('div', 'symbol-list-actions');
        if (annotation) {
            actions.append(confidenceBadge('source'));
            actions.append(anchor(t("查看解读"), guideHash(annotation.chapter, annotation.section), 'inline-link', 'book'));
        }
        else {
            actions.append(el('span', 'muted', t("无专门解读")));
        }
        row.append(actions);
        list.append(row);
    }
    section.append(list);
    return section;
}
