import { useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck } from 'lucide-react';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog, Dialog, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { IconTile } from '@/components/ui/icon-tile';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { Select } from '@/components/ui/select';
import { t } from '@/lib/i18n';
import { ROTATION_KEY, type RotationSnapshot } from '@/features/rotation/services/list';
import {
  DISPOSITION_AMENDED,
  DISPOSITION_ARCHIVED,
  DISPOSITION_CONFIRMED,
  DISPOSITION_DISCARDED,
  DISPOSITION_FAILED,
  DISPOSITION_GONE,
  DISPOSITION_REASON,
  DISPOSITION_REASON_MAX,
  amendDefaultsOf,
  amendShiftTypeOverride,
  confirmShiftTypeOverride,
  discardShiftTypeOverride,
  dispositionDoneMessageKey,
  dispositionMessageKey,
  overrideReviewOf,
  rowOffersOf,
  type DispositionDone,
  type DispositionFailure,
  type DispositionOutcome,
  type DispositionRpc,
  type PendingOverrideRow,
} from '@/features/rotation/services/override-disposition';
import {
  OVERRIDE_AMEND_ERROR_ID,
  OVERRIDE_AMEND_REASON_ID,
  OVERRIDE_AMEND_TITLE_ID,
  OVERRIDE_AMEND_TYPE_ID,
  OVERRIDE_DISCARD_ERROR_ID,
  OVERRIDE_DISCARD_PROMPT_ID,
  OVERRIDE_REVIEW_HEADING_ID,
} from '@/features/rotation/utils/element-ids';
import { supabaseClient } from '@/lib/supabase/client';

/** The dialog open over the review: an amend or a discard of one row. */
type Armed =
  | { readonly kind: typeof DISPOSITION_AMENDED; readonly row: PendingOverrideRow }
  | { readonly kind: typeof DISPOSITION_DISCARDED; readonly row: PendingOverrideRow };

/**
 * IZMJENE ZA PREGLED (story 3.5c; CAP-9): every override a rotation change
 * left pending, for the admin to confirm, amend or discard. Placed after the
 * builder's notices, and absent while nothing is pending.
 *
 * Which are pending and what each call sends are
 * `@/features/rotation/services/override-disposition`'s, which the node suite
 * executes; this holds state and wiring only.
 *
 * ONE WRITE AT A TIME: `writing` latches a second one, and `pending` keeps the
 * amend and the discard dialogs from being dismissed, and every button
 * disabled, until it has settled. A REFUSAL KEEPS WHAT WAS ENTERED — the
 * amend's fields are uncontrolled — and focuses the refused field. `gone`
 * (disposed of elsewhere) and `archived` (the team or type archived
 * meanwhile) re-read, close the dialog and say so here. What the review said
 * last is cleared when the next disposition starts and when the builder saves
 * (`savedTimes`). A review that cannot be derived says so, never "nothing".
 *
 * ONLY `ROTATION_KEY` IS INVALIDATED; the calendar re-reads whenever it is
 * opened (its stale time is 0). Neutral throughout: never `destructive` and
 * never the accent.
 */
export function OverrideReview({
  snapshot,
  busy,
  savedTimes,
}: {
  /** The builder's snapshot, or `null` while there is none to draw. */
  readonly snapshot: RotationSnapshot | null;
  /** The builder's own save or cancel is in flight: nothing here starts meanwhile. */
  readonly busy: boolean;
  /** How many saves the builder has started: a new one clears what the review said last. */
  readonly savedTimes: number;
}): ReactNode {
  const queryClient = useQueryClient();
  const writing = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const doneNotice = useRef<HTMLParagraphElement>(null);
  const refusalNotice = useRef<HTMLParagraphElement>(null);
  const typeField = useRef<HTMLSelectElement>(null);
  const reasonField = useRef<HTMLInputElement>(null);
  const discardCancel = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState(false);
  const [armed, setArmed] = useState<Armed | null>(null);
  /** A refusal said inside the open dialog. */
  const [failure, setFailure] = useState<DispositionFailure | null>(null);
  /** A refusal said in the review itself: a confirm's, or `gone` once the dialog has closed. */
  const [refusal, setRefusal] = useState<DispositionFailure | null>(null);
  const [done, setDone] = useState<DispositionDone | null>(null);
  const [seenSaves, setSeenSaves] = useState(savedTimes);
  const review = snapshot === null ? null : overrideReviewOf(snapshot);
  const rows = review?.ok === true ? review.rows : [];
  const disabled = pending || busy;

  // The builder saved: what the review said belongs to before it.
  if (seenSaves !== savedTimes) {
    setSeenSaves(savedTimes);
    setDone(null);
    setRefusal(null);
  }

  /** Focus a frame later, once `pending` no longer disables the control: the first target still there, else the heading. */
  function focusLater(...targets: readonly { readonly current: HTMLElement | null }[]): void {
    requestAnimationFrame(() => {
      const found = targets.map((target) => target.current).find((element) => element?.isConnected === true);

      (found ?? heading.current)?.focus();
    });
  }

  async function reread(): Promise<void> {
    try {
      await queryClient.invalidateQueries({ queryKey: ROTATION_KEY });
    } catch (cause) {
      console.error(DISPOSITION_FAILED, cause);
    }
  }

  /**
   * Run one disposition: latch, call, and settle. A landed one re-reads, so
   * the row leaves the review, and is said; `gone` re-reads and closes; any
   * other refusal keeps the dialog open (`inDialog`) and is said in it.
   */
  async function dispose(
    kind: DispositionDone,
    inDialog: boolean,
    call: (client: DispositionRpc) => Promise<DispositionOutcome>,
  ): Promise<void> {
    if (writing.current || busy) return;

    writing.current = true;
    setFailure(null);
    setRefusal(null);
    setDone(null);
    setPending(true);

    try {
      const outcome = await call(supabaseClient() as unknown as DispositionRpc);

      if (outcome.ok) {
        await reread();
        setArmed(null);
        setDone(kind);
        // The row has left the review, and the review may have gone with it.
        focusLater(doneNotice, heading);

        return;
      }

      const stale = outcome.code === DISPOSITION_GONE || outcome.code === DISPOSITION_ARCHIVED;

      if (stale || !inDialog) {
        if (stale) await reread();
        setArmed(null);
        setRefusal(outcome.code);
        focusLater(refusalNotice, heading);

        return;
      }

      setFailure(outcome.code);
      focusLater(
        outcome.code === DISPOSITION_REASON ? reasonField : kind === DISPOSITION_AMENDED ? typeField : discardCancel,
        typeField,
        discardCancel,
      );
    } catch (cause) {
      console.error(DISPOSITION_FAILED, cause);
      if (inDialog) setFailure(DISPOSITION_FAILED);
      else setRefusal(DISPOSITION_FAILED);
    } finally {
      writing.current = false;
      setPending(false);
    }
  }

  function arm(next: Armed): void {
    if (writing.current) return;

    setFailure(null);
    setRefusal(null);
    setDone(null);
    setArmed(next);
  }

  function disarm(): void {
    if (writing.current) return;

    setArmed(null);
    setFailure(null);
    focusLater(heading);
  }

  function submitAmend(event: FormEvent<HTMLFormElement>, row: PendingOverrideRow): void {
    event.preventDefault();

    const type = typeField.current;
    const reason = reasonField.current;

    if (type === null || reason === null) return;

    void dispose(DISPOSITION_AMENDED, true, (client) => amendShiftTypeOverride(client, row, type.value, reason.value));
  }

  function renderRow(row: PendingOverrideRow): ReactNode {
    const offers = rowOffersOf(row);

    return (
      <li key={row.id} className="grid min-w-0 gap-2 rounded-md border p-3 text-sm">
        <p className="font-semibold">{t('rotation.builder.overrides.title', { team: row.teamName, date: row.date })}</p>
        <p>{t('rotation.builder.overrides.type', { type: row.typeName })}</p>
        <p>
          {row.projectedTypeName === null
            ? t('rotation.builder.overrides.noRotation')
            : t('rotation.builder.overrides.projected', { type: row.projectedTypeName })}
        </p>
        <p className="break-words">{t('rotation.builder.overrides.reason', { reason: row.reason })}</p>
        <p>
          {t('rotation.builder.overrides.author', {
            name: row.authorName ?? t('rotation.builder.overrides.unknownAuthor'),
          })}
        </p>
        <div className="flex flex-wrap gap-2">
          {offers.confirm ? (
            <Button
              className="h-11"
              type="button"
              variant="outline"
              disabled={disabled}
              onClick={() => {
                void dispose(DISPOSITION_CONFIRMED, false, (client) => confirmShiftTypeOverride(client, row));
              }}
            >
              {t('rotation.builder.overrides.confirm')}
            </Button>
          ) : null}
          {offers.amend ? (
            <Button
              className="h-11"
              type="button"
              variant="outline"
              disabled={disabled}
              onClick={() => {
                arm({ kind: DISPOSITION_AMENDED, row });
              }}
            >
              {t('rotation.builder.overrides.amend')}
            </Button>
          ) : null}
          <Button
            className="h-11"
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={() => {
              arm({ kind: DISPOSITION_DISCARDED, row });
            }}
          >
            {t('rotation.builder.overrides.discard')}
          </Button>
        </div>
      </li>
    );
  }

  /** The amend: a type and a reason, in a Dialog that cannot be dismissed while it saves. */
  function renderAmend(row: PendingOverrideRow): ReactNode {
    const reasonRefused = failure === DISPOSITION_REASON;
    const typeRefused = failure !== null && !reasonRefused;
    // The override's own type when it may be chosen, and its own reason.
    const defaults = amendDefaultsOf(row);

    return (
      <Dialog
        open={true}
        dismissible={!pending}
        onOpenChange={(next) => {
          if (!next) disarm();
        }}
        aria-labelledby={OVERRIDE_AMEND_TITLE_ID}
      >
        <DialogHeader closeLabel={t('rotation.builder.overrides.amendDialog.close')} onClose={disarm}>
          <DialogTitle id={OVERRIDE_AMEND_TITLE_ID}>
            {t('rotation.builder.overrides.amendDialog.title', { team: row.teamName, date: row.date })}
          </DialogTitle>
        </DialogHeader>
        <form
          method="post"
          noValidate
          onSubmit={(event) => {
            submitAmend(event, row);
          }}
          className="grid gap-4"
        >
          <div className="grid gap-2">
            <Label htmlFor={OVERRIDE_AMEND_TYPE_ID}>{t('rotation.builder.overrides.amendDialog.type')}</Label>
            <Select
              ref={typeField}
              id={OVERRIDE_AMEND_TYPE_ID}
              name="type"
              defaultValue={defaults.shiftTypeId}
              disabled={pending}
              aria-invalid={typeRefused}
              aria-describedby={typeRefused ? OVERRIDE_AMEND_ERROR_ID : undefined}
              className="h-11"
            >
              {row.options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor={OVERRIDE_AMEND_REASON_ID}>{t('rotation.builder.overrides.amendDialog.reason')}</Label>
            <Input
              ref={reasonField}
              id={OVERRIDE_AMEND_REASON_ID}
              name="reason"
              type="text"
              required
              defaultValue={defaults.reason}
              maxLength={DISPOSITION_REASON_MAX}
              autoComplete="off"
              readOnly={pending}
              aria-invalid={reasonRefused}
              aria-describedby={reasonRefused ? OVERRIDE_AMEND_ERROR_ID : undefined}
              className="h-11 w-full"
            />
          </div>
          {failure === null ? null : (
            <Notice id={OVERRIDE_AMEND_ERROR_ID} role="alert">
              {t(dispositionMessageKey(failure))}
            </Notice>
          )}
          <DialogFooter>
            <Button className="h-11" type="button" variant="outline" disabled={pending} onClick={disarm}>
              {t('rotation.builder.overrides.amendDialog.cancel')}
            </Button>
            <Button className="h-11" type="submit" disabled={pending} aria-busy={pending}>
              {pending
                ? t('rotation.builder.overrides.amendDialog.saving')
                : t('rotation.builder.overrides.amendDialog.save')}
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
    );
  }

  /** The discard: one neutral confirmation naming the team, the date and the type restored. */
  function renderDiscard(row: PendingOverrideRow): ReactNode {
    return (
      <ConfirmDialog busy={pending} onCancel={disarm} aria-labelledby={OVERRIDE_DISCARD_PROMPT_ID}>
        <p id={OVERRIDE_DISCARD_PROMPT_ID} className="text-sm font-medium">
          {row.projectedTypeName === null
            ? t('rotation.builder.overrides.discardDialog.promptNoRotation', { team: row.teamName, date: row.date })
            : t('rotation.builder.overrides.discardDialog.prompt', {
                team: row.teamName,
                date: row.date,
                type: row.projectedTypeName,
              })}
        </p>
        {failure === null ? null : (
          <Notice id={OVERRIDE_DISCARD_ERROR_ID} role="alert">
            {t(dispositionMessageKey(failure))}
          </Notice>
        )}
        <DialogFooter>
          <Button
            ref={discardCancel}
            className="h-11"
            type="button"
            variant="outline"
            disabled={pending}
            onClick={disarm}
          >
            {t('rotation.builder.overrides.discardDialog.cancel')}
          </Button>
          <Button
            className="h-11"
            type="button"
            disabled={pending}
            aria-busy={pending}
            onClick={() => {
              void dispose(DISPOSITION_DISCARDED, true, (client) => discardShiftTypeOverride(client, row));
            }}
          >
            {pending
              ? t('rotation.builder.overrides.discardDialog.discarding')
              : t('rotation.builder.overrides.discardDialog.confirm')}
          </Button>
        </DialogFooter>
      </ConfirmDialog>
    );
  }

  const notices = (
    <>
      {done === null ? null : (
        <Notice ref={doneNotice} tabIndex={-1} role="status">
          {t(dispositionDoneMessageKey(done))}
        </Notice>
      )}
      {refusal === null ? null : (
        <Notice ref={refusalNotice} tabIndex={-1} role="alert">
          {t(dispositionMessageKey(refusal))}
        </Notice>
      )}
      {review?.ok === false ? <Notice role="alert">{t('rotation.builder.overrides.unavailable')}</Notice> : null}
    </>
  );

  if (rows.length === 0) {
    return notices;
  }

  return (
    <>
      {notices}
      <Card className="min-w-0">
        <CardHeader className="flex-row items-start gap-3">
          <IconTile>
            <ClipboardCheck />
          </IconTile>
          <div className="grid min-w-0 gap-1.5">
            <CardTitle asChild>
              <h2 id={OVERRIDE_REVIEW_HEADING_ID} ref={heading} tabIndex={-1}>
                {t('rotation.builder.overrides.heading')}
              </h2>
            </CardTitle>
            <CardDescription>{t('rotation.builder.overrides.lede')}</CardDescription>
            <CardDescription>{t('rotation.builder.overrides.count', { count: rows.length })}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          <ul aria-labelledby={OVERRIDE_REVIEW_HEADING_ID} className="grid gap-3">
            {rows.map(renderRow)}
          </ul>
        </CardContent>
      </Card>
      {armed === null ? null : armed.kind === DISPOSITION_AMENDED ? renderAmend(armed.row) : renderDiscard(armed.row)}
    </>
  );
}
