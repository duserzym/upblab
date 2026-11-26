export interface SegmentedOption { value: string; label: string; title?: string; ariaLabel?: string }
export interface WorkflowStep {
  label: string; fullName: string; detail: string;
  state: 'done' | 'current' | 'pending'; hint?: string;
}

/** Unhandled keys leave native button behaviour alone; arrows wrap. */
export function segmentedIndex(key: string, current: number, length: number): number | null {
  if (length < 1) return null;
  const index = Math.max(0, Math.min(current, length - 1));
  switch (key) {
    case 'ArrowLeft': return (index + length - 1) % length;
    case 'ArrowRight': return (index + 1) % length;
    case 'Home': return 0;
    case 'End': return length - 1;
    default: return null;
  }
}

export function progressState(value: number | null | undefined, total: number, noun: string) {
  const max = Number.isFinite(total) ? Math.max(0, total) : 0;
  const now = value == null || !Number.isFinite(value) ? undefined : Math.max(0, Math.min(value, max));
  return { max, now, percent: now === undefined || max === 0 ? 0 : now / max * 100,
    caption: `${now ?? '—'} of ${max} ${noun}` };
}
