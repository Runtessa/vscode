import * as path from 'node:path';
import * as vscode from 'vscode';
import { ensureWorkspaceFolder } from '../config';
import type { ManifestFileEntry, TenantWorkspaceManifest } from '../types';
import { getTenantRootUri, readManifest } from '../workspace/paths';

export type TenantExplorerNode = {
  kind: 'section' | 'folder' | 'file';
  label: string;
  relativePath: string;
  parent?: string;
};

const SECTION_ORDER = ['modules', 'models', 'ui', 'shared-ui', 'shared-modules', 'acl'];

const inferFileContext = (relativePath: string, entry: ManifestFileEntry | null) => {
  if (entry) return `file:${entry.kind}`;
  if (relativePath.startsWith('acl/')) return 'file:acl';
  if (relativePath.startsWith('modules/')) return 'file:module';
  if (relativePath.startsWith('models/')) return 'file:model';
  if (relativePath.startsWith('ui/')) return 'file:ui';
  if (relativePath.startsWith('shared-ui/')) return 'file:shared-ui-file';
  if (relativePath.startsWith('shared-modules/')) return 'file:shared-module-file';
  return 'file:unknown';
};

const contextForNode = (manifest: TenantWorkspaceManifest, node: TenantExplorerNode) => {
  if (node.kind === 'section') {
    return `section:${node.relativePath}`;
  }
  if (node.kind === 'folder') {
    const parts = node.relativePath.split('/').filter(Boolean);
    if (parts[0] === 'shared-ui' && parts.length >= 2) return 'folder:shared-ui-project';
    if (parts[0] === 'shared-modules' && parts.length >= 2) return 'folder:shared-module-project';
    if (parts[0] === 'acl') return 'folder:acl';
    return 'folder:generic';
  }
  return inferFileContext(node.relativePath, manifest.files[node.relativePath] || null);
};

export class TenantExplorerProvider implements vscode.TreeDataProvider<TenantExplorerNode> {
  private readonly emitter = new vscode.EventEmitter<TenantExplorerNode | undefined | null>();
  readonly onDidChangeTreeData = this.emitter.event;

  refresh() {
    this.emitter.fire(undefined);
  }

  getTreeItem(element: TenantExplorerNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      element.label,
      element.kind === 'file' ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Expanded,
    );
    if (element.kind === 'file') {
      try {
        const workspaceFolder = ensureWorkspaceFolder();
        const tenantRoot = getTenantRootUri(workspaceFolder);
        const resourceUri = vscode.Uri.file(path.join(tenantRoot.fsPath, element.relativePath));
        item.resourceUri = resourceUri;
        item.command = {
          command: 'vscode.open',
          title: 'Open file',
          arguments: [resourceUri],
        };
      } catch {
        // no-op
      }
    }
    item.contextValue = element.kind;
    return item;
  }

  async getChildren(element?: TenantExplorerNode): Promise<TenantExplorerNode[]> {
    let workspaceFolder: vscode.WorkspaceFolder;
    try {
      workspaceFolder = ensureWorkspaceFolder();
    } catch {
      return [];
    }
    const manifest = await readManifest(workspaceFolder);
    if (!manifest) return [];
    if (!element) {
      return SECTION_ORDER.filter((section) => this.hasEntriesForSection(manifest, section)).map((section) => ({
        kind: 'section',
        label: section,
        relativePath: section,
      }));
    }
    return this.childrenForNode(manifest, element);
  }

  async getParent(element: TenantExplorerNode): Promise<TenantExplorerNode | null> {
    if (!element.parent) return null;
    let workspaceFolder: vscode.WorkspaceFolder;
    try {
      workspaceFolder = ensureWorkspaceFolder();
    } catch {
      return null;
    }
    const manifest = await readManifest(workspaceFolder);
    if (!manifest) return null;
    const parentPath = element.parent;
    const parts = parentPath.split('/').filter(Boolean);
    return {
      kind: parts.length === 1 ? 'section' : 'folder',
      label: parts[parts.length - 1] || parentPath,
      relativePath: parentPath,
      parent: parts.length > 1 ? parts.slice(0, -1).join('/') : undefined,
    };
  }

  async resolveTreeItem(item: vscode.TreeItem, element: TenantExplorerNode): Promise<vscode.TreeItem> {
    try {
      const workspaceFolder = ensureWorkspaceFolder();
      const manifest = await readManifest(workspaceFolder);
      if (manifest) {
        item.contextValue = contextForNode(manifest, element);
      }
    } catch {
      // no-op
    }
    return item;
  }

  private hasEntriesForSection(manifest: TenantWorkspaceManifest, section: string) {
    return Object.keys(manifest.files).some((relativePath) => relativePath === section || relativePath.startsWith(`${section}/`));
  }

  private childrenForNode(manifest: TenantWorkspaceManifest, node: TenantExplorerNode): TenantExplorerNode[] {
    const prefix = node.relativePath ? `${node.relativePath}/` : '';
    const files = Object.keys(manifest.files)
      .filter((relativePath) => relativePath.startsWith(prefix))
      .map((relativePath) => relativePath.slice(prefix.length))
      .filter(Boolean);

    const folders = new Set<string>();
    const leafFiles: TenantExplorerNode[] = [];
    for (const file of files) {
      const [first, ...rest] = file.split('/');
      if (rest.length > 0) {
        folders.add(first);
        continue;
      }
      leafFiles.push({
        kind: 'file',
        label: path.basename(file),
        relativePath: `${node.relativePath}/${file}`.replace(/^\//, ''),
        parent: node.relativePath,
      });
    }

    const folderNodes = Array.from(folders)
      .sort((a, b) => a.localeCompare(b))
      .map((folder) => ({
        kind: 'folder' as const,
        label: folder,
        relativePath: `${node.relativePath}/${folder}`.replace(/^\//, ''),
        parent: node.relativePath,
      }));

    return [...folderNodes, ...leafFiles.sort((a, b) => a.label.localeCompare(b.label))];
  }
}
