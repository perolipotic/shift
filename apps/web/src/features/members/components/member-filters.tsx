import { Search } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupIcon } from '@/components/ui/input-group';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { t } from '@/lib/i18n';
import type { MemberList } from '@/features/members/hooks/use-member-list';
import {
  LEVEL_FILTERS,
  isNarrowed,
  levelFilterMessageKey,
  teamFilterMessageKey,
} from '@/features/members/services/list';

/**
 * The member list's search, its two filters and the reset.
 *
 * ITS OWN COMPONENT rather than markup inside the table's card, for the reason
 * `organizacija.tsx`'s `renderSettings` is a function: `eslint.config.js`'s L2
 * block refuses a string literal in a branch nested in a branch that is an
 * element's own child, and the controls' conditional `aria-describedby` sits
 * inside the card's branch.
 */
export function MemberFilters({ list }: { readonly list: MemberList }): ReactNode {
  const {
    search,
    searchField,
    changeSearch,
    unanswered,
    refusal,
    level,
    changeLevel,
    narrowed,
    changeTeam,
    resetFilters,
  } = list;

  return (
    <div className="grid items-end gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,12rem)_minmax(0,12rem)_auto]">
      <div className="grid min-w-0 gap-2 sm:col-span-2 lg:col-span-1">
        <Label htmlFor="ljudi-search">{t('ljudi.search')}</Label>
        <InputGroup>
          <InputGroupIcon>
            <Search />
          </InputGroupIcon>
          <Input
            id="ljudi-search"
            ref={searchField}
            type="search"
            className="h-11 w-full"
            value={search}
            onChange={changeSearch}
            disabled={unanswered}
            aria-describedby={refusal === null ? undefined : 'ljudi-error'}
          />
        </InputGroup>
      </div>
      <div className="grid min-w-0 gap-2">
        <Label htmlFor="ljudi-level">{t('ljudi.role')}</Label>
        {/* A NATIVE `<select>`, as the accent control on `/organizacija` is:
            it carries its own keyboard behaviour on every platform and its own
            picker on a phone, which is what a custom listbox has to
            reimplement and usually reimplements worse. Every option states its
            own count (UX-DR19), and the counts come out of the same call the
            rows do so the two cannot disagree. It carries the `disabled` and
            `aria-describedby` handling its precedent does, because a control
            that looks identical and behaves differently is worse than one that
            looks different. */}
        <Select
          id="ljudi-level"
          className="h-11"
          value={level}
          onChange={changeLevel}
          disabled={unanswered}
          aria-describedby={refusal === null ? undefined : 'ljudi-error'}
        >
          {LEVEL_FILTERS.map((option) => (
            <option key={option} value={option}>
              {t(levelFilterMessageKey(option), { count: narrowed.counts[option] })}
            </option>
          ))}
        </Select>
      </div>
      <div className="grid min-w-0 gap-2">
        <Label htmlFor="ljudi-team">{t('smjene.membership.column')}</Label>
        {/* THE TEAM FILTER, the level filter's twin: native, the same literal
            class, the same `disabled` and `aria-describedby`. Its options are
            the teams somebody is on today, derived from the one snapshot, and
            its value is the team the rows were ACTUALLY narrowed by — so a
            team that vanished on a refetch shows as every team rather than
            claiming a filter the rows ignore. Team names are data,
            interpolated. */}
        <Select
          id="ljudi-team"
          className="h-11"
          value={narrowed.team}
          onChange={changeTeam}
          disabled={unanswered}
          aria-describedby={refusal === null ? undefined : 'ljudi-error'}
        >
          {narrowed.teams.map((option) => (
            <option key={option.value} value={option.value}>
              {t(teamFilterMessageKey(option.value), { count: option.count, team: option.team })}
            </option>
          ))}
        </Select>
      </div>
      {/* DEAD WHILE THERE IS NOTHING TO RESET, and while the list is
          unanswered, for the reason the two filters are. Whether anything is
          narrowed is `isNarrowed`'s decision, over the team the rows were
          actually narrowed by. */}
      <Button
        variant="outline"
        className="h-11"
        onClick={resetFilters}
        disabled={unanswered || !isNarrowed(search, level, narrowed.team)}
      >
        {t('ljudi.reset')}
      </Button>
    </div>
  );
}
