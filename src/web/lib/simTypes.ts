import type { Group } from 'three';
import type { ServiceLink, ServiceNode } from '../../types';
import type { LinkEndpoint } from './graphLinks';

/**
 * ServiceNode extended with the runtime fields 3d-force-graph adds at runtime:
 * d3-force simulation coordinates/velocities and the rendered Three.js group.
 */
export interface SimNode extends ServiceNode {
  x?: number;
  y?: number;
  z?: number;
  vx?: number;
  vy?: number;
  vz?: number;
  fx?: number;
  fy?: number;
  fz?: number;
  __threeObj?: Group;
}

/** A SimNode after the d3 simulation has initialized its coordinates */
export type PositionedSimNode = SimNode & {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
};

/** ServiceLink whose endpoints d3 may have replaced with node object references */
export type SimLink = Omit<ServiceLink, 'source' | 'target'> & {
  source: LinkEndpoint;
  target: LinkEndpoint;
};
