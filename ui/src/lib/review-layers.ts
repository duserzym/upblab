import { spotFractions, grainFractions, type FractionIndex, type ReviewSpot, type SpotGroup } from './review-data';

export type Layer = {
  key: string;
  name: string;
  rows: ReviewSpot[];
} & ({ children: Layer[]; grain?: boolean } | { spot: ReviewSpot });
export function fractionBadges(layer: Layer, index: FractionIndex) {
  return 'spot' in layer ? spotFractions(layer.spot, index) : 'grain' in layer && layer.grain ? grainFractions(layer.rows, index) : [];
}
export type LayerOrder = Record<string, string[]>;
export const grainKey = (sample: string, grain: string) => JSON.stringify(['grain', sample, grain]);

export function resultLayers(groups: SpotGroup[]): Layer[] {
  return [false, true].flatMap(reference => {
    const samples: Layer[] = groups.filter(group => group.reference === reference).map(group => {
      const grains: Layer[] = group.grains.map(grain => ({
        key: grainKey(group.key, grain.key), name: grain.name, grain: true, rows: grain.spots,
        children: grain.spots.map(spot => ({ key: `spot:${spot.key}`, name: spot.label, spot, rows: [spot] })),
      }));
      return {
        key: group.key, name: group.name, rows: grains.flatMap(grain => grain.rows),
        children: reference ? grains.flatMap(grain => 'children' in grain ? grain.children : []) : grains,
      };
    });
    return samples.length ? [{
      key: reference ? 'standards' : 'samples', name: reference ? 'Standards' : 'Samples',
      children: samples, rows: samples.flatMap(sample => sample.rows),
    }] : [];
  });
}

export function orderedLayers(layers: Layer[], order: LayerOrder, parent = ''): Layer[] {
  const ranks = new Map(order[parent]?.map((key, index) => [key, index]));
  return [...layers].sort((a, b) => (ranks.get(a.key) ?? Infinity) - (ranks.get(b.key) ?? Infinity))
    .map(layer => 'children' in layer ? { ...layer, children: orderedLayers(layer.children, order, layer.key) } : layer);
}

export function moveLayer(keys: string[], source: string, target: string, after: boolean): string[] {
  if (source === target || !keys.includes(source) || !keys.includes(target)) return keys;
  const next = keys.filter(key => key !== source);
  next.splice(next.indexOf(target) + Number(after), 0, source);
  return next;
}

export function layerVisibility(rows: ReviewSpot[], hidden: Set<string>): boolean | 'mixed' {
  const shown = rows.filter(row => !hidden.has(row.key)).length;
  return shown === 0 ? false : shown === rows.length ? true : 'mixed';
}
