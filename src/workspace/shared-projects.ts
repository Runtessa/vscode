import type { SharedProjectDto, SharedProjectManifestEntry, TenantPullSnapshot, TenantWorkspaceManifest } from '../types';

const sharedProjectRoot = (projectKind: 'ui' | 'module', projectName: string) =>
  `${projectKind === 'ui' ? 'shared-ui' : 'shared-modules'}/${String(projectName || '').trim()}`;

const toManifestProject = (projectKind: 'ui' | 'module', project: SharedProjectDto): SharedProjectManifestEntry => ({
  projectId: project.id,
  projectKind,
  projectName: project.name,
  projectVersion: project.version,
  entryPath: project.entryPath || (projectKind === 'ui' ? 'src/index.jsx' : 'src/index.js'),
  fileExtension: project.fileExtension,
  relativeRoot: sharedProjectRoot(projectKind, project.name),
});

export const buildManifestProjects = (snapshot: TenantPullSnapshot) => {
  const projects: Record<string, SharedProjectManifestEntry> = {};
  for (const project of snapshot.sharedUiProjects) {
    const entry = toManifestProject('ui', project);
    projects[entry.relativeRoot] = entry;
  }
  for (const project of snapshot.sharedModuleProjects) {
    const entry = toManifestProject('module', project);
    projects[entry.relativeRoot] = entry;
  }
  return projects;
};

export const findSharedProjectForPath = (manifest: TenantWorkspaceManifest, relativePath: string) => {
  const normalizedPath = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const manifestProjects = Object.values(manifest.projects || {});
  const fallbackProjects = Object.values(manifest.files)
    .filter((entry) => entry.projectId && entry.projectKind && entry.projectName && entry.projectVersion)
    .map((entry) => toManifestProject(entry.projectKind!, {
      id: entry.projectId!,
      name: entry.projectName!,
      version: entry.projectVersion!,
      entryPath: entry.relativePath.split('/').slice(entry.projectName!.split('/').length + 1).join('/'),
      dependencies: [],
      fileExtension: entry.fileExtension,
    }));
  const projects = [...manifestProjects, ...fallbackProjects].filter(
    (project, index, list) => list.findIndex((candidate) => candidate.relativeRoot === project.relativeRoot) === index,
  );
  if (!projects.length) return null;
  return projects
    .sort((a, b) => b.relativeRoot.length - a.relativeRoot.length)
    .find((project) => normalizedPath === project.relativeRoot || normalizedPath.startsWith(`${project.relativeRoot}/`)) || null;
};

const splitBootstrapPath = (projectKind: 'ui' | 'module', normalizedPath: string) => {
  const root = projectKind === 'ui' ? 'shared-ui/' : 'shared-modules/';
  const remainder = normalizedPath.slice(root.length);
  const markerIndex = remainder.indexOf('/src/');
  if (markerIndex > 0) {
    return {
      projectName: remainder.slice(0, markerIndex).trim(),
      entryPath: remainder.slice(markerIndex + 1),
    };
  }

  const firstSlash = remainder.indexOf('/');
  if (firstSlash <= 0) return null;
  return {
    projectName: remainder.slice(0, firstSlash).trim(),
    entryPath: remainder.slice(firstSlash + 1),
  };
};

export const inferSharedProjectBootstrap = (relativePath: string, content: string) => {
  const normalizedPath = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalizedPath.startsWith('shared-ui/') && !normalizedPath.startsWith('shared-modules/')) return null;
  const projectKind = normalizedPath.startsWith('shared-ui/') ? 'ui' : 'module';
  const parsed = splitBootstrapPath(projectKind, normalizedPath);
  if (!parsed) return null;
  const { projectName, entryPath } = parsed;
  if (!projectName || !entryPath) return null;
  const fileExtension = normalizedPath.split('.').pop() || (projectKind === 'ui' ? 'jsx' : 'js');
  return {
    projectKind,
    projectName,
    version: '1.0.0',
    entryPath,
    fileExtension,
    code: content,
  } as const;
};
