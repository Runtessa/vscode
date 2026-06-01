import * as path from 'node:path';
import * as vscode from 'vscode';
import { getLocalRoot } from '../config';
import type { ModuleDto, TenantWorkspaceManifest, UiPackageDto } from '../types';

const sanitizeForFilename = (value: string) =>
  String(value || '')
    .trim()
    .replace(/^\/+/, '')
    .replace(/[\/]+/g, '-')
    .replace(/[:*?<>|"]+/g, '')
    .replace(/\s+/g, '-')
    .toLowerCase();

export const getTenantRootUri = (workspaceFolder: vscode.WorkspaceFolder) =>
  vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, getLocalRoot()));

export const getManifestUri = (workspaceFolder: vscode.WorkspaceFolder) =>
  vscode.Uri.file(path.join(getTenantRootUri(workspaceFolder).fsPath, '.idp', 'manifest.json'));

export const toModulePath = (mod: ModuleDto) => {
  const ext = String(mod.fileExtension || 'js').replace(/^\./, '') || 'js';
  const route = String(mod.routePath || '/').replace(/^\/+|\/+$/g, '');
  const method = String(mod.method || 'GET').toLowerCase();
  return route ? `modules/${route}/${method}.module.${ext}` : `modules/${method}.module.${ext}`;
};

export const toModelPath = (modelPath: string) => {
  const normalized = String(modelPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  return normalized.toLowerCase().startsWith('models/') ? normalized : `models/${normalized}`;
};

export const toUiPath = (pkg: UiPackageDto) => {
  const ext = String(pkg.fileExtension || 'jsx').replace(/^\./, '') || 'jsx';
  const segments = String(pkg.name || 'ui').split(/[\\/]+/g).map((segment) => segment.trim()).filter(Boolean);
  const folders = segments.slice(0, -1);
  const base = segments[segments.length - 1] || 'ui';
  const fileName = `${sanitizeForFilename(base)}.ui.${ext}`;
  return folders.length ? `ui/${folders.join('/')}/${fileName}` : `ui/${fileName}`;
};

export const toSharedFilePath = (root: 'shared-ui' | 'shared-modules', projectName: string, filePath: string) =>
  `${root}/${String(projectName || '').trim()}/${String(filePath || '').replace(/\\/g, '/').replace(/^\/+/, '')}`;

export const readManifest = async (workspaceFolder: vscode.WorkspaceFolder): Promise<TenantWorkspaceManifest | null> => {
  try {
    const raw = await vscode.workspace.fs.readFile(getManifestUri(workspaceFolder));
    return JSON.parse(Buffer.from(raw).toString('utf8')) as TenantWorkspaceManifest;
  } catch {
    return null;
  }
};

export const relativeTenantPath = (workspaceFolder: vscode.WorkspaceFolder, fileUri: vscode.Uri) => {
  const tenantRoot = getTenantRootUri(workspaceFolder).fsPath;
  const relative = path.relative(tenantRoot, fileUri.fsPath).replace(/\\/g, '/');
  return relative && !relative.startsWith('..') ? relative : null;
};
