import { mkdir, mkdtemp, readFile, writeFile } from 'fs/promises';
import { generateKeyPairSync } from 'crypto';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { createPluginPackageFromPath, extractPluginPackage, verifyPluginPackage } from '../package';

async function createPluginDir(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'dockscope-package-'));
  const pluginDir = path.join(root, 'plugin');
  await mkdir(pluginDir);
  await writeFile(
    path.join(pluginDir, 'plugin.json'),
    JSON.stringify({
      id: 'package.demo',
      name: 'Package Demo',
      version: '1.0.0',
      dockscopeApiVersion: '1',
      entry: './plugin.mjs',
      capabilities: ['source.graph'],
      permissions: [],
    }),
    'utf-8',
  );
  await writeFile(
    path.join(pluginDir, 'plugin.mjs'),
    'export default function createPlugin({ manifest }) { return { manifest }; }',
    'utf-8',
  );
  return pluginDir;
}

describe('plugin packages', () => {
  it('creates, verifies, signs, and extracts plugin packages', async () => {
    const pluginDir = await createPluginDir();
    const outFile = path.join(
      await mkdtemp(path.join(tmpdir(), 'dockscope-package-out-')),
      'p.json',
    );
    const targetDir = path.join(
      await mkdtemp(path.join(tmpdir(), 'dockscope-package-target-')),
      'plugin',
    );

    const bundle = await createPluginPackageFromPath({
      sourcePath: pluginDir,
      outFile,
      signingKey: 'local-key',
    });
    const verified = await verifyPluginPackage(outFile, { signingKey: 'local-key' });
    await extractPluginPackage(verified, targetDir);

    expect(bundle.signature?.algorithm).toBe('hmac-sha256');
    expect(verified.signatureVerified).toBe(true);
    await expect(readFile(path.join(targetDir, 'plugin.mjs'), 'utf-8')).resolves.toContain(
      'createPlugin',
    );
  });

  it('rejects packages with the wrong signing key', async () => {
    const pluginDir = await createPluginDir();
    const outFile = path.join(
      await mkdtemp(path.join(tmpdir(), 'dockscope-package-out-')),
      'p.json',
    );

    await createPluginPackageFromPath({
      sourcePath: pluginDir,
      outFile,
      signingKey: 'local-key',
    });

    await expect(verifyPluginPackage(outFile, { signingKey: 'wrong-key' })).rejects.toThrow(
      'Plugin package signature mismatch',
    );
  });

  it('creates and verifies Ed25519 signed plugin packages', async () => {
    const pluginDir = await createPluginDir();
    const outFile = path.join(
      await mkdtemp(path.join(tmpdir(), 'dockscope-package-out-')),
      'p.json',
    );
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');

    const bundle = await createPluginPackageFromPath({
      sourcePath: pluginDir,
      outFile,
      privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      keyId: 'test-key',
    });
    const verified = await verifyPluginPackage(outFile, {
      publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    });

    expect(bundle.signature).toMatchObject({ algorithm: 'ed25519', keyId: 'test-key' });
    expect(verified.signatureVerified).toBe(true);
  });
});
