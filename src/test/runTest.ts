import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { runTests } from '@vscode/test-electron';

const candidateExecutables = [
  process.env.VSCODE_EXECUTABLE_PATH,
  '/usr/share/code/code',
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
  const temporaryProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'idpcore-extension-test-'));
  const resultPath = path.join(temporaryProfile, 'result.json');
  try {
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      ...(vscodeExecutablePath ? { vscodeExecutablePath } : {}),
      launchArgs: [`--user-data-dir=${path.join(temporaryProfile, 'user')}`,
        `--extensions-dir=${path.join(temporaryProfile, 'extensions')}`, '--disable-extensions'],
      extensionTestsEnv: { IDPCORE_EXTENSION_TEST_RESULT: resultPath },
    });
    if (!fs.existsSync(resultPath)) throw new Error('VS Code exited without running the extension tests');
    const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    if (!result.tests || result.passes !== result.tests) throw new Error('Extension tests did not all pass');
    console.log(`Verified ${result.passes} extension tests in an isolated VS Code profile.`);
  } finally {
    fs.rmSync(temporaryProfile, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
