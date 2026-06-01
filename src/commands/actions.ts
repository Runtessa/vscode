import { spawn } from 'node:child_process';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { IdeClient } from '../api/client';
import { getAutoPushOnSave, getCoreApiBase, getSessionToken, getTenantHost, setSessionToken, ensureWorkspaceFolder, getSettings, getPreviewPort, getPreviewRoute, getPreviewStage, updateSetting } from '../config';
import type { LifecycleNode } from '../lifecycle/provider';
import type { ManifestFileEntry } from '../types';
import type { TenantExplorerNode } from '../tree/provider';
import { startBrowserLogin } from '../auth/browser-login';
import { buildPreviewUrl, listPreviewTargets, resolvePreviewTarget } from '../preview';
import { pullTenantWorkspace } from '../workspace/materializer';
import { getTenantRootUri, readManifest, relativeTenantPath } from '../workspace/paths';
import { isTenantWorkspaceFile, pushAllChanges, pushFileFromEditor, pushFileFromUri, pushManifestEntry } from '../workspace/pusher';
import { findSharedProjectForPath } from '../workspace/shared-projects';

const output = vscode.window.createOutputChannel('IDPCore Codex');

export const resolveClient = async (context: vscode.ExtensionContext): Promise<IdeClient> => {
  const { IdeClient } = await import('../api/client');
  const baseUrl = getCoreApiBase();
  const tenantHost = getTenantHost();
  const sessionToken = await getSessionToken(context);
  if (!baseUrl) throw new Error('Set idpcore.coreApiBase first.');
  if (!tenantHost) throw new Error('Set idpcore.tenantHost first.');
  if (!sessionToken) throw new Error('Run "IDPCore: Sign In to ideNew" first.');
  return new IdeClient({ baseUrl, tenantHost, sessionToken });
};


const ensureTenantHostConfigured = async () => {
  const currentTenant = getTenantHost();
  if (currentTenant) return currentTenant;
  const tenantHost = await vscode.window.showInputBox({
    prompt: 'Tenant host (X-Tenant-Host)',
    placeHolder: 'example: acme.localhost',
    ignoreFocusOut: true,
  });
  if (!tenantHost?.trim()) {
    throw new Error('Tenant host is required to load a tenant workspace.');
  }
  await updateSetting('tenantHost', tenantHost.trim());
  return tenantHost.trim();
};

const refreshAfterMutation = async (
  client: IdeClient,
  providers: Array<{ refresh: () => void }>,
) => {
  await pullTenantWorkspace(client);
  refreshProviders(providers);
};


const refreshProviders = (providers: Array<{ refresh: () => void }>) => {
  providers.forEach((provider) => provider.refresh());
};

export const pushSavedTenantDocument = async (
  context: vscode.ExtensionContext,
  document: vscode.TextDocument,
  providers: Array<{ refresh: () => void }>,
) => {
  if (!(await isTenantWorkspaceFile(document.uri))) return;
  const client = await resolveClient(context);
  const result = await pushFileFromUri(client, document.uri);
  if (result.created) {
    await refreshAfterMutation(client, providers);
    return;
  }
  refreshProviders(providers);
};

const pushEntryBeforePublish = async (
  context: vscode.ExtensionContext,
  providers: Array<{ refresh: () => void }>,
  entry: ManifestFileEntry,
) => {
  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor?.document.uri.scheme === 'file') {
    const workspaceFolder = ensureWorkspaceFolder();
    const relativePath = relativeTenantPath(workspaceFolder, activeEditor.document.uri);
    if (relativePath === entry.relativePath) {
      if (activeEditor.document.isDirty) {
        const saved = await activeEditor.document.save();
        if (!saved) throw new Error('Save the current file before publishing.');
      }
      const client = await resolveClient(context);
      const result = await pushFileFromUri(client, activeEditor.document.uri);
      if (result.created) {
        await refreshAfterMutation(client, providers);
      } else {
        refreshProviders(providers);
      }
      return client;
    }
  }

  const client = await resolveClient(context);
  await pushManifestEntry(client, entry);
  refreshProviders(providers);
  return client;
};


const promptFilePath = async (prompt: string, value: string) => {
  const result = await vscode.window.showInputBox({ prompt, value, ignoreFocusOut: true });
  if (!result) return null;
  return result.trim().replace(/^\/+/, '');
};

const writeLocalFile = async (relativePath: string, content: string) => {
  const workspaceFolder = ensureWorkspaceFolder();
  const tenantRoot = getTenantRootUri(workspaceFolder);
  const target = vscode.Uri.file(path.join(tenantRoot.fsPath, relativePath));
  await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(target.fsPath)));
  await vscode.workspace.fs.writeFile(target, Buffer.from(content, 'utf8'));
  await vscode.window.showTextDocument(target, { preview: false });
};

const resolveProjectFolder = async (node?: TenantExplorerNode) => {
  const relative = String(node?.relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!relative.startsWith('shared-ui/') && !relative.startsWith('shared-modules/')) return null;
  const workspaceFolder = ensureWorkspaceFolder();
  const manifest = await readManifest(workspaceFolder);
  if (!manifest) throw new Error('Pull the tenant workspace first.');
  const project = findSharedProjectForPath(manifest, relative);
  if (!project) return null;
  return {
    root: project.projectKind === 'ui' ? 'shared-ui' : 'shared-modules',
    projectName: project.projectName,
  };
};

const ensureAclTemplate = async (target?: TenantExplorerNode) => {
  const requested = await vscode.window.showQuickPick(['permissions', 'roles', 'endpoints'], {
    placeHolder: target?.relativePath?.startsWith('acl/') ? `Reset ${path.basename(target.relativePath, '.json')}` : 'Choose ACL file to create/reset',
  });
  if (!requested) return;
  const templates: Record<string, string> = {
    permissions: JSON.stringify({ permissions: [] }, null, 2) + '\n',
    roles: JSON.stringify({ roles: {}, groups: {} }, null, 2) + '\n',
    endpoints: JSON.stringify({}, null, 2) + '\n',
  };
  await writeLocalFile(`acl/${requested}.json`, templates[requested]);
};

const createSharedFileLocally = async (target: TenantExplorerNode | undefined, kind: 'ui' | 'module') => {
  const project = await resolveProjectFolder(target);
  if (!project || (kind === 'ui' ? project.root !== 'shared-ui' : project.root !== 'shared-modules')) {
    throw new Error(`Select a ${kind === 'ui' ? 'shared-ui' : 'shared-modules'} project folder first.`);
  }
  const defaultPath = kind === 'ui' ? 'src/new-file.jsx' : 'src/new-file.js';
  const relativeWithinProject = await promptFilePath('Shared file path inside the project', defaultPath);
  if (!relativeWithinProject) return;
  const relativePath = `${project.root}/${project.projectName}/${relativeWithinProject}`;
  const template = kind === 'ui'
    ? "export default function SharedFile() {\n  return <div>Shared UI</div>;\n}\n"
    : "module.exports = function sharedFile() {\n  return { ok: true };\n};\n";
  await writeLocalFile(relativePath, template);
};


const pickPreviewTarget = async (workspaceFolder: vscode.WorkspaceFolder, relativePath?: string) => {
  const manifest = await readManifest(workspaceFolder);
  if (!manifest) throw new Error('Pull the tenant workspace first.');

  const resolved = resolvePreviewTarget(manifest, relativePath);
  if (resolved) return resolved;

  const targets = listPreviewTargets(manifest);
  if (!targets.length) throw new Error('No tenant UI or shared UI resources are available for preview.');
  if (targets.length === 1) return targets[0];

  const selected = await vscode.window.showQuickPick(
    targets.map((target) => ({ label: target.label, target })),
    {
      placeHolder: 'Choose a tenant UI target to preview',
      ignoreFocusOut: true,
    },
  );
  return selected?.target || null;
};

const openPreviewUrl = async (url: string) => {
  try {
    await vscode.commands.executeCommand('simpleBrowser.show', url);
  } catch {
    await vscode.env.openExternal(vscode.Uri.parse(url));
  }
};

const resolvePreviewRelativePath = (node?: TenantExplorerNode) => {
  if (node?.relativePath) return node.relativePath;
  const workspaceFolder = ensureWorkspaceFolder();
  const editorUri = vscode.window.activeTextEditor?.document.uri;
  return editorUri ? relativeTenantPath(workspaceFolder, editorUri) : null;
};

const runCodexExec = async (tenantRoot: string, prompt: string) =>
  new Promise<void>((resolve, reject) => {
    const codexBin = String(getSettings().get<string>('codexBin') || 'codex').trim() || 'codex';
    output.show(true);
    output.appendLine(`$ ${codexBin} exec --skip-git-repo-check -C ${tenantRoot} -`);
    const child = spawn(codexBin, ['exec', '--skip-git-repo-check', '-C', tenantRoot, '-'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk) => output.append(String(chunk)));
    child.stderr.on('data', (chunk) => output.append(String(chunk)));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`codex exited with code ${code ?? 1}`));
      }
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });

export const configureConnection = async (context: vscode.ExtensionContext) => {
  const currentBase = getCoreApiBase();
  const currentTenant = getTenantHost();
  const baseUrl = await vscode.window.showInputBox({ prompt: 'ideNew base URL', value: currentBase || 'http://127.0.0.1:3002' });
  if (baseUrl === undefined) return;
  const tenantHost = await vscode.window.showInputBox({ prompt: 'Tenant host (X-Tenant-Host)', value: currentTenant });
  if (tenantHost === undefined) return;
  await updateSetting('coreApiBase', baseUrl.trim());
  await updateSetting('tenantHost', tenantHost.trim());
  vscode.window.showInformationMessage('IDPCore connection updated.');
};

export const signInWithBrowser = async (context: vscode.ExtensionContext) => {
  const baseUrl = getCoreApiBase();
  const tenantHost = getTenantHost();
  if (!baseUrl) throw new Error('Set idpcore.coreApiBase first.');

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Signing in to ideNew...',
      cancellable: false,
    },
    async () => {
      const sessionToken = await startBrowserLogin({ baseUrl, tenantHost });
      const { IdeClient } = await import('../api/client');
      const client = new IdeClient({ baseUrl, tenantHost, sessionToken });
      await client.getCurrentUser();
      await setSessionToken(context, sessionToken);
    },
  );

  vscode.window.showInformationMessage('Signed in to ideNew.');
};

export const pullTenant = async (context: vscode.ExtensionContext, providers: Array<{ refresh: () => void }>) => {
  const tenantHost = await ensureTenantHostConfigured();
  const client = await resolveClient(context);
  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Pulling tenant ${tenantHost}...`,
      cancellable: false,
    },
    async () => pullTenantWorkspace(client),
  );
  refreshProviders(providers);
  await vscode.commands.executeCommand('revealInExplorer', result.tenantRoot);
  vscode.window.showInformationMessage(`Pulled tenant ${tenantHost} into ${result.manifest.rootFolder}.`);
};

export const pushActiveFile = async (context: vscode.ExtensionContext, providers: Array<{ refresh: () => void }>) => {
  const editor = vscode.window.activeTextEditor;
  if (!editor) throw new Error('Open a tenant file first.');
  const client = await resolveClient(context);
  await pushFileFromEditor(client, editor.document.uri);
  await refreshAfterMutation(client, providers);
  vscode.window.showInformationMessage('Pushed active file to ideNew.');
};

export const pushEverything = async (context: vscode.ExtensionContext, providers: Array<{ refresh: () => void }>) => {
  const client = await resolveClient(context);
  await pushAllChanges(client);
  await refreshAfterMutation(client, providers);
  vscode.window.showInformationMessage('Pushed tenant changes to ideNew.');
};

export const openTenantRoot = async () => {
  const workspaceFolder = ensureWorkspaceFolder();
  const uri = getTenantRootUri(workspaceFolder);
  await vscode.commands.executeCommand('revealInExplorer', uri);
};

export const createModule = async (context: vscode.ExtensionContext, providers: Array<{ refresh: () => void }>) => {
  const client = await resolveClient(context);
  const routePath = await vscode.window.showInputBox({ prompt: 'Module route path', value: '/api/example' });
  if (!routePath) return;
  const method = await vscode.window.showQuickPick(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], { placeHolder: 'HTTP method' });
  if (!method) return;
  const code = `module.exports = async function handler(req, adapters) {\n  return { ok: true };\n};\n`;
  await client.createModule({ routePath, method, code, fileExtension: 'js' });
  await refreshAfterMutation(client, providers);
};

export const createModel = async (context: vscode.ExtensionContext, providers: Array<{ refresh: () => void }>) => {
  const client = await resolveClient(context);
  const modelPath = await vscode.window.showInputBox({ prompt: 'Model path', value: 'models/example.js' });
  if (!modelPath) return;
  const code = `module.exports = {\n  tableName: 'example',\n  columns: {}\n};\n`;
  await client.createModel({ path: modelPath, code, fileExtension: 'js' });
  await refreshAfterMutation(client, providers);
};

export const createUiPackage = async (context: vscode.ExtensionContext, providers: Array<{ refresh: () => void }>) => {
  const client = await resolveClient(context);
  const name = await vscode.window.showInputBox({ prompt: 'UI package name', value: 'dashboard/home' });
  if (!name) return;
  const version = await vscode.window.showInputBox({ prompt: 'UI package version', value: '1.0.0' });
  if (!version) return;
  const code = `export default function Component() {\n  return <div>${name}</div>;\n}\n`;
  await client.createUiPackage({ name, version, code, fileExtension: 'jsx' });
  await refreshAfterMutation(client, providers);
};

export const createSharedUiProject = async (context: vscode.ExtensionContext, providers: Array<{ refresh: () => void }>) => {
  const client = await resolveClient(context);
  const name = await vscode.window.showInputBox({ prompt: 'Shared UI project name', value: 'shared/layouts' });
  if (!name) return;
  const version = await vscode.window.showInputBox({ prompt: 'Shared UI project version', value: '1.0.0' });
  if (!version) return;
  const code = `export default function SharedComponent() {\n  return <div>${name}</div>;\n}\n`;
  await client.createSharedUiProject({ name, version, code, fileExtension: 'jsx', entryPath: 'src/index.jsx' });
  await refreshAfterMutation(client, providers);
};

export const createSharedModuleProject = async (context: vscode.ExtensionContext, providers: Array<{ refresh: () => void }>) => {
  const client = await resolveClient(context);
  const name = await vscode.window.showInputBox({ prompt: 'Shared backend project name', value: 'shared/services' });
  if (!name) return;
  const version = await vscode.window.showInputBox({ prompt: 'Shared backend project version', value: '1.0.0' });
  if (!version) return;
  const code = `module.exports = function sharedService() {\n  return { ok: true };\n};\n`;
  await client.createSharedModuleProject({ name, version, code, fileExtension: 'js', entryPath: 'src/index.js' });
  await refreshAfterMutation(client, providers);
};

export const createSharedUiFile = async (target?: TenantExplorerNode) => {
  await createSharedFileLocally(target, 'ui');
};

export const createSharedModuleFile = async (target?: TenantExplorerNode) => {
  await createSharedFileLocally(target, 'module');
};

export const createAclFile = async (target?: TenantExplorerNode) => {
  await ensureAclTemplate(target);
};

export const executeLifecycleAction = async (
  context: vscode.ExtensionContext,
  providers: Array<{ refresh: () => void }>,
  node: LifecycleNode,
) => {
  if (node.kind !== 'action') return;
  if (node.action === 'refresh') {
    refreshProviders(providers);
    return;
  }
  const client = await pushEntryBeforePublish(context, providers, node.entry);
  await client.publishEntry(node.entry);
  await refreshAfterMutation(client, providers);
  vscode.window.showInformationMessage('Published current resource.');
};

export const rollbackLifecycleRevision = async (
  context: vscode.ExtensionContext,
  providers: Array<{ refresh: () => void }>,
  node: LifecycleNode,
) => {
  if (node.kind !== 'revision') return;
  const confirmed = await vscode.window.showWarningMessage(
    `Rollback to ${node.label}?`,
    { modal: true },
    'Rollback',
  );
  if (confirmed !== 'Rollback') return;
  const client = await resolveClient(context);
  await client.rollbackRevision(node.entry, node.revisionId);
  await refreshAfterMutation(client, providers);
  vscode.window.showInformationMessage('Rollback applied.');
};


export const openTenantPreview = async (targetNode?: TenantExplorerNode) => {
  const workspaceFolder = ensureWorkspaceFolder();
  const relativePath = resolvePreviewRelativePath(targetNode);
  const target = await pickPreviewTarget(workspaceFolder, relativePath || undefined);
  if (!target) return;
  const previewUrl = buildPreviewUrl({
    tenantHost: getTenantHost(),
    coreApiBase: getCoreApiBase(),
    port: getPreviewPort(),
    route: getPreviewRoute(),
    stage: getPreviewStage(),
    target,
    previewSession: `vscode-${Date.now()}`,
    nonce: Date.now(),
  });
  await openPreviewUrl(previewUrl);
};

export const openCodexTerminal = async () => {
  const workspaceFolder = ensureWorkspaceFolder();
  const tenantRoot = getTenantRootUri(workspaceFolder).fsPath;
  const codexBin = String(getSettings().get<string>('codexBin') || 'codex').trim() || 'codex';
  const terminal = vscode.window.createTerminal({
    name: 'IDPCore Codex',
    cwd: tenantRoot,
  });
  terminal.show(true);
  terminal.sendText(codexBin, true);
};

export const runCodexPrompt = async () => {
  const workspaceFolder = ensureWorkspaceFolder();
  const manifest = await readManifest(workspaceFolder);
  if (!manifest) throw new Error('Pull the tenant workspace first.');
  const prompt = await vscode.window.showInputBox({
    prompt: 'Run Codex inside the pulled tenant workspace',
    ignoreFocusOut: true,
  });
  if (!prompt?.trim()) return;
  const tenantRoot = getTenantRootUri(workspaceFolder).fsPath;
  await runCodexExec(tenantRoot, prompt.trim());
  vscode.window.showInformationMessage('Codex run completed. Review output in the IDPCore Codex panel.');
};

export { getAutoPushOnSave };
