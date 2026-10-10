import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

suite('IDPCore extension', () => {
  test('registers core commands', async () => {
    const extension = vscode.extensions.getExtension('idpcore.idpcore-vscode');
    assert.ok(extension, 'Development extension was not loaded');
    await extension.activate();
    const commands = await vscode.commands.getCommands(true);
    [
      'idpcore.pullTenant',
      'idpcore.pushActiveFile',
      'idpcore.openTenantPreview',
      'idpcore.openCodexTerminal',
    ].forEach((command) => assert.ok(commands.includes(command), `Missing command: ${command}`));
  });
});
