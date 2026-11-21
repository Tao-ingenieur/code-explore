import { isDirectoryAsset, resolveAssetUrl } from './local-packages'
import { t, getLanguage, setLanguage } from './i18n'
import './styles.css';
import { parseRoute, hashFor, hashForProject, setActiveProject } from './router';
import { loadCatalog, loadCore, loadDescriptor, reportAsset } from './data';
import type { AppContext, ProjectDescriptor, Route } from './types';
import { anchor, el, errorState, loadingState, toast } from './ui';
import { icon } from './icons';
import { renderOverview } from './views/overview';
import { renderFiles, type ViewResult } from './views/files';
import { renderSearch } from './views/search';
import { renderGuide } from './views/guide';
import { renderCase, renderFlow } from './views/flow';
import { renderCoverage } from './views/coverage';
import { renderProjectCatalog } from './views/catalog';
import { renderComparison } from './views/comparison';
import { renderPairWorkspace, renderComparisonHelp } from './views/pair';
import { renderPackageHelp } from './views/package-help';
import { rememberOpened, savePosition, rememberComparisonOrigin } from './positions';
if (window.self !== window.top) document.documentElement.classList.add('embedded-reader');
document.addEventListener('click', event => {
    const link = (event.target as Element).closest<HTMLAnchorElement>('a[href]');
    if (!link || !isDirectoryAsset(link.href)) return;
    event.preventDefault();
    const href = link.href;
    resolveAssetUrl(href).then(url => {
        const download = document.createElement('a');
        download.href = url;
        download.download = link.download || decodeURIComponent(new URL(href).pathname.split('/').at(-1) || 'download');
        download.click();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
    }).catch(error => toast(error instanceof Error ? error.message : String(error), 'error'));
}, true);
const app = document.getElementById('app')!;
const skip = el('a', 'skip-link', t("跳到主要内容")) as HTMLAnchorElement;
skip.href = '#main-content';
skip.addEventListener('click', event => {
    event.preventDefault();
    document.getElementById('main-content')?.focus();
});
app.append(skip);
const header = el('header', 'app-header');
const brand = el('a', 'brand') as HTMLAnchorElement;
brand.href = '#/projects';
brand.setAttribute('aria-label', t("源码导航项目列表"));
const brandMark = el('span', 'brand-mark');
for (let index = 0; index < 4; index += 1)
    brandMark.append(el('span'));
const brandText = el('span', 'brand-text');
brandText.append(el('strong', '', t("源码导航")), el('small', '', getLanguage() === 'en' ? 'SOURCE NAVIGATION' : 'CODE EXPLORE'));
brand.append(brandMark, brandText);
brand.addEventListener('click', () => {
    if (currentDescriptor)
        savePosition(currentDescriptor.id, currentDescriptor.snapshot.id, location.hash);
});
header.append(brand);
const nav = el('nav', 'main-nav');
nav.setAttribute('aria-label', t("主导航"));
header.append(nav);
const headerActions = el('div', 'header-actions');
const searchButton = el('a', 'header-search') as HTMLAnchorElement;
searchButton.setAttribute('aria-label', t('搜索当前项目'));
searchButton.append(icon('search', 16), el('span', '', t("搜索当前项目")));
searchButton.append(el('kbd', '', 'Ctrl K'));
headerActions.append(searchButton);
const report = el('a', 'header-report') as HTMLAnchorElement;
report.setAttribute('download', '');
report.append(icon('download', 16), el('span', '', t("项目报告")));
headerActions.append(report);
const closeButton = el('button', 'header-close') as HTMLButtonElement;
closeButton.type = 'button';
closeButton.append(icon('close', 15), el('span', '', t("关闭项目")));
closeButton.addEventListener('click', () => {
    if (currentDescriptor)
        savePosition(currentDescriptor.id, currentDescriptor.snapshot.id, location.hash);
    currentDescriptor = null;
    setActiveProject(null);
    location.hash = '#/projects';
});
headerActions.append(closeButton);
const languageSelect = el('select', 'language-select') as HTMLSelectElement;
languageSelect.dataset.testid = 'language-select';
languageSelect.setAttribute('aria-label', t('界面语言'));
for (const [value, label] of [['zh', '中文'], ['en', 'English']]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    languageSelect.append(option);
}
languageSelect.value = getLanguage();
languageSelect.addEventListener('change', () => {
    if (currentDescriptor) savePosition(currentDescriptor.id, currentDescriptor.snapshot.id, location.hash);
    setLanguage(languageSelect.value === 'en' ? 'en' : 'zh');
    refreshLanguageChrome();
    renderCurrent();
});
headerActions.append(languageSelect);
header.append(headerActions);
app.append(header);
const main = el('div', 'app-main');
main.id = 'main-content';
main.tabIndex = -1;
app.append(main);
let currentResult: ViewResult | undefined;
let renderVersion = 0;
let currentDescriptor: ProjectDescriptor | null = null;
function refreshLanguageChrome(): void {
    skip.textContent = t('跳到主要内容');
    brand.setAttribute('aria-label', t('源码导航项目列表'));
    brandText.replaceChildren(el('strong', '', t('源码导航')), el('small', '', getLanguage() === 'en' ? 'SOURCE NAVIGATION' : 'CODE EXPLORE'));
    nav.setAttribute('aria-label', t('主导航'));
    searchButton.setAttribute('aria-label', t('搜索当前项目'));
    searchButton.replaceChildren(icon('search', 16), el('span', '', t('搜索当前项目')), el('kbd', '', 'Ctrl K'));
    report.replaceChildren(icon('download', 16), el('span', '', t('项目报告')));
    closeButton.replaceChildren(icon('close', 15), el('span', '', t('关闭项目')));
    languageSelect.setAttribute('aria-label', t('界面语言'));
    languageSelect.value = getLanguage();
}
function chromeLink(label: string, href: string, iconName: string, active: boolean, routeName?: string): HTMLAnchorElement {
    const link = anchor(label, href, `main-nav-link${active ? ' active' : ''}`, iconName);
    if (routeName)
        link.dataset.route = routeName;
    if (active)
        link.setAttribute('aria-current', 'page');
    return link;
}
function updateChrome(route: Route): void {
    nav.replaceChildren();
    const reading = chromeLink(t("项目阅读"), '#/projects', 'book', route.name === '/projects' || route.name === '/package-help');
    nav.append(reading);
    const compareLink = chromeLink(t('项目对比'), '#/compare', 'branch', route.name === '/compare' || route.name === '/compare-help');
    compareLink.addEventListener('click', () => {
        if (currentDescriptor) savePosition(currentDescriptor.id, currentDescriptor.snapshot.id, location.hash);
        rememberComparisonOrigin();
    });
    nav.append(compareLink);
    if (currentDescriptor && currentDescriptor.type !== 'comparison') {
        const items = [['/overview', t("项目总览"), 'layers'], ['/files', t("源码"), 'code'], ['/flow', t("执行链"), 'flow'], ['/guide', t("专题解读"), 'book'], ['/coverage', t("覆盖"), 'check']];
        for (const [name, label, iconName] of items) {
            const feature = name === '/overview' ? 'files' : name === '/flow' ? 'flows' : name === '/guide' ? 'guide' : name === '/coverage' ? 'coverage' : 'files';
            if (!currentDescriptor.features.includes(feature))
                continue;
            const active = route.name === name || (name === '/flow' && route.name === '/case');
            nav.append(chromeLink(label, hashFor(name), iconName, active, name));
        }
    }
    const sourceVisible = Boolean(currentDescriptor && currentDescriptor.type !== 'comparison');
    searchButton.style.display = sourceVisible ? '' : 'none';
    searchButton.href = sourceVisible ? hashFor('/search') : '#/projects';
    report.style.display = currentDescriptor?.report ? '' : 'none';
    if (currentDescriptor?.report) {
        report.href = reportAsset(currentDescriptor);
        report.title = t("下载《{0}》", currentDescriptor.report.title);
    }
    closeButton.style.display = currentDescriptor ? '' : 'none';
}
function pageTitle(route: Route, context?: AppContext): string {
    if (route.name === '/projects')
        return t("项目资料库 · 源码导航");
    if (route.name === '/compare')
        return t("{0} · 源码导航", currentDescriptor?.name || t("项目对比"));
    const labels: Record<string, string> = { '/overview': t("总览"), '/files': t("源码"), '/search': t("全量搜索"), '/flow': t("核心执行链"), '/case': t("贯穿案例"), '/guide': t("专题解读"), '/coverage': t("覆盖报告") };
    const projectName = currentDescriptor?.name || context?.descriptor.name || t("项目");
    if (route.name === '/files')
        return `${route.params.get('path')?.split('/').at(-1) || t("源码")} · ${projectName}`;
    return `${labels[route.name] || t("项目阅读")} · ${projectName}`;
}
function renderError(error: unknown, descriptor?: ProjectDescriptor): ViewResult {
    const wrap = el('div', 'package-error-page page-container');
    wrap.append(el('span', 'eyebrow', 'PACKAGE ERROR'));
    wrap.append(errorState(error));
    const actions = el('div', 'package-error-actions');
    actions.append(anchor(t("返回项目列表"), '#/projects', 'button primary', 'layers'));
    if (descriptor)
        actions.append(anchor(t("使用当前快照重新打开"), hashForProject(descriptor.id, descriptor.snapshot.id, descriptor.type === 'comparison' ? '/compare' : '/overview'), 'button secondary', 'book'));
    wrap.append(actions);
    return { element: wrap };
}
function renderCurrent(): void {
    const version = ++renderVersion;
    currentResult?.dispose?.();
    currentResult = undefined;
    const route = parseRoute();
    currentDescriptor = null;
    setActiveProject(null);
    updateChrome(route);
    main.replaceChildren(loadingState(route.projectId ? t("正在打开项目 {0}…", route.projectId) : t("正在读取项目目录…")));
    if (route.name === '/projects') {
        loadCatalog().then(result => {
            if (version !== renderVersion)
                return;
            updateChrome(route);
            document.title = pageTitle(route);
            currentResult = { element: renderProjectCatalog(result) };
            main.replaceChildren(currentResult.element);
            window.scrollTo(0, 0);
        }).catch(error => {
            if (version === renderVersion)
                main.replaceChildren(renderError(error).element);
        });
        return;
    }
    if ((route.name === '/compare' && !route.projectId) || route.name === '/compare-help' || route.name === '/package-help') {
        loadCatalog().then(result => {
            if (version !== renderVersion) return;
            updateChrome(route);
            document.title = (route.name === '/package-help' ? t('资料包格式与 AI 提示词') : t('项目对比')) + ' · ' + t('源码导航');
            currentResult = route.name === '/package-help' ? renderPackageHelp() : route.name === '/compare-help' ? renderComparisonHelp(result, route) : renderPairWorkspace(result, route);
            main.replaceChildren(currentResult.element);
            window.scrollTo(0, 0);
        }).catch(error => { if (version === renderVersion) main.replaceChildren(renderError(error).element); });
        return;
    }
    if (!route.projectId) {
        currentResult = renderError(new Error(t("无法识别导航位置“{0}”。请从项目列表选择有效资料包。", route.name)));
        main.replaceChildren(currentResult.element);
        return;
    }
    if (route.name === '/compare') {
        Promise.all([loadCatalog(), loadDescriptor(route.projectId)]).then(([allProjects, descriptor]) => {
            if (version !== renderVersion)
                return;
            if (descriptor.type !== 'comparison')
                throw new Error(t("“{0}”不是对比资料包。", descriptor.name));
            if (route.snapshot && route.snapshot !== descriptor.snapshot.id)
                throw new Error(t("对比资料快照不匹配。链接为 {0}，当前为 {1}。", route.snapshot, descriptor.snapshot.id));
            currentDescriptor = descriptor;
            setActiveProject(descriptor);
            rememberOpened(descriptor.id, descriptor.snapshot.id, location.hash);
            savePosition(descriptor.id, descriptor.snapshot.id, location.hash);
            updateChrome(route);
            document.title = pageTitle(route);
            currentResult = renderComparison({ descriptor, catalog: allProjects, route });
            main.replaceChildren(currentResult.element);
            window.scrollTo(0, 0);
        }).catch(error => {
            if (version === renderVersion)
                main.replaceChildren(renderError(error).element);
        });
        return;
    }
    loadCore(route.projectId).then(context => {
        if (version !== renderVersion)
            return;
        const descriptor = context.descriptor;
        if (route.snapshot && route.snapshot !== descriptor.snapshot.id) {
            currentResult = renderError(new Error(t("项目快照不匹配。链接请求 {0}，当前资料包为 {1}。", route.snapshot, descriptor.snapshot.id)), descriptor);
            main.replaceChildren(currentResult.element);
            return;
        }
        currentDescriptor = descriptor;
        setActiveProject(descriptor);
        if (!route.snapshot || !location.hash.startsWith('#/p/')) {
            history.replaceState(null, '', hashForProject(descriptor.id, descriptor.snapshot.id, route.name, Object.fromEntries(route.params.entries())));
        }
        rememberOpened(descriptor.id, descriptor.snapshot.id, location.hash);
        savePosition(descriptor.id, descriptor.snapshot.id, location.hash);
        updateChrome(route);
        document.title = pageTitle(route, context);
        let result: ViewResult;
        if (route.name === '/overview')
            result = { element: renderOverview(context) };
        else if (route.name === '/files')
            result = renderFiles(context, route);
        else if (route.name === '/search')
            result = renderSearch(context, route);
        else if (route.name === '/guide')
            result = renderGuide(context, route);
        else if (route.name === '/flow')
            result = renderFlow(context, route);
        else if (route.name === '/case')
            result = renderCase(context);
        else if (route.name === '/coverage')
            result = renderCoverage(context, route);
        else
            result = renderError(new Error(t("项目中没有“{0}”这个阅读视图。", route.name)), descriptor);
        if (version !== renderVersion) {
            result.dispose?.();
            return;
        }
        currentResult = result;
        main.replaceChildren(result.element);
        window.scrollTo(0, 0);
    }).catch(error => {
        if (version === renderVersion)
            main.replaceChildren(renderError(error).element);
    });
}
window.addEventListener('hashchange', renderCurrent);
window.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault();
        if (!currentDescriptor || currentDescriptor.type === 'comparison') {
            toast(t("请先打开一个源码或文档项目，再搜索。"));
        }
        else if (parseRoute().name === '/search') {
            document.querySelector<HTMLInputElement>('.global-search-form input')?.focus();
        }
        else
            location.hash = hashFor('/search');
    }
});
renderCurrent();
