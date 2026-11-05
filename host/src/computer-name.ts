// The computer's name for the phone (GET /v1/capabilities computerName): on macOS the name the owner gave it in
// Sharing settings (scutil --get ComputerName), else the host name without its local-network suffix.
import { execFile } from 'node:child_process';
import { hostname as osHostname } from 'node:os';

export interface ComputerNameIo { platform: NodeJS.Platform; hostname: () => string; run: (file: string, args: string[]) => Promise<string> }
const run = (file: string, args: string[]) => new Promise<string>((resolve, reject) => execFile(file, args, { timeout: 2000 }, (error, stdout) => error ? reject(error) : resolve(String(stdout))));

export async function computerName(io: ComputerNameIo = { platform: process.platform, hostname: osHostname, run }): Promise<string> {
  if (io.platform === 'darwin') {
    try { const name = (await io.run('/usr/sbin/scutil', ['--get', 'ComputerName'])).trim(); if (name && !/[\x00-\x1f\x7f]/.test(name)) return name.slice(0, 128); } catch {}
  }
  return io.hostname().replace(/\.local\.?$/i, '').slice(0, 128);
}
