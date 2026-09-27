import type { ReactNode, SyntheticEvent } from 'react';

import { Dialog, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DAY_DETAIL_DIALOG_ID,
  DAY_NO_ROTATION,
  DAY_OFF,
  type DayDetail,
  type DayDetailOverride,
} from '@/features/calendar/utils/day-detail';
import { MODIFIER_OVERRIDDEN, modifierTreatmentOf } from '@/features/calendar/utils/modifiers';
import {
  OverrideRemoveAction,
  OverrideRemoveConfirm,
  OverrideRemoveRefusal,
  OverrideSetForm,
} from '@/features/calendar/components/override-form';
import type { OverrideFormState } from '@/features/calendar/hooks/use-override-form';
import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { positionsShown, rosterLineOf, rosterPositionMessageKey } from '@/features/members/utils/position';
import { ranksShown, rosterRankMessageKey } from '@/features/members/utils/rank';
import {
  DAY_DETAIL_HEADING_ID,
  DAY_DETAIL_OVERRIDE_ID,
  DAY_DETAIL_ROSTER_ID,
} from '@/features/calendar/utils/element-ids';
import { t } from '@/lib/i18n';

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
        const line = rosterLineOf(member.name, rankKey, positionKey, (key) => t(key));

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
  const treatment = modifierTreatmentOf([MODIFIER_OVERRIDDEN]);

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
 * The day detail's body: the type, its times and the roster, or why there is
 * none. A working day and an off day show the override block when the day
 * has one — an off day made a working one, and a working day made an off
 * one, alike. A day with no rotation never has one: the domain ignores an
 * override there.
 */
function renderDetail(shown: DayDetail, usesFireRanks: boolean, form: OverrideFormState): ReactNode {
  // STORY 3.5b: an admin sets an override on a day that has none, or removes
  // the one it has; `form` decides which, and neither on a day with no rotation.
  const override = (
    <>
      {shown.override === null ? null : renderOverride(shown.override)}
      <OverrideRemoveRefusal form={form} />
      {form.offersRemove ? <OverrideRemoveAction form={form} /> : null}
      {form.offersSet ? <OverrideSetForm key={`${shown.teamId}:${shown.isoDate}`} form={form} /> : null}
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
    return <p className="text-sm">{t('kalendar.detail.noRotation', { team: shown.teamName })}</p>;
  }

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
 * NOT DISMISSIBLE WHILE AN OVERRIDE WRITE IS IN FLIGHT (story 3.5b): the
 * backdrop waits through `dismissible`, and Escape and the close button
 * through the guards below — `onCancel` replaces the primitive's own, so it
 * must refuse the cancel itself. The removal's confirmation is rendered BESIDE
 * the Dialog, never inside it.
 */
export function DayDetailDialog({
  detail,
  snapshot,
  form,
  onClose,
  onClosedByBrowser,
}: {
  readonly detail: DayDetail | null;
  readonly snapshot: CalendarSnapshot | null;
  readonly form: OverrideFormState;
  readonly onClose: () => void;
  readonly onClosedByBrowser: () => void;
}): ReactNode {
  const pending = form.pending;

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
            {renderDetail(detail, snapshot.usesFireRanks, form)}
          </>
        )}
      </Dialog>
      <OverrideRemoveConfirm form={form} detail={detail} />
    </>
  );
}
