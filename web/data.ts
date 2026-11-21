import { t } from './i18n'
import { localAsset, restoreLocalPackages, hiddenServerProjects, hideServerProject, isLocalPackage, removeLocalPackage, readDirectoryAsset } from './local-packages'
import type { AppContext, Catalog, CoreContent, Manifest, ProjectDescriptor, SearchDocument, SymbolRecord } from './types';
export function asset(path: string): string {
    return new URL(path, document.baseURI).toString();
}
function safeProjectId(projectId: string): void {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(projectId))
        throw new Error(t("无效的项目标识：{0}", projectId));
}
export function projectAsset(projectId: string, relative: string): string {
    safeProjectId(projectId);
    const normalized = relative.replace(/^\/+/, '');
    if (normalized.split('/').includes('..'))
        throw new Error(t("资料包资源路径越界。"));
    const local = localAsset(projectId, normalized);
    if (local) return local;
    return asset(`projects/${projectId}/${normalized.split('/').map(encodeURIComponent).join('/')}`);
}
export function sourceAsset(projectId: string, path: string, sourceRoot = 'source'): string {
    return projectAsset(projectId, `${sourceRoot.replace(/\/$/, '')}/${path}`);
}
export function reportAsset(descriptor: ProjectDescriptor, kind: 'pdf' | 'tex' = 'pdf'): string {
    if (!descriptor.report)
        throw new Error(t("这个项目没有深度分析报告。"));
    return projectAsset(descriptor.id, descriptor.report[kind]);
}
async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
    let response: Response;
    try {
        const local = await readDirectoryAsset(url);
        response = local ? new Response(local) : await fetch(url, { signal });
    }
    catch (error) {
        if (signal?.aborted)
            throw error;
        throw new Error(t("无法读取资料包数据：{0}。请检查静态文件是否完整。", decodeURIComponent(url.split('/').at(-1) || url)));
    }
    if (!response.ok)
        throw new Error(t("资料包数据请求失败（HTTP {0}）：{1}", response.status, decodeURIComponent(url)));
    try {
        return await response.json() as T;
    }
    catch {
        throw new Error(t("资料包 JSON 格式无效：{0}", decodeURIComponent(url)));
    }
}
const serverProjectIds = new Set<string>();
let catalogPromise: Promise<Catalog> | undefined;
export function loadCatalog(): Promise<Catalog> {
    if (!catalogPromise) {
        catalogPromise = fetchJson<Catalog>(asset('projects/catalog.json')).then(async catalog => {
            if (catalog.schemaVersion !== 2 || !Array.isArray(catalog.projects))
                throw new Error(t("项目目录格式不兼容：需要 schemaVersion 2。"));
            catalog.projects.forEach(item => serverProjectIds.add(item.id));
            const hidden = hiddenServerProjects();
            const local = await restoreLocalPackages(new Set());
            const localIds = new Set(local.map(item => item.id));
            const server = catalog.projects.filter(item => !hidden.has(item.id) && !localIds.has(item.id));
            return { ...catalog, projects: [...server, ...local] };
        }).catch(error => {
            catalogPromise = undefined;
            throw error;
        });
    }
    return catalogPromise;
}
export async function loadDescriptor(projectId: string): Promise<ProjectDescriptor> {
    safeProjectId(projectId);
    const catalog = await loadCatalog();
    const descriptor = catalog.projects.find(item => item.id === projectId);
    if (!descriptor)
        throw new Error(t("项目目录中不存在“{0}”。它可能未导入或已被移除。", projectId));
    return descriptor;
}
export async function loadComparisonContent(projectId: string): Promise<CoreContent> {
    const descriptor = await loadDescriptor(projectId);
    const content = await fetchJson<CoreContent>(projectAsset(projectId, descriptor.entries.content));
    if (!isLocalPackage(projectId) && (content.projectId !== projectId || content.snapshotId !== descriptor.snapshot.id))
        throw new Error(t("对比资料的项目或快照身份不一致。"));
    return content;
}
const corePromises = new Map<string, Promise<AppContext>>();
export function loadCore(projectId: string): Promise<AppContext> {
    if (!corePromises.has(projectId)) {
        const promise = loadDescriptor(projectId).then(async (descriptor) => {
            if (descriptor.type === 'comparison')
                throw new Error(t("对比资料不是源码项目，请使用对比阅读入口。"));
            const [manifest, content] = await Promise.all([
                fetchJson<Manifest>(projectAsset(projectId, descriptor.entries.manifest)),
                fetchJson<CoreContent>(projectAsset(projectId, descriptor.entries.content)),
            ]);
            if (!isLocalPackage(projectId) && (manifest.projectId !== projectId || content.projectId !== projectId))
                throw new Error(t("资料包身份不一致：请求 {0}，实际为 {1}。", projectId, manifest.projectId || content.projectId || t("未知")));
            if (!isLocalPackage(projectId) && (manifest.snapshotId !== descriptor.snapshot.id || content.snapshotId !== descriptor.snapshot.id))
                throw new Error(t("资料包快照不一致：索引与 project.json 的版本身份不同。"));
            if (!isLocalPackage(projectId) && (manifest.contentVersion !== descriptor.contentVersion || content.package?.contentVersion !== descriptor.contentVersion))
                throw new Error(t("资料包索引与解读的内容版本不一致。"));
            return { manifest, content, descriptor };
        }).catch(error => {
            corePromises.delete(projectId);
            throw error;
        });
        corePromises.set(projectId, promise);
    }
    return corePromises.get(projectId)!;
}
const searchPromises = new Map<string, Promise<SearchDocument[]>>();
export function loadSearch(projectId: string): Promise<SearchDocument[]> {
    if (!searchPromises.has(projectId)) {
        const promise = loadDescriptor(projectId).then(descriptor => fetchJson<{
            documents: SearchDocument[];
        }>(projectAsset(projectId, descriptor.entries.search)))
            .then(result => result.documents)
            .catch(error => {
            searchPromises.delete(projectId);
            throw error;
        });
        searchPromises.set(projectId, promise);
    }
    return searchPromises.get(projectId)!;
}
const symbolPromises = new Map<string, Promise<SymbolRecord[]>>();
export function loadSymbols(projectId: string, path: string): Promise<SymbolRecord[]> {
    const key = `${projectId}\0${path}`;
    if (!symbolPromises.has(key)) {
        const promise = loadDescriptor(projectId).then(descriptor => fetchJson<SymbolRecord[]>(projectAsset(projectId, `${descriptor.entries.symbols}${path.split('/').map(encodeURIComponent).join('/')}.json`)))
            .catch(error => {
            symbolPromises.delete(key);
            throw error;
        });
        symbolPromises.set(key, promise);
    }
    return symbolPromises.get(key)!;
}
export async function loadSource(projectId: string, path: string, signal?: AbortSignal): Promise<string> {
    let response: Response;
    try {
        const descriptor = await loadDescriptor(projectId);
        const url = projectAsset(projectId, `${descriptor.source.root.replace(/\/$/, '')}/${path}`);
        const local = await readDirectoryAsset(url);
        response = local ? new Response(local) : await fetch(url, { signal });
    }
    catch (error) {
        if (signal?.aborted)
            throw error;
        throw new Error(t("无法读取原始文件：{0}/{1}。请检查资料包源码目录。", projectId, path));
    }
    if (!response.ok) {
        if (response.status === 404)
            throw new Error(t("没有找到原始文件：{0}/{1}", projectId, path));
        throw new Error(t("原始文件请求失败（HTTP {0}）：{1}", response.status, path));
    }
    return response.text();
}

function clearProjectCaches(projectId: string): void {
    corePromises.delete(projectId);
    searchPromises.delete(projectId);
    for (const key of symbolPromises.keys()) if (key.startsWith(projectId + '\0')) symbolPromises.delete(key);
}
export async function updateLibraryProject(descriptor: ProjectDescriptor): Promise<void> {
    const catalog = await loadCatalog();
    const index = catalog.projects.findIndex(item => item.id === descriptor.id);
    if (index < 0) catalog.projects.push(descriptor);
    else catalog.projects[index] = descriptor;
    clearProjectCaches(descriptor.id);
}
export async function removeLibraryProject(projectId: string): Promise<void> {
    if (isLocalPackage(projectId)) await removeLocalPackage(projectId);
    if (serverProjectIds.has(projectId)) hideServerProject(projectId);
    const catalog = await loadCatalog();
    catalog.projects = catalog.projects.filter(item => item.id !== projectId);
    clearProjectCaches(projectId);
}
