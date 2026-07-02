import type { ServiceNode } from '../../types';
import { kubernetesRestartMessage } from './sidebarApi';

/** Semantic intents the sidebar header can request confirmation for */
export type ConfirmKind = 'stop' | 'kill' | 'remove' | 'removeVolumes' | 'k8sRestart' | 'k8sDelete';

export interface ActionConfirm {
  title: string;
  message: string;
  confirmLabel: string;
  variant: 'warning' | 'danger';
  typeToConfirm?: string;
}

export function confirmStop(node: ServiceNode): ActionConfirm {
  return {
    title: 'Stop Container',
    message: `Stop ${node.name}? The container will be gracefully terminated.`,
    confirmLabel: 'Stop',
    variant: 'warning',
  };
}

export function confirmKill(node: ServiceNode): ActionConfirm {
  return {
    title: 'Kill Container',
    message: `Forcefully terminate ${node.name}? This sends SIGKILL — no graceful shutdown.`,
    confirmLabel: 'Kill',
    variant: 'warning',
  };
}

export function confirmRemove(node: ServiceNode, withVolumes: boolean): ActionConfirm {
  if (withVolumes) {
    return {
      title: 'Remove with Volumes',
      message: `Remove ${node.name} and ALL its volumes? This is irreversible.`,
      confirmLabel: 'Remove + Volumes',
      variant: 'danger',
      typeToConfirm: node.name,
    };
  }
  return {
    title: 'Remove Container',
    message: `Permanently remove ${node.name}? This deletes the container.`,
    confirmLabel: 'Remove',
    variant: 'danger',
    typeToConfirm: node.name,
  };
}

export function confirmKubernetesRestart(node: ServiceNode): ActionConfirm {
  return {
    title: node.kind === 'pod' ? 'Restart Pod' : 'Restart Backing Pods',
    message: kubernetesRestartMessage(node),
    confirmLabel: 'Restart',
    variant: 'warning',
  };
}

export function confirmKubernetesDelete(node: ServiceNode): ActionConfirm {
  return {
    title: `Delete ${node.kind}`,
    message: `Delete ${node.fullName}? This removes the Kubernetes ${node.kind} resource from the cluster.`,
    confirmLabel: 'Delete',
    variant: 'danger',
    typeToConfirm: node.name,
  };
}
