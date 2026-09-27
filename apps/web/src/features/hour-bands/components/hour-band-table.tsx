import { Link } from '@tanstack/react-router';
import { Clock3, Pencil } from 'lucide-react';
import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { IconTile } from '@/components/ui/icon-tile';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { durationMessageKey, durationValuesOf, type HourBandDisplayRow } from '@/features/hour-bands/services/list';
import { t } from '@/lib/i18n';

/**
 * The bands, one row each: the name in its tone's tile, the window, the
 * duration and the midnight flag, all read-only and all from
 * `@/features/hour-bands/services/list`, and the row's edit link.
 */
export function HourBandTable({ rows }: { readonly rows: readonly HourBandDisplayRow[] }): ReactNode {
  return (
    <Card className="min-w-0">
      <CardHeader className="flex-row flex-wrap items-center gap-3">
        <CardTitle asChild>
          <h2>{t('organization.hourBands.listHeading')}</h2>
        </CardTitle>
        {/* STATED, AND STATED AT ZERO (UX-DR20). Not a live region: only
            confirmations announce. */}
        <Badge variant="secondary">
          {t('organization.hourBands.count', { count: rows.length })}
        </Badge>
      </CardHeader>
      {rows.length === 0 ? null : (
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
                <TableCell>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="tabular-nums">
                      {t(durationMessageKey(row.durationMinutes), durationValuesOf(row.durationMinutes))}
                    </span>
                    {/* A pill whose TEXT is the meaning; no status colour. */}
                    {row.crossesMidnight ? (
                      <Badge variant="outline">{t('organization.hourBands.crossesMidnight')}</Badge>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <Button asChild variant="ghost" className="h-11 w-11 px-0">
                    <Link to="/organizacija/satni-pojasi/$id" params={{ id: row.band.id }}>
                      <Pencil aria-hidden />
                      <span className="sr-only">
                        {t('organization.hourBands.edit', { name: row.band.name })}
                      </span>
                    </Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
