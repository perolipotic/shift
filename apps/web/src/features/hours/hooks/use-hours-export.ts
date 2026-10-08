import { useEffect, useRef, useState } from 'react';

import {
  exportHours,
  hoursExportDoneOf,
  hoursExportDisabled,
  hoursExportEmpty,
  hoursExportMessageKey,
} from '@/features/hours/services/hours-export';
import type { OrganizationHoursView } from '@/features/hours/services/organization-hours';
import { writeHoursExport } from '@/features/hours/services/xlsx';

/**
 * The organization table's export (story 4.3): whether a file is being
 * built, and whether the last build FOR THIS VIEW failed. `start` builds the
 * sheet from `view` — the table's own, never a second read — and hands it to
 * the lazily loaded writer. Every rule is
 * `@/features/hours/services/hours-export`'s, which the node suite executes;
 * this hook holds wiring only.
 *
 * A failure belongs to the view it was built from: another month, filter or
 * sort shows no old alert, and the status line of a written file (story
 * 7.14) goes the same way. A result arriving after the screen unmounted is
 * dropped. A second press while a file is built is refused by a ref, not by
 * the render's `pending`, so two quick presses cannot start two builds.
 */
export function useHoursExport(view: OrganizationHoursView, organizationName: string) {
  const [pending, setPending] = useState(false);
  const [failedView, setFailedView] = useState<OrganizationHoursView | null>(null);
  const [writtenView, setWrittenView] = useState<OrganizationHoursView | null>(null);
  const inFlight = useRef(false);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;

    return () => {
      live.current = false;
    };
  }, []);

  function start(): void {
    if (inFlight.current || hoursExportEmpty(view)) return;

    const built = view;

    inFlight.current = true;
    setPending(true);
    setFailedView(null);
    setWrittenView(null);
    void exportHours(built, organizationName, writeHoursExport).then((written) => {
      inFlight.current = false;
      if (!live.current) return;

      setPending(false);
      // Kept against the view it was built from; shown only while that view is.
      if (written) setWrittenView(built);
      else setFailedView(built);
    });
  }

  return {
    /** Native `disabled`: no row to export. */
    empty: hoursExportEmpty(view),
    /** `aria-disabled`: nothing happens on a press, the button keeps its focus. */
    disabled: hoursExportDisabled(view, pending),
    labelKey: hoursExportMessageKey(pending),
    pending,
    failed: failedView !== null && failedView === view,
    /** The status line of the file just written, while its view is shown (story 7.14). */
    written: writtenView !== null && writtenView === view ? hoursExportDoneOf(view, organizationName) : null,
    start,
  };
}
