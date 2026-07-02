import {
  Color,
  Vector3,
  type Camera,
  type Group,
  type Material,
  type Sprite,
  type SpriteMaterial,
} from 'three';
import { GRAPH } from './constants';
import { getMeta } from './nodeRenderer';
import type { SimNode } from './simTypes';

interface PendingAnim {
  obj: Group;
  start: number;
  dur: number;
}

const pendingAnims: PendingAnim[] = [];
const animatedNodes = new Set<string>();
let deployIndex = 0;

/** Reset deploy stagger counter (call on graph structure change) */
export function resetDeployIndex(): void {
  deployIndex = 0;
}

export function addDeployAnimation(nodeId: string, group: Group): void {
  if (animatedNodes.has(nodeId)) {
    return;
  }
  animatedNodes.add(nodeId);
  const idx = deployIndex++;
  group.scale.setScalar(0.01);
  setTimeout(() => {
    pendingAnims.push({
      obj: group,
      start: performance.now(),
      dur: GRAPH.node.deployDuration,
    });
  }, idx * GRAPH.node.deployStagger);
}

interface RolloutExitAnim {
  obj: Group;
  start: number;
  dur: number;
  materials: { mat: Material & { opacity?: number }; opacity: number }[];
}

const rolloutExitAnims: RolloutExitAnim[] = [];
const rolloutExitGroups = new WeakSet<Group>();

export function addRolloutExitAnimation(group: Group): void {
  if (rolloutExitGroups.has(group)) {
    return;
  }
  rolloutExitGroups.add(group);

  const materials: RolloutExitAnim['materials'] = [];
  group.traverse((child) => {
    const material = (child as any).material;
    const list = Array.isArray(material) ? material : material ? [material] : [];
    for (const mat of list) {
      if ('opacity' in mat) {
        mat.transparent = true;
        materials.push({ mat, opacity: mat.opacity ?? 1 });
      }
    }
  });

  rolloutExitAnims.push({
    obj: group,
    start: performance.now(),
    dur: GRAPH.node.rolloutExitDuration,
    materials,
  });
}

/** Tick all pending deploy animations (call every frame). */
export function tickAnimations(): void {
  const now = performance.now();
  for (let i = pendingAnims.length - 1; i >= 0; i--) {
    const a = pendingAnims[i];
    const t = Math.min((now - a.start) / a.dur, 1);
    a.obj.scale.setScalar(1 - Math.pow(1 - t, 3));
    if (t >= 1) {
      pendingAnims.splice(i, 1);
    }
  }
}

export function tickRolloutAnimations(): void {
  const now = performance.now();
  for (let i = rolloutExitAnims.length - 1; i >= 0; i--) {
    const anim = rolloutExitAnims[i];
    const t = Math.min((now - anim.start) / anim.dur, 1);
    const keep = Math.pow(1 - t, 2);
    anim.obj.scale.setScalar(Math.max(0.01, keep));
    for (const item of anim.materials) {
      item.mat.opacity = item.opacity * keep;
    }
    if (t >= 1) {
      rolloutExitAnims.splice(i, 1);
    }
  }
}

/** State change animation — direction-aware scale + emissive pulse. */
interface FlashAnim {
  group: Group;
  start: number;
  baseEmissive: number;
  startScale: number;
  startColor: Color;
  endColor: Color;
}

const flashAnims: FlashAnim[] = [];
const FLASH_DURATION = 600;

const ACTIVE_STATES = new Set(['running']);
const BASE_RADIUS = GRAPH.node.baseRadius;

/** Animate transition between states with scale + color interpolation. */
export function addStatusFlash(
  group: Group,
  prevStatus: string,
  curStatus: string,
  prevColor: string,
): void {
  const meta = getMeta(group);
  if (!meta) {
    return;
  }

  const prevRadius = ACTIVE_STATES.has(prevStatus) ? BASE_RADIUS.running : BASE_RADIUS.stopped;
  const curRadius = ACTIVE_STATES.has(curStatus) ? BASE_RADIUS.running : BASE_RADIUS.stopped;
  const startScale = prevRadius / curRadius;
  const startColor = new Color(prevColor);
  const endColor = meta.coreMat.color.clone();

  // Start from previous visual state
  group.scale.setScalar(startScale);
  meta.coreMat.color.copy(startColor);
  meta.coreMat.emissive.copy(startColor);
  meta.coreMat.emissiveIntensity = 1.0;

  flashAnims.push({
    group,
    start: performance.now(),
    baseEmissive: meta.baseEmissive,
    startScale,
    startColor,
    endColor,
  });
}

/** Tick flash animations (call every frame alongside tickAnimations). */
export function tickFlashAnimations(): void {
  const now = performance.now();
  for (let i = flashAnims.length - 1; i >= 0; i--) {
    const f = flashAnims[i];
    const t = Math.min((now - f.start) / FLASH_DURATION, 1);
    const ease = 1 - t * t; // ease-out quadratic
    const meta = getMeta(f.group);
    if (meta) {
      meta.coreMat.emissiveIntensity = f.baseEmissive + (1.0 - f.baseEmissive) * ease;
      // Lerp color from previous → current
      meta.coreMat.color.copy(f.startColor).lerp(f.endColor, t);
      meta.coreMat.emissive.copy(meta.coreMat.color);
    }
    // Interpolate from startScale → 1.0
    const scaleDelta = f.startScale - 1;
    f.group.scale.setScalar(1 + scaleDelta * ease);
    if (t >= 1) {
      flashAnims.splice(i, 1);
    }
  }
}

/** Pulse warning ring sprite opacities (call every frame). */
export function pulseWarningRings(rings: Sprite[]): void {
  const pulse = 0.12 + Math.sin(performance.now() * 0.004) * 0.12;
  for (const ring of rings) {
    (ring.material as SpriteMaterial).opacity = pulse;
  }
}

/** Update anomaly indicator visibility and pulse on graph nodes. */
export function updateAnomalyIndicators(nodes: SimNode[], anomalyIds: Set<string>): void {
  const pulse = 0.6 + Math.sin(performance.now() * 0.006) * 0.4;
  for (const node of nodes) {
    const meta = node.__threeObj ? getMeta(node.__threeObj) : null;
    if (!meta?.anomalySprite) {
      continue;
    }
    const hasAnomaly = anomalyIds.has(node.id);
    meta.anomalySprite.visible = hasAnomaly;
    if (hasAnomaly) {
      (meta.anomalySprite.material as SpriteMaterial).opacity = pulse;
    }
  }
}

/** Reposition labels and anomaly indicators in the camera's view plane. */
export function updateBillboardPositions(nodes: SimNode[], camera: Camera): void {
  const up = new Vector3();
  const right = new Vector3();
  right.setFromMatrixColumn(camera.matrixWorld, 0);
  up.setFromMatrixColumn(camera.matrixWorld, 1);

  for (const node of nodes) {
    const meta = node.__threeObj ? getMeta(node.__threeObj) : null;
    if (!meta) {
      continue;
    }

    // Label: position "above" in screen space
    const d = meta.labelOffset;
    meta.label.position.set(up.x * d, up.y * d, up.z * d);

    // Anomaly: position top-right in screen space
    if (meta.anomalySprite?.visible) {
      const r = meta.radius + 3;
      meta.anomalySprite.position.set(
        right.x * r + up.x * r,
        right.y * r + up.y * r,
        right.z * r + up.z * r,
      );
    }
  }
}

/** Orbit volume moons in the camera's view plane. */
const _right = new Vector3();
const _up = new Vector3();

export function orbitVolumeMoons(nodes: SimNode[], camera: Camera): void {
  const t = performance.now() * 0.00005;
  _right.setFromMatrixColumn(camera.matrixWorld, 0);
  _up.setFromMatrixColumn(camera.matrixWorld, 1);

  for (const node of nodes) {
    const meta = node.__threeObj ? getMeta(node.__threeObj) : null;
    if (!meta || meta.moonCount === 0) {
      continue;
    }
    for (let i = 0; i < meta.moonCount; i++) {
      const angle = t + meta.orbitPhase + (2 * Math.PI * i) / meta.moonCount;
      const cos = Math.cos(angle) * meta.orbitRadius;
      const sin = Math.sin(angle) * meta.orbitRadius;
      meta.moons[i].position.set(
        _right.x * cos + _up.x * sin,
        _right.y * cos + _up.y * sin,
        _right.z * cos + _up.z * sin,
      );
    }
  }
}
