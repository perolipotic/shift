import { useEffect, useSyncExternalStore } from 'react';

import { SIDE_SHEET_QUERY, WIDE_QUERY, phoneStoreOf } from '@/utils/viewport';

/** THE ONE phone store every screen reads (`usePhone`), asked of `window.matchMedia` lazily. */
const phone = phoneStoreOf((query) => window.matchMedia(query));

function isPhoneOnServer(): boolean {
  return false;
}

/** Whether the viewport is below 640 px, read live: crossing it re-renders. */
export function usePhone(): boolean {
  return useSyncExternalStore(phone.subscribe, phone.get, isPhoneOnServer);
}

/**
 * Closes a phone-only surface (the *Više* sheet, the filter sheet) the moment
 * the viewport becomes wide. Listens only while `open`, and stops listening on
 * close.
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

/**
 * Closes a surface that changes shape at `query` (the filter sheet, docked at
 * the bottom below 1024 px and at the side from it, story 15.7) the moment the
 * viewport crosses it, either way. Listens only while `open`.
 */
export function useCloseWhenCrossing(open: boolean, close: () => void, query: string = SIDE_SHEET_QUERY): void {
  useEffect(() => {
    if (!open) return;

    const list = window.matchMedia(query);

    function changed(): void {
      close();
    }

    list.addEventListener('change', changed);
    return () => {
      list.removeEventListener('change', changed);
    };
  }, [open, close, query]);
}
