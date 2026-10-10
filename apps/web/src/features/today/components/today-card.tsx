import { useId, type ReactNode } from 'react';

import { Card } from '@/components/ui/card';
import { DutyBlock } from '@/features/today/components/duty-block';
import {
  CASE_DUTY,
  CASE_LEAVE,
  CASE_WORKING,
  todayCaseMessageKey,
  type TodayCase,
  type TodayShift,
} from '@/features/today/services/today';
import { t } from '@/lib/i18n';

/**
 * One shift of today: the type's name, its range and the team, each on its
 * own; a shift from yesterday still running now says so, muted (`od jučer`).
 */
function renderShift(shift: TodayShift, index: number): ReactNode {
  return (
    <li key={`${String(index)}-${shift.teamId}`} className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="font-semibold">{shift.name ?? t('kalendar.noRotation')}</span>
      {shift.range === null ? null : <span className="tabular-nums">{shift.range}</span>}
      {shift.fromYesterday ? <span className="text-muted-foreground">{t('danas.today.fromYesterday')}</span> : null}
      <span className="min-w-0 break-words text-muted-foreground">{shift.teamName}</span>
    </li>
  );
}

/** What follows the case's sentence: the leave's range and cost, today's shifts, or the free day's type. */
function renderDetail(todayCase: Exclude<TodayCase, { readonly kind: typeof CASE_DUTY }>): ReactNode {
  if (todayCase.kind === CASE_LEAVE) {
    // STORY 6.1b: what the absence costs, through `count.days`.
    return (
      <>
        <p className="tabular-nums">{t('danas.today.leaveRange', { from: todayCase.from, to: todayCase.to })}</p>
        <p className="tabular-nums">
          {t('danas.today.leaveCost', { days: t('count.days', { count: todayCase.costDays }) })}
        </p>
      </>
    );
  }

  if (todayCase.kind === CASE_WORKING) {
    // STORY 6.1a: one row per shift — yesterday's still running first, then
    // the own team's, then each one a roster override put the viewer on. A
    // 24 h duty is the duty-block's (6.2).
    return <ul className="grid gap-2">{todayCase.shifts.map(renderShift)}</ul>;
  }

  // What is true, never an empty area: the free day's type and team, or no shift.
  return todayCase.shift === null ? (
    <p className="text-muted-foreground">{t('kalendar.day.noTeam')}</p>
  ) : (
    <ul className="grid gap-2">{renderShift(todayCase.shift, 0)}</ul>
  );
}

/**
 * Today in words (story 6.1a): exactly one case as the card's heading — on
 * leave, working or free — and what it rests on beneath it; on a duty, the
 * duty-block in its place (story 6.2). Nothing to tap.
 */
export function TodayCard({ todayCase }: { readonly todayCase: TodayCase }): ReactNode {
  const headingId = useId();

  if (todayCase.kind === CASE_DUTY) {
    return <DutyBlock duty={todayCase.duty} />;
  }

  return (
    <Card className="min-w-0">
      <section aria-labelledby={headingId} className="grid min-w-0 gap-3 p-4 sm:p-6">
        <h2 id={headingId} className="font-heading text-xl font-bold">
          {t(todayCaseMessageKey(todayCase.kind))}
        </h2>
        {renderDetail(todayCase)}
      </section>
    </Card>
  );
}
