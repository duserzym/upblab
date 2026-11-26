import type { BatchOut, ListPage } from './tims-api';
export interface BatchSnapshot { rows: BatchOut[]; page: ListPage<BatchOut>; truncated: boolean; legacy: boolean }
// Session-only, cleared by the route on account/server/oversight changes and saves.
export const batchMonths = new Map<string, BatchSnapshot>();
/** Publish every page. Stop on navigation and bound automatic traversals to ten pages. */
export async function collectBatchPages(first: ListPage<BatchOut>, current: () => boolean, publish: (snapshot: BatchSnapshot) => void, legacy = false) {
  let page = first;
  const rows = new Map<string, BatchOut>(), cursors = new Set<string>();
  for (let n = 1; current(); n++) {
    for (const row of page.items) rows.set(row.id, row);
    const result = { rows: [...rows.values()], page, truncated: !!page.nextCursor && n >= 10, legacy };
    publish(result);
    if (!current() || !page.nextCursor || result.truncated) return result;
    if (cursors.has(page.nextCursor)) throw new Error('The server repeated a list cursor.');
    cursors.add(page.nextCursor);
    const next = await page.more();
    if (!next) return result;
    page = next;
  }
}
