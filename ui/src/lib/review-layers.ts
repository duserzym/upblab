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

/** Reuse unchanged branches so a sample toggle does not dirty every remaining row. */
export function reuseLayers(previous: Layer[], next: Layer[]): Layer[] {
  const oldByKey = new Map(previous.map(layer => [layer.key, layer]));
  let same = previous.length === next.length;
  const layers = next.map((layer, i) => {
    const old = oldByKey.get(layer.key);
    if (old) {
      const rows = layer.rows.length === old.rows.length && layer.rows.every((row, j) => row === old.rows[j]) ? old.rows : layer.rows;
      const children = 'children' in layer ? reuseLayers('children' in old ? old.children : [], layer.children) : undefined;
      const equal = layer.name === old.name && rows === old.rows &&
        (children ? 'children' in old && old.children === children && old.grain === ('grain' in layer ? layer.grain : undefined)
          : 'spot' in old && 'spot' in layer && old.spot === layer.spot);
      layer = equal ? old : children ? { ...layer, rows, children } : { ...layer, rows };
    }
    if (previous[i] !== layer) same = false;
    return layer;
  });
  return same ? previous : layers;
}

/** Only branch/expansion changes rebuild this index; a selection follows a short path. */
export function layerIndex(layers: Layer[], isOpen: (layer: Layer, level: number) => boolean) {
  const paths = new Map<string, string[]>(), visible: string[] = [], positions = new Map<string, number>(), closed = new Set<string>();
  function visit(branches: Layer[], parents: string[], shown: boolean, level: number) {
    for (const layer of branches) {
      if ('spot' in layer) {
        paths.set(layer.spot.key, parents);
        if (shown) { positions.set(layer.spot.key, visible.length); visible.push(layer.spot.key); }
      } else {
        const open = isOpen(layer, level);
        if (!open) closed.add(layer.key);
        visit(layer.children, [...parents, layer.key], shown && open, level + 1);
      }
    }
  }
  visit(layers, [], true, 0);
  return { paths, visible, positions, closed };
}
