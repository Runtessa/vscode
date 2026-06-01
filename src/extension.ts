import * as vscode from 'vscode';
import { getAutoPushOnSave } from './config';
import { LifecycleProvider } from './lifecycle/provider';
import { TenantExplorerProvider } from './tree/provider';
import {
  configureConnection,
  createAclFile,
  createModel,
  createModule,
  createSharedModuleFile,
  createSharedModuleProject,
  createSharedUiFile,
  createSharedUiProject,
  createUiPackage,
  executeLifecycleAction,
  openCodexTerminal,
  openTenantPreview,
  openTenantRoot,
  pullTenant,
  pushActiveFile,
  pushSavedTenantDocument,
  pushEverything,
  rollbackLifecycleRevision,
  runCodexPrompt,
  resolveClient,
  signInWithBrowser,
} from './commands/actions';

const wrapCommand = (handler: () => Promise<unknown> | unknown) => async () => {
  try {
    await handler();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'Command failed');
    void vscode.window.showErrorMessage(message);
  }
};

export function activate(context: vscode.ExtensionContext) {
  const provider = new TenantExplorerProvider();
  const lifecycle = new LifecycleProvider(() => resolveClient(context));
  const refreshAll = [provider, lifecycle];
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('idpcoreTenantExplorer', provider),
    vscode.window.registerTreeDataProvider('idpcoreLifecycle', lifecycle),
    vscode.commands.registerCommand('idpcore.configureConnection', wrapCommand(() => configureConnection(context))),
    vscode.commands.registerCommand('idpcore.signIn', wrapCommand(() => signInWithBrowser(context))),
    vscode.commands.registerCommand('idpcore.pullTenant', wrapCommand(() => pullTenant(context, refreshAll))),
    vscode.commands.registerCommand('idpcore.pushActiveFile', wrapCommand(() => pushActiveFile(context, refreshAll))),
    vscode.commands.registerCommand('idpcore.pushAllChanges', wrapCommand(() => pushEverything(context, refreshAll))),
    vscode.commands.registerCommand('idpcore.refreshExplorer', () => { provider.refresh(); lifecycle.refresh(); }),
    vscode.commands.registerCommand('idpcore.openTenantRoot', wrapCommand(() => openTenantRoot())),
    vscode.commands.registerCommand('idpcore.createModule', wrapCommand(() => createModule(context, refreshAll))),
    vscode.commands.registerCommand('idpcore.createModel', wrapCommand(() => createModel(context, refreshAll))),
    vscode.commands.registerCommand('idpcore.createUiPackage', wrapCommand(() => createUiPackage(context, refreshAll))),
    vscode.commands.registerCommand('idpcore.createSharedUiProject', wrapCommand(() => createSharedUiProject(context, refreshAll))),
    vscode.commands.registerCommand('idpcore.createSharedModuleProject', wrapCommand(() => createSharedModuleProject(context, refreshAll))),
    vscode.commands.registerCommand('idpcore.createSharedUiFile', (node) => wrapCommand(() => createSharedUiFile(node))()),
    vscode.commands.registerCommand('idpcore.createSharedModuleFile', (node) => wrapCommand(() => createSharedModuleFile(node))()),
    vscode.commands.registerCommand('idpcore.createAclFile', (node) => wrapCommand(() => createAclFile(node))()),
    vscode.commands.registerCommand('idpcore.executeLifecycleAction', (node) => wrapCommand(() => executeLifecycleAction(context, refreshAll, node))()),
    vscode.commands.registerCommand('idpcore.rollbackLifecycleRevision', (node) => wrapCommand(() => rollbackLifecycleRevision(context, refreshAll, node))()),
    vscode.commands.registerCommand('idpcore.openTenantPreview', (node) => wrapCommand(() => openTenantPreview(node))()),
    vscode.commands.registerCommand('idpcore.openCodexTerminal', wrapCommand(() => openCodexTerminal())),
    vscode.commands.registerCommand('idpcore.runCodexPrompt', wrapCommand(() => runCodexPrompt())),
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (!getAutoPushOnSave()) return;
      void pushSavedTenantDocument(context, document, refreshAll).catch((error: Error) => {
        void vscode.window.showErrorMessage(error.message || 'Auto-push failed');
      });
    }),
    vscode.window.onDidChangeActiveTextEditor(() => lifecycle.refresh()),
  );
}

export function deactivate() {}
