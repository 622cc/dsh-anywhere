// Deterministic IPC v3 fake of dsh-tailcat-host (docs/TAILCAT.md). Synthetic keys only.
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const log = value => { if (process.env.FAKE_TAILCAT_LOG) appendFileSync(process.env.FAKE_TAILCAT_LOG, JSON.stringify(value) + '\n'); };
const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
const NORMAL = 'tcfake-normal-address', PAIRING = 'tcfake-pairing-address';
let state = null, allowed = [], serial = 0, buffer = '';
const pendingAcks = new Map();

function persist() {
  const id = String(++serial);
  emit({ event: 'persist', id, state, allowedClients: allowed });
  return new Promise(resolve => pendingAcks.set(id, resolve));
}
async function setAllowed(keys) {
  allowed = [...keys];
  if (!(await persist())) { emit({ event: 'error', code: 'operation-failed' }); return; }
  emit({ event: 'ready', address: allowed.length ? NORMAL : '' });
}
async function command(message) {
  if (message.version === 3) {
    state = message.state ?? 'fake-node-state-1';
    allowed = message.allowedClients;
    if (process.env.FAKE_TAILCAT_CRASH_ONCE && !existsSync(process.env.FAKE_TAILCAT_CRASH_ONCE)) {
      writeFileSync(process.env.FAKE_TAILCAT_CRASH_ONCE, 'crashed');
      setTimeout(() => process.exit(3), 50);
      return;
    }
    if (allowed.length) await setAllowed(allowed); else { if (message.state === null) await persist(); emit({ event: 'ready', address: '' }); }
    return;
  }
  if (message.command === 'ack') {
    if (process.env.FAKE_TAILCAT_DB) {
      // Proves ack-after-commit: the host's committed row is visible from another connection.
      const db = new DatabaseSync(process.env.FAKE_TAILCAT_DB, { readOnly: true });
      try { log({ ack: message.id, ok: message.ok, committedState: db.prepare('SELECT state FROM tailcat_state WHERE id=1').get()?.state ?? null }); } finally { db.close(); }
    }
    pendingAcks.get(message.id)?.(message.ok); pendingAcks.delete(message.id);
  } else if (message.command === 'pair') {
    emit({ event: 'pairing', address: PAIRING, port: 48932, key: 'privkey:' + '1'.repeat(64), proof: 'P'.repeat(43), expiresAt: Math.floor(Date.now() / 1000) + 120 });
    const phone = process.env.FAKE_TAILCAT_AUTOPAIR;
    if (phone) setTimeout(async () => {
      if (!allowed.includes(phone)) { allowed = [...allowed, phone]; if (!(await persist())) return; }
      emit({ event: 'paired', address: NORMAL, client: phone });
    }, 50);
  } else if (message.command === 'cancelPairing') emit({ event: 'pairingClosed' });
  else if (message.command === 'setAllowed') await setAllowed(message.allowedClients);
  else emit({ event: 'error', code: 'invalid-command' });
}
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  for (let index = buffer.indexOf('\n'); index >= 0; index = buffer.indexOf('\n')) {
    const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
    const message = JSON.parse(line); log({ received: message });
    void command(message);
  }
});
process.stdin.on('end', () => process.exit(0));
