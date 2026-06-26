import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface PackageManifest {
  name?: string;
  version?: string;
}

/**
 * Application name and version, resolved once at startup from package.json.
 * Falls back to safe defaults if the manifest cannot be read.
 */
function readManifest(): Required<PackageManifest> {
  try {
    const raw = readFileSync(resolve(process.cwd(), 'package.json'), 'utf8');
    const parsed = JSON.parse(raw) as PackageManifest;
    return {
      name: parsed.name ?? 'myqueue',
      version: parsed.version ?? '0.0.0',
    };
  } catch {
    return { name: 'myqueue', version: '0.0.0' };
  }
}

const manifest = readManifest();

export const appInfo = Object.freeze({
  name: manifest.name,
  version: manifest.version,
});
