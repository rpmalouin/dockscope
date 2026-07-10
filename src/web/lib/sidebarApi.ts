import type {
  ContainerInspect,
  ContainerStats,
  CrashDiagnostic,
  MetricPoint,
  ServiceNode,
} from '../../types';
import { deleteJson, getJson, isAbortError, postJson } from './api';

export type ContainerUiAction = 'start' | 'stop' | 'restart' | 'pause' | 'unpause' | 'kill';
export type KubernetesUiAction = 'delete' | 'restart' | 'set_hpa_constraints';

interface OkResponse {
  ok: true;
}

export interface HpaReplicaRange {
  min: number;
  max: number;
}

export interface SidebarNodeData {
  stats: ContainerStats | null;
  inspect: ContainerInspect | null;
  history: MetricPoint[];
  diagnostic: CrashDiagnostic | null;
}

interface SidebarNodeDataOptions {
  loadDiagnostic: boolean;
  signal?: AbortSignal;
}

export type ContainerTarget = Pick<ServiceNode, 'id' | 'containerId' | 'host'> | string;

export function containerApiUrl(
  target: ContainerTarget,
  suffix = '',
  params: Record<string, string | boolean | number | undefined> = {},
): string {
  const containerId = typeof target === 'string' ? target : target.containerId;
  const search = new URLSearchParams();

  if (typeof target !== 'string') {
    search.set('host', target.host || 'local');
    search.set('nodeId', target.id);
  }

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      search.set(key, String(value));
    }
  }

  const qs = search.toString();
  return `/api/containers/${encodeURIComponent(containerId)}${suffix}${qs ? `?${qs}` : ''}`;
}

async function fallbackUnlessAborted<T>(request: Promise<T>, fallback: T): Promise<T> {
  try {
    return await request;
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    return fallback;
  }
}

export function kubernetesRestartMessage(node: ServiceNode): string {
  if (node.kind === 'pod') {
    return `Restart pod ${node.name}? Kubernetes will delete the current pod so its controller can recreate it.`;
  }
  return `Restart backing pods for ${node.fullName}? DockScope will delete the pods resolved from this ${node.kind}.`;
}

export function getHpaReplicaRange(node: ServiceNode): HpaReplicaRange {
  const range = node.ports.find((port) => port.endsWith(' range'))?.replace(' range', '');
  const [minRaw, maxRaw] = (range || '').split('-');
  const min = parseInt(minRaw, 10);
  const max = parseInt(maxRaw, 10);
  return {
    min: Number.isFinite(min) ? min : 1,
    max: Number.isFinite(max) ? max : Math.max(Number.isFinite(min) ? min : 1, 1),
  };
}

export function containerActionPastTense(action: ContainerUiAction): string {
  return {
    start: 'started',
    stop: 'stopped',
    restart: 'restarted',
    pause: 'paused',
    unpause: 'unpaused',
    kill: 'killed',
  }[action];
}

export function kubernetesActionPastTense(action: KubernetesUiAction): string {
  return action === 'restart' ? 'restarted' : action === 'delete' ? 'deleted' : 'updated';
}

export function runContainerAction(
  target: ContainerTarget,
  action: ContainerUiAction,
  init: RequestInit = {},
): Promise<OkResponse> {
  return postJson<OkResponse>(containerApiUrl(target, `/${action}`), undefined, init);
}

export function removeContainer(
  target: ContainerTarget,
  withVolumes: boolean,
  init: RequestInit = {},
): Promise<OkResponse> {
  return deleteJson<OkResponse>(containerApiUrl(target, '', { volumes: withVolumes }), init);
}

export function runKubernetesAction(
  node: ServiceNode,
  action: KubernetesUiAction,
  options: { minReplicas?: number; maxReplicas?: number } = {},
  init: RequestInit = {},
): Promise<OkResponse> {
  return postJson<OkResponse>(
    '/api/kubernetes/action',
    { id: node.containerId, action, ...options },
    init,
  );
}

export function getKubernetesPodLogs(
  containerId: string,
  tail = 300,
  init: RequestInit = {},
): Promise<string> {
  return postJson<{ logs?: string }>('/api/kubernetes/logs', { id: containerId, tail }, init).then(
    (data) => data.logs || '',
  );
}

export function loadDockerSidebarData(
  node: ServiceNode,
  { loadDiagnostic, signal }: SidebarNodeDataOptions,
): Promise<SidebarNodeData> {
  const init = signal ? { signal } : {};
  const inspect = fallbackUnlessAborted(
    getJson<ContainerInspect>(containerApiUrl(node, '/inspect'), init),
    null,
  );

  if (node.status === 'running') {
    return Promise.all([
      fallbackUnlessAborted(getJson<ContainerStats>(containerApiUrl(node, '/stats'), init), null),
      inspect,
      fallbackUnlessAborted(getJson<MetricPoint[]>(containerApiUrl(node, '/history'), init), []),
    ]).then(([stats, inspect, history]) => ({
      stats,
      inspect,
      history,
      diagnostic: null,
    }));
  }

  const diagnostic = loadDiagnostic
    ? fallbackUnlessAborted(
        getJson<CrashDiagnostic | null>(containerApiUrl(node, '/diagnostic'), init),
        null,
      )
    : Promise.resolve(null);

  return Promise.all([inspect, diagnostic]).then(([inspect, diagnostic]) => ({
    stats: null,
    inspect,
    history: [],
    diagnostic,
  }));
}
