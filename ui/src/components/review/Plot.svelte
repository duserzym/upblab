<script lang="ts">
  import { containedPopover } from '../../lib/contained-popover';
  import { editInAtlas, openInStudio } from '../../lib/apps.svelte';
  import uPlot from 'uplot';
  import { untrack, getContext, tick, type Snippet } from 'svelte';
  import { review } from '../../lib/review.svelte';
  import 'uplot/dist/uPlot.min.css';
  import { settings } from '../../lib/settings.svelte';
  import { dateLabel, type ReviewSpot } from '../../lib/review-data';
  import { traceEllipse, mapEllipse, type Ellipse } from '../../lib/concordia-geometry';
  import { frameQueue } from '../../lib/animation-frame';
  import { hitGrid, type HitPoint } from './plot-hit';
  import { reconcileTargets, type PointTarget } from './plot-targets';
  import { markBounds } from './plot-bounds';
  import type { Point } from '../../lib/concordia';
  import { color, isotopeLabel, type Mark, type Guide, type Band } from './plot-data';
  import { PLOT_VISIBILITY, plotVisibility, type PlotVisibility, type DrawnCounts, type DrawnSummary } from './plot-visibility';
  import { panBounds, zoomBounds, type Bounds, type DragTool, type ZoomAxis } from './plot-viewport';
  let { marks, guidesForBounds, emptyBounds, bands = [], hidden = new Set<string>(), selected, onselect, xLabel, yLabel, logX = false, logY = false, xTicks = [], legend = true, sharedHover = true, viewport = $bindable(null), onbox, ontoggle, controls }: {
    controls?: Snippet<[Snippet]>;
    marks: Mark[];
    guidesForBounds?: (bounds: Bounds, toScreen: (p: Point) => Point) => Guide[];
    emptyBounds?: Bounds;
    bands?: Band[];
    hidden?: ReadonlySet<string>;
    selected: string | null;
    onselect: (spot: ReviewSpot) => void;
    xLabel: string;
    yLabel: string;
    logX?: boolean;
    logY?: boolean;
    xTicks?: string[];
    legend?: boolean;
    sharedHover?: boolean;
    viewport?: Bounds | null;
    onbox?: (bounds: Bounds) => void;
    ontoggle?: (spot: ReviewSpot) => void;
  } = $props();
  const visibility = getContext<PlotVisibility | undefined>(PLOT_VISIBILITY);
  const hiddenKeys = $derived(new Set([...hidden, ...(visibility?.hidden() ?? [])]));
  const data = $derived(plotVisibility({ marks, bands, samples: visibility?.samples(), hidden: hiddenKeys }));
  const visibleKeys = $derived(new Set(data.marks.map(m => m.spot.key)));
  let menu = $state<HTMLDivElement>();
  let menuAnchor = $state<HTMLElement>();
  let menuSpot = $state<ReviewSpot | null>(null);
  async function openMenu(spot: ReviewSpot, anchor: HTMLElement) {
    onselect(spot);
    menuSpot = spot; menuAnchor = anchor;
    await tick();
    // Selecting scrolls the Spots list to the spot; containedPopover closes
    // on any scroll, so open once that scroll has happened.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (!menu || menuSpot !== spot) return;
    if (!menu.matches(':popover-open')) menu.showPopover();
    menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    // A manual popover: WebKit fires contextmenu on mouse-down, and an auto
    // popover would be light-dismissed by the mouse-up that follows.
    document.removeEventListener('pointerdown', outside, true);
    setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
  }
  function outside(event: PointerEvent) {
    if (menu?.contains(event.target as Node)) return;
    closeMenu();
  }
  function closeMenu() {
    document.removeEventListener('pointerdown', outside, true);
    if (menu?.matches(':popover-open')) menu.hidePopover();
  }
  $effect(() => () => document.removeEventListener('pointerdown', outside, true));
  function menuKey(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenu(); menuAnchor?.focus(); }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const buttons = [...(menu?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[(index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus();
    }
    if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && ['e', 's'].includes(event.key.toLowerCase())) {
      event.preventDefault(); event.stopPropagation(); act(event.key.toLowerCase() === 'e' ? 'atlas' : 'studio');
    }
  }
  function act(action: 'atlas' | 'studio' | 'images' | 'hide') {
    const spot = menuSpot;
    closeMenu();
    if (!spot) return;
    const atlas = { project: spot.atlasProjectId, mount: spot.mountId, spot: spot.atlasSpotId };
    if (action === 'atlas' && spot.atlasProjectId) void editInAtlas(atlas, 'review');
    if (action === 'studio' && (spot.sessionId || spot.runId)) void openInStudio({ session: spot.sessionId, run: spot.runId, acquisition: spot.acquisitionId }, 'review');
    if (action === 'hide') ontoggle?.(spot);
  }
  const visible = getContext<() => boolean>('upbstudio.review-visible') ?? (() => true);
  let host = $state<HTMLDivElement>();
  let width = $state(400), height = $state(300);
  let instance = $state.raw<uPlot>();
  let tool = $state<DragTool>('pan');
  let zoomAxis = $state<ZoomAxis>('both');
  let box = $state<{ start: Point; end: Point } | null>(null);
  const tools: { id: DragTool; label: string; title: string }[] = [
    { id: 'pan', label: 'Pan', title: 'Drag to move the view' },
    { id: 'zoom', label: 'Box zoom', title: 'Drag a rectangle to zoom to its bounds' },
    { id: 'select', label: 'Box select', title: 'Drag a rectangle to select the spots whose centers are inside' },
  ];
  let targets = $state.raw<PointTarget[]>([]);
  let chart = $state<HTMLDivElement>();
  let overlay = $state<HTMLCanvasElement>();
  let gesturing = $state(false);
  let paintHover = () => {};
  $effect(() => { void review.hoveredKey; void hovered; paintHover(); });
  let hovered = $state<ReviewSpot | null>(null);
  let tooltip = $state({ x: 0, y: 0 });
  $effect(() => { void selected; hovered = null; });
  function pointHover(target: {spot: ReviewSpot; x: number; y: number}) {
    setHover(target.spot, target.x, target.y);
  }
  function clearPointHover() {
    if (hovered) hovered = null;
    if (sharedHover && review.hoveredKey !== null) review.hoveredKey = null;
  }
  function setHover(spot: ReviewSpot | null, x: number, y: number) {
    if (hovered?.key !== spot?.key) hovered = spot;
    if (sharedHover && review.hoveredKey !== (spot?.key ?? null)) review.hoveredKey = spot?.key ?? null;
    const tx = Math.max(0, Math.min(width - 190, x + 8)), ty = Math.max(0, y - 45);
    if (spot && (tooltip.x !== tx || tooltip.y !== ty)) tooltip = { x: tx, y: ty };
  }
  const pointTargets = $derived(targets);
  let targetByKey = new Map<string, PointTarget>();
  const targetKeys = $derived(new Set(pointTargets.map(t => t.spot.key)));
  const targetElements = new Map<string, HTMLButtonElement>();
  let previousTargetSelection: string | null = null, previousTargetHover: string | null = null;
  let previousTargetList: typeof pointTargets | undefined;
  function placeTarget(target: PointTarget) {
    const node = targetElements.get(target.spot.key);
    if (node) { node.style.left = `${target.x}px`; node.style.top = `${target.y}px`; }
  }
  function targetFlags(node: HTMLButtonElement, key: string) {
    targetElements.set(key, node);
    const target = targetByKey.get(key);
    if (target) placeTarget(target);
    untrack(() => {
      node.dataset.selected = String(selected === key);
      node.dataset.hovered = String(sharedHover && review.hoveredKey === key);
      node.tabIndex = (targetKeys.has(selected ?? '') ? selected === key : pointTargets[0]?.spot.key === key) ? 0 : -1;
    });
    return { destroy() { if (targetElements.get(key) === node) targetElements.delete(key); } };
  }
  $effect(() => {
    const key = selected, hover = sharedHover ? review.hoveredKey : null;
    const points = pointTargets;
    untrack(() => {
      if (previousTargetSelection !== key || previousTargetList !== points) {
        const old = previousTargetSelection ? targetElements.get(previousTargetSelection) : undefined;
        if (old) { old.dataset.selected = 'false'; old.tabIndex = -1; }
        const first = pointTargets[0] ? targetElements.get(pointTargets[0].spot.key) : undefined;
        if (first) first.tabIndex = -1;
        const current = key ? targetElements.get(key) : undefined;
        if (current) { current.dataset.selected = 'true'; current.tabIndex = 0; }
        else if (first) first.tabIndex = 0;
      }
      if (previousTargetHover !== hover || previousTargetList !== points) {
        if (previousTargetHover) { const node = targetElements.get(previousTargetHover); if (node) node.dataset.hovered = 'false'; }
        if (hover) { const node = targetElements.get(hover); if (node) node.dataset.hovered = 'true'; }
      }
      previousTargetSelection = key; previousTargetHover = hover; previousTargetList = points;
    });
  });
  $effect(() => {
    if (hovered && !visibleKeys.has(hovered.key)) clearPointHover();
    if (menuSpot && !visibleKeys.has(menuSpot.key)) { closeMenu(); menuSpot = null; }
  });
  $effect(() => {
    if (!visible() || !host)
      return;
    let timer: ReturnType<typeof setTimeout>;
    const ro = new ResizeObserver(([e]) => {
      clearTimeout(timer);
      // Resize the existing canvas without writing the bindable viewport.
      timer = setTimeout(() => { width = Math.max(1, Math.floor(e.contentRect.width)); height = Math.max(1, Math.floor(e.contentRect.height)); }, 100);
    });
    ro.observe(host);
    return () => { clearTimeout(timer); ro.disconnect(); };
  });
  const valid = (p: Point | null | undefined): p is Point => !!p && p.every(Number.isFinite) && (!logX || p[0] > 0) && (!logY || p[1] > 0);
  const fullBounds = $derived(markBounds(data.marks, data.bands, logX, logY, emptyBounds));
  const bounds = $derived(viewport ?? fullBounds);
  function zoom(factor: number, anchor: Point = [0.5, 0.5]) {
    viewport = zoomBounds(bounds, factor, anchor, zoomAxis);
  }

  $effect(() => {
    if (!visible() || !host)
      return;
    void settings.effectiveTheme;
    const css = getComputedStyle(document.documentElement);
    const axis = css.getPropertyValue('--plot-axis').trim(), grid = css.getPropertyValue('--plot-grid').trim();
    const pixel = (u: uPlot, p: Point): Point => [u.valToPos(p[0], 'x', true), u.valToPos(p[1], 'y', true)];
    const path = (u: uPlot, points: (Point | null)[], close = false) => {
      const ctx = u.ctx;
      ctx.beginPath();
      let pen = false;
      for (const p of points) {
        if (!valid(p)) {
          pen = false;
          continue;
        }
        const [x, y] = pixel(u, p);
        if (pen)
          ctx.lineTo(x, y);
        else
          ctx.moveTo(x, y);
        pen = true;
      }
      if (close)
        ctx.closePath();
    };
    const polygonPath = (target: Path2D, u: uPlot, points: Point[]) => {
      let pen = false;
      for (const p of points) {
        if (!valid(p)) { pen = false; continue; }
        const [x, y] = pixel(u, p);
        if (pen) target.lineTo(x, y); else target.moveTo(x, y);
        pen = true;
      }
      target.closePath();
    };
    let guideCache: { bounds: Bounds; width: number; height: number; source: typeof guidesForBounds; guides: Guide[] } | undefined;
    let baseDrawn: DrawnSummary = Object.create(null);
    let hoveredMarks = new Map<string, Mark>();
    let cachedHit: (x: number, y: number, ellipses?: boolean) => ReviewSpot | null = () => null;
    type ProjectedMark = { mark: Mark; key: string; ink: string; series: string; centre?: Point; exact?: Ellipse; polygon?: Point[] };
    let projectionCache: { marks: Mark[]; bounds: Bounds; left: number; top: number; width: number; height: number; dpr: number; projected: ProjectedMark[] } | undefined;
    const drawHighlight = (u: uPlot, ctx: CanvasRenderingContext2D, mark: Mark) => {
      const dpr = u.ctx.canvas.width / u.width;
      ctx.globalAlpha = 1; ctx.strokeStyle = color(mark.spot.sampleName); ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = 2.5 * dpr;
      let rings = 0;
      if (mark.path) {
        const p = new Path2D(); let pen = false;
        for (const point of mark.path) {
          if (!valid(point)) { pen = false; continue; }
          const [x, y] = pixel(u, point);
          if (pen) p.lineTo(x, y); else p.moveTo(x, y);
          pen = true;
        }
        ctx.stroke(p);
        for (const point of mark.path) if (valid(point)) {
          const [x, y] = pixel(u, point); ctx.beginPath(); ctx.arc(x, y, 4 * dpr, 0, 2 * Math.PI); ctx.stroke(); rings++;
        }
      }
      if (mark.ellipse && !logX && !logY) { const p = new Path2D(); traceEllipse(p, mapEllipse(mark.ellipse, p => pixel(u, p))); ctx.stroke(p); }
      else if (mark.polygon) { const p = new Path2D(); polygonPath(p, u, mark.polygon); ctx.stroke(p); }
      if (valid(mark.point)) {
        const [x, y] = pixel(u, mark.point);
        ctx.beginPath(); ctx.arc(x, y, 3 * dpr, 0, 2 * Math.PI); ctx.fill();
        ctx.beginPath(); ctx.arc(x, y, 7 * dpr, 0, 2 * Math.PI); ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, 10 * dpr, 0, 2 * Math.PI); ctx.strokeStyle = axis; ctx.lineWidth = 2 * dpr; ctx.stroke(); rings += 2;
      }
      return rings;
    };
    const overlayHover = (u: uPlot) => {
      if (!overlay) return;
      const canvas = u.ctx.canvas;
      if (overlay.style.width !== `${u.width}px`) overlay.style.width = `${u.width}px`;
      if (overlay.style.height !== `${u.height}px`) overlay.style.height = `${u.height}px`;
      if (overlay.width !== canvas.width) overlay.width = canvas.width;
      if (overlay.height !== canvas.height) overlay.height = canvas.height;
      const ctx = overlay.getContext('2d')!;
      ctx.clearRect(0, 0, overlay.width, overlay.height);
      const key = sharedHover ? review.hoveredKey : null;
      const mark = key ? hoveredMarks.get(key) : undefined;
      const drawn = { ...baseDrawn };
      if (mark) {
        ctx.save(); ctx.beginPath(); ctx.rect(u.bbox.left, u.bbox.top, u.bbox.width, u.bbox.height); ctx.clip();
        const rings = drawHighlight(u, ctx, mark);
        ctx.restore();
        if (mark.spot.key !== selected && !mark.boxed) {
          const series = mark.seriesKey ?? mark.spot.sampleName;
          if (drawn[series]) drawn[series] = { ...drawn[series], rings: drawn[series].rings + rings };
        }
      }
      if (chart) chart.dataset.drawn = JSON.stringify(drawn);
    };
    const draw = (u: uPlot) => {
      const ctx = u.ctx, dpr = u.ctx.canvas.width / u.width;
      const drawn: DrawnSummary = Object.create(null);
      const count = (series: string, kind: keyof DrawnCounts, n = 1) => {
        const counts = drawn[series] ??= { points: 0, ellipses: 0, paths: 0, bands: 0, rings: 0, labels: 0 };
        counts[kind] += n;
      };
      ctx.save();
      ctx.beginPath();
      ctx.rect(u.bbox.left, u.bbox.top, u.bbox.width, u.bbox.height);
      ctx.clip();
      for (const b of data.bands) {
        // Keep null gaps: never bridge a missing stored sweep value.
        let upper: Point[] = [], lower: Point[] = [];
        let painted = false;
        const flush = () => { if (upper.length) {
          path(u, [...upper, ...lower.reverse()], true);
          painted = true;
          ctx.fillStyle = b.color;
          ctx.globalAlpha = 0.15;
          ctx.fill();
        } upper = []; lower = []; };
        b.upper.forEach((p, i) => { const q = b.lower[i]; if (valid(p) && valid(q)) {
          upper.push(p);
          lower.push(q);
        }
        else
          flush(); });
        flush();
        if (painted) count(b.seriesKey ?? '__unowned__', 'bands');
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = axis;
      ctx.lineWidth = dpr;
      const labels: { x: number; y: number; width: number }[] = [];
      if (!guideCache || guideCache.bounds !== bounds || guideCache.width !== u.bbox.width || guideCache.height !== u.bbox.height || guideCache.source !== guidesForBounds) {
        guideCache = { bounds, width: u.bbox.width, height: u.bbox.height, source: guidesForBounds,
          guides: guidesForBounds?.(bounds, p => { const q = pixel(u, p); return [q[0] / dpr, q[1] / dpr]; }) ?? [],
        };
      }
      const guides = plotVisibility({ marks: [], guides: guideCache.guides, hidden: hiddenKeys }).guides;
      for (const guide of guides) {
        const series = guide.seriesKey ?? '__reference__';
        path(u, guide.path);
        ctx.stroke();
        if (guide.path.some(valid)) count(series, 'paths');
        if (guide.point && valid(guide.point)) {
          const [x, y] = pixel(u, guide.point);
          ctx.font = `${10 * dpr}px system-ui`;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'alphabetic';
          const label = guide.label ?? '';
          const labelWidth = ctx.measureText(label).width;
          const labelX = Math.max(u.bbox.left + 2 * dpr, Math.min(x + 4 * dpr, u.bbox.left + u.bbox.width - labelWidth - 2 * dpr));
          const labelY = Math.max(u.bbox.top + 10 * dpr, y - 4 * dpr);
          const accepted = x >= u.bbox.left && x < u.bbox.left + u.bbox.width && y >= u.bbox.top && y < u.bbox.top + u.bbox.height &&
              labels.every(p => labelX > p.x + p.width + 4 * dpr || labelX + labelWidth + 4 * dpr < p.x || Math.abs(labelY - p.y) > 14 * dpr);
          // As in Studio, a labelled age shows its marker only when its label fits.
          if (accepted || !label) {
            count(series, 'points');
            ctx.beginPath();
            ctx.arc(x, y, 2 * dpr, 0, 2 * Math.PI);
            ctx.fillStyle = axis;
            ctx.fill();
          }
          if (accepted) {
            ctx.fillText(label, labelX, labelY);
            if (label) count(series, 'labels');
            labels.push({ x: labelX, y: labelY, width: labelWidth });
          }
        }
      }
      const pens = new Map<string, { stroke: Path2D; fill: Path2D; color: string; alpha: number; width: number }>();
      // Selection changes only pens/dimming, so reuse pixel geometry and the hit grid.
      if (!projectionCache || projectionCache.marks !== data.marks || projectionCache.bounds !== bounds ||
          projectionCache.left !== u.bbox.left || projectionCache.top !== u.bbox.top || projectionCache.width !== u.bbox.width || projectionCache.height !== u.bbox.height || projectionCache.dpr !== dpr) {
        const hits: HitPoint<ReviewSpot>[] = [];
        hoveredMarks = new Map();
        const projected: ProjectedMark[] = data.marks.map(mark => {
          const exact = mark.ellipse && !logX && !logY ? mapEllipse(mark.ellipse, p => pixel(u, p)) : undefined;
          const polygon = exact ? undefined : mark.polygon;
          hoveredMarks.set(mark.spot.key, mark);
          const centre = valid(mark.point) ? pixel(u, mark.point) : undefined;
          const positions = mark.point ? [mark.point] : mark.path ?? [];
          const hitEllipse = exact ? { centre: [(exact.centre[0] - u.bbox.left) / dpr, (exact.centre[1] - u.bbox.top) / dpr] as Point,
            a: [exact.a[0] / dpr, exact.a[1] / dpr] as Point, b: [exact.b[0] / dpr, exact.b[1] / dpr] as Point } : undefined;
          const hitPolygon = polygon?.filter(valid).map(p => { const q = pixel(u, p); return [(q[0] - u.bbox.left) / dpr, (q[1] - u.bbox.top) / dpr] as Point; });
          for (const p of positions) if (valid(p)) {
            const q = centre ?? pixel(u, p);
            hits.push({ point: [(q[0] - u.bbox.left) / dpr, (q[1] - u.bbox.top) / dpr], value: mark.spot, ellipse: hitEllipse, polygon: hitPolygon });
          }
          return { mark, exact, polygon, centre, key: mark.spot.key, ink: color(mark.spot.sampleName), series: mark.seriesKey ?? mark.spot.sampleName };
        });
        cachedHit = hitGrid(hits, u.bbox.width / dpr, u.bbox.height / dpr);
        projectionCache = { marks: data.marks, bounds, ...u.bbox, dpr, projected };
      }
      const projected = projectionCache.projected, selectedKey = selected;
      const emphasis = projected.some(p => p.key === selectedKey || p.mark.boxed);
      // Two passes preserve selected/boxed priority without sorting or one stroke per ellipse.
      for (const activePass of [false, true]) {
        pens.clear();
        for (const { mark, exact, polygon, key, ink, series, centre } of projected) {
          const active = key === selectedKey || !!mark.boxed;
          if (active !== activePass) continue;
          const alpha = emphasis && !active ? 0.45 : 1, lineWidth = (active ? 2.5 : 1.2) * dpr;
          const penKey = `${ink}/${alpha}/${lineWidth}`;
          let pen = pens.get(penKey);
          if (!pen) { pen = { stroke: new Path2D(), fill: new Path2D(), color: ink, alpha, width: lineWidth }; pens.set(penKey, pen); }
          // Paths and bands keep their existing rendering and null-gap behaviour.
          ctx.globalAlpha = alpha; ctx.strokeStyle = ink; ctx.fillStyle = ink; ctx.lineWidth = lineWidth;
          if (mark.path) {
            if (mark.path.some(valid)) count(series, 'paths');
            path(u, mark.path); ctx.stroke();
            if (active) for (const p of mark.path) if (valid(p)) {
              const [x, y] = pixel(u, p); ctx.beginPath(); ctx.arc(x, y, 4 * dpr, 0, 2 * Math.PI); ctx.stroke(); count(series, 'rings');
            }
          }
          if (exact) { traceEllipse(pen.stroke, exact); count(series, 'ellipses'); }
          else if (polygon) { polygonPath(pen.stroke, u, polygon); if (polygon.some(valid)) count(series, 'ellipses'); }
          if (centre) {
            count(series, 'points');
            const [x, y] = centre;
            pen.fill.moveTo(x + 3 * dpr, y); pen.fill.arc(x, y, 3 * dpr, 0, 2 * Math.PI);
          }
        }
        for (const pen of pens.values()) {
          ctx.globalAlpha = pen.alpha; ctx.strokeStyle = pen.color; ctx.fillStyle = pen.color; ctx.lineWidth = pen.width;
          ctx.stroke(pen.stroke); ctx.fill(pen.fill);
        }
        if (activePass) for (const { mark, key, ink, series, centre } of projected) if ((key === selectedKey || mark.boxed) && centre) {
          const [x, y] = centre;
          ctx.globalAlpha = 1; ctx.strokeStyle = ink; ctx.lineWidth = 2.5 * dpr;
          ctx.beginPath(); ctx.arc(x, y, 7 * dpr, 0, 2 * Math.PI); ctx.stroke();
          ctx.beginPath(); ctx.arc(x, y, 10 * dpr, 0, 2 * Math.PI); ctx.strokeStyle = axis; ctx.lineWidth = 2 * dpr; ctx.stroke();
          count(series, 'rings', 2);
        }
      }
      ctx.restore();
      // Serialize once per draw, with one record per series (never per spot).
      baseDrawn = drawn;
      overlayHover(u);
    };
    // Keyboard and pointer targets over each point, placed after uPlot has laid
    // out (its first layout runs in a microtask), relative to the chart box.
    const placeTargets = (u: uPlot) => {
      if (!gesturing) updateTargets(u);
    };
    const updateTargets = (u: uPlot) => {
      if (!chart) return;
      const dpr = u.ctx.canvas.width / u.width, left = u.bbox.left / dpr, top = u.bbox.top / dpr;
      const next = (sharedHover ? data.marks : []).flatMap(m => {
        const p = m.point ?? m.path?.find(valid);
        if (!valid(p)) return [];
        const x = left + u.valToPos(p[0], 'x'), y = top + u.valToPos(p[1], 'y');
        return x >= left && x <= left + u.bbox.width / dpr && y >= top && y <= top + u.bbox.height / dpr
          ? [{ spot: m.spot, x, y }] : [];
      });
      untrack(() => {
        const updated = reconcileTargets(targets, next, placeTarget);
        targetByKey = new Map(updated.map(target => [target.spot.key, target]));
        if (updated !== targets) targets = updated;
      });
    };
    // Log axes: label and grid only whole decades (uPlot's default draws every minor line).
    const decades = (_u: uPlot, splits: number[]) => splits.map(v => v != null && v > 0 && Math.abs(Math.log10(v) - Math.round(Math.log10(v))) < 1e-9 ? v : null);
    const plotHost = host;
    const opts: uPlot.Options = { width: untrack(() => width), height: untrack(() => height), series: [{}, { show: false }], scales: { x: { time: false, distr: logX ? 3 : 1, range: () => bounds.x }, y: { distr: logY ? 3 : 1, range: () => bounds.y } },
      axes: [{ label: isotopeLabel(untrack(() => xLabel)), labelSize: 20, size: 42, stroke: axis, grid: { stroke: grid }, ticks: { stroke: grid }, font: '11px system-ui', ...(logX && !xTicks.length ? { filter: decades, grid: { stroke: grid, filter: decades }, ticks: { stroke: grid, filter: decades } } : {}), ...(xTicks.length ? { splits: () => xTicks.map((_, i) => i), values: (_u: uPlot, vals: number[]) => vals.map(v => xTicks[v] ?? '') } : {}) },
        { label: isotopeLabel(untrack(() => yLabel)), labelSize: 18, size: 64, stroke: axis, grid: { stroke: grid }, ticks: { stroke: grid }, font: '11px system-ui', ...(logY ? { filter: decades, grid: { stroke: grid, filter: decades }, ticks: { stroke: grid, filter: decades } } : {}), values: (_u, vals) => vals.map(v => v == null || !Number.isFinite(v) ? '' : Math.abs(v) >= 1e4 || (v !== 0 && Math.abs(v) < 0.001) ? v.toExponential(1) : Number(v.toPrecision(4)).toString()) }],
      legend: { show: false }, cursor: { show: false }, select: { show: false, left: 0, top: 0, width: 0, height: 0 }, hooks: { draw: [u => untrack(() => draw(u))], ready: [u => untrack(() => placeTargets(u))] },
    };
    const plot = untrack(() => new uPlot(opts, [[], []], plotHost));
    instance = plot;
    const surface = onbox ? chart! : plot.over;
    // Rectangles are read once on entry/gesture start, never in a frame callback.
    let rect: DOMRect | undefined;
    const measure = () => { rect = plot.over.getBoundingClientRect(); };
    const invalidateRect = () => { if (!drag && !gesturing) rect = undefined; };
    const dimensions = () => { const dpr = plot.ctx.canvas.width / plot.width; return { left: plot.bbox.left / dpr, top: plot.bbox.top / dpr, width: plot.bbox.width / dpr, height: plot.bbox.height / dpr }; };
    const local = (e: MouseEvent): Point => [e.clientX - (rect?.left ?? 0), e.clientY - (rect?.top ?? 0)];
    function hit(event: MouseEvent, includeEllipses = true): ReviewSpot | null {
      if (!rect) measure();
      return cachedHit(...local(event), includeEllipses);
    }
    let drag: { id: number; start: Point; bounds: Bounds; tool: DragTool; moved: boolean } | null = null;
    let settleTimer: ReturnType<typeof setTimeout>;
    const settle = () => {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        if (drag) return;
        updateTargets(plot);
        gesturing = false;
        rect = undefined;
      }, 120);
    };
    const beginGesture = () => {
      clearTimeout(settleTimer);
      gesturing = true; clearPointHover();
    };
    function clip([x, y]: Point): Point {
      const { width, height } = dimensions();
      return [Math.max(0, Math.min(width, x)), Math.max(0, Math.min(height, y))];
    }
    let latest: PointerEvent | undefined, ending: PointerEvent | undefined;
    let wheelFactor = 1, wheelAnchor: Point = [0.5, 0.5];
    const input = frameQueue(() => {
      const e = latest; latest = undefined;
      if (e && drag?.id === e.pointerId) {
        const [x, y] = local(e), { width, height, left, top } = dimensions();
        const dx = x - drag.start[0], dy = y - drag.start[1];
        if (drag.moved || Math.hypot(dx, dy) >= 4) {
          drag.moved = true;
          if (drag.tool === 'pan') viewport = panBounds(drag.bounds, dx / width, dy / height);
          else {
            const end = clip([x, y]);
            box = { start: [drag.start[0] + left, drag.start[1] + top], end: [end[0] + left, end[1] + top] };
          }
        }
      } else if (e && !gesturing) {
        const [x, y] = local(e), { left, top } = dimensions();
        setHover(cachedHit(x, y), x + left, y + top);
      }
      if (ending) finishDrag(ending);
      if (wheelFactor !== 1) {
        viewport = zoomBounds(bounds, wheelFactor, wheelAnchor, zoomAxis);
        wheelFactor = 1;
        settle();
      }
    });
    const down = (e: PointerEvent) => {
      if (!onbox || e.button !== 0 || drag) return;
      if (e.target !== plot.over && !(e.target instanceof HTMLElement && e.target.classList.contains('point-target'))) return;
      input.cancel(); latest = undefined; wheelFactor = 1; measure();
      drag = { id: e.pointerId, start: clip(local(e)), bounds, tool: tool === 'pan' && e.shiftKey ? 'zoom' : tool, moved: false };
      plot.over.setPointerCapture(e.pointerId);
      clearPointHover();
    };
    const click = (e: MouseEvent) => {
      if (onbox) return;
      const spot = hit(e);
      if (spot) onselect(spot);
    };
    const contextmenu = (e: MouseEvent) => {
      if (!sharedHover) return;
      const key = (e.target as HTMLElement | null)?.dataset.pointKey;
      const spot = (key ? hoveredMarks.get(key)?.spot : undefined) ?? hit(e, false);
      if (!spot) return;
      const anchor = targetElements.get(spot.key);
      if (!anchor) return;
      e.preventDefault();
      openMenu(spot, anchor);
    };
    const move = (e: PointerEvent) => {
      if (ending) return;
      if (!rect) measure();
      if (drag?.id === e.pointerId) {
        const p = local(e);
        if (Math.hypot(p[0] - drag.start[0], p[1] - drag.start[1]) >= 4) beginGesture();
      } else if (onbox && e.target instanceof HTMLElement && e.target.classList.contains('point-target')) return;
      latest = e;
      input.schedule();
    };
    const up = (e: PointerEvent) => {
      if (drag?.id !== e.pointerId) return;
      latest = ending = e;
      input.schedule();
    };
    function finishDrag(e: PointerEvent) {
      ending = undefined;
      if (!drag) return;
      const { start, moved, tool: action } = drag;
      drag = null; box = null;
      if (!moved) {
        const spot = hit(e);
        if (spot) onselect(spot);
      } else if (action !== 'pan') {
        const end = clip(local(e));
        if (Math.abs(end[0] - start[0]) >= 4 && Math.abs(end[1] - start[1]) >= 4) {
          const area: Bounds = {
            x: [plot.posToVal(Math.min(start[0], end[0]), 'x'), plot.posToVal(Math.max(start[0], end[0]), 'x')],
            y: [plot.posToVal(Math.max(start[1], end[1]), 'y'), plot.posToVal(Math.min(start[1], end[1]), 'y')],
          };
          if (action === 'zoom') viewport = area;
          else onbox?.(area);
        }
      }
      if (gesturing) settle();
    }
    const leave = () => { if (!drag) { latest = undefined; if (wheelFactor === 1) input.cancel(); clearPointHover(); rect = undefined; } };
    const cancel = () => { input.cancel(); latest = undefined; wheelFactor = 1; ending = undefined; drag = null; box = null; clearPointHover(); if (gesturing) settle(); };
    const lostCapture = () => { if (!ending) cancel(); };
    const wheel = (e: WheelEvent) => {
      if (!onbox || !e.deltaY) return;
      if (!gesturing || !rect) measure();
      const r = rect!;
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
      e.preventDefault();
      const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? r.height : 1);
      beginGesture();
      wheelFactor *= 2 ** Math.max(-1, Math.min(1, delta / 280));
      wheelAnchor = [(e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height];
      input.schedule(); settle();
    };
    paintHover = () => { if (visible()) untrack(() => overlayHover(plot)); };
    window.addEventListener('scroll', invalidateRect, true);
    surface.addEventListener('pointerenter', measure);
    window.addEventListener('blur', cancel);
    document.addEventListener('mouseleave', clearPointHover);
    plot.over.addEventListener('click', click);
    surface.addEventListener('contextmenu', contextmenu);
    surface.addEventListener('pointerdown', down);
    surface.addEventListener('pointermove', move);
    surface.addEventListener('pointerup', up);
    surface.addEventListener('lostpointercapture', lostCapture);
    surface.addEventListener('pointerleave', leave);
    surface.addEventListener('wheel', wheel, { passive: false });
    refreshTargets = () => { if (!gesturing) rect = undefined; placeTargets(plot); };
    return () => {
      input.cancel(); clearTimeout(settleTimer); gesturing = false; paintHover = () => {};
      window.removeEventListener('scroll', invalidateRect, true);
      surface.removeEventListener('pointerenter', measure);
      window.removeEventListener('blur', cancel);
      document.removeEventListener('mouseleave', clearPointHover);
      plot.over.removeEventListener('click', click);
      surface.removeEventListener('pointerdown', down);
      surface.removeEventListener('contextmenu', contextmenu);
      surface.removeEventListener('pointermove', move);
      surface.removeEventListener('pointerup', up);
      surface.removeEventListener('lostpointercapture', lostCapture);
      surface.removeEventListener('pointerleave', leave);
      surface.removeEventListener('wheel', wheel);
      instance = undefined;
      // Axis/theme reconfiguration retains the keyboard/context-menu nodes.
      if (!untrack(visible)) targets = [];
      hovered = null;
      plot.destroy();
    };
  });

  // Data, selection, and viewport edits update the existing canvas.
  let refreshTargets = () => {};
  let lastTargets: { data?: typeof data; bounds?: Bounds; w?: number; h?: number } = {};
  $effect(() => {
    const plot = instance, { x, y } = bounds, w = width, h = height;
    void data;
    void guidesForBounds;
    void selected;
    const labelX = isotopeLabel(xLabel), labelY = isotopeLabel(yLabel);
    if (!plot) return;
    untrack(() => {
      plot.batch(() => {
        plot.axes[0].label = labelX; plot.axes[1].label = labelY;
        if (plot.width !== w || plot.height !== h) plot.setSize({ width: w, height: h });
        if (plot.scales.x.min !== x[0] || plot.scales.x.max !== x[1]) plot.setScale('x', { min: x[0], max: x[1] });
        if (plot.scales.y.min !== y[0] || plot.scales.y.max !== y[1]) plot.setScale('y', { min: y[0], max: y[1] });
      });
      if (lastTargets.data !== data || lastTargets.bounds !== bounds || lastTargets.w !== w || lastTargets.h !== h) {
        refreshTargets();
        lastTargets = { data, bounds, w, h };
      }
    });
  });
</script>
{#snippet secondaryNavigation()}
  <button class="chip" aria-pressed={tool === 'select'} title="Drag a rectangle to select spots" onclick={() => tool = 'select'}>Box select</button>
  <label class="zoom-axis">Zoom
    <select aria-label="Concordia zoom axes" title="Axes affected by the zoom buttons and scroll wheel" bind:value={zoomAxis}>
      <option value="both">Both axes</option><option value="x">X only</option><option value="y">Y only</option>
    </select>
  </label>
{/snippet}
{@render controls?.(secondaryNavigation)}
<div class="chart" class:navigable={!!onbox} class:panning={tool === 'pan'} bind:this={chart} data-testid="review-plot" data-viewport={JSON.stringify(bounds)} data-drawn={'{}'} data-point-count={pointTargets.length} data-hovered-key={sharedHover ? review.hoveredKey ?? '' : ''}>
  <div class="point-targets" style:visibility={gesturing ? 'hidden' : 'visible'}>
  {#each pointTargets as t (t.spot.key)}
    <button class="point-target" aria-haspopup="menu" aria-label={`Select ${t.spot.label}`} use:targetFlags={t.spot.key} data-point-key={t.spot.key} data-sample={t.spot.sampleName} oncontextmenu={e => { e.preventDefault(); e.stopPropagation(); openMenu(t.spot, e.currentTarget); }} onkeydown={e => { if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); e.stopPropagation(); openMenu(t.spot, e.currentTarget); } }} onclick={()=>onselect(t.spot)} onmouseenter={()=>pointHover(t)} onmouseleave={clearPointHover} onfocus={()=>pointHover(t)} onblur={clearPointHover}></button>
  {/each}
  </div>
  <div class="canvas" bind:this={host}></div>
  <canvas class="hover-overlay" aria-hidden="true" bind:this={overlay}></canvas>
  {#if box}
    <div class="selection-box" style:left="{Math.min(box.start[0], box.end[0])}px" style:top="{Math.min(box.start[1], box.end[1])}px"
      style:width="{Math.abs(box.start[0] - box.end[0])}px" style:height="{Math.abs(box.start[1] - box.end[1])}px"></div>
  {/if}
  {#if hovered && visibleKeys.has(hovered.key)}<div class="tooltip small" style:left="{tooltip.x}px" style:top="{tooltip.y}px">{sharedHover ? hovered.label : hovered.sampleName}{#if sharedHover && hovered.date}<br />{dateLabel(hovered)} Ma{/if}</div>{/if}
</div>
<div popover="manual" role="menu" tabindex="-1" aria-label="Spot actions" class="panel stack spot-menu" bind:this={menu} use:containedPopover={{ anchor: () => menuAnchor, w: 220, h: ontoggle ? 190 : 150 }} onkeydown={menuKey}>
  <button class="btn" role="menuitem" disabled={!menuSpot?.atlasProjectId} title={menuSpot?.atlasProjectId ? 'Edit in grainatlas (E)' : 'No published images'} onclick={() => act('atlas')}>Edit in grainatlas <kbd>E</kbd></button>
  <button class="btn" role="menuitem" disabled={!menuSpot?.sessionId && !menuSpot?.runId} title={menuSpot?.sessionId || menuSpot?.runId ? 'Open in Studio (S)' : 'Not measured yet'} onclick={() => act('studio')}>Open in Studio <kbd>S</kbd></button>
  {#if ontoggle}<button class="btn" role="menuitem" onclick={() => act('hide')}>Hide spot</button>{/if}
</div>
{#if onbox}
  <div class="navigation row wrap" role="group" aria-label="Concordia navigation">
    {#each tools.filter(t => t.id !== 'select') as t (t.id)}
      <button class="chip" aria-pressed={tool === t.id} title={t.title} onclick={() => tool = t.id}>{t.label}</button>
    {/each}
    <div class="navigation-secondary">{@render secondaryNavigation()}</div>
    <button class="chip zoom" aria-label="Zoom in" title="Zoom in about the center" onclick={() => zoom(0.67)}>+</button>
    <button class="chip zoom" aria-label="Zoom out" title="Zoom out about the center" onclick={() => zoom(1.5)}>−</button>
    <button class="chip" title="Fit all visible spots" onclick={() => viewport = null}>Fit all</button>
  </div>
{/if}
{#if legend}<div class="legend small" aria-label="Sample legend">{#each data.legend as sample (sample.key)}
  <button class="chip" class:dimmed={!sample.shown} aria-pressed={sample.shown} aria-label={`${sample.shown ? 'Hide' : 'Show'} ${sample.name}`}
    title="Click to toggle · Shift-click to toggle a range · Alt/Option-click or Alt+Enter/Space to show only this sample"
    onclick={e => visibility?.toggle(sample.key, e)} onkeydown={e => visibility?.keydown(sample.key, e)}><i style:background={color(sample.name)}></i>{sample.name}</button>
{/each}</div>{/if}
{#if data.marks.length === 0}<p class="muted small">No stored values for these axes.</p>{/if}
<style>
  .spot-menu {background:var(--plot-bg);color:var(--text);gap:4px;padding:6px;border:1px solid var(--hairline);}
  .spot-menu:not(:popover-open) {display:none;} .spot-menu .btn {white-space:normal;justify-content:space-between;text-align:left;font-size:0.78rem;}
  .chart { position:relative; flex:1; min-height:150px;min-width:0;border-radius:var(--radius-sm); background:var(--plot-bg); overflow:hidden; }
  .point-targets {position:absolute;inset:0;pointer-events:none;z-index:1;}
  .hover-overlay {position:absolute;inset:0;width:100%;height:100%;pointer-events:none;}
  .point-target {pointer-events:auto;position:absolute;z-index:1;width:12px;height:12px;transform:translate(-50%,-50%);padding:0;border:0;background:transparent;border-radius:50%;cursor:pointer;}
  .navigable .point-target {touch-action:none;}
  .navigable:not(.panning) .point-target {cursor:crosshair;}
  .navigable :global(.u-over) {touch-action:none;cursor:crosshair;}
  .navigable.panning :global(.u-over) {cursor:grab;}
  .navigable.panning :global(.u-over:active) {cursor:grabbing;}
  .selection-box {position:absolute;pointer-events:none;border:1px solid var(--accent);background:var(--accent-soft);}
  .navigation {gap:4px;flex:none;}
  .navigation-secondary {display:contents;}
  @container (max-width:760px) {.navigation-secondary {display:none;}}
  .navigation .chip {font-size:0.74rem;padding:3px 7px;}
  .zoom {min-width:27px;}
  .zoom-axis select {font-size:0.72rem;padding:2px 4px;}
  .canvas { position:absolute; inset:0; }
  .legend { display:flex; flex-wrap:wrap; gap:4px 12px; padding:4px; overflow-wrap:anywhere; }
  .legend .chip { gap:5px; padding:2px 6px; font-size:0.72rem; }
  .legend .dimmed {opacity:0.45;}
  i { width:10px;height:10px;flex:none;border-radius:50%; }
  .tooltip { position:absolute;pointer-events:none;background:var(--plot-bg);border:1px solid var(--hairline);padding:5px;max-width:190px;overflow-wrap:anywhere; }
  @container (max-width:400px) {.navigation .chip {padding:3px 5px;font-size:0.7rem;}}
</style>
