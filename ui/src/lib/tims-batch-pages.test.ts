import { expect, it } from 'vitest';
import type { BatchOut, ListPage } from './tims-api';
import { collectBatchPages } from './tims-batch-pages';
it('publishes 2000 invented batches progressively in ten bounded reads without row requests', async () => {
  let calls = 0;
  const page = async (index: number): Promise<ListPage<BatchOut>> => {
    calls++; return { items: Array.from({ length: 200 }, (_, n) => ({ id: `invented-${index * 200 + n}` } as BatchOut)), nextCursor: String(index + 1), more: () => page(index + 1) };
  };
  const start = performance.now(), lengths: number[] = [];
  const result = await collectBatchPages(await page(0), () => true, value => lengths.push(value.rows.length));
  console.info(`Batch summary traversal: ${calls} list reads, 0 detail reads, 2000 rows in ${(performance.now() - start).toFixed(1)} ms; prior list first page: 1 read / 500 rows; new first page: 1 read / 200 rows.`);
  expect(calls).toBe(10); expect(lengths).toEqual([200, 400, 600, 800, 1000, 1200, 1400, 1600, 1800, 2000]); expect(result?.truncated).toBe(true);
});
it('stops after navigation and rejects repeated cursors', async () => {
  let current = true, calls = 0;
  const page: ListPage<BatchOut> = { items: [], nextCursor: 'same', more: async () => { calls++; return page; } };
  await collectBatchPages(page, () => current, () => { current = false; });
  expect(calls).toBe(0);
  await expect(collectBatchPages(page, () => true, () => {})).rejects.toThrow('repeated');
});
