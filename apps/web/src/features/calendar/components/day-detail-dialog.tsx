import { Link } from '@tanstack/react-router';
import type { ReactNode, SyntheticEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DAY_DETAIL_DIALOG_ID,
  DAY_NO_ROTATION,
  DAY_OFF,
  type DayConflict,
  type DayDetail,
  type DayDetailOverride,
  type DayDetailPendingOverride,
  type DayDetailRosterChange,
  type RosterInCandidate,
  inOptionOf,
  outOptionOf,
  type RosterLineTranslate,
} from '@/features/calendar/utils/day-detail';
import { MODIFIER_CONFLICT, MODIFIER_OVERRIDDEN, modifierTreatmentOf } from '@/features/calendar/utils/modifiers';
import {
  OverrideChangeDialog,
  OverrideDoneNotice,
  OverrideErasureConfirm,
  OverrideRemoveAction,
  OverrideRemoveConfirm,
  OverrideRemoveRefusal,
  OverrideSetRefusal,
} from '@/features/calendar/components/override-form';
import {
  RosterChangeDialog,
  RosterDoneNotice,
  RosterFormLostNotice,
  RosterErasureConfirm,
  RosterRemoveAction,
  RosterRemoveConfirm,
  RosterRemoveRefusal,
  memberNameShown,
  rosterChangeLine,
  type RosterDialogOptions,
} from '@/features/calendar/components/roster-form';
import type { OverrideFormState } from '@/features/calendar/hooks/use-override-form';
import type { RosterFormState } from '@/features/calendar/hooks/use-roster-form';
import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { positionsShown, rosterLineOf, rosterPositionMessageKey } from '@/features/members/utils/position';
import { ranksShown, rosterRankMessageKey } from '@/features/members/utils/rank';
import {
  DAY_DETAIL_CHANGES_ID,
  DAY_DETAIL_CONFLICTS_ID,
  DAY_DETAIL_HEADING_ID,
  DAY_DETAIL_OVERRIDE_ID,
  DAY_DETAIL_PENDING_ID,
  DAY_DETAIL_ROSTER_CHANGES_ID,
  DAY_DETAIL_ROSTER_ID,
  DAY_DETAIL_ROSTER_INERT_ID,
  DAY_DETAIL_ROSTER_PENDING_ID,
  conflictLineIdOf,
  rosterChangeLineIdOf,
} from '@/features/calendar/utils/element-ids';
import { t } from '@/lib/i18n';

/** The calendar's own `✎` and ring, beside the headings of what changed the day. */
const OVERRIDDEN_TREATMENT = modifierTreatmentOf([MODIFIER_OVERRIDDEN]);

/** The calendar's own `⚠` and ring (story 7.9), beside the heading of the day's unresolved conflicts. */
const CONFLICT_TREATMENT = modifierTreatmentOf([MODIFIER_CONFLICT]);

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

/** A mark's glyph and ring beside a heading, as the calendar's cell draws it: `✎` by default. */
function renderMark(treatment = OVERRIDDEN_TREATMENT): ReactNode {
  return (
    <span
      aria-hidden
      className={`inline-flex size-6 items-center justify-center rounded-sm bg-card text-xs [font-variant-emoji:text] ${treatment.className}`}
    >
      {treatment.glyphText}
    </span>
  );
}

/**
 * The shift-type override on the day (story 3.5a): what the rotation
 * projects, who saved it, when and why — and, for an admin, its "Ukloni
 * izmjenu" (story 3.5b), which opens the neutral confirmation. Its glyph and
 * ring are the calendar's own `✎`, beside the heading that names it.
 */
function renderOverride(override: DayDetailOverride, form: OverrideFormState, roster: RosterFormState): ReactNode {
  return (
    <section aria-labelledby={DAY_DETAIL_OVERRIDE_ID} className="grid gap-1 text-sm">
      <h4 id={DAY_DETAIL_OVERRIDE_ID} className="flex items-center gap-2 font-heading text-base font-semibold">
        {renderMark()}
        {t('kalendar.detail.override.heading')}
      </h4>
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
      {form.offersRemove ? <OverrideRemoveAction form={form} busy={roster.pending} /> : null}
    </section>
  );
}

/**
 * An override a rotation change left pending review (story 3.5c): its type,
 * reason and author, said in words, and its removal for an admin. No `✎` and
 * no ring — it is not applied, and the day shows the projection.
 */
function renderPending(pending: DayDetailPendingOverride, form: OverrideFormState, roster: RosterFormState): ReactNode {
  return (
    <section aria-labelledby={DAY_DETAIL_PENDING_ID} className="grid gap-1 rounded-md border p-3 text-sm">
      <h4 id={DAY_DETAIL_PENDING_ID} className="font-heading text-base font-semibold">
        {t('kalendar.detail.override.pending.heading')}
      </h4>
      <p>{t('kalendar.detail.override.pending.body')}</p>
      <p>{t('kalendar.detail.override.pending.type', { type: pending.typeName })}</p>
      <p className="break-words">{t('kalendar.detail.override.reason', { reason: pending.reason })}</p>
      <p>
        {t('kalendar.detail.override.author', {
          name: pending.authorName ?? t('kalendar.detail.override.unknownAuthor'),
        })}
      </p>
      {form.offersRemove ? <OverrideRemoveAction form={form} busy={roster.pending} /> : null}
    </section>
  );
}

/** A candidate line's words, through the one `t`. */
const LINE_WORDS: RosterLineTranslate = {
  word: (key) => t(key),
  line: (key, values) => t(key, values),
};

/**
 * Roster changes on the day (story 3.6a), each with its author, time and
 * reason — those applied under "Promjene sastava", with the calendar's own
 * `✎` beside the heading, and those pending review or inert (story 3.6b)
 * under their own heading, with none. With removals offered (an admin), each
 * entry carries its own "Ukloni promjenu", which opens the neutral
 * confirmation.
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

  return (
    <section aria-labelledby={headingId} className={marked ? 'grid gap-2 text-sm' : 'grid gap-2 rounded-md border p-3 text-sm'}>
      <h4 id={headingId} className="flex items-center gap-2 font-heading text-base font-semibold">
        {marked ? renderMark() : null}
        {heading}
      </h4>
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
 * *IZMJENE* (story 7.9): every change on the day — the shift-type override
 * or the one pending review, and the roster changes applied, pending and (an
 * admin's alone) inert — each with its own "Ukloni" for an admin; or, with
 * none, the sentence that says so.
 */
function renderChanges(shown: DayDetail, form: OverrideFormState, roster: RosterFormState): ReactNode {
  // STORY 3.6b: an inert change is the admin's alone to see, and to remove.
  const inert = roster.offersRemove ? shown.rosterInert : [];
  const none =
    shown.override === null &&
    shown.pending === null &&
    shown.rosterChanges.length === 0 &&
    shown.rosterPending.length === 0 &&
    inert.length === 0;

  return (
    <section aria-labelledby={DAY_DETAIL_CHANGES_ID} className="grid gap-3">
      <h3 id={DAY_DETAIL_CHANGES_ID} className="font-heading text-base font-semibold">
        {t('kalendar.detail.changes.heading')}
      </h3>
      {none ? <p className="text-sm text-muted-foreground">{t('kalendar.detail.changes.empty')}</p> : null}
      {shown.override === null ? null : renderOverride(shown.override, form, roster)}
      {shown.pending === null ? null : renderPending(shown.pending, form, roster)}
      {renderRosterChanges(
        shown.rosterChanges,
        DAY_DETAIL_ROSTER_CHANGES_ID,
        t('kalendar.detail.rosterChange.heading'),
        true,
        roster,
        form.pending,
      )}
      {renderRosterChanges(
        shown.rosterPending,
        DAY_DETAIL_ROSTER_PENDING_ID,
        t('kalendar.detail.rosterChange.pendingHeading'),
        false,
        roster,
        form.pending,
      )}
      {renderRosterChanges(
        inert,
        DAY_DETAIL_ROSTER_INERT_ID,
        t('kalendar.detail.rosterChange.inertHeading'),
        false,
        roster,
        form.pending,
      )}
    </section>
  );
}

/**
 * THE DAY'S UNRESOLVED CONFLICTS (story 7.9), an admin's alone: each member
 * on leave who is rostered on the shift, the leave's dates, and "Riješi
 * konflikt" to that conflict's decision screen. Its heading carries the
 * calendar's own `⚠` and ring, the one treatment an unresolved conflict
 * has; the glyph is beside words, never alone.
 */
function renderConflicts(conflicts: readonly DayConflict[]): ReactNode {
  if (conflicts.length === 0) return null;

  return (
    <section
      aria-labelledby={DAY_DETAIL_CONFLICTS_ID}
      className="grid gap-3 rounded-md border p-3 text-sm"
    >
      <h3 id={DAY_DETAIL_CONFLICTS_ID} className="flex items-center gap-2 font-heading text-base font-semibold">
        {renderMark(CONFLICT_TREATMENT)}
        {t('kalendar.detail.conflict.heading', { count: conflicts.length })}
      </h3>
      <ul aria-labelledby={DAY_DETAIL_CONFLICTS_ID} className="grid gap-3">
        {conflicts.map((conflict) => (
          <li key={conflict.memberId} className="grid min-w-0 gap-2">
            <p id={conflictLineIdOf(conflict.memberId)} className="break-words tabular-nums">
              {conflict.leaveFrom === null || conflict.leaveTo === null
                ? t('kalendar.detail.conflict.lineUndated', {
                    name: conflict.memberName ?? t('kalendar.detail.unknownMember'),
                  })
                : t('kalendar.detail.conflict.line', {
                    name: conflict.memberName ?? t('kalendar.detail.unknownMember'),
                    from: conflict.leaveFrom,
                    to: conflict.leaveTo,
                  })}
            </p>
            <Button asChild variant="outline" className="h-11 justify-self-start">
              <Link
                to="/raspored/$memberId/$date/$teamId"
                params={{ memberId: conflict.memberId, date: conflict.date, teamId: conflict.teamId }}
                aria-describedby={conflictLineIdOf(conflict.memberId)}
              >
                {t('kalendar.detail.conflict.resolve')}
              </Link>
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The day detail's body (story 7.9: facts only, no form): the type and its
 * times — or why there is none — the day's unresolved conflicts for an admin,
 * the roster, *Izmjene*, and what the last write said. A day with no rotation
 * never has an override applied: one there is pending review (story 3.5c).
 */
function renderDetail(
  shown: DayDetail,
  usesFireRanks: boolean,
  conflicts: readonly DayConflict[],
  form: OverrideFormState,
  roster: RosterFormState,
): ReactNode {
  const said = (
    <>
      <RosterDoneNotice form={roster} />
      <RosterRemoveRefusal form={roster} />
      <RosterFormLostNotice form={roster} />
      <OverrideDoneNotice form={form} />
      <OverrideRemoveRefusal form={form} />
      <OverrideSetRefusal form={form} />
    </>
  );

  if (shown.kind === DAY_OFF || shown.kind === DAY_NO_ROTATION) {
    return (
      <div className="grid gap-4">
        <p className="text-sm">
          {shown.kind === DAY_OFF
            ? t('kalendar.detail.off', { team: shown.teamName })
            : t('kalendar.detail.noRotation', { team: shown.teamName })}
        </p>
        {renderConflicts(conflicts)}
        {renderChanges(shown, form, roster)}
        {said}
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <p className="flex flex-wrap items-baseline gap-x-3 text-base">
        <span className="font-semibold">{shown.typeName}</span>
        {shown.range === null ? null : <span className="tabular-nums">{shown.range}</span>}
      </p>
      {renderConflicts(conflicts)}
      <div className="grid gap-2">
        <h3 id={DAY_DETAIL_ROSTER_ID} className="font-heading text-base font-semibold">
          {t('kalendar.detail.roster')}
        </h3>
        {renderRoster(shown, usesFireRanks)}
      </div>
      {renderChanges(shown, form, roster)}
      {said}
    </div>
  );
}

/**
 * The day detail's footer (story 7.9), an admin's alone: "Promijeni sastav"
 * on a working day and "Promijeni tip smjene" where a type may be set, each
 * opening its own dialog. Nothing here starts a write.
 */
function renderFooter(form: OverrideFormState, roster: RosterFormState): ReactNode {
  if (!roster.offersSet && !form.offersSet) return null;

  const busy = form.pending || roster.pending;

  return (
    <DialogFooter>
      {roster.offersSet ? (
        <Button
          ref={roster.openButton}
          className="h-11"
          type="button"
          variant="outline"
          aria-haspopup="dialog"
          disabled={busy}
          onClick={roster.openChange}
        >
          {t('kalendar.detail.rosterChange.set.heading')}
        </Button>
      ) : null}
      {form.offersSet ? (
        <Button
          ref={form.openButton}
          className="h-11"
          type="button"
          variant="outline"
          aria-haspopup="dialog"
          disabled={busy}
          onClick={form.openChange}
        >
          {t('kalendar.detail.override.set.heading')}
        </Button>
      ) : null}
    </DialogFooter>
  );
}

/**
 * ONE DAY (story 3.4b): a Dialog of one team on one date — the type, its
 * times and who is rostered, as `@/features/calendar/utils/day-detail`
 * derives it from the same snapshot, so opening a day reads nothing. FACTS
 * ONLY since story 7.9: no form inside; each change opens its own dialog
 * from the footer, rendered BESIDE this one with the confirmations.
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
 * the primitive's own, so it must refuse the cancel itself.
 */
export function DayDetailDialog({
  detail,
  snapshot,
  conflicts,
  form,
  roster,
  onClose,
  onClosedByBrowser,
}: {
  readonly detail: DayDetail | null;
  readonly snapshot: CalendarSnapshot | null;
  /** The day's unresolved conflicts (story 7.9): an admin's marks', none for a member. */
  readonly conflicts: readonly DayConflict[];
  readonly form: OverrideFormState;
  readonly roster: RosterFormState;
  readonly onClose: () => void;
  readonly onClosedByBrowser: () => void;
}): ReactNode {
  const pending = form.pending || roster.pending;

  /**
   * STORY 3.6b: the roster dialog's lines show rank and position as the
   * roster does. Story 7.9: worked out only while that dialog is open, which
   * calls this.
   */
  function rosterOptionsOf(): RosterDialogOptions {
    const usesFireRanks = snapshot?.usesFireRanks ?? false;
    const rankShown = ranksShown({ usesFireRanks });
    const positionShown = positionsShown({ usesFireRanks });
    const inOption = (candidate: RosterInCandidate) =>
      inOptionOf(candidate, rankShown, t('kalendar.detail.rosterChange.set.noTeam'), LINE_WORDS);

    return {
      out: roster.outOptions.map((candidate) => outOptionOf(candidate, rankShown, positionShown, LINE_WORDS)),
      inGroups: roster.inGroups.map((group) => ({ kind: group.kind, options: group.candidates.map(inOption) })),
      inUngrouped: roster.inUngrouped.map(inOption),
    };
  }

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
            {renderDetail(detail, snapshot.usesFireRanks, conflicts, form, roster)}
            {renderFooter(form, roster)}
          </>
        )}
      </Dialog>
      <OverrideChangeDialog form={form} detail={detail} snapshot={snapshot} busy={roster.pending} />
      <RosterChangeDialog
        form={roster}
        detail={detail}
        snapshot={snapshot}
        busy={form.pending}
        optionsOf={rosterOptionsOf}
      />
      <OverrideRemoveConfirm form={form} detail={detail} busy={roster.pending} />
      <RosterRemoveConfirm form={roster} busy={form.pending} />
      <RosterErasureConfirm form={roster} busy={form.pending} />
      <OverrideErasureConfirm form={form} busy={roster.pending} />
    </>
  );
}
