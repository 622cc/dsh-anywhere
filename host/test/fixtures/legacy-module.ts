import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Execute the actual shipped 0.7.0 source, without copying a second implementation into fixtures. */
export async function legacyModule(name: 'state' | 'dsh-adapter', t: { after(fn: () => void): void }): Promise<any> {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const source = execFileSync('git', ['show', `2168cf4:host/src/${name}.ts`], { cwd: root, encoding: 'utf8' })
    // 0.7.0 re-exported the exact version list that the 0.2.1 range replaced; nothing in the replay reads it.
    .replace(/^export \{ COMPATIBLE_DSH_VERSIONS \} from '\.\/compatibility\.ts';$/m, '')
    .replace(/from '(.\/[^']+)'/g, (_match, relative: string) => `from '${new URL(relative, new URL('../../src/', import.meta.url)).href}'`);
  const dir = mkdtempSync(join(tmpdir(), 'mobile-070-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, `${name}.ts`); writeFileSync(path, source);
  return import(new URL(`file:///${path.replaceAll('\\', '/')}`).href);
}
