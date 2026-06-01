import * as path from 'node:path';
import * as vscode from 'vscode';
import { IdeClient } from '../api/client';
import type { ManifestFileEntry, TenantWorkspaceManifest } from '../types';
import { ensureWorkspaceFolder } from '../config';
import { getTenantRootUri, readManifest, relativeTenantPath } from './paths';
import { findSharedProjectForPath, inferSharedProjectBootstrap } from './shared-projects';

const readText = async (uri: vscode.Uri) => Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');

const pushMappedFile = async (client: IdeClient, entry: ManifestFileEntry, content: string) => {
  switch (entry.kind) {
    case 'module':
      await client.updateModule(entry.moduleId || '', {
        routePath: entry.routePath || '/',
        method: entry.method || 'GET',
        code: content,
        fileExtension: entry.fileExtension,
      });
      return;
    case 'model':
      await client.updateModel(entry.modelId || '', {
        path: entry.relativePath.replace(/^models\//, ''),
        code: content,
        fileExtension: entry.fileExtension,
      });
      return;
    case 'ui':
      await client.updateUiPackage(entry.uiId || '', {
        name: entry.name || 'ui',
        version: entry.version || '1.0.0',
        code: content,
        fileExtension: entry.fileExtension,
      });
      return;
    case 'acl':
      await client.updateAclFile(entry.aclFile || 'endpoints', content);
      return;
    case 'shared-ui-file':
    case 'shared-module-file':
      await client.updateSharedFile({
        projectKind: entry.projectKind || (entry.kind === 'shared-ui-file' ? 'ui' : 'module'),
        projectId: entry.projectId || '',
        fileId: entry.fileId || '',
        path: entry.relativePath.split('/').slice(2).join('/'),
        content,
        fileExtension: entry.fileExtension,
      });
      return;
  }
};

const deleteMappedFile = async (client: IdeClient, entry: ManifestFileEntry) => {
  switch (entry.kind) {
    case 'module':
      await client.deleteModule(entry.moduleId || '');
      return;
    case 'model':
      await client.deleteModel(entry.modelId || '');
      return;
    case 'ui':
      await client.deleteUiPackage(entry.uiId || '');
      return;
    case 'shared-ui-file':
    case 'shared-module-file':
      await client.deleteSharedFile({
        projectKind: entry.projectKind || (entry.kind === 'shared-ui-file' ? 'ui' : 'module'),
        projectId: entry.projectId || '',
        fileId: entry.fileId || '',
      });
      return;
    case 'acl':
      throw new Error('ACL files cannot be deleted.');
  }
};

const inferModuleCreation = (relativePath: string, content: string) => {
  const match = relativePath.match(/^modules\/(.*\/)?([a-z]+)\.module\.([^.\/]+)$/i);
  if (!match) return null;
  const routeDir = String(match[1] || '').replace(/\/$/, '');
  const routePath = routeDir ? `/${routeDir}` : '/';
  return {
    routePath,
    method: match[2].toUpperCase(),
    fileExtension: match[3].toLowerCase(),
    code: content,
  };
};

const inferModelCreation = (relativePath: string, content: string) => {
  if (!relativePath.startsWith('models/')) return null;
  return {
    path: relativePath.replace(/^models\//, ''),
    fileExtension: relativePath.split('.').pop() || 'js',
    code: content,
  };
};


const inferUiCreation = (relativePath: string, content: string) => {
  if (!relativePath.startsWith('ui/')) return null;
  const withoutRoot = relativePath.replace(/^ui\//, '');
  const withoutExt = withoutRoot.replace(/\.[^.\/]+$/, '');
  const normalizedName = withoutExt.replace(/\.ui$/i, '');
  const fileExtension = relativePath.split('.').pop() || 'jsx';
  return {
    defaultName: normalizedName,
    fileExtension,
    code: content,
  };
};

const promptForUiPackageMetadata = async (relativePath: string, defaultName: string) => {
  const name = await vscode.window.showInputBox({
    prompt: `UI package name for ${relativePath}`,
    value: defaultName || 'ui/component',
    ignoreFocusOut: true,
    validateInput: (value) => (value.trim() ? null : 'UI package name is required.'),
  });
  if (!name) {
    throw new Error(`UI package creation cancelled for ${relativePath}`);
  }
  const version = await vscode.window.showInputBox({
    prompt: `UI package version for ${relativePath}`,
    value: '1.0.0',
    ignoreFocusOut: true,
    validateInput: (value) => (value.trim() ? null : 'UI package version is required.'),
  });
  if (!version) {
    throw new Error(`UI package creation cancelled for ${relativePath}`);
  }
  return { name: name.trim(), version: version.trim() };
};
const inferSharedFileCreation = (manifest: TenantWorkspaceManifest, relativePath: string, content: string) => {
  const project = findSharedProjectForPath(manifest, relativePath);
  if (!project) return null;
  return {
    projectKind: project.projectKind,
    projectId: project.projectId,
    path: relativePath.slice(project.relativeRoot.length + 1),
    fileExtension: relativePath.split('.').pop() || (project.projectKind === 'ui' ? 'jsx' : 'js'),
    content,
  } as const;
};

const createUnmappedFile = async (client: IdeClient, manifest: TenantWorkspaceManifest, relativePath: string, content: string) => {
  const moduleInput = inferModuleCreation(relativePath, content);
  if (moduleInput) {
    await client.createModule(moduleInput);
    return;
  }
  const modelInput = inferModelCreation(relativePath, content);
  if (modelInput) {
    await client.createModel(modelInput);
    return;
  }
  const uiInput = inferUiCreation(relativePath, content);
  if (uiInput) {
    const metadata = await promptForUiPackageMetadata(relativePath, uiInput.defaultName);
    await client.createUiPackage({
      name: metadata.name,
      version: metadata.version,
      code: uiInput.code,
      fileExtension: uiInput.fileExtension,
    });
    return;
  }
  const sharedFileInput = inferSharedFileCreation(manifest, relativePath, content);
  if (sharedFileInput) {
    await client.createSharedFile(sharedFileInput);
    return;
  }
  const sharedProjectInput = inferSharedProjectBootstrap(relativePath, content);
  if (sharedProjectInput) {
    if (sharedProjectInput.projectKind === 'ui') {
      await client.createSharedUiProject({
        name: sharedProjectInput.projectName,
        version: sharedProjectInput.version,
        code: sharedProjectInput.code,
        entryPath: sharedProjectInput.entryPath,
        fileExtension: sharedProjectInput.fileExtension,
      });
      return;
    }
    await client.createSharedModuleProject({
      name: sharedProjectInput.projectName,
      version: sharedProjectInput.version,
      code: sharedProjectInput.code,
      entryPath: sharedProjectInput.entryPath,
      fileExtension: sharedProjectInput.fileExtension,
    });
    return;
  }
  throw new Error(`Unmapped file cannot be created automatically: ${relativePath}`);
};

const collectWorkspaceFiles = async (tenantRoot: vscode.Uri) => {
  const result: string[] = [];
  const visit = async (dir: vscode.Uri) => {
    const entries = await vscode.workspace.fs.readDirectory(dir);
    for (const [name, type] of entries) {
      if (name === '.idp') continue;
      const child = vscode.Uri.file(path.join(dir.fsPath, name));
      if (type === vscode.FileType.Directory) {
        await visit(child);
        continue;
      }
      result.push(path.relative(tenantRoot.fsPath, child.fsPath).replace(/\\/g, '/'));
    }
  };
  await visit(tenantRoot);
  return result.sort((a, b) => a.localeCompare(b));
};

export const pushFileFromEditor = async (client: IdeClient, fileUri: vscode.Uri) => pushFileFromUri(client, fileUri);

export const pushAllChanges = async (client: IdeClient) => {
  const workspaceFolder = ensureWorkspaceFolder();
  const manifest = await readManifest(workspaceFolder);
  if (!manifest) throw new Error('Pull the tenant workspace first.');
  const tenantRoot = getTenantRootUri(workspaceFolder);
  const liveFiles = new Set(await collectWorkspaceFiles(tenantRoot));

  for (const [relativePath, entry] of Object.entries(manifest.files)) {
    const fileUri = vscode.Uri.file(path.join(tenantRoot.fsPath, relativePath));
    if (!liveFiles.has(relativePath)) {
      await deleteMappedFile(client, entry);
      continue;
    }
    const content = await readText(fileUri);
    await pushMappedFile(client, entry, content);
  }

  for (const relativePath of liveFiles) {
    if (manifest.files[relativePath]) continue;
    const fileUri = vscode.Uri.file(path.join(tenantRoot.fsPath, relativePath));
    const content = await readText(fileUri);
    await createUnmappedFile(client, manifest, relativePath, content);
  }
};


export const isTenantWorkspaceFile = async (fileUri: vscode.Uri) => {
  try {
    const workspaceFolder = ensureWorkspaceFolder();
    const manifest = await readManifest(workspaceFolder);
    if (!manifest) return false;
    return Boolean(relativeTenantPath(workspaceFolder, fileUri));
  } catch {
    return false;
  }
};

export const pushFileFromUri = async (client: IdeClient, fileUri: vscode.Uri) => {
  const workspaceFolder = ensureWorkspaceFolder();
  const manifest = await readManifest(workspaceFolder);
  if (!manifest) throw new Error('Pull the tenant workspace first.');
  const relativePath = relativeTenantPath(workspaceFolder, fileUri);
  if (!relativePath) throw new Error('Selected file is outside the tenant workspace.');
  const entry = manifest.files[relativePath];
  const content = await readText(fileUri);
  if (!entry) {
    await createUnmappedFile(client, manifest, relativePath, content);
    return { relativePath, created: true };
  }
  await pushMappedFile(client, entry, content);
  return { relativePath, created: false };
};

export const pushManifestEntry = async (client: IdeClient, entry: ManifestFileEntry) => {
  const workspaceFolder = ensureWorkspaceFolder();
  const manifest = await readManifest(workspaceFolder);
  if (!manifest) throw new Error('Pull the tenant workspace first.');
  const fileUri = vscode.Uri.file(path.join(getTenantRootUri(workspaceFolder).fsPath, entry.relativePath));
  const content = await readText(fileUri);
  await pushMappedFile(client, entry, content);
  return { relativePath: entry.relativePath, created: false };
};
