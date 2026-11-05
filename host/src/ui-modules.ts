// Generative UI: the DSH agent writes an NSH TSX module, the companion type-checks it (`nsh check`), builds and signs
// it (`nsh publish`) with a release key its own root certified, and keeps the package for the paired phone, which
// verifies it against that root and runs it in a sandboxed view.
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const APP_PREFIX = 'dev.dshmobile.ui.';
export const MAX_SOURCE = 64 * 1024;
/** The app's palette (nsh-app/nsh.json), so a module looks like the app that opens it. */
const THEME = {
  light: { background: '#F7F7F4', foreground: '#26251E', card: '#F2F1ED', primary: '#26251E', 'primary-foreground': '#F7F7F4', secondary: '#EBEAE5', muted: '#F2F1ED', 'muted-foreground': '#7A7974', border: '#DFDFDB', destructive: '#CF2D56' },
  dark: { background: '#14120B', foreground: '#EDECEC', card: '#1B1913', primary: '#EDECEC', 'primary-foreground': '#14120B', secondary: '#26241E', muted: '#1B1913', 'muted-foreground': '#97958F', border: '#2B2A24', destructive: '#CF2D56' },
};

/**
 * The compiler resolves imports on this computer, so a module importing a local file would carry it to the phone.
 * Only the NSH runtime may be imported; any other loading token left after removing those imports is refused.
 */
export function importProblem(source: string): string | null {
  const rest = source.replace(/\bimport\s+(?:type\s+)?(?:[^;]*?\s+from\s*)?(['"])nsh(?:\/base)?\1/g, '');
  if (/\b(?:import|require)\b/.test(rest) || /\bfrom\s*['"`]/.test(rest) || /\/\/\/\s*<reference\b/.test(source)) return 'the module may only import from "nsh" and "nsh/base"';
  return null;
}

export type CreateResult = { ok: true } | { ok: false; errors: string };
export interface UiModules {
  create(callId: string, input: { title: string; source: string }): Promise<CreateResult>;
  /** The signed package for a tool call, if it was built. */
  packagePath(callId: string): string | undefined;
  rootKey(): Promise<string>;
}

export function createUiModules(options: { dir: string; nsh: string }): UiModules {
  const keys = join(options.dir, 'keys'), modules = join(options.dir, 'modules');
  const file = (callId: string) => join(modules, `${Buffer.from(callId).toString('base64url')}.nshpkg`);
  const run = (args: string[], cwd: string) => new Promise<{ ok: boolean; out: string }>(resolve => {
    execFile(options.nsh, args, { cwd, timeout: 60_000, maxBuffer: 4 << 20, env: { ...process.env, NO_COLOR: '1' } }, (error, stdout, stderr) => {
      const out = `${stdout}${stderr}`.replace(/\x1b\[[0-9;]*m/g, '').trim();
      resolve({ ok: !error, out: error && !out ? error.message : out });
    });
  });
  let ready: Promise<void> | undefined;
  const ensureKeys = () => ready ??= (async () => {
    await mkdir(keys, { recursive: true, mode: 0o700 });
    for (const name of ['root', 'release']) if (!existsSync(join(keys, `${name}.secret`))) {
      const made = await run(['keygen', join(keys, name)], keys);
      if (!made.ok) throw new Error(made.out);
    }
    if (!existsSync(join(keys, 'release.cert'))) {
      const cert = await run(['certify', '--root', join(keys, 'root.secret'), '--key', join(keys, 'release.pub'), '--apps', `${APP_PREFIX}*`, '--days', '3650', '-o', join(keys, 'release.cert')], keys);
      if (!cert.ok) throw new Error(cert.out);
    }
  })().catch(error => { ready = undefined; throw error; });

  return {
    async create(callId, input) {
      const problem = importProblem(input.source);
      if (problem) return { ok: false, errors: problem };
      if (Buffer.byteLength(input.source) > MAX_SOURCE) return { ok: false, errors: `the module is larger than ${MAX_SOURCE} bytes` };
      await ensureKeys();
      const id = `m${randomBytes(6).toString('hex')}`, dir = join(modules, id);
      await mkdir(dir, { recursive: true });
      try {
        await writeFile(join(dir, 'App.tsx'), input.source);
        await writeFile(join(dir, 'nsh.json'), JSON.stringify({ name: input.title.trim().slice(0, 80) || 'Interface', id: APP_PREFIX + id, version: '1.0.0', build: 1, appearance: 'system', theme: { cssVars: THEME } }));
        await writeFile(join(dir, 'tsconfig.json'), JSON.stringify({ extends: './.nsh/tsconfig.json', compilerOptions: { allowImportingTsExtensions: true }, include: ['App.tsx'] }));
        const check = await run(['check', dir], dir);
        if (!check.ok) return { ok: false, errors: check.out || 'type check failed' };
        const pkg = join(dir, 'module.nshpkg');
        const publish = await run(['publish', dir, '--key', join(keys, 'release.secret'), '--cert', join(keys, 'release.cert'), '-o', pkg, '--source-map', 'none'], dir);
        if (!publish.ok) return { ok: false, errors: publish.out || 'build failed' };
        await rename(pkg, file(callId));
        await chmod(file(callId), 0o600);
        return { ok: true };
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    packagePath: callId => (existsSync(file(callId)) ? file(callId) : undefined),
    async rootKey() { await ensureKeys(); return (await readFile(join(keys, 'root.pub'), 'utf8')).trim(); },
  };
}

/**
 * The model-facing tool, as a plain DSH tool definition (the shape `ctx.tools.register` takes; DSH's own
 * `defineTool` builds the same object). Registered on the host registry, every agent inherits it.
 */
export function uiTool(modules: UiModules) {
  return {
    name: 'show_interface',
    description: 'Show the user a small native interface in DSH Anywhere, their phone app, when it serves them better than text: options to compare and pick, a calculator, a checklist, a form. '
      + 'Write one NSH TSX file (docs: https://nsh.dev/llms.txt). Import only from "nsh" and "nsh/base" and end with mount(App). Style with Tailwind classes and the theme tokens '
      + 'bg-background, text-foreground, bg-card, border-border, text-muted-foreground, bg-primary, text-primary-foreground. Keep it to one screen. '
      + 'The phone shows a card the user taps to open it. A type or build error comes back as the result: fix the file and call again.',
    parameters: {
      type: 'object', additionalProperties: false, required: ['title', 'source'],
      properties: {
        title: { type: 'string', description: 'A few words, shown on the card.' },
        source: { type: 'string', description: 'The whole App.tsx.' },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, required: ['title'], properties: { title: { type: 'string' } } },
      render: (_args: unknown, value: { title: string }) => [{ type: 'text' as const, text: `Built "${value.title}". The user can open it in DSH Anywhere.` }],
    },
    timeoutMs: 120_000,
    async execute(args: { title?: unknown; source?: unknown }, exec: { callId: string }) {
      if (typeof args.title !== 'string' || typeof args.source !== 'string') throw new Error('show_interface needs a title and a source string');
      const result = await modules.create(exec.callId, { title: args.title, source: args.source });
      if (!result.ok) throw new Error(result.errors);
      return { title: args.title };
    },
  };
}
