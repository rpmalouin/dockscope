import { mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { JsonPluginEventStore } from '../eventStore';

describe('JsonPluginEventStore', () => {
  it('persists and reloads plugin events', async () => {
    const filePath = path.join(
      await mkdtemp(path.join(tmpdir(), 'dockscope-events-')),
      'events.json',
    );
    const store = new JsonPluginEventStore(filePath);

    await store.save([
      {
        id: 'event-1',
        pluginId: 'plugin.demo',
        type: 'demo.event',
        payload: { ok: true },
        time: 1,
      },
    ]);

    await expect(new JsonPluginEventStore(filePath).load()).resolves.toEqual([
      {
        id: 'event-1',
        pluginId: 'plugin.demo',
        type: 'demo.event',
        payload: { ok: true },
        time: 1,
      },
    ]);
  });
});
