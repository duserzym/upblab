import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, releaseFeed, verifyArtifact } from './release-feed.mjs';

let root, artifact, pubkey, privateKey, keyId, bytes, out;
// Test-only minisign writer; no production keys or artifacts are used.
function signature(algorithm = 'ED', comment = 'timestamp:1790000000') {
  const data = algorithm === 'ED' ? createHash('blake2b512').update(bytes).digest() : bytes;
  const sig = sign(null, data, privateKey);
  const packet = Buffer.concat([Buffer.from(algorithm), keyId, sig]);
  const global = sign(null, Buffer.concat([sig, Buffer.from(comment)]), privateKey);
  return Buffer.from(`untrusted comment: test only\n${packet.toString('base64')}\ntrusted comment: ${comment}\n${global.toString('base64')}\n`).toString('base64');
}
function editSignature(value, edit) {
  const lines = Buffer.from(value, 'base64').toString().trimEnd().split('\n');
  edit(lines);
  return Buffer.from(lines.join('\n') + '\n').toString('base64');
}
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'upblab-feed-'));
  await mkdir(join(root, 'src-tauri'));
  await mkdir(join(root, 'release-notes'));
  const pair = generateKeyPairSync('ed25519');
  privateKey = pair.privateKey;
  keyId = randomBytes(8);
  const key = pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  pubkey = Buffer.from(`untrusted comment: minisign public key: TEST\n${Buffer.concat([Buffer.from('Ed'), keyId, key]).toString('base64')}\n`).toString('base64');
  await writeFile(join(root, 'src-tauri/tauri.conf.json'), JSON.stringify({ productName: 'UPb Lab', version: '1.2.3', plugins: { updater: { pubkey } } }));
  await writeFile(join(root, 'release-notes/1.2.3.md'), '- Print sheets fit A4 and Letter.\n');
  artifact = join(root, 'UPb Lab.app.tar.gz');
  bytes = Buffer.from('invented build bytes');
  await writeFile(artifact, bytes);
  await writeFile(`${artifact}.sig`, signature());
  out = join(root, 'latest.json');
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const options = () => ({ root, platforms: { 'darwin-aarch64': artifact }, out });

test('writes the default version, notes, ISO date, URL and verified signature', async () => {
  const feed = await releaseFeed(options());
  assert.deepEqual(JSON.parse(await readFile(out)), feed);
  assert.equal(feed.version, '1.2.3');
  assert.equal(feed.notes, '- Print sheets fit A4 and Letter.');
  assert.equal(new Date(feed.pub_date).toISOString(), feed.pub_date);
  assert.equal(feed.platforms['darwin-aarch64'].url, 'https://github.com/duserzym/upblab/releases/download/v1.2.3/UPb-Lab_1.2.3_aarch64.app.tar.gz');
  assert.equal(feed.platforms['darwin-aarch64'].signature, await readFile(`${artifact}.sig`, 'utf8'));
});
test('copies an archive with a space and its signature to safe names beside the feed', async () => {
  const outputDir = join(root, 'feed');
  const feed = await releaseFeed({ ...options(), out: join(outputDir, 'latest.json') });
  const copied = join(outputDir, 'UPb-Lab_1.2.3_aarch64.app.tar.gz');
  assert.deepEqual(await readFile(copied), bytes);
  assert.deepEqual(await readFile(`${copied}.sig`), await readFile(`${artifact}.sig`));
  assert.deepEqual(await readFile(artifact), bytes);
  assert.ok(!feed.platforms['darwin-aarch64'].url.includes('%'));
  await verifyArtifact(copied, await readFile(`${copied}.sig`, 'utf8'), pubkey);
});
test('uses --assets-dir for copies and lists all upload files including the safe DMG', async t => {
  const assetsDir = join(root, 'upload files', 'release');
  const dmg = join(root, 'UPb Lab_1.2.3_aarch64.dmg');
  await writeFile(dmg, 'invented disk image');
  const windows = join(root, 'UPb Lab-setup.exe');
  await writeFile(windows, bytes);
  await writeFile(`${windows}.sig`, signature());
  const output = [];
  t.mock.method(console, 'log', message => output.push(message));
  await releaseFeed({ ...options(), assetsDir, dmg, platforms: { 'darwin-aarch64': artifact, 'windows-x86_64': windows } });
  const names = ['UPb-Lab_1.2.3_aarch64.app.tar.gz', 'UPb-Lab_1.2.3_aarch64.app.tar.gz.sig',
    'UPb-Lab_1.2.3_x64-setup.exe', 'UPb-Lab_1.2.3_x64-setup.exe.sig', 'UPb-Lab_1.2.3_aarch64.dmg'];
  assert.deepEqual(output, [`Files to upload:\n${[...names.map(name => join(assetsDir, name)), out].join('\n')}`]);
  assert.equal(await readFile(join(assetsDir, names[4]), 'utf8'), 'invented disk image');
  assert.deepEqual(await readFile(join(assetsDir, names[2])), bytes);
  assert.deepEqual(await readFile(join(assetsDir, names[3])), await readFile(`${windows}.sig`));
});
test('accepts an archive already at its final upload path', async () => {
  await releaseFeed(options());
  const copied = join(root, 'UPb-Lab_1.2.3_aarch64.app.tar.gz');
  await releaseFeed({ ...options(), platforms: { 'darwin-aarch64': copied } });
  assert.deepEqual(await readFile(copied), bytes);
});
test('refuses a final asset name containing a space', async () => {
  const spacedOut = join(root, 'latest feed.json');
  await writeFile(spacedOut, 'keep');
  await assert.rejects(releaseFeed({ ...options(), out: spacedOut }), /Final asset name contains a space/);
  assert.equal(await readFile(spacedOut, 'utf8'), 'keep');
});
test('derives the stem from productName and refuses names requiring URL encoding', async () => {
  const configPath = join(root, 'src-tauri/tauri.conf.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  await writeFile(configPath, JSON.stringify({ ...config, productName: 'Other App' }));
  const feed = await releaseFeed(options());
  assert.ok(feed.platforms['darwin-aarch64'].url.endsWith('/Other-App_1.2.3_aarch64.app.tar.gz'));
  await writeFile(configPath, JSON.stringify({ ...config, productName: 'UPb#Lab' }));
  await assert.rejects(releaseFeed(options()), /not URL-safe/);
});
test('verifies raw Ed signatures and optional Windows artifacts', async () => {
  const windows = join(root, 'UPb Lab-setup.exe');
  await writeFile(windows, bytes);
  await writeFile(`${windows}.sig`, signature('Ed'));
  const feed = await releaseFeed({ ...options(), platforms: { 'darwin-aarch64': artifact, 'windows-x86_64': windows } });
  assert.match(feed.platforms['windows-x86_64'].url, /v1.2.3\/UPb-Lab_1.2.3_x64-setup.exe$/);
});
test('uses an explicit version', async () => {
  await writeFile(join(root, 'release-notes/2.0.0.md'), 'A clearer sample view.');
  assert.equal((await releaseFeed({ ...options(), version: '2.0.0' })).version, '2.0.0');
});
for (const [label, content] of [['empty', ' \n'], ['too long', 'x'.repeat(601)], ['over limit with whitespace', 'x'.repeat(600) + '\n']]) {
  test(`refuses ${label} notes without overwriting output`, async () => {
    await writeFile(join(root, 'release-notes/1.2.3.md'), content);
    await writeFile(out, 'keep');
    await assert.rejects(releaseFeed(options()), /Release notes/);
    assert.equal(await readFile(out, 'utf8'), 'keep');
  });
}
test('accepts 600 characters', async () => {
  await writeFile(join(root, 'release-notes/1.2.3.md'), 'x'.repeat(600));
  assert.equal((await releaseFeed(options())).notes.length, 600);
});
test('refuses missing notes and missing signatures', async () => {
  await rm(join(root, 'release-notes/1.2.3.md'));
  await assert.rejects(releaseFeed(options()), /ENOENT/);
  await writeFile(join(root, 'release-notes/1.2.3.md'), 'Notes.');
  await rm(`${artifact}.sig`);
  await assert.rejects(releaseFeed(options()), /ENOENT/);
});
test('refuses tampered artifacts', async () => {
  await writeFile(artifact, 'changed');
  await writeFile(out, 'keep');
  await assert.rejects(releaseFeed(options()), /Artifact signature did not verify: UPb-Lab_1.2.3_aarch64.app.tar.gz/);
  assert.equal(await readFile(out, 'utf8'), 'keep');
});
for (const [label, edit, message] of [
  ['key id', lines => { const p = Buffer.from(lines[1], 'base64'); p[2] ^= 1; lines[1] = p.toString('base64'); }, /key ids/],
  ['signature', lines => { const p = Buffer.from(lines[1], 'base64'); p[10] ^= 1; lines[1] = p.toString('base64'); }, /Artifact signature/],
  ['algorithm', lines => { const p = Buffer.from(lines[1], 'base64'); p[0] = 0; lines[1] = p.toString('base64'); }, /signature packet/],
  ['trusted comment', lines => { lines[2] += ' changed'; }, /Global signature/],
  ['global signature', lines => { const p = Buffer.from(lines[3], 'base64'); p[0] ^= 1; lines[3] = p.toString('base64'); }, /Global signature/],
  ['global length', lines => { lines[3] = 'YQ=='; }, /Global signature/],
  ['missing line', lines => { lines.pop(); }, /signature file/],
]) {
  test(`refuses a changed ${label}`, async () => {
    await assert.rejects(verifyArtifact(artifact, editSignature(signature(), edit), pubkey), message);
  });
}
test('refuses empty, malformed and wrong public keys', async () => {
  for (const key of ['', 'invalid', Buffer.from('untrusted comment: test\nYQ==').toString('base64')]) {
    await assert.rejects(verifyArtifact(artifact, signature(), key), /pubkey|public key/);
  }
  await writeFile(join(root, 'src-tauri/tauri.conf.json'), JSON.stringify({ version: '1.2.3', plugins: { updater: { pubkey: '' } } }));
  await assert.rejects(releaseFeed(options()), /pubkey is empty/);
});
test('refuses invalid signature base64', async () => {
  await assert.rejects(verifyArtifact(artifact, 'bad!', pubkey), /Invalid base64/);
});
test('parses CLI inputs and rejects missing, duplicate and unknown flags', () => {
  assert.deepEqual(parseArgs(['--version', '1.2.3', '--darwin-aarch64', artifact, '--out', out]), { version: '1.2.3', platforms: { 'darwin-aarch64': artifact }, out });
  assert.deepEqual(parseArgs(['--assets-dir', 'uploads', '--dmg', 'UPb Lab.dmg']), { platforms: {}, assetsDir: 'uploads', dmg: 'UPb Lab.dmg' });
  for (const args of [['--out'], ['--oops', 'x'], ['--out', '--version'], ['--out', 'a', '--out', 'b']]) assert.throws(() => parseArgs(args));
});
test('requires macOS, output and a stable version', async () => {
  await assert.rejects(releaseFeed({ ...options(), platforms: {} }), /darwin-aarch64/);
  await assert.rejects(releaseFeed({ ...options(), out: undefined }), /--out/);
  await assert.rejects(releaseFeed({ ...options(), version: '../bad' }), /stable/);
});
test('setup refuses an existing pubkey before generating keys or changing config', async () => {
  const configPath = new URL('../src-tauri/tauri.conf.json', import.meta.url);
  const before = await readFile(configPath, 'utf8');
  if (!JSON.parse(before).plugins.updater.pubkey.trim()) return;
  const result = spawnSync(process.execPath, [new URL('./setup-updater.mjs', import.meta.url).pathname], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /already configured.*--force/);
  assert.equal(await readFile(configPath, 'utf8'), before);
});
