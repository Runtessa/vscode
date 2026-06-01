import * as vscode from 'vscode';
import type { IdeClient, ModuleRevisionDto, UiRevisionDto } from '../api/client';
import { ensureWorkspaceFolder } from '../config';
import type { ManifestFileEntry } from '../types';
import { readManifest, relativeTenantPath } from '../workspace/paths';

export type LifecycleNode =
  | { kind: 'status'; label: string; description?: string }
  | { kind: 'action'; label: string; description?: string; action: 'publish' | 'refresh'; entry: ManifestFileEntry }
  | { kind: 'revision'; label: string; description?: string; revisionId: string; entry: ManifestFileEntry };

const toDescription = (value?: string) => (value ? value.replace('T', ' ').replace('Z', '') : undefined);

export class LifecycleProvider implements vscode.TreeDataProvider<LifecycleNode> {
  private readonly emitter = new vscode.EventEmitter<LifecycleNode | undefined | null>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly getClient: () => Promise<IdeClient>) {}

  refresh() {
    this.emitter.fire();
  }

  getTreeItem(element: LifecycleNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      element.label,
      element.kind === 'status' ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.None,
    );
    item.description = element.description;
    if (element.kind === 'action') {
      item.command = {
        command: 'idpcore.executeLifecycleAction',
        title: element.label,
        arguments: [element],
      };
      item.contextValue = 'lifecycle:action';
      return item;
    }
    if (element.kind === 'revision') {
      item.command = {
        command: 'idpcore.rollbackLifecycleRevision',
        title: 'Rollback revision',
        arguments: [element],
      };
      item.contextValue = 'lifecycle:revision';
      return item;
    }
    item.contextValue = 'lifecycle:status';
    return item;
  }

  async getChildren(): Promise<LifecycleNode[]> {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
      return [{ kind: 'status', label: 'Open a tenant file', description: 'Lifecycle actions follow the active editor.' }];
    }

    let workspaceFolder: vscode.WorkspaceFolder;
    try {
      workspaceFolder = ensureWorkspaceFolder();
    } catch {
      return [{ kind: 'status', label: 'Open a workspace folder' }];
    }
    const manifest = await readManifest(workspaceFolder);
    if (!manifest) {
      return [{ kind: 'status', label: 'Pull the tenant workspace first' }];
    }
    const relativePath = relativeTenantPath(workspaceFolder, activeEditor.document.uri);
    if (!relativePath) {
      return [{ kind: 'status', label: 'Active file is outside tenant workspace' }];
    }
    const entry = manifest.files[relativePath];
    if (!entry) {
      return [{ kind: 'status', label: 'Active file is not mapped yet', description: relativePath }];
    }

    const nodes: LifecycleNode[] = [{ kind: 'action', label: 'Publish current resource', action: 'publish', entry }];

    if (entry.kind === 'module' || entry.kind === 'ui') {
      try {
        const client = await this.getClient();
        const response = await client.listRevisions(entry);
        const items = Array.isArray(response.items) ? response.items : [];
        if (!items.length) {
          nodes.push({ kind: 'status', label: 'No revisions yet' });
        } else {
          for (const revision of items) {
            const payload = revision as ModuleRevisionDto | UiRevisionDto;
            nodes.push({
              kind: 'revision',
              label: `r${payload.revision} ${payload.action || 'update'}`,
              description: toDescription(payload.createdAt),
              revisionId: payload.id,
              entry,
            });
          }
        }
      } catch (error) {
        nodes.push({ kind: 'status', label: 'Failed to load revisions', description: (error as Error).message });
      }
      return nodes;
    }

    if (entry.kind === 'shared-ui-file' || entry.kind === 'shared-module-file') {
      nodes.push({ kind: 'status', label: 'History is not exposed for shared projects yet', description: entry.projectName });
      return nodes;
    }

    nodes.push({ kind: 'status', label: 'Publish/history not supported for this resource type' });
    return nodes;
  }
}
