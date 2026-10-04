import { Check, TriangleAlert } from 'lucide-react';
import type { ReactNode, RefObject } from 'react';

import { Button } from '@/components/ui/button';
import { ConfirmDialog, DialogFooter } from '@/components/ui/dialog';
import {
  ERASURE_CONFIRMED,
  ERASURE_KEPT,
  erasureDialogIdsOf,
  erasureKeptOf,
  erasuresConfirmedOf,
  type ErasureDecision,
  type ErasureDecisions,
  type ErasureRow,
} from '@/features/conflicts/services/erasures';

/** Every word the dialog shows, resolved by the surface's own `t()`: the dialog holds no key. */
export interface ErasureDialogCopy {
  readonly title: string;
  readonly lede: string;
  /** The polite line when the list changed since it was decided. */
  readonly changed: string;
  readonly rowTitle: (row: ErasureRow) => string;
  /** The row's second line: who is on leave, and what the change leaves of the team that day. */
  readonly rowDetail: (row: ErasureRow) => string;
  /** The toggles' group label. */
  readonly decision: (row: ErasureRow) => string;
  readonly confirm: string;
  readonly keep: string;
  readonly back: string;
  readonly kept: string;
  /** The dialog's own save: the surface's action. */
  readonly save: string;
}

/**
 * THE ERASURE CONFIRMATION (stories 5.5a, 5.5b; mockup `setup-1.html` §2),
 * one for every guarded surface, rendered BESIDE the surface's own form: one
 * row per conflict the change would erase, by date then team, each with its
 * own "Potvrdi brisanje" / "Zadrži" toggles (`aria-pressed`) — nothing
 * preselected. The save is `aria-disabled` until every row is confirmed;
 * "Natrag na uređivanje", Escape and the backdrop close it and keep what was
 * entered. Neutral, never `destructive`. Every word is the surface's
 * ({@link ErasureDialogCopy}); `notes` (the rotation's warnings) never block.
 * Rows wrap at 390 px: nothing here scrolls sideways. With `scrollRows`
 * (story 5.5e) the list scrolls inside the dialog, so its heading, its way
 * back and its save stay in reach however many rows there are.
 */
export function ErasureDialog({
  id,
  rows,
  changed,
  decisions,
  busy,
  firstErasure,
  copy,
  saveIcon,
  notes,
  scrollRows = false,
  onDecide,
  onBack,
  onSave,
}: {
  /** The prefix of the ids its title, lede and kept hint carry: `{id}-title` and so on. */
  readonly id: string;
  readonly rows: readonly ErasureRow[];
  readonly changed: boolean;
  readonly decisions: ErasureDecisions;
  /** A check or a write is in flight: nothing dismisses it and every control waits. */
  readonly busy: boolean;
  readonly firstErasure: RefObject<HTMLButtonElement | null>;
  readonly copy: ErasureDialogCopy;
  readonly saveIcon?: ReactNode;
  readonly notes?: ReactNode;
  /**
   * The rows scroll inside the dialog rather than the dialog growing past the
   * screen (story 5.5e: a deactivation can erase many). Off for the rotation
   * and the calendar, whose layouts stay as they were.
   */
  readonly scrollRows?: boolean;
  readonly onDecide: (key: string, decision: ErasureDecision) => void;
  readonly onBack: () => void;
  readonly onSave: () => void;
}): ReactNode {
  const confirmed = erasuresConfirmedOf(rows, decisions);
  const kept = erasureKeptOf(rows, decisions);
  const blocked = !confirmed || busy;
  const ids = erasureDialogIdsOf(id);

  return (
    <ConfirmDialog busy={busy} onCancel={onBack} aria-labelledby={ids.title} aria-describedby={ids.lede} className="max-w-2xl">
      <div className="grid min-w-0 gap-1.5">
        <h2 id={ids.title} className="font-heading text-lg font-bold leading-tight tracking-tight">
          {copy.title}
        </h2>
        <p id={ids.lede} className="text-sm">
          {copy.lede}
        </p>
      </div>
      {/* THE LIST CHANGED since it was decided: said politely, once, above it. */}
      {changed ? (
        <p role="status" className="text-sm font-medium">
          {copy.changed}
        </p>
      ) : null}
      <ul
        className={
          scrollRows
            ? 'grid max-h-[45vh] min-w-0 gap-2 overflow-y-auto overflow-x-hidden overscroll-contain supports-[height:1dvh]:max-h-[45dvh]'
            : 'grid min-w-0 gap-2'
        }
      >
        {rows.map((row, index) => {
          const decision = decisions[row.key];

          return (
            <li key={row.key} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-md border p-3">
              {/* THE CONFLICT MARK as a shape, never a colour alone. */}
              <TriangleAlert aria-hidden className="size-4 shrink-0" />
              <span className="grid min-w-0 flex-1 basis-48 gap-0.5">
                <span className="break-words font-semibold tabular-nums">{copy.rowTitle(row)}</span>
                <span className="break-words text-sm text-muted-foreground">{copy.rowDetail(row)}</span>
              </span>
              <span role="group" aria-label={copy.decision(row)} className="flex min-w-0 flex-wrap gap-2">
                <Button
                  ref={index === 0 ? firstErasure : undefined}
                  className="h-11 aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground"
                  type="button"
                  variant="outline"
                  aria-pressed={decision === ERASURE_CONFIRMED}
                  disabled={busy}
                  onClick={() => {
                    onDecide(row.key, ERASURE_CONFIRMED);
                  }}
                >
                  {decision === ERASURE_CONFIRMED ? <Check aria-hidden /> : null}
                  {copy.confirm}
                </Button>
                <Button
                  className="h-11 aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground"
                  type="button"
                  variant="outline"
                  aria-pressed={decision === ERASURE_KEPT}
                  disabled={busy}
                  onClick={() => {
                    onDecide(row.key, ERASURE_KEPT);
                  }}
                >
                  {decision === ERASURE_KEPT ? <Check aria-hidden /> : null}
                  {copy.keep}
                </Button>
              </span>
            </li>
          );
        })}
      </ul>
      {/* NOTES NEVER BLOCK: shown, and nothing waits on them. */}
      {notes === undefined ? null : <p className="text-sm empty:hidden">{notes}</p>}
      {kept ? (
        <p id={ids.kept} className="text-sm font-medium">
          {copy.kept}
        </p>
      ) : null}
      <DialogFooter>
        <Button className="h-11" type="button" variant="outline" disabled={busy} onClick={onBack}>
          {copy.back}
        </Button>
        {/* `aria-disabled` rather than `disabled`, so it stays in the tab
            order and its hint is read; a press while blocked does nothing. */}
        <Button
          className="h-11 aria-disabled:opacity-50"
          type="button"
          aria-disabled={blocked}
          aria-describedby={kept ? ids.kept : undefined}
          aria-busy={busy}
          onClick={() => {
            if (!blocked) onSave();
          }}
        >
          {saveIcon}
          {copy.save}
        </Button>
      </DialogFooter>
    </ConfirmDialog>
  );
}
