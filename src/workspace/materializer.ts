import * as path from 'node:path';
import * as vscode from 'vscode';
import { ensureWorkspaceFolder, getLocalRoot, getTenantHost } from '../config';
import { IdeClient } from '../api/client';
import type { ManifestFileEntry, TenantPullSnapshot, TenantWorkspaceManifest } from '../types';
import { getManifestUri, getTenantRootUri, toModelPath, toModulePath, toSharedFilePath, toUiPath } from './paths';
import { buildManifestProjects } from './shared-projects';

const parentDir = (uri: vscode.Uri) => vscode.Uri.file(path.dirname(uri.fsPath));

const writeJson = async (uri: vscode.Uri, value: unknown) => {
  await vscode.workspace.fs.createDirectory(parentDir(uri));
  await vscode.workspace.fs.writeFile(uri, Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8'));
};

const writeText = async (uri: vscode.Uri, value: string) => {
  await vscode.workspace.fs.createDirectory(parentDir(uri));
  await vscode.workspace.fs.writeFile(uri, Buffer.from(value, 'utf8'));
};

const aclEntries = (snapshot: TenantPullSnapshot) => ({
  'acl/permissions.json': JSON.stringify(snapshot.acl.permissions ?? {}, null, 2),
  'acl/roles.json': JSON.stringify(snapshot.acl.roles ?? {}, null, 2),
  'acl/endpoints.json': JSON.stringify(snapshot.acl.endpoints ?? {}, null, 2),
});

export const pullTenantWorkspace = async (client: IdeClient) => {
  const workspaceFolder = ensureWorkspaceFolder();
  const tenantRoot = getTenantRootUri(workspaceFolder);
  const snapshot = await client.pullTenantWorkspace();
  try {
    await vscode.workspace.fs.delete(tenantRoot, { recursive: true, useTrash: false });
  } catch {
    // ignore missing root
  }
  await vscode.workspace.fs.createDirectory(tenantRoot);

  const files: Record<string, ManifestFileEntry> = {};

  for (const mod of snapshot.modules) {
    const relativePath = toModulePath(mod);
    files[relativePath] = {
      kind: 'module',
      relativePath,
      moduleId: mod.id,
      routePath: mod.routePath,
      method: mod.method,
      fileExtension: mod.fileExtension,
    };
    await writeText(vscode.Uri.file(path.join(tenantRoot.fsPath, relativePath)), mod.code || '');
  }

  for (const model of snapshot.models) {
    const relativePath = toModelPath(model.path);
    files[relativePath] = {
      kind: 'model',
      relativePath,
      modelId: model.id,
      fileExtension: model.fileExtension,
    };
    await writeText(vscode.Uri.file(path.join(tenantRoot.fsPath, relativePath)), model.code || '');
  }

  for (const pkg of snapshot.uiPackages) {
    const relativePath = toUiPath(pkg);
    files[relativePath] = {
      kind: 'ui',
      relativePath,
      uiId: pkg.id,
      name: pkg.name,
      version: pkg.version,
      dependencies: pkg.dependencies,
      fileExtension: pkg.fileExtension,
    };
    await writeText(vscode.Uri.file(path.join(tenantRoot.fsPath, relativePath)), pkg.code || pkg.codeBlob || '');
  }

  for (const [relativePath, content] of Object.entries(aclEntries(snapshot))) {
    files[relativePath] = {
      kind: 'acl',
      relativePath,
      aclFile: relativePath.includes('permissions')
        ? 'permissions'
        : relativePath.includes('roles')
          ? 'roles'
          : 'endpoints',
      fileExtension: 'json',
    };
    await writeText(vscode.Uri.file(path.join(tenantRoot.fsPath, relativePath)), `${content}\n`);
  }

  for (const file of snapshot.sharedUiFiles) {
    const relativePath = toSharedFilePath('shared-ui', file.projectName, file.path);
    files[relativePath] = {
      kind: 'shared-ui-file',
      relativePath,
      fileId: file.id,
      fileExtension: file.fileExtension,
      projectId: file.projectId,
      projectKind: 'ui',
      projectName: file.projectName,
      projectVersion: file.projectVersion,
    };
    await writeText(vscode.Uri.file(path.join(tenantRoot.fsPath, relativePath)), file.content || '');
  }

  for (const file of snapshot.sharedModuleFiles) {
    const relativePath = toSharedFilePath('shared-modules', file.projectName, file.path);
    files[relativePath] = {
      kind: 'shared-module-file',
      relativePath,
      fileId: file.id,
      fileExtension: file.fileExtension,
      projectId: file.projectId,
      projectKind: 'module',
      projectName: file.projectName,
      projectVersion: file.projectVersion,
    };
    await writeText(vscode.Uri.file(path.join(tenantRoot.fsPath, relativePath)), file.content || '');
  }

  const manifest: TenantWorkspaceManifest = {
    version: 1,
    tenantHost: getTenantHost(),
    pulledAt: new Date().toISOString(),
    rootFolder: getLocalRoot(),
    files,
    projects: buildManifestProjects(snapshot),
  };
  await writeJson(getManifestUri(workspaceFolder), manifest);
  await writeText(vscode.Uri.file(path.join(tenantRoot.fsPath, '.idp', 'README.md')), 'This folder is managed by the Runtessa VS Code extension.\n');
  return { workspaceFolder, tenantRoot, manifest };
};
