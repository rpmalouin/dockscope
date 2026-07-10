import type { DockerEvent, GraphData, ServiceLink, ServiceNode } from '../types.js';

export type DataSourceKind = 'docker' | 'kubernetes' | 'plugin';

export type DataSourceCapability =
  | 'graph'
  | 'events'
  | 'stats'
  | 'logs'
  | 'inspect'
  | 'actions'
  | 'exec'
  | 'diff'
  | 'top'
  | 'diagnostics';

export type DataSourceStatus = 'connected' | 'disconnected' | 'unknown';

export interface DataSourceDescriptor {
  id: string;
  label: string;
  kind: DataSourceKind;
  pluginId: string;
  capabilities: readonly DataSourceCapability[];
  status: DataSourceStatus;
  metadata?: Record<string, string | number | boolean>;
}

export interface SourceGraphSnapshot {
  source: DataSourceDescriptor;
  graph: GraphData;
  collectedAt: number;
}

export interface SourceCollectionError {
  source: DataSourceDescriptor;
  message: string;
  collectedAt: number;
}

export interface SourceEvent {
  source: DataSourceDescriptor;
  event: DockerEvent;
  receivedAt: number;
}

export interface DataEntityTable<T extends { id: string }> {
  ids: string[];
  byId: Record<string, T>;
}

export interface DataGraphLinkRow {
  id: string;
  source: string;
  target: string;
  type: ServiceLink['type'];
  label?: string;
}

export interface DataGraphTables {
  nodes: DataEntityTable<ServiceNode>;
  links: DataEntityTable<DataGraphLinkRow>;
}

export interface SourceGraphCollection {
  snapshots: SourceGraphSnapshot[];
  graph: GraphData;
  tables: DataGraphTables;
  errors: SourceCollectionError[];
  collectedAt: number;
}

export interface GraphSourceAdapter {
  describe(): DataSourceDescriptor;
  collectGraph(): Promise<SourceGraphSnapshot>;
  startEvents?(callback: (event: SourceEvent) => void): () => void;
}
