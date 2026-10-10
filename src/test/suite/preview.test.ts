import * as assert from 'node:assert/strict';
import { buildPreviewUrl, listPreviewTargets, normalizePreviewRoute, resolvePreviewTarget } from '../../preview';
import type { TenantWorkspaceManifest } from '../../types';
import { buildManifestProjects } from '../../workspace/shared-projects';

const manifest: TenantWorkspaceManifest = {
  version: 1,
  tenantHost: 'tenant.localhost',
  pulledAt: '2026-01-01T00:00:00.000Z',
  rootFolder: 'tenant-workspace',
  files: {
    'ui/home/home.ui.jsx': {
      kind: 'ui',
      relativePath: 'ui/home/home.ui.jsx',
      uiId: 'ui-1',
      name: 'dashboard/home',
      version: '1.0.0',
    },
    'shared-ui/layouts/src/index.jsx': {
      kind: 'shared-ui-file',
      relativePath: 'shared-ui/layouts/src/index.jsx',
      projectId: 'shared-1',
      projectKind: 'ui',
      projectName: 'shared/layouts',
      projectVersion: '2.0.0',
    },
  },
  projects: buildManifestProjects({
    modules: [],
    models: [],
    uiPackages: [],
    acl: { permissions: {}, roles: {}, endpoints: {} },
    sharedUiProjects: [
      {
        id: 'shared-1',
        name: 'layouts',
        version: '2.0.0',
        entryPath: 'src/index.jsx',
        dependencies: [],
        fileExtension: 'jsx',
      },
    ],
    sharedUiFiles: [],
    sharedModuleProjects: [],
    sharedModuleFiles: [],
  }),
};

suite('preview helpers', () => {
  test('normalizes preview routes', () => {
    assert.equal(normalizePreviewRoute('dashboard'), '/dashboard');
    assert.equal(normalizePreviewRoute('?tab=1'), '/?tab=1');
    assert.equal(normalizePreviewRoute('https://tenant.localhost/orders?id=1#x'), '/orders?id=1#x');
  });

  test('collects unique preview targets', () => {
    const targets = listPreviewTargets(manifest);
    assert.equal(targets.length, 2);
    assert.equal(targets[0]?.label, 'dashboard/home@1.0.0');
  });

  test('resolves direct and shared preview targets', () => {
    assert.equal(resolvePreviewTarget(manifest, 'ui/home/home.ui.jsx')?.name, 'dashboard/home');
    assert.equal(resolvePreviewTarget(manifest, 'shared-ui/layouts')?.version, '2.0.0');
  });

  test('handles missing manifest paths and newly created files inside shared projects', () => {
    assert.equal(resolvePreviewTarget(manifest), null);
    assert.equal(resolvePreviewTarget(manifest, 'untracked/file.ts'), null);
    assert.equal(resolvePreviewTarget(manifest, 'shared-ui/layouts/src/new.jsx')?.kind, 'shared-ui');
  });

  test('builds preview url with route and stage', () => {
    const url = buildPreviewUrl({
      tenantHost: 'tenant.localhost',
      coreApiBase: 'http://127.0.0.1:3002',
      port: '3000',
      route: '/orders?id=1',
      stage: 'draft',
      target: { kind: 'ui', name: 'dashboard/home', version: '1.0.0', label: 'dashboard/home@1.0.0' },
      previewSession: 'vscode-1',
      nonce: 1,
    });
    assert.match(url, /^http:\/\/tenant\.localhost:3000\/preview\.html\?/);
    assert.match(url, /name=dashboard%2Fhome/);
    assert.match(url, /route=%2Forders%3Fid%3D1/);
    assert.match(url, /kernelMode=source/);
  });
});
