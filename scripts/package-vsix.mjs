import { spawn } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionDir = path.resolve(__dirname, '..');
const rootPackagePath = path.join(extensionDir, 'package.json');
const packageJson = JSON.parse(await readFile(rootPackagePath, 'utf8'));

const stageDir = await mkdtemp(path.join(os.tmpdir(), 'idpcore-vscode-vsix-'));
const stagePackagePath = path.join(stageDir, 'package.json');
const outputVsix = path.join(extensionDir, 'idpcore-tenant-studio.vsix');
const vsceBin = path.join(extensionDir, 'node_modules', '.bin', 'vsce');

const copyTargets = [
  'dist',
  'media',
  'README.md',
  path.join('node_modules', 'esbuild'),
  path.join('node_modules', '@esbuild', 'linux-x64'),
];

try {
  for (const target of copyTargets) {
    await cp(path.join(extensionDir, target), path.join(stageDir, target), { recursive: true });
  }
  await rm(path.join(stageDir, 'dist', 'test'), { recursive: true, force: true });

  const stagedPackageJson = {
    ...packageJson,
    scripts: {},
    devDependencies: {},
  };
  await writeFile(stagePackagePath, `${JSON.stringify(stagedPackageJson, null, 2)}\n`, 'utf8');

  await new Promise((resolve, reject) => {
    const child = spawn(vsceBin, ['package', '--allow-missing-repository', '--out', outputVsix], {
      cwd: stageDir,
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`vsce package failed with code ${code ?? 1}`));
      }
    });
  });
} finally {
  await rm(stageDir, { recursive: true, force: true });
}
