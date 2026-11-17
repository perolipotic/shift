import { useEffect, useRef, useState } from 'react';

import {
  HISTORY_EXPORT_PRESS,
  exportHistory,
  historyExportDisabled,
  historyExportEmpty,
  historyExportMessageKey,
  historyExportPressOf,
  historyExportRefusalOf,
  type HistoryExportDone,
  type HistoryExportView,
} from '@/features/history/services/history-export';
import type { HistoryRow } from '@/features/history/services/history-rows';
import type { HistorySearchFilters } from '@/features/history/services/history-search';
import { writeHistoryExport } from '@/features/history/services/pdf';

/**
 * *Povijest promjena*'s export (story 14.3), wired as the hours export's
 * (`useHoursExport`): whether a file is being built, and whether the last
 * build FOR THESE ROWS failed. `start` builds the document from `view` — the
 * screen's own rows, never a second read — at the moment of the press, and
 * hands it to the lazily loaded writer. Every rule is
 * `@/features/history/services/history-export`'s; this hook holds wiring only.
 *
 * A failure and a written file's status line belong to the rows they were
 * built from: the ready view's `rows` keep their identity while the snapshot
 * and the chips do, so another period, filter or a refetch that changes the
 * rows shows no old line.
 * Rows over `HISTORY_EXPORT_LIMIT` are refused on the press, before any build
 * (epic 14 retro A9): an alert says how many there are and to narrow the
 * period or the filters, kept against those rows as a failure is.
 * A result arriving after the screen unmounted is dropped. A second press
 * while a file is built is refused by a ref, so two quick presses cannot start
 * two builds.
 */
export function useHistoryExport(view: HistoryExportView, filters: HistorySearchFilters) {
  const [pending, setPending] = useState(false);
  const [failedRows, setFailedRows] = useState<readonly HistoryRow[] | null>(null);
  const [refusedRows, setRefusedRows] = useState<readonly HistoryRow[] | null>(null);
  // The written file's status line, kept with the rows it was built from.
  const [written, setWritten] = useState<{
    readonly rows: readonly HistoryRow[];
    readonly done: HistoryExportDone;
  } | null>(null);
  const inFlight = useRef(false);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;

    return () => {
      live.current = false;
    };
  }, []);

  function start(): void {
    const press = historyExportPressOf(view, inFlight.current);

    if (press === HISTORY_EXPORT_PRESS.ignore) return;

    const built = view.rows;

    setFailedRows(null);
    setWritten(null);
    if (press === HISTORY_EXPORT_PRESS.refuse) {
      setRefusedRows(built);

      return;
    }
    setRefusedRows(null);

    inFlight.current = true;
    setPending(true);
    void exportHistory({ view, filters, generatedAt: new Date() }, writeHistoryExport).then((done) => {
      inFlight.current = false;
      if (!live.current) return;

      setPending(false);
      // Kept against the rows it was built from; shown only while they are.
      if (done === null) setFailedRows(built);
      else setWritten({ rows: built, done });
    });
  }

  return {
    /** Native `disabled`: no row to export. */
    empty: historyExportEmpty(view),
    /** `aria-disabled`: nothing happens on a press, the button keeps its focus. */
    disabled: historyExportDisabled(view, pending),
    labelKey: historyExportMessageKey(pending),
    pending,
    failed: failedRows !== null && failedRows === view.rows,
    /** The refusal's words, while the rows it refused are shown. */
    refused: refusedRows !== null && refusedRows === view.rows ? historyExportRefusalOf(view) : null,
    /** The status line of the file just written, while its rows are shown. */
    written: written !== null && written.rows === view.rows ? written.done : null,
    start,
  };
}
