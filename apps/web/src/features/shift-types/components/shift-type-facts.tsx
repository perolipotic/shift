import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { shownDate } from '@/features/members/services/list';
import {
  durationValuesOf,
  shiftTypeDurationMessageKey,
  type ShiftTimesShown,
  type ShiftTypeDisplayRow,
} from '@/features/shift-types/services/list';
import { t } from '@/lib/i18n';

function durationOf(times: ShiftTimesShown): string {
  return t(shiftTypeDurationMessageKey(times.durationMinutes), durationValuesOf(times.durationMinutes));
}

/** The times in effect today: none for a non-working type, and none yet for a working one without a version. */
function renderCurrent(shown: ShiftTypeDisplayRow): ReactNode {
  if (!shown.type.isWorking) {
    return <Badge variant="secondary">{t('rotation.shiftTypes.nonworking')}</Badge>;
  }

  if (shown.times === null) {
    return <p className="text-muted-foreground">{t('rotation.shiftTypes.noTimes')}</p>;
  }

  return (
    <dl className="flex flex-wrap gap-x-4 gap-y-1">
      <div className="flex gap-1">
        <dt className="text-muted-foreground">{t('rotation.shiftTypes.times')}</dt>
        <dd className="tabular-nums">{shown.times.range}</dd>
      </div>
      <div className="flex gap-1">
        <dt className="text-muted-foreground">{t('rotation.shiftTypes.duration.label')}</dt>
        <dd className="tabular-nums">{durationOf(shown.times)}</dd>
      </div>
    </dl>
  );
}

/** The chip, the times in effect today, and the scheduled correction, read-only. */
export function ShiftTypeFacts({ shown }: { readonly shown: ShiftTypeDisplayRow }): ReactNode {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-sm">
      {/* THE CHIP: the slot's colour, and ALWAYS the name as text. */}
      <span className={shown.chipClass}>
        <span className="truncate">{shown.type.name}</span>
      </span>
      {renderCurrent(shown)}
      {/* A pill whose TEXT is the meaning; no status colour. */}
      {shown.times?.crossesMidnight === true ? (
        <Badge variant="secondary">{t('rotation.shiftTypes.crossesMidnight')}</Badge>
      ) : null}
      {shown.scheduled === null ? null : (
        <p className="basis-full tabular-nums">
          {t('rotation.shiftTypes.scheduled', {
            date: shownDate(shown.scheduled.from),
            range: shown.scheduled.times.range,
            duration: durationOf(shown.scheduled.times),
          })}
        </p>
      )}
    </div>
  );
}
