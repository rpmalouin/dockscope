import { pathToFileURL } from 'url';
import { errorMessage } from '../utils.js';
import type { DockscopePlugin, PluginManifest } from '../core/plugins.js';
import { validatePluginManifest } from '../core/plugins.js';
import type { PluginConfig } from '../core/plugin-config.js';
import type { PluginCommandResult } from '../core/plugin-commands.js';
import { validatePluginCommandResult } from '../core/plugin-commands.js';
import { createPluginHostApi } from './hostApi.js';
import { createPluginSecretStoreFromEnv } from './secretStore.js';
import type { PluginFactoryContext } from './loader.js';
import type { SandboxRequest } from './processSandbox.js';

type ExternalPluginModule = Record<string, unknown>;
type PluginFactory = (context: PluginFactoryContext) => DockscopePlugin | Promise<DockscopePlugin>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSandboxRequest(value: unknown): value is SandboxRequest {
  return (
    isRecord(value) &&
    (value.type === 'runCommand' ||
      value.type === 'describeGraphSources' ||
      value.type === 'collectGraph') &&
    typeof value.entryPath === 'string' &&
    isRecord(value.manifest) &&
    typeof value.pluginDir === 'string' &&
    isRecord(value.config) &&
    (value.type !== 'runCommand' || typeof value.commandId === 'string') &&
    (value.type !== 'collectGraph' || typeof value.sourceId === 'string')
  );
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
): Promise<DockscopePlugin> {
  const host = createPluginHostApi({
    pluginId: manifest.id,
    pluginDir,
    capabilities: manifest.capabilities,
    permissions: manifest.permissions,
    secrets: manifest.secrets,
    secretStore: createPluginSecretStoreFromEnv(process.env),
    publishEvent: async (type, payload) => {
      process.send?.({ type: 'event', eventType: type, payload });
      return {
        id: `${Date.now()}-sandbox`,
        pluginId: manifest.id,
        type,
        payload,
        time: Date.now(),
      };
    },
  });
  const candidate = pluginFactoryFromModule(module);
  const plugin = isPluginFactory(candidate)
    ? await candidate({ manifest, pluginDir, config, host, logger: console })
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

async function loadPlugin(request: SandboxRequest): Promise<DockscopePlugin> {
  const manifest = validatePluginManifest(request.manifest);
  const module = (await import(pathToFileURL(request.entryPath).href)) as ExternalPluginModule;
  return instantiatePlugin(module, manifest, request.pluginDir, request.config);
}

async function runCommand(request: SandboxRequest): Promise<PluginCommandResult> {
  if (request.type !== 'runCommand') {
    throw new Error('Invalid command request');
  }
  const plugin = await loadPlugin(request);
  if (!plugin.runCommand) {
    throw new Error(`Plugin does not implement commands: ${plugin.manifest.id}`);
  }
  return validatePluginCommandResult(await plugin.runCommand(request.commandId, request.input));
}

async function describeGraphSources(request: SandboxRequest) {
  const plugin = await loadPlugin(request);
  return (plugin.getGraphSources?.() ?? []).map((source) => source.describe());
}

async function collectGraph(request: SandboxRequest) {
  if (request.type !== 'collectGraph') {
    throw new Error('Invalid graph collect request');
  }
  const plugin = await loadPlugin(request);
  const source = (plugin.getGraphSources?.() ?? []).find(
    (candidate) => candidate.describe().id === request.sourceId,
  );
  if (!source) {
    throw new Error(`Plugin graph source not found: ${request.sourceId}`);
  }
  return source.collectGraph();
}

process.once('message', (message: unknown) => {
  void (async () => {
    try {
      if (!isSandboxRequest(message)) {
        throw new Error('Invalid plugin sandbox request');
      }
      const result =
        message.type === 'runCommand'
          ? await runCommand(message)
          : message.type === 'describeGraphSources'
            ? await describeGraphSources(message)
            : await collectGraph(message);
      process.send?.({ type: 'result', result });
    } catch (error) {
      process.send?.({ type: 'error', message: errorMessage(error) });
    } finally {
      process.disconnect();
    }
  })();
});
