import { describe, expect, it } from 'vitest';
import type { ServiceNode } from '../../../types';
import { nodeSelectionKey, resolveSelectedNode } from '../graphSelection';

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

describe('graph selection', () => {
  it('keeps exact selected node matches by id', () => {
    const selected = makeNode({ id: 'old', fullName: 'shop-api-1' });
    const exact = makeNode({ id: 'old', fullName: 'shop-api-1', status: 'restarting' });
    const replacement = makeNode({ id: 'new', fullName: 'shop-api-1' });

    expect(resolveSelectedNode([replacement, exact], selected)).toBe(exact);
  });

  it('follows recreated Docker containers by stable identity', () => {
    const selected = makeNode({
      id: 'old',
      containerId: 'old-full-id',
      project: 'shop',
      fullName: 'shop-api-1',
    });
    const replacement = makeNode({
      id: 'new',
      containerId: 'new-full-id',
      project: 'shop',
      fullName: 'shop-api-1',
    });

    expect(resolveSelectedNode([replacement], selected)).toBe(replacement);
  });

  it('uses full container names to avoid collapsing scaled services', () => {
    const first = makeNode({ id: 'one', name: 'api', fullName: 'shop-api-1', project: 'shop' });
    const second = makeNode({ id: 'two', name: 'api', fullName: 'shop-api-2', project: 'shop' });

    expect(nodeSelectionKey(first)).not.toBe(nodeSelectionKey(second));
  });

  it('falls back to the previous selection when no current node matches', () => {
    const selected = makeNode({ id: 'old', fullName: 'shop-api-1' });

    expect(resolveSelectedNode([makeNode({ id: 'other' })], selected)).toBe(selected);
  });

  it('keys Kubernetes resources by kind, namespace, and name', () => {
    const pod = makeNode({
      id: 'k8s:pod:prod:api-123',
      runtime: 'kubernetes',
      kind: 'pod',
      namespace: 'prod',
      name: 'api-123',
    });

    expect(nodeSelectionKey(pod)).toBe('kubernetes:pod:prod:api-123');
  });
});
