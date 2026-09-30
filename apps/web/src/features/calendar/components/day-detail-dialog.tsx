import type { ReactNode, SyntheticEvent } from 'react';

import { Dialog, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DAY_DETAIL_DIALOG_ID,
  DAY_NO_ROTATION,
  DAY_OFF,
  type DayDetail,
  type DayDetailOverride,
  type DayDetailPendingOverride,
  type DayDetailRosterChange,
  inOptionOf,
  outOptionOf,
  type RosterLineTranslate,
} from '@/features/calendar/utils/day-detail';
import { MODIFIER_OVERRIDDEN, modifierTreatmentOf } from '@/features/calendar/utils/modifiers';
import {
  OverrideDoneNotice,
  OverrideRemoveAction,
  OverrideRemoveConfirm,
  OverrideRemoveRefusal,
  OverrideSetForm,
} from '@/features/calendar/components/override-form';
import {
  RosterDoneNotice,
  RosterRemoveAction,
  RosterRemoveConfirm,
  RosterRemoveRefusal,
  RosterSetForm,
  memberNameShown,
  rosterChangeLine,
} from '@/features/calendar/components/roster-form';
import type { OverrideFormState } from '@/features/calendar/hooks/use-override-form';
import type { RosterFormState } from '@/features/calendar/hooks/use-roster-form';
import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { positionsShown, rosterLineOf, rosterPositionMessageKey } from '@/features/members/utils/position';
import { ranksShown, rosterRankMessageKey } from '@/features/members/utils/rank';
import {
  DAY_DETAIL_HEADING_ID,
  DAY_DETAIL_OVERRIDE_ID,
  DAY_DETAIL_PENDING_ID,
  DAY_DETAIL_ROSTER_CHANGES_ID,
  DAY_DETAIL_ROSTER_ID,
  DAY_DETAIL_ROSTER_INERT_ID,
  DAY_DETAIL_ROSTER_PENDING_ID,
  rosterChangeLineIdOf,
} from '@/features/calendar/utils/element-ids';
import { t } from '@/lib/i18n';

/** The calendar's own `✎` and ring, beside the headings of what changed the day. */
const OVERRIDDEN_TREATMENT = modifierTreatmentOf([MODIFIER_OVERRIDDEN]);

/** The roster, one `Ime · čin · položaj` line per member, rank and position where the organization uses them. */
function renderRoster(shown: DayDetail, usesFireRanks: boolean): ReactNode {
  if (shown.roster.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('kalendar.detail.empty')}</p>;
  }

  const rankShown = ranksShown({ usesFireRanks });
  const positionShown = positionsShown({ usesFireRanks });

  return (
    <ul aria-labelledby={DAY_DETAIL_ROSTER_ID} className="grid gap-2">
      {shown.roster.map((member) => {
        const rankKey = rosterRankMessageKey(member.fireRank, rankShown);
        const positionKey = rosterPositionMessageKey(member.position, positionShown);
        // WHICH SENTENCE is `rosterLineOf`'s decision, executed in a test.
        const line = rosterLineOf(
          member.name ?? t('kalendar.detail.override.unknownAuthor'),
          rankKey,
          positionKey,
          (key) => t(key),
        );

        return (
          <li key={member.id} className="min-w-0 break-words text-base">
            {line.key === null ? line.text : t(line.key, line.values)}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The shift-type override on the day (story 3.5a): what the rotation
 * projects, who saved it, when and why. Its glyph and ring are the
 * calendar's own `✎`, beside the heading that names it; never `destructive`
 * and never the accent.
 */
function renderOverride(override: DayDetailOverride): ReactNode {
  const treatment = OVERRIDDEN_TREATMENT;

  return (
    <section aria-labelledby={DAY_DETAIL_OVERRIDE_ID} className="grid gap-1 text-sm">
      <h3 id={DAY_DETAIL_OVERRIDE_ID} className="flex items-center gap-2 font-heading text-base font-semibold">
        <span
          aria-hidden
          className={`inline-flex size-6 items-center justify-center rounded-sm bg-card text-xs [font-variant-emoji:text] ${treatment.className}`}
        >
          {treatment.glyphText}
        </span>
        {t('kalendar.detail.override.heading')}
      </h3>
      <p>{t('kalendar.detail.override.projected', { type: override.projectedTypeName })}</p>
      <p>
        {t('kalendar.detail.override.author', {
          name: override.authorName ?? t('kalendar.detail.override.unknownAuthor'),
        })}
      </p>
      <p className="tabular-nums">
        {t('kalendar.detail.override.savedAt', { date: override.savedAt.date, time: override.savedAt.time })}
      </p>
      <p className="break-words">{t('kalendar.detail.override.reason', { reason: override.reason })}</p>
    </section>
  );
}

/**
 * An override a rotation change left pending review (story 3.5c): its type,
 * reason and author, said in words. No `✎` and no ring — it is not applied,
 * and the day shows the projection — and never `destructive` or the accent.
 */
function renderPending(pending: DayDetailPendingOverride): ReactNode {
  return (
    <section aria-labelledby={DAY_DETAIL_PENDING_ID} className="grid gap-1 rounded-md border p-3 text-sm">
      <h3 id={DAY_DETAIL_PENDING_ID} className="font-heading text-base font-semibold">
        {t('kalendar.detail.override.pending.heading')}
      </h3>
      <p>{t('kalendar.detail.override.pending.body')}</p>
      <p>{t('kalendar.detail.override.pending.type', { type: pending.typeName })}</p>
      <p className="break-words">{t('kalendar.detail.override.reason', { reason: pending.reason })}</p>
      <p>
        {t('kalendar.detail.override.author', {
          name: pending.authorName ?? t('kalendar.detail.override.unknownAuthor'),
        })}
      </p>
    </section>
  );
}

/** A candidate line's words, through the one `t`. */
const LINE_WORDS: RosterLineTranslate = {
  word: (key) => t(key),
  line: (key, values) => t(key, values),
};

/**
 * The roster changes on the day (story 3.6a), each with its author, time and
 * reason — those applied under "Promjene sastava", with the calendar's own
 * `✎` beside the heading, and those pending review or inert (story 3.6b)
 * under their own heading, with none. Never `destructive` and never the
 * accent. With `form` offering removals (an admin, story 3.6b), each entry
 * carries its own "Ukloni promjenu".
 */
function renderRosterChanges(
  changes: readonly DayDetailRosterChange[],
  headingId: string,
  heading: string,
  marked: boolean,
  roster: RosterFormState,
  overrideBusy: boolean,
): ReactNode {
  if (changes.length === 0) return null;

  const treatment = OVERRIDDEN_TREATMENT;

  return (
    <section aria-labelledby={headingId} className={marked ? 'grid gap-2 text-sm' : 'grid gap-2 rounded-md border p-3 text-sm'}>
      <h3 id={headingId} className="flex items-center gap-2 font-heading text-base font-semibold">
        {marked ? (
          <span
            aria-hidden
            className={`inline-flex size-6 items-center justify-center rounded-sm bg-card text-xs [font-variant-emoji:text] ${treatment.className}`}
          >
            {treatment.glyphText}
          </span>
        ) : null}
        {heading}
      </h3>
      <ul aria-labelledby={headingId} className="grid gap-3">
        {changes.map((change) => (
          <li key={change.id} className="grid gap-1">
            <p id={rosterChangeLineIdOf(change.id)} className="break-words font-semibold">
              {rosterChangeLine(change)}
            </p>
            <p>{t('kalendar.detail.override.author', { name: memberNameShown(change.authorName) })}</p>
            <p className="tabular-nums">
              {t('kalendar.detail.override.savedAt', { date: change.savedAt.date, time: change.savedAt.time })}
            </p>
            <p className="break-words">{t('kalendar.detail.override.reason', { reason: change.reason })}</p>
            {roster.offersRemove ? <RosterRemoveAction form={roster} change={change} busy={overrideBusy} /> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The day detail's body: the type, its times and the roster, or why there is
 * none. A working day and an off day show the override block when the day
 * has one — an off day made a working one, and a working day made an off
 * one, alike. A day with no rotation never has one applied: an override
 * there is pending review (story 3.5c), shown as such on any kind of day.
 */
function renderDetail(
  shown: DayDetail,
  usesFireRanks: boolean,
  form: OverrideFormState,
  roster: RosterFormState,
): ReactNode {
  // STORY 3.5b: an admin sets an override on a day that has none, or removes
  // the one it has; `form` decides which, and neither on a day with no
  // rotation — unless an override is pending review there (story 3.5c), which
  // is shown and offered for removal alone.
  const override = (
    <>
      {shown.override === null ? null : renderOverride(shown.override)}
      {shown.pending === null ? null : renderPending(shown.pending)}
      {renderRosterChanges(
        shown.rosterPending,
        DAY_DETAIL_ROSTER_PENDING_ID,
        t('kalendar.detail.rosterChange.pendingHeading'),
        false,
        roster,
        form.pending,
      )}
      {/* STORY 3.6b: an inert change is the admin's alone to see, and to remove. */}
      {roster.offersRemove
        ? renderRosterChanges(
            shown.rosterInert,
            DAY_DETAIL_ROSTER_INERT_ID,
            t('kalendar.detail.rosterChange.inertHeading'),
            false,
            roster,
            form.pending,
          )
        : null}
      <RosterDoneNotice form={roster} />
      <RosterRemoveRefusal form={roster} />
      <OverrideDoneNotice form={form} />
      <OverrideRemoveRefusal form={form} />
      {form.offersRemove ? <OverrideRemoveAction form={form} busy={roster.pending} /> : null}
      {form.offersSet ? (
        <OverrideSetForm key={`${shown.teamId}:${shown.isoDate}`} form={form} busy={roster.pending} />
      ) : null}
    </>
  );

  if (shown.kind === DAY_OFF) {
    return (
      <div className="grid gap-4">
        <p className="text-sm">{t('kalendar.detail.off', { team: shown.teamName })}</p>
        {override}
      </div>
    );
  }

  if (shown.kind === DAY_NO_ROTATION) {
    return (
      <div className="grid gap-4">
        <p className="text-sm">{t('kalendar.detail.noRotation', { team: shown.teamName })}</p>
        {/* STORY 3.5c: an override on a date no version governs is pending, and can be removed. */}
        {override}
      </div>
    );
  }

  // STORY 3.6b: the roster form's lines show rank and position as the roster does.
  const rankShown = ranksShown({ usesFireRanks });
  const positionShown = positionsShown({ usesFireRanks });

  return (
    <div className="grid gap-4">
      <p className="flex flex-wrap items-baseline gap-x-3 text-base">
        <span className="font-semibold">{shown.typeName}</span>
        {shown.range === null ? null : <span className="tabular-nums">{shown.range}</span>}
      </p>
      <div className="grid gap-2">
        <h3 id={DAY_DETAIL_ROSTER_ID} className="font-heading text-base font-semibold">
          {t('kalendar.detail.roster')}
        </h3>
        {renderRoster(shown, usesFireRanks)}
      </div>
      {renderRosterChanges(
        shown.rosterChanges,
        DAY_DETAIL_ROSTER_CHANGES_ID,
        t('kalendar.detail.rosterChange.heading'),
        true,
        roster,
        form.pending,
      )}
      {/* STORY 3.6b: after the changes, on a working day, the admin's roster form. */}
      {roster.offersSet ? (
        <RosterSetForm
          busy={form.pending}
          key={`${shown.teamId}:${shown.isoDate}:${roster.formKey}`}
          form={roster}
          outOptions={roster.outOptions.map((candidate) => outOptionOf(candidate, rankShown, positionShown, LINE_WORDS))}
          inOptions={roster.inOptions.map((candidate) =>
            inOptionOf(candidate, rankShown, t('kalendar.detail.rosterChange.set.noTeam'), LINE_WORDS),
          )}
        />
      ) : null}
      {override}
    </div>
  );
}

/**
 * ONE DAY (story 3.4b): a read-only Dialog of one team on one date — the
 * type, its times and who is rostered, as `@/features/calendar/utils/day-detail`
 * derives it from the same snapshot, so opening a day reads nothing.
 *
 * ESCAPE CLOSES ON `cancel`, which fires at once, and the late `close` event
 * is `onClosedByBrowser`'s — both through the primitive's own props — so a
 * quick reopen is never closed by the previous one. Passing `onClose` REPLACES
 * the primitive's own `close` handler, so `onOpenChange(false)` reports the
 * backdrop alone and Escape closes the day once, through `onCancel`.
 *
 * NOT DISMISSIBLE WHILE AN OVERRIDE WRITE IS IN FLIGHT (story 3.5b), or a
 * roster write (story 3.6b): the backdrop waits through `dismissible`, and
 * Escape and the close button through the guards below — `onCancel` replaces
 * the primitive's own, so it must refuse the cancel itself. Both removals'
 * confirmations are rendered BESIDE the Dialog, never inside it.
 */
export function DayDetailDialog({
  detail,
  snapshot,
  form,
  roster,
  onClose,
  onClosedByBrowser,
}: {
  readonly detail: DayDetail | null;
  readonly snapshot: CalendarSnapshot | null;
  readonly form: OverrideFormState;
  readonly roster: RosterFormState;
  readonly onClose: () => void;
  readonly onClosedByBrowser: () => void;
}): ReactNode {
  const pending = form.pending || roster.pending;

  function closeUnlessPending(): void {
    if (!pending) onClose();
  }

  return (
    <>
      <Dialog
        id={DAY_DETAIL_DIALOG_ID}
        open={detail !== null}
        dismissible={!pending}
        onOpenChange={(next) => {
          if (!next) closeUnlessPending();
        }}
        onCancel={(event: SyntheticEvent<HTMLDialogElement>) => {
          if (pending) {
            event.preventDefault();

            return;
          }

          onClose();
        }}
        onClose={onClosedByBrowser}
        aria-labelledby={DAY_DETAIL_HEADING_ID}
      >
        {detail === null || snapshot === null ? null : (
          <>
            <DialogHeader closeLabel={t('kalendar.detail.close')} onClose={closeUnlessPending}>
              <DialogTitle id={DAY_DETAIL_HEADING_ID} tabIndex={-1}>{t('kalendar.detail.title', { team: detail.teamName, date: detail.date })}</DialogTitle>
            </DialogHeader>
            {renderDetail(detail, snapshot.usesFireRanks, form, roster)}
          </>
        )}
      </Dialog>
      <OverrideRemoveConfirm form={form} detail={detail} busy={roster.pending} />
      <RosterRemoveConfirm form={roster} busy={form.pending} />
    </>
  );
}
