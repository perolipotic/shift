import { Link } from '@tanstack/react-router';
import { useId, type ReactNode } from 'react';

import { Card } from '@/components/ui/card';
import { CaretRight, CheckCircle, UsersThree } from '@/components/ui/icon';
import { MODE_SVE } from '@/features/calendar/utils/month';
import { atWorkText } from '@/features/staffing/components/short-staffed-block';
import type { ShortStaffedCard, ShortStaffedTodayRow } from '@/features/today/services/admin-today';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

/** One short-staffed shift, the whole row the link to that team's day detail on *Kalendar*. */
function renderRow(row: ShortStaffedTodayRow): ReactNode {
  return (
    <li key={row.key} className="min-w-0">
      <Link
        to="/kalendar"
        search={row.calendar}
        className="flex min-h-11 min-w-0 items-center gap-3 rounded-md border bg-card p-3 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="min-w-0 flex-1 break-words text-sm tabular-nums">
          {t('danas.admin.shortStaffed.row', {
            weekday: row.weekday,
            date: row.dayMonth,
            team: row.teamName,
            type: row.shiftTypeName,
            atWork: atWorkText(row.atWork, row.minimum),
          })}
        </span>
        <CaretRight aria-hidden className="size-4 shrink-0" />
      </Link>
    </li>
  );
}

/**
 * *Premalo ljudi* (story 11.4): the short-staffed shifts of the week *Ovaj
 * tjedan* draws, the same at every count. The count always shows, `0 smjena
 * ovaj tjedan` included; above zero a `warning` left edge and the people
 * glyph in `foreground`, and the earliest rows, each opening its day detail,
 * then `i još {n}`; at zero neutral, with a check and the sentence that
 * states what is true. It always ends with the way to the calendar. Every
 * text and the glyph stay `foreground` or `muted-foreground`: the token is
 * the edge alone (Epic 11 retro A6, option b). The card is the opaque
 * `bg-card`, and the edge is held to 3:1 against it in
 * `test/theme-contrast.test.ts`, which records its shortfall against the
 * page and the blobs on its outer side. Only drawn while *Najmanje ljudi u
 * smjeni* is set.
 */
export function ShortStaffedCountCard({ card }: { readonly card: ShortStaffedCard }): ReactNode {
  const headingId = useId();
  const short = card.count !== 0;

  return (
    <Card className={cn('min-w-0', short && 'border-l-4 border-l-warning')}>
      <section aria-labelledby={headingId} className="grid min-w-0 gap-3 p-4 sm:p-6">
        <div className="flex min-w-0 items-start gap-3">
          {short ? (
            <UsersThree aria-hidden className="mt-1 size-6 shrink-0 text-foreground" />
          ) : (
            <CheckCircle aria-hidden className="mt-1 size-6 shrink-0" />
          )}
          <div className="grid min-w-0 gap-1">
            <h2 id={headingId} className="text-sm font-semibold text-muted-foreground">
              {t('danas.admin.shortStaffed.heading')}
            </h2>
            <p className="text-2xl font-bold tabular-nums">{t('danas.admin.shortStaffed.count', { count: card.count })}</p>
            {short ? null : (
              <p className="text-sm text-muted-foreground">{t('danas.admin.shortStaffed.calm', { minimum: card.minimum })}</p>
            )}
          </div>
        </div>
        {card.rows.length === 0 ? null : <ul aria-labelledby={headingId} className="grid min-w-0 gap-2">{card.rows.map(renderRow)}</ul>}
        {card.more === 0 ? null : (
          <p className="text-sm text-muted-foreground tabular-nums">{t('danas.admin.shortStaffed.more', { count: card.more })}</p>
        )}
        <Link
          to="/kalendar"
          search={{ prikaz: MODE_SVE }}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-md border-[1.5px] border-input bg-card px-4 text-sm font-semibold hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {t('danas.admin.shortStaffed.open')}
        </Link>
      </section>
    </Card>
  );
}
