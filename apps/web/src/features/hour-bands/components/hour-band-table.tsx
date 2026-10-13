import { Link } from '@tanstack/react-router';
import { Clock3, Pencil } from 'lucide-react';
import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { IconTile } from '@/components/ui/icon-tile';
import { StackedField, StackedFields, StackedList, StackedRow } from '@/components/ui/stacked-list';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { usePhone } from '@/hooks/viewport';
import { durationMessageKey, durationValuesOf, type HourBandDisplayRow } from '@/features/hour-bands/services/list';
import { t } from '@/lib/i18n';

/**
 * The bands, one row each: the name in its tone's tile, the window, the
 * duration and the midnight flag, all read-only and all from
 * `@/features/hour-bands/services/list`, and the row's edit link.
 *
 * Below 640 px the same rows stack instead (story 7.6's pattern, UX-DR17),
 * named by the card's heading: the tile and the name, the window and the
 * duration under them, and the edit link at the right. Only one of the two
 * forms is in the DOM.
 */
export function HourBandTable({ rows }: { readonly rows: readonly HourBandDisplayRow[] }): ReactNode {
  const isPhone = usePhone();
  const heading = t('organization.hourBands.listHeading');

  return (
    <Card className="min-w-0">
      <CardHeader className="flex-row flex-wrap items-center gap-3">
        <CardTitle asChild>
          <h2>{heading}</h2>
        </CardTitle>
        {/* STATED, AND STATED AT ZERO (UX-DR20). Not a live region: only
            confirmations announce. */}
        <Badge variant="secondary">
          {t('organization.hourBands.count', { count: rows.length })}
        </Badge>
      </CardHeader>
      {rows.length === 0 ? null : isPhone ? (
        <StackedList aria-label={heading} className="border-t">
          {rows.map((row) => (
            <StackedRow key={row.band.id} className="flex items-center gap-3">
              <IconTile variant={row.tone}>
                <Clock3 />
              </IconTile>
              <div className="grid min-w-0 flex-1 gap-0.5">
                <StackedFields>
                  <StackedField label={t('organization.hourBands.name')} labelHidden>
                    <span className="font-semibold">{row.band.name}</span>
                  </StackedField>
                </StackedFields>
                {/* THE WINDOW AS A RANGE, with the en dash UX-DR34 asks
                    for, and the duration on its own line under it. */}
                <StackedFields className="flex flex-wrap items-center text-sm">
                  <StackedField label={t('organization.hourBands.from')} labelHidden>
                    {row.start}
                  </StackedField>
                  <StackedField
                    label={t('organization.hourBands.to')}
                    labelHidden
                    className="flex before:content-['–']"
                  >
                    {row.end}
                  </StackedField>
                </StackedFields>
                <StackedFields className="text-sm text-muted-foreground">
                  <StackedField label={t('organization.hourBands.duration.label')} labelHidden>
                    {renderDuration(row)}
                  </StackedField>
                </StackedFields>
              </div>
              {renderEdit(row)}
            </StackedRow>
          ))}
        </StackedList>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('organization.hourBands.name')}</TableHead>
              <TableHead>{t('organization.hourBands.from')}</TableHead>
              <TableHead>{t('organization.hourBands.to')}</TableHead>
              <TableHead>{t('organization.hourBands.duration.label')}</TableHead>
              <TableHead className="text-right">{t('organization.hourBands.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.band.id}>
                <TableCell>
                  <div className="flex min-w-0 items-center gap-3">
                    <IconTile variant={row.tone}>
                      <Clock3 />
                    </IconTile>
                    <span className="truncate font-semibold">{row.band.name}</span>
                  </div>
                </TableCell>
                <TableCell className="tabular-nums">{row.start}</TableCell>
                <TableCell className="tabular-nums">{row.end}</TableCell>
                <TableCell>{renderDuration(row)}</TableCell>
                <TableCell className="text-right">{renderEdit(row)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

/** The duration and, where the band crosses midnight, its pill — in both forms. */
function renderDuration(row: HourBandDisplayRow): ReactNode {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="tabular-nums">
        {t(durationMessageKey(row.durationMinutes), durationValuesOf(row.durationMinutes))}
      </span>
      {/* A pill whose TEXT is the meaning; no status colour. */}
      {row.crossesMidnight ? <Badge variant="outline">{t('organization.hourBands.crossesMidnight')}</Badge> : null}
    </div>
  );
}

/** The row's 44 px edit link, named for the band, in both forms. */
function renderEdit(row: HourBandDisplayRow): ReactNode {
  return (
    <Button asChild variant="ghost" className="h-11 w-11 shrink-0 px-0">
      <Link to="/organizacija/satni-pojasi/$id" params={{ id: row.band.id }}>
        <Pencil aria-hidden />
        <span className="sr-only">{t('organization.hourBands.edit', { name: row.band.name })}</span>
      </Link>
    </Button>
  );
}
