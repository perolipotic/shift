/**
 * The app's one breakpoint, Tailwind's `sm:` (640 px), as the two media
 * queries code reads it through — a pure module (AD-15). *Kalendar*'s default
 * mode and the filter bar ask "is this a phone"; the *Više* sheet and the
 * filter sheet close when the viewport turns wide. Moved here from the
 * calendar's month model and the navigation feature in story 7.5, so neither
 * feature lends it to the other.
 */

/** Below Tailwind's `sm:` (640 px) — the width the navigation's bottom tabs show at. */
export const PHONE_MEDIA_QUERY = '(max-width: 639px)';

/** At or above Tailwind's `sm:` (640 px): the sidebar's width. */
export const WIDE_QUERY = '(min-width: 640px)';

/** As much of a `MediaQueryList` as the phone store reads. */
export interface PhoneMediaQuery {
  readonly matches: boolean;
  addEventListener(type: 'change', listener: () => void): void;
  removeEventListener(type: 'change', listener: () => void): void;
}

/** A `useSyncExternalStore` source for "is this a phone", read live. */
export interface PhoneStore {
  subscribe(onChange: () => void): () => void;
  get(): boolean;
}

/**
 * Whether the viewport is below 640 px ({@link PHONE_MEDIA_QUERY}), as a store
 * that follows the width live. `media` is `window.matchMedia`, asked lazily.
 */
export function phoneStoreOf(media: (query: string) => PhoneMediaQuery): PhoneStore {
  // ONE list, asked for on first use and shared: what `get` reads is what
  // `subscribe` listens to.
  let list: PhoneMediaQuery | null = null;
  const query = (): PhoneMediaQuery => (list ??= media(PHONE_MEDIA_QUERY));

  return {
    subscribe(onChange) {
      const shared = query();

      shared.addEventListener('change', onChange);

      return () => {
        shared.removeEventListener('change', onChange);
      };
    },
    get: () => query().matches,
  };
}
