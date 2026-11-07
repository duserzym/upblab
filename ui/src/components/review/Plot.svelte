<script lang="ts">
  import uPlot from 'uplot';
  import { untrack, getContext } from 'svelte';
  import { review } from '../../lib/review.svelte';
  import 'uplot/dist/uPlot.min.css';
  import { settings } from '../../lib/settings.svelte';
  import { dateLabel, type ReviewSpot } from '../../lib/review-data';
  import type { Point } from '../../lib/concordia';
  import { color, type Mark, type Guide, type Band } from './plot-data';
  let { marks, guides = [], bands = [], selected, onselect, xLabel, yLabel, logX = false, logY = false, xTicks = [], legend = true, sharedHover = true }: {
    marks: Mark[];
    guides?: Guide[];
    bands?: Band[];
    selected: string | null;
    onselect: (spot: ReviewSpot) => void;
    xLabel: string;
    yLabel: string;
    logX?: boolean;
    logY?: boolean;
    xTicks?: string[];
    legend?: boolean;
    sharedHover?: boolean;
  } = $props();
  const visible = getContext<() => boolean>('upbstudio.review-visible') ?? (() => true);
  let host = $state<HTMLDivElement>();
  let width = $state(400), height = $state(300);
  let instance: uPlot | undefined;
  let targets = $state<{ spot: ReviewSpot; x: number; y: number }[]>([]);
  let chart = $state<HTMLDivElement>();
  $effect(() => { void review.hoveredKey; instance?.redraw(false); });
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
  const samples = $derived([...new Set(marks.filter(m => m.point || m.polygon?.length || m.path?.some(Boolean)).map(m => m.spot.sampleName))]);
  $effect(() => {
    if (!visible() || !host)
      return;
    const ro = new ResizeObserver(([e]) => { width = Math.max(1, Math.floor(e.contentRect.width)); height = Math.max(1, Math.floor(e.contentRect.height)); });
    ro.observe(host);
    return () => ro.disconnect();
  });
  $effect(() => {
    if (!visible() || !host)
      return;
    void settings.effectiveTheme;
    const css = getComputedStyle(document.documentElement);
    const axis = css.getPropertyValue('--plot-axis').trim(), grid = css.getPropertyValue('--plot-grid').trim();
    const valid = (p: Point | null | undefined): p is Point => !!p && p.every(Number.isFinite) && (!logX || p[0] > 0) && (!logY || p[1] > 0);
    // Axes follow the data: points and paths first. An ellipse widens them only
    // when it is no larger than the spread of the points (a badly measured spot
    // must not squash the others), and reference lines (the Concordia curve)
    // only when there is no data at all; they are clipped to the plot.
    const core = [...marks.flatMap(m => [...(m.point ? [m.point] : []), ...(m.path ?? [])]), ...bands.flatMap(b => [...b.upper, ...b.lower])].filter(valid);
    const span = (pts: Point[], d: number) => pts.length ? Math.max(...pts.map(p => p[d])) - Math.min(...pts.map(p => p[d])) : 0;
    const sx = span(core, 0), sy = span(core, 1);
    const ellipses = marks.flatMap(m => {
      const poly = (m.polygon ?? []).filter(valid);
      if (!poly.length) return [];
      if (core.length > 1 && (span(poly, 0) > Math.max(sx, 1e-12) || span(poly, 1) > Math.max(sy, 1e-12))) return [];
      return poly;
    });
    const points = core.length ? [...core, ...ellipses] : guides.flatMap(g => [...g.path, ...(g.point ? [g.point] : [])]).filter(valid);
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
    const xr = extent(0, logX), yr = extent(1, logY);
    const ordered = [...marks].sort((a, b) => Number(a.spot.key === selected) - Number(b.spot.key === selected));
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
      const ctx = u.ctx, dpr = u.ctx.canvas.width / width;
      ctx.save();
      ctx.beginPath();
      ctx.rect(u.bbox.left, u.bbox.top, u.bbox.width, u.bbox.height);
      ctx.clip();
      for (const b of bands) {
        // Keep null gaps: never bridge a missing stored sweep value.
        let upper: Point[] = [], lower: Point[] = [];
        const flush = () => { if (upper.length) {
          path(u, [...upper, ...lower.reverse()], true);
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
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = axis;
      ctx.lineWidth = dpr;
      for (const guide of guides) {
        path(u, guide.path);
        ctx.stroke();
        if (guide.point && valid(guide.point)) {
          const [x, y] = pixel(u, guide.point);
          ctx.beginPath();
          ctx.arc(x, y, 2 * dpr, 0, 2 * Math.PI);
          ctx.fillStyle = axis;
          ctx.fill();
          ctx.font = `${10 * dpr}px system-ui`;
          ctx.fillText(guide.label ?? '', x + 4 * dpr, y - 4 * dpr);
        }
      }
      const hoverKey = sharedHover ? untrack(() => review.hoveredKey) : null;
      const priority = (m: Mark) => m.spot.key === hoverKey ? 2 : m.spot.key === selected ? 1 : 0;
      for (const mark of [...ordered].sort((a,b)=>priority(a)-priority(b))) {
        const active = mark.spot.key === selected;
        const highlighted = mark.spot.key === hoverKey;
        ctx.globalAlpha = selected && !active && !highlighted ? 0.45 : 1;
        ctx.strokeStyle = color(mark.spot.sampleName);
        ctx.fillStyle = ctx.strokeStyle;
        ctx.lineWidth = (active || highlighted ? 2.5 : 1.2) * dpr;
        if (mark.path) {
          path(u, mark.path);
          ctx.stroke();
          if (active || highlighted) {
            for (const p of mark.path.filter(valid)) {
              const [x, y] = pixel(u, p);
              ctx.beginPath(); ctx.arc(x, y, 4 * dpr, 0, 2 * Math.PI); ctx.stroke();
            }
          }
        }
        if (mark.polygon) {
          path(u, mark.polygon, true);
          ctx.stroke();
        }
        if (valid(mark.point)) {
          const [x, y] = pixel(u, mark.point);
          ctx.beginPath();
          ctx.arc(x, y, 3 * dpr, 0, 2 * Math.PI);
          ctx.fill();
          if (active || highlighted) {
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
    };
    // Keyboard and pointer targets over each point, placed after uPlot has laid
    // out (its first layout runs in a microtask), relative to the chart box.
    const placeTargets = (u: uPlot) => {
      if (!chart) return;
      const o = u.over.getBoundingClientRect(), c = chart.getBoundingClientRect();
      const next = (sharedHover ? marks : []).flatMap(m => {
        const p = m.point ?? m.path?.find(valid);
        if (!valid(p)) return [];
        const x = o.left - c.left + u.valToPos(p[0], 'x'), y = o.top - c.top + u.valToPos(p[1], 'y');
        return Number.isFinite(x) && Number.isFinite(y) ? [{ spot: m.spot, x, y }] : [];
      });
      untrack(() => { targets = next; });
    };
    // Log axes: label and grid only whole decades (uPlot's default draws every minor line).
    const decades = (_u: uPlot, splits: number[]) => splits.map(v => v != null && v > 0 && Math.abs(Math.log10(v) - Math.round(Math.log10(v))) < 1e-9 ? v : null);
    const plot = new uPlot({ width, height, series: [{}, { show: false }], scales: { x: { time: false, distr: logX ? 3 : 1, range: () => xr }, y: { distr: logY ? 3 : 1, range: () => yr } },
      axes: [{ label: xLabel, labelSize: 20, size: 42, stroke: axis, grid: { stroke: grid }, ticks: { stroke: grid }, font: '11px system-ui', ...(logX && !xTicks.length ? { filter: decades, grid: { stroke: grid, filter: decades }, ticks: { stroke: grid, filter: decades } } : {}), ...(xTicks.length ? { splits: () => xTicks.map((_, i) => i), values: (_u: uPlot, vals: number[]) => vals.map(v => xTicks[v] ?? '') } : {}) },
        { label: yLabel, labelSize: 18, size: 64, stroke: axis, grid: { stroke: grid }, ticks: { stroke: grid }, font: '11px system-ui', ...(logY ? { filter: decades, grid: { stroke: grid, filter: decades }, ticks: { stroke: grid, filter: decades } } : {}), values: (_u, vals) => vals.map(v => v == null || !Number.isFinite(v) ? '' : Math.abs(v) >= 1e4 || (v !== 0 && Math.abs(v) < 0.001) ? v.toExponential(1) : Number(v.toPrecision(4)).toString()) }],
      legend: { show: false }, cursor: { show: false }, select: { show: false, left: 0, top: 0, width: 0, height: 0 }, hooks: { draw: [draw], ready: [placeTargets] },
    }, [[xr[0], xr[1]], [yr[0], yr[1]]], host);
    instance = plot;
    function hit(event: MouseEvent): ReviewSpot | null {
      const rect = plot.over.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
      let closest: ReviewSpot | null = null, distance = Infinity;
      const position = (p: Point): Point => [plot.valToPos(p[0], 'x'), plot.valToPos(p[1], 'y')];
      for (const m of ordered) {
        const pts = (m.point ? [m.point] : m.path ?? []).filter(valid);
        for (const p of pts) {
          const [px, py] = position(p), d = Math.hypot(x - px, y - py);
          let inside = false;
          if (m.polygon) {
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
    const click = (e: MouseEvent) => { const spot = hit(e); if (spot)
      onselect(spot); };
    const move = (e: MouseEvent) => { hovered = hit(e); if (sharedHover) review.hoveredKey = hovered?.key ?? null; const r = host!.getBoundingClientRect(); tooltip = { x: Math.max(0, Math.min(width - 190, e.clientX - r.left + 8)), y: Math.max(0, e.clientY - r.top - 45) }; };
    const leave = () => { hovered = null; if (sharedHover) review.hoveredKey = null; };
    window.addEventListener('blur', leave);
    document.addEventListener('mouseleave', leave);
    plot.over.addEventListener('click', click);
    plot.over.addEventListener('mousemove', move);
    plot.over.addEventListener('mouseleave', leave);
    return () => { window.removeEventListener('blur', leave); document.removeEventListener('mouseleave', leave); if (instance === plot) instance = undefined; targets = []; hovered = null; plot.destroy(); };
  });
</script>
<div class="chart" bind:this={chart} data-testid="review-plot" data-point-count={targets.length} data-hovered-key={sharedHover ? review.hoveredKey ?? '' : ''}>
  {#each targets as t (t.spot.key)}
    <button class="point-target" aria-label={`Select ${t.spot.label}`} tabindex={selected===t.spot.key?0:-1} data-point-key={t.spot.key} data-sample={t.spot.sampleName} data-selected={selected===t.spot.key} data-hovered={sharedHover && review.hoveredKey === t.spot.key} style:left="{t.x}px" style:top="{t.y}px" onclick={()=>onselect(t.spot)} onmouseenter={()=>pointHover(t)} onmouseleave={clearPointHover} onfocus={()=>pointHover(t)} onblur={clearPointHover}></button>
  {/each}
  <div class="canvas" bind:this={host}></div>
  {#if hovered}<div class="tooltip small" style:left="{tooltip.x}px" style:top="{tooltip.y}px">{hovered.label}<br />{dateLabel(hovered)} Ma</div>{/if}
</div>
{#if legend}<div class="legend small" aria-label="Sample legend">{#each samples as sample}<span><i style:background={color(sample)}></i>{sample}</span>{/each}</div>{/if}
{#if marks.length === 0}<p class="muted small">No stored values for these axes.</p>{/if}
<style>
  .chart { position:relative; flex:1; min-height:150px;min-width:0;border-radius:var(--radius-sm); background:var(--plot-bg); overflow:hidden; }
  .point-target {position:absolute;z-index:1;width:12px;height:12px;transform:translate(-50%,-50%);padding:0;border:0;background:transparent;border-radius:50%;cursor:pointer;}
  .canvas { position:absolute; inset:0; }
  .legend { display:flex; flex-wrap:wrap; gap:4px 12px; padding:4px; overflow-wrap:anywhere; }
  .legend span { display:inline-flex; gap:5px; align-items:center; }
  i { width:10px;height:10px;flex:none;border-radius:50%; }
  .tooltip { position:absolute;pointer-events:none;background:var(--plot-bg);border:1px solid var(--hairline);padding:5px;max-width:190px;overflow-wrap:anywhere; }
</style>
