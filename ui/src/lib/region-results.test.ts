import { describe, expect, it, vi } from 'vitest';
import { RegionResults } from './region-results';
import { mountResults } from '../../tests/fixtures/review';

describe('mount results cache', () => {
  it('revalidates on reopening, coalesces in-flight reads and clears account data', async () => {
    const cache = new RegionResults(), get = vi.fn(async () => ({ status: 200, body: mountResults }));
    await Promise.all([cache.load('a', 'm', get), cache.load('a', 'm', get)]);
    expect(get).toHaveBeenCalledTimes(1);
    expect(cache.peek('a', 'm').length).toBeGreaterThan(0);
    expect(cache.peek('b', 'm')).toEqual([]);
    await cache.load('a', 'm', get);
    expect(get).toHaveBeenCalledTimes(2);
    cache.clear(); expect(cache.peek('a', 'm')).toEqual([]);
  });
  it('reports the status and response excerpt on failures', async () => {
    await expect(new RegionResults().load('a', 'm', async () => ({ status: 503, body: { detail: 'Invented failure' } }) as never)).rejects.toThrow(/503.*Invented failure/);
  });
});

