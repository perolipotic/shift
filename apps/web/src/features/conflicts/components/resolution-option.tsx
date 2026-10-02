import { CircleDashed } from 'lucide-react';
import type { ReactNode, RefObject } from 'react';

import { RadioCard } from '@/components/ui/radio-group';
import {
  OPTION_ACCEPT_UNCOVERED,
  OPTION_AMEND_LEAVE,
  OPTION_REPLACE_MEMBER,
  RESOLUTION_AMEND_BODY_ID,
  RESOLUTION_AMEND_DESCRIBED_BY,
  RESOLUTION_AMEND_STRIP_ID,
  RESOLUTION_AMEND_TITLE_ID,
  RESOLUTION_ACCEPT_BODY_ID,
  RESOLUTION_ACCEPT_DESCRIBED_BY,
  RESOLUTION_ACCEPT_STRIP_ID,
  RESOLUTION_ACCEPT_TITLE_ID,
  RESOLUTION_REPLACE_BODY_ID,
  RESOLUTION_REPLACE_DESCRIBED_BY,
  RESOLUTION_REPLACE_STRIP_ID,
  RESOLUTION_REPLACE_TITLE_ID,
  amendBodyMessageKey,
  coverageMessageKey,
  leaveHoursMessageKey,
  workHoursMessageKey,
  type ResolutionView,
} from '@/features/conflicts/services/resolution-screen';
import { t } from '@/lib/i18n';

/**
 * One term of the consequence strip: its label over its value. A `<span>`
 * throughout, because the whole card is the radio's `<button>`.
 */
function StripTerm({ label, children }: { readonly label: string; readonly children: ReactNode }): ReactNode {
  return (
    <span className="grid min-w-0 content-start gap-0.5 break-words">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs sm:text-sm">{children}</span>
    </span>
  );
}

/**
 * The `resolution-option` card for "Prihvati kao nepokriveno" (story 5.4b;
 * UX-DR10, UX-DR11): its title, what it means, and the consequence strip in
 * its three fixed terms — coverage, the absent member's hours, the balance.
 * Three columns at every width, a phone's included. Neither preselected nor
 * styled apart: `RadioCard` draws the chosen state.
 */
export function AcceptUncoveredOption({
  view,
  optionRef,
}: {
  readonly view: ResolutionView;
  readonly optionRef: RefObject<HTMLButtonElement | null>;
}): ReactNode {
  return (
    <RadioCard
      ref={optionRef}
      value={OPTION_ACCEPT_UNCOVERED}
      aria-labelledby={RESOLUTION_ACCEPT_TITLE_ID}
      aria-describedby={RESOLUTION_ACCEPT_DESCRIBED_BY}
      footer={
        <LeaveStrip view={view} id={RESOLUTION_ACCEPT_STRIP_ID}>
          <span className="font-semibold tabular-nums">
            {t(coverageMessageKey(), { covered: view.covered, total: view.total })}
          </span>
          <span className="inline-flex min-w-0 items-center gap-1">
            <CircleDashed aria-hidden className="size-3.5 shrink-0" />
            <span className="min-w-0 break-words">{t('raspored.resolution.uncovered')}</span>
          </span>
        </LeaveStrip>
      }
    >
      <span id={RESOLUTION_ACCEPT_TITLE_ID} className="font-semibold">
        {t('raspored.resolution.acceptTitle')}
      </span>
      <span id={RESOLUTION_ACCEPT_BODY_ID} className="min-w-0 break-words text-sm text-muted-foreground">
        {t('raspored.resolution.acceptBody', { team: view.teamName })}
      </span>
    </RadioCard>
  );
}

/**
 * The `resolution-option` card for "Zamijeni osobu" (story 5.4c), at fixed
 * position 2: the same three terms as the first card's strip, but the
 * coverage one higher — someone else works the shift — and, once a candidate
 * is picked, their name. Never "Nepokriveno". The absent member stays on
 * leave, so the hours and the balance read as the first card's. The picker
 * is not inside: the card is a `<button>`, so the picker is its sibling.
 */
export function ReplaceMemberOption({
  view,
  optionRef,
  replacementName,
}: {
  readonly view: ResolutionView;
  /** The card, where Spremi pressed with nobody to pick sends focus. */
  readonly optionRef: RefObject<HTMLButtonElement | null>;
  /** The candidate picked, or `null` while nobody is. */
  readonly replacementName: string | null;
}): ReactNode {
  return (
    <RadioCard
      ref={optionRef}
      value={OPTION_REPLACE_MEMBER}
      aria-labelledby={RESOLUTION_REPLACE_TITLE_ID}
      aria-describedby={RESOLUTION_REPLACE_DESCRIBED_BY}
      footer={
        <LeaveStrip view={view} id={RESOLUTION_REPLACE_STRIP_ID}>
          <span className="font-semibold tabular-nums">
            {t(coverageMessageKey(), { covered: view.replaceCovered, total: view.total })}
          </span>
          {replacementName === null ? null : (
            <span className="min-w-0 break-words">
              {t('raspored.resolution.replacementShown', { name: replacementName })}
            </span>
          )}
        </LeaveStrip>
      }
    >
      <span id={RESOLUTION_REPLACE_TITLE_ID} className="font-semibold">
        {t('raspored.resolution.replaceTitle')}
      </span>
      <span id={RESOLUTION_REPLACE_BODY_ID} className="min-w-0 break-words text-sm text-muted-foreground">
        {t('raspored.resolution.replaceBody')}
      </span>
    </RadioCard>
  );
}

/**
 * The `resolution-option` card for "Izmijeni godišnji odmor" (story 5.4d), at
 * fixed position 3: what the computed range does — the leave starts later,
 * ends earlier, or the record is removed — and the strip in the same three
 * terms: the coverage one higher with the absent member working, their hours
 * as work, and the balance once those days are given back. The date is a
 * computation, never a recommendation: nothing marks it apart.
 */
export function AmendLeaveOption({ view }: { readonly view: ResolutionView }): ReactNode {
  const amend = view.amend;

  return (
    <RadioCard
      value={OPTION_AMEND_LEAVE}
      aria-labelledby={RESOLUTION_AMEND_TITLE_ID}
      aria-describedby={RESOLUTION_AMEND_DESCRIBED_BY}
      footer={
        <ConsequenceStrip
          id={RESOLUTION_AMEND_STRIP_ID}
          hours={
            view.leaveHours === null
              ? t(workHoursMessageKey(null))
              : t(workHoursMessageKey(view.leaveHours), { hours: t(view.leaveHours.key, view.leaveHours.values) })
          }
          balanceDays={amend.balanceDays}
          balanceChange={t('raspored.resolution.balanceGained', { count: amend.gainedDays })}
        >
          <span className="font-semibold tabular-nums">
            {t(coverageMessageKey(), { covered: view.replaceCovered, total: view.total })}
          </span>
          <span className="min-w-0 break-words">{t('raspored.resolution.amendWorks', { name: view.memberName })}</span>
        </ConsequenceStrip>
      }
    >
      <span id={RESOLUTION_AMEND_TITLE_ID} className="font-semibold">
        {t('raspored.resolution.amendTitle')}
      </span>
      <span id={RESOLUTION_AMEND_BODY_ID} className="min-w-0 break-words text-sm text-muted-foreground">
        {t(amendBodyMessageKey(amend.target.kind), {
          name: view.memberName,
          date: view.dayMonth,
          // A removal names no new date, and its sentence has no place for one.
          newDate: amend.dateShown ?? undefined,
        })}
      </span>
    </RadioCard>
  );
}

/** The first two cards' hours and balance: the absent member's hours as leave, and the balance unchanged. */
function LeaveStrip({
  view,
  id,
  children,
}: {
  readonly view: ResolutionView;
  readonly id: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <ConsequenceStrip
      id={id}
      hours={
        view.leaveHours === null
          ? t(leaveHoursMessageKey(null))
          : t(leaveHoursMessageKey(view.leaveHours), {
              hours: t(view.leaveHours.key, view.leaveHours.values),
            })
      }
      balanceDays={view.balanceDays}
      balanceChange={t('raspored.resolution.balanceUnchanged')}
    >
      {children}
    </ConsequenceStrip>
  );
}

/**
 * The strip's three fixed terms — coverage (the card's own words, as
 * `children`), the absent member's hours, the balance and how it changes —
 * in three columns at every width, across the whole card.
 */
function ConsequenceStrip({
  id,
  hours,
  balanceDays,
  balanceChange,
  children,
}: {
  readonly id: string;
  readonly hours: string;
  readonly balanceDays: number;
  readonly balanceChange: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <span id={id} className="grid min-w-0 grid-cols-3 gap-2 border-t pt-3">
      <StripTerm label={t('raspored.resolution.coverageLabel')}>
        <span className="flex min-w-0 flex-wrap items-center gap-x-1.5">{children}</span>
      </StripTerm>
      <StripTerm label={t('raspored.resolution.hoursLabel')}>{hours}</StripTerm>
      <StripTerm label={t('raspored.resolution.balanceLabel')}>
        <span className="block font-semibold tabular-nums">{t('raspored.resolution.balance', { count: balanceDays })}</span>
        <span className="block text-muted-foreground">{balanceChange}</span>
      </StripTerm>
    </span>
  );
}
