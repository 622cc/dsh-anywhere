// What happened to the companion inside DSH (starting, running, failed with an error code, stopping, stopped), one
// line per event in <config dir>/companion.log. DSH Desktop shows no plugin log; the installer reads this one to say
// whether an update is running. No secrets: versions, event names and error codes only.
import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const FILE = 'companion.log', MAX = 64 * 1024, KEEP = 32 * 1024;
export type LifecycleEvent = 'starting' | 'running' | 'failed' | 'stopping' | 'stopped';

export function lifecycleLog(dir: string): (event: LifecycleEvent, version: string, detail?: string) => void {
  const path = join(dir, FILE);
  return (event, version, detail) => {
    try {
      if (existsSync(path) && statSync(path).size > MAX) {
        const tail = readFileSync(path, 'utf8').slice(-KEEP);
        writeFileSync(path, tail.slice(tail.indexOf('\n') + 1), { mode: 0o600 });
      }
      appendFileSync(path, `${new Date().toISOString()} ${event} ${version}${detail ? ` ${detail.replace(/\s+/g, '_').slice(0, 64)}` : ''}\n`, { mode: 0o600 });
    } catch { /* diagnostics never stop the companion */ }
  };
}

export function lastLifecycle(dir: string, version: string): { event: LifecycleEvent; detail?: string; at: number } | undefined {
  let text = '';
  try { text = readFileSync(join(dir, FILE), 'utf8'); } catch { return undefined; }
  for (const line of text.trim().split('\n').reverse()) {
    const [at, event, v, detail] = line.split(' ');
    if (v === version && at && event) return { event: event as LifecycleEvent, ...(detail ? { detail } : {}), at: Date.parse(at) };
  }
  return undefined;
}
