import { describe, expect, it } from 'vitest';
import type { GraphData, ServiceLink, ServiceNode } from '../../../types';
import { captureGraphSnapshot, diffGraphSnapshot, linkKey } from '../graphReconcile';

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

function makeGraph(nodes: ServiceNode[], links: ServiceLink[] = []): GraphData {
  return { nodes, links };
}

describe('graph reconciliation', () => {
  it('does not request a graph data update for an unchanged snapshot', () => {
    const graph = makeGraph([makeNode({ id: 'a' })]);
    const diff = diffGraphSnapshot(captureGraphSnapshot(graph), graph);

    expect(diff.needsGraphDataUpdate).toBe(false);
    expect(diff.visualChangedNodeIds.size).toBe(0);
  });

  it('detects status-only changes without structural refresh', () => {
    const previous = captureGraphSnapshot(makeGraph([makeNode({ id: 'a' })]));
    const diff = diffGraphSnapshot(previous, makeGraph([makeNode({ id: 'a', status: 'exited' })]));

    expect(diff.needsGraphDataUpdate).toBe(false);
    expect(diff.structureChanged).toBe(false);
    expect(diff.statusChangedNodeIds).toEqual(new Set(['a']));
    expect(diff.visualChangedNodeIds).toEqual(new Set(['a']));
  });

  it('requests a graph data update when a node is added', () => {
    const previous = captureGraphSnapshot(makeGraph([makeNode({ id: 'a' })]));
    const diff = diffGraphSnapshot(
      previous,
      makeGraph([makeNode({ id: 'a' }), makeNode({ id: 'b' })]),
    );

    expect(diff.needsGraphDataUpdate).toBe(true);
    expect(diff.structureChanged).toBe(true);
    expect(diff.addedNodeIds).toEqual(new Set(['b']));
  });

  it('requests a graph data update when a node is removed', () => {
    const previous = captureGraphSnapshot(
      makeGraph([makeNode({ id: 'a' }), makeNode({ id: 'b' })]),
    );
    const diff = diffGraphSnapshot(previous, makeGraph([makeNode({ id: 'a' })]));

    expect(diff.needsGraphDataUpdate).toBe(true);
    expect(diff.structureChanged).toBe(true);
    expect(diff.removedNodeIds).toEqual(new Set(['b']));
  });

  it('requests a graph data update when links change', () => {
    const previous = captureGraphSnapshot(
      makeGraph([makeNode({ id: 'a' }), makeNode({ id: 'b' })]),
    );
    const diff = diffGraphSnapshot(
      previous,
      makeGraph(
        [makeNode({ id: 'a' }), makeNode({ id: 'b' })],
        [{ source: 'a', target: 'b', type: 'depends_on' }],
      ),
    );

    expect(diff.needsGraphDataUpdate).toBe(true);
    expect(diff.structureChanged).toBe(false);
    expect(diff.linksChanged).toBe(true);
  });

  it('normalizes object and string link endpoints to the same key', () => {
    const objectLink = {
      source: { id: 'a' },
      target: { id: 'b' },
      type: 'network',
      label: 'frontend',
    } as unknown as ServiceLink;

    expect(linkKey(objectLink)).toBe(
      linkKey({ source: 'a', target: 'b', type: 'network', label: 'frontend' }),
    );
  });
});
