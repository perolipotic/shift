import { useState, type ReactNode, type SyntheticEvent } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ClockCounterClockwise } from '@/components/ui/icon';
import { PageActions } from '@/components/ui/page-header';
import { StackedField, StackedFields, StackedList, StackedRow } from '@/components/ui/stacked-list';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { usePhone } from '@/hooks/viewport';
import { t } from '@/lib/i18n';
import {
  rotationHistoryAuthorMessageKey,
  rotationHistoryStatusMessageKey,
  type RotationHistoryRow,
} from '@/features/rotation/services/history';

/**
 * `Povijest rotacije` behind a header button (story 7.18, decision 27): every
 * saved change, newest first — when it takes effect, its status, who saved it
 * and when, and how many teams it binds — in a dialog of its own rather than
 * on the page after the builder. It only reads, so it has no Save.
 *
 * MOUNTED ALWAYS and driven by `open`, so ✕, the backdrop and Escape all
 * close it through the element's own `close()`, and the browser returns focus
 * to the button. Below 640 px the rows stack instead (story 7.6's pattern,
 * UX-DR17), named by the dialog's heading: the effective date and the status
 * on the first line, who saved it and when, and the team count under them.
 */
export function RotationHistoryDialog({ rows }: { readonly rows: readonly RotationHistoryRow[] }): ReactNode {
  const [open, setOpen] = useState(false);
  const isPhone = usePhone();
  const heading = t('rotation.builder.history.heading');

  return (
    <PageActions>
      <Button
        className="h-11"
        type="button"
        variant="outline"
        aria-haspopup="dialog"
        onClick={() => {
          setOpen(true);
        }}
      >
        <ClockCounterClockwise aria-hidden />
        {heading}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        // ESCAPE closes through the screen's state, like ✕ and the backdrop.
        onCancel={(event: SyntheticEvent<HTMLDialogElement>) => {
          event.preventDefault();
          setOpen(false);
        }}
        aria-labelledby="rotation-history-heading"
        className="max-w-3xl"
      >
        <DialogHeader
          closeLabel={t('rotation.builder.history.close')}
          onClose={() => {
            setOpen(false);
          }}
        >
          <DialogTitle id="rotation-history-heading">{heading}</DialogTitle>
          <DialogDescription>{t('rotation.builder.history.lede')}</DialogDescription>
        </DialogHeader>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('rotation.builder.history.empty')}</p>
        ) : null}
        {rows.length === 0 ? null : isPhone ? (
          <StackedList aria-label={heading} className="-mx-6 border-t [&>li]:px-6">
            {rows.map((row) => (
              <StackedRow key={row.key} className="gap-1">
                <StackedFields className="flex flex-wrap items-center gap-2">
                  <StackedField label={t('rotation.builder.history.columnEffective')} labelHidden>
                    <span className="font-semibold">{row.effectiveLabel}</span>
                  </StackedField>
                  <StackedField label={t('rotation.builder.history.columnStatus')} labelHidden>
                    {renderStatus(row)}
                  </StackedField>
                </StackedFields>
                <StackedFields className="flex flex-wrap items-center text-sm text-muted-foreground">
                  <StackedField label={t('rotation.builder.history.columnAuthor')} labelHidden>
                    {renderAuthor(row)}
                  </StackedField>
                  <StackedField label={t('rotation.builder.history.columnSaved')} labelHidden separated>
                    {renderSaved(row)}
                  </StackedField>
                  <StackedField label={t('rotation.builder.history.columnTeams')} labelHidden separated>
                    {renderTeams(row)}
                  </StackedField>
                </StackedFields>
              </StackedRow>
            ))}
          </StackedList>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('rotation.builder.history.columnEffective')}</TableHead>
                <TableHead>{t('rotation.builder.history.columnStatus')}</TableHead>
                <TableHead>{t('rotation.builder.history.columnAuthor')}</TableHead>
                <TableHead>{t('rotation.builder.history.columnSaved')}</TableHead>
                <TableHead>{t('rotation.builder.history.columnTeams')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.key}>
                  <TableCell className="whitespace-nowrap font-semibold tabular-nums">{row.effectiveLabel}</TableCell>
                  <TableCell className="whitespace-nowrap">{renderStatus(row)}</TableCell>
                  <TableCell className="whitespace-nowrap">{renderAuthor(row)}</TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">{renderSaved(row)}</TableCell>
                  <TableCell className="whitespace-nowrap">{renderTeams(row)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Dialog>
    </PageActions>
  );
}

/** THE STATUS IN WORDS: the badge's colour adds nothing the text does not say. */
function renderStatus(row: RotationHistoryRow): ReactNode {
  return <Badge variant="outline">{t(rotationHistoryStatusMessageKey(row.status))}</Badge>;
}

/** Who saved the change, or the unknown author's words. */
function renderAuthor(row: RotationHistoryRow): ReactNode {
  return row.author ?? t(rotationHistoryAuthorMessageKey());
}

/** When it was saved. */
function renderSaved(row: RotationHistoryRow): ReactNode {
  return t('rotation.builder.history.savedAt', { date: row.savedDate, time: row.savedTime });
}

/** How many teams it binds. */
function renderTeams(row: RotationHistoryRow): ReactNode {
  return t('rotation.builder.history.teamCount', { count: row.teamCount });
}
