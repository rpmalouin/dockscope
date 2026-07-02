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
    expect(shouldRefreshLogSubscription('abcdef1234567890', event({ action: 'start' }))).toBe(true);
    expect(shouldRefreshLogSubscription('abcdef1234567890', event({ action: 'restart' }))).toBe(
      true,
    );
    expect(shouldRefreshLogSubscription('abcdef1234567890', event({ action: 'unpause' }))).toBe(
      true,
    );
  });

  it('does not refresh for unrelated containers or stop events', () => {
    expect(shouldRefreshLogSubscription('123456abcdef', event({ action: 'start' }))).toBe(false);
    expect(shouldRefreshLogSubscription('abcdef1234567890', event({ action: 'die' }))).toBe(false);
    expect(shouldRefreshLogSubscription(null, event({ action: 'start' }))).toBe(false);
  });
});
