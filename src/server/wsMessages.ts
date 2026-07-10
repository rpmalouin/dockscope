export type InboundWSMessage =
  | { type: 'subscribe_logs'; data: { containerId: string; host?: string } }
  | { type: 'unsubscribe_logs' }
  | { type: 'exec_start'; data: { containerId: string; host?: string; cmd?: string[] } }
  | { type: 'exec_input'; data: { text: string } }
  | { type: 'exec_resize'; data: Record<string, unknown> }
  | { type: 'exec_stop' };

const VALID_ID = /^[a-f0-9]{12,64}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function parseContainerHost(value: unknown): string | undefined | null {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const host = value.trim();
  return host.length > 0 && host.length <= 128 ? host : null;
}

export function parseInboundWSMessage(raw: string): InboundWSMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(parsed) || typeof parsed.type !== 'string') {
    return null;
  }

  switch (parsed.type) {
    case 'subscribe_logs': {
      if (!isRecord(parsed.data) || typeof parsed.data.containerId !== 'string') {
        return null;
      }
      if (!VALID_ID.test(parsed.data.containerId)) {
        return null;
      }
      const host = parseContainerHost(parsed.data.host);
      if (host === null) {
        return null;
      }
      return {
        type: 'subscribe_logs',
        data: { containerId: parsed.data.containerId, ...(host ? { host } : {}) },
      };
    }
    case 'unsubscribe_logs':
      return { type: 'unsubscribe_logs' };
    case 'exec_start': {
      if (!isRecord(parsed.data) || typeof parsed.data.containerId !== 'string') {
        return null;
      }
      if (!VALID_ID.test(parsed.data.containerId)) {
        return null;
      }
      const host = parseContainerHost(parsed.data.host);
      if (host === null) {
        return null;
      }
      if (parsed.data.cmd !== undefined && !isStringArray(parsed.data.cmd)) {
        return null;
      }
      return {
        type: 'exec_start',
        data: {
          containerId: parsed.data.containerId,
          ...(host ? { host } : {}),
          cmd: parsed.data.cmd,
        },
      };
    }
    case 'exec_input': {
      if (!isRecord(parsed.data) || typeof parsed.data.text !== 'string') {
        return null;
      }
      return { type: 'exec_input', data: { text: parsed.data.text } };
    }
    case 'exec_resize': {
      if (!isRecord(parsed.data)) {
        return null;
      }
      return { type: 'exec_resize', data: parsed.data };
    }
    case 'exec_stop':
      return { type: 'exec_stop' };
    default:
      return null;
  }
}
