import { History } from 'lucide-react';
import { useState, type ReactNode, type SyntheticEvent } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PageActions } from '@/components/ui/page-header';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
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
 * to the button. The table scrolls inside its own box, as it did on the page.
 */
export function RotationHistoryDialog({ rows }: { readonly rows: readonly RotationHistoryRow[] }): ReactNode {
  const [open, setOpen] = useState(false);

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
        <History aria-hidden />
        {t('rotation.builder.history.heading')}
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
          <DialogTitle id="rotation-history-heading">{t('rotation.builder.history.heading')}</DialogTitle>
          <DialogDescription>{t('rotation.builder.history.lede')}</DialogDescription>
        </DialogHeader>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('rotation.builder.history.empty')}</p>
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
                  <TableCell className="whitespace-nowrap">
                    {/* THE STATUS IN WORDS: the badge's colour adds nothing the text does not say. */}
                    <Badge variant="outline">{t(rotationHistoryStatusMessageKey(row.status))}</Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {row.author ?? t(rotationHistoryAuthorMessageKey())}
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    {t('rotation.builder.history.savedAt', { date: row.savedDate, time: row.savedTime })}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {t('rotation.builder.history.teamCount', { count: row.teamCount })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Dialog>
    </PageActions>
  );
}
