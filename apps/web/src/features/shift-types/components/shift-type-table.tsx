import { Link } from '@tanstack/react-router';
import { Pencil } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  CrossesMidnight,
  ShiftTypeTimes,
  shiftTypeDurationOf,
} from '@/features/shift-types/components/shift-type-cells';
import { ShiftTypeRows } from '@/features/shift-types/components/shift-type-rows';
import { usePhone } from '@/hooks/viewport';
import { NO_TIMES_SHOWN, type ShiftTypeDisplayRow } from '@/features/shift-types/services/list';
import { t } from '@/lib/i18n';

/** A type's duration and its midnight flag, in the table's duration column. */
function renderDuration(row: ShiftTypeDisplayRow): ReactNode {
  // A NON-WORKING TYPE HAS NO DURATION, and says so with a dash.
  if (!row.type.isWorking) {
    return <span className="text-muted-foreground">{NO_TIMES_SHOWN}</span>;
  }

  const duration = shiftTypeDurationOf(row);

  if (duration === null) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="tabular-nums">{duration}</span>
      {row.times?.crossesMidnight === true ? <CrossesMidnight /> : null}
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
      <TableCell>
        <ShiftTypeTimes row={row} />
      </TableCell>
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
 * and the edit link. Nothing when there are no rows. Below 640 px the same
 * rows stack instead (story 7.6, `ShiftTypeRows`), named by the section's
 * heading; only one of the two forms is in the DOM.
 */
export function ShiftTypeTable({
  label,
  rows,
}: {
  /** The section's heading, from the screen's `t()`: what names the phone's list. */
  readonly label: string;
  readonly rows: readonly ShiftTypeDisplayRow[];
}): ReactNode {
  const isPhone = usePhone();

  if (rows.length === 0) return null;
  if (isPhone) {
    return <ShiftTypeRows label={label} rows={rows} />;
  }

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
