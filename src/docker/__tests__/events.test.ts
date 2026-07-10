import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { watchEvents } from '../events';
import type { DockerEvent } from '../../types';

describe('watchEvents', () => {
  it('emits host-aware Docker events from the provided client', async () => {
    const stream = new EventEmitter();
    const client = {
      getEvents: vi.fn((_opts, callback) => callback(null, stream)),
    };
    const events: DockerEvent[] = [];

    const stop = watchEvents((event) => events.push(event), undefined, client as any, 'remote-a');

    stream.emit(
      'data',
      Buffer.from(
        JSON.stringify({
          Type: 'container',
          Action: 'start',
          Actor: {
            ID: 'abcdef1234567890',
            Attributes: { name: 'api' },
          },
          time: 123,
        }),
      ),
    );

    expect(client.getEvents).toHaveBeenCalledWith({}, expect.any(Function));
    expect(events).toEqual([
      {
        id: 'abcdef123456',
        containerId: 'abcdef1234567890',
        host: 'remote-a',
        type: 'container',
        action: 'start',
        actor: 'api',
        time: 123,
        message: 'remote-a container start: api',
      },
    ]);

    stop();
  });
});
