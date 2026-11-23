import type { SourceOut } from './tims-api';
export type GrainImageSource = Pick<SourceOut, 'mount_id' | 'grain_id' | 'atlas_grain_id' | 'spot_id' | 'atlas_spot_id'>;
export interface GrainGeometry { area_id?: string; area?: string; project_uuid?: string | null; id: string | null; server_id?: string; atlas_grain_id?: string | null; label?: string | null; name?: string | null; number?: string | number | null; grain_number?: string | number | null; sample?: string | null; polygon_um: number[][] | null; retired?: boolean }
export interface SpotGeometry { diameter_um?: number | null; area_id?: string; project_uuid?: string | null; id: string | null; server_id?: string; atlas_spot_id?: string | null; grain_id?: string | null; label?: string | null; name?: string | null; x_um: number; y_um: number }
export interface MountGeometry { label?: string; grains: GrainGeometry[]; spots: SpotGeometry[]; current_project_uuid: string | null }
export function sourceNames(source: SourceOut, mount?: MountGeometry) {
  const grain = mount?.grains.find(g => !!source.grain_id && g.server_id === source.grain_id || !!source.atlas_grain_id && (g.id === source.atlas_grain_id || g.atlas_grain_id === source.atlas_grain_id));
  const spot = mount?.spots.find(s => !!source.spot_id && s.server_id === source.spot_id || !!source.atlas_spot_id && (s.id === source.atlas_spot_id || s.atlas_spot_id === source.atlas_spot_id));
  return { mount: source.mount_label || mount?.label || 'Not recorded', grain: source.grain_label || grain?.label || grain?.name || grain?.number || grain?.grain_number || 'Not recorded', spot: source.spot_label || spot?.label || spot?.name || 'Not recorded' };
}
export function capsulePucks(positions = 15, perPuck = 5) {
  if (!Number.isInteger(positions) || positions < 1 || !Number.isInteger(perPuck) || perPuck < 1) return [];
  return Array.from({ length: Math.ceil(positions / perPuck) }, (_, p) => Array.from({ length: Math.min(perPuck, positions - p * perPuck) }, (_, n) => p * perPuck + n + 1));
}
export function puckSlotCoordinates(index: number, capacity: number) {
  if (capacity <= 1) return { x: 50, y: 50 };
  // In a five-hole puck the sixth position faces front and holds the notch.
  const degrees = capacity === 5 ? 150 + 60 * index : 90 + (index + 0.5) * 360 / capacity;
  const angle = degrees * Math.PI / 180;
  return { x: 50 + 33 * Math.cos(angle), y: 50 + 33 * Math.sin(angle) };
}
export function grainOutline(polygon: number[][] | null | undefined, spot?: { x_um: number; y_um: number; diameter_um?: number | null }) {
  if (!polygon || polygon.length < 3 || polygon.some(p => p.length < 2 || !p.slice(0, 2).every(Number.isFinite))) return null;
  const xs = polygon.map(p => p[0]), ys = polygon.map(p => p[1]);
  const left = Math.min(...xs), top = Math.min(...ys), width = Math.max(...xs) - left, height = Math.max(...ys) - top;
  const scale = 80 / Math.max(width, height);
  if (!Number.isFinite(scale)) return null;
  const project = (x: number, y: number) => [10 + (80 - width * scale) / 2 + (x - left) * scale, 10 + (80 - height * scale) / 2 + (y - top) * scale];
  return { ...(spot?.diameter_um && Number.isFinite(spot.diameter_um) && spot.diameter_um > 0 ? { radius: spot.diameter_um * scale / 2 } : {}), points: polygon.map(p => project(p[0], p[1]).join(',')).join(' '), dot: spot && [spot.x_um, spot.y_um].every(Number.isFinite) ? project(spot.x_um, spot.y_um) : null };
}
export function sourceGeometry(source: GrainImageSource | undefined, mount: MountGeometry | undefined) {
  const grain = mount?.grains.find(g => !!source?.grain_id && g.server_id === source.grain_id || !!source?.atlas_grain_id && (g.id === source.atlas_grain_id || g.atlas_grain_id === source.atlas_grain_id));
  const spot = mount?.spots.find(s => !!source?.spot_id && s.server_id === source.spot_id || !!source?.atlas_spot_id && (s.id === source.atlas_spot_id || s.atlas_spot_id === source.atlas_spot_id));
  return { grain, spot };
}
export function sourceOutline(source: SourceOut | undefined, mount: MountGeometry | undefined) {
  const { grain, spot } = sourceGeometry(source, mount);
  return grainOutline(grain?.polygon_um, spot);
}
