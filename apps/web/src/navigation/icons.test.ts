import { describe, expect, it } from 'vitest';

import { DESTINATIONS } from '@/navigation/destinations';
import { destinationIcon } from '@/navigation/icons';

/**
 * The icon map, EXECUTED.
 *
 * The record is total by TYPE — `Record<NavigationKey, LucideIcon>` — so a ninth
 * destination with no icon is a `pnpm typecheck` failure rather than a runtime
 * one. What the type cannot say is that the eight entries are eight DIFFERENT
 * icons: a map whose values had all been copied from the first line, or a reader
 * that returned a constant, type-checks perfectly and ships a navigation where
 * every entry wears the same glyph.
 *
 * That is not a cosmetic failure. The icon is decoration beside a visible label,
 * so nothing becomes unreadable — but a shared glyph removes the one cue that
 * makes a bottom bar scannable at arm's length on a phone, and it is exactly the
 * kind of defect nobody files a report about.
 */

describe('every destination is drawn with its own icon', () => {
  it('resolves an icon for all eight, and never the same one twice', () => {
    // Read off the shipped table rather than a list written here: a ninth
    // destination joins this assertion by existing, which is the whole reason
    // `@/navigation/destinations` is data.
    const icons = DESTINATIONS.map((destination) => destinationIcon(destination.key));

    expect(icons).toHaveLength(8);
    expect(icons, 'a destination resolves to no icon at all').not.toContain(undefined);
    expect(new Set(icons).size, 'two destinations are drawn with the same icon').toBe(icons.length);
  });

  it('resolves the same icon for the same key every time', () => {
    // A reader that built something new per call would put a fresh component
    // type on every render, which React remounts rather than updates — the
    // shape that makes an icon flicker on every navigation.
    expect(destinationIcon('nav.danas')).toBe(destinationIcon('nav.danas'));
    expect(destinationIcon('nav.danas')).not.toBe(destinationIcon('nav.kalendar'));
  });

  it('hands back something React can render', () => {
    // Vacuous-pass guard on the two assertions above: a map of eight distinct
    // strings would satisfy both and render nothing.
    for (const destination of DESTINATIONS) {
      const icon: unknown = destinationIcon(destination.key);

      expect(
        typeof icon === 'function' || (typeof icon === 'object' && icon !== null),
        `${destination.key} resolves to something that is not a component`,
      ).toBe(true);
    }
  });
});
