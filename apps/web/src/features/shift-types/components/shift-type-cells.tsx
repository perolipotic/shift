import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { shownDate } from '@/features/members/services/list';
import {
  NO_TIMES_SHOWN,
  durationValuesOf,
  shiftTypeDurationMessageKey,
  type ShiftTypeDisplayRow,
} from '@/features/shift-types/services/list';
import { t } from '@/lib/i18n';

/**
 * What a type's times and duration SAY, written once (story 7.6) for both of
 * its forms: the table from 640 px (`shift-type-table.tsx`) and the stacked
 * rows below it (`shift-type-rows.tsx`), so the two cannot disagree. Each
 * form only places them.
 */

/**
 * A type's times: the dash of a non-working type, that none are set yet, or
 * the range — and a scheduled change of times under it. `emphasis` sets the
 * range in semibold, the phone row's main line.
 */
export function ShiftTypeTimes({
  row,
  emphasis = false,
}: {
  readonly row: ShiftTypeDisplayRow;
  readonly emphasis?: boolean;
}): ReactNode {
  // A NON-WORKING TYPE HAS NO TIMES, and says so with a dash; there is no
  // kind column, and its chip carries its name.
  if (!row.type.isWorking) {
    return <span className="text-muted-foreground">{NO_TIMES_SHOWN}</span>;
  }

  return (
    <span className="grid gap-1">
      {row.times === null ? (
        <span className="text-muted-foreground">{t('rotation.shiftTypes.noTimes')}</span>
      ) : (
        <span data-emphasis={emphasis} className="tabular-nums data-[emphasis=true]:font-semibold">
          {row.times.range}
        </span>
      )}
      {row.scheduled === null ? null : (
        <span className="text-xs text-muted-foreground tabular-nums">
          {t('rotation.shiftTypes.scheduled', {
            date: shownDate(row.scheduled.from),
            range: row.scheduled.times.range,
            duration: t(
              shiftTypeDurationMessageKey(row.scheduled.times.durationMinutes),
              durationValuesOf(row.scheduled.times.durationMinutes),
            ),
          })}
        </span>
      )}
    </span>
  );
}

/** A working type's duration (`12 h`), or `null` for a type with no times in effect. */
export function shiftTypeDurationOf(row: ShiftTypeDisplayRow): string | null {
  if (row.times === null) return null;

  return t(shiftTypeDurationMessageKey(row.times.durationMinutes), durationValuesOf(row.times.durationMinutes));
}

/** `Prelazi ponoć`: a pill whose TEXT is the meaning, no status colour. */
export function CrossesMidnight(): ReactNode {
  return <Badge variant="outline">{t('rotation.shiftTypes.crossesMidnight')}</Badge>;
}
