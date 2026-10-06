import { Link } from '@tanstack/react-router';
import { useId, type ReactNode } from 'react';

import { Card } from '@/components/ui/card';
import { CONFLICT_GLYPH } from '@/features/calendar/utils/modifiers';
import { MODE_SVE } from '@/features/calendar/utils/month';
import {
  ABSENT_UNRESOLVED,
  STAFFING_NOBODY,
  STAFFING_SHORT,
  coverageAbsentMessageKey,
  coveragePhaseMessageKey,
  coverageShiftMessageKey,
  coverageStaffingMessageKey,
  type Coverage,
  type CoverageAbsent,
  type CoverageRow,
} from '@/features/today/services/admin-today';
import { t } from '@/lib/i18n';

/** A rostered member on leave, and what was decided: ⚠ beside the words while it is unresolved. */
function renderAbsent(absent: CoverageAbsent): ReactNode {
  return (
    <p key={absent.memberId} className="flex min-w-0 items-start gap-1 text-sm">
      {absent.state === ABSENT_UNRESOLVED ? <span aria-hidden>{CONFLICT_GLYPH}</span> : null}
      <span className="min-w-0 break-words">{t(coverageAbsentMessageKey(absent.state), { name: absent.name })}</span>
    </p>
  );
}

/**
 * One working team today: its type and range with the team, its phase in
 * words, how many of its roster are present, and each one absent on leave —
 * or `✓ puna smjena`, or `Nitko nije raspoređen` for an empty roster. An unresolved absence carries ⚠ beside its words.
 */
function renderRow(row: CoverageRow): ReactNode {
  return (
    <li key={row.teamId} className="grid min-w-0 gap-1 py-2">
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="min-w-0 break-words font-semibold tabular-nums">
          {t(coverageShiftMessageKey(row), { type: row.shiftTypeName, range: row.range, team: row.teamName })}
        </span>
        {row.staffing === STAFFING_NOBODY ? null : (
          <span className="font-semibold tabular-nums">
            {t('danas.admin.coverage.members', { present: row.present, total: row.total })}
          </span>
        )}
      </div>
      {row.phase === null ? null : (
        <p className="text-sm text-muted-foreground tabular-nums">
          {t(coveragePhaseMessageKey(row.phase.kind), { time: row.phase.time })}
        </p>
      )}
      {row.staffing === STAFFING_SHORT ? (
        row.absent.map(renderAbsent)
      ) : (
        <p className="text-sm text-muted-foreground">{t(coverageStaffingMessageKey(row.staffing))}</p>
      )}
    </li>
  );
}

/**
 * *Pokrivenost danas* (story 6.3): one row per working team, in team order,
 * then the teams off today in one line, and the way to the calendar's every
 * team.
 */
export function CoverageCard({ coverage }: { readonly coverage: Coverage }): ReactNode {
  const headingId = useId();

  return (
    <Card className="min-w-0">
      <section aria-labelledby={headingId} className="grid min-w-0 gap-2 p-4 sm:p-6">
        <h2 id={headingId} className="font-heading text-lg font-semibold">
          {t('danas.admin.coverage.heading')}
        </h2>
        {coverage.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('danas.admin.coverage.none')}</p>
        ) : (
          <ul className="divide-y divide-border">{coverage.rows.map(renderRow)}</ul>
        )}
        {coverage.noRotation.length === 0 ? null : (
          <p className="min-w-0 break-words text-sm text-muted-foreground">
            {t('danas.admin.coverage.noRotation', { teams: coverage.noRotation.join(t('danas.admin.listSeparator')) })}
          </p>
        )}
        {coverage.off.length === 0 ? null : (
          <p className="min-w-0 break-words text-sm text-muted-foreground">
            {t('danas.admin.coverage.off', { teams: coverage.off.join(t('danas.admin.listSeparator')) })}
          </p>
        )}
        <Link
          to="/kalendar"
          search={{ prikaz: MODE_SVE }}
          className="inline-flex min-h-11 items-center font-medium underline underline-offset-4"
        >
          {t('danas.admin.coverage.link')}
        </Link>
      </section>
    </Card>
  );
}
