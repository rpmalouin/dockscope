import type { GraphData, ServiceNode } from '../../types';
import { linkKey as getLinkKey } from './graphLinks';
export { endpointId, linkKey } from './graphLinks';

export interface GraphSnapshot {
  nodeIds: Set<string>;
  statusById: Map<string, string>;
  visualById: Map<string, string>;
  linkKeys: Set<string>;
}

export interface GraphDiff {
  addedNodeIds: Set<string>;
  removedNodeIds: Set<string>;
  statusChangedNodeIds: Set<string>;
  visualChangedNodeIds: Set<string>;
  linksChanged: boolean;
  structureChanged: boolean;
  needsGraphDataUpdate: boolean;
}

export function statusKey(node: ServiceNode): string {
  return `${node.status}:${node.health}`;
}

export function visualKey(node: ServiceNode): string {
  return JSON.stringify({
    name: node.name,
    fullName: node.fullName,
    project: node.project,
    host: node.host,
    runtime: node.runtime,
    kind: node.kind,
    namespace: node.namespace,
    image: node.image,
    status: node.status,
    health: node.health,
    ports: node.ports,
    networks: node.networks,
    volumeCount: node.volumeCount,
    rolloutPhase: node.rolloutPhase,
    rolloutUntil: node.rolloutUntil,
  });
}

export function captureGraphSnapshot(graph: GraphData): GraphSnapshot {
  return {
    nodeIds: new Set(graph.nodes.map((node) => node.id)),
    statusById: new Map(graph.nodes.map((node) => [node.id, statusKey(node)])),
    visualById: new Map(graph.nodes.map((node) => [node.id, visualKey(node)])),
    linkKeys: new Set(graph.links.map(getLinkKey)),
  };
}

function hasSetChanged<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) {
    return true;
  }
  for (const item of a) {
    if (!b.has(item)) {
      return true;
    }
  }
  return false;
}

export function diffGraphSnapshot(previous: GraphSnapshot | null, graph: GraphData): GraphDiff {
  const current = captureGraphSnapshot(graph);
  const addedNodeIds = new Set<string>();
  const removedNodeIds = new Set<string>();
  const statusChangedNodeIds = new Set<string>();
  const visualChangedNodeIds = new Set<string>();

  if (!previous) {
    return {
      addedNodeIds: new Set(current.nodeIds),
      removedNodeIds,
      statusChangedNodeIds,
      visualChangedNodeIds: new Set(current.nodeIds),
      linksChanged: current.linkKeys.size > 0,
      structureChanged: current.nodeIds.size > 0,
      needsGraphDataUpdate: current.nodeIds.size > 0 || current.linkKeys.size > 0,
    };
  }

  for (const id of current.nodeIds) {
    if (!previous.nodeIds.has(id)) {
      addedNodeIds.add(id);
      visualChangedNodeIds.add(id);
      continue;
    }
    if (previous.statusById.get(id) !== current.statusById.get(id)) {
      statusChangedNodeIds.add(id);
    }
    if (previous.visualById.get(id) !== current.visualById.get(id)) {
      visualChangedNodeIds.add(id);
    }
  }

  for (const id of previous.nodeIds) {
    if (!current.nodeIds.has(id)) {
      removedNodeIds.add(id);
    }
  }

  const linksChanged = hasSetChanged(previous.linkKeys, current.linkKeys);
  const structureChanged = addedNodeIds.size > 0 || removedNodeIds.size > 0;

  return {
    addedNodeIds,
    removedNodeIds,
    statusChangedNodeIds,
    visualChangedNodeIds,
    linksChanged,
    structureChanged,
    needsGraphDataUpdate: structureChanged || linksChanged,
  };
}
