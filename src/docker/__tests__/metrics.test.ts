import { afterEach, describe, expect, it, vi } from 'vitest';
import type Dockerode from 'dockerode';
import { getContainerStats } from '../metrics';

const MiB = 1024 * 1024;

function makeStats(overrides: Record<string, unknown> = {}) {
  return {
    cpu_stats: {
      cpu_usage: { total_usage: 5000 },
      system_cpu_usage: 100000,
      online_cpus: 4,
    },
    precpu_stats: {
      cpu_usage: { total_usage: 1000 },
      system_cpu_usage: 90000,
    },
    memory_stats: {
      usage: 200 * MiB,
      limit: 512 * MiB,
      stats: { inactive_file: 50 * MiB },
    },
    networks: {
      eth0: { rx_bytes: 1000, tx_bytes: 2000 },
    },
    ...overrides,
  };
}

function makeDocker(stats: unknown) {
  const statsMock = vi.fn().mockResolvedValue(stats);
  const getContainer = vi.fn(() => ({ stats: statsMock }));
  return { docker: { getContainer }, getContainer, statsMock };
}

function asDocker(docker: ReturnType<typeof makeDocker>['docker']): Dockerode {
  return docker as unknown as Dockerode;
}

describe('getContainerStats', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('calculates Docker CPU percentage with the online CPU multiplier', async () => {
    const { docker } = makeDocker(makeStats());

    const stats = await getContainerStats(asDocker(docker), 'abcdef1234567890');

    expect(stats.cpu).toBe(160);
  });

  it('falls back to per-cpu usage length when online CPU count is absent', async () => {
    const { docker } = makeDocker(
      makeStats({
        cpu_stats: {
          cpu_usage: { total_usage: 2000, percpu_usage: [500, 500] },
          system_cpu_usage: 11000,
        },
        precpu_stats: {
          cpu_usage: { total_usage: 1000 },
          system_cpu_usage: 10000,
        },
      }),
    );

    const stats = await getContainerStats(asDocker(docker), 'bcdef1234567890a');

    expect(stats.cpu).toBe(200);
  });

  it('subtracts cgroup v2 inactive file memory from usage', async () => {
    const { docker } = makeDocker(
      makeStats({
        memory_stats: {
          usage: 200 * MiB,
          limit: 512 * MiB,
          stats: {
            inactive_file: 50 * MiB,
            cache: 90 * MiB,
          },
        },
      }),
    );

    const stats = await getContainerStats(asDocker(docker), 'cdef1234567890ab');

    expect(stats.memory).toBe(150 * MiB);
    expect(stats.memoryLimit).toBe(512 * MiB);
  });

  it('prefers cgroup v1 total inactive file memory when present', async () => {
    const { docker } = makeDocker(
      makeStats({
        memory_stats: {
          usage: 200 * MiB,
          limit: 512 * MiB,
          stats: {
            inactive_file: 50 * MiB,
            total_inactive_file: 70 * MiB,
            cache: 90 * MiB,
          },
        },
      }),
    );

    const stats = await getContainerStats(asDocker(docker), 'def1234567890abc');

    expect(stats.memory).toBe(130 * MiB);
  });

  it('treats huge Docker memory limit sentinels as unbounded', async () => {
    const { docker } = makeDocker(
      makeStats({
        memory_stats: {
          usage: 200 * MiB,
          limit: Number.MAX_SAFE_INTEGER,
          stats: { inactive_file: 50 * MiB },
        },
      }),
    );

    const stats = await getContainerStats(asDocker(docker), 'ef1234567890abcd');

    expect(stats.memory).toBe(150 * MiB);
    expect(stats.memoryLimit).toBe(0);
  });

  it('computes network rates from consecutive samples', async () => {
    vi.useFakeTimers();
    const statsMock = vi
      .fn()
      .mockResolvedValueOnce(makeStats({ networks: { eth0: { rx_bytes: 1000, tx_bytes: 2000 } } }))
      .mockResolvedValueOnce(makeStats({ networks: { eth0: { rx_bytes: 2500, tx_bytes: 5000 } } }));
    const docker = { getContainer: vi.fn(() => ({ stats: statsMock })) };
    const id = 'f1234567890abcde';

    vi.setSystemTime(1000);
    const first = await getContainerStats(docker as unknown as Dockerode, id);
    vi.setSystemTime(4000);
    const second = await getContainerStats(docker as unknown as Dockerode, id);

    expect(first.networkRxRate).toBe(0);
    expect(first.networkTxRate).toBe(0);
    expect(second.networkRxRate).toBe(500);
    expect(second.networkTxRate).toBe(1000);
  });

  it('keeps network rates separate by custom rate key', async () => {
    vi.useFakeTimers();
    const statsMock = vi
      .fn()
      .mockResolvedValueOnce(makeStats({ networks: { eth0: { rx_bytes: 1000, tx_bytes: 2000 } } }))
      .mockResolvedValueOnce(makeStats({ networks: { eth0: { rx_bytes: 2500, tx_bytes: 5000 } } }));
    const docker = { getContainer: vi.fn(() => ({ stats: statsMock })) };
    const id = 'a1234567890abcde';

    vi.setSystemTime(1000);
    await getContainerStats(docker as unknown as Dockerode, id, 'host-a:a1234567890a');
    vi.setSystemTime(4000);
    const stats = await getContainerStats(
      docker as unknown as Dockerode,
      id,
      'host-b:a1234567890a',
    );

    expect(stats.networkRxRate).toBe(0);
    expect(stats.networkTxRate).toBe(0);
  });
});
