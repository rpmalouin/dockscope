import { describe, expect, it } from 'vitest';
import type { GraphData, ServiceLink, ServiceNode } from '../../../types';
import {
  buildScopeOptions,
  computeImpactNodeIds,
  findSearchMatches,
  hasBrokenDependency,
  isLinkVisible,
  isNodeVisible,
  type GraphFilters,
  type StatusFilter,
} from '../graphFilters';

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

function filters(overrides: Partial<GraphFilters> = {}): GraphFilters {
  return {
    searchQuery: '',
    statusFilter: new Set<StatusFilter>(),
    scopeFilter: '',
    ...overrides,
  };
}

describe('graph filters', () => {
  it('builds sorted scope options grouped by runtime scope', () => {
    const nodes = [
      makeNode({ id: 'web', project: 'shop' }),
      makeNode({ id: 'worker', project: 'alpha' }),
      makeNode({ id: 'standalone-a', project: '', host: 'remote' }),
      makeNode({ id: 'standalone-b', project: '', host: '' }),
      makeNode({ id: 'pod-b', runtime: 'kubernetes', namespace: 'beta', kind: 'pod' }),
      makeNode({ id: 'pod-a', runtime: 'kubernetes', namespace: 'alpha', kind: 'pod' }),
    ];

    expect(buildScopeOptions(nodes)).toEqual([
      { value: 'docker-project:alpha', label: 'Docker / alpha' },
      { value: 'docker-project:shop', label: 'Docker / shop' },
      { value: 'docker-host:local', label: 'Docker / local' },
      { value: 'docker-host:remote', label: 'Docker / remote' },
      { value: 'kubernetes:alpha', label: 'Kubernetes / alpha' },
      { value: 'kubernetes:beta', label: 'Kubernetes / beta' },
    ]);
  });

  it('matches nodes by scope, status, and search text', () => {
    const api = makeNode({
      id: 'api',
      fullName: 'shop_api_1',
      project: 'shop',
      image: 'ghcr.io/example/api:latest',
      status: 'running',
      health: 'healthy',
    });
    const db = makeNode({
      id: 'db',
      project: 'shop',
      status: 'exited',
      image: 'postgres:16',
    });
    const pod = makeNode({
      id: 'pod',
      runtime: 'kubernetes',
      kind: 'pod',
      namespace: 'payments',
      status: 'running',
      health: 'unhealthy',
    });

    expect(
      isNodeVisible(api, filters({ scopeFilter: 'docker-project:shop', searchQuery: 'API' })),
    ).toBe(true);
    expect(isNodeVisible(db, filters({ statusFilter: new Set(['running']) }))).toBe(false);
    expect(isNodeVisible(db, filters({ statusFilter: new Set(['stopped']) }))).toBe(true);
    expect(isNodeVisible(pod, filters({ statusFilter: new Set(['unhealthy']) }))).toBe(true);
    expect(isNodeVisible(pod, filters({ scopeFilter: 'kubernetes:default' }))).toBe(false);
  });

  it('finds search matches across labels and trims empty searches', () => {
    const nodes = [
      makeNode({ id: 'api', fullName: 'shop_api_1', image: 'ghcr.io/example/api:latest' }),
      makeNode({ id: 'pod', runtime: 'kubernetes', kind: 'pod', namespace: 'payments' }),
    ];

    expect(findSearchMatches(nodes, '  ')).toEqual([]);
    expect(findSearchMatches(nodes, 'PAY')).toEqual([nodes[1]]);
  });

  it('hides links when either materialized endpoint is filtered out', () => {
    const api = makeNode({ id: 'api' });
    const db = makeNode({ id: 'db' });
    const link = { source: api, target: db, type: 'depends_on' } as unknown as ServiceLink;

    expect(isLinkVisible(link, filters({ searchQuery: 'api' }))).toBe(false);
    expect(
      isLinkVisible(
        { source: 'api', target: 'db', type: 'depends_on' },
        filters({ searchQuery: 'api' }),
      ),
    ).toBe(true);
  });

  it('walks depends_on links upstream for impact mode', () => {
    const links: ServiceLink[] = [
      { source: 'web', target: 'api', type: 'depends_on' },
      { source: 'api', target: 'db', type: 'depends_on' },
      { source: 'metrics', target: 'db', type: 'network' },
    ];

    expect(computeImpactNodeIds('db', links)).toEqual(new Set(['db', 'api', 'web']));
    expect(computeImpactNodeIds('api', links)).toEqual(new Set(['api', 'web']));
  });

  it('detects broken dependencies from stopped or unhealthy targets', () => {
    const graph: GraphData = {
      nodes: [
        makeNode({ id: 'api', status: 'running', health: 'healthy' }),
        makeNode({ id: 'db', status: 'exited' }),
        makeNode({ id: 'cache', status: 'running', health: 'unhealthy' }),
      ],
      links: [
        { source: 'api', target: 'db', type: 'depends_on' },
        { source: 'db', target: 'cache', type: 'network' },
      ],
    };

    expect(hasBrokenDependency('api', graph)).toBe(true);
    expect(hasBrokenDependency('db', graph)).toBe(false);
  });
});
