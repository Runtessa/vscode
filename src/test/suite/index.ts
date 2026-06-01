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
    mocha.run((failures) => {
      if (failures > 0) {
        reject(new Error(`${failures} test(s) failed.`));
        return;
      }
      resolve();
    });
  });
}
