import { describe, expect, it } from 'vitest';
import type { GraphData, ServiceLink, ServiceNode } from '../../../types';
import {
  ROLLOUT_GHOST_TTL,
  mergeGraphData,
  nextRolloutExpiry,
  normalizeLink,
  pruneExpiredRollouts,
  pruneLinksToExistingNodes,
} from '../graphMerge';

const NOW = 1_000_000;

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

function makePod(overrides: Partial<ServiceNode> & { id: string }): ServiceNode {
  return makeNode({ runtime: 'kubernetes', kind: 'pod', ...overrides });
}

function graphOf(nodes: ServiceNode[], links: ServiceLink[] = []): GraphData {
  return { nodes, links };
}

describe('mergeGraphData', () => {
  it('keeps the existing node object identity so simulation positions survive', () => {
    const existing = makeNode({ id: 'a' }) as any;
    existing.x = 42;
    existing.y = -7;

    const merged = mergeGraphData(
      graphOf([existing]),
      graphOf([makeNode({ id: 'a', status: 'exited' })]),
      NOW,
    );

    expect(merged.nodes[0]).toBe(existing);
    expect(merged.nodes[0].status).toBe('exited');
    expect((merged.nodes[0] as any).x).toBe(42);
  });

  it('adds new nodes and drops docker nodes missing from the incoming graph', () => {
    const merged = mergeGraphData(
      graphOf([makeNode({ id: 'gone' })]),
      graphOf([makeNode({ id: 'fresh' })]),
      NOW,
    );

    expect(merged.nodes.map((n) => n.id)).toEqual(['fresh']);
  });

  it('clears rollout markers on nodes that reappear', () => {
    const existing = makeNode({
      id: 'a',
      rolloutPhase: 'terminating',
      rolloutUntil: NOW + 500,
    });

    const merged = mergeGraphData(graphOf([existing]), graphOf([makeNode({ id: 'a' })]), NOW);

    expect(merged.nodes[0].rolloutPhase).toBeUndefined();
    expect(merged.nodes[0].rolloutUntil).toBeUndefined();
  });

  it('turns a removed kubernetes pod into a terminating ghost with a TTL', () => {
    const merged = mergeGraphData(graphOf([makePod({ id: 'pod-1' })]), graphOf([]), NOW);

    expect(merged.nodes).toHaveLength(1);
    const ghost = merged.nodes[0];
    expect(ghost.status).toBe('removing');
    expect(ghost.rolloutPhase).toBe('terminating');
    expect(ghost.rolloutUntil).toBe(NOW + ROLLOUT_GHOST_TTL);
  });

  it('does not ghost removed docker containers', () => {
    const merged = mergeGraphData(graphOf([makeNode({ id: 'plain' })]), graphOf([]), NOW);
    expect(merged.nodes).toHaveLength(0);
  });

  it('keeps live ghosts and drops expired ones', () => {
    const live = makePod({ id: 'live', rolloutPhase: 'terminating', rolloutUntil: NOW + 100 });
    const expired = makePod({ id: 'old', rolloutPhase: 'terminating', rolloutUntil: NOW - 100 });

    const merged = mergeGraphData(graphOf([live, expired]), graphOf([]), NOW);

    expect(merged.nodes.map((n) => n.id)).toEqual(['live']);
  });

  it('retains links touching ghost nodes', () => {
    const pod = makePod({ id: 'pod-1' });
    const svc = makeNode({ id: 'svc' });
    const merged = mergeGraphData(
      graphOf([pod, svc], [{ source: 'svc', target: 'pod-1', type: 'kubernetes' }]),
      graphOf([svc]),
      NOW,
    );

    expect(merged.links).toEqual([{ source: 'svc', target: 'pod-1', type: 'kubernetes' }]);
  });

  it('normalizes d3 object endpoints back to IDs and dedupes links', () => {
    const a = makeNode({ id: 'a' });
    const b = makeNode({ id: 'b' });
    const merged = mergeGraphData(
      graphOf([a, b]),
      graphOf(
        [a, b],
        [
          { source: { id: 'a' } as any, target: { id: 'b' } as any, type: 'network', label: 'net' },
          { source: 'a', target: 'b', type: 'network', label: 'net' },
        ],
      ),
      NOW,
    );

    expect(merged.links).toEqual([{ source: 'a', target: 'b', type: 'network', label: 'net' }]);
  });
});

describe('rollout expiry helpers', () => {
  it('nextRolloutExpiry returns the earliest future expiry', () => {
    const nodes = [
      makePod({ id: 'a', rolloutUntil: NOW + 300 }),
      makePod({ id: 'b', rolloutUntil: NOW + 100 }),
      makePod({ id: 'c', rolloutUntil: NOW - 50 }),
    ];
    expect(nextRolloutExpiry(nodes, NOW)).toBe(NOW + 100);
  });

  it('nextRolloutExpiry returns null when nothing is pending', () => {
    expect(nextRolloutExpiry([makeNode({ id: 'a' })], NOW)).toBeNull();
    expect(nextRolloutExpiry([], NOW)).toBeNull();
  });

  it('pruneExpiredRollouts keeps normal nodes and live ghosts only', () => {
    const nodes = [
      makeNode({ id: 'plain' }),
      makePod({ id: 'live', rolloutUntil: NOW + 100 }),
      makePod({ id: 'dead', rolloutUntil: NOW }),
    ];
    expect(pruneExpiredRollouts(nodes, NOW).map((n) => n.id)).toEqual(['plain', 'live']);
  });
});

describe('link helpers', () => {
  it('normalizeLink resolves object endpoints', () => {
    expect(normalizeLink({ source: { id: 'x' } as any, target: 'y', type: 'depends_on' })).toEqual({
      source: 'x',
      target: 'y',
      type: 'depends_on',
      label: undefined,
    });
  });

  it('pruneLinksToExistingNodes drops links with missing endpoints', () => {
    const links: ServiceLink[] = [
      { source: 'a', target: 'b', type: 'network' },
      { source: 'a', target: 'ghost', type: 'network' },
    ];
    expect(pruneLinksToExistingNodes(links, new Set(['a', 'b']))).toEqual([links[0]]);
  });
});
