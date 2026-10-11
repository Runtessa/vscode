import * as vscode from 'vscode';

const SECTION = 'idpcore';
const TOKEN_KEY = 'sessionToken';

export const getSettings = () => vscode.workspace.getConfiguration(SECTION);
export const getCoreApiBase = () => String(getSettings().get<string>('coreApiBase') || '').replace(/\/+$/, '');
export const getTenantHost = () => String(getSettings().get<string>('tenantHost') || '').trim();
export const getLocalRoot = () => String(getSettings().get<string>('localRoot') || 'tenant-workspace').trim() || 'tenant-workspace';
export const getAutoPushOnSave = () => Boolean(getSettings().get<boolean>('autoPushOnSave'));
export const getCodexBin = () => String(getSettings().get<string>('codexBin') || 'codex').trim() || 'codex';
export const getPreviewPort = () => String(getSettings().get<string>('previewPort') || '3000').trim() || '3000';
export const getPreviewRoute = () => String(getSettings().get<string>('previewRoute') || '/').trim() || '/';
export const getPreviewStage = () => (String(getSettings().get<string>('previewStage') || 'draft').trim() === 'published' ? 'published' : 'draft');

export const getSessionToken = async (context: vscode.ExtensionContext) =>
  (await context.secrets.get(TOKEN_KEY)) || '';

export const setSessionToken = async (context: vscode.ExtensionContext, token: string) => {
  if (!token.trim()) {
    await context.secrets.delete(TOKEN_KEY);
    return;
  }
  await context.secrets.store(TOKEN_KEY, token.trim());
};

export const ensureWorkspaceFolder = () => {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    throw new Error('Open a VS Code workspace folder before using Runtessa Tenant Studio.');
  }
  return folder;
};

export const getConfigurationTarget = () =>
  vscode.workspace.workspaceFolders?.length ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;

export const updateSetting = async <T>(key: string, value: T) =>
  vscode.workspace.getConfiguration(SECTION).update(key, value, getConfigurationTarget());
