import { expect, it } from 'vitest';
import { defaultLayout, defaultRatio, dock, equalLayout, gap, geometry, minimum, migrateSplitLayout, presetLayout, presets, railSize, readLayout, resize, type Layout, type Pane } from './review-layout';

it('fits the default review into a narrow desktop window', () => {
  const { tiles, dividers } = geometry(defaultLayout(true), 1280, 650);
  expect(dividers).toHaveLength(3);
  expect(tiles.images!.width).toBeGreaterThan(500);
  expect(tiles.plots!.width).toBeGreaterThan(240);
  expect(tiles.details!.y).toBe(tiles.images!.height + gap);
  expect(tiles.details!.x).toBe(tiles.images!.x);
  expect(tiles.details!.width).toBe(tiles.images!.width);
  expect(tiles.spots!.height).toBe(650);
  expect(tiles.plots!.y).toBe(tiles.images!.y);
  expect(tiles.plots!.height).toBe(tiles.images!.height + gap + tiles.details!.height);
  expect(tiles.images!.x + tiles.images!.width).toBe(1280);
});

it('re-tiles panes and remembers the resized layout', () => {
  const next = dock(defaultLayout(true), 'images', 'plots', 'top');
  const layout = resize(next, ['second'], 0.65);
  const json = JSON.stringify(layout);
  expect(readLayout(json, true, 50)).toEqual(layout);
  const { tiles } = geometry(layout, 1280, 650);
  expect(Object.keys(tiles)).toHaveLength(4);
  expect(tiles.images!.x).toBe(tiles.plots!.x);
  expect(tiles.images!.y + tiles.images!.height + gap).toBe(tiles.plots!.y);
});

it('rejects invalid saved layouts and layouts that repeat panes', () => {
  expect(readLayout('invalid', true, 57)).toEqual(defaultLayout(true, 57));
  expect(readLayout(JSON.stringify(defaultLayout(true)), false, 50)).toEqual(defaultLayout(false));
  expect(readLayout('{"axis":"x","ratio":0.5,"first":"plots","second":"plots"}', true, 42)).toEqual(defaultLayout(true));
});

it('enforces the minimums when the dock has room for every pane', () => {
  for (const images of [true, false]) {
    const result = geometry(defaultLayout(images), 1280, 800);
    expect(result.collapsed).toEqual([]);
    for (const pane of Object.keys(result.tiles) as Pane[]) {
      expect(result.tiles[pane]!.width).toBeGreaterThanOrEqual(minimum[pane].x);
      expect(result.tiles[pane]!.height).toBeGreaterThanOrEqual(minimum[pane].y);
    }
  }
});

const row: Layout = { axis: 'x', ratio: 0.25, first: 'details', second: {
  axis: 'x', ratio: 0.3, first: 'spots', second: { axis: 'x', ratio: 0.5, first: 'plots', second: 'images' },
} };

it('collapses details before spots into header rails, without shrinking the primary panes', () => {
  const one = geometry(row, 1024, 500);
  expect(one.collapsed).toEqual(['details']);
  expect(one.tiles.details!.width).toBe(railSize);
  const two = geometry(row, 800, 500);
  expect(two.collapsed).toEqual(['details', 'spots']);
  expect(two.rails).toEqual({ details: 'x', spots: 'x' });
  for (const pane of ['plots', 'images'] as const) expect(two.tiles[pane]!.width).toBeGreaterThanOrEqual(minimum[pane].x);
  // Fitting is pure and automatically restores all panes when room returns.
  expect(geometry(row, 1280, 800).collapsed).toEqual([]);
});

it('uses header strips when vertical minimums no longer fit', () => {
  const column: Layout = { axis: 'y', ratio: 0.25, first: 'details', second: {
    axis: 'y', ratio: 0.3, first: 'spots', second: 'plots',
  } };
  const result = geometry(column, 800, 400);
  expect(result.collapsed).toEqual(['details']);
  expect(result.rails.details).toBe('y');
  expect(result.tiles.details!.height).toBe(railSize);
  expect(result.tiles.plots!.height).toBeGreaterThanOrEqual(240);
});

it('clamps saved divider drags and keyboard resizes to the tree minimums', () => {
  const layout = defaultLayout(true);
  const bounds = { width: 1280, height: 800 };
  for (const ratio of [-1, 2]) {
    const next = resize(layout, [], ratio, bounds);
    const { tiles } = geometry(next, bounds.width, bounds.height);
    expect(tiles.spots!.width).toBeGreaterThanOrEqual(220);
    expect(tiles.details!.width).toBeGreaterThanOrEqual(240);
    expect(tiles.plots!.width).toBeGreaterThanOrEqual(320);
    expect(tiles.images!.width).toBeGreaterThanOrEqual(320);
    expect(typeof next !== 'string' && next.ratio).toBeCloseTo(ratio < 0 ? 220 / 1272 : (1272 - 648) / 1272);
  }
});

it('resets matching splits to the current mode default and moved trees to one half', () => {
  expect(defaultRatio(defaultLayout(true), [], true)).toBe(0.17);
  expect(defaultRatio(defaultLayout(true), ['second'], true, 57)).toBe(0.57);
  expect(defaultRatio(defaultLayout(false), ['first'], false)).toBe(0.62);
  expect(defaultRatio(dock(defaultLayout(true), 'images', 'plots', 'top'), [], true)).toBe(0.5);
});

it('round-trips every preset in each mode and fits minimums at 1280 × 800', () => {
  for (const images of [true, false]) for (const name of presets) {
    const layout = presetLayout(name, images);
    expect(readLayout(JSON.stringify(layout), images, 50)).toEqual(layout);
    const { tiles, collapsed } = geometry(layout, 1280, 800);
    expect(collapsed).toEqual([]);
    for (const pane of Object.keys(tiles) as Pane[]) {
      expect(tiles[pane]!.width).toBeGreaterThanOrEqual(minimum[pane].x);
      expect(tiles[pane]!.height).toBeGreaterThanOrEqual(minimum[pane].y);
    }
  }
});

it('matches an active preset regardless of the stored JSON property order', () => {
  const balanced = defaultLayout(true);
  expect(equalLayout(balanced, readLayout(JSON.stringify(balanced), true, 50))).toBe(true);
  expect(equalLayout(defaultLayout(false), { second: 'plots', first: { second: 'details', first: 'spots', ratio: 0.62, axis: 'y' }, ratio: 0.2, axis: 'x' })).toBe(true);
  expect(equalLayout(balanced, presetLayout('Plots focus', true))).toBe(false);
});

it('preserves primary minimums in a short vertical stack by railing SEM after metadata and Spots', () => {
  const stack: Layout = { axis: 'y', ratio: 0.25, first: 'details', second: {
    axis: 'y', ratio: 0.3, first: 'spots', second: { axis: 'y', ratio: 0.5, first: 'plots', second: 'images' },
  } };
  const result = geometry(stack, 1024, 400);
  expect(result.collapsed).toEqual(['details', 'spots', 'images']);
  expect(result.tiles.plots!.height).toBeGreaterThanOrEqual(240);
  for (const pane of result.collapsed) expect(result.tiles[pane]!.height).toBe(railSize);
  expect(geometry(stack, 1024, 800).collapsed).toEqual([]);
});

it('clamps nested horizontal and vertical dividers without changing their ancestors', () => {
  for (const path of [['second'], ['second', 'second']] as const) for (const ratio of [-1, 2]) {
    const next = resize(defaultLayout(true), [...path], ratio, { width: 1280, height: 800 });
    expect(typeof next !== 'string' && next.ratio).toBe(0.17);
    const { tiles, collapsed } = geometry(next, 1280, 800);
    expect(collapsed).toEqual([]);
    for (const pane of Object.keys(tiles) as Pane[]) {
      expect(tiles[pane]!.width).toBeGreaterThanOrEqual(minimum[pane].x);
      expect(tiles[pane]!.height).toBeGreaterThanOrEqual(minimum[pane].y);
    }
  }
});

function oldPreset(name: typeof presets[number], dataWidth = 50): Layout {
  return { axis: 'x', ratio: name === 'Balanced' ? 0.2 : 0.18,
    first: { axis: 'y', ratio: 0.62, first: 'spots', second: 'details' },
    second: { axis: 'x', ratio: name === 'Balanced' ? dataWidth / 100 : name === 'Plots focus' ? 0.7 : 0.38, first: 'plots', second: 'images' } };
}

it('puts details under images in every preset and preserves dataWidth as the plots share', () => {
  for (const [name, ratio] of [['Balanced', 0.42], ['Plots focus', 0.58], ['Image focus', 0.34]] as const) {
    expect(presetLayout(name, true)).toEqual({ axis: 'x', ratio: 0.17, first: 'spots', second: {
      axis: 'x', ratio, first: 'plots', second: { axis: 'y', ratio: 0.45, first: 'images', second: 'details' },
    } });
  }
  expect(defaultLayout(true, 57)).toEqual({ axis: 'x', ratio: 0.17, first: 'spots', second: {
    axis: 'x', ratio: 0.57, first: 'plots', second: { axis: 'y', ratio: 0.45, first: 'images', second: 'details' },
  } });
  expect(defaultRatio(defaultLayout(true), ['second', 'second'], true)).toBe(0.45);
  expect(defaultLayout(false, 57)).toEqual(defaultLayout(false));
  expect(presetLayout('Plots focus', false)).toEqual({ axis: 'x', ratio: 0.18,
    first: { axis: 'y', ratio: 0.62, first: 'spots', second: 'details' }, second: 'plots' });
});

it('migrates exact old split presets on read, including stored Balanced data widths, once', () => {
  for (const dataWidth of [30, 50, 57, 70]) for (const name of presets) {
    const old = oldPreset(name, dataWidth), before = JSON.stringify(old);
    const expected = name === 'Balanced' ? defaultLayout(true, dataWidth === 50 ? 42 : dataWidth) : presetLayout(name, true);
    expect(migrateSplitLayout(old, dataWidth)).toEqual(expected);
    expect(readLayout(before, true, dataWidth)).toEqual(expected);
    expect(migrateSplitLayout(expected, dataWidth)).toBe(expected);
    expect(JSON.stringify(old)).toBe(before);
  }
});

it('keeps customised split ratios and topology instead of mistaking them for old presets', () => {
  for (const name of presets) for (const path of [[], ['first'], ['second']] as const) {
    const custom = resize(oldPreset(name), [...path], 0.61);
    expect(migrateSplitLayout(custom, 50)).toBe(custom);
    expect(readLayout(JSON.stringify(custom), true, 50)).toEqual(custom);
  }
  const moved = dock(oldPreset('Balanced'), 'details', 'images', 'left');
  expect(migrateSplitLayout(moved, 50)).toBe(moved);
  expect(readLayout(JSON.stringify(moved), true, 50)).toEqual(moved);
  // A right divider that differs from the stored dataWidth is a custom resize.
  const changed = oldPreset('Balanced', 57);
  expect(migrateSplitLayout(changed, 50)).toBe(changed);
});

it('collapses under-image metadata into a horizontal summary rail in the shortest dock', () => {
  for (const name of presets) {
    const result = geometry(presetLayout(name, true), 1024, 490);
    expect(result.collapsed).toEqual(['details']);
    expect(result.rails).toEqual({ details: 'y' });
    expect(result.tiles.details!.height).toBe(railSize);
    expect(result.tiles.details!.y).toBe(result.tiles.images!.height + gap);
    expect(result.tiles.images!.height).toBeGreaterThanOrEqual(minimum.images.y);
  }
  expect(geometry(defaultLayout(true), 1280, 650).collapsed).toEqual([]);
});

function previousPreset(name: typeof presets[number]): Layout {
  return { axis: 'x', ratio: 0.17, first: 'spots', second: {
    axis: 'x', ratio: name === 'Balanced' ? 0.5 : name === 'Plots focus' ? 0.7 : 0.38,
    first: 'plots', second: { axis: 'y', ratio: 0.6, first: 'images', second: 'details' },
  } };
}

it('migrates only exact previous under-image presets, preserving every custom divider and topology', () => {
  for (const name of presets) {
    const previous = previousPreset(name);
    expect(readLayout(JSON.stringify(previous), true, 50)).toEqual(presetLayout(name, true));
    for (const path of [[], ['second'], ['second', 'second']] as const) {
      const custom = resize(previous, [...path], 0.61);
      expect(migrateSplitLayout(custom, 50)).toBe(custom);
    }
    const custom = dock(previous, 'details', 'plots', 'bottom');
    expect(migrateSplitLayout(custom, 50)).toBe(custom);
  }
  expect(geometry(defaultLayout(true), 1280, 656).tiles.details!.width).toBeGreaterThan(560);
});
