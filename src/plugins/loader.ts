import { readdir, readFile, stat } from 'fs/promises';
import path from 'path';
import { pathToFileURL } from 'url';
import { errorMessage } from '../utils.js';
import type { DataSourceDescriptor, GraphSourceAdapter } from '../core/model.js';
import { defaultPluginConfig, type PluginConfig } from '../core/plugin-config.js';
import {
  type DockscopePlugin,
  type PluginLoadError,
  type PluginManifest,
  validatePluginManifest,
} from '../core/plugins.js';
import { isPluginPermission, type PluginPermission } from '../core/capabilities.js';
import { createPluginHostApi, type PluginHostApi } from './hostApi.js';
import type { PluginSecretStore } from './secretStore.js';
import type { PluginEvent } from '../core/plugin-events.js';
import {
  collectIsolatedPluginGraphSource,
  describeIsolatedPluginGraphSources,
  runIsolatedPluginCommand,
} from './processSandbox.js';

const PLUGIN_MANIFEST_FILE = 'plugin.json';

export interface PluginFactoryContext {
  manifest: PluginManifest;
  pluginDir: string;
  config: PluginConfig;
  host: PluginHostApi;
  logger: Pick<Console, 'debug' | 'info' | 'warn' | 'error'>;
}

type PluginFactory = (context: PluginFactoryContext) => DockscopePlugin | Promise<DockscopePlugin>;

type ExternalPluginModule = Record<string, unknown>;

export type ExternalPluginPermissionPolicy = 'all' | readonly PluginPermission[];

export interface ExternalPluginLoadOptions {
  paths: readonly string[];
  permissions?: ExternalPluginPermissionPolicy;
  getConfig?: (manifest: PluginManifest) => PluginConfig | Promise<PluginConfig>;
  secretStore?: PluginSecretStore;
  publishEvent?: (
    pluginId: string,
    type: string,
    payload: unknown,
  ) => PluginEvent | Promise<PluginEvent>;
  cacheBust?: boolean;
  processCommandTimeoutMs?: number;
  processMaxStderrBytes?: number;
  logger?: Pick<Console, 'debug' | 'info' | 'warn' | 'error'>;
}

export interface ExternalPluginLoadResult {
  plugins: DockscopePlugin[];
  configs: Map<string, PluginConfig>;
  errors: PluginLoadError[];
}

export interface ExternalPluginManifestValidationResult {
  manifests: PluginManifest[];
  errors: PluginLoadError[];
}

function allowedPermissionSet(
  permissions: ExternalPluginPermissionPolicy | undefined,
): Set<PluginPermission> | 'all' {
  if (permissions === 'all') {
    return 'all';
  }
  return new Set(permissions ?? []);
}

function deniedPermissions(
  manifest: PluginManifest,
  policy: Set<PluginPermission> | 'all',
): PluginPermission[] {
  if (policy === 'all') {
    return [];
  }
  return manifest.permissions.filter((permission) => !policy.has(permission));
}

export function parsePluginPermissionList(
  value: string | undefined,
): ExternalPluginPermissionPolicy {
  if (!value?.trim()) {
    return [];
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === '*' || normalized === 'all') {
    return 'all';
  }
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item): item is PluginPermission => isPluginPermission(item));
}

export function parsePluginPaths(value: string | undefined): string[] {
  if (!value?.trim()) {
    return [];
  }
  return value
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function discoverManifestPaths(inputPaths: readonly string[]): Promise<string[]> {
  const manifestPaths: string[] = [];
  for (const inputPath of inputPaths) {
    const root = path.resolve(inputPath);
    const directManifest = path.join(root, PLUGIN_MANIFEST_FILE);
    if (await pathExists(directManifest)) {
      manifestPaths.push(directManifest);
      continue;
    }

    let entries: string[];
    try {
      entries = await readdir(root);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const manifestPath = path.join(root, entry, PLUGIN_MANIFEST_FILE);
      if (await pathExists(manifestPath)) {
        manifestPaths.push(manifestPath);
      }
    }
  }
  return [...new Set(manifestPaths)].sort();
}

function resolvePluginEntry(manifestPath: string, manifest: PluginManifest): string {
  if (!manifest.entry) {
    throw new Error('External plugin manifest requires an "entry" field');
  }
  const pluginDir = path.dirname(manifestPath);
  const entryPath = path.resolve(pluginDir, manifest.entry);
  const relative = path.relative(pluginDir, entryPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('External plugin entry must stay inside the plugin directory');
  }
  return entryPath;
}

function pluginFactoryFromModule(module: ExternalPluginModule): PluginFactory | DockscopePlugin {
  const candidate = module.default ?? module.createPlugin ?? module.plugin;
  if (!candidate) {
    throw new Error('Plugin module must export default, createPlugin, or plugin');
  }
  return candidate as PluginFactory | DockscopePlugin;
}

function isPluginFactory(value: PluginFactory | DockscopePlugin): value is PluginFactory {
  return typeof value === 'function';
}

async function instantiatePlugin(
  module: ExternalPluginModule,
  manifest: PluginManifest,
  pluginDir: string,
  config: PluginConfig,
  host: PluginHostApi,
  logger: Pick<Console, 'debug' | 'info' | 'warn' | 'error'>,
): Promise<DockscopePlugin> {
  const candidate = pluginFactoryFromModule(module);
  const plugin = isPluginFactory(candidate)
    ? await candidate({ manifest, pluginDir, config, host, logger })
    : candidate;
  if (!plugin || typeof plugin !== 'object') {
    throw new Error('Plugin module did not return a plugin object');
  }
  const validatedManifest = validatePluginManifest(plugin.manifest);
  if (validatedManifest.id !== manifest.id) {
    throw new Error(
      `Plugin module manifest id "${validatedManifest.id}" does not match plugin.json id "${manifest.id}"`,
    );
  }
  return { ...plugin, manifest: validatedManifest };
}

function createGraphSourceProxy(
  options: {
    manifest: PluginManifest;
    pluginDir: string;
    entryPath: string;
    config: PluginConfig;
    publishEvent?: ExternalPluginLoadOptions['publishEvent'];
    timeoutMs?: number;
    maxStderrBytes?: number;
  },
  descriptor: DataSourceDescriptor,
): GraphSourceAdapter {
  return {
    describe: () => ({ ...descriptor }),
    collectGraph: () =>
      collectIsolatedPluginGraphSource({
        entryPath: options.entryPath,
        manifest: options.manifest,
        pluginDir: options.pluginDir,
        config: options.config,
        sourceId: descriptor.id,
        timeoutMs: options.timeoutMs,
        maxStderrBytes: options.maxStderrBytes,
        publishEvent: options.publishEvent,
      }),
  };
}

async function createProcessIsolatedPlugin(options: {
  manifest: PluginManifest;
  pluginDir: string;
  entryPath: string;
  config: PluginConfig;
  publishEvent?: ExternalPluginLoadOptions['publishEvent'];
  timeoutMs?: number;
  maxStderrBytes?: number;
}): Promise<DockscopePlugin> {
  const manifestCommands = options.manifest.commands ?? [];
  const graphSources = options.manifest.capabilities.includes('source.graph')
    ? (
        await describeIsolatedPluginGraphSources({
          entryPath: options.entryPath,
          manifest: options.manifest,
          pluginDir: options.pluginDir,
          config: options.config,
          timeoutMs: options.timeoutMs,
          maxStderrBytes: options.maxStderrBytes,
          publishEvent: options.publishEvent,
        })
      ).map((descriptor) => createGraphSourceProxy(options, descriptor))
    : [];
  const plugin: DockscopePlugin = {
    manifest: options.manifest,
    getCommands: () => manifestCommands,
    runCommand: (commandId, input) =>
      runIsolatedPluginCommand({
        entryPath: options.entryPath,
        manifest: options.manifest,
        pluginDir: options.pluginDir,
        config: options.config,
        commandId,
        input,
        timeoutMs: options.timeoutMs,
        maxStderrBytes: options.maxStderrBytes,
        publishEvent: options.publishEvent,
      }),
  };
  if (options.manifest.capabilities.includes('source.graph')) {
    plugin.getGraphSources = () => graphSources;
  }
  return plugin;
}

export async function loadExternalPlugins(
  options: ExternalPluginLoadOptions,
): Promise<ExternalPluginLoadResult> {
  const plugins: DockscopePlugin[] = [];
  const configs = new Map<string, PluginConfig>();
  const errors: PluginLoadError[] = [];
  const policy = allowedPermissionSet(options.permissions);
  const logger = options.logger ?? console;

  for (const manifestPath of await discoverManifestPaths(options.paths)) {
    let phase: PluginLoadError['phase'] = 'manifest';
    let manifestId: string | undefined;
    try {
      const rawManifest = JSON.parse(await readFile(manifestPath, 'utf-8')) as unknown;
      const manifest = validatePluginManifest(rawManifest);
      manifestId = manifest.id;
      const denied = deniedPermissions(manifest, policy);
      if (denied.length > 0) {
        phase = 'permission';
        throw new Error(`Plugin requires disallowed permissions: ${denied.join(', ')}`);
      }

      phase = 'config';
      const config = options.getConfig
        ? await options.getConfig(manifest)
        : defaultPluginConfig(manifest.config);
      phase = 'load';
      const entryPath = resolvePluginEntry(manifestPath, manifest);
      const pluginDir = path.dirname(manifestPath);
      if (manifest.execution?.isolation === 'process') {
        plugins.push(
          await createProcessIsolatedPlugin({
            manifest,
            pluginDir,
            entryPath,
            config,
            publishEvent: options.publishEvent,
            timeoutMs: manifest.execution.commandTimeoutMs ?? options.processCommandTimeoutMs,
            maxStderrBytes: manifest.execution.maxStderrBytes ?? options.processMaxStderrBytes,
          }),
        );
        configs.set(manifest.id, config);
        continue;
      }
      const entryUrl = pathToFileURL(entryPath);
      if (options.cacheBust) {
        entryUrl.searchParams.set('v', `${Date.now()}`);
      }
      const module = (await import(entryUrl.href)) as ExternalPluginModule;
      const host = createPluginHostApi({
        pluginId: manifest.id,
        pluginDir,
        capabilities: manifest.capabilities,
        permissions: manifest.permissions,
        secrets: manifest.secrets,
        secretStore: options.secretStore,
        publishEvent: options.publishEvent
          ? (type, payload) => options.publishEvent!(manifest.id, type, payload)
          : undefined,
      });
      plugins.push(await instantiatePlugin(module, manifest, pluginDir, config, host, logger));
      configs.set(manifest.id, config);
    } catch (error) {
      errors.push({
        id: manifestId,
        path: manifestPath,
        phase,
        message: errorMessage(error),
      });
    }
  }

  return { plugins, configs, errors };
}

export async function validateExternalPluginManifests(options: {
  paths: readonly string[];
  permissions?: ExternalPluginPermissionPolicy;
}): Promise<ExternalPluginManifestValidationResult> {
  const manifests: PluginManifest[] = [];
  const errors: PluginLoadError[] = [];
  const policy = allowedPermissionSet(options.permissions);

  for (const manifestPath of await discoverManifestPaths(options.paths)) {
    let phase: PluginLoadError['phase'] = 'manifest';
    let manifestId: string | undefined;
    try {
      const rawManifest = JSON.parse(await readFile(manifestPath, 'utf-8')) as unknown;
      const manifest = validatePluginManifest(rawManifest);
      manifestId = manifest.id;
      const denied = deniedPermissions(manifest, policy);
      if (denied.length > 0) {
        phase = 'permission';
        throw new Error(`Plugin requires disallowed permissions: ${denied.join(', ')}`);
      }
      phase = 'load';
      const entryPath = resolvePluginEntry(manifestPath, manifest);
      if (!(await pathExists(entryPath))) {
        throw new Error(`Plugin entry does not exist: ${entryPath}`);
      }
      manifests.push(manifest);
    } catch (error) {
      errors.push({
        id: manifestId,
        path: manifestPath,
        phase,
        message: errorMessage(error),
      });
    }
  }

  return { manifests, errors };
}

export async function loadExternalPluginsFromEnv(
  env: NodeJS.ProcessEnv,
  options: Pick<
    ExternalPluginLoadOptions,
    | 'getConfig'
    | 'secretStore'
    | 'publishEvent'
    | 'cacheBust'
    | 'processCommandTimeoutMs'
    | 'processMaxStderrBytes'
    | 'logger'
  > = {},
): Promise<ExternalPluginLoadResult> {
  if (env.DOCKSCOPE_DISABLE_EXTERNAL_PLUGINS === '1') {
    return { plugins: [], configs: new Map(), errors: [] };
  }
  return loadExternalPlugins({
    paths: parsePluginPaths(env.DOCKSCOPE_PLUGIN_PATHS),
    permissions: parsePluginPermissionList(env.DOCKSCOPE_PLUGIN_PERMISSIONS),
    ...options,
  });
}
