import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Compiles to dist/version.js — package.json sits one level up in both src/ and dist/
export const PKG_VERSION: string = JSON.parse(
  readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8'),
).version;

/** Latest published version from the npm registry, or null when offline/unavailable */
export async function fetchLatestVersion(timeoutMs = 3000): Promise<string | null> {
  try {
    const res = await fetch('https://registry.npmjs.org/dockscope/latest', {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      return null;
    }
    const data = (await res.json()) as { version?: string };
    return data.version || null;
  } catch {
    return null;
  }
}
