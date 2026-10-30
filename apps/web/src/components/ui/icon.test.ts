import { describe, expect, it } from 'vitest';

import { pathsOf } from '@/components/ui/icon';

/**
 * The facade's guard (story 15.1): a Phosphor core file must hold the 256
 * viewBox and `<path d>` elements, nothing else, or the module throws when it
 * loads. Without it a `<circle>` or a `<g>` in a future Phosphor release would
 * be dropped from the drawing silently. Every icon the facade exports already
 * passed this guard by being imported here at all.
 */
describe('the icon facade reads path data only', () => {
  const shell = (body: string): string =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor">${body}</svg>`;

  it('reads every path of a paths-only file', () => {
    expect(pathsOf(shell('<path d="M0,0H8Z"/><path d="M1,1H9Z"/>'), 'two')).toEqual(['M0,0H8Z', 'M1,1H9Z']);
  });

  it.each([
    ['a circle', shell('<path d="M0,0H8Z"/><circle cx="8" cy="8" r="4"/>')],
    ['a group', shell('<g><path d="M0,0H8Z"/></g>')],
    ['a path with another attribute', shell('<path d="M0,0H8Z" opacity="0.2"/>')],
    ['another viewBox', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M0,0H8Z"/></svg>'],
    ['no path at all', shell('')],
  ])('throws on %s', (_, svg) => {
    expect(() => pathsOf(svg, 'bad')).toThrow('ICON_NOT_PATHS_ONLY: bad');
  });
});
