import { readFile } from 'fs/promises';
import { parse } from 'yaml';

type ComposeObject = Record<string, unknown>;

interface ComposeDocument {
  services?: Record<string, ComposeServiceSpec>;
  networks?: ComposeObject;
}

interface ComposeServiceSpec {
  image?: unknown;
  ports?: unknown;
  networks?: unknown;
  depends_on?: unknown;
  volumes?: unknown;
  environment?: unknown;
  labels?: unknown;
  healthcheck?: unknown;
  deploy?: unknown;
}

interface ComposeHealthcheckSpec {
  test?: unknown;
  interval?: unknown;
  timeout?: unknown;
  retries?: unknown;
}

interface ComposeResourceLimitsSpec {
  cpus?: unknown;
  memory?: unknown;
}

interface ComposeDeploySpec {
  resources?: {
    limits?: ComposeResourceLimitsSpec;
  };
}

export interface ComposeService {
  name: string;
  image: string;
  ports: string[];
  networks: string[];
  dependsOn: string[];
  volumes: string[];
  environment: Record<string, string>;
  labels: Record<string, string>;
  healthcheck: { test: string; interval?: string; timeout?: string; retries?: number } | null;
  resourceLimits: { cpus?: string; memory?: string } | null;
}

export interface ComposeData {
  services: ComposeService[];
  networks: string[];
}

export async function parseComposeFile(filePath: string): Promise<ComposeData> {
  const content = await readFile(filePath, 'utf-8');
  const compose = parseComposeDocument(parse(content));

  if (!compose?.services) {
    return { services: [], networks: [] };
  }

  const services: ComposeService[] = [];

  for (const [name, svc] of Object.entries(compose.services)) {
    const dependsOn = parseDependsOn(svc.depends_on);

    services.push({
      name,
      image: typeof svc.image === 'string' && svc.image ? svc.image : `${name}:latest`,
      ports: Array.isArray(svc.ports) ? svc.ports.map(String) : [],
      networks: parseNetworks(svc.networks),
      dependsOn,
      volumes: Array.isArray(svc.volumes) ? svc.volumes.map(String) : [],
      environment: parseEnvironment(svc.environment),
      labels: parseLabels(svc.labels),
      healthcheck: parseHealthcheck(svc.healthcheck),
      resourceLimits: parseResourceLimits(svc.deploy),
    });
  }

  const topLevelNetworks = compose.networks ? Object.keys(compose.networks) : [];

  return { services, networks: topLevelNetworks };
}

function isObject(value: unknown): value is ComposeObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseComposeDocument(value: unknown): ComposeDocument | null {
  if (!isObject(value)) {
    return null;
  }
  const services = isObject(value.services)
    ? Object.fromEntries(
        Object.entries(value.services)
          .filter((entry): entry is [string, ComposeServiceSpec] => isObject(entry[1]))
          .map(([name, service]) => [name, service]),
      )
    : undefined;
  return {
    services,
    networks: isObject(value.networks) ? value.networks : undefined,
  };
}

function parseDependsOn(dep: unknown): string[] {
  if (!dep) {
    return [];
  }
  // Simple form: depends_on: [db, redis]
  if (Array.isArray(dep)) {
    return dep.map(String);
  }
  // Extended form: depends_on: { db: { condition: service_healthy } }
  if (typeof dep === 'object') {
    return Object.keys(dep);
  }
  return [];
}

function parseNetworks(nets: unknown): string[] {
  if (!nets) {
    return [];
  }
  if (Array.isArray(nets)) {
    return nets.map(String);
  }
  if (typeof nets === 'object') {
    return Object.keys(nets as object);
  }
  return [];
}

function parseEnvironment(env: unknown): Record<string, string> {
  if (!env) {
    return {};
  }
  if (Array.isArray(env)) {
    const result: Record<string, string> = {};
    for (const item of env) {
      const s = String(item);
      const eqIdx = s.indexOf('=');
      if (eqIdx > 0) {
        result[s.substring(0, eqIdx)] = s.substring(eqIdx + 1);
      } else {
        result[s] = '';
      }
    }
    return result;
  }
  if (typeof env === 'object') {
    return Object.fromEntries(
      Object.entries(env as Record<string, unknown>).map(([k, v]) => [k, String(v ?? '')]),
    );
  }
  return {};
}

function parseLabels(labels: unknown): Record<string, string> {
  if (!labels) {
    return {};
  }
  if (Array.isArray(labels)) {
    const result: Record<string, string> = {};
    for (const item of labels) {
      const s = String(item);
      const eqIdx = s.indexOf('=');
      if (eqIdx > 0) {
        result[s.substring(0, eqIdx)] = s.substring(eqIdx + 1);
      }
    }
    return result;
  }
  if (typeof labels === 'object') {
    return Object.fromEntries(
      Object.entries(labels as Record<string, unknown>).map(([k, v]) => [k, String(v ?? '')]),
    );
  }
  return {};
}

function parseHealthcheck(hc: unknown): ComposeService['healthcheck'] {
  if (!isObject(hc)) {
    return null;
  }
  const h: ComposeHealthcheckSpec = hc;
  const test = Array.isArray(h.test) ? h.test.join(' ') : String(h.test || '');
  if (!test) {
    return null;
  }
  return {
    test,
    interval: typeof h.interval === 'string' ? h.interval : undefined,
    timeout: typeof h.timeout === 'string' ? h.timeout : undefined,
    retries: typeof h.retries === 'number' ? h.retries : undefined,
  };
}

function parseResourceLimits(deploy: unknown): ComposeService['resourceLimits'] {
  if (!isObject(deploy)) {
    return null;
  }
  const d: ComposeDeploySpec = deploy;
  const limits = d.resources?.limits;
  if (!limits) {
    return null;
  }
  return {
    cpus: limits.cpus ? String(limits.cpus) : undefined,
    memory: limits.memory ? String(limits.memory) : undefined,
  };
}
