import { describe, expect, it } from 'vitest';
import {
  buildKubernetesGraph,
  buildHpaConstraintPatch,
  parseKubernetesResourceId,
  podsForRestart,
  type KubernetesResources,
} from '../kubernetes';

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

describe('parseKubernetesResourceId', () => {
  it('parses graph resource IDs into action targets', () => {
    expect(parseKubernetesResourceId('k8s:pod:prod:api-7d9f5b8c4-x2k9q')).toEqual({
      kind: 'pod',
      namespace: 'prod',
      name: 'api-7d9f5b8c4-x2k9q',
    });
  });

  it('rejects non-Kubernetes IDs', () => {
    expect(() => parseKubernetesResourceId('123456789abc')).toThrow(
      'Invalid Kubernetes resource ID',
    );
  });
});

describe('podsForRestart', () => {
  it('resolves backing pods for services, ingresses, and hpas', () => {
    const expectedPod = resources.pods.items![0];

    expect(
      podsForRestart(resources, {
        kind: 'service',
        namespace: 'prod',
        name: 'api',
      }),
    ).toEqual([expectedPod]);
    expect(
      podsForRestart(resources, {
        kind: 'ingress',
        namespace: 'prod',
        name: 'api',
      }),
    ).toEqual([expectedPod]);
    expect(
      podsForRestart(resources, {
        kind: 'hpa',
        namespace: 'prod',
        name: 'api',
      }),
    ).toEqual([expectedPod]);
  });
});

describe('buildHpaConstraintPatch', () => {
  it('creates a narrow JSON patch for HPA replica constraints', () => {
    expect(buildHpaConstraintPatch(2, 8)).toEqual([
      { op: 'add', path: '/spec/minReplicas', value: 2 },
      { op: 'replace', path: '/spec/maxReplicas', value: 8 },
    ]);
  });

  it('validates replica bounds before patching', () => {
    expect(() => buildHpaConstraintPatch(0, 8)).toThrow('minReplicas');
    expect(() => buildHpaConstraintPatch(5, 4)).toThrow('maxReplicas');
  });
});
