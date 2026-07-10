import { describe, expect, it } from 'vitest';
import type { DockerEvent } from '../../../types';
import { shouldRefreshLogSubscription } from '../logSubscriptions';

function event(overrides: Partial<DockerEvent>): DockerEvent {
  return {
    id: 'abcdef123456',
    type: 'container',
    action: 'start',
    actor: 'api',
    time: 123,
    message: 'container start: api',
    ...overrides,
  };
}

describe('log subscriptions', () => {
  it('refreshes when the streamed Docker container starts again', () => {
    expect(
      shouldRefreshLogSubscription('abcdef1234567890', 'local', event({ action: 'start' })),
    ).toBe(true);
    expect(
      shouldRefreshLogSubscription('abcdef1234567890', 'local', event({ action: 'restart' })),
    ).toBe(true);
    expect(
      shouldRefreshLogSubscription('abcdef1234567890', 'local', event({ action: 'unpause' })),
    ).toBe(true);
  });

  it('does not refresh for unrelated containers or stop events', () => {
    expect(shouldRefreshLogSubscription('123456abcdef', 'local', event({ action: 'start' }))).toBe(
      false,
    );
    expect(
      shouldRefreshLogSubscription('abcdef1234567890', 'local', event({ action: 'die' })),
    ).toBe(false);
    expect(shouldRefreshLogSubscription(null, 'local', event({ action: 'start' }))).toBe(false);
  });

  it('matches host-aware remote container events', () => {
    expect(
      shouldRefreshLogSubscription(
        'abcdef1234567890',
        'dind-a',
        event({ id: 'dind-a:abcdef123456', containerId: 'abcdef1234567890', host: 'dind-a' }),
      ),
    ).toBe(true);
    expect(
      shouldRefreshLogSubscription(
        'abcdef1234567890',
        'dind-b',
        event({ id: 'dind-a:abcdef123456', containerId: 'abcdef1234567890', host: 'dind-a' }),
      ),
    ).toBe(false);
  });
});
