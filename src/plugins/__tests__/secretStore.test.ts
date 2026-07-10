import { mkdtemp, readFile, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { JsonPluginSecretStore } from '../secretStore';

async function secretFile(): Promise<string> {
  return path.join(await mkdtemp(path.join(tmpdir(), 'dockscope-secrets-')), 'secrets.json');
}

describe('JsonPluginSecretStore', () => {
  it('encrypts new secret values when a local key is configured', async () => {
    const filePath = await secretFile();
    const store = new JsonPluginSecretStore(filePath, 'local-key');

    await store.set('plugin.demo', 'token', 'secret-token');

    const raw = await readFile(filePath, 'utf-8');
    expect(raw).not.toContain('secret-token');
    await expect(store.get('plugin.demo', 'token')).resolves.toBe('secret-token');
    await expect(store.has('plugin.demo', 'token')).resolves.toBe(true);
  });

  it('keeps reading existing plaintext secret values', async () => {
    const filePath = await secretFile();
    await writeFile(filePath, JSON.stringify({ 'plugin.demo': { token: 'old-secret' } }), 'utf-8');
    const store = new JsonPluginSecretStore(filePath, 'local-key');

    await expect(store.get('plugin.demo', 'token')).resolves.toBe('old-secret');
  });
});
