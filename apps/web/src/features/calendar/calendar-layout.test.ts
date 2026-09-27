import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CALENDAR_SCREEN_PARTS } from '@/features/calendar/calendar-screen.fixture';

/**
 * Package 3c, the parts of the calendar's layout a source can hold and a
 * browser run cannot: the scroller's bound (small viewport units, lifted in
 * print, isolated), the scroll margins that ARE the sticky sizes, and the one
 * read. The rest is `e2e/tests/calendar/layout.spec.ts`.
 */

const srcRoot = fileURLToPath(new URL('../..', import.meta.url));
const source = (parts: readonly string[]): string =>
  readFileSync(join(srcRoot, ...parts), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const grid = source(CALENDAR_SCREEN_PARTS.grid);
const hook = source(CALENDAR_SCREEN_PARTS.screenHook);

/** Every `className="…"` string in the grid. */
const classes = [...grid.matchAll(/className="([^"]*)"/g)].map(([, value]) => value ?? '');
const withClass = (name: string): string[] => classes.filter((value) => value.split(/\s+/).includes(name));

describe("the grid's scroller", () => {
  const bound = withClass('isolate');

  it('is bounded in small viewport units, isolated, and lifted in print', () => {
    expect(bound, 'no isolated wrapper bounds the scroller').toHaveLength(1);
    const wrapper = (bound[0] ?? '').split(/\s+/);

    expect(wrapper).toContain('[&>div]:max-h-[70svh]');
    expect(wrapper, 'a dynamic viewport unit resizes the scroller mid-scroll').not.toContainEqual(
      expect.stringMatching(/dvh|\bvh\b/),
    );
    expect(wrapper, 'a printed month is cut at the bound').toContain('print:[&>div]:max-h-none');
    expect(wrapper).toContain('print:[&>div]:overflow-visible');
  });
});

describe("the cells' scroll margins are the sticky sizes", () => {
  const cell = classes.find((value) => /\bscroll-ml-/.test(value)) ?? '';
  const margin = (axis: 'l' | 't'): string | undefined => new RegExp(`\\bscroll-m${axis}-(\\d+)\\b`).exec(cell)?.[1];
  const corner = classes.find((value) => /\bsticky\b/.test(value) && /\bleft-0\b/.test(value) && /\btop-0\b/.test(value)) ?? '';
  const header = classes.filter((value) => /\bsticky\b/.test(value) && /\btop-0\b/.test(value));

  it('ties the date column width to scroll-margin-left', () => {
    const width = /\bw-(\d+)\b/.exec(corner)?.[1];

    expect(width, 'the date column has no explicit width').toBeDefined();
    expect(corner.split(/\s+/)).toContain(`min-w-${width ?? ''}`);
    expect(margin('l')).toBe(width);
  });

  it('ties the header height to scroll-margin-top, on every header cell', () => {
    expect(header, 'the corner and the team header').toHaveLength(2);
    const heights = header.map((value) => /\bh-(\d+)\b/.exec(value)?.[1]);

    for (const height of heights) expect(height, 'a header cell has no explicit height').toBe(margin('t'));
  });
});

describe('the calendar makes one read', () => {
  it('holds exactly one useQuery in the screen hook, and no other way to fetch', () => {
    expect(hook.split('useQuery(').length - 1).toBe(1);
    expect(hook).not.toMatch(/\b(fetchQuery|ensureQueryData|prefetchQuery|fetchInfiniteQuery|refetchQueries)\b/);
  });
});
