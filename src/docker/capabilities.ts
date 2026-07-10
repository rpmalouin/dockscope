import type { PluginCapability } from '../core/capabilities.js';

export const DOCKER_SOURCE_CAPABILITIES = [
  'source.graph',
  'source.metrics',
  'source.events',
  'source.logs',
  'source.inspect',
  'source.inventory',
  'source.relationships',
  'action.lifecycle',
  'action.exec',
  'action.filesystem',
  'action.deploy',
  'analysis.diagnostics',
  'analysis.anomalies',
] as const satisfies readonly PluginCapability[];
