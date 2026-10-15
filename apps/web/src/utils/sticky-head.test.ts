import { describe, expect, it } from 'vitest';

import {
  STICKY_HEAD_HEIGHT_VAR,
  STICKY_SUMMARY_PX,
  filtersCoveredBy,
  stickyHeadHeightOf,
} from '@/utils/sticky-head';

describe('stickyHeadHeightOf', () => {
  it('rounds a measured height up to whole pixels, so the head is never under-cleared', () => {
    expect(stickyHeadHeightOf(120)).toBe('120px');
    expect(stickyHeadHeightOf(119.2)).toBe('120px');
  });

  it("adds the summary line's room where the head has a summary, shown or not", () => {
    expect(stickyHeadHeightOf(120, true)).toBe(`${String(120 + STICKY_SUMMARY_PX)}px`);
    expect(stickyHeadHeightOf(120, false)).toBe('120px');
  });

  it('is 0px for a head that is not drawn, or a height that is no number', () => {
    for (const height of [0, -4, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(stickyHeadHeightOf(height, true), String(height)).toBe('0px');
    }
  });

  it('names a custom property', () => {
    expect(STICKY_HEAD_HEIGHT_VAR).toMatch(/^--[a-z-]+$/);
  });
});

describe('filtersCoveredBy', () => {
  it('is true once the filter bar has scrolled up under the head, and not before', () => {
    expect(filtersCoveredBy(120, 300)).toBe(false);
    expect(filtersCoveredBy(120, 121)).toBe(false);
    expect(filtersCoveredBy(120, 120)).toBe(true);
    expect(filtersCoveredBy(120, -40)).toBe(true);
  });
});
