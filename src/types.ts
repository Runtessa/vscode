export type ModuleDto = {
  id: string;
  routePath: string;
  method: string;
  code: string;
  fileExtension?: string;
};

export type OrmModelDto = {
  id: string;
  path: string;
  code: string;
  fileExtension?: string;
};

export type UiPackageDto = {
  id: string;
  name: string;
  version: string;
  code?: string;
  codeBlob: string;
  dependencies: string[];
  fileExtension?: string;
};

export type AclConfigDto = {
  permissions: { permissions?: Array<{ key: string; label?: string }> };
  roles: { roles?: Record<string, string[]>; groups?: Record<string, string[]> };
  endpoints: Record<string, { read?: string[]; write?: string[]; edit?: string[]; delete?: string[]; allowAnonymous?: boolean }>;
};

export type SharedProjectDto = {
  id: string;
  name: string;
  version: string;
  entryPath: string;
  code?: string;
  codeBlob?: string;
  dependencies: string[];
  fileExtension?: string;
};

export type SharedFileDto = {
  id: string;
  path: string;
  fileExtension?: string;
  content: string;
};

export type ManifestFileKind =
  | 'module'
  | 'model'
  | 'ui'
  | 'acl'
  | 'shared-ui-file'
  | 'shared-module-file';

export type ManifestFileEntry = {
  kind: ManifestFileKind;
  relativePath: string;
  fileExtension?: string;
  moduleId?: string;
  routePath?: string;
  method?: string;
  modelId?: string;
  uiId?: string;
  name?: string;
  version?: string;
  dependencies?: string[];
  aclFile?: 'permissions' | 'roles' | 'endpoints';
  projectId?: string;
  projectKind?: 'ui' | 'module';
  projectName?: string;
  fileId?: string;
  projectVersion?: string;
};

export type SharedProjectManifestEntry = {
  projectId: string;
  projectKind: 'ui' | 'module';
  projectName: string;
  projectVersion: string;
  entryPath: string;
  fileExtension?: string;
  relativeRoot: string;
};

export type TenantWorkspaceManifest = {
  version: 1;
  tenantHost: string;
  pulledAt: string;
  rootFolder: string;
  files: Record<string, ManifestFileEntry>;
  projects?: Record<string, SharedProjectManifestEntry>;
};

export type TenantPullSnapshot = {
  modules: ModuleDto[];
  models: OrmModelDto[];
  uiPackages: UiPackageDto[];
  acl: AclConfigDto;
  sharedUiProjects: SharedProjectDto[];
  sharedUiFiles: Array<SharedFileDto & { projectId: string; projectName: string; projectVersion: string }>;
  sharedModuleProjects: SharedProjectDto[];
  sharedModuleFiles: Array<SharedFileDto & { projectId: string; projectName: string; projectVersion: string }>;
};
