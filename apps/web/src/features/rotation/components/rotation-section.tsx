import { Info, Rows3 } from 'lucide-react';
import type { ReactNode } from 'react';

import { OfflineNote } from '@/components/offline-note';
import { Button } from '@/components/ui/button';
import { Callout, CalloutBody, CalloutDescription, CalloutTitle } from '@/components/ui/callout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { IconTile } from '@/components/ui/icon-tile';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { SectionNumber } from '@/components/ui/section-number';
import { Select } from '@/components/ui/select';
import { StackedField, StackedFields, StackedList, StackedRow } from '@/components/ui/stacked-list';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { OverrideReview } from '@/features/rotation/components/override-review';
import { RotationHistoryDialog } from '@/features/rotation/components/rotation-history-dialog';
import { RotationNotices } from '@/features/rotation/components/rotation-notices';
import { RotationPatternCard } from '@/features/rotation/components/rotation-pattern-card';
import { RotationPreviewCard } from '@/features/rotation/components/rotation-preview-card';
import { RotationSaveBar } from '@/features/rotation/components/rotation-save-bar';
import { RotationStepActions, RotationStepBar } from '@/features/rotation/components/rotation-stepper';
import { useRotationBuilder } from '@/features/rotation/hooks/use-rotation-builder';
import { rotationHistoryOf } from '@/features/rotation/services/history';
import { rotationTeamsOf } from '@/features/rotation/services/list';
import {
  draftStepRowsOf,
  draftTeamRowsOf,
  latestEffectiveFromOf,
  spreadOfferedOf,
  withOffsetsSpread,
  type RotationDraft,
  type ShiftTypeChip,
} from '@/features/rotation/utils/draft';
import { stepGroupClassOf, stepSectionClassOf } from '@/features/rotation/utils/stepper';
import { usePhone } from '@/hooks/viewport';
import { t } from '@/lib/i18n';
import { useWriteGate } from '@/lib/offline/use-write-gate';

/**
 * The rotation builder (story 2.3b, UX-DR14, UX-DR15), rendered on
 * `/postavke-rotacije` below `Tipovi smjena`, in the same scrolling panel:
 * the pattern with its live figures, the shared anchor date and each active
 * team's step, one cycle's preview from today, and the save.
 *
 * A FILE OF ITS OWN because it reads its own snapshot under `ROTATION_KEY`
 * (AD-13), and the shift type screens are pinned to exactly one query.
 *
 * THE DRAFT IS STATE, THE RULES ARE NOT. It opens as the rotation in force
 * today (`prefillOf`), lives in `@/features/rotation/hooks/draft-store` — outside this
 * component, so the shift type dialog's remount keeps it — and is only ever
 * changed through `@/features/rotation/utils/draft`'s operations. A drag-and-drop reorder
 * (`@dnd-kit`, by the handle only: mouse, touch or keyboard) ends in
 * `withStepMovedTo`, and every word it announces comes from `hr.json`; the figures, the preview, the refusals and the save are all in
 * the `.ts` modules under `@/features/rotation`, which the node suite executes. Nothing here projects,
 * counts a cycle or takes a modulo.
 *
 * A FAILED REFETCH KEEPS THE DRAFT AND THE ROWS, with the message beside them;
 * the save is then refused as unavailable rather than built from rows that may
 * be stale.
 *
 * BELOW `sm`, A STEPPER (story 2.4, UX-DR16), IN CSS ONLY. Every section is
 * always rendered; the one that is not the current step is hidden below `sm`
 * (`stepSectionClassOf`), and the step bar and Natrag / Dalje are `sm:hidden`.
 * One tree at every width: the data, the validations and the order cannot
 * differ, and a step change remounts nothing. The header, the save's note and
 * outcome, the read refusal and the save bar stay outside every step.
 *
 * FROM A DATE FORWARD (story 2.6). `Vrijedi od` sits beside the anchor; the
 * figures, the preview, the checks and the warnings all start on it, and the
 * save writes every version from it. While a change is scheduled the save is
 * refused and, beside that refusal, the change can be cancelled — confirmed in
 * a `ConfirmDialog`, re-reading only `ROTATION_KEY`. `Povijest rotacije`
 * lists every saved change after the step sections, at every width.
 *
 * OVERRIDES UNDER A CHANGE WAIT FOR REVIEW (story 3.5c). A save never writes
 * or removes an override; one dated under a version saved after it is pending,
 * and `Izmjene za pregled`, after the notices, lists each for the admin to
 * confirm, amend or discard. The save's confirmation counts them.
 *
 * A SAVE NEVER QUIETLY ERASES A CONFLICT (story 5.5a). "Spremi rotaciju"
 * first re-reads the calendar, the organization's leave and its resolutions
 * and derives which unresolved conflicts the draft would erase
 * (`@/features/rotation/services/erasures`). None: it saves as it always did.
 * Some: a `ConfirmDialog` lists each, and saving waits until every one is
 * confirmed; the check is derived again before the write, and a changed set
 * is shown again, undecided. A check that cannot be derived refuses the save,
 * with a retry. A draft the save refuses anyway is refused as before, with no
 * check.
 *
 * NOR DOES A CANCEL (story 5.5g). Cancelling the scheduled change reverts its
 * dates to the previous version and brings back the overrides it had made
 * pending, so its confirmation first runs the same check over the snapshot
 * without the cancelled versions (`cancelledCalendarSnapshotOf`). None erased:
 * it cancels as it always did. Some: the confirmation closes and a second,
 * separate erasure dialog lists each; its own confirm re-checks, then cancels.
 * A check that cannot be derived refuses the cancel inside its confirmation,
 * with a retry. A landed cancel re-reads the calendar, the leave and the
 * resolutions beside `ROTATION_KEY`.
 *
 * THE SAVE SITS IN A BAR AT THE END (story 5.5c, mockup `setup-1.html` §2).
 * The one "Spremi rotaciju" moved out of the header into it, with every rule
 * it had. While the admin holds unsaved changes (`unsavedDraftOf`) the bar
 * carries a hint and "Odbaci promjene", which forgets the draft, and from
 * `sm` up it is `sticky` at the viewport's bottom; otherwise, and always on
 * the phone, it sits static at the end of the builder, after the history.
 * CSS only. Like the step actions and the history, it needs a draft.
 *
 * ONE HOOK AND ITS PARTS (epics 5–7 retro A21, A26). The state, the read and
 * every handler are `useRotationBuilder`'s, as the calendar, the member page
 * and the override review keep theirs in hooks; this lays the builder out
 * and draws section 3, and `RotationNotices`, `RotationStepBar`,
 * `RotationPatternCard` (section 2), `RotationPreviewCard` (section 4),
 * `RotationStepActions` and `RotationSaveBar` draw the rest from the hook's
 * result.
 */
export function RotationSection({
  heading,
  shiftTypes,
}: {
  /** The page's title and lede, which the screen owns. */
  readonly heading: ReactNode;
  /** Section 1, the shift types, which the screen owns and this lays out beside section 2. */
  readonly shiftTypes: ReactNode;
}) {
  const builder = useRotationBuilder();
  // STORY 8.3b: the save's write gate, one for the save bar's *Spremi rotaciju*
  // and the unchecked save's retry, so the page draws one note for both.
  const saveGate = useWriteGate();
  const {
    state,
    snapshot,
    today,
    draft,
    shown,
    pending,
    savedTimes,
    change,
    chooseTeamStep,
    chooseAnchor,
    chooseEffectiveFrom,
  } = builder;
  // Below 640 px the offsets table stacks (story 7.6's pattern).
  const isPhone = usePhone();

  function renderChip(chip: ShiftTypeChip): ReactNode {
    return (
      <span className={chip.chipClass}>
        <span className="truncate">{chip.name}</span>
      </span>
    );
  }

  function renderOffsets(current: RotationDraft): ReactNode {
    if (snapshot === null) return null;

    const rows = draftTeamRowsOf(snapshot, current);
    const teams = rotationTeamsOf(snapshot);
    const steps = draftStepRowsOf(snapshot, current);
    // Read once: it titles the card and names the stacked list below 640 px.
    const offsetsHeading = t('rotation.builder.offsetsHeading');

    return (
      <Card className="min-w-0">
        <CardHeader className="flex-row items-start gap-3">
          <SectionNumber value={3} />
          <div className="grid min-w-0 gap-1.5">
            <CardTitle asChild>
              <h2>{offsetsHeading}</h2>
            </CardTitle>
            <CardDescription>{t('rotation.builder.anchorNote')}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 pt-4">
          <Callout>
            <CalloutBody>
              <IconTile variant="primary">
                <Info />
              </IconTile>
              <div className="min-w-0">
                <CalloutTitle>{t('rotation.builder.howTitle')}</CalloutTitle>
                <CalloutDescription>{t('rotation.builder.howBody')}</CalloutDescription>
              </div>
            </CalloutBody>
          </Callout>
          {/* THE EFFECTIVE DATE, THE ANCHOR AND THE SPREAD ON ONE ROW,
              wrapping on a phone. The two dates stay separate: the anchor
              fixes the phase, `Vrijedi od` when it applies. */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid w-full gap-2 sm:w-64">
              <Label htmlFor="rotation-effective-from">{t('rotation.builder.effectiveFrom')}</Label>
              <Input
                id="rotation-effective-from"
                name="effectiveFrom"
                type="date"
                required
                min={today ?? undefined}
                max={(today === null ? null : latestEffectiveFromOf(today)) ?? undefined}
                value={current.effectiveFrom}
                disabled={pending}
                onChange={chooseEffectiveFrom(current)}
                className="h-11 w-full"
              />
            </div>
            <div className="grid w-full gap-2 sm:w-64">
              <Label htmlFor="rotation-anchor">{t('rotation.builder.anchor')}</Label>
              <Input
                id="rotation-anchor"
                name="anchor"
                type="date"
                required
                value={current.anchorDate}
                disabled={pending}
                onChange={chooseAnchor(current)}
                className="h-11 w-full"
              />
            </div>
            {/* OFFERED ONLY WITH A STEP TO SPREAD ONTO; without one the note
                says why. It only fills the draft — nothing is saved. */}
            {spreadOfferedOf(current, teams) ? (
              <Button
                className="h-11"
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  change(withOffsetsSpread(current, teams));
                }}
              >
                <Rows3 aria-hidden />
                {t('rotation.builder.spread')}
              </Button>
            ) : null}
          </div>
          {spreadOfferedOf(current, teams) ? null : (
            <p className="text-sm text-muted-foreground">{t('rotation.builder.offsetsEmpty')}</p>
          )}
        </CardContent>
        {steps.length === 0 ? null : isPhone ? (
          // BELOW 640 px THE ROWS STACK (story 7.6's pattern, UX-DR17), named
          // by the card's heading: the team, its step's picker at full width,
          // and the type it works on the anchor. The picker is the table's
          // own (`renderOffsetPicker`), so its label and id are one.
          <StackedList aria-label={offsetsHeading} className="border-t">
            {rows.map((row) => (
              <StackedRow key={row.team.id}>
                <StackedFields className="flex flex-wrap items-center justify-between gap-2">
                  <StackedField label={t('rotation.builder.columnTeam')} labelHidden>
                    <span className="font-semibold">{row.team.name}</span>
                  </StackedField>
                  {row.onAnchor === null ? null : (
                    <StackedField label={t('rotation.builder.columnOnAnchor')} labelHidden>
                      {renderChip(row.onAnchor)}
                    </StackedField>
                  )}
                </StackedFields>
                {renderOffsetPicker(current, row, steps)}
              </StackedRow>
            ))}
          </StackedList>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('rotation.builder.columnTeam')}</TableHead>
                <TableHead>{t('rotation.builder.columnOffset')}</TableHead>
                <TableHead>{t('rotation.builder.columnOnAnchor')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.team.id}>
                  <TableCell className="font-semibold">{row.team.name}</TableCell>
                  <TableCell>{renderOffsetPicker(current, row, steps)}</TableCell>
                  <TableCell>{row.onAnchor === null ? null : renderChip(row.onAnchor)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    );
  }

  /**
   * A team's step picker, in the offsets table and in its stacked rows alike:
   * one label, one id, one control. Its name is the team's (`offsetOf`), so
   * the picker reads the same in either form.
   */
  function renderOffsetPicker(
    current: RotationDraft,
    row: ReturnType<typeof draftTeamRowsOf>[number],
    steps: ReturnType<typeof draftStepRowsOf>,
  ): ReactNode {
    return (
      <>
        <Label htmlFor={`rotation-offset-${row.team.id}`} className="sr-only">
          {t('rotation.builder.offsetOf', { name: row.team.name })}
        </Label>
        <Select
          id={`rotation-offset-${row.team.id}`}
          name="offset"
          value={String(row.index)}
          disabled={pending}
          onChange={chooseTeamStep(current, row.team.id)}
          className="h-11 min-w-32"
        >
          {steps.map((step) => (
            <option key={step.index} value={String(step.index)}>
              {t('rotation.builder.stepOption', { position: step.position, name: step.chip.name })}
            </option>
          ))}
        </Select>
      </>
    );
  }

  return (
    <>
      <PageHeader>
        {heading}
        {/* STORY 7.18: the history behind a header button, in its own dialog. */}
        {/* NOT GATED ON THE DRAFT: the history reads the snapshot alone, and an
            open dialog must not unmount when a draft is discarded under it. */}
        {snapshot === null || today === null ? null : (
          <RotationHistoryDialog rows={rotationHistoryOf(snapshot, today)} />
        )}
      </PageHeader>
      {/* STORY 8.2d: the page's one as-of note — the shift types decide with
          the builder and add none — while the whole cached snapshot is drawn
          offline. */}
      <OfflineNote offline={builder.offline} />
      {/* THE SAVE'S NOTE AND OUTCOME, right under the header; the save itself
          is in the bar at the end (story 5.5c). */}
      <p className="-mt-3 text-sm text-muted-foreground">{t('rotation.builder.saveNote')}</p>
      <RotationNotices builder={builder} saveGate={saveGate} />
      {/* STORY 3.5c: the overrides a rotation change left pending, after the notices. */}
      <OverrideReview snapshot={snapshot} busy={pending} savedTimes={savedTimes} />
      {draft === null ? null : <RotationStepBar builder={builder} />}
      {/* SECTIONS 1 AND 2 side by side from `lg` up, stacked below it. The
          shift types' table gets the wider share, so it does not scroll; the
          step rows stay one line in the narrower one. Each section sits in a
          wrapper that stays the grid item (`min-w-0`) and is hidden below
          `sm` unless it is the current step; the grid's own wrapper too on
          steps 3 and 4, so an empty grid leaves no gap. */}
      <div className={stepGroupClassOf(shown, [1, 2])}>
        <div className="grid min-w-0 gap-6 lg:grid-cols-[3fr_2fr] lg:items-start" aria-busy={state.loading}>
          <div className={stepSectionClassOf(shown, 1)}>{shiftTypes}</div>
          {draft === null ? null : (
            <div className={stepSectionClassOf(shown, 2)}>
              <RotationPatternCard builder={builder} current={draft} />
            </div>
          )}
        </div>
      </div>
      {draft === null ? null : <div className={stepSectionClassOf(shown, 3)}>{renderOffsets(draft)}</div>}
      {draft === null ? null : (
        <div className={stepSectionClassOf(shown, 4)}>
          <RotationPreviewCard builder={builder} current={draft} />
        </div>
      )}
      {draft === null ? null : <RotationStepActions builder={builder} />}
      {draft === null ? null : <RotationSaveBar builder={builder} current={draft} gate={saveGate} />}
    </>
  );
}
