export const homeSectionKeys = ['sessions', 'mounts'] as const;
export type HomeSection = typeof homeSectionKeys[number];
export const atlasFilters = ['all', 'with', 'without'] as const;
export type AtlasFilter = typeof atlasFilters[number];
export interface HomeSectionLayout { height?: number | null; collapsed?: boolean; atlasFilter?: AtlasFilter }
export type HomeSections = Partial<Record<HomeSection, HomeSectionLayout>>;

/** Runtime bounds use the actual first row and the full content height. */
export function clampHeight(height: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(Math.max(minimum, maximum), Number.isFinite(height) ? height : minimum));
}

export function rowStep(cardHeight: number, gap: number): number {
  return Number.isFinite(cardHeight) && cardHeight > 0
    ? cardHeight + (Number.isFinite(gap) ? Math.max(0, gap) : 0) : 120;
}

export function restoredHeight(height: number, viewportHeight?: number): number {
  const maximum = viewportHeight !== undefined && Number.isFinite(viewportHeight) && viewportHeight > 0
    ? Math.min(4000, viewportHeight * 0.8) : 4000;
  return clampHeight(height, 80, maximum);
}

/** Pick known keys only; malformed fields must never replace the defaults. */
export function readHomeSections(value: unknown, viewportHeight?: number): HomeSections {
  const out: HomeSections = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const key of homeSectionKeys) {
    const entry: unknown = (value as Record<string, unknown>)[key];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const { height, collapsed, atlasFilter } = entry as Record<string, unknown>;
    const layout: HomeSectionLayout = {};
    if (height === null) layout.height = null;
    else if (typeof height === 'number' && Number.isFinite(height)) layout.height = restoredHeight(height, viewportHeight);
    if (typeof collapsed === 'boolean') layout.collapsed = collapsed;
    if (key === 'mounts' && atlasFilters.some(filter => filter === atlasFilter)) layout.atlasFilter = atlasFilter as AtlasFilter;
    if (Object.keys(layout).length) out[key] = layout;
  }
  return out;
}
