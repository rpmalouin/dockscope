import { diagnoseCrash, watchEvents } from '../docker/client.js';
import { getContainerStats } from '../docker/metrics.js';
import { buildMultiHostGraph, getHost, refreshHostStatus } from '../docker/hosts.js';
import type { DockerEvent, GraphData, ServiceNode, WSMessage } from '../types.js';
import { shortId } from '../utils.js';
import { checkAnomaly } from './anomaly.js';

interface MonitorOptions {
  metricHistory: Map<string, { cpu: number; memory: number; time: number }[]>;
  broadcast(msg: WSMessage): void;
}

export interface ServerMonitor {
  getGraph(): GraphData;
  start(): Promise<void>;
  stop(): void;
}

const GRAPH_REFRESH_ACTIONS = ['start', 'stop', 'die', 'destroy', 'create', 'pause', 'unpause'];
const STATS_CONCURRENCY = 8;
const STATS_TIMEOUT_MS = 2500;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout>;
  const timer = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error('Stats timed out')), ms);
  });
  return Promise.race([promise, timer]).finally(() => clearTimeout(timeout));
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index++];
      await worker(item);
    }
  });
  await Promise.all(workers);
}

export function createServerMonitor(opts: MonitorOptions): ServerMonitor {
  let cachedGraph: GraphData = { nodes: [], links: [] };
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let statsInterval: ReturnType<typeof setInterval> | null = null;
  let graphInterval: ReturnType<typeof setInterval> | null = null;
  let hostStatusInterval: ReturnType<typeof setInterval> | null = null;
  let stopWatching: (() => void) | null = null;
  let statsRefreshInFlight = false;
  const activeAnomalies = new Map<string, Set<string>>();

  const refreshGraph = async () => {
    try {
      cachedGraph = await buildMultiHostGraph();
      opts.broadcast({ type: 'graph', data: cachedGraph });
      const activeIds = new Set(cachedGraph.nodes.map((n) => n.id));
      for (const id of opts.metricHistory.keys()) {
        if (!activeIds.has(id)) {
          opts.metricHistory.delete(id);
          activeAnomalies.delete(id);
        }
      }
    } catch {
      /* Docker may be temporarily unavailable */
    }
  };

  function detectAndBroadcastAnomaly(
    containerId: string,
    name: string,
    metric: 'cpu' | 'memory',
    value: number,
    history: number[],
  ) {
    const result = checkAnomaly(metric, value, history);
    if (result) {
      if (!activeAnomalies.has(containerId)) {
        activeAnomalies.set(containerId, new Set());
      }
      const active = activeAnomalies.get(containerId)!;
      if (active.has(metric)) {
        return;
      }
      active.add(metric);
      opts.broadcast({
        type: 'anomaly',
        data: {
          containerId,
          containerName: name,
          metric,
          value,
          average: result.median,
          threshold: result.threshold,
          time: Date.now(),
        },
      });
    } else {
      activeAnomalies.get(containerId)?.delete(metric);
    }
  }

  const refreshStats = async () => {
    if (statsRefreshInFlight) {
      return;
    }

    statsRefreshInFlight = true;
    try {
      const nodes = cachedGraph.nodes.filter(
        (node) => node.runtime !== 'kubernetes' && node.status === 'running',
      );
      await runWithConcurrency(nodes, STATS_CONCURRENCY, async (node) => {
        try {
          const host = getHost(node.host || 'local');
          if (!host || !host.connected) {
            return;
          }
          const stats = await withTimeout(
            getContainerStats(host.client, node.containerId, node.id),
            STATS_TIMEOUT_MS,
          );
          const nodeStats = { ...stats, id: node.id };
          opts.broadcast({ type: 'stats', data: nodeStats });

          if (!opts.metricHistory.has(node.id)) {
            opts.metricHistory.set(node.id, []);
          }
          const history = opts.metricHistory.get(node.id)!;
          history.push({ cpu: stats.cpu, memory: stats.memory, time: Date.now() });
          if (history.length > 100) {
            history.splice(0, history.length - 100);
          }

          detectAndBroadcastAnomaly(
            node.id,
            node.name,
            'cpu',
            stats.cpu,
            history.map((h) => h.cpu),
          );

          const hasMemLimit = stats.memoryLimit > 0;
          if (hasMemLimit) {
            const memPct = (stats.memory / stats.memoryLimit) * 100;
            detectAndBroadcastAnomaly(
              node.id,
              node.name,
              'memory',
              memPct,
              history.map((h) => (h.memory / stats.memoryLimit) * 100),
            );
          }
        } catch {
          /* Container may have stopped */
        }
      });
    } finally {
      statsRefreshInFlight = false;
    }
  };

  function findDockerNode(eventContainerId: string): ServiceNode | undefined {
    const sid = shortId(eventContainerId);
    const candidates = cachedGraph.nodes.filter(
      (node) =>
        node.runtime !== 'kubernetes' &&
        (node.containerId === eventContainerId || shortId(node.containerId) === sid),
    );
    return candidates.find((node) => node.host === 'local') || candidates[0];
  }

  function debouncedRefreshGraph() {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
    }
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      refreshGraph();
    }, 500);
  }

  const handleDockerEvent = (event: DockerEvent) => {
    opts.broadcast({ type: 'event', data: event });
    if (GRAPH_REFRESH_ACTIONS.includes(event.action)) {
      debouncedRefreshGraph();
    }
    if (event.action === 'die') {
      const node = findDockerNode(event.id);
      diagnoseCrash(event.id).then((diag) => {
        if (diag) {
          opts.broadcast({
            type: 'diagnostic',
            data: { ...diag, containerId: node?.id || diag.containerId },
          });
        }
      });
    }
  };

  return {
    getGraph: () => cachedGraph,
    async start() {
      stopWatching = watchEvents(handleDockerEvent, (err) =>
        console.error('Docker event stream error:', err.message),
      );
      await refreshGraph();
      statsInterval = setInterval(refreshStats, 3000);
      graphInterval = setInterval(refreshGraph, 10000);
      hostStatusInterval = setInterval(() => refreshHostStatus().catch(() => {}), 10000);
      refreshHostStatus().catch(() => {});
    },
    stop() {
      if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = null;
      }
      if (statsInterval) {
        clearInterval(statsInterval);
      }
      if (graphInterval) {
        clearInterval(graphInterval);
      }
      if (hostStatusInterval) {
        clearInterval(hostStatusInterval);
      }
      stopWatching?.();
    },
  };
}
