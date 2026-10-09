import { Search } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupIcon } from '@/components/ui/input-group';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { StackedSkeletonRow } from '@/components/ui/stacked-list';
import { LeaveOverviewRows } from '@/features/leave/components/leave-overview-rows';
import { LeaveOverviewTable } from '@/features/leave/components/leave-overview-table';
import type { LeaveOverviewScreen } from '@/features/leave/hooks/use-leave-overview';
import { OVERVIEW_EMPTY_SEARCH, OVERVIEW_LOADING, OVERVIEW_UNAVAILABLE } from '@/features/leave/services/leave-overview';
import { usePhone } from '@/hooks/viewport';
import { t } from '@/lib/i18n';

const SKELETON_ROWS = [0, 1, 2, 3];

/**
 * The admin's *Godišnji* under its heading (story 7.15): *Traži osobu*, the
 * summary line, and the overview — a table from 640 px, stacked rows below
 * it. The skeleton while the reads are unanswered, one alert with a retry
 * when any read failed, and in place of the rows one line that states what is
 * true: nobody active today, or no name matching the search with *Poništi
 * pretragu*. Read-only: leave is recorded on the member page. What is drawn is
 * `leaveOverviewOf`'s; this only puts it on screen.
 */
export function LeaveOverviewBody({ screen }: { readonly screen: LeaveOverviewScreen }): ReactNode {
  const { overview, search, searchField, changeSearch, clearSearch, pressColumn, retry } = screen;
  // Story 7.6: which form the overview takes. The search and the sort live in
  // the URL, so crossing 640 px keeps both.
  const isPhone = usePhone();

  function renderBody(): ReactNode {
    if (overview.kind === OVERVIEW_LOADING) {
      // IN THE ROW'S SHAPE (UX-DR21): stacked skeleton rows on a phone — the
      // name, the team and *Preostalo* over *Pravo* and *Iskorišteno* — and
      // table-height bars from 640 px. Never a spinner.
      return isPhone ? (
        <ul aria-hidden className="grid divide-y border-y pb-4">
          {SKELETON_ROWS.map((row) => (
            <StackedSkeletonRow key={row} figures={2} />
          ))}
        </ul>
      ) : (
        <div aria-hidden className="grid gap-3 px-4 pb-4">
          {SKELETON_ROWS.map((row) => (
            <div key={row} className="h-11 w-full animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      );
    }

    if (overview.kind === OVERVIEW_UNAVAILABLE) {
      return (
        <div className="grid min-w-0 gap-2 px-4 pb-4">
          <Notice role="alert">{t('godisnji.unavailable')}</Notice>
          <Button className="h-11 w-full sm:w-auto sm:justify-self-start" type="button" variant="outline" onClick={retry}>
            {t('godisnji.retry')}
          </Button>
        </div>
      );
    }

    let empty: ReactNode;

    if (overview.empty === OVERVIEW_EMPTY_SEARCH) {
      empty = (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2">
          <p className="text-base">{t('godisnji.overview.noMatch')}</p>
          <Button className="h-11" type="button" variant="outline" onClick={clearSearch}>
            {t('godisnji.overview.clear')}
          </Button>
        </div>
      );
    } else {
      empty = <p className="py-2 text-base">{t('godisnji.overview.none')}</p>;
    }

    return (
      <div className="grid min-w-0 gap-3 pb-4">
        <p className="px-4 text-sm text-muted-foreground tabular-nums">
          {t('godisnji.overview.summary', {
            count: overview.summary.shown,
            used: overview.summary.usedDays,
            allowance: overview.summary.allowanceDays,
          })}
        </p>
        {isPhone ? (
          <LeaveOverviewRows overview={overview} empty={empty} onPress={pressColumn} />
        ) : (
          <LeaveOverviewTable overview={overview} empty={empty} onPress={pressColumn} />
        )}
      </div>
    );
  }

  return (
    <div className="grid min-w-0 gap-4">
      <div className="grid min-w-0 px-4 pt-4 sm:max-w-sm">
        <Label htmlFor="godisnji-overview-search" className="sr-only">
          {t('godisnji.overview.search')}
        </Label>
        <InputGroup>
          <InputGroupIcon>
            <Search />
          </InputGroupIcon>
          <Input
            id="godisnji-overview-search"
            ref={searchField}
            type="search"
            className="h-11 w-full"
            placeholder={t('godisnji.overview.search')}
            value={search}
            onChange={changeSearch}
          />
        </InputGroup>
      </div>
      {renderBody()}
    </div>
  );
}
