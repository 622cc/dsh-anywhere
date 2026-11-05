import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** True when moduleUrl is the script Node started, also through a symlinked path (macOS /var, /tmp). */
export function isEntryPoint(moduleUrl: string): boolean {
  const script = process.argv[1];
  if (!script) return false;
  try { return pathToFileURL(realpathSync(script)).href === moduleUrl; } catch { return false; }
}
