import { spotGroupKey } from '../../lib/review-data';
import type { Band, Guide, Mark } from './plot-data';

export const PLOT_VISIBILITY = 'upbstudio.plot-visibility';
export interface SampleSeries { key: string; name: string }
export interface PlotVisibility {
  hidden: () => ReadonlySet<string>;
  samples: () => SampleSeries[];
  toggle: (key: string, event: MouseEvent) => void;
  keydown: (key: string, event: KeyboardEvent) => void;
}

/** One gate for canvas primitives, hit testing, focus targets and legend state.
 * Unowned reference guides remain visible; series guides/labels hide together.
 */
export function plotVisibility({ marks, bands = [], guides = [], samples, hidden }: {
  marks: Mark[]; bands?: Band[]; guides?: Guide[]; samples?: SampleSeries[]; hidden: ReadonlySet<string>;
}) {
  const ownedVisible = (item: { seriesKey?: string; spotKey?: string }) =>
    !(item.seriesKey !== undefined && hidden.has(item.seriesKey)) &&
    !(item.spotKey !== undefined && hidden.has(item.spotKey));
  const entries = samples ?? [...new Map(marks.map(m => [spotGroupKey(m.spot), {
    key: spotGroupKey(m.spot), name: m.spot.sampleName,
  }])).values()];
  return {
    marks: marks.filter(m => ownedVisible(m) && !hidden.has(m.spot.key) &&
      !hidden.has(m.spot.sampleName) && !hidden.has(spotGroupKey(m.spot))),
    bands: bands.filter(ownedVisible),
    guides: guides.filter(ownedVisible),
    // Keep hidden samples available as toggles, even when every spot is hidden.
    legend: entries.map(s => ({ ...s, shown: !hidden.has(s.key) && !hidden.has(s.name) })),
  };
}

export interface DrawnCounts {
  points: number; ellipses: number; paths: number; bands: number; rings: number; labels: number;
}
export type DrawnSummary = Record<string, DrawnCounts>;
