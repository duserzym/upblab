export const homeSectionKeys = ['sessions', 'mounts', 'local'] as const;
export type HomeSection = typeof homeSectionKeys[number];
export const atlasFilters = ['all', 'with', 'without'] as const;
export type AtlasFilter = typeof atlasFilters[number];
export interface HomeSectionLayout { atlasFilter?: AtlasFilter }
export type HomeSections = Partial<Record<HomeSection, HomeSectionLayout>> & { view?: 'overview' | 'records' };

/** Pick known keys only; malformed fields must never replace the defaults. */
export function readHomeSections(value: unknown, _viewportHeight?: number): HomeSections {
  const out: HomeSections = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  const stored = value as Record<string, unknown>;
  if (stored.view === 'overview' || stored.view === 'records') out.view = stored.view;
  const mounts = stored.mounts;
  if (mounts && typeof mounts === 'object' && !Array.isArray(mounts)) {
    const filter = (mounts as Record<string, unknown>).atlasFilter;
    if (atlasFilters.some(value => value === filter)) out.mounts = { atlasFilter: filter as AtlasFilter };
  }
  // Old height/collapsed values belong to the retired board; bounded columns need neither.
  return out;
}
