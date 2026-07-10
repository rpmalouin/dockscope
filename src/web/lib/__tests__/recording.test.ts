import { describe, expect, it } from 'vitest';
import type { DockerEvent, GraphData, ServiceLink, ServiceNode, WSMessage } from '../../../types';
import {
  MAX_RECORDING_FRAMES,
  RECORDABLE_TYPES,
  formatClock,
  recordingFilename,
  sanitizeGraph,
  sanitizeLink,
  sanitizeNode,
  validateRecording,
  type Recording,
} from '../recording';

function makeNode(overrides: Partial<ServiceNode> & { id: string }): ServiceNode {
  return {
    name: overrides.id,
    fullName: overrides.id,
    project: '',
    host: 'local',
    containerId: overrides.id,
    image: 'test:latest',
    status: 'running',
    health: 'none',
    ports: [],
    networks: [],
    volumeCount: 0,
    cpu: 0,
    memory: 0,
    memoryLimit: 0,
    networkRx: 0,
    networkTx: 0,
    networkRxRate: 0,
    networkTxRate: 0,
    ...overrides,
  };
}

function makeRecording(overrides: Partial<Recording> = {}): Recording {
  return {
    version: 1,
    app: 'dockscope',
    appVersion: '0.7.0',
    startedAt: 1_700_000_000_000,
    duration: 5000,
    initialGraph: { nodes: [], links: [] },
    frames: [],
    ...overrides,
  };
}

type RuntimeNode = ServiceNode & {
  x?: number;
  y?: number;
  z?: number;
  vx?: number;
  __threeObj?: Record<string, unknown>;
};

function eventMessage(id: string): WSMessage {
  const event: DockerEvent = {
    id,
    type: 'container',
    action: 'start',
    actor: id,
    time: 1,
    message: id,
  };
  return { type: 'event', data: event };
}

function statsMessage(id: string): WSMessage {
  return {
    type: 'stats',
    data: {
      id,
      cpu: 1,
      memory: 2,
      memoryLimit: 3,
      networkRx: 4,
      networkTx: 5,
      networkRxRate: 6,
      networkTxRate: 7,
    },
  };
}

describe('sanitizeNode', () => {
  it('strips d3/Three.js runtime fields', () => {
    const node: RuntimeNode = makeNode({ id: 'a' });
    node.x = 12;
    node.y = -3;
    node.z = 44;
    node.vx = 0.1;
    node.__threeObj = { cyclic: null };
    node.__threeObj.cyclic = node.__threeObj;

    const clean = sanitizeNode(node);

    expect(clean.id).toBe('a');
    expect('x' in clean).toBe(false);
    expect('vx' in clean).toBe(false);
    expect('__threeObj' in clean).toBe(false);
    // Must be JSON-serializable (no cycles)
    expect(() => JSON.stringify(clean)).not.toThrow();
  });

  it('copies array fields so later mutation does not leak into the recording', () => {
    const node = makeNode({ id: 'a', ports: ['80:80'] });
    const clean = sanitizeNode(node);
    node.ports.push('443:443');

    expect(clean.ports).toEqual(['80:80']);
  });
});

describe('sanitizeLink', () => {
  it('restores plain string IDs from d3 node object endpoints', () => {
    const link: ServiceLink = {
      source: { id: 'a' },
      target: { id: 'b' },
      type: 'network',
      label: 'backend',
    };

    expect(sanitizeLink(link)).toEqual({
      source: 'a',
      target: 'b',
      type: 'network',
      label: 'backend',
    });
  });

  it('omits an undefined label', () => {
    const link: ServiceLink = { source: 'a', target: 'b', type: 'depends_on' };
    expect('label' in sanitizeLink(link)).toBe(false);
  });
});

describe('sanitizeGraph', () => {
  it('produces a JSON-serializable graph', () => {
    const node: RuntimeNode = makeNode({ id: 'a' });
    node.__threeObj = {};
    node.__threeObj.self = node.__threeObj;
    const graph: GraphData = {
      nodes: [node],
      links: [{ source: node, target: node, type: 'network' }],
    };

    const clean = sanitizeGraph(graph);

    expect(() => JSON.stringify(clean)).not.toThrow();
    expect(clean.links[0].source).toBe('a');
  });
});

describe('validateRecording', () => {
  it('accepts a valid recording round-tripped through JSON', () => {
    const rec = makeRecording({
      frames: [
        { t: 100, msg: eventMessage('x') },
        { t: 50, msg: statsMessage('y') },
      ],
    });

    const parsed = validateRecording(JSON.parse(JSON.stringify(rec)));

    expect(parsed).not.toBeNull();
    // Frames come back sorted by time
    expect(parsed!.frames.map((f) => f.t)).toEqual([50, 100]);
  });

  it('rejects non-objects and wrong versions', () => {
    expect(validateRecording(null)).toBeNull();
    expect(validateRecording('hi')).toBeNull();
    expect(validateRecording({})).toBeNull();
    expect(
      validateRecording(makeRecording({ version: 2 as unknown as Recording['version'] })),
    ).toBeNull();
    expect(validateRecording({ ...makeRecording(), app: 'other' })).toBeNull();
  });

  it('rejects a recording without a usable initial graph or frames array', () => {
    expect(validateRecording({ ...makeRecording(), initialGraph: undefined })).toBeNull();
    expect(
      validateRecording({ ...makeRecording(), initialGraph: { nodes: 'no', links: [] } }),
    ).toBeNull();
    expect(validateRecording({ ...makeRecording(), frames: 'no' })).toBeNull();
  });

  it('drops malformed and non-recordable frames', () => {
    const malformedFrames = [
      { t: 10, msg: eventMessage('ok') },
      { t: -5, msg: eventMessage('negative') },
      { t: 20, msg: { type: 'log_chunk', data: {} } },
      'garbage',
      { t: 30 },
    ] as unknown as Recording['frames'];
    const rec = makeRecording({
      frames: malformedFrames,
    });

    const parsed = validateRecording(JSON.parse(JSON.stringify(rec)));

    expect(parsed!.frames).toHaveLength(1);
    expect(parsed!.frames[0].t).toBe(10);
  });

  it('extends the duration to cover the last frame', () => {
    const rec = makeRecording({
      duration: 100,
      frames: [{ t: 900, msg: eventMessage('late') }],
    });

    expect(validateRecording(JSON.parse(JSON.stringify(rec)))!.duration).toBe(900);
  });
});

describe('formatClock', () => {
  it('formats millisecond offsets as m:ss', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(999)).toBe('0:00');
    expect(formatClock(61_000)).toBe('1:01');
    expect(formatClock(3_599_000)).toBe('59:59');
    expect(formatClock(-50)).toBe('0:00');
  });
});

describe('recording constants', () => {
  it('does not record log chunks', () => {
    expect(RECORDABLE_TYPES.has('log_chunk')).toBe(false);
    expect(MAX_RECORDING_FRAMES).toBeGreaterThan(0);
  });

  it('builds a deterministic filename from the start timestamp', () => {
    const name = recordingFilename(new Date(2026, 6, 2, 14, 30, 5).getTime());
    expect(name).toBe('dockscope-recording-2026-07-02-143005.json');
  });
});
