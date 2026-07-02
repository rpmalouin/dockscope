import type { ServiceLink } from '../../types';

export type LinkEndpoint = ServiceLink['source'] | ServiceLink['target'] | { id?: string };

export function endpointId(endpoint: LinkEndpoint): string {
  return typeof endpoint === 'object' && endpoint !== null ? endpoint.id || '' : endpoint;
}

export function linkKey(link: {
  source: LinkEndpoint;
  target: LinkEndpoint;
  type: ServiceLink['type'];
  label?: string;
}): string {
  return [endpointId(link.source), endpointId(link.target), link.type, link.label || ''].join(
    '\u0000',
  );
}
