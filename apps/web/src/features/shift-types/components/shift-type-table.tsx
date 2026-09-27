import { Link } from '@tanstack/react-router';
import { Pencil } from 'lucide-react';
import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { shownDate } from '@/features/members/services/list';
import {
  NO_TIMES_SHOWN,
  durationValuesOf,
  shiftTypeDurationMessageKey,
  type ShiftTypeDisplayRow,
} from '@/features/shift-types/services/list';
import { t } from '@/lib/i18n';

/** A non-working type's times and duration: none, shown as a dash. */
function renderNoTimes(): ReactNode {
  return (
    <span className="text-muted-foreground">{NO_TIMES_SHOWN}</span>
  );
}

/** A type's times and flags, read-only, in the table's time column. */
function renderTimes(row: ShiftTypeDisplayRow): ReactNode {
  // A NON-WORKING TYPE HAS NO TIMES, and says so with a dash; there is no
  // kind column, and its chip carries its name.
  if (!row.type.isWorking) return renderNoTimes();

  return (
    <div className="grid gap-1">
      {row.times === null ? (
        <span className="text-muted-foreground">{t('rotation.shiftTypes.noTimes')}</span>
      ) : (
        <span className="tabular-nums">{row.times.range}</span>
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
    </div>
  );
}

function renderDuration(row: ShiftTypeDisplayRow): ReactNode {
  if (!row.type.isWorking) return renderNoTimes();
  if (row.times === null) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="tabular-nums">
        {t(
          shiftTypeDurationMessageKey(row.times.durationMinutes),
          durationValuesOf(row.times.durationMinutes),
        )}
      </span>
      {/* A pill whose TEXT is the meaning; no status colour. */}
      {row.times.crossesMidnight ? (
        <Badge variant="outline">{t('rotation.shiftTypes.crossesMidnight')}</Badge>
      ) : null}
    </div>
  );
}

/** One type as a table row. An archived one is read-only: no link to edit it. */
function renderRow(row: ShiftTypeDisplayRow): ReactNode {
  return (
    <TableRow key={row.type.id}>
      <TableCell>
        {/* THE CHIP: the slot's colour, and ALWAYS the name as text. */}
        <span className={row.chipClass}>
          <span className="truncate">{row.type.name}</span>
        </span>
      </TableCell>
      <TableCell>{renderTimes(row)}</TableCell>
      <TableCell>{renderDuration(row)}</TableCell>
      <TableCell className="text-right">
        {row.type.archived ? null : (
          <Button asChild variant="ghost" className="h-11 w-11 px-0">
            <Link to="/postavke-rotacije/tipovi-smjena/$id" params={{ id: row.type.id }}>
              <Pencil aria-hidden />
              <span className="sr-only">{t('rotation.shiftTypes.edit', { name: row.type.name })}</span>
            </Link>
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}

/**
 * The types in a table (design refresh C): the chip, the times, the duration
 * and the edit link. Nothing when there are no rows.
 */
export function ShiftTypeTable({ rows }: { readonly rows: readonly ShiftTypeDisplayRow[] }): ReactNode {
  if (rows.length === 0) return null;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('rotation.shiftTypes.columnName')}</TableHead>
          <TableHead>{t('rotation.shiftTypes.times')}</TableHead>
          <TableHead>{t('rotation.shiftTypes.duration.label')}</TableHead>
          <TableHead className="text-right">{t('rotation.shiftTypes.actions')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>{rows.map((row) => renderRow(row))}</TableBody>
    </Table>
  );
}
