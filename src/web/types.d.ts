import type { Camera, Object3D, Scene, WebGLRenderer } from 'three';
import type { GraphData } from '../types';
import type { SimLink, SimNode } from './lib/simTypes';

declare global {
  const __APP_VERSION__: string;
}

type ForceGraphData = GraphData | { nodes: SimNode[]; links: SimLink[] };
type GraphPosition = { x?: number; y?: number; z?: number };
type GraphControls = { zoomSpeed: number; rotateSpeed: number; panSpeed: number };
type D3ForceHandle = {
  strength(value: number): D3ForceHandle;
  distance(value: number): D3ForceHandle;
  distanceMax(value: number): D3ForceHandle;
};
type D3ForceFunction = ((alpha: number) => void) & {
  initialize?(nodes: SimNode[]): void;
};

declare module '3d-force-graph' {
  export default function ForceGraph3D(config?: {
    controlType?: string;
    rendererConfig?: Record<string, unknown>;
  }): (element: HTMLElement) => ForceGraph3DInstance;

  export interface ForceGraph3DInstance {
    graphData(): { nodes: SimNode[]; links: SimLink[] };
    graphData(data: ForceGraphData): ForceGraph3DInstance;
    nodeId(id: string): ForceGraph3DInstance;
    nodeLabel(label: string | ((node: SimNode) => string)): ForceGraph3DInstance;
    nodeColor(color: string | ((node: SimNode) => string)): ForceGraph3DInstance;
    nodeRelSize(size: number): ForceGraph3DInstance;
    nodeOpacity(opacity: number): ForceGraph3DInstance;
    linkColor(color: string | ((link: SimLink) => string)): ForceGraph3DInstance;
    linkWidth(width: number | ((link: SimLink) => number)): ForceGraph3DInstance;
    linkOpacity(opacity: number): ForceGraph3DInstance;
    linkDirectionalArrowLength(length: number | ((link: SimLink) => number)): ForceGraph3DInstance;
    linkDirectionalArrowRelPos(pos: number): ForceGraph3DInstance;
    linkDirectionalArrowColor(
      color: string | ((link: SimLink) => string | undefined),
    ): ForceGraph3DInstance;
    linkDirectionalParticles(count: number | ((link: SimLink) => number)): ForceGraph3DInstance;
    linkDirectionalParticleWidth(width: number): ForceGraph3DInstance;
    linkLabel(label: string | ((link: SimLink) => string)): ForceGraph3DInstance;
    backgroundColor(color: string): ForceGraph3DInstance;
    width(width: number): ForceGraph3DInstance;
    height(height: number): ForceGraph3DInstance;
    nodeThreeObject(fn: ((node: SimNode) => Object3D) | null): ForceGraph3DInstance;
    nodeThreeObjectExtend(extend: boolean): ForceGraph3DInstance;
    onNodeClick(callback: (node: SimNode, event: MouseEvent) => void): ForceGraph3DInstance;
    onNodeHover(
      callback: (node: SimNode | null, prevNode: SimNode | null) => void,
    ): ForceGraph3DInstance;
    cooldownTicks(ticks: number): ForceGraph3DInstance;
    warmupTicks(ticks: number): ForceGraph3DInstance;
    d3AlphaDecay(decay: number): ForceGraph3DInstance;
    d3VelocityDecay(decay: number): ForceGraph3DInstance;
    d3Force(name: string): D3ForceHandle | undefined;
    d3Force(name: string, force: D3ForceFunction): ForceGraph3DInstance;
    d3ReheatSimulation(): ForceGraph3DInstance;
    cameraPosition(
      position: GraphPosition,
      lookAt?: GraphPosition,
      transitionMs?: number,
    ): ForceGraph3DInstance;
    nodeVisibility(fn: (node: SimNode) => boolean): ForceGraph3DInstance;
    linkVisibility(fn: (link: SimLink) => boolean): ForceGraph3DInstance;
    zoomToFit(duration?: number): ForceGraph3DInstance;
    scene(): Scene;
    camera(): Camera;
    renderer(): WebGLRenderer;
    controls(): GraphControls;
    _destructor?(): void;
  }
}
