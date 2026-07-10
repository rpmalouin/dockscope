import type { PluginCapability } from '../core/capabilities.js';
import type { ResourceProvider } from '../core/operations.js';
import type { DockscopePlugin } from '../core/plugins.js';
import {
  getKubernetesPodLogs,
  kubernetesResourceAction,
  parseKubernetesResourceId,
} from './kubernetes.js';

const KUBERNETES_CAPABILITIES = [
  'source.logs',
  'action.lifecycle',
  'action.scale',
] as const satisfies readonly PluginCapability[];

const kubernetesResourceProvider: ResourceProvider = {
  canHandle: (resourceId) => {
    try {
      parseKubernetesResourceId(resourceId);
      return true;
    } catch {
      return false;
    }
  },
  getResourceLogs: (resourceId, options) => getKubernetesPodLogs(resourceId, options?.tail),
  runResourceAction: kubernetesResourceAction,
};

export function createKubernetesPlugin(): DockscopePlugin {
  return {
    manifest: {
      id: 'core.kubernetes',
      name: 'Kubernetes',
      version: '1.0.0',
      dockscopeApiVersion: '1',
      description: 'Built-in Kubernetes resource logs and lifecycle provider.',
      builtin: true,
      capabilities: KUBERNETES_CAPABILITIES,
      permissions: ['kubernetes.api'],
    },
    getResourceProviders: () => [kubernetesResourceProvider],
  };
}
