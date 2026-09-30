import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { CalendarCellBox } from '@/features/calendar/components/calendar-cell';
import { CalendarLegend } from '@/features/calendar/components/calendar-legend';
import { DAY_DETAIL_POPUP } from '@/features/calendar/utils/day-detail';
import { dayListLabelsOf } from '@/features/calendar/utils/modifiers';
import type {
  CalendarCell,
  CalendarDay,
  CalendarDayListOutcome,
  CalendarPersonMonth,
} from '@/features/calendar/utils/month';
import { translateCellLabel } from '@/features/calendar/utils/cell-label';
import { calendarMessageKey, type CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { PERSON_HEADING_ID } from '@/features/calendar/utils/element-ids';
import { MONTH_HEADING_ID } from '@/features/calendar/utils/grid-keys';
import { t } from '@/lib/i18n';

/** Opens `teamId` on `date`, `opener` getting focus back on close. */
type OpenDay = (teamId: string, date: string, opener: HTMLElement) => void;

/** A day on a team, as a button that opens that team's detail on that date (story 3.4b). */
function renderDayButton(
  openDay: OpenDay,
  teamId: string,
  date: string,
  cell: CalendarCell,
  label: string | null,
): ReactNode {
  return (
    <Button
      type="button"
      variant="ghost"
      className="h-auto min-h-11 min-w-0 flex-1 items-stretch whitespace-normal p-0 text-left"
      aria-label={label ?? undefined}
      aria-haspopup={DAY_DETAIL_POPUP}
      onClick={(event) => {
        openDay(teamId, date, event.currentTarget);
      }}
    >
      <CalendarCellBox cell={cell} inGrid={false} />
    </Button>
  );
}

function renderDay(openDay: OpenDay, day: CalendarDay, labels: readonly (string | null)[]): ReactNode {
  return (
    <li
      key={day.date}
      aria-current={day.isToday ? 'date' : undefined}
      className={
        day.isToday
          ? 'flex min-h-11 items-center gap-3 border-l-4 border-foreground py-1 pl-2 pr-1 font-bold'
          : 'flex min-h-11 items-center gap-3 py-1 pl-3 pr-1'
      }
    >
      <span className="w-20 shrink-0 text-sm">
        <span className="block tabular-nums">{day.dayMonth}</span>
        <span className="block text-xs font-normal text-muted-foreground">{day.weekday}</span>
      </span>
      {day.shifts.length === 0 ? (
        <span className="text-sm text-muted-foreground">{t('kalendar.day.noTeam')}</span>
      ) : (
        // STORY 3.6a: one row per shift — the member's own team's, then each
        // one a roster override put them on.
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          {day.shifts.map((shift, index) => (
            <span key={shift.teamId} className="flex min-w-0">
              {renderDayButton(openDay, shift.teamId, day.date, shift.cell, labels[index] ?? null)}
            </span>
          ))}
        </span>
      )}
    </li>
  );
}

/**
 * A day list — the viewer's, or the person chosen — or its own failure, or
 * the explanation `noTeam` when there is no team all month, never an empty
 * list. The list is named by the month's heading, after the person's when
 * it is theirs.
 */
function renderDayList(
  snapshot: CalendarSnapshot | null,
  openDay: OpenDay,
  days: CalendarDayListOutcome,
  noTeam: string,
  ofPerson: boolean,
): ReactNode {
  // The day list's own failure: the alert and no list. The grid is unaffected.
  if (!days.ok) {
    return (
      <div className="px-4 pb-4">
        <Notice role="alert">{t(calendarMessageKey(days.code))}</Notice>
      </div>
    );
  }

  if (days.days === null) {
    return <p className="px-4 pb-4 text-sm text-muted-foreground">{noTeam}</p>;
  }

  // The button's name is the grid cell's full label: the date, the team,
  // the type, the times and each mark.
  const labels = snapshot === null ? [] : dayListLabelsOf(days.days, snapshot.teams, translateCellLabel);

  return (
    <>
      <CalendarLegend cells={days.days.flatMap((day) => day.shifts.map((shift) => shift.cell))} />
      <ol
        aria-labelledby={ofPerson ? `${PERSON_HEADING_ID} ${MONTH_HEADING_ID}` : MONTH_HEADING_ID}
        className="divide-y divide-border px-4 pb-4">
        {days.days.map((day, index) => renderDay(openDay, day, labels[index] ?? []))}
      </ol>
    </>
  );
}

/** *Moj raspored* (story 3.2a): the viewer's own day list. */
export function CalendarDays({
  snapshot,
  days,
  openDay,
}: {
  readonly snapshot: CalendarSnapshot | null;
  readonly days: CalendarDayListOutcome;
  readonly openDay: OpenDay;
}): ReactNode {
  // What is true, never an empty list: the viewer is on no team this month.
  return renderDayList(snapshot, openDay, days, t('kalendar.noTeam'), false);
}

/** The person chosen in *Sve smjene* (story 3.3b): their name, then their day list. */
export function CalendarPerson({
  snapshot,
  person,
  openDay,
}: {
  readonly snapshot: CalendarSnapshot | null;
  readonly person: CalendarPersonMonth;
  readonly openDay: OpenDay;
}): ReactNode {
  return (
    <>
      <h3 id={PERSON_HEADING_ID} className="px-4 pb-3 font-heading text-lg font-semibold">
        {person.name}
      </h3>
      {renderDayList(snapshot, openDay, person.days, t('kalendar.person.noTeam', { name: person.name }), true)}
    </>
  );
}
