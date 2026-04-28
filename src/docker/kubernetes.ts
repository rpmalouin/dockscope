import {
  AutoscalingV2Api,
  CoreV1Api,
  KubeConfig,
  NetworkingV1Api,
  type V1Ingress,
  type V1Pod,
  type V1Service,
  type V2HorizontalPodAutoscaler,
} from '@kubernetes/client-node';
import type { GraphData, ServiceLink, ServiceNode } from '../types.js';

type Labels = Record<string, string>;

interface KubernetesList<T> {
  items?: T[];
}

interface ObjectMeta {
  name?: string;
  namespace?: string;
  labels?: Labels;
}

export interface KubernetesResources {
  pods: KubernetesList<V1Pod>;
  services: KubernetesList<V1Service>;
  ingresses: KubernetesList<V1Ingress>;
  hpas: KubernetesList<V2HorizontalPodAutoscaler>;
}

function rejectAfter<T>(ms: number): Promise<T> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
}

function withTimeout<T>(promise: Promise<T>, ms = 2500): Promise<T> {
  return Promise.race([promise, rejectAfter<T>(ms)]);
}

function createKubernetesClients(): {
  core: CoreV1Api;
  networking: NetworkingV1Api;
  autoscaling: AutoscalingV2Api;
} | null {
  try {
    const config = new KubeConfig();
    config.loadFromDefault();

    if (!config.getCurrentCluster()) {
      return null;
    }

    return {
      core: config.makeApiClient(CoreV1Api),
      networking: config.makeApiClient(NetworkingV1Api),
      autoscaling: config.makeApiClient(AutoscalingV2Api),
    };
  } catch {
    return null;
  }
}

export async function listKubernetesResources(): Promise<KubernetesResources | null> {
  const empty = { items: [] };
  const clients = createKubernetesClients();
  if (!clients) {
    return null;
  }

  try {
    const [pods, services, ingresses, hpas] = await Promise.all([
      withTimeout(clients.core.listPodForAllNamespaces()).catch(() => empty),
      withTimeout(clients.core.listServiceForAllNamespaces()).catch(() => empty),
      withTimeout(clients.networking.listIngressForAllNamespaces()).catch(() => empty),
      withTimeout(clients.autoscaling.listHorizontalPodAutoscalerForAllNamespaces()).catch(
        () => empty,
      ),
    ]);
    if (
      [pods, services, ingresses, hpas].every(
        (resource) => ((resource as KubernetesList<unknown>).items || []).length === 0,
      )
    ) {
      return null;
    }
    return {
      pods: pods as KubernetesResources['pods'],
      services: services as KubernetesResources['services'],
      ingresses: ingresses as KubernetesResources['ingresses'],
      hpas: hpas as KubernetesResources['hpas'],
    };
  } catch {
    return null;
  }
}

function k8sId(kind: ServiceNode['kind'], namespace: string, name: string): string {
  return `k8s:${kind}:${namespace}:${name}`;
}

function namespaceOf(meta?: ObjectMeta): string {
  return meta?.namespace || 'default';
}

function nameOf(meta?: ObjectMeta): string {
  return meta?.name || 'unknown';
}

function matchesSelector(labels: Labels | undefined, selector: Labels | undefined): boolean {
  const entries = Object.entries(selector || {});
  return entries.length > 0 && entries.every(([key, value]) => labels?.[key] === value);
}

function podStatus(pod: V1Pod): Pick<ServiceNode, 'status' | 'health'> {
  const phase = (pod.status?.phase || 'Unknown').toLowerCase();
  const ready = pod.status?.conditions?.find((condition) => condition.type === 'Ready')?.status;

  if (phase === 'running') {
    return { status: 'running', health: ready === 'True' ? 'healthy' : 'starting' };
  }
  if (phase === 'pending') {
    return { status: 'pending', health: 'starting' };
  }
  if (phase === 'succeeded') {
    return { status: 'exited', health: 'none' };
  }
  if (phase === 'failed') {
    return { status: 'dead', health: 'unhealthy' };
  }
  return { status: 'unknown', health: 'none' };
}

function baseNode(
  kind: NonNullable<ServiceNode['kind']>,
  namespace: string,
  name: string,
): Omit<ServiceNode, 'image' | 'status' | 'health' | 'ports' | 'networks' | 'volumeCount'> {
  return {
    id: k8sId(kind, namespace, name),
    name,
    fullName: `${namespace}/${name}`,
    project: namespace,
    host: 'kubernetes',
    runtime: 'kubernetes',
    kind,
    namespace,
    containerId: k8sId(kind, namespace, name),
    cpu: 0,
    memory: 0,
    memoryLimit: 0,
    networkRx: 0,
    networkTx: 0,
    networkRxRate: 0,
    networkTxRate: 0,
  };
}

export function buildKubernetesGraph(resources: KubernetesResources): GraphData {
  const nodes: ServiceNode[] = [];
  const links: ServiceLink[] = [];
  const pods = resources.pods.items || [];
  const services = resources.services.items || [];

  for (const pod of pods) {
    const namespace = namespaceOf(pod.metadata);
    const name = nameOf(pod.metadata);
    const containers = pod.spec?.containers || [];
    const ports = containers.flatMap((container) =>
      (container.ports || []).map(
        (port) => `${port.containerPort}/${(port.protocol || 'TCP').toLowerCase()}`,
      ),
    );
    nodes.push({
      ...baseNode('pod', namespace, name),
      image:
        containers
          .map((container) => container.image)
          .filter(Boolean)
          .join(', ') || 'Pod',
      ...podStatus(pod),
      ports,
      networks: [namespace],
      volumeCount: 0,
    });
  }

  for (const service of services) {
    const namespace = namespaceOf(service.metadata);
    const name = nameOf(service.metadata);
    const ports = (service.spec?.ports || []).map((port) => {
      const target = port.targetPort ? `:${port.targetPort}` : '';
      return `${port.port}${target}/${(port.protocol || 'TCP').toLowerCase()}`;
    });
    const serviceId = k8sId('service', namespace, name);
    nodes.push({
      ...baseNode('service', namespace, name),
      image: `Service ${service.spec?.type || 'ClusterIP'}`,
      status: 'running',
      health: 'none',
      ports,
      networks: [namespace],
      volumeCount: 0,
    });

    for (const pod of pods) {
      if (
        namespaceOf(pod.metadata) === namespace &&
        matchesSelector(pod.metadata?.labels, service.spec?.selector)
      ) {
        links.push({
          source: serviceId,
          target: k8sId('pod', namespace, nameOf(pod.metadata)),
          type: 'kubernetes',
          label: 'selects',
        });
      }
    }
  }

  for (const ingress of resources.ingresses.items || []) {
    const namespace = namespaceOf(ingress.metadata);
    const name = nameOf(ingress.metadata);
    const ingressId = k8sId('ingress', namespace, name);
    const ports =
      ingress.spec?.rules?.flatMap((rule) =>
        (rule.http?.paths || []).map((path) => `${rule.host || '*'}${path.path || '/'}`),
      ) || [];
    nodes.push({
      ...baseNode('ingress', namespace, name),
      image: 'Ingress',
      status: 'running',
      health: 'none',
      ports,
      networks: [namespace],
      volumeCount: 0,
    });

    for (const rule of ingress.spec?.rules || []) {
      for (const path of rule.http?.paths || []) {
        const serviceName = path.backend?.service?.name;
        if (serviceName) {
          links.push({
            source: ingressId,
            target: k8sId('service', namespace, serviceName),
            type: 'depends_on',
            label: rule.host || 'ingress',
          });
        }
      }
    }
  }

  for (const hpa of resources.hpas.items || []) {
    const namespace = namespaceOf(hpa.metadata);
    const name = nameOf(hpa.metadata);
    const current = hpa.status?.currentReplicas ?? 0;
    const desired = hpa.status?.desiredReplicas ?? 0;
    const hpaId = k8sId('hpa', namespace, name);
    nodes.push({
      ...baseNode('hpa', namespace, name),
      image: `HPA ${current}/${desired} replicas`,
      status: 'running',
      health: desired > current ? 'starting' : 'healthy',
      ports: [
        `${current}/${desired} replicas`,
        `${hpa.spec?.minReplicas ?? 1}-${hpa.spec?.maxReplicas ?? '?'} range`,
      ],
      networks: [namespace],
      volumeCount: 0,
    });

    const target = hpa.spec?.scaleTargetRef;
    const targetKind = target?.kind || 'target';
    const targetPods = pods.filter((pod) => {
      if (!target?.name || namespaceOf(pod.metadata) !== namespace) {
        return false;
      }
      const labels = pod.metadata?.labels || {};
      return (
        labels.app === target.name ||
        labels['app.kubernetes.io/name'] === target.name ||
        nameOf(pod.metadata).startsWith(`${target.name}-`)
      );
    });
    for (const pod of targetPods) {
      links.push({
        source: hpaId,
        target: k8sId('pod', namespace, nameOf(pod.metadata)),
        type: 'kubernetes',
        label: `scales ${targetKind}`,
      });
    }
  }

  return { nodes, links };
}

export async function buildKubernetesGraphIfAvailable(): Promise<GraphData> {
  const resources = await listKubernetesResources();
  return resources ? buildKubernetesGraph(resources) : { nodes: [], links: [] };
}
