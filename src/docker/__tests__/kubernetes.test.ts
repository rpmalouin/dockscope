import { describe, expect, it } from 'vitest';
import { buildKubernetesGraph, type KubernetesResources } from '../kubernetes';

const resources: KubernetesResources = {
  pods: {
    items: [
      {
        metadata: {
          name: 'api-7d9f5b8c4-x2k9q',
          namespace: 'prod',
          labels: { app: 'api' },
        },
        spec: {
          containers: [
            { name: 'api', image: 'ghcr.io/example/api:1', ports: [{ containerPort: 8080 }] },
          ],
        },
        status: {
          phase: 'Running',
          conditions: [{ type: 'Ready', status: 'True' }],
        },
      },
    ],
  },
  services: {
    items: [
      {
        metadata: { name: 'api', namespace: 'prod' },
        spec: {
          type: 'ClusterIP',
          selector: { app: 'api' },
          ports: [{ port: 80, targetPort: 8080 }],
        },
      },
    ],
  },
  ingresses: {
    items: [
      {
        metadata: { name: 'api', namespace: 'prod' },
        spec: {
          rules: [
            {
              host: 'api.example.test',
              http: {
                paths: [{ path: '/', pathType: 'Prefix', backend: { service: { name: 'api' } } }],
              },
            },
          ],
        },
      },
    ],
  },
  hpas: {
    items: [
      {
        metadata: { name: 'api', namespace: 'prod' },
        spec: {
          scaleTargetRef: { kind: 'Deployment', name: 'api' },
          minReplicas: 2,
          maxReplicas: 8,
        },
        status: { currentReplicas: 2, desiredReplicas: 4 },
      },
    ],
  },
};

describe('buildKubernetesGraph', () => {
  it('renders pod, service, ingress, and hpa resources as graph nodes', () => {
    const graph = buildKubernetesGraph(resources);

    expect(graph.nodes.map((node) => node.kind).sort()).toEqual([
      'hpa',
      'ingress',
      'pod',
      'service',
    ]);
    expect(graph.nodes).toContainEqual(
      expect.objectContaining({
        id: 'k8s:pod:prod:api-7d9f5b8c4-x2k9q',
        runtime: 'kubernetes',
        namespace: 'prod',
        status: 'running',
        health: 'healthy',
      }),
    );
    expect(graph.nodes).toContainEqual(
      expect.objectContaining({
        id: 'k8s:hpa:prod:api',
        image: 'HPA 2/4 replicas',
        health: 'starting',
      }),
    );
  });

  it('links ingress to service, service to selected pods, and hpa to matching pods', () => {
    const graph = buildKubernetesGraph(resources);

    expect(graph.links).toEqual(
      expect.arrayContaining([
        {
          source: 'k8s:service:prod:api',
          target: 'k8s:pod:prod:api-7d9f5b8c4-x2k9q',
          type: 'kubernetes',
          label: 'selects',
        },
        {
          source: 'k8s:ingress:prod:api',
          target: 'k8s:service:prod:api',
          type: 'depends_on',
          label: 'api.example.test',
        },
        {
          source: 'k8s:hpa:prod:api',
          target: 'k8s:pod:prod:api-7d9f5b8c4-x2k9q',
          type: 'kubernetes',
          label: 'scales Deployment',
        },
      ]),
    );
  });
});
