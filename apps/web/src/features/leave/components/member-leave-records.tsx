import { Pencil, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { ConfirmDialog, DialogFooter } from '@/components/ui/dialog';
import { Notice } from '@/components/ui/notice';
import type { MemberLeave } from '@/features/leave/hooks/use-member-leave';
import {
  LEAVE_LINE_SEPARATOR,
  LEAVE_LOADING,
  LEAVE_READY,
  LEAVE_RECORDS_HEADING_ID,
  LEAVE_REMOVE_PROMPT_ID,
  LEAVE_REMOVE_REPLACEMENTS_ID,
  REPLACEMENTS_UNKNOWN,
  leaveConfirmFailureOf,
  leaveListFailureOf,
  leaveRefusalMessageKey,
  leaveRemovePromptMessageKey,
  replacementLinesShown,
  type ReplacementGuard,
} from '@/features/leave/services/leave-section';
import { t } from '@/lib/i18n';

/**
 * THE REPLACEMENT GUARD'S LINES (story 5.4e): one line per replacement an
 * amend or a removal would leave rostered, or the line that they cannot be
 * checked. NOTES, never a gate and never `destructive`: they sit beside the
 * action and change nothing about it. `inline` renders them inside a
 * `Notice`'s paragraph as block lines, each after a space, so a screen reader
 * never runs the sentences together; otherwise as their own list, named by
 * `id`. They wrap at any width.
 */
export function LeaveReplacementLines({
  guard,
  inline = false,
  id,
}: {
  readonly guard: ReplacementGuard | null;
  readonly inline?: boolean;
  readonly id?: string;
}): ReactNode {
  const lines = replacementLinesOf(guard);

  if (lines.length === 0) return null;

  if (inline) {
    return lines.map((line) => (
      <span key={line.key}>
        {LEAVE_LINE_SEPARATOR}
        <span className="mt-1 block break-words">{line.text}</span>
      </span>
    ));
  }

  return (
    <ul id={id} className="grid min-w-0 gap-1">
      {lines.map((line) => (
        <li key={line.key} className="min-w-0 break-words text-sm font-medium">
          {line.text}
        </li>
      ))}
    </ul>
  );
}

/** The guard's lines as text, each with a stable key: its override, or the one unknown line. */
function replacementLinesOf(guard: ReplacementGuard | null): readonly { readonly key: string; readonly text: string }[] {
  if (guard === null) return [];

  if (guard.kind === REPLACEMENTS_UNKNOWN) {
    return [{ key: REPLACEMENTS_UNKNOWN, text: t('ljudi.leaveRecord.replacementsUnknown') }];
  }

  return guard.lines.map((line) => ({
    key: line.overrideId,
    text: t('ljudi.leaveRecord.replacementStays', { name: line.name, team: line.team, date: line.date }),
  }));
}

/**
 * The member's live leave records on the *Godišnji* card (story 5.2b),
 * soonest first, each with its range, what it costs, and its two actions:
 * Izmijeni puts the card's one od–do form into amend mode for it, and Ukloni
 * opens its one confirmation. Above them, what the last amend or removal
 * left the list saying: the record removed, or that it was already gone.
 *
 * Every row, cost and message is `@/features/leave/services/leave-section`'s
 * decision; this renders them. Neutral styling throughout (UX-DR4, UX-DR27).
 */
export function MemberLeaveRecords({ leave }: { readonly leave: MemberLeave }): ReactNode {
  const { base, formDisabled, leaveFailure, removeFailure, confirming, leaveRemoved, removedReplacements, amendTarget } =
    leave;

  if (base.kind !== LEAVE_READY && base.kind !== LEAVE_LOADING) return null;

  const listFailure = leaveListFailureOf(leaveFailure, removeFailure, confirming !== null);

  /** The rows, a skeleton while the reads are pending, or the line that says there are none. */
  function renderRows(): ReactNode {
    if (base.kind !== LEAVE_READY) {
      return <div className="h-14 w-full animate-pulse rounded-md bg-muted" />;
    }

    if (base.rows.length === 0) {
      return <p className="text-sm text-muted-foreground">{t('ljudi.leaveRecord.recordsEmpty')}</p>;
    }

    return (
      <ul className="grid min-w-0 gap-2">
        {base.rows.map((row) => {
          // THE ROW IN AMEND MODE says so in words, not colour alone, and
          // offers no second Izmijeni of itself.
          const amended = amendTarget?.id === row.record.id;

          return (
            <li
              key={row.record.id}
              aria-current={amended ? 'true' : undefined}
              className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-md border border-input p-3"
            >
              <div className="grid min-w-0 gap-0.5">
                <span className="text-sm font-medium tabular-nums">
                  {row.label}
                  {amended ? <span className="ms-2 text-xs font-semibold">{t('ljudi.leaveRecord.amending')}</span> : null}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {t('count.days', { count: row.costDays })}
                </span>
                {row.inYearDays === null ? null : (
                  <span className="text-xs text-muted-foreground">
                    {t('ljudi.leaveRecord.costInYear', { count: row.inYearDays })}
                  </span>
                )}
              </div>
              <div className="flex min-w-0 flex-wrap gap-2">
                <Button
                  className="h-11"
                  type="button"
                  variant="outline"
                  disabled={formDisabled || amended}
                  onClick={(event) => {
                    leave.startAmend(row, event);
                  }}
                >
                  <Pencil aria-hidden />
                  {/* THE WORD IS SHORT, THE NAME IS WHOLE: the range is read
                      beside it, and the accessible name names it (WCAG 2.5.3). */}
                  <span aria-hidden>{t('ljudi.leaveRecord.amend')}</span>
                  <span className="sr-only">{t('ljudi.leaveRecord.amendName', { from: row.from, to: row.to })}</span>
                </Button>
                <Button
                  className="h-11"
                  type="button"
                  variant="ghost"
                  disabled={formDisabled}
                  onClick={(event) => {
                    leave.openRemove(row, event);
                  }}
                >
                  <Trash2 aria-hidden />
                  <span aria-hidden>{t('ljudi.leaveRecord.remove')}</span>
                  <span className="sr-only">{t('ljudi.leaveRecord.removeName', { from: row.from, to: row.to })}</span>
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  /** What the last amend or removal left the list saying. */
  function renderNotice(): ReactNode {
    if (listFailure !== null) {
      return (
        <Notice ref={leave.listNoticeField} role="alert" tabIndex={-1}>
          {t(leaveRefusalMessageKey(listFailure))}
        </Notice>
      );
    }

    if (leaveRemoved === null) return null;

    return (
      <Notice ref={leave.listNoticeField} role="status" tabIndex={-1}>
        {t('ljudi.leaveRecord.removed', { from: leaveRemoved.from, to: leaveRemoved.to })}
        <LeaveReplacementLines guard={removedReplacements} inline />
      </Notice>
    );
  }

  return (
    <section aria-labelledby={LEAVE_RECORDS_HEADING_ID} className="grid min-w-0 gap-2">
      <h3 ref={leave.listHeading} id={LEAVE_RECORDS_HEADING_ID} tabIndex={-1} className="text-sm font-semibold">
        {t('ljudi.leaveRecord.recordsHeading')}
      </h3>
      {renderNotice()}
      {renderRows()}
    </section>
  );
}

/**
 * REMOVING A RECORD (story 5.2b): exactly one neutral modal confirmation that
 * names the range and what it costs, and each replacement the removal would
 * leave rostered (story 5.4e) — the removal confirm of
 * `override-form.tsx`. Cancel is `outline`, confirm the default variant, and
 * nothing is `destructive`. A refusal keeps it open with its alert inside;
 * while the removal is in flight nothing dismisses it.
 */
export function MemberLeaveRemoveConfirm({ leave }: { readonly leave: MemberLeave }): ReactNode {
  const { confirming, removePending, removeFailure, removeCancel, cancelRemove, formDisabled, removeGuard } = leave;

  if (confirming === null) return null;

  const failure = leaveConfirmFailureOf(removeFailure);
  // THE REPLACEMENT LINES DESCRIBE THE DIALOG while there are any (story 5.4e); the prompt already names it.
  const describedBy = replacementLinesShown(removeGuard) ? LEAVE_REMOVE_REPLACEMENTS_ID : undefined;

  return (
    <ConfirmDialog
      busy={removePending}
      onCancel={cancelRemove}
      aria-labelledby={LEAVE_REMOVE_PROMPT_ID}
      aria-describedby={describedBy}
    >
      <p id={LEAVE_REMOVE_PROMPT_ID} className="text-sm font-medium">
        {t(leaveRemovePromptMessageKey(confirming), {
          from: confirming.from,
          to: confirming.to,
          cost: t('count.days', { count: confirming.costDays }),
          inYear: t('count.days', { count: confirming.inYearDays ?? confirming.costDays }),
        })}
      </p>
      {/* STORY 5.4e: a note beside the confirm, never a gate. */}
      <LeaveReplacementLines guard={removeGuard} id={LEAVE_REMOVE_REPLACEMENTS_ID} />
      {failure === null ? null : <Notice role="alert">{t(leaveRefusalMessageKey(failure))}</Notice>}
      <DialogFooter>
        <Button
          ref={removeCancel}
          className="h-11"
          type="button"
          variant="outline"
          disabled={removePending}
          onClick={cancelRemove}
        >
          {t('ljudi.leaveRecord.removeCancel')}
        </Button>
        <Button
          className="h-11"
          type="button"
          disabled={formDisabled}
          aria-busy={removePending}
          onClick={() => {
            void leave.remove();
          }}
        >
          <Trash2 aria-hidden />
          {removePending ? t('ljudi.leaveRecord.removing') : t('ljudi.leaveRecord.removeConfirm')}
        </Button>
      </DialogFooter>
    </ConfirmDialog>
  );
}
