import { Link } from '@tanstack/react-router';
import { useId, type ReactNode } from 'react';

import { Card } from '@/components/ui/card';
import { CalendarCellBox } from '@/features/calendar/components/calendar-cell';
import { ModifierGlyphs } from '@/features/calendar/components/modifier-glyphs';
import { MODIFIER_LEAVE, glyphOf } from '@/features/calendar/utils/modifiers';
import { MODE_MOJ, type CalendarDay } from '@/features/calendar/utils/month';
import type { TodayWeekDay } from '@/features/today/services/today';
import { t } from '@/lib/i18n';

/** The leave mark's glyph, as the calendar draws it. */
const LEAVE_GLYPHS = [glyphOf(MODIFIER_LEAVE)];

/**
 * A leave day's visible word. The glyph is drawn only on a day with no
 * shift cell: a cell draws its own. Where a cell already announces leave
 * (its sr-only mark), the word is hidden from assistive technology, so the
 * leave is heard once.
 */
function renderLeave(day: CalendarDay): ReactNode {
  const announced = day.shifts.some((shift) => shift.cell.modifiers.includes(MODIFIER_LEAVE));

  return (
    <span className="flex items-center gap-1 text-sm" aria-hidden={announced ? true : undefined}>
      {day.shifts.length === 0 ? <ModifierGlyphs glyphs={LEAVE_GLYPHS} /> : null}
      <span>{t('kalendar.modifier.leave')}</span>
    </span>
  );
}

/**
 * One day: its date and weekday, then each shift as *Moj raspored* draws it
 * — the same cell, its fill, range and marks — or `Bez smjene`; and on a
 * leave day `Godišnji` in words.
 */
function renderDay({ day, onLeave }: TodayWeekDay): ReactNode {
  return (
    <li key={day.date} className="flex min-h-11 min-w-0 items-center gap-3 py-1">
      <span className="w-20 shrink-0 text-sm">
        <span className="block tabular-nums">{day.dayMonth}</span>
        <span className="block text-xs text-muted-foreground">{day.weekday}</span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        {day.shifts.length === 0 ? (
          <span className="text-sm text-muted-foreground">{t('kalendar.day.noTeam')}</span>
        ) : null}
        {day.shifts.map((shift, index) => (
          <span key={`${String(index)}-${shift.teamId}`} className="flex min-w-0">
            <CalendarCellBox cell={shift.cell} inGrid={false} />
          </span>
        ))}
        {onLeave ? renderLeave(day) : null}
      </span>
    </li>
  );
}

/**
 * The next seven days (story 6.1a), today + 1 through today + 7, across a
 * month boundary as it falls — each day *Moj raspored*'s own — and the way
 * to the calendar.
 */
export function WeekList({ week }: { readonly week: readonly TodayWeekDay[] }): ReactNode {
  const headingId = useId();

  return (
    <Card className="min-w-0">
      <section aria-labelledby={headingId} className="grid min-w-0 gap-2 p-4 sm:p-6">
        <h2 id={headingId} className="font-heading text-lg font-semibold">
          {t('danas.week.heading')}
        </h2>
        <ol className="divide-y divide-border">
          {week.map(renderDay)}
        </ol>
        <Link
          to="/kalendar"
          search={{ prikaz: MODE_MOJ }}
          className="inline-flex min-h-11 items-center font-medium underline underline-offset-4"
        >
          {t('danas.week.link')}
        </Link>
      </section>
    </Card>
  );
}
