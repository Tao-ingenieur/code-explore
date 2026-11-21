import { t } from '../../i18n'
import type { FileRecord, Manifest, Status } from '../../types';
import { el, iconButton, statusBadge } from '../../ui';
import { icon } from '../../icons';
import { hashFor } from '../../router';
interface TreeNode {
    name: string;
    path: string;
    directories: Map<string, TreeNode>;
    files: FileRecord[];
}
let expanded = new Set<string>(['src']);
let treeProjectId = '';
let filterText = '';
let filterStatus: Status | 'all' = 'all';
function makeNode(name: string, path: string): TreeNode {
    return { name, path, directories: new Map(), files: [] };
}
function buildTree(files: FileRecord[]): TreeNode {
    const root = makeNode('', '');
    for (const file of files) {
        const parts = file.path.split('/');
        let node = root;
        for (let index = 0; index < parts.length - 1; index += 1) {
            const path = parts.slice(0, index + 1).join('/');
            if (!node.directories.has(parts[index]))
                node.directories.set(parts[index], makeNode(parts[index], path));
            node = node.directories.get(parts[index])!;
        }
        node.files.push(file);
    }
    return root;
}
export function renderFileTree(projectId: string, manifest: Manifest, selectedPath: string): HTMLElement {
    if (treeProjectId !== projectId) {
        treeProjectId = projectId;
        expanded = new Set(manifest.files[0]?.path.split('/').length > 1 ? [manifest.files[0].path.split('/')[0]] : []);
        filterText = '';
        filterStatus = 'all';
    }
    const panel = el('aside', 'file-tree-panel');
    const header = el('div', 'panel-heading');
    const title = el('div');
    title.append(el('span', 'eyebrow', 'REPOSITORY'), el('h2', '', t("源码文件 {0}", manifest.stats.files)));
    const actions = el('div', 'tree-actions');
    const expandAll = iconButton('expand', t("展开全部目录"));
    const collapseAll = iconButton('collapse', t("折叠全部目录"));
    actions.append(expandAll, collapseAll);
    header.append(title, actions);
    panel.append(header);
    const filterBox = el('div', 'tree-filter');
    filterBox.append(icon('search', 15));
    const input = el('input') as HTMLInputElement;
    input.type = 'search';
    input.placeholder = t("筛选当前文件树");
    input.setAttribute('aria-label', t("筛选文件树路径"));
    input.value = filterText;
    filterBox.append(input);
    panel.append(filterBox);
    const statusSelect = el('select', 'tree-status-select') as HTMLSelectElement;
    statusSelect.setAttribute('aria-label', t("按分析状态筛选"));
    const allOption = el('option', '', t("全部分析状态")) as HTMLOptionElement;
    allOption.value = 'all';
    statusSelect.append(allOption);
    for (const status of ['indexed', 'summary', 'deep', 'pending'] as Status[]) {
        const option = el('option', '', `${manifest.statusLabels[status]} · ${manifest.stats.statusCounts[status]}`) as HTMLOptionElement;
        option.value = status;
        statusSelect.append(option);
    }
    statusSelect.value = filterStatus;
    panel.append(statusSelect);
    const legend = el('details', 'tree-legend');
    legend.append(el('summary', '', t("状态如何理解？")));
    const legendText = el('div', 'tree-legend-body');
    const descriptions: Array<[
        Status,
        string
    ]> = [
        ['indexed', t("仅自动清点、提取符号与依赖。")],
        ['summary', t("已有人工用途或职责概述。")],
        ['deep', t("核心机制已附证据深入分析。")],
        ['pending', t("已有解读，但仍有明确待验证问题。")],
    ];
    for (const [status, description] of descriptions) {
        const row = el('div');
        row.append(statusBadge(status), el('span', '', description));
        legendText.append(row);
    }
    legend.append(legendText);
    panel.append(legend);
    const treeContainer = el('div', 'file-tree-scroll');
    treeContainer.setAttribute('role', 'tree');
    treeContainer.setAttribute('aria-label', t("源码目录"));
    panel.append(treeContainer);
    const footer = el('div', 'tree-footer');
    panel.append(footer);
    const selectedParts = selectedPath.split('/');
    for (let index = 0; index < selectedParts.length - 1; index += 1) {
        expanded.add(selectedParts.slice(0, index + 1).join('/'));
    }
    const tree = buildTree(manifest.files);
    function matches(file: FileRecord): boolean {
        const query = filterText.trim().toLocaleLowerCase();
        return (!query || file.path.toLocaleLowerCase().includes(query)) && (filterStatus === 'all' || file.status === filterStatus);
    }
    function hasMatch(node: TreeNode): boolean {
        return node.files.some(matches) || [...node.directories.values()].some(hasMatch);
    }
    function matchingCount(node: TreeNode): number {
        return node.files.filter(matches).length + [...node.directories.values()].reduce((sum, child) => sum + matchingCount(child), 0);
    }
    function renderNode(node: TreeNode, depth: number): DocumentFragment {
        const fragment = document.createDocumentFragment();
        const directories = [...node.directories.values()].sort((a, b) => a.name.localeCompare(b.name));
        for (const directory of directories) {
            if (!hasMatch(directory))
                continue;
            const isExpanded = expanded.has(directory.path) || Boolean(filterText) || filterStatus !== 'all';
            const row = el('div', 'tree-directory-row');
            row.style.setProperty('--depth', String(depth));
            row.setAttribute('role', 'treeitem');
            row.setAttribute('aria-expanded', String(isExpanded));
            const toggle = el('button', 'tree-directory') as HTMLButtonElement;
            toggle.type = 'button';
            toggle.append(icon('chevron', 13), icon('folder', 16), el('span', 'tree-name', directory.name));
            const count = matchingCount(directory);
            toggle.append(el('span', 'tree-count', String(count)));
            toggle.title = t("{0}/ · {1} 个文件", directory.path, count);
            toggle.addEventListener('click', () => {
                if (expanded.has(directory.path))
                    expanded.delete(directory.path);
                else
                    expanded.add(directory.path);
                render();
            });
            row.append(toggle);
            fragment.append(row);
            if (isExpanded)
                fragment.append(renderNode(directory, depth + 1));
        }
        for (const file of [...node.files].sort((a, b) => a.name.localeCompare(b.name))) {
            if (!matches(file))
                continue;
            const link = el('a', `tree-file-row${file.path === selectedPath ? ' selected' : ''}`) as HTMLAnchorElement;
            link.href = hashFor('/files', { path: file.path });
            link.style.setProperty('--depth', String(depth));
            link.setAttribute('role', 'treeitem');
            link.title = `${file.path}\n${file.purpose}\n${file.statusLabel}`;
            if (file.path === selectedPath)
                link.setAttribute('aria-current', 'page');
            link.append(el('span', `file-status-dot status-${file.status}`), el('span', 'tree-name', file.name));
            if (file.relatedChapters.length)
                link.append(icon('book', 13));
            fragment.append(link);
        }
        return fragment;
    }
    function render(): void {
        treeContainer.replaceChildren();
        const fragment = renderNode(tree, 0);
        treeContainer.append(fragment);
        const count = manifest.files.filter(matches).length;
        footer.textContent = count === manifest.files.length
            ? t("{0} 个文件 · {1} 个符号", count, manifest.stats.symbols.toLocaleString('zh-CN')) : t("筛选命中 {0} / {1} 个文件", count, manifest.files.length);
        if (!count) {
            const empty = el('div', 'tree-empty', t("没有匹配当前筛选的文件。"));
            const clear = el('button', 'text-button', t("清除筛选")) as HTMLButtonElement;
            clear.type = 'button';
            clear.addEventListener('click', () => {
                filterText = '';
                filterStatus = 'all';
                input.value = '';
                statusSelect.value = 'all';
                render();
            });
            empty.append(clear);
            treeContainer.append(empty);
        }
    }
    input.addEventListener('input', () => {
        filterText = input.value;
        render();
    });
    statusSelect.addEventListener('change', () => {
        filterStatus = statusSelect.value as Status | 'all';
        render();
    });
    expandAll.addEventListener('click', () => {
        function addDirectories(node: TreeNode) {
            for (const directory of node.directories.values()) {
                expanded.add(directory.path);
                addDirectories(directory);
            }
        }
        addDirectories(tree);
        render();
    });
    collapseAll.addEventListener('click', () => {
        expanded.clear();
        expanded.add(manifest.files[0]?.path.split('/')[0] || 'src');
        render();
    });
    render();
    return panel;
}
