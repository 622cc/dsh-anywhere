/** DSH ships a pre-release every other day. An exact list cut every phone off at each update, so the 0.2.1 line is
 * accepted whole: rc.3 → rc.5 changed none of the packages the adapter uses (only version numbers in them). A new minor line (0.2.2)
 * still needs inspection before it is added. */
const LINES = ['0.2.1'] as const;
const EXACT = ['0.2.0-rc.2'] as const;
const PLAIN = /^(\d+\.\d+\.\d+)(?:-(?:alpha|beta|rc)\.(?:0|[1-9]\d*))?$/;

/** `engines.dsh` of the install package (tools/pack-bundle.mjs): the same versions as isCompatibleDshVersion, as a
 * SemVer range. DSH checks it with prereleases included (dsh-app-boot evaluatePluginCompatibility) when the package
 * is added, at startup and for each row it inserts. `<x.y.z-alpha.a` bounds each tag to `alpha.<number>`. */
export const DSH_ENGINES_RANGE = [...EXACT, ...LINES.flatMap(line => [...['alpha', 'beta', 'rc'].map(tag => `>=${line}-${tag}.0 <${line}-${tag}.a`), line])].join(' || ');
export const SUPPORTED_DSH_VERSIONS = '0.2.0-rc.2 and every 0.2.1 release or pre-release';
export function isCompatibleDshVersion(value: string): boolean {
  if ((EXACT as readonly string[]).includes(value)) return true;
  const base = PLAIN.exec(value)?.[1];
  return base !== undefined && (LINES as readonly string[]).includes(base);
}
