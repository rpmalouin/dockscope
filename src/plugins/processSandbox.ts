import { fork } from 'child_process';
import { fileURLToPath } from 'url';
import type { PluginCommandResult } from '../core/plugin-commands.js';
import { validatePluginCommandResult } from '../core/plugin-commands.js';
import type { PluginConfig } from '../core/plugin-config.js';
import type { PluginManifest } from '../core/plugins.js';
import type { PluginEvent } from '../core/plugin-events.js';
import type { DataSourceDescriptor, SourceGraphSnapshot } from '../core/model.js';

interface SandboxBaseRequest {
  entryPath: string;
  manifest: PluginManifest;
  pluginDir: string;
  config: PluginConfig;
}

export interface SandboxCommandRequest extends SandboxBaseRequest {
  type: 'runCommand';
  commandId: string;
  input?: unknown;
}

export interface SandboxDescribeGraphSourcesRequest extends SandboxBaseRequest {
  type: 'describeGraphSources';
}

export interface SandboxCollectGraphRequest extends SandboxBaseRequest {
  type: 'collectGraph';
  sourceId: string;
}

export type SandboxRequest =
  | SandboxCommandRequest
  | SandboxDescribeGraphSourcesRequest
  | SandboxCollectGraphRequest;

interface SandboxResultMessage {
  type: 'result';
  result: unknown;
}

interface SandboxErrorMessage {
  type: 'error';
  message: string;
}

interface SandboxEventMessage {
  type: 'event';
  eventType: string;
  payload: unknown;
}

type SandboxWorkerMessage = SandboxResultMessage | SandboxErrorMessage | SandboxEventMessage;

export interface IsolatedPluginSandboxOptions extends Omit<SandboxBaseRequest, 'type'> {
  timeoutMs?: number;
  maxStderrBytes?: number;
  publishEvent?: (
    pluginId: string,
    type: string,
    payload: unknown,
  ) => PluginEvent | Promise<PluginEvent>;
}

export interface IsolatedPluginCommandOptions extends IsolatedPluginSandboxOptions {
  commandId: string;
  input?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isWorkerMessage(value: unknown): value is SandboxWorkerMessage {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return false;
  }
  if (value.type === 'result') {
    return 'result' in value;
  }
  if (value.type === 'error') {
    return typeof value.message === 'string';
  }
  return value.type === 'event' && typeof value.eventType === 'string';
}

function sandboxWorkerPath(): string {
  const current = fileURLToPath(import.meta.url);
  if (current.endsWith('.ts')) {
    return current.replace(/processSandbox\.ts$/, 'processSandboxWorker.ts');
  }
  return current.replace(/processSandbox\.js$/, 'processSandboxWorker.js');
}

function sandboxExecArgv(workerPath: string): string[] {
  return workerPath.endsWith('.ts') ? ['--import', 'tsx'] : [];
}

function runSandboxRequest<T>(
  options: IsolatedPluginSandboxOptions,
  request: SandboxRequest,
  validateResult: (result: unknown) => T,
): Promise<T> {
  const workerPath = sandboxWorkerPath();
  return new Promise((resolve, reject) => {
    const child = fork(workerPath, [], {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      execArgv: sandboxExecArgv(workerPath),
      env: {
        ...process.env,
        DOCKSCOPE_PLUGIN_SANDBOX: '1',
      },
    });
    const stderr: string[] = [];
    let settled = false;

    const timeout = setTimeout(() => {
      finish(new Error(`Plugin command timed out after ${options.timeoutMs ?? 30_000}ms`));
    }, options.timeoutMs ?? 30_000);

    function finish(error: Error | undefined, result?: T): void {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      child.removeAllListeners('message');
      child.removeAllListeners('error');
      child.removeAllListeners('exit');
      if (child.connected) {
        child.disconnect();
      }
      if (!child.killed) {
        child.kill();
      }
      if (error) {
        reject(error);
        return;
      }
      if (result === undefined) {
        reject(new Error('Plugin sandbox did not return a result'));
        return;
      }
      resolve(result);
    }

    child.stderr?.on('data', (chunk: Buffer | string) => {
      const text = chunk.toString();
      stderr.push(text);
      if (stderr.join('').length > (options.maxStderrBytes ?? 64_000)) {
        finish(new Error('Plugin sandbox stderr limit exceeded'));
      }
    });

    child.on('error', (error) => {
      finish(error);
    });

    child.on('exit', (code, signal) => {
      if (!settled) {
        const detail = stderr.join('').trim();
        finish(
          new Error(
            `Plugin sandbox exited before returning a result (${signal ?? code})${
              detail ? `: ${detail}` : ''
            }`,
          ),
        );
      }
    });

    child.on('message', (message: unknown) => {
      if (!isWorkerMessage(message)) {
        return;
      }
      if (message.type === 'event') {
        void options.publishEvent?.(options.manifest.id, message.eventType, message.payload);
        return;
      }
      if (message.type === 'error') {
        finish(new Error(message.message));
        return;
      }
      try {
        finish(undefined, validateResult(message.result));
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });

    child.send(request, (error) => {
      if (error) {
        finish(error);
      }
    });
  });
}

function resultAsGraphSources(result: unknown): DataSourceDescriptor[] {
  return Array.isArray(result) ? (result as DataSourceDescriptor[]) : [];
}

function resultAsGraphSnapshot(result: unknown): SourceGraphSnapshot {
  if (!isRecord(result)) {
    throw new Error('Plugin graph source did not return a snapshot');
  }
  return result as unknown as SourceGraphSnapshot;
}

export function runIsolatedPluginCommand(
  options: IsolatedPluginCommandOptions,
): Promise<PluginCommandResult> {
  return runSandboxRequest(
    options,
    {
      type: 'runCommand',
      entryPath: options.entryPath,
      manifest: options.manifest,
      pluginDir: options.pluginDir,
      config: options.config,
      commandId: options.commandId,
      input: options.input,
    },
    validatePluginCommandResult,
  );
}

export function describeIsolatedPluginGraphSources(
  options: IsolatedPluginSandboxOptions,
): Promise<DataSourceDescriptor[]> {
  return runSandboxRequest(
    options,
    {
      type: 'describeGraphSources',
      entryPath: options.entryPath,
      manifest: options.manifest,
      pluginDir: options.pluginDir,
      config: options.config,
    },
    resultAsGraphSources,
  );
}

export function collectIsolatedPluginGraphSource(
  options: IsolatedPluginSandboxOptions & { sourceId: string },
): Promise<SourceGraphSnapshot> {
  return runSandboxRequest(
    options,
    {
      type: 'collectGraph',
      entryPath: options.entryPath,
      manifest: options.manifest,
      pluginDir: options.pluginDir,
      config: options.config,
      sourceId: options.sourceId,
    },
    resultAsGraphSnapshot,
  );
}
