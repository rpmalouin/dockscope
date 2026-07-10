import { mkdir, readFile, writeFile } from 'fs/promises';
import { homedir } from 'os';
import path from 'path';

type StoredPluginState = Record<string, { enabled?: boolean }>;

export interface PluginStateStore {
  loadEnabled(pluginId: string): Promise<boolean>;
  saveEnabled(pluginId: string, enabled: boolean): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeStoredState(raw: unknown): StoredPluginState {
  if (!isRecord(raw)) {
    return {};
  }
  const stored: StoredPluginState = {};
  for (const [pluginId, state] of Object.entries(raw)) {
    if (!isRecord(state)) {
      continue;
    }
    stored[pluginId] = {
      ...(typeof state.enabled === 'boolean' ? { enabled: state.enabled } : {}),
    };
  }
  return stored;
}

export class JsonPluginStateStore implements PluginStateStore {
  constructor(private readonly filePath: string) {}

  async loadEnabled(pluginId: string): Promise<boolean> {
    return (await this.readAll())[pluginId]?.enabled ?? true;
  }

  async saveEnabled(pluginId: string, enabled: boolean): Promise<void> {
    const stored = await this.readAll();
    stored[pluginId] = { enabled };
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(stored, null, 2), 'utf-8');
  }

  private async readAll(): Promise<StoredPluginState> {
    try {
      return normalizeStoredState(JSON.parse(await readFile(this.filePath, 'utf-8')) as unknown);
    } catch {
      return {};
    }
  }
}

export function createPluginStateStoreFromEnv(env: NodeJS.ProcessEnv): PluginStateStore {
  return new JsonPluginStateStore(
    env.DOCKSCOPE_PLUGIN_STATE || path.join(homedir(), '.dockscope', 'plugin-state.json'),
  );
}
