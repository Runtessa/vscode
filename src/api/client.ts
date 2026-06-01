import { transform } from 'esbuild';
import { extractUiDependencies } from '../ui';
import type {
  AclConfigDto,
  ManifestFileEntry,
  ModuleDto,
  OrmModelDto,
  SharedFileDto,
  SharedProjectDto,
  TenantPullSnapshot,
  UiPackageDto,
} from '../types';

type ClientOptions = {
  baseUrl: string;
  tenantHost: string;
  sessionToken: string;
};

export type ModuleRevisionDto = {
  id: string;
  revision: number;
  routePath: string;
  method: string;
  code: string;
  fileExtension?: string;
  action?: string;
  createdAt: string;
  createdBy?: string;
};

export type UiRevisionDto = {
  id: string;
  revision: number;
  name: string;
  version: string;
  code: string;
  codeBlob: string;
  dependencies: string[];
  fileExtension?: string;
  action?: string;
  createdAt: string;
  createdBy?: string;
};

const toUrl = (baseUrl: string, path: string) => `${baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;

const compileUiSource = async (code: string, extension = 'jsx') => {
  if (extension === 'css' || extension === 'json') return code;
  const loader = extension === 'js' ? 'js' : extension === 'jsx' ? 'jsx' : 'tsx';
  const result = await transform(code, {
    loader,
    format: 'cjs',
    platform: 'browser',
    target: 'es2020',
  });
  return result.code || code;
};

export class IdeClient {
  constructor(private readonly options: ClientOptions) {}

  private async request<T>(path: string, init: RequestInit = {}, mode: 'tenant' | 'admin' = 'tenant'): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Session ${this.options.sessionToken}`,
    };
    if (mode === 'tenant') {
      headers['X-Tenant-Host'] = this.options.tenantHost;
    }
    const response = await fetch(toUrl(this.options.baseUrl, path), {
      ...init,
      headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    if (!response.ok) {
      throw new Error(String((data as any)?.error || `Request failed (${response.status})`));
    }
    return data as T;
  }

  async getCurrentUser() {
    return this.request<{ user: { id: number | string; email?: string } }>('/api/me');
  }

  async pullTenantWorkspace(): Promise<TenantPullSnapshot> {
    const [modules, models, uiPackages, acl, sharedUi, sharedModules] = await Promise.all([
      this.request<ModuleDto[]>('/api/modules'),
      this.request<OrmModelDto[]>('/api/models'),
      this.request<UiPackageDto[]>('/api/ui-entities'),
      this.request<AclConfigDto>('/api/acl/config'),
      this.request<{ packages: SharedProjectDto[] }>('/api/admin/shared-packages', {}, 'admin'),
      this.request<{ packages: SharedProjectDto[] }>('/api/admin/shared-modules', {}, 'admin'),
    ]);

    const sharedUiFiles = (
      await Promise.all(
        sharedUi.packages.map(async (project) => {
          const response = await this.request<{ files: SharedFileDto[] }>(
            `/api/admin/shared-packages/${encodeURIComponent(project.id)}/files`,
            {},
            'admin',
          );
          return response.files.map((file) => ({
            ...file,
            projectId: project.id,
            projectName: project.name,
            projectVersion: project.version,
          }));
        }),
      )
    ).flat();

    const sharedModuleFiles = (
      await Promise.all(
        sharedModules.packages.map(async (project) => {
          const response = await this.request<{ files: SharedFileDto[] }>(
            `/api/admin/shared-modules/${encodeURIComponent(project.id)}/files`,
            {},
            'admin',
          );
          return response.files.map((file) => ({
            ...file,
            projectId: project.id,
            projectName: project.name,
            projectVersion: project.version,
          }));
        }),
      )
    ).flat();

    return {
      modules,
      models,
      uiPackages,
      acl,
      sharedUiProjects: sharedUi.packages,
      sharedUiFiles,
      sharedModuleProjects: sharedModules.packages,
      sharedModuleFiles,
    };
  }

  async createModule(input: { routePath: string; method: string; code: string; fileExtension?: string }) {
    return this.request<ModuleDto>('/api/modules', { method: 'POST', body: JSON.stringify(input) });
  }

  async createModel(input: { path: string; code: string; fileExtension?: string }) {
    return this.request<OrmModelDto>('/api/models', { method: 'POST', body: JSON.stringify(input) });
  }

  async createUiPackage(input: { name: string; version: string; code: string; fileExtension?: string }) {
    const fileExtension = input.fileExtension || 'jsx';
    return this.request<UiPackageDto>('/api/ui-entities', {
      method: 'POST',
      body: JSON.stringify({
        ...input,
        codeBlob: await compileUiSource(input.code, fileExtension),
        dependencies: extractUiDependencies(input.code),
        fileExtension,
      }),
    });
  }

  async createSharedUiProject(input: { name: string; version: string; code: string; entryPath?: string; fileExtension?: string }) {
    const fileExtension = input.fileExtension || 'jsx';
    return this.request<{ package: SharedProjectDto }>('/api/admin/shared-packages', {
      method: 'POST',
      body: JSON.stringify({
        ...input,
        entryPath: input.entryPath || 'src/index.jsx',
        codeBlob: await compileUiSource(input.code, fileExtension),
        dependencies: extractUiDependencies(input.code),
        fileExtension,
      }),
    }, 'admin');
  }

  async createSharedModuleProject(input: { name: string; version: string; code: string; entryPath?: string; fileExtension?: string }) {
    const fileExtension = input.fileExtension || 'js';
    return this.request<{ package: SharedProjectDto }>('/api/admin/shared-modules', {
      method: 'POST',
      body: JSON.stringify({
        ...input,
        entryPath: input.entryPath || 'src/index.js',
        codeBlob: input.code,
        dependencies: [],
        fileExtension,
      }),
    }, 'admin');
  }

  async createSharedFile(entry: { projectKind: 'ui' | 'module'; projectId: string; path: string; content: string; fileExtension?: string }) {
    const base = entry.projectKind === 'ui' ? '/api/admin/shared-packages' : '/api/admin/shared-modules';
    return this.request(`${base}/${encodeURIComponent(entry.projectId)}/files`, {
      method: 'POST',
      body: JSON.stringify({ path: entry.path, content: entry.content, fileExtension: entry.fileExtension }),
    }, 'admin');
  }

  async updateModule(id: string, input: { routePath: string; method: string; code: string; fileExtension?: string }) {
    return this.request<ModuleDto>(`/api/modules/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(input) });
  }

  async deleteModule(id: string) {
    await this.request(`/api/modules/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  async updateModel(id: string, input: { path: string; code: string; fileExtension?: string }) {
    return this.request<OrmModelDto>(`/api/models/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(input) });
  }

  async deleteModel(id: string) {
    await this.request(`/api/models/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  async updateUiPackage(id: string, input: { name: string; version: string; code: string; fileExtension?: string }) {
    const fileExtension = input.fileExtension || 'jsx';
    return this.request<UiPackageDto>(`/api/ui-entities/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({
        ...input,
        codeBlob: await compileUiSource(input.code, fileExtension),
        dependencies: extractUiDependencies(input.code),
        fileExtension,
      }),
    });
  }

  async deleteUiPackage(id: string) {
    await this.request(`/api/ui-entities/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  async updateAclFile(file: 'permissions' | 'roles' | 'endpoints', content: string) {
    return this.request<AclConfigDto>('/api/acl/config', { method: 'PUT', body: JSON.stringify({ file, content }) });
  }

  async updateSharedFile(entry: { projectKind: 'ui' | 'module'; projectId: string; fileId: string; path: string; content: string; fileExtension?: string }) {
    const base = entry.projectKind === 'ui' ? '/api/admin/shared-packages' : '/api/admin/shared-modules';
    return this.request(`${base}/${encodeURIComponent(entry.projectId)}/files/${encodeURIComponent(entry.fileId)}`, {
      method: 'PUT',
      body: JSON.stringify({ path: entry.path, content: entry.content, fileExtension: entry.fileExtension }),
    }, 'admin');
  }

  async deleteSharedFile(entry: { projectKind: 'ui' | 'module'; projectId: string; fileId: string }) {
    const base = entry.projectKind === 'ui' ? '/api/admin/shared-packages' : '/api/admin/shared-modules';
    await this.request(`${base}/${encodeURIComponent(entry.projectId)}/files/${encodeURIComponent(entry.fileId)}`, { method: 'DELETE' }, 'admin');
  }

  async publishEntry(entry: ManifestFileEntry) {
    switch (entry.kind) {
      case 'module':
        return this.request(`/api/modules/${encodeURIComponent(entry.moduleId || '')}/publish`, { method: 'POST' });
      case 'ui':
        return this.request(`/api/ui-entities/${encodeURIComponent(entry.uiId || '')}/publish`, { method: 'POST' });
      case 'shared-ui-file':
      case 'shared-module-file': {
        const base = entry.projectKind === 'ui' ? '/api/admin/shared-packages' : '/api/admin/shared-modules';
        return this.request(`${base}/${encodeURIComponent(entry.projectId || '')}/publish`, { method: 'POST' }, 'admin');
      }
      default:
        throw new Error('Publish is not supported for this resource.');
    }
  }

  async listRevisions(entry: ManifestFileEntry) {
    switch (entry.kind) {
      case 'module':
        return this.request<{ items: ModuleRevisionDto[] }>(`/api/modules/${encodeURIComponent(entry.moduleId || '')}/versions?page=1&limit=20`);
      case 'ui':
        return this.request<{ items: UiRevisionDto[] }>(`/api/ui-entities/${encodeURIComponent(entry.uiId || '')}/versions?page=1&limit=20`);
      default:
        return { items: [] };
    }
  }

  async rollbackRevision(entry: ManifestFileEntry, revisionId: string) {
    switch (entry.kind) {
      case 'module':
        return this.request(`/api/modules/${encodeURIComponent(entry.moduleId || '')}/rollback/${encodeURIComponent(revisionId)}`, { method: 'POST' });
      case 'ui':
        return this.request(`/api/ui-entities/${encodeURIComponent(entry.uiId || '')}/rollback/${encodeURIComponent(revisionId)}`, { method: 'POST' });
      default:
        throw new Error('Rollback is not supported for this resource.');
    }
  }
}
