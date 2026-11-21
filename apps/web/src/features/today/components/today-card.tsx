import { useId, type ReactNode } from 'react';

import { Card } from '@/components/ui/card';
import type { MemberTeam } from '@/features/members/services/list';
import { LoanNoticeLine } from '@/features/calendar/components/loan-notice-line';
import { dayEmptyMessageKey } from '@/features/calendar/utils/empty-day';
import type { LoanNotice } from '@/features/calendar/utils/loan-marks';
import { DutyBlock } from '@/features/today/components/duty-block';
import { OwnTeamLine } from '@/features/today/components/own-team-line';
import { leaveHalfNamedOf } from '@/features/leave/services/leave-section';
import {
  CASE_DUTY,
  CASE_LEAVE,
  CASE_WORKING,
  todayCaseMessageKey,
  todayHalfLineMessageKey,
  todayHalfMessageKey,
  type TodayCase,
  type TodayHalf,
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

/** STORY 13.7: a half day's one line — its type, the absent half, and its cost when the type draws. */
function renderHalf(half: TodayHalf): ReactNode {
  return (
    <p className="tabular-nums">
      {t(todayHalfLineMessageKey(half), {
        type: half.typeName,
        half: t(todayHalfMessageKey(half.half)),
        days: t('count.days', { count: half.costDays }),
      })}
    </p>
  );
}

/** What follows the case's sentence: the leave's range and cost, today's shifts, or the free day's type. */
function renderDetail(todayCase: Exclude<TodayCase, { readonly kind: typeof CASE_DUTY }>): ReactNode {
  if (todayCase.kind === CASE_LEAVE) {
    // STORY 13.7: a stored half whose shift is gone names its date with its half, in place of the range.
    const range =
      todayCase.half === undefined
        ? t('danas.today.leaveRange', { from: todayCase.from, to: todayCase.to })
        : leaveHalfNamedOf(t, todayCase.from, todayCase.half);

    // STORY 6.1b: what the absence costs, through `count.days`.
    return (
      <>
        <p className="tabular-nums">{range}</p>
        {/* STORY 13.2b: only drawing records cost, and nothing is said when none does. */}
        {todayCase.costDays === 0 ? null : (
          <p className="tabular-nums">
            {t('danas.today.leaveCost', { days: t('count.days', { count: todayCase.costDays }) })}
          </p>
        )}
      </>
    );
  }

  if (todayCase.kind === CASE_WORKING) {
    // STORY 6.1a: one row per shift — yesterday's still running first, then
    // the own team's, then each one a roster override put the viewer on. A
    // 24 h duty is the duty-block's (6.2).
    return (
      <>
        <ul className="grid gap-2">{todayCase.shifts.map(renderShift)}</ul>
        {todayCase.half === undefined ? null : renderHalf(todayCase.half)}
      </>
    );
  }

  // What is true, never an empty area: the free day's type and team, or no
  // shift — on no team, or inactive (B449).
  return todayCase.shift === null ? (
    <p className="text-muted-foreground">{t(dayEmptyMessageKey(todayCase))}</p>
  ) : (
    <ul className="grid gap-2">{renderShift(todayCase.shift, 0)}</ul>
  );
}

/**
 * Today in words (story 6.1a): exactly one case as the card's heading — on
 * leave, working or free — and what it rests on beneath it; on a duty, the
 * duty-block in its place (story 6.2). Last, the viewer's team today and its
 * one link, the card's only thing to tap.
 */
export function TodayCard({
  todayCase,
  ownTeam,
  loan,
}: {
  readonly todayCase: TodayCase;
  readonly ownTeam: MemberTeam | null;
  /** STORY 18.5: the viewer's loan covering today or ahead, under their team; absent with none. */
  readonly loan?: LoanNotice | undefined;
}): ReactNode {
  const headingId = useId();

  if (todayCase.kind === CASE_DUTY) {
    return (
      <DutyBlock duty={todayCase.duty}>
        {/* STORY 13.7: a half day on a duty is named under the duty-block. */}
        {todayCase.half === undefined ? null : renderHalf(todayCase.half)}
        <OwnTeamLine team={ownTeam} />
        {loan === undefined ? null : <LoanNoticeLine notice={loan} />}
      </DutyBlock>
    );
  }

  return (
    <Card className="min-w-0">
      <section aria-labelledby={headingId} className="grid min-w-0 gap-3 p-4 sm:p-6">
        <h2 id={headingId} className="font-heading text-xl font-bold">
          {/* STORY 13.2b: the leave case names today's record's type, the viewer's own. */}
          {todayCase.kind === CASE_LEAVE
            ? t('danas.today.leave', { type: todayCase.typeName })
            : t(todayCaseMessageKey(todayCase.kind))}
        </h2>
        {renderDetail(todayCase)}
        <OwnTeamLine team={ownTeam} />
        {loan === undefined ? null : <LoanNoticeLine notice={loan} />}
      </section>
    </Card>
  );
}
