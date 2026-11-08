import { sampleSelection } from './geochem-board';
import type { ReviewSpot } from './review-data';

export function rangeSelection(current: string[] | null, ordered: string[], clicked: string,
  anchor: string | null, { shiftKey, metaKey, ctrlKey }: Pick<MouseEvent, 'shiftKey' | 'metaKey' | 'ctrlKey'>): string[] | null {
  const from = anchor === null ? -1 : ordered.indexOf(anchor), to = ordered.indexOf(clicked);
  const additive = metaKey || ctrlKey;
  if (!shiftKey || from < 0 || to < 0) return sampleSelection(current, ordered, 'click', clicked, additive);
  const range = ordered.slice(Math.min(from, to), Math.max(from, to) + 1);
  return additive ? [...new Set([...(current ?? ordered), ...range])] : range;
}

/** Use a registered spelling where available, keeping the raw spot label intact. */
export function groupUnregistered(rows: ReviewSpot[]): ReviewSpot[] {
  const names = new Map(rows.filter(row => row.sampleName !== 'No sample').map(row => [row.sampleName.toLowerCase(), row.sampleName]));
  return rows.map(row => {
    if (row.sampleName !== 'No sample') return row;
    const parsed = typeof row.values.sample_label === 'string' ? row.values.sample_label : '';
    const inferred = parsed || row.label.match(/^(.+)_\d+$/)?.[1];
    if (!inferred) return row;
    const key = inferred.toLowerCase();
    const name = names.get(key) ?? inferred;
    names.set(key, name);
    return { ...row, sampleName: name };
  });
}
