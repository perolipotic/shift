import { Link } from '@tanstack/react-router';
import { Pencil } from 'lucide-react';
import type { ReactNode } from 'react';

import { SortControl } from '@/components/sort-control';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { usePhone } from '@/hooks/viewport';
import { t } from '@/lib/i18n';
import { CellView } from '@/features/members/components/cell-view';
import { MemberFilters } from '@/features/members/components/member-filters';
import { MemberRows } from '@/features/members/components/member-rows';
import type { MemberList } from '@/features/members/hooks/use-member-list';
import {
  EMAIL_COLUMN,
  MEMBER_COLUMNS,
  cellClassNameOf,
  memberActionName,
  sortDirectionIndicatorOf,
  sortIndicatorOf,
  sortStateOf,
} from '@/features/members/services/list';
import { SORT_GLYPHS } from '@/features/members/utils/sort-glyphs';

/** How many skeleton rows stand in for the list while it loads. Enough to show
 *  that a LIST is coming rather than a single figure, and few enough not to
 *  promise a length the answer may not have. */
const SKELETON_ROWS = [0, 1, 2, 3, 4];

/**
 * The member list's card: the filters at its head, then the table — or, below
 * 640 px, the shared sort control and the same rows stacked (story 7.6). Only
 * one of the two forms is in the DOM; the sort lives in `useMemberList`, so
 * crossing 640 px keeps it, and the control's pick is the heading's press.
 *
 * ONE SCROLL CONTAINER. `Table` wraps itself in `overflow-auto`
 * (`components/ui/table.tsx`), which is the container DESIGN.md §Layout &
 * Spacing grants this table from 640 px; nothing here nests a second, below
 * 640 px there is no table to scroll (story 7.6), and the page body never
 * scrolls sideways at any width.
 *
 * THE ROW ACTION NAMES THE MEMBER IT ACTS ON. Several hundred rows carrying one
 * repeated accessible name is a list a screen-reader user cannot navigate: the
 * action is reached, announced as "Uredi osobu", and gives no way to tell which
 * of four hundred it would open. `ljudi.form.edit` interpolates the name, which
 * is DATA — the one thing on this surface that is never a key.
 *
 * `aria-sort` IS RENDERED ONLY BY COLUMNS THAT SORT. The actions column is not
 * one, and announcing `none` on it offers assistive technology exactly the
 * affordance the column exists without: `none` is a sortable column that is not
 * currently sorted, so a screen reader reports a control that is not there.
 */
export function MemberTable({ list }: { readonly list: MemberList }): ReactNode {
  const { sort, pressColumn, unanswered, loading, narrowed, today } = list;
  const isPhone = usePhone();

  return unanswered && !loading ? null : (
    <Card className="min-w-0">
      {/* THE FILTERS, at the head of the table they narrow. */}
      <CardContent className="border-b p-4">
        <MemberFilters list={list} />
      </CardContent>
      {/* TWO CONTAINERS rather than one ternary between the forms, for the
          bare-JSX sweep's reason given below. */}
      {isPhone ? (
        <div className="grid min-w-0 gap-1 pt-2">
          {/* THE COLUMNS THE ROW SHOWS: the address is not on a phone, so it
              is not offered, yet still names the control while it is the
              sorted one (sorted from 640 px, then narrowed). */}
          <SortControl
            columns={MEMBER_COLUMNS.map((column) => ({
              key: column.key,
              label: t(column.label),
              listed: column.key !== EMAIL_COLUMN,
            }))}
            active={sort.key}
            direction={sortDirectionIndicatorOf(sort)}
            disabled={unanswered}
            onPick={pressColumn}
          />
          <MemberRows list={list} />
        </div>
      ) : null}
      {isPhone ? null : (
        <Table>
          <TableCaption>{t('ljudi.caption')}</TableCaption>
          <TableHeader>
            <TableRow>
              {MEMBER_COLUMNS.map((column) => {
                // BOTH HALVES OF THE SORT SIGNAL COME FROM THE SAME MODULE, so
                // they cannot disagree: `sortStateOf` is what a screen reader
                // hears and `sortIndicatorOf` is what a sighted person sees, and
                // an arrow pointing the wrong way beside a correct `aria-sort`
                // is worse than no arrow at all. UX-DR37: colour is never the
                // sole carrier of meaning, and neither is a screen reader.
                const indicator = sortIndicatorOf(sort, column.key);
                const Glyph = indicator === null ? null : SORT_GLYPHS[indicator];
                const press = (): void => {
                  pressColumn(column.key);
                };

                return (
                  <TableHead key={column.key} aria-sort={sortStateOf(sort, column.key)}>
                    <Button
                      variant="ghost"
                      className="h-auto min-h-11 w-full justify-start gap-2 whitespace-normal px-2 py-1 text-left"
                      onClick={press}
                      disabled={unanswered}
                    >
                      {/* A LONG HEADING WRAPS (design refresh C) rather than
                          widening its column: `Dani godišnjeg odmora` on one
                          line pushed the actions column past the card. The
                          44 px floor holds as a minimum height. */}
                      <span>{t(column.label)}</span>
                      {Glyph === null ? null : <Glyph aria-hidden className="size-4 shrink-0" />}
                    </Button>
                  </TableHead>
                );
              })}
              {/* NO `aria-sort` HERE. The four above sort; this one holds a
                  control, and `none` would announce it as a sortable column
                  that happens not to be sorted — an affordance that does not
                  exist. It carries a real heading rather than an empty cell,
                  because a `<th>` with no text is announced as nothing. */}
              <TableHead className="text-right">{t('ljudi.form.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {/* TWO CONTAINERS rather than one ternary between them, and that is
                a constraint of this repository rather than a style: the bare-JSX
                sweep in `prijava.test.ts` reads every run between a `>` and the
                next `<`, and the middle of a multi-line ternary is exactly such
                a run with no braces in it. The skeleton and the rows are
                mutually exclusive either way. */}
            {loading
              ? SKELETON_ROWS.map((row) => (
                  <TableRow key={row}>
                    {MEMBER_COLUMNS.map((column) => (
                      <TableCell key={column.key}>
                        <div className="h-4 w-full animate-pulse rounded-md bg-muted" />
                      </TableCell>
                    ))}
                    <TableCell>
                      <div className="h-4 w-full animate-pulse rounded-md bg-muted" />
                    </TableCell>
                  </TableRow>
                ))
              : null}
            {loading
              ? null
              : narrowed.rows.map((member) => (
                  <TableRow key={member.id}>
                    {MEMBER_COLUMNS.map((column) => (
                      <TableCell key={column.key} className={cellClassNameOf(column)}>
                        <CellView cell={column.cell(member, today)} />
                      </TableCell>
                    ))}
                    <TableCell className="text-right">
                      {/* NAMED FOR THE MEMBER IT ACTS ON. Four hundred rows
                          each announcing "Uredi osobu" is four hundred controls
                          a screen-reader user cannot tell apart; the name is
                          data, interpolated, and the label is the whole
                          accessible name rather than an `aria-label` competing
                          with visible text. */}
                      <Button asChild variant="ghost" className="h-11 w-11 px-0">
                        <Link to="/ljudi/$id" params={{ id: member.id }}>
                          <Pencil aria-hidden />
                          <span className="sr-only">
                            {t('ljudi.form.edit', { name: memberActionName(member) })}
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
