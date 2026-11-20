// Build a release feed only after verifying both minisign signatures locally.
import { createHash, createPublicKey, verify } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
function decode(value, label) {
  if (!value || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error(`Invalid base64 in ${label}`);
  }
  return Buffer.from(value, 'base64');
}

export async function verifyArtifact(path, signature, pubkey) {
  if (!pubkey?.trim()) throw new Error('Updater pubkey is empty');
  const pubLines = decode(pubkey.trim(), 'pubkey').toString('utf8').trimEnd().split(/\r?\n/);
  if (pubLines.length !== 2 || !pubLines[0].startsWith('untrusted comment: ')) throw new Error('Invalid minisign pubkey');
  const pub = decode(pubLines[1], 'public key packet');
  if (pub.length !== 42 || pub.subarray(0, 2).toString() !== 'Ed') throw new Error('Invalid minisign public key packet');
  const lines = decode(signature.trim(), 'signature').toString('utf8').trimEnd().split(/\r?\n/);
  if (lines.length !== 4 || !lines[0].startsWith('untrusted comment: ') || !lines[2].startsWith('trusted comment: ')) {
    throw new Error('Invalid minisign signature file');
  }
  const packet = decode(lines[1], 'signature packet');
  const algorithm = packet.subarray(0, 2).toString();
  if (packet.length !== 74 || !['ED', 'Ed'].includes(algorithm)) throw new Error('Invalid minisign signature packet');
  if (!pub.subarray(2, 10).equals(packet.subarray(2, 10))) throw new Error('Minisign key ids do not match');
  // RFC 8410 SubjectPublicKeyInfo prefix for an Ed25519 raw public key.
  const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), pub.subarray(10)]), format: 'der', type: 'spki' });
  let data;
  if (algorithm === 'ED') {
    const hash = createHash('blake2b512');
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    data = hash.digest();
  } else data = await readFile(path);
  const sig = packet.subarray(10);
  if (!verify(null, data, key, sig)) throw new Error(`Artifact signature did not verify: ${basename(path)}`);
  const global = decode(lines[3], 'global signature');
  const comment = Buffer.from(lines[2].slice('trusted comment: '.length));
  if (global.length !== 64 || !verify(null, Buffer.concat([sig, comment]), key, global)) {
    throw new Error(`Global signature did not verify: ${basename(path)}`);
  }
}

export async function releaseFeed({ version, platforms, out, root = repoRoot }) {
  const config = JSON.parse(await readFile(resolve(root, 'src-tauri/tauri.conf.json'), 'utf8'));
  version ??= config.version;
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Version must be a stable x.y.z version');
  const pubkey = config.plugins?.updater?.pubkey;
  if (!pubkey?.trim()) throw new Error('Updater pubkey is empty');
  const rawNotes = await readFile(resolve(root, `release-notes/${version}.md`), 'utf8');
  const notes = rawNotes.trim();
  if (!notes || [...rawNotes].length > 600) throw new Error('Release notes must be non-empty and at most 600 characters');
  if (!platforms?.['darwin-aarch64']) throw new Error('--darwin-aarch64 is required');
  if (!out) throw new Error('--out is required');
  const entries = {};
  for (const [platform, path] of Object.entries(platforms)) {
    if (!['darwin-aarch64', 'windows-x86_64'].includes(platform)) throw new Error(`Unsupported platform: ${platform}`);
    const signature = (await readFile(`${path}.sig`, 'utf8')).trim();
    await verifyArtifact(path, signature, pubkey);
    entries[platform] = {
      url: `https://github.com/duserzym/upblab/releases/download/v${version}/${encodeURIComponent(basename(path))}`,
      signature,
    };
  }
  const feed = { version, notes, pub_date: new Date().toISOString(), platforms: entries };
  await writeFile(out, JSON.stringify(feed, null, 2) + '\n');
  return feed;
}

export function parseArgs(args) {
  const parsed = { platforms: {} };
  const seen = new Set();
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i], value = args[i + 1];
    if (!['--version', '--darwin-aarch64', '--windows-x86_64', '--out'].includes(flag) || !value || value.startsWith('--') || seen.has(flag)) {
      throw new Error(`Invalid argument: ${flag}`);
    }
    seen.add(flag);
    if (flag === '--version') parsed.version = value;
    else if (flag === '--out') parsed.out = value;
    else parsed.platforms[flag.slice(2)] = value;
  }
  return parsed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await releaseFeed(parseArgs(process.argv.slice(2))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
