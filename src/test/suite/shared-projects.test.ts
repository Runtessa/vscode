import * as assert from 'node:assert/strict';
import { buildManifestProjects, findSharedProjectForPath, inferSharedProjectBootstrap } from '../../workspace/shared-projects';
import type { TenantPullSnapshot, TenantWorkspaceManifest } from '../../types';

const snapshot: TenantPullSnapshot = {
  modules: [],
  models: [],
  uiPackages: [],
  acl: { permissions: {}, roles: {}, endpoints: {} },
  sharedUiProjects: [
    {
      id: 'shared-ui-1',
      name: 'shared/layouts',
      version: '2.0.0',
      entryPath: 'src/index.jsx',
      dependencies: [],
      fileExtension: 'jsx',
    },
  ],
  sharedUiFiles: [],
  sharedModuleProjects: [
    {
      id: 'shared-mod-1',
      name: 'services/auth',
      version: '1.4.0',
      entryPath: 'src/index.js',
      dependencies: [],
      fileExtension: 'js',
    },
  ],
  sharedModuleFiles: [],
};

const manifest: TenantWorkspaceManifest = {
  version: 1,
  tenantHost: 'tenant.localhost',
  pulledAt: '2026-01-01T00:00:00.000Z',
  rootFolder: 'tenant-workspace',
  files: {},
  projects: buildManifestProjects(snapshot),
};

suite('shared project helpers', () => {
  test('resolves nested shared project roots from manifest metadata', () => {
    const entry = findSharedProjectForPath(manifest, 'shared-ui/shared/layouts/src/button.jsx');
    assert.equal(entry?.projectId, 'shared-ui-1');
    assert.equal(entry?.relativeRoot, 'shared-ui/shared/layouts');
  });

  test('boots a new shared ui project from first local entry file', () => {
    const bootstrap = inferSharedProjectBootstrap('shared-ui/test copy/src/index.jsx', 'export default function Test() {}');
    assert.equal(bootstrap?.projectKind, 'ui');
    assert.equal(bootstrap?.projectName, 'test copy');
    assert.equal(bootstrap?.entryPath, 'src/index.jsx');
    assert.equal(bootstrap?.version, '1.0.0');
  });

  test('boots a new shared backend project from first local entry file', () => {
    const bootstrap = inferSharedProjectBootstrap('shared-modules/services/auth/src/index.js', 'module.exports = {}');
    assert.equal(bootstrap?.projectKind, 'module');
    assert.equal(bootstrap?.projectName, 'services/auth');
    assert.equal(bootstrap?.entryPath, 'src/index.js');
  });
});
