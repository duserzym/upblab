import type { GrainGeometry, SpotGeometry } from './tims-geometry';

export interface AtlasLevel { z: number; scale: number; cols: number; rows: number; w: number; h: number }
export interface AtlasArea {
  id: string; uuid: string; name: string; path: string; origin_um?: [number, number];
  um_per_px: number; w: number; h: number; levels: AtlasLevel[];
}
export interface GrainAtlas { tile_size: number; areas: AtlasArea[] }
export interface GrainTile { path: string; col: number; row: number; x: number; y: number; width: number; height: number }
export interface GrainCrop {
  viewBox: string; points: string; level: AtlasLevel; tiles: GrainTile[];
  spot: { x: number; y: number; radius: number | null } | null;
}

/** GrainAtlas mosaic coordinates: x right, y down; scale is base pixels per level pixel.
 * See grainatlas remote.ts, atlas/mod.rs, grain_export/pixels.rs and enhance::grain_mask.
 * Elements carry area_id (the database's area), never infer an area from overlapping bboxes.
 */
export function grainCrop(atlas: GrainAtlas, grain: GrainGeometry, spot: SpotGeometry | undefined, displayPx: number, dpr = 1): GrainCrop {
  const polygon = grain.polygon_um;
  if (!polygon || polygon.length < 3 || polygon.some(p => p.length < 2 || !p.slice(0, 2).every(Number.isFinite))) throw new Error('No segmented grain polygon is available.');
  const areaId = grain.area_id || grain.area;
  const area = atlas.areas.find(a => !!areaId && a.id === areaId);
  if (!area) throw new Error('The grain area is absent from the published atlas.');
  const origin = area.origin_um ?? [0, 0]; // Legacy bundles and remote.ts use zero.
  if (!(area.um_per_px > 0) || !Number.isFinite(area.um_per_px) || !origin.every(Number.isFinite) || !(atlas.tile_size > 0)) throw new Error('Invalid atlas pixel geometry.');
  const base = polygon.map(p => [(p[0] - origin[0]) / area.um_per_px, (p[1] - origin[1]) / area.um_per_px]);
  const xs = base.map(p => p[0]), ys = base.map(p => p[1]);
  const left = Math.min(...xs), top = Math.min(...ys), right = Math.max(...xs), bottom = Math.max(...ys);
  const extent = Math.max(right - left, bottom - top);
  if (!(right > left && bottom > top) || left < 0 || top < 0 || right > area.w || bottom > area.h) throw new Error('The grain polygon is outside the published area.');
  const levels = area.levels.filter(l => l.scale > 0 && Number.isFinite(l.scale) && l.cols > 0 && l.rows > 0 && l.w > 0 && l.h > 0).sort((a, b) => a.scale - b.scale);
  if (!levels.length) throw new Error('The published area has no pyramid levels.');
  const target = Math.max(1, displayPx * Math.max(1, dpr));
  // Coarsest level whose grain still has at least the requested number of pixels.
  const level = levels.filter(l => extent / l.scale >= target).at(-1) ?? levels[0];
  const scale = level.scale, tile = atlas.tile_size;
  const x0 = left / scale, y0 = top / scale, x1 = right / scale, y1 = bottom / scale;
  const pad = extent / scale * 0.1;
  const tiles: GrainTile[] = [];
  for (let row = Math.max(0, Math.floor(y0 / tile)); row < Math.min(level.rows, Math.ceil(y1 / tile)); row++) {
    for (let col = Math.max(0, Math.floor(x0 / tile)); col < Math.min(level.cols, Math.ceil(x1 / tile)); col++) {
      tiles.push({ path: `${area.path}/${level.z}/${col}_${row}.webp`, col, row, x: col * tile, y: row * tile,
        width: Math.min(tile, level.w - col * tile), height: Math.min(tile, level.h - row * tile) });
    }
  }
  if (!tiles.length) throw new Error('No published tiles intersect the grain.');
  const k = area.um_per_px * scale;
  return {
    viewBox: [x0 - pad, y0 - pad, x1 - x0 + 2 * pad, y1 - y0 + 2 * pad].join(' '),
    points: base.map(p => `${p[0] / scale},${p[1] / scale}`).join(' '), level, tiles,
    spot: spot && [spot.x_um, spot.y_um].every(Number.isFinite) ? {
      x: (spot.x_um - origin[0]) / k, y: (spot.y_um - origin[1]) / k,
      radius: spot.diameter_um && Number.isFinite(spot.diameter_um) && spot.diameter_um > 0 ? spot.diameter_um / k / 2 : null,
    } : null,
  };
}
