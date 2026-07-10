import Dockerode from 'dockerode';
import type { ContainerStats } from '../types.js';
import { shortId } from '../utils.js';

const prevNetStats = new Map<string, { rx: number; tx: number; time: number }>();
const MAX_REASONABLE_MEMORY_LIMIT = 1024 ** 5; // 1 PiB; Docker may report huge sentinels for "unlimited".

function statNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function getOnlineCpuCount(stats: any): number {
  const onlineCpus = statNumber(stats.cpu_stats?.online_cpus);
  if (onlineCpus > 0) {
    return onlineCpus;
  }

  const perCpuUsage = stats.cpu_stats?.cpu_usage?.percpu_usage;
  return Array.isArray(perCpuUsage) && perCpuUsage.length > 0 ? perCpuUsage.length : 1;
}

function getCpuPercent(stats: any): number {
  const cpuDelta =
    statNumber(stats.cpu_stats?.cpu_usage?.total_usage) -
    statNumber(stats.precpu_stats?.cpu_usage?.total_usage);
  const systemDelta =
    statNumber(stats.cpu_stats?.system_cpu_usage) -
    statNumber(stats.precpu_stats?.system_cpu_usage);

  if (cpuDelta <= 0 || systemDelta <= 0) {
    return 0;
  }

  return (cpuDelta / systemDelta) * getOnlineCpuCount(stats) * 100;
}

function getMemoryCache(stats: any): number {
  const memStats = stats.memory_stats?.stats || {};
  for (const key of ['total_inactive_file', 'inactive_file', 'cache']) {
    const value = statNumber(memStats[key]);
    if (value > 0) {
      return value;
    }
  }
  return 0;
}

function getMemoryUsage(stats: any): number {
  const usage = statNumber(stats.memory_stats?.usage);
  return Math.max(0, usage - Math.min(getMemoryCache(stats), usage));
}

function getMemoryLimit(stats: any): number {
  const limit = statNumber(stats.memory_stats?.limit);
  if (limit <= 0 || limit >= MAX_REASONABLE_MEMORY_LIMIT) {
    return 0;
  }
  return limit;
}

export async function getContainerStats(
  docker: Dockerode,
  containerId: string,
  rateKey = shortId(containerId),
): Promise<ContainerStats> {
  const container = docker.getContainer(containerId);
  const stats = await container.stats({ stream: false });

  const cpu = getCpuPercent(stats);
  const memUsage = getMemoryUsage(stats);
  const memLimit = getMemoryLimit(stats);

  let networkRx = 0;
  let networkTx = 0;
  if (stats.networks) {
    for (const iface of Object.values(stats.networks) as any[]) {
      networkRx += iface.rx_bytes || 0;
      networkTx += iface.tx_bytes || 0;
    }
  }

  const sid = shortId(containerId);
  const now = Date.now();
  const prev = prevNetStats.get(rateKey);
  let networkRxRate = 0;
  let networkTxRate = 0;
  if (prev) {
    const elapsed = (now - prev.time) / 1000;
    if (elapsed > 0) {
      networkRxRate = Math.max(0, (networkRx - prev.rx) / elapsed);
      networkTxRate = Math.max(0, (networkTx - prev.tx) / elapsed);
    }
  }
  prevNetStats.set(rateKey, { rx: networkRx, tx: networkTx, time: now });

  return {
    id: sid,
    cpu: Math.round(cpu * 100) / 100,
    memory: memUsage,
    memoryLimit: memLimit,
    networkRx,
    networkTx,
    networkRxRate: Math.round(networkRxRate),
    networkTxRate: Math.round(networkTxRate),
  };
}
