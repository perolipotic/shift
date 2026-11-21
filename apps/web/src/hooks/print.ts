import { useCallback, useEffect, useState } from 'react';
import { flushSync } from 'react-dom';

/** What a print stamp listens on: the window, and its print media query. */
export interface PrintSignals {
  readonly window: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
  readonly media: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
}

/**
 * Calls `stamp` right before every print — on `beforeprint`, and on the
 * switch to print media where a browser fires no `beforeprint` — and returns
 * the unsubscribe. Plain event targets, so a node test drives it.
 */
export function onEveryPrint(signals: PrintSignals, stamp: () => void): () => void {
  const onMedia = (event: Event): void => {
    if ((event as Partial<MediaQueryListEvent>).matches === true) stamp();
  };

  signals.window.addEventListener('beforeprint', stamp);
  signals.media.addEventListener('change', onMedia);

  return () => {
    signals.window.removeEventListener('beforeprint', stamp);
    signals.media.removeEventListener('change', onMedia);
  };
}

/**
 * STORY 16.1 (decision D3): the month prints through the browser's own
 * dialog, `window.print()`, and nothing else — no PDF library, no read.
 *
 * `printedAt` is the instant the printed header names. It is taken again
 * right before every print (`onEveryPrint`), so a print started from
 * *Ispiši*, the browser's own menu or Ctrl+P names its own time. The stamp
 * commits synchronously (`flushSync`), so the page the browser lays out
 * already holds it; *Ispiši* stamps before `window.print()` too, for a browser
 * that fires neither signal.
 */
export function usePrintMonth(): { readonly printedAt: Date; readonly print: () => void } {
  const [printedAt, setPrintedAt] = useState(() => new Date());

  const stamp = useCallback(() => {
    flushSync(() => {
      setPrintedAt(new Date());
    });
  }, []);

  useEffect(() => onEveryPrint({ window, media: window.matchMedia('print') }, stamp), [stamp]);

  const print = useCallback(() => {
    stamp();
    window.print();
  }, [stamp]);

  return { printedAt, print };
}
