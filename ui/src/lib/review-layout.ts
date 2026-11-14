export const panes = ['spots', 'plots', 'details', 'images'] as const;
export type Pane = typeof panes[number];
export type Axis = 'x' | 'y';
export type Edge = 'left' | 'right' | 'top' | 'bottom';
export type Layout = Pane | Split;
type Split = { axis: Axis; ratio: number; first: Layout; second: Layout };
export type Path = ('first' | 'second')[];
export type Rect = { x: number; y: number; width: number; height: number };
type Divider = { path: Path; rect: Rect; area: Rect; axis: Axis; position: number; minRatio: number; maxRatio: number };
export const gap = 8;

export function defaultLayout(images: boolean, dataWidth = 50): Layout {
  if (images) return { axis: 'x', ratio: 0.17, first: 'spots', second: {
    axis: 'x', ratio: dataWidth / 100, first: 'plots',
    second: { axis: 'y', ratio: 0.6, first: 'images', second: 'details' },
  } };
  return { axis: 'x', ratio: 0.20,
    first: { axis: 'y', ratio: 0.62, first: 'spots', second: 'details' }, second: 'plots' };
}

export const presets = ['Balanced', 'Plots focus', 'Image focus'] as const;
export type Preset = typeof presets[number];

export function presetLayout(name: Preset, images: boolean): Layout {
  if (name === 'Balanced' || name === 'Image focus' && !images) return defaultLayout(images);
  if (images) return defaultLayout(true, name === 'Image focus' ? 38 : 70);
  return { axis: 'x', ratio: 0.18,
    first: { axis: 'y', ratio: 0.62, first: 'spots', second: 'details' }, second: 'plots' };
}

export function equalLayout(a: Layout, b: Layout): boolean {
  if (typeof a === 'string' || typeof b === 'string') return a === b;
  return a.axis === b.axis && a.ratio === b.ratio && equalLayout(a.first, b.first) && equalLayout(a.second, b.second);
}

// Match only the exact old preset trees. A changed divider or dock position is
// user-owned. Reading migrates in memory; settings are saved only on an edit.
export function migrateSplitLayout(layout: Layout, dataWidth: number): Layout {
  const sidebar: Layout = { axis: 'y', ratio: 0.62, first: 'spots', second: 'details' };
  for (const name of presets) {
    const ratio = name === 'Balanced' ? dataWidth / 100 : name === 'Plots focus' ? 0.7 : 0.38;
    const old: Layout = { axis: 'x', ratio: name === 'Balanced' ? 0.2 : 0.18, first: sidebar,
      second: { axis: 'x', ratio, first: 'plots', second: 'images' } };
    if (equalLayout(layout, old)) return name === 'Balanced' ? defaultLayout(true, dataWidth) : presetLayout(name, true);
  }
  return layout;
}

// Ratios reset only when the entire topology still corresponds to the default.
export function defaultRatio(layout: Layout, path: Path, images: boolean, dataWidth = 50): number {
  const baseline = defaultLayout(images, dataWidth);
  function shape(node: Layout): string {
    return typeof node === 'string' ? node : `${node.axis}(${shape(node.first)},${shape(node.second)})`;
  }
  if (shape(layout) !== shape(baseline)) return 0.5;
  let node = baseline;
  for (const side of path) {
    if (typeof node === 'string') return 0.5;
    node = node[side];
  }
  return typeof node === 'string' ? 0.5 : node.ratio;
}

export function readLayout(raw: string, images: boolean, dataWidth: number): Layout {
  const seen = new Set<Pane>();
  function valid(value: unknown): value is Layout {
    if (typeof value === 'string') {
      const pane = value as Pane;
      if (!panes.includes(pane) || seen.has(pane) || (!images && pane === 'images')) return false;
      seen.add(pane);
      return true;
    }
    if (value === null || typeof value !== 'object') return false;
    const node = value as Partial<Split>;
    return (node.axis === 'x' || node.axis === 'y') && typeof node.ratio === 'number' &&
      node.ratio > 0 && node.ratio < 1 && valid(node.first) && valid(node.second);
  }
  try {
    const value: unknown = JSON.parse(raw);
    if (valid(value) && seen.size === (images ? 4 : 3)) return images ? migrateSplitLayout(value, dataWidth) : value;
  } catch { /* Use the default if settings were edited or corrupted. */ }
  return defaultLayout(images, dataWidth);
}

function remove(layout: Layout, pane: Pane): Layout | null {
  if (typeof layout === 'string') return layout === pane ? null : layout;
  const first = remove(layout.first, pane);
  const second = remove(layout.second, pane);
  return first && second ? { ...layout, first, second } : first ?? second;
}

export function dock(layout: Layout, pane: Pane, target: Pane, edge: Edge): Layout {
  if (pane === target) return layout;
  const remainder = remove(layout, pane);
  if (!remainder) return layout;
  const axis = edge === 'left' || edge === 'right' ? 'x' : 'y';
  const before = edge === 'left' || edge === 'top';
  function insert(node: Layout): Layout {
    if (typeof node !== 'string') return { ...node, first: insert(node.first), second: insert(node.second) };
    if (node !== target) return node;
    return { axis, ratio: 0.5, first: before ? pane : target, second: before ? target : pane };
  }
  return insert(remainder);
}

export function resize(layout: Layout, path: Path, ratio: number, bounds?: { width: number; height: number }): Layout {
  if (bounds) {
    const divider = geometry(layout, bounds.width, bounds.height).dividers.find(d => d.path.join('.') === path.join('.'));
    if (divider) ratio = Math.max(divider.minRatio, Math.min(divider.maxRatio, ratio));
  }
  if (typeof layout === 'string') return layout;
  const [head, ...rest] = path;
  if (!head) return { ...layout, ratio: Math.max(0.02, Math.min(0.98, ratio)) };
  return { ...layout, [head]: resize(layout[head], rest, ratio) };
}

export const minimum = {
  spots: { x: 220, y: 108 }, plots: { x: 320, y: 240 },
  details: { x: 240, y: 92 }, images: { x: 320, y: 240 },
};
export const railSize = 28;

export function geometry(layout: Layout, width: number, height: number) {
  const tiles: Partial<Record<Pane, Rect>> = {};
  const dividers: Divider[] = [];
  const collapsed: Pane[] = [];
  const rails: Partial<Record<Pane, Axis>> = {};
  function hasImageDetailsStack(node: Layout): boolean {
    return typeof node !== 'string' && (node.axis === 'y' && node.first === 'images' && node.second === 'details'
      || hasImageDetailsStack(node.first) || hasImageDetailsStack(node.second));
  }
  // The under-image reading order needs room for identity, date and actions.
  // At the shortest window it yields to a useful summary rail instead.
  const detailsHeight = hasImageDetailsStack(layout) ? 260 : minimum.details.y;
  function minSize(node: Layout, axis: Axis): number {
    if (typeof node === 'string') return rails[node] ? railSize : node === 'details' && axis === 'y' ? detailsHeight : minimum[node][axis];
    const a = minSize(node.first, axis), b = minSize(node.second, axis);
    return node.axis === axis ? a + gap + b : Math.max(a, b);
  }
  function includes(node: Layout, pane: Pane): boolean {
    return typeof node === 'string' ? node === pane : includes(node.first, pane) || includes(node.second, pane);
  }
  // Metadata and Spots yield first. In a tall stack even the two primary
  // tiles can exceed the available height; SEM yields before the plots then.
  // A visible tile never shrinks below its minimum while a rail can free room.
  for (const pane of ['details', 'spots', 'images', 'plots'] as const) {
    const shortX = minSize(layout, 'x') > width, shortY = minSize(layout, 'y') > height;
    if (!shortX && !shortY) break;
    if (!includes(layout, pane)) continue;
    rails[pane] = shortX ? 'x' : 'y';
    collapsed.push(pane);
  }
  // A subtree made entirely of rails needs only its rail thickness.
  function railExtent(node: Layout, axis: Axis): number {
    if (typeof node === 'string') return rails[node] === axis ? railSize : Infinity;
    const a = railExtent(node.first, axis), b = railExtent(node.second, axis);
    return node.axis === axis ? a + gap + b : Math.max(a, b);
  }
  function visit(node: Layout, area: Rect, path: Path) {
    if (typeof node === 'string') {
      tiles[node] = rails[node] ? { ...area, [rails[node] === 'x' ? 'width' : 'height']: Math.min(railSize, area[rails[node] === 'x' ? 'width' : 'height']) } : area;
      return;
    }
    const dim = node.axis === 'x' ? 'width' : 'height', coord = node.axis;
    const total = Math.max(0, area[dim] - gap);
    const a = minSize(node.first, coord), b = minSize(node.second, coord);
    // Scaling is only needed below the physical minimum of the header rails
    // (including the transient zero-size measurement while the dock is hidden).
    const scale = Math.min(1, total / (a + b));
    const lo = a * scale, hi = total - b * scale;
    const wanted = Number.isFinite(railExtent(node.first, coord)) ? lo :
      Number.isFinite(railExtent(node.second, coord)) ? hi : total * node.ratio;
    const position = Math.min(hi, Math.max(lo, Math.round(wanted)));
    const offset = area[coord] + position;
    dividers.push({ path, axis: coord, area, position, minRatio: total ? lo / total : 0.5, maxRatio: total ? hi / total : 0.5,
      rect: { ...area, [coord]: offset, [dim]: gap } });
    visit(node.first, { ...area, [dim]: position }, [...path, 'first']);
    visit(node.second, { ...area, [coord]: offset + gap, [dim]: total - position }, [...path, 'second']);
  }
  visit(layout, { x: 0, y: 0, width: Math.max(0, width), height: Math.max(0, height) }, []);
  return { tiles, dividers, collapsed, rails };
}

export function edgeAt(rect: Rect, x: number, y: number): Edge {
  const dx = (x - rect.x) / rect.width - 0.5;
  const dy = (y - rect.y) / rect.height - 0.5;
  return Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'top' : 'bottom');
}
