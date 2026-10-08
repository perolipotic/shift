import { useEffect, type ReactNode, type SyntheticEvent } from 'react';

import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { Select } from '@/components/ui/select';
import { ChangeContextDescription, ChangePreviewOutput } from '@/features/calendar/components/change-preview-output';
import type { RosterFormState } from '@/features/calendar/hooks/use-roster-form';
import { ROSTER_CHANGE_REMOVAL, ROSTER_CHANGE_SAVE } from '@/features/calendar/services/roster-erasures';
import { rosterDoneMessageKey, rosterWriteMessageKey } from '@/features/calendar/services/roster-write';
import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import {
  OVERRIDE_REASON_MAX,
  ROSTER_ADDED,
  ROSTER_NOBODY,
  ROSTER_REFUSED_REASON,
  ROSTER_REMOVED,
  type DayDetail,
  type DayDetailRosterChange,
  type RosterOption,
} from '@/features/calendar/utils/day-detail';
import {
  ROSTER_IN_FIELD_ID,
  ROSTER_ERASURES_ID,
  ROSTER_OUT_FIELD_ID,
  ROSTER_OVERLAP_ID,
  ROSTER_PREVIEW_ID,
  ROSTER_REASON_FIELD_ID,
  ROSTER_REMOVE_ERROR_ID,
  ROSTER_REMOVE_PROMPT_ID,
  ROSTER_SET_ERROR_ID,
  ROSTER_SET_HEADING_ID,
  ROSTER_UNCHECKED_ID,
  describedByOf,
  rosterChangeLineIdOf,
} from '@/features/calendar/utils/element-ids';
import { candidateGroupMessageKey, type CandidateGroupKind } from '@/features/calendar/utils/replacement-candidates';
import { ErasureDialog } from '@/features/conflicts/components/erasure-dialog';
import type { ErasureRow } from '@/features/conflicts/services/erasures';
import { t } from '@/lib/i18n';

/** A member a roster change names, or `unknownAuthor` for one the snapshot does not hold. */
export function memberNameShown(name: string | null): string {
  return name ?? t('kalendar.detail.override.unknownAuthor');
}

/** One roster change's line: added, removed, or replaced (story 3.6a). */
export function rosterChangeLine(change: DayDetailRosterChange): string {
  if (change.kind === ROSTER_ADDED) return t('kalendar.detail.rosterChange.added', { name: memberNameShown(change.inName) });
  if (change.kind === ROSTER_REMOVED) {
    return t('kalendar.detail.rosterChange.removed', { name: memberNameShown(change.outName) });
  }

  return t('kalendar.detail.rosterChange.replaced', {
    out: memberNameShown(change.outName),
    in: memberNameShown(change.inName),
  });
}

/** One "Dolazi" group as the form draws it: its kind, which names it, and its members' lines. */
export interface RosterInOptionGroup {
  readonly kind: CandidateGroupKind;
  readonly options: readonly RosterOption[];
}

/**
 * The roster dialog's lines (story 7.9): those to take off, those to put on in
 * their groups, and those to put on in none — drawn outside any `<optgroup>`.
 * Worded by the day detail, which shows rank and position as the roster does.
 */
export interface RosterDialogOptions {
  readonly out: readonly RosterOption[];
  readonly inGroups: readonly RosterInOptionGroup[];
  readonly inUngrouped: readonly RosterOption[];
}

/**
 * CHANGING A SHIFT'S ROSTER (story 3.6b) — its own dialog since story 7.9 —
 * for an admin alone: "Skida se" and "Dolazi", two native `Select`s of the
 * members the default roster offers, each opening on "— nitko —"
 * ({@link ROSTER_NOBODY}), so nobody is preselected, the reason, and
 * *Što se mijenja* for the members chosen. "Dolazi" draws its members under
 * 5.4c's groups as native `<optgroup>`s — free, working that day, on leave
 * that day — which inform and never block: every member is selectable.
 * Taking off only removes, putting on only adds, and both replace. Every
 * field is uncontrolled, so a refused save keeps them; the refusal is the
 * form's own `Notice`. Neutral: never `destructive` and never the accent.
 * The lines each option reads are the day detail's to word. A member chosen
 * in "Dolazi" who already works an overlapping shift gets a neutral hint
 * beside the field, announced politely; saving is unchanged (Epic 4 retro C2).
 */
export function RosterSetForm({
  form,
  busy,
  snapshot,
  options,
}: {
  readonly form: RosterFormState;
  /** The override form's write is in flight: nothing here may start one. */
  readonly busy: boolean;
  readonly snapshot: CalendarSnapshot | null;
  readonly options: RosterDialogOptions;
}): ReactNode {
  const {
    outField,
    inField,
    rosterReasonField,
    pending,
    failure,
    saveRoster,
    overlap,
    chooseIn,
    chooseOut,
    preview,
    saveButton,
    unchecked,
    clearUnchecked,
    closeChange,
  } = form;
  const reasonRefused = failure === ROSTER_REFUSED_REASON;
  const memberRefused = failure !== null && !reasonRefused;
  // EPIC 4 RETRO C2: every mount starts from what the "Dolazi" `Select`
  // shows, and an unmounted form chooses nobody, so the hint never outlives
  // it — nor, since story 7.9, the preview, which "Skida se" feeds too.
  useEffect(() => {
    chooseIn(inField.current?.value ?? ROSTER_NOBODY);
    chooseOut(outField.current?.value ?? ROSTER_NOBODY);

    return () => {
      chooseIn(ROSTER_NOBODY);
      chooseOut(ROSTER_NOBODY);
    };
  }, [chooseIn, chooseOut, inField, outField]);

  const inDescribedBy = describedByOf(
    memberRefused ? ROSTER_SET_ERROR_ID : null,
    overlap === null ? null : ROSTER_OVERLAP_ID,
  );
  // STORY 7.9: a group with nobody in it says nothing, so it is not drawn.
  const groupsShown = options.inGroups.filter((group) => group.options.length !== 0);

  return (
    <form
      method="post"
      noValidate
      onSubmit={(event) => {
        void saveRoster(event);
      }}
      // STORY 5.5b: a field changed, so the refusal to check what was entered before no longer stands.
      onChange={clearUnchecked}
      className="grid gap-4"
    >
      <div className="grid gap-2">
        <Label htmlFor={ROSTER_OUT_FIELD_ID}>{t('kalendar.detail.rosterChange.set.out')}</Label>
        <Select
          ref={outField}
          id={ROSTER_OUT_FIELD_ID}
          name="out"
          defaultValue={ROSTER_NOBODY}
          disabled={pending}
          aria-invalid={memberRefused}
          aria-describedby={memberRefused ? ROSTER_SET_ERROR_ID : undefined}
          className="h-11"
          onChange={(event) => {
            chooseOut(event.target.value);
          }}
        >
          <option value={ROSTER_NOBODY}>{t('kalendar.detail.rosterChange.set.none')}</option>
          {options.out.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="grid gap-2">
        <Label htmlFor={ROSTER_IN_FIELD_ID}>{t('kalendar.detail.rosterChange.set.in')}</Label>
        <Select
          ref={inField}
          id={ROSTER_IN_FIELD_ID}
          name="in"
          defaultValue={ROSTER_NOBODY}
          disabled={pending}
          aria-invalid={memberRefused}
          aria-describedby={inDescribedBy}
          className="h-11"
          onChange={(event) => {
            chooseIn(event.target.value);
          }}
        >
          <option value={ROSTER_NOBODY}>{t('kalendar.detail.rosterChange.set.none')}</option>
          {/* Those in no group — every one while the leave is not read — outside any group. */}
          {options.inUngrouped.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
          {groupsShown.map((group) => (
            <optgroup key={group.kind} data-kind={group.kind} label={t(candidateGroupMessageKey(group.kind))}>
              {group.options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
        {/*
          EPIC 4 RETRO C2: a double booking is warned of, neutrally, and never
          refused. The live region stays in the accessibility tree, empty
          while there is nothing to say, so its text is announced when it
          fills; only the text toggles.
        */}
        <p id={ROSTER_OVERLAP_ID} role="status" className="text-sm">
          {overlap === null
            ? null
            : t('kalendar.detail.rosterChange.set.overlap', {
                name: overlap.memberName,
                team: overlap.teamName,
                day: overlap.day,
                range: overlap.range,
              })}
        </p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor={ROSTER_REASON_FIELD_ID}>{t('kalendar.detail.rosterChange.set.reason')}</Label>
        <Input
          ref={rosterReasonField}
          id={ROSTER_REASON_FIELD_ID}
          name="reason"
          type="text"
          required
          maxLength={OVERRIDE_REASON_MAX}
          autoComplete="off"
          readOnly={pending}
          aria-invalid={reasonRefused}
          aria-describedby={reasonRefused ? ROSTER_SET_ERROR_ID : undefined}
          className="h-11 w-full"
        />
      </div>
      <ChangePreviewOutput id={ROSTER_PREVIEW_ID} preview={preview} snapshot={snapshot} />
      {failure === null ? null : (
        <Notice id={ROSTER_SET_ERROR_ID} role="alert">
          {t(rosterWriteMessageKey(failure))}
        </Notice>
      )}
      {/* STORY 5.5b: a save that could not check what it would erase saved nothing. */}
      {unchecked === ROSTER_CHANGE_SAVE ? <RosterUnchecked form={form} busy={busy} /> : null}
      <DialogFooter>
        <Button className="h-11" type="button" variant="outline" disabled={pending} onClick={closeChange}>
          {t('kalendar.detail.rosterChange.set.cancel')}
        </Button>
        <Button
          ref={saveButton}
          className="h-11"
          type="submit"
          disabled={pending || busy}
          aria-busy={pending}
          aria-describedby={describedByOf(preview === null ? null : ROSTER_PREVIEW_ID)}
        >
          {pending ? t('kalendar.detail.rosterChange.set.saving') : t('kalendar.detail.rosterChange.set.save')}
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * "PROMIJENI SASTAV" (story 7.9): the roster form in its own small dialog,
 * opened from the day detail's footer and rendered BESIDE it, on the type
 * dialog's terms. Its description names the team, the date and the type with
 * its times. The form — and its lines, `optionsOf`, worded by the day detail —
 * is drawn only while it is open, and starts afresh after a save (`formKey`),
 * since the members it named are no longer offered.
 */
export function RosterChangeDialog({
  form,
  detail,
  snapshot,
  busy,
  optionsOf,
}: {
  readonly form: RosterFormState;
  readonly detail: DayDetail | null;
  readonly snapshot: CalendarSnapshot | null;
  /** The override form's write is in flight. */
  readonly busy: boolean;
  /** The dialog's lines, worked out only while it is open. */
  readonly optionsOf: () => RosterDialogOptions;
}): ReactNode {
  const { changing, pending, closeChange, formKey } = form;

  return (
    <Dialog
      open={changing && detail !== null}
      dismissible={!pending}
      onOpenChange={(next) => {
        if (!next) closeChange();
      }}
      // ESCAPE, AS THE DAY DETAIL'S: the cancel is refused here, and the
      // dialog closes through the screen's state, never while a write is in flight.
      onCancel={(event: SyntheticEvent<HTMLDialogElement>) => {
        event.preventDefault();
        if (!pending) closeChange();
      }}
      aria-labelledby={ROSTER_SET_HEADING_ID}
    >
      {!changing || detail === null ? null : (
        <>
          <DialogHeader
            closeLabel={t('kalendar.detail.rosterChange.set.close')}
            onClose={() => {
              if (!pending) closeChange();
            }}
          >
            <DialogTitle id={ROSTER_SET_HEADING_ID}>{t('kalendar.detail.rosterChange.set.heading')}</DialogTitle>
            <ChangeContextDescription detail={detail} />
          </DialogHeader>
          <RosterSetForm
            key={`${detail.teamId}:${detail.isoDate}:${String(formKey)}`}
            form={form}
            busy={busy}
            snapshot={snapshot}
            options={optionsOf()}
          />
        </>
      )}
    </Dialog>
  );
}

/**
 * The day stopped offering the roster form while its dialog was open (story
 * 7.9) — another admin made it a day off, or the team was archived — so the
 * dialog closed, and the day detail says why.
 */
export function RosterFormLostNotice({ form }: { readonly form: RosterFormState }): ReactNode {
  if (!form.formLost) return null;

  return <Notice role="alert">{t('kalendar.detail.rosterChange.refused.notOffered')}</Notice>;
}

/** The admin's way to remove one listed roster change: it opens the confirmation. */
export function RosterRemoveAction({
  form,
  change,
  busy,
}: {
  readonly form: RosterFormState;
  /** The override form's write is in flight. */
  readonly busy: boolean;
  readonly change: DayDetailRosterChange;
}): ReactNode {
  const { removeActionRef, pending, openRemove } = form;

  return (
    <div>
      <Button
        ref={removeActionRef(change.id)}
        className="h-11"
        type="button"
        variant="outline"
        disabled={pending || busy}
        aria-describedby={rosterChangeLineIdOf(change.id)}
        onClick={() => {
          openRemove(change.id);
        }}
      >
        {t('kalendar.detail.rosterChange.remove.action')}
      </Button>
    </div>
  );
}

/**
 * A removal refused once its confirmation has closed (`gone`: the change was
 * removed meanwhile), said in the day detail itself.
 */
export function RosterRemoveRefusal({ form }: { readonly form: RosterFormState }): ReactNode {
  const { confirming, removeFailure } = form;

  if (confirming || removeFailure === null) return null;

  return (
    <Notice id={ROSTER_REMOVE_ERROR_ID} role="alert">
      {t(rosterWriteMessageKey(removeFailure))}
    </Notice>
  );
}

/**
 * A write that could not check what it would erase (story 5.5b), so it wrote
 * nothing: said with a retry, which asks the same write again.
 */
function RosterUnchecked({ form, busy }: { readonly form: RosterFormState; readonly busy: boolean }): ReactNode {
  const { pending, retryButton, retry } = form;

  return (
    <Notice id={ROSTER_UNCHECKED_ID} role="alert">
      {t('kalendar.detail.rosterChange.erasures.unavailable')}
      <Button
        ref={retryButton}
        className="mt-3 flex h-11"
        type="button"
        variant="outline"
        disabled={pending || busy}
        onClick={retry}
      >
        {t('kalendar.detail.rosterChange.erasures.retry')}
      </Button>
    </Notice>
  );
}

/**
 * A write that landed (story 3.6b), said in the day detail as a `role="status"`
 * Notice — and, since story 5.5b, how many conflicts it removed, as confirmed
 * in its erasure confirmation.
 */
export function RosterDoneNotice({ form }: { readonly form: RosterFormState }): ReactNode {
  const { done, erased } = form;

  if (done === null) return null;

  return (
    <Notice role="status">
      <span className="block">{t(rosterDoneMessageKey(done))}</span>
      {erased === 0 ? null : (
        <span className="mt-2 block">{t('kalendar.detail.rosterChange.erasures.removed', { count: erased })}</span>
      )}
    </Notice>
  );
}

/**
 * REMOVING A ROSTER CHANGE (story 3.6b): one neutral modal confirmation that
 * names the change, the team and the date, and says the roster returns to the
 * rotation. Rendered BESIDE the day detail, never inside it. While the
 * removal is in flight nothing dismisses it.
 */
export function RosterRemoveConfirm({
  form,
  busy,
}: {
  readonly form: RosterFormState;
  /** The override form's write is in flight. */
  readonly busy: boolean;
}): ReactNode {
  const { target, pending, removeFailure, removeCancel, cancelRemove, removeChange } = form;

  if (target === null) return null;

  return (
    <ConfirmDialog busy={pending} onCancel={cancelRemove} aria-labelledby={ROSTER_REMOVE_PROMPT_ID}>
      <p id={ROSTER_REMOVE_PROMPT_ID} className="text-sm font-medium">
        {t('kalendar.detail.rosterChange.remove.prompt', {
          change: rosterChangeLine(target.change),
          team: target.teamName,
          date: target.date,
        })}
      </p>
      {removeFailure === null ? null : (
        <Notice id={ROSTER_REMOVE_ERROR_ID} role="alert">
          {t(rosterWriteMessageKey(removeFailure))}
        </Notice>
      )}
      {/* STORY 5.5b: a removal that could not check what it would erase removed nothing. */}
      {form.unchecked === ROSTER_CHANGE_REMOVAL ? <RosterUnchecked form={form} busy={busy} /> : null}
      <DialogFooter>
        <Button
          ref={removeCancel}
          className="h-11"
          type="button"
          variant="outline"
          disabled={pending || busy}
          onClick={cancelRemove}
        >
          {t('kalendar.detail.rosterChange.remove.cancel')}
        </Button>
        <Button
          className="h-11"
          type="button"
          disabled={pending || busy}
          aria-busy={pending}
          aria-describedby={removeFailure === null ? undefined : ROSTER_REMOVE_ERROR_ID}
          onClick={() => {
            void removeChange();
          }}
        >
          {pending
            ? t('kalendar.detail.rosterChange.remove.removing')
            : t('kalendar.detail.rosterChange.remove.confirm')}
        </Button>
      </DialogFooter>
    </ConfirmDialog>
  );
}

/**
 * A ROSTER CHANGE'S ERASURE CONFIRMATION (story 5.5b): the shared
 * `ErasureDialog` in the calendar's words, rendered BESIDE the day detail as
 * the removal's confirmation is. One row per conflict the change would
 * erase — "{member} na godišnjem · nakon promjene: {team} taj dan bez
 * {member}" — and its own save: "Spremi promjenu" for a save, "Ukloni" for a
 * removal, `aria-disabled` until every row is confirmed. A removal's lede and
 * kept hint say so in its own words. "Natrag na
 * uređivanje" returns to the form with its inputs kept, or to the day detail.
 */
export function RosterErasureConfirm({
  form,
  busy,
}: {
  readonly form: RosterFormState;
  /** The override form's write is in flight. */
  readonly busy: boolean;
}): ReactNode {
  const { erasures, pending, confirmErasures } = form;
  const shown = erasures.shown;

  if (shown === null) return null;

  const { rows } = shown;
  const removal = shown.subject.kind === ROSTER_CHANGE_REMOVAL;
  const partsOf = (row: ErasureRow) => ({
    team: row.teamName,
    weekday: row.weekday,
    date: row.dayMonth,
    type: row.shiftTypeName,
  });

  return (
    <ErasureDialog
      id={ROSTER_ERASURES_ID}
      rows={rows}
      changed={shown.changed}
      decisions={erasures.decisions}
      busy={pending || busy}
      firstErasure={erasures.firstErasure}
      copy={{
        title: t('kalendar.detail.rosterChange.erasures.title', { count: rows.length }),
        lede: removal
          ? t('kalendar.detail.rosterChange.erasures.ledeRemoval', { count: rows.length })
          : t('kalendar.detail.rosterChange.erasures.lede', { count: rows.length }),
        changed: t('kalendar.detail.rosterChange.erasures.changed'),
        rowTitle: (row) => t('kalendar.detail.rosterChange.erasures.rowTitle', partsOf(row)),
        // ALWAYS "TAJ DAN BEZ": a roster change never changes whether the
        // team works that day — the shift type is the rotation's and its
        // overrides' — so `teamWorks` is true on every row here, and the
        // rotation's "taj dan slobodna" has no calendar twin.
        rowDetail: (row) =>
          t('kalendar.detail.rosterChange.erasures.rowWithout', { member: row.memberName, team: row.teamName }),
        decision: (row) => t('kalendar.detail.rosterChange.erasures.decision', partsOf(row)),
        confirm: t('kalendar.detail.rosterChange.erasures.confirm'),
        keep: t('kalendar.detail.rosterChange.erasures.keep'),
        back: t('kalendar.detail.rosterChange.erasures.back'),
        kept: removal
          ? t('kalendar.detail.rosterChange.erasures.keptRemoval')
          : t('kalendar.detail.rosterChange.erasures.kept'),
        save: removal
            ? t('kalendar.detail.rosterChange.remove.confirm')
            : t('kalendar.detail.rosterChange.set.save'),
      }}
      onDecide={erasures.decide}
      onBack={erasures.close}
      onSave={() => {
        void confirmErasures(shown);
      }}
    />
  );
}
