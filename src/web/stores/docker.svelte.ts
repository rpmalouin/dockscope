import type {
  GraphData,
  ServiceLink,
  ServiceNode,
  DockerEvent,
  WSMessage,
  ContainerStats,
  LogChunk,
  Anomaly,
  CrashDiagnostic,
} from '../../types';
import { DOCKER } from '../lib/constants';
import { endpointId, linkKey } from '../lib/graphLinks';
import { addToast } from './toast.svelte';
export { addToast };

let graph = $state<GraphData>({ nodes: [], links: [] });
let nodeIndex = new Map<string, any>();
let events = $state<DockerEvent[]>([]);
let connected = $state(false);
let streamingLogs = $state('');
let streamingLogContainerId = $state<string | null>(null);
let composeEnabled = $state(true);
let anomalies = $state<Map<string, Anomaly>>(new Map());
let diagnostics = $state<Map<string, CrashDiagnostic>>(new Map());

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let shouldReconnect = false;
let rolloutPruneTimer: ReturnType<typeof setTimeout> | null = null;

const ROLLOUT_GHOST_TTL = 1600;

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect() {
  if (!shouldReconnect || reconnectTimer) {
    return;
  }
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, DOCKER.wsReconnectDelay);
}

function sendLogSubscription() {
  if (streamingLogContainerId && ws?.readyState === WebSocket.OPEN) {
    ws.send(
      JSON.stringify({ type: 'subscribe_logs', data: { containerId: streamingLogContainerId } }),
    );
  }
}

function normalizeLink(link: ServiceLink): ServiceLink {
  return {
    source: endpointId(link.source),
    target: endpointId(link.target),
    type: link.type,
    label: link.label,
  };
}

function isKubernetesPod(node: ServiceNode): boolean {
  return node.runtime === 'kubernetes' && node.kind === 'pod';
}

function pruneLinksToExistingNodes(links: ServiceLink[], nodeIds: Set<string>): ServiceLink[] {
  return links.filter(
    (link) => nodeIds.has(endpointId(link.source)) && nodeIds.has(endpointId(link.target)),
  );
}

function setGraphData(nodes: ServiceNode[], links: ServiceLink[]) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  graph = { nodes, links: pruneLinksToExistingNodes(links, nodeIds) };
  nodeIndex = new Map(nodes.map((node: any) => [node.id, node]));
}

function scheduleRolloutPrune() {
  if (rolloutPruneTimer) {
    clearTimeout(rolloutPruneTimer);
    rolloutPruneTimer = null;
  }

  const now = Date.now();
  const nextExpiry = Math.min(
    ...graph.nodes
      .map((node) => node.rolloutUntil)
      .filter((until): until is number => typeof until === 'number' && until > now),
  );
  if (!Number.isFinite(nextExpiry)) {
    return;
  }

  rolloutPruneTimer = setTimeout(
    () => {
      const cutoff = Date.now();
      const nodes = graph.nodes.filter((node) => !node.rolloutUntil || node.rolloutUntil > cutoff);
      setGraphData(nodes, graph.links);
      scheduleRolloutPrune();
    },
    Math.max(0, nextExpiry - now),
  );
}

function mergeGraph(incoming: GraphData) {
  const now = Date.now();
  const incomingIds = new Set(incoming.nodes.map((node) => node.id));
  const existingMap = new Map(graph.nodes.map((node) => [node.id, node]));
  const previousLinks = graph.links.map(normalizeLink);

  // Merge: preserve d3 simulation positions (x, y, z, vx, vy, vz)
  const mergedNodes = incoming.nodes.map((newNode) => {
    const existing = existingMap.get(newNode.id);
    if (existing) {
      Object.assign(existing, {
        name: newNode.name,
        fullName: newNode.fullName,
        project: newNode.project,
        runtime: newNode.runtime,
        kind: newNode.kind,
        namespace: newNode.namespace,
        containerId: newNode.containerId,
        image: newNode.image,
        status: newNode.status,
        health: newNode.health,
        ports: newNode.ports,
        networks: newNode.networks,
        volumeCount: newNode.volumeCount,
        rolloutPhase: undefined,
        rolloutUntil: undefined,
      });
      return existing;
    }
    return newNode;
  });

  const existingGhosts = graph.nodes.filter(
    (node) =>
      node.rolloutPhase === 'terminating' &&
      (node.rolloutUntil || 0) > now &&
      !incomingIds.has(node.id),
  );
  const removedPods = graph.nodes
    .filter(
      (node) =>
        isKubernetesPod(node) && node.rolloutPhase !== 'terminating' && !incomingIds.has(node.id),
    )
    .map((node) => ({
      ...node,
      status: 'removing' as const,
      health: 'starting' as const,
      rolloutPhase: 'terminating' as const,
      rolloutUntil: now + ROLLOUT_GHOST_TTL,
    }));

  const ghostNodes = [...existingGhosts, ...removedPods];
  const ghostIds = new Set(ghostNodes.map((node) => node.id));
  const ghostLinks = previousLinks.filter(
    (link) => ghostIds.has(endpointId(link.source)) || ghostIds.has(endpointId(link.target)),
  );

  const linkMap = new Map<string, ServiceLink>();
  for (const link of [...incoming.links.map(normalizeLink), ...ghostLinks]) {
    linkMap.set(linkKey(link), link);
  }

  setGraphData([...mergedNodes, ...ghostNodes], [...linkMap.values()]);
  scheduleRolloutPrune();
}

function isSocketActive(socket: WebSocket | null): boolean {
  return socket?.readyState === WebSocket.CONNECTING || socket?.readyState === WebSocket.OPEN;
}

function connect() {
  if (!shouldReconnect) {
    return;
  }
  if (isSocketActive(ws)) {
    return;
  }

  clearReconnectTimer();
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
  ws = socket;

  socket.onopen = () => {
    if (ws !== socket) {
      return;
    }
    connected = true;
    sendLogSubscription();
  };

  socket.onclose = () => {
    if (ws !== socket) {
      return;
    }
    connected = false;
    ws = null;
    scheduleReconnect();
  };

  socket.onerror = () => {
    if (ws === socket) {
      socket.close();
    }
  };

  socket.onmessage = (e) => {
    if (ws !== socket) {
      return;
    }
    try {
      const msg: WSMessage = JSON.parse(e.data);
      switch (msg.type) {
        case 'graph': {
          mergeGraph(msg.data as GraphData);
          break;
        }

        case 'stats': {
          // Mutate in-place — no reactivity trigger needed,
          // the force graph reads these on its own render loop
          const stats = msg.data as ContainerStats;
          const node = nodeIndex.get(stats.id);
          if (node) {
            node.cpu = stats.cpu;
            node.memory = stats.memory;
            node.memoryLimit = stats.memoryLimit;
            node.networkRx = stats.networkRx;
            node.networkTx = stats.networkTx;
            node.networkRxRate = stats.networkRxRate;
            node.networkTxRate = stats.networkTxRate;
          }
          break;
        }

        case 'event':
          events = [msg.data as DockerEvent, ...events].slice(0, 200);
          break;

        case 'log_chunk': {
          const chunk = msg.data as LogChunk;
          if (chunk.containerId === streamingLogContainerId) {
            streamingLogs += chunk.text;
            // Cap at ~500KB to avoid memory issues
            if (streamingLogs.length > DOCKER.logMaxBuffer) {
              streamingLogs = streamingLogs.slice(-DOCKER.logTrimTo);
            }
          }
          break;
        }

        case 'anomaly': {
          const a = msg.data as Anomaly;
          const key = `${a.containerId}:${a.metric}`;
          if (dismissedAnomalies.has(key)) {
            break;
          }
          const updated = new Map(anomalies);
          updated.set(key, a);
          anomalies = updated;
          addToast(
            `${a.containerName}: ${a.metric.toUpperCase()} spike (${Math.round(a.value)}% vs avg ${Math.round(a.average)}%)`,
            'error',
          );
          break;
        }

        case 'diagnostic':
          addDiagnostic(msg.data as CrashDiagnostic);
          break;

        case 'error':
          console.error('DockScope error:', (msg.data as { message: string }).message);
          break;
      }
    } catch {
      // ignore malformed messages
    }
  };
}

export function initDocker() {
  shouldReconnect = true;

  fetch('/api/graph')
    .then((r) => r.json())
    .then((data) => {
      mergeGraph(data);
    })
    .catch(() => {});

  fetch('/api/features')
    .then((r) => r.json())
    .then((data) => {
      composeEnabled = data.compose ?? true;
    })
    .catch(() => {});

  connect();

  return () => {
    shouldReconnect = false;
    clearReconnectTimer();
    if (ws?.readyState === WebSocket.OPEN && streamingLogContainerId) {
      ws.send(JSON.stringify({ type: 'unsubscribe_logs' }));
    }
    ws?.close();
    ws = null;
    connected = false;
    if (rolloutPruneTimer) {
      clearTimeout(rolloutPruneTimer);
      rolloutPruneTimer = null;
    }
  };
}

export function subscribeLogs(containerId: string) {
  unsubscribeLogs();
  streamingLogContainerId = containerId;
  streamingLogs = '';
  sendLogSubscription();
}

export function unsubscribeLogs() {
  if (streamingLogContainerId && ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'unsubscribe_logs' }));
  }
  streamingLogContainerId = null;
}

const dismissedDiagnostics = new Set<string>();

export function addDiagnostic(diag: CrashDiagnostic) {
  if (dismissedDiagnostics.has(diag.containerId)) {
    return;
  }
  const updated = new Map(diagnostics);
  updated.set(diag.containerId, diag);
  diagnostics = updated;
}

export function removeDiagnostic(containerId: string) {
  dismissedDiagnostics.add(containerId);
  const updated = new Map(diagnostics);
  updated.delete(containerId);
  diagnostics = updated;
}

const dismissedAnomalies = new Set<string>();

export function removeAnomaly(key: string) {
  dismissedAnomalies.add(key);
  const updated = new Map(anomalies);
  updated.delete(key);
  anomalies = updated;
}

/** Get active anomalies for a specific container */
export function getAnomaliesForContainer(containerId: string): Anomaly[] {
  const result: Anomaly[] = [];
  for (const [key, a] of anomalies) {
    if (key.startsWith(containerId + ':')) {
      result.push(a);
    }
  }
  return result;
}

export function getDockerState() {
  return {
    get graph() {
      return graph;
    },
    get events() {
      return events;
    },
    get connected() {
      return connected;
    },
    get streamingLogs() {
      return streamingLogs;
    },
    get streamingLogContainerId() {
      return streamingLogContainerId;
    },
    get composeEnabled() {
      return composeEnabled;
    },
    get anomalies() {
      return anomalies;
    },
    get diagnostics() {
      return diagnostics;
    },
  };
}
