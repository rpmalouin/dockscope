import type { PluginCapability } from './capabilities.js';

export const PLUGIN_UI_SLOTS = [
  'toolbar',
  'sidebar',
  'nodePanel',
  'graphOverlay',
  'settings',
] as const;

export type PluginUiSlot = (typeof PLUGIN_UI_SLOTS)[number];

export interface PluginUiContent {
  type: 'text' | 'markdown';
  body: string;
}

export type PluginUiAction =
  | {
      type: 'open_url';
      url: string;
    }
  | {
      type: 'run_command';
      pluginId?: string;
      commandId: string;
    };

export interface PluginOpenUrlAction {
  type: 'open_url';
  url: string;
}

export interface PluginUiExtensionDeclaration {
  id: string;
  slot: PluginUiSlot;
  title: string;
  description?: string;
  icon?: string;
  order?: number;
  content?: PluginUiContent;
  action?: PluginUiAction;
}

export interface PluginUiExtension extends PluginUiExtensionDeclaration {
  pluginId: string;
}

const UI_SLOT_SET = new Set<string>(PLUGIN_UI_SLOTS);
const UI_ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_.-]*$/;

const UI_CAPABILITY_BY_SLOT: Record<PluginUiSlot, PluginCapability> = {
  toolbar: 'ui.toolbarAction',
  sidebar: 'ui.sidebarPanel',
  nodePanel: 'ui.nodePanel',
  graphOverlay: 'ui.graphOverlay',
  settings: 'ui.settings',
};

export class PluginUiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PluginUiError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isNonEmptyString(value)) {
    throw new PluginUiError(`Plugin UI field "${field}" must be a non-empty string`);
  }
  return value;
}

function isPluginUiSlot(value: unknown): value is PluginUiSlot {
  return typeof value === 'string' && UI_SLOT_SET.has(value);
}

function validatePluginUiContent(raw: unknown, extensionId: string): PluginUiContent | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!isRecord(raw)) {
    throw new PluginUiError(`Plugin UI content for "${extensionId}" must be an object`);
  }
  if (raw.type !== 'text' && raw.type !== 'markdown') {
    throw new PluginUiError(`Plugin UI content for "${extensionId}" has an unsupported type`);
  }
  if (!isNonEmptyString(raw.body)) {
    throw new PluginUiError(`Plugin UI content for "${extensionId}" requires a body`);
  }
  return { type: raw.type, body: raw.body };
}

function validatePluginUiAction(raw: unknown, extensionId: string): PluginUiAction | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!isRecord(raw)) {
    throw new PluginUiError(`Plugin UI action for "${extensionId}" must be an object`);
  }
  if (raw.type === 'run_command') {
    if (!isNonEmptyString(raw.commandId)) {
      throw new PluginUiError(`Plugin UI action for "${extensionId}" requires a commandId`);
    }
    return {
      type: 'run_command',
      pluginId: optionalString(raw.pluginId, `${extensionId}.pluginId`),
      commandId: raw.commandId,
    };
  }
  if (raw.type !== 'open_url') {
    throw new PluginUiError(`Plugin UI action for "${extensionId}" has an unsupported type`);
  }
  if (!isNonEmptyString(raw.url)) {
    throw new PluginUiError(`Plugin UI action for "${extensionId}" requires a url`);
  }
  const parsed = new URL(raw.url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new PluginUiError(`Plugin UI action for "${extensionId}" requires an http(s) url`);
  }
  return { type: raw.type, url: raw.url };
}

function validatePluginUiExtension(raw: unknown): PluginUiExtensionDeclaration {
  if (!isRecord(raw)) {
    throw new PluginUiError('Plugin UI extensions must be objects');
  }
  if (!isNonEmptyString(raw.id)) {
    throw new PluginUiError('Plugin UI extension field "id" is required');
  }
  if (!UI_ID_PATTERN.test(raw.id)) {
    throw new PluginUiError(`Invalid plugin UI extension id: ${raw.id}`);
  }
  if (!isPluginUiSlot(raw.slot)) {
    throw new PluginUiError(`Unsupported plugin UI slot: ${String(raw.slot)}`);
  }
  if (!isNonEmptyString(raw.title)) {
    throw new PluginUiError(`Plugin UI extension "${raw.id}" requires a title`);
  }
  const order = raw.order;
  if (order !== undefined && (typeof order !== 'number' || !Number.isFinite(order))) {
    throw new PluginUiError(`Plugin UI extension "${raw.id}" order must be a number`);
  }
  return {
    id: raw.id,
    slot: raw.slot,
    title: raw.title,
    description: optionalString(raw.description, `${raw.id}.description`),
    icon: optionalString(raw.icon, `${raw.id}.icon`),
    order,
    content: validatePluginUiContent(raw.content, raw.id),
    action: validatePluginUiAction(raw.action, raw.id),
  };
}

export function validatePluginUiExtensions(raw: unknown): PluginUiExtensionDeclaration[] {
  if (raw === undefined) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new PluginUiError('Plugin UI extensions must be an array');
  }
  return raw.map(validatePluginUiExtension);
}

export function pluginUiSlotCapability(slot: PluginUiSlot): PluginCapability {
  return UI_CAPABILITY_BY_SLOT[slot];
}

export function hydratePluginUiExtension(
  pluginId: string,
  declaration: PluginUiExtensionDeclaration,
): PluginUiExtension {
  return {
    ...declaration,
    pluginId,
  };
}
