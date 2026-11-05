// What the companion needs when DSH loads it from the bundle row (`dsh plugin add …/dsh-anywhere-darwin-arm64.tgz`),
// which carries no configuration: the private configuration path, the running DSH version and whether an
// install-host companion is already set up in the same profile.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

/** The path tools/install-host.mjs uses (its `base`), so both installs share one identity and one set of paired phones. */
export function defaultConfigPath(): string {
  const base = process.platform === 'darwin'
    ? join(homedir(), 'Library', 'Application Support', 'DSHMobile')
    : join(process.env.XDG_DATA_HOME && isAbsolute(process.env.XDG_DATA_HOME) ? process.env.XDG_DATA_HOME : join(homedir(), '.local', 'share'), 'DSHMobile');
  return join(base, 'host', 'host.json');
}

/** DSH's `profileContext` service (dsh/lib/profile-boot: runProfile provides it to every profile plugin). */
export interface ProfileFacts { readonly installAnchor?: unknown; readonly patchPath?: unknown }

/** The running DSH's version, read where DSH reads it. DSH 0.2.1-rc.3, inspected 2026-10-31 in the Desktop app.asar:
 * - dsh-app-boot `getDshRuntimeVersion()` is the `version` of dsh-app-boot's own package.json; DSH checks every
 *   plugin's `engines.dsh` against it (`evaluatePluginCompatibility`, at install, startup and each inserted row).
 * - runProfile provides `profileContext.installAnchor` = the installation's @deepseek-ai/dsh package.json (Desktop:
 *   `<runtime>/node_modules/@deepseek-ai/dsh/package.json`, dsh-desktop-host), and @deepseek-ai/dsh imports
 *   @deepseek-ai/dsh-app-boot, so resolving it from that anchor finds the copy DSH runs. app-boot exports ./package.json.
 * Undefined when there is no profile context or the package cannot be read; the caller fails closed. */
export function runningDshVersion(profile: ProfileFacts | undefined): string | undefined {
  const anchor = profile?.installAnchor;
  if (typeof anchor !== 'string' || !isAbsolute(anchor)) return undefined;
  try {
    const manifest = createRequire(anchor)('@deepseek-ai/dsh-app-boot/package.json') as { name?: unknown; version?: unknown };
    return manifest.name === '@deepseek-ai/dsh-app-boot' && typeof manifest.version === 'string' ? manifest.version : undefined;
  } catch { return undefined; }
}

/** tools/install-host.mjs writes its companion between these markers in the profile's cordis.patch.yml. */
export const LEGACY_BEGIN = '# DSH-MOBILE-COMPANION-BEGIN';
/** Whether the profile patch holds an install-host companion block. Both companions would share the private
 * configuration (port, state, Tailcat node), so the bundle row stands down while that block exists. */
export function legacyCompanionActive(profile: ProfileFacts | undefined): boolean {
  const path = profile?.patchPath;
  if (typeof path !== 'string' || !isAbsolute(path)) return false;
  let text: string;
  try { text = readFileSync(path, 'utf8'); } catch { return false; }
  return text.split(/\r?\n/).some(line => line.startsWith(LEGACY_BEGIN));
}
