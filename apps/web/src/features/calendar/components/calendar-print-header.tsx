import type { ReactNode } from 'react';

import { calendarFilterWordsOf } from '@/features/calendar/components/calendar-filters';
import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { MODE_MOJ, type CalendarMode, type CalendarMonth } from '@/features/calendar/utils/month';
import { t } from '@/lib/i18n';
import { formatDate, formatTime } from '@/lib/i18n/format';

/** The printed month's header, in words (story 16.1, UX-DR56). */
export interface CalendarPrintHeaderText {
  /** The organization, as stored. */
  readonly organization: string;
  /** `Raspored · Studeni 2026` */
  readonly title: string;
  /** The filter in words: *Sve smjene*'s summary line, or *Moj raspored*'s. */
  readonly filter: string;
  /** `Ispisano: 21.11.2026 u 14:05`, in the organization's zone. */
  readonly printedAt: string;
}

/**
 * The header's four lines. The time is the organization's wall clock
 * (`formatDate`/`formatTime` in its zone, L8), as every time the app shows.
 */
export function calendarPrintHeaderTextOf({
  organizationName,
  timeZone,
  monthName,
  year,
  filter,
  printedAt,
}: {
  readonly organizationName: string;
  readonly timeZone: string;
  readonly monthName: string;
  readonly year: string;
  readonly filter: string;
  readonly printedAt: Date;
}): CalendarPrintHeaderText {
  return {
    organization: organizationName,
    title: t('print.title', { month: monthName, year }),
    filter,
    printedAt: t('print.printedAt', { date: formatDate(printedAt, timeZone), time: formatTime(printedAt, timeZone) }),
  };
}

/**
 * *Moj raspored*'s filter in words: whose schedule it is — by name, since a
 * sheet on a noticeboard has no "my" — and the viewer's team, as the screen's
 * own sentence names it.
 */
export function ownScheduleWordsOf(name: string, ownTeamName: string | null): string {
  return ownTeamName === null ? t('print.ownNoTeam', { name }) : t('print.own', { name, team: ownTeamName });
}

/**
 * The header *Kalendar* prints, or `null` — and then no *Ispiši* either —
 * while no month is drawn: loading, a refused read, or no mode yet. Its
 * filter is *Moj raspored*'s own words in that mode, the filter bar's
 * summary in *Sve smjene*.
 */
export function calendarPrintHeaderOf({
  refused,
  snapshot,
  month,
  mode,
  printedAt,
}: {
  readonly refused: boolean;
  readonly snapshot: CalendarSnapshot | null;
  readonly month: CalendarMonth | null;
  readonly mode: CalendarMode | null;
  readonly printedAt: Date;
}): CalendarPrintHeaderText | null {
  if (refused || snapshot === null || month === null || mode === null) return null;

  // The snapshot's members hold the viewer (`calendar_members()`); a viewer
  // missing from them names nobody, so *Moj raspored* offers no print then.
  const viewer = snapshot.members.find((member) => member.id === snapshot.viewer.memberId);

  if (mode === MODE_MOJ && viewer === undefined) return null;

  return calendarPrintHeaderTextOf({
    organizationName: snapshot.organizationName,
    timeZone: snapshot.timeZone,
    monthName: month.monthName,
    year: month.year,
    filter:
      mode === MODE_MOJ && viewer !== undefined
        ? ownScheduleWordsOf(viewer.name, month.ownTeamName)
        : calendarFilterWordsOf(month),
    printedAt,
  });
}

/**
 * STORY 16.1 (UX-DR56): THE PRINTED MONTH'S HEADER — the organization, the
 * month, the filter in words and when it was printed — drawn on paper only
 * (`hidden print:block`); on screen the page header and the filter bar say
 * the same. The legend follows it, in the month card, as on screen.
 */
export function CalendarPrintHeader({ text }: { readonly text: CalendarPrintHeaderText }): ReactNode {
  return (
    <header className="hidden print:block">
      <p className="text-sm font-semibold">{text.organization}</p>
      <h2 className="font-heading text-xl font-semibold">{text.title}</h2>
      <p className="text-sm">{text.filter}</p>
      <p className="text-xs">{text.printedAt}</p>
    </header>
  );
}
