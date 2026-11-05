// Folders on the computer for the phone's folder picker (the new-chat sheet's "Add workspace"). DSH Desktop composes its
// native directory picker when it runs on loopback with a display (dsh-host-directory-picker-auto 0.2.1-rc.3), so DSH's
// own directoryPicker/list refuses the phone there. These calls follow the contract of DSH's browse backend
// (dsh-host-directory-picker-browse 0.2.1-rc.3, lib/index.js): one level, directories only, name-sorted
// (localeCompare), links to directories followed and broken ones skipped, `hidden` = dot-prefixed, crumbs from the top
// to the folder (the top labelled by its full path), at most `maxEntries` rows with `truncated`, and one-segment
// non-recursive creation. Two differences, both narrower than DSH's: nothing outside the owner's home and the registered
// workspace folders (compared after resolving links, so neither ".." nor a link leads out), and a missing folder and a
// file are told apart (not-found, not-directory) where DSH says only "unreadable".
import { mkdir, opendir, realpath, stat } from 'node:fs/promises';
import { basename, dirname, join, posix, resolve, sep, win32 } from 'node:path';

export type FolderErrorCode = 'directory-picker/unreadable' | 'directory-picker/not-found' | 'directory-picker/not-directory'
  | 'directory-picker/outside-home' | 'directory-picker/exists' | 'directory-picker/create-failed';
/** A refusal the phone shows in its own words, by code; `path` is the folder it is about. */
export class FolderError extends Error {
  readonly code: FolderErrorCode;
  readonly path: string;
  constructor(code: FolderErrorCode, path: string, message: string) { super(message); this.name = 'FolderError'; this.code = code; this.path = path; }
}
export interface FolderEntry { name: string; path: string; hidden: boolean }
export interface FolderListing { path: string; home: string; crumbs: FolderEntry[]; entries: FolderEntry[]; truncated: boolean }
export type FolderCheck =
  | { path: string; state: 'directory' | 'not-directory' }
  | { path: string; state: 'missing'; parent: string; name: string; parentExists: boolean };
export interface Folders {
  list(path: string | undefined, signal: AbortSignal): Promise<FolderListing>;
  check(path: string): Promise<FolderCheck>;
  create(parent: string, name: string): Promise<{ path: string }>;
}
export interface FolderOptions {
  /** The owner's home folder: the default listing and the first place the phone may look. */
  home: string;
  /** The registered workspace folders, read at each call: the phone may look in them and below too. */
  roots: () => Promise<readonly string[]>;
  /** DSH's default bound (GitHub's web UI's): rows of one level, hidden ones included. */
  maxEntries?: number;
}

/** POSIX-absolute, or on Windows drive-qualified or complete UNC (dsh-host-directory-picker-browse `fullyQualified`). */
function fullyQualified(path: string): boolean {
  return process.platform === 'win32' ? win32.isAbsolute(path) && /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/]+[\\/]+[^\\/]+)/.test(path) : posix.isAbsolute(path);
}
const within = (path: string, top: string) => path === top || path.startsWith(top.endsWith(sep) ? top : top + sep);
const codeOf = (error: unknown) => (typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : '');
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
/** DSH's single-segment rule, plus no control characters (a name the phone could not show). */
const oneSegment = (name: string) => name.trim() !== '' && name !== '.' && name !== '..' && !/[/\\\x00-\x1f\x7f]/.test(name);

export function createFolders(options: FolderOptions): Folders {
  const maxEntries = options.maxEntries ?? 1000;
  const home = resolve(options.home);
  /** The tops the phone may look under, as asked (lexical) and as they are on disk (links resolved). */
  async function tops(): Promise<{ lexical: string; real: string }[]> {
    const all = [home, ...(await options.roots()).filter(fullyQualified).map(path => resolve(path))];
    const found: { lexical: string; real: string }[] = [];
    for (const lexical of all) { try { found.push({ lexical, real: await realpath(lexical) }); } catch { /* a workspace whose folder is gone */ } }
    return found;
  }
  function qualified(path: string, code: FolderErrorCode): string {
    if (!fullyQualified(path)) throw new FolderError(code, path, 'not a fully qualified path');
    return resolve(path);
  }
  /** The top a folder that exists lies in, after its links are resolved; refused when none. */
  async function topOf(target: string, real: string) {
    const all = await tops();
    if (!all.some(top => within(real, top.real))) throw new FolderError('directory-picker/outside-home', target, 'outside the home folder and the workspaces');
    // Crumbs follow the path as asked when it lies under a top as written, else the folder as it is on disk.
    const lexical = all.filter(top => within(target, top.lexical)).sort((a, b) => b.lexical.length - a.lexical.length)[0];
    if (lexical) return { top: lexical.lexical, path: target };
    const onDisk = all.filter(top => within(real, top.real)).sort((a, b) => b.real.length - a.real.length)[0]!;
    return { top: onDisk.real, path: real };
  }
  /** The nearest folder that exists at or above `target`, resolved, to decide whether `target` may be looked at. */
  async function existingAncestor(target: string): Promise<string> {
    for (let current = target; ; current = dirname(current)) {
      try { return await realpath(current); } catch (error) {
        if (codeOf(error) !== 'ENOENT' && codeOf(error) !== 'ENOTDIR') throw new FolderError('directory-picker/unreadable', target, messageOf(error));
        if (dirname(current) === current) throw new FolderError('directory-picker/unreadable', target, messageOf(error));
      }
    }
  }
  async function guard(target: string): Promise<void> {
    const real = await existingAncestor(target);
    const all = await tops();
    if (!all.some(top => within(real, top.real))) throw new FolderError('directory-picker/outside-home', target, 'outside the home folder and the workspaces');
  }
  function crumbs(top: string, path: string): FolderEntry[] {
    const chain: FolderEntry[] = [];
    for (let current = path; ; current = dirname(current)) {
      chain.unshift({ name: current === top ? current : basename(current), path: current, hidden: false });
      if (current === top || dirname(current) === current) return chain;
    }
  }
  /** Name-sorted window of at most `keep` candidates (dsh-host-directory-picker-browse `boundedInsert`). */
  function insert(window: { name: string; dir: boolean; link: boolean }[], candidate: { name: string; dir: boolean; link: boolean }, keep: number): boolean {
    if (window.length === keep && candidate.name.localeCompare(window[window.length - 1]!.name) >= 0) return true;
    let lo = 0, hi = window.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (candidate.name.localeCompare(window[mid]!.name) < 0) hi = mid; else lo = mid + 1; }
    window.splice(lo, 0, candidate);
    if (window.length <= keep) return false;
    window.pop(); return true;
  }

  return {
    async list(path, signal) {
      signal.throwIfAborted();
      const asked = path === undefined ? home : qualified(path, 'directory-picker/unreadable');
      let real: string;
      try { real = await realpath(asked); } catch (error) {
        await guard(asked);
        throw new FolderError(codeOf(error) === 'ENOENT' ? 'directory-picker/not-found' : codeOf(error) === 'ENOTDIR' ? 'directory-picker/not-directory' : 'directory-picker/unreadable', asked, messageOf(error));
      }
      const { top, path: target } = await topOf(asked, real);
      const window: { name: string; dir: boolean; link: boolean }[] = [];
      let truncated = false;
      try {
        if (!(await stat(real)).isDirectory()) throw new FolderError('directory-picker/not-directory', target, 'not a directory');
        const level = await opendir(real);
        try {
          for (;;) {
            signal.throwIfAborted();
            const dirent = await level.read();
            if (dirent === null) break;
            if (!dirent.isDirectory() && !dirent.isSymbolicLink()) continue;
            if (insert(window, { name: dirent.name, dir: dirent.isDirectory(), link: dirent.isSymbolicLink() }, maxEntries + 1)) truncated = true;
          }
        } finally { await level.close().catch(() => {}); }
      } catch (error) {
        signal.throwIfAborted();
        if (error instanceof FolderError) throw error;
        throw new FolderError('directory-picker/unreadable', target, messageOf(error));
      }
      const all = await tops();
      const entries: FolderEntry[] = [];
      for (const candidate of window) {
        signal.throwIfAborted();
        const child = join(target, candidate.name);
        if (candidate.link) {
          // A link is a row only when it leads to a folder the phone may enter.
          try {
            const to = await realpath(join(real, candidate.name));
            if (!(await stat(to)).isDirectory() || !all.some(top => within(to, top.real))) continue;
          } catch { continue; }
        }
        if (entries.length === maxEntries) { truncated = true; break; }
        entries.push({ name: candidate.name, path: child, hidden: candidate.name.startsWith('.') });
      }
      return { path: target, home, crumbs: crumbs(top, target), entries, truncated };
    },

    async check(path) {
      const target = qualified(path, 'directory-picker/unreadable');
      try {
        const real = await realpath(target);
        await topOf(target, real);
        return { path: target, state: (await stat(real)).isDirectory() ? 'directory' : 'not-directory' };
      } catch (error) {
        if (error instanceof FolderError) throw error;
        if (codeOf(error) === 'ENOTDIR') { await guard(target); return { path: target, state: 'not-directory' }; }
        if (codeOf(error) !== 'ENOENT') throw new FolderError('directory-picker/unreadable', target, messageOf(error));
      }
      await guard(target);
      const parent = dirname(target);
      let parentExists = false;
      try { parentExists = (await stat(parent)).isDirectory(); } catch { /* missing too */ }
      return { path: target, state: 'missing', parent, name: basename(target), parentExists };
    },

    async create(parentPath, name) {
      const parent = qualified(parentPath, 'directory-picker/create-failed');
      if (!oneSegment(name)) throw new FolderError('directory-picker/create-failed', join(parent, name), `"${name}" is not a single path segment`);
      let real: string;
      try { real = await realpath(parent); } catch (error) {
        await guard(parent);
        throw new FolderError('directory-picker/create-failed', join(parent, name), messageOf(error));
      }
      await topOf(parent, real);
      const target = join(parent, name);
      try { await mkdir(join(real, name)); return { path: target }; } catch (error) {
        if (codeOf(error) === 'EEXIST') throw new FolderError('directory-picker/exists', target, 'already exists');
        throw new FolderError('directory-picker/create-failed', target, messageOf(error));
      }
    },
  };
}
