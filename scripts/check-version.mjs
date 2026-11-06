import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const versions = [
  ['package.json', JSON.parse(read('package.json')).version],
  ['ui/package.json', JSON.parse(read('ui/package.json')).version],
  ['src-tauri/tauri.conf.json', JSON.parse(read('src-tauri/tauri.conf.json')).version],
  ['src-tauri/Cargo.toml', read('src-tauri/Cargo.toml').match(/^version\s*=\s*"([^"]+)"/m)?.[1]],
];
if (!versions[0][1] || versions.some(([, version]) => version !== versions[0][1])) {
  console.error('Version copies disagree:\n' + versions.map(([path, version]) => `${path}: ${version ?? 'missing'}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log(versions[0][1]);
}
