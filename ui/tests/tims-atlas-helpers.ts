import type { Page } from '@playwright/test';
import { deflateSync } from 'node:zlib';
import { inventedAtlas } from './fixtures/tims-atlas';

/** A generated grey stripe PNG. No canvas or real atlas assets are used. */
function tilePng(width: number, height: number) {
  function chunk(type: string, bytes: Buffer) {
    const name = Buffer.from(type), data = Buffer.concat([name, bytes]);
    let crc = 0xffffffff;
    for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    const head = Buffer.alloc(4), tail = Buffer.alloc(4);
    head.writeUInt32BE(bytes.length); tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([head, data, tail]);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 0;
  const pixels = Buffer.alloc(height * (width + 1));
  for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) pixels[row * (width + 1) + col + 1] = ((row >> 4) + (col >> 4)) % 2 ? 180 : 90;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}

export async function routeTimsAtlas(page: Page, options: { failTiles?: boolean; holdManifest?: Promise<void> } = {}) {
  const requests: string[] = [], encoded = new Map<string, Buffer>();
  await page.route('**/atlas/projects/project-demo/**', async route => {
    const url = new URL(route.request().url()); requests.push(url.pathname + url.search);
    const headers = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'private, max-age=31536000, immutable' };
    if (url.pathname === '/atlas/projects/project-demo/') {
      await options.holdManifest;
      await route.fulfill({ json: inventedAtlas, headers }); return;
    }
    if (options.failTiles) { await route.fulfill({ status: 404, body: 'Invented missing tile', headers }); return; }
    const match = /\/pyramid\/([^/]+)\/(\d+)\/(\d+)_(\d+)\.webp$/.exec(url.pathname);
    const level = match && inventedAtlas.areas.find(a => a.id === match[1])?.levels.find(l => l.z === Number(match[2]));
    if (!match || !level) { await route.fulfill({ status: 404, body: 'Invented atlas path missing', headers }); return; }
    const width = Math.min(256, level.w - Number(match[3]) * 256), height = Math.min(256, level.h - Number(match[4]) * 256);
    const key = `${width}/${height}`;
    if (!encoded.has(key)) encoded.set(key, tilePng(width, height));
    await route.fulfill({ body: encoded.get(key)!, contentType: 'image/png', headers });
  });
  return requests;
}
