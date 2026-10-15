import { ClipboardCheck } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog, Dialog, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { IconTile } from '@/components/ui/icon-tile';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { Select } from '@/components/ui/select';
import { candidateGroupMessageKey } from '@/features/calendar/utils/replacement-candidates';
import { ErasureDialog } from '@/features/conflicts/components/erasure-dialog';
import type { ErasureRow } from '@/features/conflicts/services/erasures';
import { t } from '@/lib/i18n';
import {
  useOverrideReview,
  type AmendEntered,
  type OverrideReviewState,
} from '@/features/rotation/hooks/use-override-review';
import type { RotationSnapshot } from '@/features/rotation/services/list';
import {
  AMEND_TYPES,
  DISPOSITION_AMENDED,
  DISPOSITION_CONFIRMED,
  DISPOSITION_DISCARDED,
  DISPOSITION_REASON,
  REVIEW_SHIFT_TYPE,
  dispositionDoneMessageKey,
  dispositionMessageKey,
  offeredIn,
  reviewAmendDefaultsOf,
  reviewOffersOf,
  type AmendOptionGroup,
  type DispositionTypeOption,
  type PendingRosterOverrideRow,
  type ReviewRow,
} from '@/features/rotation/services/override-disposition';
import {
  OVERRIDE_AMEND_ERROR_ID,
  OVERRIDE_AMEND_REASON_ID,
  OVERRIDE_AMEND_TITLE_ID,
  OVERRIDE_AMEND_TYPE_ID,
  OVERRIDE_DISCARD_ERROR_ID,
  OVERRIDE_DISCARD_PROMPT_ID,
  OVERRIDE_REVIEW_ERASURES_ID,
  OVERRIDE_REVIEW_HEADING_ID,
  OVERRIDE_REVIEW_UNCHECKED_ID,
} from '@/features/rotation/utils/element-ids';

/**
 * IZMJENE ZA PREGLED (story 3.5c; CAP-9): every override a rotation change
 * left pending, for the admin to confirm, amend or discard — a shift-type
 * override, and since 0039 a roster override, whose amend changes who
 * arrives. Placed after the builder's notices, and absent while nothing is
 * pending.
 *
 * A RENDERER (story 5.5h): every state, every call and every rule is
 * `@/features/rotation/hooks/use-override-review`'s, and through it
 * `@/features/rotation/services/override-disposition`'s and
 * `@/features/rotation/services/override-review-erasures`'s, which the node
 * suite executes. It reads no query.
 *
 * A confirm or an amend that would erase a pending conflict opens the shared
 * `ErasureDialog` first, in the review's own words; a discard never does.
 * Neutral throughout: never `destructive` and never the accent.
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
  const state = useOverrideReview({ snapshot, busy, savedTimes });
  const {
    review,
    rows,
    disabled,
    pending,
    armed,
    failure,
    refusal,
    done,
    erased,
    unchecked,
    heading,
    doneNotice,
    refusalNotice,
    typeField,
    reasonField,
    discardCancel,
    retryButton,
    confirmButtonOf,
    confirm,
    discard,
    arm,
    armAmend,
    disarm,
    submitAmend,
    clearUnchecked,
    retry,
  } = state;

  /**
   * A confirm or an amend that could not check what it would erase (story
   * 5.5h), so it wrote nothing: said with a retry, which asks the same write
   * again — in the review for a confirm, inside the amend's dialog for an
   * amend. Written once.
   */
  function renderUnchecked(): ReactNode {
    return (
      <Notice id={OVERRIDE_REVIEW_UNCHECKED_ID} role="alert">
        {t('rotation.builder.overrides.erasures.unavailable')}
        <Button
          ref={retryButton}
          className="mt-3 flex h-11"
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={retry}
        >
          {t('rotation.builder.overrides.erasures.retry')}
        </Button>
      </Notice>
    );
  }

  /** What a roster row changes, in the day detail's own terms: who is taken off, who arrives, or both. */
  function rosterChangeOf(row: PendingRosterOverrideRow): string {
    const nobody = t('rotation.builder.overrides.unknownAuthor');
    const out = row.memberOutId === null ? null : (row.memberOutName ?? nobody);
    const arriving = row.memberInId === null ? null : (row.memberInName ?? nobody);

    if (out !== null && arriving !== null) return t('rotation.builder.overrides.roster.replaced', { out, in: arriving });
    if (arriving !== null) return t('rotation.builder.overrides.roster.added', { name: arriving });

    return t('rotation.builder.overrides.roster.removed', { name: out ?? nobody });
  }

  function renderRow(row: ReviewRow): ReactNode {
    const offers = reviewOffersOf(row);

    return (
      <li key={row.id} className="grid min-w-0 gap-2 rounded-md border p-3 text-sm">
        <p className="font-semibold">{t('rotation.builder.overrides.title', { team: row.teamName, date: row.date })}</p>
        <p className="break-words">
          {row.layer === REVIEW_SHIFT_TYPE
            ? t('rotation.builder.overrides.type', { type: row.typeName })
            : rosterChangeOf(row)}
        </p>
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
              ref={confirmButtonOf(row.id)}
              className="h-11"
              type="button"
              variant="outline"
              disabled={disabled}
              onClick={() => {
                void confirm(row);
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
                void armAmend(row);
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

  /** One choice of the amend: a type, or a member to put on. */
  function renderOption(option: DispositionTypeOption): ReactNode {
    return (
      <option key={option.id} value={option.id}>
        {option.name}
      </option>
    );
  }

  /** One group of the amend's choices: a shift-type amend's types as they are, a roster amend's members under their group's label. */
  function renderOptionGroup(group: AmendOptionGroup): ReactNode {
    if (group.kind === AMEND_TYPES) return group.options.map(renderOption);
    if (group.options.length === 0) return null;

    return (
      <optgroup key={group.kind} data-kind={group.kind} label={t(candidateGroupMessageKey(group.kind))}>
        {group.options.map(renderOption)}
      </optgroup>
    );
  }

  /**
   * The amend: a type — or for a roster override, who arrives, in the
   * calendar's candidate groups (0039) — and a reason, in a Dialog that
   * cannot be dismissed while it saves.
   */
  function renderAmend(row: ReviewRow, groups: readonly AmendOptionGroup[], entered: AmendEntered | undefined): ReactNode {
    const reasonRefused = failure === DISPOSITION_REASON;
    const typeRefused = failure !== null && !reasonRefused;
    // What was entered, when the amend is opened again (story 5.5h) and its
    // choice is still offered; else the override's own type when it may be
    // chosen (the first member offered, for a roster override), and its own
    // reason.
    const defaults =
      entered !== undefined && offeredIn(groups, entered.choiceId) ? entered : reviewAmendDefaultsOf(row, groups);
    const roster = row.layer !== REVIEW_SHIFT_TYPE;

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
            {roster
              ? t('rotation.builder.overrides.amendDialog.titleRoster', { team: row.teamName, date: row.date })
              : t('rotation.builder.overrides.amendDialog.title', { team: row.teamName, date: row.date })}
          </DialogTitle>
        </DialogHeader>
        <form
          method="post"
          noValidate
          onSubmit={(event) => {
            submitAmend(event, row, groups);
          }}
          // STORY 5.5h: a field changed, so the refusal to check what was entered before no longer stands.
          onChange={clearUnchecked}
          className="grid gap-4"
        >
          <div className="grid gap-2">
            <Label htmlFor={OVERRIDE_AMEND_TYPE_ID}>
              {roster ? t('rotation.builder.overrides.amendDialog.member') : t('rotation.builder.overrides.amendDialog.type')}
            </Label>
            <Select
              ref={typeField}
              id={OVERRIDE_AMEND_TYPE_ID}
              name="type"
              defaultValue={defaults.choiceId}
              disabled={pending}
              aria-invalid={typeRefused}
              aria-describedby={typeRefused ? OVERRIDE_AMEND_ERROR_ID : undefined}
              className="h-11"
            >
              {groups.map(renderOptionGroup)}
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
          {/* STORY 5.5h: an amend that could not check what it would erase amended nothing. */}
          {unchecked?.kind === DISPOSITION_AMENDED ? renderUnchecked() : null}
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
  function renderDiscard(row: ReviewRow): ReactNode {
    return (
      <ConfirmDialog busy={pending} onCancel={disarm} aria-labelledby={OVERRIDE_DISCARD_PROMPT_ID}>
        <p id={OVERRIDE_DISCARD_PROMPT_ID} className="text-sm font-medium">
          {row.layer !== REVIEW_SHIFT_TYPE
            ? t('rotation.builder.overrides.discardDialog.promptRoster', { team: row.teamName, date: row.date })
            : row.projectedTypeName === null
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
              void discard(row);
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

  /** The dialog armed over the review, if any: the amend (reopened with what was entered) or the discard. */
  function renderArmed(): ReactNode {
    if (armed === null) return null;

    return armed.kind === DISPOSITION_AMENDED
      ? renderAmend(armed.row, armed.groups, armed.entered)
      : renderDiscard(armed.row);
  }

  const notices = (
    <>
      {done === null ? null : (
        <Notice ref={doneNotice} tabIndex={-1} role="status">
          <span className="block">{t(dispositionDoneMessageKey(done))}</span>
          {/* STORY 5.5h: how many conflicts it removed, as confirmed in its erasure confirmation. */}
          {erased === 0 ? null : (
            <span className="mt-2 block">{t('rotation.builder.overrides.erasures.removed', { count: erased })}</span>
          )}
        </Notice>
      )}
      {refusal === null ? null : (
        <Notice ref={refusalNotice} tabIndex={-1} role="alert">
          {t(dispositionMessageKey(refusal))}
        </Notice>
      )}
      {/* STORY 5.5h: a confirm that could not check what it would erase confirmed nothing. */}
      {unchecked?.kind === DISPOSITION_CONFIRMED ? renderUnchecked() : null}
      {review?.ok === false ? <Notice role="alert">{t('rotation.builder.overrides.unavailable')}</Notice> : null}
    </>
  );

  if (rows.length === 0) {
    // The dialogs outlive the list: an amend reopened, or an erasure
    // confirmation still settling, while the review re-reads.
    return (
      <>
        {notices}
        {renderArmed()}
        <ReviewErasureConfirm state={state} />
      </>
    );
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
      {renderArmed()}
      <ReviewErasureConfirm state={state} />
    </>
  );
}

/**
 * THE REVIEW'S ERASURE CONFIRMATION (story 5.5h): the shared `ErasureDialog`
 * in the review's words, opened by a confirm or an amend that would erase a
 * pending conflict. One row per conflict — "{member} na godišnjem · nakon
 * promjene: {team} taj dan slobodna", or for a roster override (0039) "…
 * {team} taj dan bez {member}" — and its own save, "Potvrdi" or
 * "Spremi izmjenu", `aria-disabled` until every row is confirmed. Its rows
 * scroll inside it.
 */
function ReviewErasureConfirm({ state }: { readonly state: OverrideReviewState }): ReactNode {
  const { erasures, pending, backFromErasures, confirmReviewErasures } = state;
  const shown = erasures.shown;

  if (shown === null) return null;

  const { rows } = shown;
  const amending = shown.subject.kind === DISPOSITION_AMENDED;
  const roster = shown.subject.row.layer !== REVIEW_SHIFT_TYPE;
  const partsOf = (row: ErasureRow) => ({
    team: row.teamName,
    weekday: row.weekday,
    date: row.dayMonth,
    type: row.shiftTypeName,
  });

  return (
    <ErasureDialog
      id={OVERRIDE_REVIEW_ERASURES_ID}
      rows={rows}
      changed={shown.changed}
      decisions={erasures.decisions}
      busy={pending}
      firstErasure={erasures.firstErasure}
      // An override can erase the conflict of every member on leave that day.
      scrollRows
      copy={{
        title: t('rotation.builder.overrides.erasures.title', { count: rows.length }),
        lede: amending
          ? t('rotation.builder.overrides.erasures.ledeAmend', { count: rows.length })
          : t('rotation.builder.overrides.erasures.ledeConfirm', { count: rows.length }),
        changed: t('rotation.builder.overrides.erasures.changed'),
        rowTitle: (row) => t('rotation.builder.overrides.erasures.rowTitle', partsOf(row)),
        // A shift-type override never changes who is rostered: "taj dan slobodna".
        // A roster override never makes the team free: "taj dan bez {member}".
        rowDetail: (row) =>
          roster
            ? t('rotation.builder.overrides.erasures.rowWithout', { member: row.memberName, team: row.teamName })
            : t('rotation.builder.overrides.erasures.rowFree', { member: row.memberName, team: row.teamName }),
        decision: (row) => t('rotation.builder.overrides.erasures.decision', partsOf(row)),
        confirm: t('rotation.builder.overrides.erasures.confirm'),
        keep: t('rotation.builder.overrides.erasures.keep'),
        back: t('rotation.builder.overrides.erasures.back'),
        kept: t('rotation.builder.overrides.erasures.kept'),
        save: amending
          ? t('rotation.builder.overrides.amendDialog.save')
          : t('rotation.builder.overrides.erasures.saveConfirm'),
      }}
      onDecide={erasures.decide}
      onBack={backFromErasures}
      onSave={() => {
        void confirmReviewErasures(shown);
      }}
    />
  );
}
