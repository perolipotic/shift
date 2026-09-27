import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';

import { MONTH_HEADING_ID, GRID_TAB_STOP_SELECTOR } from '@/features/calendar/utils/grid-keys';
import { DAY_DETAIL_DIALOG_ID, dayDetailShownOf, type OpenedDay } from '@/features/calendar/utils/day-detail';
import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';

/**
 * THE DAY DETAIL (story 3.4b): which day is open, and every way it closes.
 *
 * Which day is open lives in `useState`, not in the URL; it is re-derived from
 * the current snapshot on every render (`dayDetailShownOf`) and closes — for
 * good, never reopening by itself — when the snapshot is gone, the team
 * disappears, or `detailKey` (the month, mode, team or person shown) changes.
 *
 * Every close returns focus to the opener once the Dialog has closed, or to the
 * grid's tab stop (inside `gridRef`) or the month heading when the opener is
 * gone.
 */
export function useDayDetail(
  snapshot: CalendarSnapshot | null,
  detailKey: string,
  gridRef: RefObject<HTMLTableElement | null>,
) {
  // Which day is open; the control that opened it, which gets focus back; and
  // a count of closes, which the effect below returns focus after.
  const [opened, setOpened] = useState<OpenedDay | null>(null);
  const [closes, setCloses] = useState(0);
  const openerRef = useRef<HTMLElement | null>(null);
  // Whether a close the screen asked for still owes its `close` event. The
  // browser fires it as a TASK after the dialog has closed, so a day opened in
  // between (Escape, then Space at once) must not be closed by the late event.
  const closeEventOwedRef = useRef(false);
  // Re-derived from the current snapshot while open (`dayDetailShownOf`).
  const shownDetail = useMemo(() => dayDetailShownOf(snapshot, opened), [snapshot, opened]);
  const detail = shownDetail.detail;
  const [detailFor, setDetailFor] = useState(detailKey);

  if (detailFor !== detailKey) {
    setDetailFor(detailKey);

    if (opened !== null) {
      setOpened(null);
      setCloses((count) => count + 1);
    }
  } else if (shownDetail.close) {
    // No snapshot, the team gone, or a derivation that threw: forget the day,
    // so it never reopens by itself when data returns.
    setOpened(null);
    setCloses((count) => count + 1);
  }

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
    setOpened({ teamId, date });
  }

  /** Every close by the viewer — Escape, the close button, the backdrop. */
  function closeDay(): void {
    const dialog = document.getElementById(DAY_DETAIL_DIALOG_ID);

    // Still open: its `close` event is yet to come, and is this close's.
    if (dialog instanceof HTMLDialogElement && dialog.open) closeEventOwedRef.current = true;
    setOpened(null);
    setCloses((count) => count + 1);
  }

  /**
   * The dialog's `close` event: the one a close already handled owes is
   * consumed; any other — the browser closing it on its own — closes the day.
   */
  function closedByBrowser(): void {
    if (closeEventOwedRef.current) {
      closeEventOwedRef.current = false;

      return;
    }

    if (opened !== null) closeDay();
  }

  return { detail, openDay, closeDay, closedByBrowser };
}

export type DayDetailState = ReturnType<typeof useDayDetail>;
