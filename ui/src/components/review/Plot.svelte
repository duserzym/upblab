<script lang="ts">
  import { containedPopover } from '../../lib/contained-popover';
  import { editInAtlas, openInStudio } from '../../lib/apps.svelte';
  import uPlot from 'uplot';
  import { untrack, getContext, tick, type Snippet } from 'svelte';
  import { review } from '../../lib/review.svelte';
  import 'uplot/dist/uPlot.min.css';
  import { settings } from '../../lib/settings.svelte';
  import { dateLabel, type ReviewSpot } from '../../lib/review-data';
  import type { Point } from '../../lib/concordia';
  import { color, isotopeLabel, type Mark, type Guide, type Band } from './plot-data';
  import { PLOT_VISIBILITY, plotVisibility, type PlotVisibility, type DrawnCounts, type DrawnSummary } from './plot-visibility';
  import { panBounds, zoomBounds, type Bounds, type DragTool, type ZoomAxis } from './plot-viewport';
  let { marks, guidesForBounds, emptyBounds, bands = [], hidden = new Set<string>(), selected, onselect, xLabel, yLabel, logX = false, logY = false, xTicks = [], legend = true, sharedHover = true, viewport = $bindable(null), onbox, ontoggle, controls }: {
    controls?: Snippet<[Snippet]>;
    marks: Mark[];
    guidesForBounds?: (bounds: Bounds) => Guide[];
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
  let targets = $state<{ spot: ReviewSpot; x: number; y: number }[]>([]);
  let chart = $state<HTMLDivElement>();
  $effect(() => { void review.hoveredKey; void selected; instance?.redraw(false); });
  let hovered = $state<ReviewSpot | null>(null);
  let tooltip = $state({ x: 0, y: 0 });
  $effect(() => { void selected; hovered = null; });
  function pointHover(target: {spot: ReviewSpot; x: number; y: number}) {
    hovered = target.spot;
    if (sharedHover) review.hoveredKey = target.spot.key;
    tooltip = {x: Math.max(0, Math.min(width - 190, target.x + 8)), y: Math.max(0, target.y - 45)};
  }
  function clearPointHover() {
    hovered = null;
    if (sharedHover) review.hoveredKey = null;
  }
  const pointTargets = $derived(targets.filter(t => visibleKeys.has(t.spot.key)));
  const keyboardKey = $derived(pointTargets.some(p => p.spot.key === selected) ? selected : pointTargets[0]?.spot.key);
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
  const fullBounds = $derived.by((): Bounds => {
    // Axes follow the data: points and paths first. An ellipse widens them only
    // when it is no larger than the spread of the points (a badly measured spot
    // must not squash the others). The reference curve follows the resulting view.
    const core = [...data.marks.flatMap(m => [...(m.point ? [m.point] : []), ...(m.path ?? [])]), ...data.bands.flatMap(b => [...b.upper, ...b.lower])].filter(valid);
    const span = (pts: Point[], d: number) => pts.length ? Math.max(...pts.map(p => p[d])) - Math.min(...pts.map(p => p[d])) : 0;
    const sx = span(core, 0), sy = span(core, 1);
    const ellipses = data.marks.flatMap(m => {
      const poly = (m.polygon ?? []).filter(valid);
      if (!poly.length) return [];
      if (core.length > 1 && (span(poly, 0) > Math.max(sx, 1e-12) || span(poly, 1) > Math.max(sy, 1e-12))) return [];
      return poly;
    });
    if (!core.length && emptyBounds) return emptyBounds;
    const points = [...core, ...ellipses];
    const extent = (dim: number, log: boolean): [
      number,
      number
    ] => {
      if (!points.length)
        return log ? [0.1, 10] : [0, 1];
      let lo = Infinity, hi = -Infinity;
      for (const p of points) {
        lo = Math.min(lo, p[dim]);
        hi = Math.max(hi, p[dim]);
      }
      if (log) {
        const pad = Math.max(Math.log10(hi / lo) * 0.08, 0.05);
        return [lo / 10 ** pad, hi * 10 ** pad];
      }
      const pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.1 || 1;
      return [lo - pad, hi + pad];
    };
    return { x: extent(0, logX), y: extent(1, logY) };
  });
  const bounds = $derived(viewport ?? fullBounds);
  const guides = $derived(plotVisibility({ marks: [], guides: guidesForBounds?.(bounds), hidden: hiddenKeys }).guides);
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
      const labels: Point[] = [];
      for (const guide of guides) {
        const series = guide.seriesKey ?? '__reference__';
        path(u, guide.path);
        ctx.stroke();
        if (guide.path.some(valid)) count(series, 'paths');
        if (guide.point && valid(guide.point)) {
          count(series, 'points');
          const [x, y] = pixel(u, guide.point);
          ctx.beginPath();
          ctx.arc(x, y, 2 * dpr, 0, 2 * Math.PI);
          ctx.fillStyle = axis;
          ctx.fill();
          ctx.font = `${10 * dpr}px system-ui`;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'alphabetic';
          const label = guide.label ?? '';
          const labelX = Math.max(u.bbox.left + 2 * dpr, Math.min(x + 4 * dpr, u.bbox.left + u.bbox.width - ctx.measureText(label).width - 2 * dpr));
          const labelY = Math.max(u.bbox.top + 10 * dpr, y - 4 * dpr);
          if (x >= u.bbox.left && x < u.bbox.left + u.bbox.width && y >= u.bbox.top && y < u.bbox.top + u.bbox.height &&
              labels.every(([px, py]) => Math.abs(labelX - px) > 58 * dpr || Math.abs(labelY - py) > 14 * dpr)) {
            ctx.fillText(label, labelX, labelY);
            if (label) count(series, 'labels');
            labels.push([labelX, labelY]);
          }
        }
      }
      const hoverKey = sharedHover ? untrack(() => review.hoveredKey) : null;
      const priority = (m: Mark) => m.spot.key === hoverKey ? 2 : m.spot.key === selected || m.boxed ? 1 : 0;
      const emphasis = data.marks.some(m => m.spot.key === selected || m.boxed);
      for (const mark of [...data.marks].sort((a,b)=>priority(a)-priority(b))) {
        const active = mark.spot.key === selected || mark.boxed;
        const highlighted = mark.spot.key === hoverKey;
        ctx.globalAlpha = emphasis && !active && !highlighted ? 0.45 : 1;
        ctx.strokeStyle = color(mark.spot.sampleName);
        ctx.fillStyle = ctx.strokeStyle;
        ctx.lineWidth = (active || highlighted ? 2.5 : 1.2) * dpr;
        const series = mark.seriesKey ?? mark.spot.sampleName;
        if (mark.path) {
          if (mark.path.some(valid)) count(series, 'paths');
          path(u, mark.path);
          ctx.stroke();
          if (active || highlighted) {
            for (const p of mark.path.filter(valid)) {
              const [x, y] = pixel(u, p);
              ctx.beginPath(); ctx.arc(x, y, 4 * dpr, 0, 2 * Math.PI); ctx.stroke();
              count(series, 'rings');
            }
          }
        }
        if (mark.polygon) {
          if (mark.polygon.some(valid)) count(series, 'ellipses');
          path(u, mark.polygon, true);
          ctx.stroke();
        }
        if (valid(mark.point)) {
          count(series, 'points');
          const [x, y] = pixel(u, mark.point);
          ctx.beginPath();
          ctx.arc(x, y, 3 * dpr, 0, 2 * Math.PI);
          ctx.fill();
          if (active || highlighted) {
            count(series, 'rings', 2);
            ctx.beginPath();
            ctx.arc(x, y, 7 * dpr, 0, 2 * Math.PI);
            ctx.stroke();
            // A dark outer ring keeps the selection visible inside a dense cluster.
            ctx.beginPath();
            ctx.arc(x, y, 10 * dpr, 0, 2 * Math.PI);
            ctx.strokeStyle = axis;
            ctx.lineWidth = 2 * dpr;
            ctx.stroke();
          }
        }
      }
      ctx.restore();
      // Serialize once per draw, with one record per series (never per spot).
      if (chart) chart.dataset.drawn = JSON.stringify(drawn);
    };
    // Keyboard and pointer targets over each point, placed after uPlot has laid
    // out (its first layout runs in a microtask), relative to the chart box.
    let targetFrame = 0;
    const placeTargets = (u: uPlot) => {
      cancelAnimationFrame(targetFrame);
      targetFrame = requestAnimationFrame(() => updateTargets(u));
    };
    const updateTargets = (u: uPlot) => {
      if (!chart) return;
      const o = u.over.getBoundingClientRect(), c = chart.getBoundingClientRect();
      const next = (sharedHover ? data.marks : []).flatMap(m => {
        const p = m.point ?? m.path?.find(valid);
        if (!valid(p)) return [];
        const x = o.left - c.left + u.valToPos(p[0], 'x'), y = o.top - c.top + u.valToPos(p[1], 'y');
        return x >= o.left - c.left && x <= o.right - c.left && y >= o.top - c.top && y <= o.bottom - c.top
          ? [{ spot: m.spot, x, y }] : [];
      });
      untrack(() => { targets = next; });
    };
    // Log axes: label and grid only whole decades (uPlot's default draws every minor line).
    const decades = (_u: uPlot, splits: number[]) => splits.map(v => v != null && v > 0 && Math.abs(Math.log10(v) - Math.round(Math.log10(v))) < 1e-9 ? v : null);
    const plotHost = host;
    const opts: uPlot.Options = { width: untrack(() => width), height: untrack(() => height), series: [{}, { show: false }], scales: { x: { time: false, distr: logX ? 3 : 1, range: () => bounds.x }, y: { distr: logY ? 3 : 1, range: () => bounds.y } },
      axes: [{ label: isotopeLabel(xLabel), labelSize: 20, size: 42, stroke: axis, grid: { stroke: grid }, ticks: { stroke: grid }, font: '11px system-ui', ...(logX && !xTicks.length ? { filter: decades, grid: { stroke: grid, filter: decades }, ticks: { stroke: grid, filter: decades } } : {}), ...(xTicks.length ? { splits: () => xTicks.map((_, i) => i), values: (_u: uPlot, vals: number[]) => vals.map(v => xTicks[v] ?? '') } : {}) },
        { label: isotopeLabel(yLabel), labelSize: 18, size: 64, stroke: axis, grid: { stroke: grid }, ticks: { stroke: grid }, font: '11px system-ui', ...(logY ? { filter: decades, grid: { stroke: grid, filter: decades }, ticks: { stroke: grid, filter: decades } } : {}), values: (_u, vals) => vals.map(v => v == null || !Number.isFinite(v) ? '' : Math.abs(v) >= 1e4 || (v !== 0 && Math.abs(v) < 0.001) ? v.toExponential(1) : Number(v.toPrecision(4)).toString()) }],
      legend: { show: false }, cursor: { show: false }, select: { show: false, left: 0, top: 0, width: 0, height: 0 }, hooks: { draw: [u => untrack(() => draw(u))], ready: [placeTargets] },
    };
    const plot = untrack(() => new uPlot(opts, [[], []], plotHost));
    instance = plot;
    const surface = onbox ? chart! : plot.over;
    function hit(event: MouseEvent, includeEllipses = true): ReviewSpot | null {
      const rect = plot.over.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
      if (x < 0 || y < 0 || x > rect.width || y > rect.height) return null;
      let closest: ReviewSpot | null = null, distance = Infinity;
      const position = (p: Point): Point => [plot.valToPos(p[0], 'x'), plot.valToPos(p[1], 'y')];
      for (const m of data.marks) {
        const pts = (m.point ? [m.point] : m.path ?? []).filter(valid);
        for (const p of pts) {
          const [px, py] = position(p), d = Math.hypot(x - px, y - py);
          if (d > distance) continue;
          let inside = false;
          if (includeEllipses && d > 12 && m.polygon) {
            const polygon = m.polygon.filter(valid).map(position);
            for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
              const a = polygon[i], b = polygon[j];
              if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0])
                inside = !inside;
            }
          }
          if ((d <= 12 || inside) && d <= distance) {
            distance = d;
            closest = m.spot;
          }
        }
      }
      return closest;
    }
    let drag: { id: number; start: Point; bounds: Bounds; tool: DragTool; moved: boolean } | null = null;
    function position(e: PointerEvent): Point {
      const r = plot.over.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    }
    function clip([x, y]: Point): Point {
      return [Math.max(0, Math.min(plot.over.clientWidth, x)), Math.max(0, Math.min(plot.over.clientHeight, y))];
    }
    const down = (e: PointerEvent) => {
      if (!onbox || e.button !== 0 || drag) return;
      if (e.target !== plot.over && !(e.target instanceof HTMLElement && e.target.classList.contains('point-target'))) return;
      drag = { id: e.pointerId, start: clip(position(e)), bounds, tool: tool === 'pan' && e.shiftKey ? 'zoom' : tool, moved: false };
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
      const spot = data.marks.find(m => m.spot.key === key)?.spot ?? hit(e, false);
      if (!spot) return;
      const anchor = [...(chart?.querySelectorAll<HTMLElement>('.point-target') ?? [])].find(n => n.dataset.pointKey === spot.key);
      if (!anchor) return;
      e.preventDefault();
      openMenu(spot, anchor);
    };
    const move = (e: PointerEvent) => {
      if (drag?.id === e.pointerId) {
        const [x, y] = position(e);
        const dx = x - drag.start[0], dy = y - drag.start[1];
        if (!drag.moved && Math.hypot(dx, dy) < 4) return;
        drag.moved = true;
        if (drag.tool === 'pan') {
          viewport = panBounds(drag.bounds, dx / plot.over.clientWidth, dy / plot.over.clientHeight);
        } else {
          const offset: Point = [plot.over.offsetLeft, plot.over.offsetTop];
          const end = clip([x, y]);
          box = { start: [drag.start[0] + offset[0], drag.start[1] + offset[1]], end: [end[0] + offset[0], end[1] + offset[1]] };
        }
        return;
      }
      if (onbox && e.target instanceof HTMLElement && e.target.classList.contains('point-target')) return;
      hovered = hit(e);
      if (sharedHover) review.hoveredKey = hovered?.key ?? null;
      const r = plotHost.getBoundingClientRect();
      tooltip = { x: Math.max(0, Math.min(width - 190, e.clientX - r.left + 8)), y: Math.max(0, e.clientY - r.top - 45) };
    };
    const up = (e: PointerEvent) => {
      if (drag?.id !== e.pointerId) return;
      const { start, moved, tool: action } = drag;
      drag = null;
      box = null;
      if (!moved) {
        const spot = hit(e);
        if (spot) onselect(spot);
      } else if (action !== 'pan') {
        const end = clip(position(e));
        if (Math.abs(end[0] - start[0]) < 4 || Math.abs(end[1] - start[1]) < 4) return;
        const area: Bounds = {
          x: [plot.posToVal(Math.min(start[0], end[0]), 'x'), plot.posToVal(Math.max(start[0], end[0]), 'x')],
          y: [plot.posToVal(Math.max(start[1], end[1]), 'y'), plot.posToVal(Math.min(start[1], end[1]), 'y')],
        };
        if (action === 'zoom') viewport = area;
        else onbox?.(area);
      }
    };
    const cancel = () => { drag = null; box = null; clearPointHover(); };
    const wheel = (e: WheelEvent) => {
      if (!onbox || !e.deltaY) return;
      const r = plot.over.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
      e.preventDefault();
      const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? r.height : 1);
      clearPointHover();
      zoom(2 ** Math.max(-1, Math.min(1, delta / 280)), [(e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height]);
    };
    window.addEventListener('blur', cancel);
    document.addEventListener('mouseleave', clearPointHover);
    plot.over.addEventListener('click', click);
    surface.addEventListener('contextmenu', contextmenu);
    surface.addEventListener('pointerdown', down);
    surface.addEventListener('pointermove', move);
    surface.addEventListener('pointerup', up);
    surface.addEventListener('lostpointercapture', cancel);
    surface.addEventListener('pointerleave', clearPointHover);
    surface.addEventListener('wheel', wheel, { passive: false });
    refreshTargets = () => placeTargets(plot);
    return () => {
      window.removeEventListener('blur', cancel);
      document.removeEventListener('mouseleave', clearPointHover);
      surface.removeEventListener('pointerdown', down);
      surface.removeEventListener('contextmenu', contextmenu);
      surface.removeEventListener('pointermove', move);
      surface.removeEventListener('pointerup', up);
      surface.removeEventListener('lostpointercapture', cancel);
      surface.removeEventListener('pointerleave', clearPointHover);
      surface.removeEventListener('wheel', wheel);
      cancelAnimationFrame(targetFrame);
      instance = undefined;
      targets = [];
      hovered = null;
      plot.destroy();
    };
  });

  // Data, selection, and viewport edits update the existing canvas.
  let refreshTargets = () => {};
  $effect(() => {
    const plot = instance, { x, y } = bounds, w = width, h = height;
    void data;
    void guides;
    if (!plot) return;
    untrack(() => {
      plot.batch(() => {
        if (plot.width !== w || plot.height !== h) plot.setSize({ width: w, height: h });
        if (plot.scales.x.min !== x[0] || plot.scales.x.max !== x[1]) plot.setScale('x', { min: x[0], max: x[1] });
        if (plot.scales.y.min !== y[0] || plot.scales.y.max !== y[1]) plot.setScale('y', { min: y[0], max: y[1] });
      });
      plot.redraw(false);
      refreshTargets();
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
  {#each pointTargets as t (t.spot.key)}
    <button class="point-target" aria-haspopup="menu" aria-label={`Select ${t.spot.label}`} tabindex={keyboardKey === t.spot.key ? 0 : -1} data-point-key={t.spot.key} data-sample={t.spot.sampleName} data-selected={selected===t.spot.key} data-hovered={sharedHover && review.hoveredKey === t.spot.key} style:left="{t.x}px" style:top="{t.y}px" oncontextmenu={e => { e.preventDefault(); e.stopPropagation(); openMenu(t.spot, e.currentTarget); }} onkeydown={e => { if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); e.stopPropagation(); openMenu(t.spot, e.currentTarget); } }} onclick={()=>onselect(t.spot)} onmouseenter={()=>pointHover(t)} onmouseleave={clearPointHover} onfocus={()=>pointHover(t)} onblur={clearPointHover}></button>
  {/each}
  <div class="canvas" bind:this={host}></div>
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
  .point-target {position:absolute;z-index:1;width:12px;height:12px;transform:translate(-50%,-50%);padding:0;border:0;background:transparent;border-radius:50%;cursor:pointer;}
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
