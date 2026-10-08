import { Link } from '@tanstack/react-router';
import { Pencil } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { StackedField, StackedFields, StackedList, StackedRow } from '@/components/ui/stacked-list';
import {
  CrossesMidnight,
  ShiftTypeTimes,
  shiftTypeDurationOf,
} from '@/features/shift-types/components/shift-type-cells';
import type { ShiftTypeDisplayRow } from '@/features/shift-types/services/list';
import { t } from '@/lib/i18n';

/**
 * The types on a phone (story 7.6): the table's own display rows, stacked.
 * A row is the type's chip, its times as the main line with
 * `{duration} · Prelazi ponoć` under them (and a scheduled change of times,
 * where there is one), and the table's 44 px edit link, named for the type,
 * at the right. An archived type is read-only: no link. The times and the
 * duration are `./shift-type-cells`'s, as the table's are. Every value is a
 * `StackedField`, so each is announced with its column's own heading; a type
 * with no duration (non-working, or no times yet) has no duration field.
 */
export function ShiftTypeRows({
  label,
  rows,
}: {
  /** The section's heading, from the screen's `t()`: the list's name. */
  readonly label: string;
  readonly rows: readonly ShiftTypeDisplayRow[];
}): ReactNode {
  return (
    <StackedList aria-label={label} className="border-t">
      {rows.map((row) => (
        <ShiftTypeRow key={row.type.id} row={row} />
      ))}
    </StackedList>
  );
}

/** One type as a stacked row. */
function ShiftTypeRow({ row }: { readonly row: ShiftTypeDisplayRow }): ReactNode {
  const duration = shiftTypeDurationOf(row);

  return (
    <StackedRow className="flex items-center gap-3">
      {/* THE CHIP AND THE TIMES ON ONE LINE WHERE THEY FIT, the times
          wrapping under the chip where they do not (a long name at 320 px);
          the edit link stays at the right either way. */}
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
        <StackedFields className="min-w-0 max-w-full">
          <StackedField label={t('rotation.shiftTypes.columnName')} labelHidden>
            {/* THE CHIP: the slot's colour, and ALWAYS the name as text,
                wrapping rather than cut, so a long name is read whole. */}
            <span className={row.chipClass}>
              <span className="min-w-0 whitespace-normal break-words">{row.type.name}</span>
            </span>
          </StackedField>
        </StackedFields>
        <div className="grid min-w-28 flex-1 gap-0.5">
          <StackedFields>
            <StackedField label={t('rotation.shiftTypes.times')} labelHidden>
              <ShiftTypeTimes row={row} emphasis />
            </StackedField>
          </StackedFields>
          {duration === null ? null : (
            <StackedFields className="flex flex-wrap items-center text-sm text-muted-foreground">
              <StackedField label={t('rotation.shiftTypes.duration.label')} labelHidden>
                {duration}
              </StackedField>
              {row.times?.crossesMidnight === true ? (
                <StackedField label={t('rotation.shiftTypes.times')} labelHidden separated className="items-center">
                  <CrossesMidnight />
                </StackedField>
              ) : null}
            </StackedFields>
          )}
        </div>
      </div>
      {row.type.archived ? null : (
        <Button asChild variant="ghost" className="h-11 w-11 shrink-0 px-0">
          <Link to="/postavke-rotacije/tipovi-smjena/$id" params={{ id: row.type.id }}>
            <Pencil aria-hidden />
            <span className="sr-only">{t('rotation.shiftTypes.edit', { name: row.type.name })}</span>
          </Link>
        </Button>
      )}
    </StackedRow>
  );
}
