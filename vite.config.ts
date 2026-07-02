import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { readFileSync } from 'fs';
import { fileURLToPath, URL } from 'node:url';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

const GRAPH_PACKAGES = new Set([
  '@tweenjs/tween.js',
  '3d-force-graph',
  'accessor-fn',
  'data-bind-mapper',
  'float-tooltip',
  'kapsule',
  'polished',
  'three-forcegraph',
  'three-render-objects',
  'three-spritetext',
  'tinycolor2',
]);

function packageName(id: string): string | undefined {
  const normalized = id.replaceAll('\\', '/');
  const match = normalized.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/);
  return match?.[1];
}

function manualChunks(id: string): string | undefined {
  const normalized = id.replaceAll('\\', '/');
  const name = packageName(id);
  if (!name) {
    return;
  }
  if (name.startsWith('@xterm/')) {
    return 'terminal';
  }
  if (name === 'three') {
    if (normalized.includes('/node_modules/three/examples/')) {
      return 'three-extras';
    }
    return 'three';
  }
  if (GRAPH_PACKAGES.has(name) || name.startsWith('d3-') || name.startsWith('ngraph.')) {
    return 'graph-vendor';
  }
  if (name === 'svelte') {
    return 'svelte';
  }
  return 'vendor';
}

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: {
      'three/webgpu': fileURLToPath(new URL('./src/web/lib/threeWebgpuStub.ts', import.meta.url)),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  root: '.',
  build: {
    outDir: 'dist/web',
    emptyOutDir: true,
    chunkSizeWarningLimit: 520,
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
});
