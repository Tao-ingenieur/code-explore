import { t } from '../i18n'
import type { Catalog, ProjectDescriptor } from '../types';
import { hashForProject } from '../router';
import { anchor, el, formatNumber, shortHash } from '../ui';
import { icon } from '../icons';
import { importLocalDirectory, isLocalPackage, pickDirectory, needsDirectoryPermission, reconnectDirectory, isLegacyCopy, packageWarnings, isUnavailableAsset } from '../local-packages';
import { reportAsset, removeLibraryProject, updateLibraryProject } from '../data';
import { recentProjects, rememberOpened, savedPosition, clearPosition, rememberComparisonOrigin } from '../positions';
function typeLabel(descriptor: ProjectDescriptor): string {
    if (descriptor.type === 'comparison')
        return t("双项目对比");
    return descriptor.analysisLevel === 'deep' ? t("已有深度解读") : t("自动索引 · 未深读");
}
export function openDescriptor(descriptor: ProjectDescriptor, fresh = false): void {
    if (descriptor.type === 'comparison') rememberComparisonOrigin();
    rememberOpened(descriptor.id, descriptor.snapshot.id);
    const start = descriptor.type === 'comparison' ? '/compare' : '/overview';
    const saved = fresh ? undefined : savedPosition(descriptor.id, descriptor.snapshot.id);
    location.hash = saved || hashForProject(descriptor.id, descriptor.snapshot.id, start);
}
export function renderProjectCatalog(catalog: Catalog): HTMLElement {
    const view = el('div', 'project-catalog page-container');
    const hero = el('section', 'catalog-hero');
    const copy = el('div');
    copy.append(el('span', 'eyebrow', 'CODE EXPLORE'), el('h1', '', t("源码导航")));
    copy.append(el('p', '', t("单项目源码阅读、证据追踪与双项目对比。打开已生成的分析目录，沿章节、符号和源码行号理解系统如何工作。无需数据库、登录或外部 LLM API。")));
    const heroActions = el('div', 'catalog-hero-actions');
    const importButton = el('button', 'button primary', t('打开资料包目录')) as HTMLButtonElement;
    importButton.type = 'button';
    importButton.dataset.testid = 'open-package-directory';
    const importStatus = el('p', 'catalog-import-status');
    importStatus.setAttribute('role', 'status');
    importButton.addEventListener('click', async () => {
        try {
            // Open the browser directory picker directly during the user gesture.
            importButton.disabled = true;
            const handle = await pickDirectory();
            importStatus.textContent = t('正在校验原目录，文件不会复制或上传…');
            const descriptor = await importLocalDirectory(handle, new Set(catalog.projects.filter(item => !isLocalPackage(item.id)).map(item => item.id)));
            await updateLibraryProject(descriptor);
            view.replaceWith(renderProjectCatalog(catalog));
        } catch (error) {
            if (!(error instanceof DOMException && error.name === 'AbortError')) importStatus.textContent = error instanceof Error ? error.message : String(error);
        } finally { importButton.disabled = false; }
    });
    heroActions.append(importButton);
    const compareLink = anchor(t('进入双项目对比'), '#/compare', 'button secondary', 'branch');
    compareLink.addEventListener('click', rememberComparisonOrigin);
    heroActions.append(compareLink);
    const formatLink = anchor(t('资料包格式说明'), '#/package-help', 'button secondary', 'book');
    heroActions.append(formatLink);
    copy.append(heroActions, el('p', 'catalog-picker-mode', t('目录选择：浏览器目录授权，直接读取原文件。')), importStatus);
    hero.append(copy);
    view.append(hero);
    const recent = recentProjects();
    const availableRecent = recent.flatMap(record => {
        const descriptor = catalog.projects.find(item => item.id === record.id);
        return descriptor ? [{ record, descriptor }] : [];
    });
    if (availableRecent.length) {
        const section = el('section', 'recent-section');
        const heading = el('div', 'section-heading');
        heading.append(el('div', '', ''));
        heading.firstElementChild?.append(el('span', 'eyebrow', 'RESUME READING'), el('h2', '', t("最近打开")));
        section.append(heading);
        const list = el('div', 'recent-list');
        for (const { descriptor } of availableRecent.slice(0, 3)) {
            const button = el('button', 'recent-project') as HTMLButtonElement;
            button.type = 'button';
            button.append(icon('book', 17), el('span', '', descriptor.shortName), el('small', '', savedPosition(descriptor.id, descriptor.snapshot.id) ? t("继续上次位置") : t("重新打开")), icon('arrow', 15));
            button.addEventListener('click', () => openDescriptor(descriptor));
            list.append(button);
        }
        section.append(list);
        view.append(section);
    }
    const heading = el('div', 'section-heading catalog-list-heading');
    const headingText = el('div');
    headingText.append(el('span', 'eyebrow', 'AVAILABLE PACKAGES'), el('h2', '', t("全部资料包 · {0}", catalog.projects.length)));
    heading.append(headingText);
    heading.append(el('span', 'catalog-schema', 'PACKAGE SCHEMA v2'));
    view.append(heading);
    view.append(el('p', 'library-removal-note', t('移除只影响当前浏览器资料库，不删除磁盘目录；移除后可重新导入同一项目。')));
    const grid = el('div', 'project-card-grid');
    for (const descriptor of catalog.projects) {
        const card = el('article', `project-card project-type-${descriptor.type}`);
        card.dataset.projectId = descriptor.id;
        const top = el('div', 'project-card-top');
        top.append(el('span', 'project-type-badge', typeLabel(descriptor)), el('span', 'project-id', isLocalPackage(descriptor.id) ? isLegacyCopy(descriptor.id) ? t('旧版浏览器副本') : t('原目录直读') : descriptor.id));
        card.append(top);
        card.append(el('h2', '', descriptor.name));
        card.append(el('p', 'project-card-language', descriptor.type === 'comparison' ? t("双方实现、设计取舍与并排执行场景") : descriptor.source.language));
        const facts = el('div', 'project-card-facts');
        facts.append(el('span', '', descriptor.type === 'comparison' ? t("独立对比资料 · 绑定双方快照") : t("{0} 个文件 · {1} 行", formatNumber(descriptor.snapshot.includedFiles), formatNumber(descriptor.snapshot.totalLines || 0))));
        facts.append(el('small', '', t("快照 {0} · 内容 {1}", shortHash(descriptor.snapshot.archiveSha256), descriptor.contentVersion)));
        if (descriptor.snapshot.version) facts.append(el('small', '', descriptor.snapshot.version));
        card.append(facts);
        const warnings = packageWarnings(descriptor.id);
        if (warnings.length) {
            const notice = el('details', 'package-import-warnings');
            notice.append(el('summary', '', t('资料包有 {0} 项告警，仍可打开', warnings.length)));
            const list = el('ul');
            for (const warning of warnings) list.append(el('li', '', warning));
            notice.append(list); card.append(notice);
        }
        const actions = el('div', 'project-card-actions');
        const open = el('button', 'button primary compact') as HTMLButtonElement;
        open.type = 'button';
        const hasPosition = Boolean(savedPosition(descriptor.id, descriptor.snapshot.id));
        open.textContent = hasPosition ? t("继续阅读") : descriptor.type === 'comparison' ? t("进入对比") : t("打开项目");
        open.dataset.action = 'open-project';
        open.disabled = needsDirectoryPermission(descriptor.id);
        open.addEventListener('click', () => openDescriptor(descriptor));
        actions.append(open);
        const fresh = el('button', 'button secondary compact', t("项目首页")) as HTMLButtonElement;
        fresh.type = 'button';
        fresh.addEventListener('click', () => openDescriptor(descriptor, true));
        fresh.disabled = needsDirectoryPermission(descriptor.id);
        actions.append(fresh);
        if (needsDirectoryPermission(descriptor.id)) {
            const authorize = el('button', 'button secondary compact', t('重新授权目录')) as HTMLButtonElement;
            authorize.type = 'button';
            authorize.addEventListener('click', async () => {
                try {
                    const updated = await reconnectDirectory(descriptor.id);
                    await updateLibraryProject(updated);
                    view.replaceWith(renderProjectCatalog(catalog));
                }
                catch (error) { importStatus.textContent = String(error); }
            });
            actions.append(authorize);
        }
        if (hasPosition) {
            const clear = el('button', 'button secondary compact', t("清除记录")) as HTMLButtonElement;
            clear.type = 'button';
            clear.addEventListener('click', () => {
                clearPosition(descriptor.id, descriptor.snapshot.id);
                view.replaceWith(renderProjectCatalog(catalog));
            });
            actions.append(clear);
        }
        const remove = el('button', 'button secondary compact remove-project', t('移除项目')) as HTMLButtonElement;
        remove.type = 'button';
        remove.title = t('从当前浏览器资料库移除，保留磁盘文件');
        remove.addEventListener('click', async () => {
            remove.disabled = true;
            try { await removeLibraryProject(descriptor.id); clearPosition(descriptor.id, descriptor.snapshot.id); view.replaceWith(renderProjectCatalog(catalog)); }
            catch (error) { importStatus.textContent = String(error); remove.disabled = false; }
        });
        actions.append(remove);
        if (descriptor.report && !needsDirectoryPermission(descriptor.id) && !isUnavailableAsset(descriptor.id, descriptor.report.pdf)) {
            const report = anchor(t("报告"), reportAsset(descriptor), 'project-report-link', 'download');
            report.setAttribute('download', '');
            actions.append(report);
        }
        else {
            actions.append(el('span', 'project-no-report', t("无深度报告")));
        }
        card.append(actions);
        grid.append(card);
    }
    view.append(grid);
    const footer = el('section', 'catalog-import-note');
    footer.id = 'package-format';
    footer.append(icon('terminal', 19));
    const text = el('div');
    text.append(el('strong', '', t("需要接入新的资料包？")), el('p', '', t("选择包含 project.json 的标准分析目录，校验通过后直接读取原文件，不复制、不上传。浏览器只保存目录授权与项目描述。必要入口缺失时阻止接入；源码、符号、搜索或报告不齐时告警并允许阅读。原始源码仍需先由 AI 分析。")));
    text.append(anchor(t('查看资料包格式与导入说明'), '#/package-help', 'inline-link', 'arrow'));
    text.append(anchor(t('对比资料包格式与 AI 提示词'), '#/compare-help', 'inline-link', 'branch'));
    footer.append(text);
    view.append(footer);
    return view;
}
