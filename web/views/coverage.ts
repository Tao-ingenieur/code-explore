import { t } from '../i18n'
import type { AppContext, Route, Status } from '../types';
import { reportAsset } from '../data';
import { guideHash, hashFor } from '../router';
import { anchor, copyText, el, formatBytes, formatNumber, iconButton, pageHeader, statusBadge } from '../ui';
import { icon } from '../icons';
import type { ViewResult } from './files';
export function renderCoverage(context: AppContext, route: Route): ViewResult {
    const { manifest, content } = context;
    const view = el('div', 'coverage-page page-container');
    const heading = pageHeader('COVERAGE & LIMITS', t("覆盖范围，不是覆盖幻觉"), t("完整清点与深入分析是两件事。这里公开每一种状态、排除规则、静态关系限制和仍需运行验证的问题。"));
    const report = context.descriptor.report ? anchor(t("下载同版本 PDF"), reportAsset(context.descriptor), 'button primary', 'download') : el('span', 'project-no-report', t("自动索引资料 · 无深度报告"));
    if (context.descriptor.report)
        report.setAttribute('download', '');
    heading.append(report);
    view.append(heading);
    const versionCard = el('section', 'version-card');
    const versionMain = el('div');
    versionMain.append(el('span', 'eyebrow', 'REPRODUCIBLE SNAPSHOT'), el('h2', '', `analysis-${content.project.contentVersion}`));
    versionMain.append(el('p', '', t("{0} · 静态分析日期 {1}", content.project.source.label, content.project.analysisDate)));
    const hashRow = el('div', 'version-hash');
    hashRow.append(el('code', '', content.project.source.snapshotSha256));
    const copyHash = iconButton('copy', t("复制完整源码快照 SHA-256"));
    copyHash.addEventListener('click', () => copyText(content.project.source.snapshotSha256, t("快照哈希已复制")));
    hashRow.append(copyHash);
    versionMain.append(hashRow);
    const versionFacts = el('dl', 'version-facts');
    for (const [label, value] of [
        [t("提交号"), content.project.source.commit || t("未提供；使用附件内容哈希")],
        [t("树内容哈希"), content.project.source.treeSha256.slice(0, 20) + '…'],
        [t("网站／报告"), t("同一内容版本 {0}", content.project.contentVersion)],
        [t("示例运行"), t("未执行；缺少依赖与构建清单")],
    ]) {
        const row = el('div');
        row.append(el('dt', '', label), el('dd', '', value));
        versionFacts.append(row);
    }
    versionCard.append(versionMain, versionFacts);
    view.append(versionCard);
    if (manifest.stats.coverageClassCounts) {
        const classSection = el('section', 'coverage-class-section');
        classSection.append(el('span', 'eyebrow', 'INVENTORY CLASSES'), el('h2', '', t("全量清单与深入覆盖分开统计")));
        const eligibleTotal = Object.values(manifest.stats.eligibleStatusCounts || {}).reduce((sum, count) => sum + count, 0);
        classSection.append(el('p', '', t("可深入分析文件 {0} 个；资源、锁文件、测试、生成代码、翻译、第三方和系统元数据保留清单，但不计入深入覆盖率分母。", formatNumber(eligibleTotal))));
        const classes = el('div', 'coverage-class-strip');
        for (const [kind, count] of Object.entries(manifest.stats.coverageClassCounts)) {
            const item = el('span', 'coverage-class-item');
            item.append(el('code', '', kind), el('strong', '', formatNumber(count)));
            classes.append(item);
        }
        classSection.append(classes);
        view.append(classSection);
    }
    const statusSection = el('section', 'coverage-section');
    const statusHeading = el('div', 'section-heading');
    statusHeading.append(el('div', '', ''));
    statusHeading.firstElementChild?.append(el('span', 'eyebrow', 'EDITORIAL STATUS'), el('h2', '', t("{0} 个文件，四种明确状态", formatNumber(manifest.stats.files))));
    statusSection.append(statusHeading);
    const bar = el('div', 'coverage-bar');
    bar.setAttribute('role', 'img');
    bar.setAttribute('aria-label', t("文件分析状态分布；详细数值见下方表格"));
    const statuses: Status[] = ['indexed', 'summary', 'deep', 'pending'];
    for (const status of statuses) {
        const count = manifest.stats.statusCounts[status];
        const segment = el('button', `coverage-segment coverage-${status}`) as HTMLButtonElement;
        segment.type = 'button';
        segment.style.width = `${Math.max(count / manifest.stats.files * 100, 0.25)}%`;
        segment.title = t("{0}：{1} 个文件，{2}%", manifest.statusLabels[status], count, (count / manifest.stats.files * 100).toFixed(1));
        segment.setAttribute('aria-label', t("筛选{0}", segment.title));
        segment.addEventListener('click', () => {
            selectedStatus = status;
            page = 1;
            renderTable();
            tableSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        bar.append(segment);
    }
    statusSection.append(bar);
    const statusTable = el('div', 'coverage-status-grid');
    const descriptions: Record<Status, string> = {
        indexed: t("自动清单、AST 符号和静态导入；未人工判断行为。"),
        summary: t("已人工归纳文件或模块职责，未展开全部分支。"),
        deep: t("核心机制有连贯解释、分支说明与行号证据。"),
        pending: t("已有分析，但存在显式未解决的问题或运行时边界。"),
    };
    for (const status of statuses) {
        const card = el('button', `coverage-status-card coverage-${status}`) as HTMLButtonElement;
        card.type = 'button';
        const top = el('div');
        top.append(statusBadge(status), el('strong', '', formatNumber(manifest.stats.statusCounts[status])));
        card.append(top, el('p', '', descriptions[status]));
        card.addEventListener('click', () => {
            selectedStatus = status;
            page = 1;
            renderTable();
            tableSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        statusTable.append(card);
    }
    statusSection.append(statusTable);
    view.append(statusSection);
    const twoColumn = el('div', 'coverage-two-column');
    const deepScope = el('section', 'coverage-section coverage-card');
    deepScope.append(el('span', 'eyebrow', 'DEEP ANALYSIS'), el('h2', '', t("已深入分析的机制")));
    const chapterList = el('div', 'coverage-chapter-list');
    for (const chapter of content.chapters) {
        const link = anchor('', guideHash(chapter.id), 'coverage-chapter');
        link.append(el('span', '', String(chapter.order).padStart(2, '0')));
        const text = el('div');
        text.append(el('strong', '', chapter.title), el('p', '', chapter.summary));
        link.append(text, icon('arrow', 15));
        chapterList.append(link);
    }
    deepScope.append(chapterList);
    twoColumn.append(deepScope);
    const limits = el('section', 'coverage-section coverage-card limits-card');
    limits.append(el('span', 'eyebrow', 'NOT YET VERIFIED'), el('h2', '', t("分析边界与未验证事项")));
    const globalLimit = el('div', 'coverage-runtime-warning');
    globalLimit.append(icon('alert', 20), el('p', '', content.project.source.runtimeNote));
    limits.append(globalLimit);
    const pendingFiles = manifest.files.filter(file => file.unresolved.length);
    const pendingList = el('ul', 'pending-file-list');
    for (const file of pendingFiles) {
        const item = el('li');
        item.append(anchor(file.path, hashFor('/files', { path: file.path }), 'mono-link'));
        const details = el('ul');
        file.unresolved.forEach(question => details.append(el('li', '', question)));
        item.append(details);
        pendingList.append(item);
    }
    limits.append(pendingList);
    twoColumn.append(limits);
    view.append(twoColumn);
    const policySection = el('section', 'coverage-section');
    policySection.append(el('span', 'eyebrow', 'INCLUSION POLICY'), el('h2', '', t("第三方、生成文件、重复项与排除项")));
    const policyGrid = el('div', 'policy-grid');
    for (const policy of content.project.policies) {
        const card = el('div', 'policy-card');
        card.append(icon('check', 17), el('p', '', policy));
        policyGrid.append(card);
    }
    for (const exclusion of content.project.exclusions) {
        const card = el('div', 'policy-card exclusion-card');
        card.append(el('code', '', exclusion.path), el('p', '', exclusion.reason));
        policyGrid.append(card);
    }
    if (content.project.source.duplicateGroups.length) {
        const card = el('div', 'policy-card exclusion-card');
        const paths = content.project.source.duplicateGroups.flat();
        card.append(el('code', '', t("{0} 组重复内容 · {1} 个文件", content.project.source.duplicateGroups.length, paths.length)), el('p', '', t("重复项仍全部保留并索引，不据此推断生成方式或实际调用关系。")));
        const list = el('details');
        list.append(el('summary', '', t("查看重复文件路径")));
        const listBody = el('div', 'duplicate-paths');
        paths.forEach(path => listBody.append(anchor(path, hashFor('/files', { path }), 'mono-link')));
        list.append(listBody);
        card.append(list);
        policyGrid.append(card);
    }
    policySection.append(policyGrid);
    view.append(policySection);
    const moduleSection = el('section', 'coverage-section');
    moduleSection.append(el('span', 'eyebrow', 'DIRECTORY MAP'), el('h2', '', t("模块与目录地图")));
    const moduleTable = el('div', 'module-table-wrap');
    const moduleTableElement = el('table', 'module-table');
    moduleTableElement.append(el('thead'));
    const moduleHeadRow = el('tr');
    [t("模块"), t("目录"), t("文件"), t("源码行"), t("职责")].forEach(label => moduleHeadRow.append(el('th', '', label)));
    moduleTableElement.firstElementChild?.append(moduleHeadRow);
    const moduleBody = el('tbody');
    for (const module of manifest.modules) {
        const row = el('tr');
        const button = el('button', 'module-filter-button', module.label) as HTMLButtonElement;
        button.type = 'button';
        button.addEventListener('click', () => {
            selectedModule = module.id;
            page = 1;
            renderTable();
            tableSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        const nameCell = el('td');
        nameCell.append(button);
        row.append(nameCell, el('td', '', module.path), el('td', 'numeric', formatNumber(module.files)), el('td', 'numeric', formatNumber(module.lines)), el('td', '', module.description));
        moduleBody.append(row);
    }
    moduleTableElement.append(moduleBody);
    moduleTable.append(moduleTableElement);
    moduleSection.append(moduleTable);
    view.append(moduleSection);
    const tableSection = el('section', 'coverage-section inventory-section');
    tableSection.append(el('span', 'eyebrow', 'FULL FILE INVENTORY'), el('h2', '', t("全文件覆盖索引")));
    const controls = el('div', 'inventory-controls');
    const search = el('input') as HTMLInputElement;
    search.type = 'search';
    search.placeholder = t("筛选路径或用途");
    search.setAttribute('aria-label', t("筛选覆盖索引"));
    const moduleSelect = el('select') as HTMLSelectElement;
    moduleSelect.setAttribute('aria-label', t("按模块筛选文件"));
    const allModules = el('option', '', t("全部模块")) as HTMLOptionElement;
    allModules.value = 'all';
    moduleSelect.append(allModules);
    for (const module of manifest.modules) {
        const option = el('option', '', module.label) as HTMLOptionElement;
        option.value = module.id;
        moduleSelect.append(option);
    }
    const statusSelect = el('select') as HTMLSelectElement;
    statusSelect.setAttribute('aria-label', t("按状态筛选文件"));
    const allStatuses = el('option', '', t("全部状态")) as HTMLOptionElement;
    allStatuses.value = 'all';
    statusSelect.append(allStatuses);
    for (const status of statuses) {
        const option = el('option', '', manifest.statusLabels[status]) as HTMLOptionElement;
        option.value = status;
        statusSelect.append(option);
    }
    controls.append(search, moduleSelect, statusSelect);
    tableSection.append(controls);
    const tableSummary = el('div', 'inventory-summary');
    const tableHost = el('div', 'inventory-table-host');
    const pagination = el('div', 'pagination');
    tableSection.append(tableSummary, tableHost, pagination);
    view.append(tableSection);
    let selectedModule = route.params.get('module') || 'all';
    let selectedStatus: Status | 'all' = (route.params.get('status') as Status) || 'all';
    if (!manifest.modules.some(module => module.id === selectedModule))
        selectedModule = 'all';
    if (!statuses.includes(selectedStatus as Status))
        selectedStatus = 'all';
    moduleSelect.value = selectedModule;
    statusSelect.value = selectedStatus;
    let page = 1;
    const pageSize = 100;
    function renderTable(): void {
        moduleSelect.value = selectedModule;
        statusSelect.value = selectedStatus;
        const query = search.value.trim().toLocaleLowerCase();
        const filtered = manifest.files.filter(file => (selectedModule === 'all' || file.module === selectedModule)
            && (selectedStatus === 'all' || file.status === selectedStatus)
            && (!query || `${file.path} ${file.purpose}`.toLocaleLowerCase().includes(query)));
        const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
        page = Math.min(page, pages);
        tableSummary.textContent = t("命中 {0} 个文件 · 第 {1} / {2} 页 · 每页最多 {3} 条", formatNumber(filtered.length), page, pages, pageSize);
        tableHost.replaceChildren();
        const scroll = el('div', 'table-scroll');
        const table = el('table', 'inventory-table');
        const head = el('thead');
        const headRow = el('tr');
        [t("文件路径"), t("模块"), t("用途"), t("行数"), t("符号"), t("状态")].forEach(label => headRow.append(el('th', '', label)));
        head.append(headRow);
        const body = el('tbody');
        for (const file of filtered.slice((page - 1) * pageSize, page * pageSize)) {
            const row = el('tr');
            const pathCell = el('td');
            pathCell.append(anchor(file.path, hashFor('/files', { path: file.path }), 'inventory-path'));
            if (file.coverageClass && file.coverageClass !== 'source')
                pathCell.append(el('span', 'file-class-badge', file.coverageClass));
            const purpose = el('td', 'inventory-purpose', file.purpose);
            purpose.title = file.purpose;
            const statusCell = el('td');
            statusCell.append(statusBadge(file.status));
            row.append(pathCell, el('td', '', file.moduleLabel), purpose, el('td', 'numeric', formatNumber(file.lines)), el('td', 'numeric', String(file.symbolCount)), statusCell);
            body.append(row);
        }
        table.append(head, body);
        scroll.append(table);
        tableHost.append(scroll);
        pagination.replaceChildren();
        const previous = el('button', 'button secondary', t("上一页")) as HTMLButtonElement;
        previous.type = 'button';
        previous.disabled = page <= 1;
        previous.addEventListener('click', () => {
            page -= 1;
            renderTable();
            tableSection.scrollIntoView({ block: 'start' });
        });
        const next = el('button', 'button secondary', t("下一页")) as HTMLButtonElement;
        next.type = 'button';
        next.disabled = page >= pages;
        next.addEventListener('click', () => {
            page += 1;
            renderTable();
            tableSection.scrollIntoView({ block: 'start' });
        });
        pagination.append(previous, el('span', '', `${page} / ${pages}`), next);
    }
    let filterTimer: ReturnType<typeof setTimeout> | undefined;
    search.addEventListener('input', () => {
        clearTimeout(filterTimer);
        filterTimer = setTimeout(() => {
            page = 1;
            renderTable();
        }, 120);
    });
    moduleSelect.addEventListener('change', () => {
        selectedModule = moduleSelect.value;
        page = 1;
        renderTable();
    });
    statusSelect.addEventListener('change', () => {
        selectedStatus = statusSelect.value as Status | 'all';
        page = 1;
        renderTable();
    });
    renderTable();
    const footer = el('footer', 'coverage-footer');
    const unresolvedImports = manifest.files.reduce((sum, file) => sum + file.unresolvedDependencies.length, 0);
    footer.append(el('span', '', t("AST 解析诊断 {0} · 未解析相对导入记录 {1}", manifest.stats.parseErrorCount, unresolvedImports)));
    footer.append(el('span', '', t("原始源码镜像 {0} · 不含凭证或外部 API", formatBytes(manifest.files.reduce((sum, file) => sum + file.bytes, 0)))));
    view.append(footer);
    return { element: view, dispose: () => clearTimeout(filterTimer) };
}
