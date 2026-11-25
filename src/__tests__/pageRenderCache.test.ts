import { describe, expect, it } from 'vitest';
import { PageRenderCache } from '../lib/pageRenderCache';
import { getPaginatedPrefetchPages } from '../lib/virtualization';

describe('paginated prefetch window and PageRenderCache', () => {
  it('computes ±1 adjacent spread prefetch pages cleanly for single, two-page, and continuous modes', () => {
    expect(getPaginatedPrefetchPages(20, 'continuous', true, 5, 1)).toEqual([]);

    expect(getPaginatedPrefetchPages(20, 'single', true, 1, 1)).toEqual([1, 2]);
    expect(getPaginatedPrefetchPages(20, 'single', true, 5, 1)).toEqual([5, 6, 4]);
    expect(getPaginatedPrefetchPages(20, 'single', true, 20, 1)).toEqual([20, 19]);

    // Two-page with cover offset: [1], [2,3], [4,5], [6,7]
    expect(getPaginatedPrefetchPages(7, 'two-page', true, 1, 1)).toEqual([1, 2, 3]);
    expect(getPaginatedPrefetchPages(7, 'two-page', true, 4, 1)).toEqual([4, 5, 6, 7, 2, 3]);
    expect(getPaginatedPrefetchPages(7, 'two-page', true, 7, 1)).toEqual([6, 7, 4, 5]);

    // Two-page without cover offset: [1,2], [3,4], [5,6], [7]
    expect(getPaginatedPrefetchPages(7, 'two-page', false, 1, 1)).toEqual([1, 2, 3, 4]);
    expect(getPaginatedPrefetchPages(7, 'two-page', false, 3, 1)).toEqual([3, 4, 5, 6, 1, 2]);
  });

  it('evicts LRU entries beyond capacity and zeroes GPU canvas dimensions on eviction and prune', () => {
    const cache = new PageRenderCache(3);

    const makeCanvas = (w = 400, h = 600) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      return c;
    };

    const c1 = makeCanvas();
    const c2 = makeCanvas();
    const c3 = makeCanvas();
    const c4 = makeCanvas();

    cache.set(1, 1.0, 1, c1);
    cache.set(2, 1.0, 1, c2);
    cache.set(3, 1.0, 1, c3);
    expect(cache.size).toBe(3);

    // Touch page 1 so page 2 becomes LRU
    expect(cache.get(1, 1.0, 1)).toBe(c1);

    // Inserting page 4 must evict page 2 and zero its dimensions
    cache.set(4, 1.0, 1, c4);
    expect(cache.size).toBe(3);
    expect(cache.get(2, 1.0, 1)).toBeNull();
    expect(c2.width).toBe(0);
    expect(c2.height).toBe(0);

    // Prune to {3, 4} at scale 1.0 -> evicts page 1
    cache.prune(new Set([3, 4]), 1.0, 1);
    expect(cache.size).toBe(2);
    expect(cache.get(1, 1.0, 1)).toBeNull();
    expect(c1.width).toBe(0);

    // Prune at a different zoom scale -> evicts everything at old scale
    cache.prune(new Set([3, 4]), 1.25, 1);
    expect(cache.size).toBe(0);
    expect(c3.width).toBe(0);
    expect(c4.width).toBe(0);

    cache.clear();
  });
});
