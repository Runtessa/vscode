import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import Mocha from 'mocha';

export async function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'tdd', color: true });
  const suiteRoot = __dirname;
  const files = await fs.readdir(suiteRoot);

  files
    .filter((file) => file.endsWith('.test.js'))
    .sort((a, b) => a.localeCompare(b))
    .forEach((file) => mocha.addFile(path.join(suiteRoot, file)));

  await new Promise<void>((resolve, reject) => {
    const runner = mocha.run((failures) => {
      if (failures > 0) {
        reject(new Error(`${failures} test(s) failed.`));
        return;
      }
      const resultPath = process.env.IDPCORE_EXTENSION_TEST_RESULT;
      if (!runner.stats?.tests) {
        reject(new Error('No extension tests ran.'));
        return;
      }
      if (resultPath) {
        fs.writeFile(resultPath, JSON.stringify({ tests: runner.stats.tests, passes: runner.stats.passes }))
          .then(() => resolve(), reject);
      } else {
        resolve();
      }
    });
  });
}
