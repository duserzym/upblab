// One-time owner setup. Generates a key, writes its public half, and sets the repository secret.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const root = new URL('../', import.meta.url);
const confPath = new URL('src-tauri/tauri.conf.json', root);
const conf = JSON.parse(readFileSync(confPath, 'utf8'));
if (conf.plugins.updater.pubkey?.trim() && !process.argv.includes('--force')) {
  throw new Error('Updater pubkey is already configured. Use --force to replace it.');
}
const dir = join(homedir(), '.tauri');
const key = join(dir, 'upblab-updater.key');
mkdirSync(dir, { recursive: true });
if (!existsSync(key)) {
  const cargo = spawnSync('cargo', ['tauri', '--version'], { stdio: 'ignore' });
  const args = ['signer', 'generate', '-w', key, '-p', '', '--ci'];
  const generated = cargo.status === 0
    ? spawnSync('cargo', ['tauri', ...args], { stdio: 'inherit' })
    : spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--yes', '@tauri-apps/cli@^2', ...args], { stdio: 'inherit' });
  if (generated.error || generated.status !== 0) throw generated.error ?? new Error('Signing key generation failed');
} else {
  console.log(`Using existing key ${key}`);
}
const pub = readFileSync(`${key}.pub`, 'utf8').trim();
conf.plugins.updater.pubkey = pub;
writeFileSync(confPath, JSON.stringify(conf, null, 2) + '\n');
console.log('Public key written to src-tauri/tauri.conf.json. Commit that change.');
const secret = spawnSync('gh', ['secret', 'set', 'TAURI_SIGNING_PRIVATE_KEY', '--repo', 'duserzym/upblab'], {
  input: readFileSync(key), stdio: ['pipe', 'inherit', 'inherit'], cwd: root,
});
if (secret.error || secret.status !== 0) {
  console.log(`Could not set the secret automatically. Add the contents of ${key} as the repository secret TAURI_SIGNING_PRIVATE_KEY.`);
} else {
  console.log('GitHub secret TAURI_SIGNING_PRIVATE_KEY set.');
}
console.log('Back up the private key. Losing it means installed copies cannot verify future updates.');
