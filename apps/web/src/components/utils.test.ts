import { describe, expect, it } from 'vitest';

import { cn } from '@/components/utils';

/**
 * shadcn/ui's class merger. Every component added from story 1.1b onward
 * composes its classes through this, so the two halves both have to be wired:
 * clsx for conditional joining, tailwind-merge for conflict resolution. With
 * only clsx, `cn('p-2', 'p-4')` emits both and the later prop silently loses to
 * whichever Tailwind emitted first — a bug no snapshot catches.
 */

describe('cn', () => {
  it('joins class names', () => {
    expect(cn('a', 'b')).toBe('a b');
  });

  it('drops falsy values and flattens arrays and objects', () => {
    expect(cn('a', false, undefined, null, ['b', 'c'], { d: true, e: false })).toBe('a b c d');
  });

  it('resolves a Tailwind conflict in favour of the last class', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
    expect(cn('text-sm text-neutral-500', 'text-lg')).toBe('text-neutral-500 text-lg');
  });

  it('returns an empty string for no classes', () => {
    expect(cn()).toBe('');
  });
});
