import * as fs from 'node:fs';
import * as path from 'node:path';
import { runTests } from '@vscode/test-electron';

const candidateExecutables = [
  process.env.VSCODE_EXECUTABLE_PATH,
  '/usr/bin/code',
  '/usr/share/code/bin/code',
  '/snap/bin/code',
].filter((value): value is string => Boolean(value && value.trim()));

const resolveExecutablePath = () =>
  candidateExecutables.find((candidate) => {
    try {
      return fs.existsSync(candidate);
    } catch {
      return false;
    }
  });

async function main() {
  const extensionDevelopmentPath = path.resolve(__dirname, '..', '..');
  const extensionTestsPath = path.resolve(__dirname, 'suite', 'index.js');
  const vscodeExecutablePath = resolveExecutablePath();
  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    ...(vscodeExecutablePath ? { vscodeExecutablePath } : {}),
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
