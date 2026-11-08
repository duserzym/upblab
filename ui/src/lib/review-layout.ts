export const panes = ['spots', 'plots', 'details', 'images'] as const;
export type Pane = typeof panes[number];
export type Axis = 'x' | 'y';
export type Edge = 'left' | 'right' | 'top' | 'bottom';
export type Layout = Pane | Split;
type Split = { axis: Axis; ratio: number; first: Layout; second: Layout };
type Path = ('first' | 'second')[];
export type Rect = { x: number; y: number; width: number; height: number };
type Divider = { path: Path; rect: Rect; area: Rect; axis: Axis; position: number };
export const gap = 8;

export function defaultLayout(images: boolean, dataWidth = 50): Layout {
  const sidebar: Layout = { axis: 'y', ratio: 0.62, first: 'spots', second: 'details' };
  return {
    axis: 'x', ratio: 0.20, first: sidebar,
    second: images ? { axis: 'x', ratio: dataWidth / 100, first: 'plots', second: 'images' } : 'plots',
  };
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
    if (valid(value) && seen.size === (images ? 4 : 3)) return value;
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

export function resize(layout: Layout, path: Path, ratio: number): Layout {
  if (typeof layout === 'string') return layout;
  const [head, ...rest] = path;
  if (!head) return { ...layout, ratio: Math.max(0.02, Math.min(0.98, ratio)) };
  return { ...layout, [head]: resize(layout[head], rest, ratio) };
}

const minimum = {
  spots: { x: 124, y: 108 }, plots: { x: 240, y: 160 },
  details: { x: 154, y: 92 }, images: { x: 260, y: 160 },
};

function minSize(layout: Layout, axis: Axis): number {
  if (typeof layout === 'string') return minimum[layout][axis];
  const a = minSize(layout.first, axis), b = minSize(layout.second, axis);
  return layout.axis === axis ? a + gap + b : Math.max(a, b);
}

export function geometry(layout: Layout, width: number, height: number) {
  const tiles: Partial<Record<Pane, Rect>> = {};
  const dividers: Divider[] = [];
  function visit(node: Layout, area: Rect, path: Path) {
    if (typeof node === 'string') {
      tiles[node] = area;
      return;
    }
    const horizontal = node.axis === 'x';
    const dim = horizontal ? 'width' : 'height', coord = node.axis;
    const total = Math.max(0, area[dim] - gap);
    const a = minSize(node.first, coord), b = minSize(node.second, coord);
    const scale = Math.min(1, total / (a + b));
    const position = Math.round(Math.min(total - b * scale, Math.max(a * scale, total * node.ratio)));
    const offset = area[coord] + position;
    dividers.push({ path, axis: coord, area, position, rect: { ...area, [coord]: offset, [dim]: gap } });
    visit(node.first, { ...area, [dim]: position }, [...path, 'first']);
    visit(node.second, { ...area, [coord]: offset + gap, [dim]: total - position }, [...path, 'second']);
  }
  visit(layout, { x: 0, y: 0, width, height }, []);
  return { tiles, dividers };
}

export function edgeAt(rect: Rect, x: number, y: number): Edge {
  const dx = (x - rect.x) / rect.width - 0.5;
  const dy = (y - rect.y) / rect.height - 0.5;
  return Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'top' : 'bottom');
}
