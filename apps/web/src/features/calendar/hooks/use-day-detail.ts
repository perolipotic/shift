import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';

import { MONTH_HEADING_ID, GRID_TAB_STOP_SELECTOR } from '@/features/calendar/utils/grid-keys';
import {
  DAY_DETAIL_DIALOG_ID,
  dayDetailCloseOf,
  dayDetailShownOf,
  openedDayKeyOf,
  type OpenedDay,
} from '@/features/calendar/utils/day-detail';
import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';

/**
 * THE DAY DETAIL (story 3.4b): which day is open, and every way it closes.
 *
 * Which day is open lives in the URL (`opened`, from `?dan=…&danSmjena=…`,
 * deferred-work E862); `write` changes it — a day pushes a history entry, so
 * Back closes it and Back from the conflict screen reopens it, and `null`
 * replaces the entry. The day is re-derived from the current snapshot on every
 * render (`dayDetailShownOf`).
 *
 * WHILE THE SNAPSHOT IS LOADING, a day in the URL waits: a reload or a Back
 * opens it once the read lands. Once shown, it closes — for good, the URL
 * replaced, never reopening by itself — when the snapshot is gone, the team
 * disappears, or the derivation throws; a day the snapshot cannot show (an
 * unknown team in a link) is dropped the same way (`dayDetailCloseOf`).
 *
 * Every close returns focus to the opener once the Dialog has closed, or to the
 * grid's tab stop (inside `gridRef`) or the month heading when the opener is
 * gone — a Back included.
 */
export function useDayDetail(
  snapshot: CalendarSnapshot | null,
  opened: OpenedDay | null,
  write: (day: OpenedDay | null) => void,
  gridRef: RefObject<HTMLTableElement | null>,
) {
  // The open day as one string, so a new object for the same day is the same day.
  const openedKey = openedDayKeyOf(opened);
  // A count of closes, which the effect below returns focus after; and the
  // control that opened the day, which gets focus back.
  const [closes, setCloses] = useState(0);
  const openerRef = useRef<HTMLElement | null>(null);
  // Whether a close the screen asked for still owes its `close` event. The
  // browser fires it as a TASK after the dialog has closed, so a day opened in
  // between (Escape, then Space at once) must not be closed by the late event.
  const closeEventOwedRef = useRef(false);
  // The day a close was asked for, until the URL drops it: closed at once, not
  // a navigation later.
  const [closedKey, setClosedKey] = useState<string | null>(null);
  // The day last SHOWN: one that was on screen closes when its snapshot goes;
  // one still waiting for the first read does not.
  const [shownKey, setShownKey] = useState<string | null>(null);
  // Re-derived from the current snapshot while open (`dayDetailShownOf`);
  // `opened` is the same object for the same day (the screen memoizes it).
  const shownDetail = useMemo(
    () => (snapshot === null ? null : dayDetailShownOf(snapshot, opened)),
    [snapshot, opened],
  );

  if (closedKey !== null && closedKey !== openedKey) setClosedKey(null);

  const asked = openedKey !== null && openedKey !== closedKey;
  const dropping = asked && dayDetailCloseOf(shownDetail, shownKey === openedKey);
  const detail = asked && !dropping && shownDetail !== null ? shownDetail.detail : null;
  const shown = detail === null ? null : openedKey;
  const [wasShown, setWasShown] = useState(shown);

  if (wasShown !== shown) {
    setWasShown(shown);
    if (shown !== null) setShownKey(shown);
    // Whatever closed it — the viewer, Back, a change of the search, the data
    // — focus returns.
    if (wasShown !== null) setCloses((count) => count + 1);
  }

  // A day that must close is dropped from the URL, replacing the entry. Read
  // through a ref, so a new `write` every render does not re-run it.
  const writeRef = useRef(write);

  useEffect(() => {
    writeRef.current = write;
  });

  useEffect(() => {
    if (dropping) writeRef.current(null);
  }, [dropping]);

  // AFTER the Dialog has closed (its own effect runs first, and the browser
  // restores focus on `close()`), focus goes back to the opener — or, when it
  // is no longer in the document, to the grid's tab stop or the month heading.
  useEffect(() => {
    if (closes === 0) return;

    const frame = requestAnimationFrame(() => {
      const opener = openerRef.current;
      const fallback =
        gridRef.current?.querySelector<HTMLElement>(GRID_TAB_STOP_SELECTOR) ??
        document.getElementById(MONTH_HEADING_ID);

      (opener?.isConnected === true ? opener : fallback)?.focus();
    });

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [closes, gridRef]);

  /** Opens `teamId` on `date`, remembering `opener` for the return of focus. */
  function openDay(teamId: string, date: string, opener: HTMLElement): void {
    openerRef.current = opener;
    setClosedKey(null);
    write({ teamId, date });
  }

  /** Every close by the viewer — Escape, the close button, the backdrop. */
  function closeDay(): void {
    // Nothing open is nothing to close. Escape reaches this once, through
    // `onCancel` (the dialog's own `onClose` replaces the primitive's, so
    // `onOpenChange(false)` comes from the backdrop alone); should two callbacks
    // ever report one close, the second finds the day gone and writes nothing.
    if (detail === null || openedKey === null) return;

    const dialog = document.getElementById(DAY_DETAIL_DIALOG_ID);

    // Still open: its `close` event is yet to come, and is this close's.
    if (dialog instanceof HTMLDialogElement && dialog.open) closeEventOwedRef.current = true;
    setClosedKey(openedKey);
    write(null);
  }

  /**
   * The dialog's `close` event: the one a close already handled owes is
   * consumed; one that finds the dialog open again is stale — a close with no
   * debt (a change of the search) whose event arrived after a new day opened —
   * and closes nothing; any other — the browser closing it on its own —
   * closes the day.
   */
  function closedByBrowser(): void {
    if (closeEventOwedRef.current) {
      closeEventOwedRef.current = false;

      return;
    }

    const dialog = document.getElementById(DAY_DETAIL_DIALOG_ID);

    if (dialog instanceof HTMLDialogElement && dialog.open) return;
    if (detail !== null) closeDay();
  }

  return { detail, openDay, closeDay, closedByBrowser };
}

export type DayDetailState = ReturnType<typeof useDayDetail>;
