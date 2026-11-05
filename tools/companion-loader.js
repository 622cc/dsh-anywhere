// DSH Mobile companion loader, installed once beside the versioned companions (tools/install-host.mjs).
// DSH's profile names this file and, in its config, the installed `version`. DSH applies a changed config by running
// the plugin again, but keeps a plugin's loaded code when only its file path changes: naming each version's own file
// kept the previous code running until DSH restarted. Here an update is a config change, and this imports that version.
export const name = 'dsh-mobile-companion';
export const inject = ['sessionController', 'agentPresets'];

export async function apply(ctx, config) {
  const { version, ...rest } = config ?? {};
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/.test(version)) throw new Error('dsh-mobile-companion: config.version must name an installed version');
  const plugin = await import(new URL(`./${version}/dist/plugin.js`, import.meta.url).href);
  return plugin.apply(ctx, rest);
}

export default { name, inject, apply };
