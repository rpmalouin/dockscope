import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ServiceNode } from '../../../types';
import {
  containerActionPastTense,
  getHpaReplicaRange,
  kubernetesActionPastTense,
  loadDockerSidebarData,
  removeContainer,
  runContainerAction,
  runKubernetesAction,
  containerApiUrl,
} from '../sidebarApi';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function makeNode(overrides: Partial<ServiceNode> & { id: string }): ServiceNode {
  return {
    name: overrides.id,
    fullName: overrides.id,
    project: '',
    host: 'local',
    containerId: overrides.id,
    image: 'test:latest',
    status: 'running',
    health: 'none',
    ports: [],
    networks: [],
    volumeCount: 0,
    cpu: 0,
    memory: 0,
    memoryLimit: 0,
    networkRx: 0,
    networkTx: 0,
    networkRxRate: 0,
    networkTxRate: 0,
    ...overrides,
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('sidebar API helpers', () => {
  it('parses HPA replica ranges with safe defaults', () => {
    expect(getHpaReplicaRange(makeNode({ id: 'hpa', ports: ['2-5 range'] }))).toEqual({
      min: 2,
      max: 5,
    });
    expect(getHpaReplicaRange(makeNode({ id: 'hpa', ports: [] }))).toEqual({ min: 1, max: 1 });
  });

  it('formats action success labels', () => {
    expect(containerActionPastTense('pause')).toBe('paused');
    expect(containerActionPastTense('restart')).toBe('restarted');
    expect(kubernetesActionPastTense('set_hpa_constraints')).toBe('updated');
  });

  it('uses sidebar action endpoints', async () => {
    const node = makeNode({ id: 'abc', runtime: 'kubernetes', kind: 'pod' });
    globalThis.fetch = vi.fn(async () => jsonResponse({ ok: true })) as typeof fetch;

    await runContainerAction('abc', 'restart');
    await removeContainer('abc', true);
    await runKubernetesAction(node, 'set_hpa_constraints', { minReplicas: 2, maxReplicas: 4 });

    expect(vi.mocked(globalThis.fetch).mock.calls.map(([url]) => url)).toEqual([
      '/api/containers/abc/restart',
      '/api/containers/abc?volumes=true',
      '/api/kubernetes/action',
    ]);
    expect(vi.mocked(globalThis.fetch).mock.calls[2][1]?.body).toBe(
      JSON.stringify({
        id: 'abc',
        action: 'set_hpa_constraints',
        minReplicas: 2,
        maxReplicas: 4,
      }),
    );
  });

  it('adds host and node context for node-scoped container URLs', () => {
    const node = makeNode({
      id: 'remote-a:abcdef123456',
      host: 'remote-a',
      containerId: 'abcdef1234567890',
    });

    expect(containerApiUrl(node, '/stats')).toBe(
      '/api/containers/abcdef1234567890/stats?host=remote-a&nodeId=remote-a%3Aabcdef123456',
    );
    expect(containerApiUrl(node, '', { volumes: true })).toBe(
      '/api/containers/abcdef1234567890?host=remote-a&nodeId=remote-a%3Aabcdef123456&volumes=true',
    );
  });

  it('loads running container sidebar data without fetching diagnostics', async () => {
    const node = makeNode({ id: 'abcdef123456', status: 'running' });
    globalThis.fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.includes('/stats?')) {
        return jsonResponse({ id: node.id, cpu: 12 });
      }
      if (url.includes('/history?')) {
        return jsonResponse([{ cpu: 12, memory: 20, time: 100 }]);
      }
      if (url.includes('/inspect?')) {
        return jsonResponse({ id: node.id, env: [] });
      }
      throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;

    const data = await loadDockerSidebarData(node, { loadDiagnostic: true });

    expect(data.stats?.cpu).toBe(12);
    expect(data.history).toHaveLength(1);
    expect(data.inspect?.id).toBe(node.id);
    expect(data.diagnostic).toBeNull();
    expect(
      vi.mocked(globalThis.fetch).mock.calls.some(([url]) => String(url).includes('/diagnostic')),
    ).toBe(false);
  });

  it('loads stopped container diagnostics only when requested', async () => {
    const node = makeNode({ id: 'abcdef123456', status: 'exited' });
    globalThis.fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.includes('/inspect?')) {
        return jsonResponse({ id: node.id, env: [] });
      }
      if (url.includes('/diagnostic?')) {
        return jsonResponse({ containerId: node.id, cause: 'Exited' });
      }
      throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;

    const data = await loadDockerSidebarData(node, { loadDiagnostic: true });

    expect(data.stats).toBeNull();
    expect(data.history).toEqual([]);
    expect(data.diagnostic?.containerId).toBe(node.id);
  });

  it('propagates aborts so callers can ignore stale loads', async () => {
    const abort = new DOMException('aborted', 'AbortError');
    globalThis.fetch = vi.fn(async () => {
      throw abort;
    }) as typeof fetch;

    await expect(
      loadDockerSidebarData(makeNode({ id: 'abcdef123456' }), { loadDiagnostic: true }),
    ).rejects.toBe(abort);
  });
});
