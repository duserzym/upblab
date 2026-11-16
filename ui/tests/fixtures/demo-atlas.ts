import { rows, unmeasured } from './review';

// Invented geometry in micrometres. No image, project or package is read from disk.
const date = '2026-11-07T12:00:00Z';
const width = 1024, height = 768, umPerPx = 0.5, tileSize = 256;
export const demoAreas = [
  { id: 'area', name: 'Sample A region', sample: 'Sample A', stage: [800000, 900000],
    grains: [{ n: 1, x: 150, y: 160, rx: 69, ry: 119, angle: -0.32 }, { n: 2, x: 360, y: 230, rx: 81, ry: 112, angle: 0.48 }] },
  { id: 'area-b', name: 'Sample B region', sample: 'Sample B', stage: [1700000, 1000000],
    grains: [{ n: 3, x: 250, y: 185, rx: 128, ry: 151, angle: 0.25 }] },
  { id: 'area-ref', name: 'Reference region', sample: 'Demo reference', stage: [1250000, 1800000],
    grains: [{ n: 4, x: 150, y: 180, rx: 80, ry: 121, angle: -0.2 }, { n: 5, x: 360, y: 200, rx: 86, ry: 118, angle: 0.3 }] },
];
const grainArea = (n: number) => demoAreas.find(a => a.grains.some(g => g.n === n))!;
const grains = demoAreas.flatMap(a => a.grains.map(g => {
  const polygon = Array.from({ length: 48 }, (_, i) => {
    const t = i * Math.PI / 24, x = g.rx * Math.cos(t), y = g.ry * Math.sin(t);
    return [g.x + x * Math.cos(g.angle) - y * Math.sin(g.angle), g.y + x * Math.sin(g.angle) + y * Math.cos(g.angle)];
  });
  return { id: `grain-${g.n}`, area_id: a.id, label: g.n <= 3 ? `area/${g.n}` : `reference/${g.n}`,
    sample: a.sample, number: g.n, polygon_um: polygon, bbox_um: [Math.min(...polygon.map(p => p[0])), Math.min(...polygon.map(p => p[1])), Math.max(...polygon.map(p => p[0])), Math.max(...polygon.map(p => p[1]))],
    centroid_um: [g.x, g.y], area_um2: Math.PI * g.rx * g.ry, eq_diameter_um: 2 * Math.sqrt(g.rx * g.ry),
    major_um: 2 * g.ry, minor_um: 2 * g.rx, orientation_deg: g.angle * 180 / Math.PI,
    mean_intensity: 160, manual: false, scale_bar_um: 50 };
}));
export const demoSpots = [...rows, unmeasured].map((r, i) => {
  const n = i < 3 ? 1 : i === 3 ? 2 : i < 8 || i === 12 ? 3 : i < 10 ? 4 : 5;
  const a = grainArea(n), g = a.grains.find(g => g.n === n)!;
  const offset = i < 3 ? i - 1 : i >= 4 && i < 8 ? i - 5.5 : i === 12 ? 1.8 : (i % 2 - 0.5);
  return { id: r.atlas_spot_id, area_id: a.id, name: r.label, sample: a.sample, grain_id: `grain-${n}`,
    grain_number: n, n: i + 1, x_um: g.x + offset * 22, y_um: g.y + offset * 37,
    x2_um: null, y2_um: null, diameter_um: 24, kind: 'spot', comment: '',
    acquisition_id: r.acquisition_id, created: date, created_by: 'Demo analyst' };
});
const levels = Array.from({ length: 3 }, (_, z) => ({ z, w: width / 2 ** z, h: height / 2 ** z,
  cols: Math.ceil(width / 2 ** z / tileSize), rows: Math.ceil(height / 2 ** z / tileSize), scale: 2 ** z }));
const tone = { low_pct: 0, high_pct: 100, black: 0, white: 255, gamma: 1, clahe: false, clahe_tile: 64, clahe_clip: 2,
  grain_norm: { enabled: false, strength: 0, reference: null, feather_um: 0 } };
const params = {
  stitch: { coarse_factor: 4, min_psr: 8, max_drift_um: 20, outlier_px: 5, refine_full: false, consensus_px: 5 },
  photometric: { model: 'none', regularisation: 0, background: false,
    background_params: { model: 'poly2', cell: 64, smooth_cells: 2, threshold: null, dilate: 0, edge_steps: false }, overrides: [] },
  blend: { mode: 'feather', seam_factor: 1, levels: 3 }, tone,
  segment: { polarity: 'bright', method: 'otsu', noise_k: 3, contrast_frac: 0.1, threshold: null,
    smooth_px: 1, open_px: 1, close_px: 1, min_size_um: 20, split: false, split_h: 1, neck_ratio: 0.5,
    grabcut: false, simplify_px: 1, row_tolerance: 0.5, work_scale: 1, dark_rel: 0.5,
    background_window_um: 50, flag_bubbles: false, flag_slivers: false, flag_blocks: false,
    flag_specks: false, reference_size_um: 100, max_size_um: 0 },
};
export const demoProject = {
  schema_version: 1, uuid: 'project-demo', name: 'Demo zircon mount', created: date,
  package: { path: 'demo-zircon', reader: 'loose', name: 'Demo zircon mount', kind: 'loose', meta: {} },
  upbdb: { mount_id: 'mount-demo' },
  settings: { naming_pattern: '{sample}_{n}', spot_presets_um: [20, 24, 30], default_diameter_um: 24,
    spot_cursor_colour: '#70c9dc', user: 'Demo analyst', snap: true, n_per_sample: true, outline_margin_um: 0, outline_smooth: false },
  areas: demoAreas.map(a => ({ uuid: `demo-${a.id}`, id: a.id, name: a.name, sample: a.sample,
    pixel_size_nm: 500, stage_sign: [1, 1],
    tiles: [{ file: `${a.id}.png`, sha256: '0'.repeat(64), pos_um: [0, 0], stage_nm: a.stage, pixel_size_nm: 500, w: width, h: height }],
    params, placement: null, photometric: null, area_meta: {},
    mosaic: { w: width, h: height, um_per_px: umPerPx, origin_um: [0, 0], tile_size: tileSize,
      format: 'webp', levels: levels.map(({ z, ...l }) => ({ level: z, ...l })), sha256: '0'.repeat(64) } })),
  grainatlas_ui: { grains: Object.fromEntries(demoAreas.map(a => [a.id, grains.filter(g => g.area_id === a.id)])),
    spots: demoSpots, labels: [], tone: {}, overlays: {} },
};
export const demoAtlas = {
  format: 'grainatlas-atlas', version: 1, project_id: 'project-demo', name: 'Demo zircon mount',
  mount_id: 'mount-demo', opened_from: 'demo-zircon', tile_size: tileSize, tile_format: 'webp', tile_encoding: 'lossy',
  areas: demoAreas.map(a => ({ id: a.id, uuid: `demo-${a.id}`, name: a.name, sample: a.sample,
    path: `pyramid/${a.id}`, w: width, h: height, um_per_px: umPerPx, levels })),
  package: { ...demoProject.package, content_sha256: '0'.repeat(64), nas_path: null },
  grainatlas_version: 'demo', exported: date,
  files: [] as { path: string; size: number; sha256: string }[],
};
const hashes = { spots: 'demo-spots', grains: 'demo-grains', labels: 'demo-labels' };
export const demoElements = { mount_id: 'mount-demo', revision: 1, hashes, project_uuids: ['project-demo'],
  current_project_uuid: 'project-demo', spots: demoSpots, grains, labels: [] };
export const demoAtlasStatus = { project_uuid: 'project-demo', mount_id: 'mount-demo', mount_label: 'Demo zircon mount',
  name: 'Demo zircon mount', package_name: 'Demo zircon mount', atlas_version: 1, atlas_bundle_id: 'bundle-demo',
  revision: 1, counts: { spots: 13, grains: 5, labels: 0, grains_retired: 0, grains_without_atlas_id: 0 }, hashes,
  changed_at: date, changed_by: 'demo', can_edit: false, current_project_uuid: 'project-demo',
  project_uuids: [{ project_uuid: 'project-demo', name: 'Demo zircon mount', package_name: 'Demo zircon mount', is_current: true }] };

/** Serialized by Playwright into a blank browser page; intentionally self-contained. */
export async function drawDemoTiles(input: { areas: typeof demoAreas; spots: typeof demoSpots }): Promise<Record<string, string>> {
  let seed = 0x5eed1234;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
  const tiles: Record<string, string> = {};
  for (const area of input.areas) {
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 768;
    const ctx = canvas.getContext('2d')!;
    const pixels = ctx.createImageData(1024, 768);
    for (let y = 0; y < 768; y++) for (let x = 0; x < 1024; x++) {
      let v = 35 + (random() - 0.5) * 9;
      for (const g of area.grains) {
        const dx = x * 0.5 - g.x, dy = y * 0.5 - g.y;
        const u = (dx * Math.cos(g.angle) + dy * Math.sin(g.angle)) / g.rx;
        const w = (-dx * Math.sin(g.angle) + dy * Math.cos(g.angle)) / g.ry;
        const r = Math.sqrt(u * u + w * w), a = Math.atan2(w, u);
        if (r < 1 + 0.025 * Math.cos(a * 6)) {
          v = 166 + 23 * (1 - r) + 12 * Math.cos(r * 100 + 2 * Math.sin(a * 3)) + (random() - 0.5) * 9;
          if (r > 0.96) v -= 45;
          // A thin, slightly wandering fracture through each invented grain.
          if (Math.abs(u - 0.2 * Math.sin(w * 5) - 0.12) < 0.008 && w > -0.6 && w < 0.85) v -= 70;
        }
      }
      const i = (y * 1024 + x) * 4;
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = Math.max(0, Math.min(255, v)); pixels.data[i + 3] = 255;
    }
    ctx.putImageData(pixels, 0, 0);
    for (const spot of input.spots.filter(s => s.area_id === area.id)) {
      const x = spot.x_um * 2, y = spot.y_um * 2, r = spot.diameter_um * 0.8;
      const pit = ctx.createRadialGradient(x - 2, y - 2, 1, x, y, r);
      pit.addColorStop(0, '#1c1c1c'); pit.addColorStop(0.7, '#353535'); pit.addColorStop(0.85, '#999999'); pit.addColorStop(1, '#b0b0b0');
      ctx.fillStyle = pit; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    for (let z = 0; z <= 2; z++) {
      const w = 1024 / 2 ** z, h = 768 / 2 ** z;
      for (let row = 0; row < Math.ceil(h / 256); row++) for (let col = 0; col < Math.ceil(w / 256); col++) {
        const tile = document.createElement('canvas'); tile.width = Math.min(256, w - col * 256); tile.height = Math.min(256, h - row * 256);
        tile.getContext('2d')!.drawImage(canvas, col * 256 * 2 ** z, row * 256 * 2 ** z,
          tile.width * 2 ** z, tile.height * 2 ** z, 0, 0, tile.width, tile.height);
        tiles[`pyramid/${area.id}/${z}/${col}_${row}.webp`] = tile.toDataURL('image/webp', 1).split(',')[1];
      }
    }
  }
  return tiles;
}
