import {
  BackSide,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  type Material,
  type Scene,
  type SpriteMaterial,
} from 'three';
import SpriteText from 'three-spritetext';
import { PROJECT_PALETTE, HOST_PALETTE } from './constants';
import type { PositionedSimNode, SimNode } from './simTypes';

interface ClusterVisual {
  mesh: Mesh;
  label: SpriteText;
}

const sharedGeo = new SphereGeometry(1, 20, 14);
const clusterMap = new Map<string, ClusterVisual>();
const hostClusterMap = new Map<string, ClusterVisual>();

/** Compose a cluster key that groups by host then project */
function clusterKey(node: SimNode): string {
  const host = node.host || 'local';
  const project = node.project || '';
  return project ? `${host}/${project}` : '';
}

/** Build centroid map from nodes using a key function, skipping empty keys */
function buildCentroids(
  nodes: PositionedSimNode[],
  keyFn: (node: SimNode) => string,
): Map<string, { x: number; y: number; z: number; count: number }> {
  const centroids = new Map<string, { x: number; y: number; z: number; count: number }>();
  for (const node of nodes) {
    const key = keyFn(node);
    if (!key) {
      continue;
    }
    let c = centroids.get(key);
    if (!c) {
      c = { x: 0, y: 0, z: 0, count: 0 };
      centroids.set(key, c);
    }
    c.x += node.x;
    c.y += node.y;
    c.z += node.z;
    c.count++;
  }
  for (const c of centroids.values()) {
    c.x /= c.count;
    c.y /= c.count;
    c.z /= c.count;
  }
  return centroids;
}

/** Apply clustering force: pull each node toward its centroid */
function applyCentroidForce(
  nodes: PositionedSimNode[],
  centroids: Map<string, { x: number; y: number; z: number; count: number }>,
  keyFn: (node: SimNode) => string,
  s: number,
  alpha: number,
): void {
  for (const node of nodes) {
    const c = centroids.get(keyFn(node));
    if (!c || c.count < 2) {
      continue;
    }
    node.vx += (c.x - node.x) * s * alpha;
    node.vy += (c.y - node.y) * s * alpha;
    node.vz += (c.z - node.z) * s * alpha;
  }
}

export function createClusteringForce(strength: number) {
  let nodes: PositionedSimNode[] = [];
  function force(alpha: number) {
    // Cluster by host+project (project clusters stay within their host region)
    const centroids = buildCentroids(nodes, clusterKey);
    applyCentroidForce(nodes, centroids, clusterKey, strength, alpha);

    // Also apply a weaker host-level clustering force
    const hostKey = (n: SimNode) => n.host || 'local';
    const hostCentroids = buildCentroids(nodes, hostKey);
    if (hostCentroids.size > 1) {
      applyCentroidForce(nodes, hostCentroids, hostKey, strength * 0.5, alpha);
    }
  }
  force.initialize = (n: PositionedSimNode[]) => {
    nodes = n;
  };
  return force;
}

function createClusterMesh(color: string): Mesh {
  const mat = new MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.035,
    depthWrite: false,
    side: BackSide,
  });
  const mesh = new Mesh(sharedGeo, mat);
  mesh.renderOrder = -1;
  return mesh;
}

function createClusterLabel(name: string, color: string): SpriteText {
  const label = new SpriteText(name);
  label.color = color;
  label.textHeight = 3;
  label.fontFace = "'Fira Code', monospace";
  label.fontWeight = '600';
  label.backgroundColor = false as any;
  label.padding = 0;
  (label.material as SpriteMaterial).depthWrite = false;
  (label.material as SpriteMaterial).opacity = 0.5;
  return label;
}

function removeFromMap(scene: Scene, map: Map<string, ClusterVisual>, name: string): void {
  const cluster = map.get(name);
  if (!cluster) {
    return;
  }
  scene.remove(cluster.mesh);
  scene.remove(cluster.label);
  (cluster.mesh.material as Material).dispose();
  map.delete(name);
}

export function updateClusters(
  scene: Scene,
  nodes: SimNode[],
  isVisible: (node: SimNode) => boolean,
): void {
  // Group visible nodes by host+project key for project clusters
  const projectNodes = new Map<string, PositionedSimNode[]>();
  // Group visible nodes by host for host-level clusters
  const hostNodes = new Map<string, PositionedSimNode[]>();

  for (const candidate of nodes) {
    if (candidate.x === undefined) {
      continue;
    }
    if (!isVisible(candidate)) {
      continue;
    }
    const node = candidate as PositionedSimNode;

    const host = node.host || 'local';
    if (!hostNodes.has(host)) {
      hostNodes.set(host, []);
    }
    hostNodes.get(host)!.push(node);

    const p = node.project || '';
    if (!p) {
      continue;
    }
    const key = `${host}/${p}`;
    if (!projectNodes.has(key)) {
      projectNodes.set(key, []);
    }
    projectNodes.get(key)!.push(node);
  }

  // --- Project-level clusters ---
  const sortedNames = [...projectNodes.keys()].sort();
  const colorIndex = new Map(sortedNames.map((n, i) => [n, i]));

  for (const [key, pNodes] of projectNodes) {
    if (pNodes.length < 2) {
      removeFromMap(scene, clusterMap, key);
      continue;
    }

    let cx = 0,
      cy = 0,
      cz = 0;
    for (const n of pNodes) {
      cx += n.x;
      cy += n.y;
      cz += n.z;
    }
    cx /= pNodes.length;
    cy /= pNodes.length;
    cz /= pNodes.length;

    let maxR = 0;
    for (const n of pNodes) {
      const r = Math.sqrt((n.x - cx) ** 2 + (n.y - cy) ** 2 + (n.z - cz) ** 2);
      if (r > maxR) {
        maxR = r;
      }
    }
    const radius = maxR + 15;
    const color = PROJECT_PALETTE[colorIndex.get(key)! % PROJECT_PALETTE.length];

    let cluster = clusterMap.get(key);
    if (!cluster) {
      // Extract display name (project part after host/)
      const displayName = key.includes('/') ? key.split('/').slice(1).join('/') : key;
      const mesh = createClusterMesh(color);
      const label = createClusterLabel(displayName, color);
      scene.add(mesh);
      scene.add(label);
      cluster = { mesh, label };
      clusterMap.set(key, cluster);
    }

    cluster.mesh.position.set(cx, cy, cz);
    cluster.mesh.scale.setScalar(radius);
    cluster.label.position.set(cx, cy + radius + 5, cz);
  }

  // Remove stale project clusters
  for (const [name] of clusterMap) {
    if (!projectNodes.has(name) || projectNodes.get(name)!.length < 2) {
      removeFromMap(scene, clusterMap, name);
    }
  }

  // --- Host-level clusters (only when multiple hosts exist) ---
  const multiHost = hostNodes.size > 1;
  const sortedHosts = [...hostNodes.keys()].sort();
  const hostColorIndex = new Map(sortedHosts.map((h, i) => [h, i]));

  if (multiHost) {
    for (const [hostName, hNodes] of hostNodes) {
      if (hNodes.length < 1) {
        removeFromMap(scene, hostClusterMap, hostName);
        continue;
      }

      let cx = 0,
        cy = 0,
        cz = 0;
      for (const n of hNodes) {
        cx += n.x;
        cy += n.y;
        cz += n.z;
      }
      cx /= hNodes.length;
      cy /= hNodes.length;
      cz /= hNodes.length;

      let maxR = 0;
      for (const n of hNodes) {
        const r = Math.sqrt((n.x - cx) ** 2 + (n.y - cy) ** 2 + (n.z - cz) ** 2);
        if (r > maxR) {
          maxR = r;
        }
      }
      const radius = maxR + 30;
      const color = HOST_PALETTE[hostColorIndex.get(hostName)! % HOST_PALETTE.length];

      let cluster = hostClusterMap.get(hostName);
      if (!cluster) {
        const mesh = createClusterMesh(color);
        mesh.renderOrder = -2; // Behind project clusters
        (mesh.material as MeshBasicMaterial).opacity = 0.02;
        const label = createClusterLabel(hostName, color);
        label.textHeight = 4;
        (label.material as SpriteMaterial).opacity = 0.6;
        scene.add(mesh);
        scene.add(label);
        cluster = { mesh, label };
        hostClusterMap.set(hostName, cluster);
      }

      cluster.mesh.position.set(cx, cy, cz);
      cluster.mesh.scale.setScalar(radius);
      cluster.label.position.set(cx, cy + radius + 8, cz);
    }
  }

  // Remove stale host clusters
  for (const [name] of hostClusterMap) {
    if (!multiHost || !hostNodes.has(name) || hostNodes.get(name)!.length < 1) {
      removeFromMap(scene, hostClusterMap, name);
    }
  }
}

export function cleanupAllClusters(scene: Scene): void {
  for (const [name] of clusterMap) {
    removeFromMap(scene, clusterMap, name);
  }
  for (const [name] of hostClusterMap) {
    removeFromMap(scene, hostClusterMap, name);
  }
  sharedGeo.dispose();
}
