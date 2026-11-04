import type { ReactNode } from 'react';

import { UsersThree } from '@/components/ui/icon';
import {
  SHORT_STAFFED_UNKNOWN,
  type ShortStaffedReport,
  type ShortStaffedRow,
} from '@/features/staffing/services/short-staffed';
import { t } from '@/lib/i18n';

/** People at work against the minimum: `rade 2 od najmanje 3`, `ne radi nitko od najmanje 3`. */
export function atWorkText(atWork: number, minimum: number): string {
  return t('popunjenost.atWork', { atWork, minimum });
}

/** One row: `Smjena B, 14.10. Dan: rade 2 od najmanje 3`. */
function rowText(row: ShortStaffedRow): string {
  return t('popunjenost.row', {
    team: row.teamName,
    date: row.dayMonth,
    type: row.shiftTypeName,
    atWork: atWorkText(row.atWork, row.minimum),
  });
}

/**
 * THE SHORT-STAFFED BLOCK (story 11.2): what a save would newly leave short of
 * people, as `shortStaffedReportOf` derived it, inside the surface's *Što se
 * mijenja* and its existing polite live region — or the one neutral line when
 * it cannot be checked now.
 *
 * A BLOCK, NOT A QUIET LINE: a heading with the icon facade's people glyph,
 * then each shift by date and team, the first five and `i još {n}`. Words and
 * a shape carry it, never colour alone. NEUTRAL — never `destructive`, never
 * the accent, never an alert — and never a gate: the save beside it stays as
 * it was. Nothing at all while the setting is empty (`null`) or the change
 * makes no shift short.
 */
export function ShortStaffedBlock({ report }: { readonly report: ShortStaffedReport | null }): ReactNode {
  if (report === null) return null;

  if (report.kind === SHORT_STAFFED_UNKNOWN) {
    return <span className="block text-sm">{t('popunjenost.unknown')}</span>;
  }

  if (report.rows.length === 0) return null;

  return (
    <span data-short-staffed="" className="grid min-w-0 gap-1 rounded-md border bg-muted p-3 text-sm">
      <span className="flex min-w-0 items-center gap-1.5 font-medium">
        <UsersThree aria-hidden className="size-4 shrink-0" />
        <span className="min-w-0 break-words">{t('popunjenost.heading')}</span>
      </span>
      {report.rows.map((row) => (
        <span key={row.key} className="block min-w-0 break-words tabular-nums">
          {rowText(row)}
        </span>
      ))}
      {report.more === 0 ? null : (
        <span className="block tabular-nums">{t('popunjenost.more', { count: report.more })}</span>
      )}
    </span>
  );
}
