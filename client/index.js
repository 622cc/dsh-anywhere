import React from 'react';

const h = React.createElement;
const API = '/api/dsh-mobile';

async function request(path, init) {
  const response = await fetch(`${API}/${path}`, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...init,
    headers: { ...(init?.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(init?.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message ?? `Request failed (${response.status})`);
  return body;
}

const card = { border: '0.5px solid var(--dsw-alias-settings-card-stroke, #ddd)', borderRadius: 12, background: 'var(--dsw-alias-settings-card-fill, #fff)', padding: '12px 16px', marginBottom: 12 };
const section = { display: 'flex', flexDirection: 'column', gap: 12, color: 'var(--dsw-alias-label-primary, #111)', fontSize: 13, lineHeight: '22px', padding: '8px 0' };
const label = { color: 'var(--dsw-alias-label-tertiary, #777)', fontSize: 12 };
const button = { minHeight: 32, padding: '0 12px', borderRadius: 8, border: '0.5px solid var(--dsw-alias-border-l3, #ccc)', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 13 };
const primary = { ...button, background: 'var(--dsw-alias-button-primary-fill, #111)', color: 'var(--dsw-alias-label-primary-foreground, #fff)', borderColor: 'transparent' };
const danger = { ...button, color: 'var(--dsw-alias-state-error-primary, #b42318)' };

export const pairedPhones = (count) => `${count} paired ${count === 1 ? 'phone' : 'phones'}`;

function svgDataUrl(svg) {
  const bytes = new TextEncoder().encode(svg);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

function grantText(grants) {
  const read = grants?.readWorkspaceIds?.includes('*') ? 'all projects' : `${grants?.readWorkspaceIds?.length ?? 0} projects`;
  const execute = grants?.executeWorkspaceIds?.includes('*') ? 'can run tasks' : 'read-only';
  return `${read} · ${execute}`;
}

function MobileSection() {
  const [status, setStatus] = React.useState(undefined);
  const [devices, setDevices] = React.useState([]);
  const [qr, setQr] = React.useState(undefined);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');

  const refresh = React.useCallback(async () => {
    try {
      const [nextStatus, nextDevices] = await Promise.all([request('status'), request('devices')]);
      setStatus(nextStatus);
      setDevices(nextDevices.items ?? []);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  React.useEffect(() => { refresh(); }, [refresh]);
  React.useEffect(() => {
    if (qr === undefined) return undefined;
    const remaining = Math.max(0, qr.expiresAt - Date.now());
    const timer = setTimeout(() => setQr(undefined), remaining + 5000);
    return () => clearTimeout(timer);
  }, [qr]);

  // DSH Anywhere is the owner's phone: it reads every chat and drives agents, so a pairing grants all of DSH.
  const pair = async () => {
    if (!window.confirm('The phone will have full access to DSH on this Mac: every chat, and running agents. Continue?')) return;
    setBusy(true); setError(''); setQr(undefined);
    try {
      setQr(await request('pair', { method: 'POST', body: JSON.stringify({ execute: true }) }));
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  };

  const revoke = async (deviceId) => {
    if (!window.confirm('Revoke this phone? It loses access immediately.')) return;
    setBusy(true); setError('');
    try { await request('revoke', { method: 'POST', body: JSON.stringify({ deviceId }) }); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  const active = devices.filter(device => device.revokedAt === null);

  return h('div', { style: section },
    h('div', null,
      h('div', { style: { fontSize: 14, fontWeight: 500 } }, 'DSH Anywhere'),
      h('div', { style: label }, status === undefined ? 'Reading host state…' : `DSH ${status.dshVersion ?? ''} · ${pairedPhones(status.pairedPhones ?? active.length)} · ${status.transport === 'direct' ? 'Direct (same Wi-Fi)' : 'Tailcat'} ${status.running ? 'running' : 'not running'}`)
    ),
    error !== '' ? h('div', { style: { color: 'var(--dsw-alias-state-error-primary, #b42318)' } }, error) : null,
    h('div', { style: card },
      h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' } },
        h('button', { type: 'button', style: primary, disabled: busy || qr !== undefined, onClick: pair }, busy ? 'Making a pairing code…' : 'Pair a phone')
      ),
      h('div', { style: { ...label, marginTop: 8 } }, 'Open DSH Anywhere on the phone and scan the code. The phone sees every chat and can run agents here.'),
      qr === undefined ? null : h('div', { style: { marginTop: 12, display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' } },
        h('img', { src: svgDataUrl(qr.svg), alt: 'Pairing QR code', width: 260, height: 260, style: { display: 'block', background: '#fff', padding: 8, borderRadius: 8 } }),
        h('div', { style: { flex: '1 1 180px', minWidth: 180 } },
          h('div', { style: { fontWeight: 500 } }, 'Scan this in DSH Anywhere'),
          h('div', { style: label }, `One use, expires ${new Date(qr.expiresAt).toLocaleTimeString()}. Do not screenshot or share it.`),
          h('button', { type: 'button', style: { ...button, marginTop: 8 }, onClick: () => setQr(undefined) }, 'Hide code and start over')
        )
      )
    ),
    h('div', { style: card },
      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 } },
        h('div', { style: { fontWeight: 500 } }, 'Paired phones'),
        h('button', { type: 'button', style: button, disabled: busy, onClick: refresh }, 'Refresh')
      ),
      devices.length === 0 ? h('div', { style: label }, 'No phones paired yet.') : h('div', { style: { marginTop: 8 } },
        devices.map(device => h('div', { key: device.deviceId, style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '8px 0', borderTop: '0.5px solid var(--dsw-alias-border-l2, #eee)' } },
          h('div', { style: { minWidth: 0 } },
            h('div', { style: { fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, device.deviceName || 'Phone'),
            h('div', { style: label }, `${grantText(device.grants)} · paired ${new Date(device.createdAt).toLocaleString()}`),
            device.revokedAt === null ? null : h('div', { style: label }, `revoked ${new Date(device.revokedAt).toLocaleString()}`)
          ),
          device.revokedAt === null ? h('button', { type: 'button', style: danger, disabled: busy, onClick: () => revoke(device.deviceId) }, 'Revoke') : null
        ))
      )
    ),
    h('div', { style: label }, 'Pairing and revocation use the same local host state as the CLI. The phone connects through Tailcat; this Mac must stay awake.')
  );
}

/** The chat card for a show_interface call: the agent built a native interface; it opens in DSH Anywhere. */
export function InterfaceCard(props) {
  const block = props.block ?? {};
  const settled = props.phase !== 'preparing' && 'kind' in block;
  const raw = (settled ? block.call?.argsRaw : block.argsRaw) ?? '';
  let title = '';
  try { title = String(JSON.parse(raw).title ?? ''); } catch { title = /"title"\s*:\s*"([^"\\]{1,80})/.exec(raw)?.[1] ?? ''; }
  const state = !settled ? 'building' : block.isError ? 'failed' : 'ready';
  return h('div', { 'data-tool': 'show_interface', 'data-state': state, style: { ...card, display: 'flex', alignItems: 'center', gap: 12, margin: '4px 0', padding: '10px 14px' } },
    h('div', { style: { flex: 1, minWidth: 0 } },
      h('div', { style: { fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, title || 'Interface'),
      h('div', { style: label }, state === 'ready' ? 'Open it in DSH Anywhere on your phone' : state === 'failed' ? 'It did not build; the agent sees why' : 'Building…')
    )
  );
}

export const name = 'dsh-mobile-client';
export const inject = ['slots'];

export function apply(ctx) {
  ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'mobile',
    order: 60,
    label: () => 'Mobile',
  }, MobileSection)), 'dsh-mobile: settings section');
  ctx.effect(() => ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
    name: 'tool.call.toolview',
    key: 'show_interface',
  }, InterfaceCard)), 'dsh-mobile: show_interface card');
}
