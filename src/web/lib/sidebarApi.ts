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
  containerId: string,
  action: ContainerUiAction,
  init: RequestInit = {},
): Promise<OkResponse> {
  return postJson<OkResponse>(`/api/containers/${containerId}/${action}`, undefined, init);
}

export function removeContainer(
  containerId: string,
  withVolumes: boolean,
  init: RequestInit = {},
): Promise<OkResponse> {
  return deleteJson<OkResponse>(`/api/containers/${containerId}?volumes=${withVolumes}`, init);
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
    getJson<ContainerInspect>(`/api/containers/${node.containerId}/inspect`, init),
    null,
  );

  if (node.status === 'running') {
    return Promise.all([
      fallbackUnlessAborted(
        getJson<ContainerStats>(`/api/containers/${node.containerId}/stats`, init),
        null,
      ),
      inspect,
      fallbackUnlessAborted(
        getJson<MetricPoint[]>(`/api/containers/${node.containerId}/history`, init),
        [],
      ),
    ]).then(([stats, inspect, history]) => ({
      stats,
      inspect,
      history,
      diagnostic: null,
    }));
  }

  const diagnostic = loadDiagnostic
    ? fallbackUnlessAborted(
        getJson<CrashDiagnostic | null>(`/api/containers/${node.containerId}/diagnostic`, init),
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
