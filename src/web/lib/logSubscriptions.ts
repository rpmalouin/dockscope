import type { DockerEvent } from '../../types';

const LOG_REFRESH_ACTIONS = new Set(['start', 'restart', 'unpause']);

export function shouldRefreshLogSubscription(
  streamingContainerId: string | null,
  streamingHost: string | null,
  event: DockerEvent,
): boolean {
  const eventContainerIds = [
    event.containerId,
    event.id.includes(':') ? event.id.split(':').at(-1) : event.id,
  ].filter((id): id is string => Boolean(id));

  return (
    Boolean(streamingContainerId) &&
    (!event.host || !streamingHost || event.host === streamingHost) &&
    LOG_REFRESH_ACTIONS.has(event.action) &&
    eventContainerIds.some(
      (id) => streamingContainerId!.startsWith(id) || id.startsWith(streamingContainerId!),
    )
  );
}
