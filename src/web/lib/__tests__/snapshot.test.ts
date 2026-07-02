import { describe, expect, it } from 'vitest';
import {
  buildGraphSVG,
  snapshotFilename,
  type ProjectedLink,
  type ProjectedNode,
} from '../snapshot';

function makeNode(overrides: Partial<ProjectedNode> = {}): ProjectedNode {
  return {
    x: 100,
    y: 100,
    r: 6,
    color: '#00ff6a',
    label: 'api',
    depth: 0.5,
    ...overrides,
  };
}

function makeLink(overrides: Partial<ProjectedLink> = {}): ProjectedLink {
  return {
    x1: 0,
    y1: 0,
    x2: 100,
    y2: 100,
    color: 'rgba(0,228,255,0.35)',
    width: 1,
    arrow: false,
    ...overrides,
  };
}

describe('buildGraphSVG', () => {
  it('renders one halo + core circle and a label per node', () => {
    const svg = buildGraphSVG({
      width: 800,
      height: 600,
      nodes: [makeNode(), makeNode({ label: 'db', x: 300 })],
      links: [],
      subtitle: 'test',
    });

    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('width="800"');
    expect(svg).toContain('height="600"');
    expect(svg.match(/<circle/g)).toHaveLength(4);
    expect(svg).toContain('>api</text>');
    expect(svg).toContain('>db</text>');
  });

  it('renders links, with arrows only on dependency links', () => {
    const svg = buildGraphSVG({
      width: 800,
      height: 600,
      nodes: [],
      links: [makeLink(), makeLink({ arrow: true })],
      subtitle: 'test',
    });

    expect(svg.match(/<line/g)).toHaveLength(2);
    expect(svg.match(/marker-end="url\(#dep-arrow\)"/g)).toHaveLength(1);
  });

  it('escapes XML-unsafe characters in labels and subtitle', () => {
    const svg = buildGraphSVG({
      width: 100,
      height: 100,
      nodes: [makeNode({ label: 'a<b>&"c' })],
      links: [],
      subtitle: '<script>',
    });

    expect(svg).toContain('a&lt;b&gt;&amp;&quot;c');
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).not.toContain('<script>');
  });

  it('draws far nodes before near nodes (painter order)', () => {
    const svg = buildGraphSVG({
      width: 100,
      height: 100,
      nodes: [makeNode({ label: 'near', depth: 0.1 }), makeNode({ label: 'far', depth: 0.9 })],
      links: [],
      subtitle: '',
    });

    expect(svg.indexOf('>far<')).toBeLessThan(svg.indexOf('>near<'));
  });

  it('renders a legend entry per provided status', () => {
    const svg = buildGraphSVG({
      width: 100,
      height: 100,
      nodes: [],
      links: [],
      subtitle: '',
      legend: [
        { label: 'Running (healthy)', color: '#00ff6a' },
        { label: 'Stopped', color: '#2a3040' },
      ],
    });

    expect(svg).toContain('>Running (healthy)</text>');
    expect(svg).toContain('>Stopped</text>');
  });
});

describe('snapshotFilename', () => {
  it('is deterministic for a given date', () => {
    const d = new Date(2026, 6, 2, 9, 5, 7);
    expect(snapshotFilename('png', d)).toBe('dockscope-2026-07-02-090507.png');
    expect(snapshotFilename('svg', d)).toBe('dockscope-2026-07-02-090507.svg');
  });
});
