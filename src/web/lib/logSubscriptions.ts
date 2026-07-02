import type { DockerEvent } from '../../types';

const LOG_REFRESH_ACTIONS = new Set(['start', 'restart', 'unpause']);

export function shouldRefreshLogSubscription(
  streamingContainerId: string | null,
  event: DockerEvent,
): boolean {
  return (
    Boolean(streamingContainerId) &&
    LOG_REFRESH_ACTIONS.has(event.action) &&
    streamingContainerId!.startsWith(event.id)
  );
}
