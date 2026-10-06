import { useEffect } from 'react';

/** The chrome's one breakpoint, Tailwind's `sm:` (640 px): the sidebar's width. */
export const WIDE_QUERY = '(min-width: 640px)';

/**
 * Closes a phone-only surface (the *Više* sheet) the moment the viewport
 * becomes wide. Listens only while `open`, and stops listening on close.
 */
export function useCloseWhenWide(open: boolean, close: () => void): void {
  useEffect(() => {
    if (!open) return;

    const wide = window.matchMedia(WIDE_QUERY);

    if (wide.matches) {
      close();

      return;
    }

    function changed(event: MediaQueryListEvent): void {
      if (event.matches) close();
    }

    wide.addEventListener('change', changed);
    return () => {
      wide.removeEventListener('change', changed);
    };
  }, [open, close]);
}
