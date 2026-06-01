import type { ManifestFileEntry, TenantWorkspaceManifest } from './types';
import { findSharedProjectForPath } from './workspace/shared-projects';

export type PreviewStage = 'draft' | 'published';

export type PreviewTarget = {
  kind: 'ui' | 'shared-ui';
  name: string;
  version: string;
  label: string;
};

type BuildPreviewUrlInput = {
  tenantHost: string;
  coreApiBase: string;
  port: string;
  route: string;
  stage: PreviewStage;
  target: PreviewTarget;
  previewSession: string;
  nonce: number;
};

const localHostPattern = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/i;

const normalizeTenantHost = (value: string) =>
  String(value || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .split('/')[0]!
    .trim();

const resolveProtocol = (tenantHost: string, coreApiBase: string) => {
  if (/^https:\/\//i.test(tenantHost) || /^https:\/\//i.test(coreApiBase)) {
    return 'https:';
  }
  return 'http:';
};

export const normalizePreviewRoute = (value: string) => {
  const raw = String(value || '').trim();
  if (!raw) return '/';
  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      return `${url.pathname || '/'}${url.search || ''}${url.hash || ''}`;
    } catch {
      return '/';
    }
  }
  if (raw.startsWith('?') || raw.startsWith('#')) return `/${raw}`;
  return raw.startsWith('/') ? raw : `/${raw}`;
};

const toPreviewTarget = (entry: ManifestFileEntry): PreviewTarget | null => {
  if (entry.kind === 'ui' && entry.name && entry.version) {
    return {
      kind: 'ui',
      name: entry.name,
      version: entry.version,
      label: `${entry.name}@${entry.version}`,
    };
  }
  if (entry.kind === 'shared-ui-file' && entry.projectName && entry.projectVersion) {
    return {
      kind: 'shared-ui',
      name: entry.projectName,
      version: entry.projectVersion,
      label: `${entry.projectName}@${entry.projectVersion} (shared)`,
    };
  }
  return null;
};

export const listPreviewTargets = (manifest: TenantWorkspaceManifest): PreviewTarget[] => {
  const seen = new Set<string>();
  const targets: PreviewTarget[] = [];
  Object.values(manifest.files).forEach((entry) => {
    const target = toPreviewTarget(entry);
    if (!target) return;
    const key = `${target.kind}:${target.name}@${target.version}`;
    if (seen.has(key)) return;
    seen.add(key);
    targets.push(target);
  });
  return targets.sort((a, b) => a.label.localeCompare(b.label));
};

export const resolvePreviewTarget = (
  manifest: TenantWorkspaceManifest,
  relativePath?: string,
): PreviewTarget | null => {
  if (!relativePath) return null;
  const direct = toPreviewTarget(manifest.files[relativePath]);
  if (direct) return direct;

  const project = findSharedProjectForPath(manifest, relativePath);
  if (project?.projectKind === 'ui') {
    return {
      kind: 'shared-ui',
      name: project.projectName,
      version: project.projectVersion,
      label: `${project.projectName}@${project.projectVersion} (shared)`,
    };
  }

  return null;
};

export const buildPreviewUrl = ({
  tenantHost,
  coreApiBase,
  port,
  route,
  stage,
  target,
  previewSession,
  nonce,
}: BuildPreviewUrlInput) => {
  const normalizedHost = normalizeTenantHost(tenantHost);
  const tenantName = normalizedHost.split(':')[0] || normalizedHost;
  const protocol = resolveProtocol(tenantHost, coreApiBase);
  const portSuffix = String(port || '').trim() ? `:${String(port).trim()}` : '';
  const base = `${protocol}//${tenantName}${portSuffix}`;
  const params = new URLSearchParams({
    name: target.name,
    version: target.version,
    tenantHost: tenantName,
    previewSession,
    stage,
    route: normalizePreviewRoute(route),
    t: String(nonce),
  });
  let coreHost = '';
  try {
    coreHost = coreApiBase ? new URL(coreApiBase).hostname : '';
  } catch {
    coreHost = '';
  }
  if (localHostPattern.test(tenantName) || localHostPattern.test(coreHost)) {
    params.set('kernelMode', 'source');
  }
  return `${base}/preview.html?${params.toString()}`;
};
