import { describe, expect, it } from 'vitest';

import { STICKY_HEAD_HEIGHT_VAR, stickyHeadHeightOf } from '@/utils/sticky-head';

describe('stickyHeadHeightOf', () => {
  it('rounds a measured height up to whole pixels, so the head is never under-cleared', () => {
    expect(stickyHeadHeightOf(150)).toBe('150px');
    expect(stickyHeadHeightOf(149.2)).toBe('150px');
  });

  it('is 0px for a head that is not drawn, or a height that is no number', () => {
    for (const height of [0, -4, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(stickyHeadHeightOf(height), String(height)).toBe('0px');
    }
  });

  it('names a custom property', () => {
    expect(STICKY_HEAD_HEIGHT_VAR).toMatch(/^--[a-z-]+$/);
  });
});
