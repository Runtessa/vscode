import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const extensionRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(extensionRoot, '..', '..');
const workspaceArg = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : repoRoot;

const candidates = [
  process.env.VSCODE_EXECUTABLE_PATH,
  '/usr/bin/code',
  '/usr/share/code/bin/code',
  '/snap/bin/code',
].filter(Boolean);

const codeBin = candidates.find((candidate) => existsSync(candidate));
if (!codeBin) {
  console.error('No VS Code executable found. Set VSCODE_EXECUTABLE_PATH or install the `code` CLI.');
  process.exit(1);
}

const child = spawn(codeBin, [
  '--new-window',
  workspaceArg,
  `--extensionDevelopmentPath=${extensionRoot}`,
], {
  stdio: 'inherit',
});

child.on('exit', (code) => process.exit(code ?? 0));
child.on('error', (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
