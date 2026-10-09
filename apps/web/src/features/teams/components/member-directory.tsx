import { Search } from 'lucide-react';
import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupIcon } from '@/components/ui/input-group';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { RosterLines } from '@/features/teams/components/roster-lines';
import type { MemberDirectoryScreen } from '@/features/teams/hooks/use-member-directory';
import {
  DIRECTORY_LOADING,
  DIRECTORY_UNAVAILABLE,
  directoryHeadingIdOf,
  type DirectoryGroup,
} from '@/features/teams/services/directory';
import { t } from '@/lib/i18n';

const SKELETON_GROUPS = [0, 1];
const SKELETON_ROWS = [0, 1, 2];

/**
 * The member directory on `/ljudi` (story 7.17): *Traži osobu*, then every
 * active team as a card — its name, *tvoja smjena* on the caller's own, its
 * count, and today's members as `Ime · čin · položaj`.
 *
 * READ-ONLY. No link from a line (never to `/ljudi/$id`), no write, and
 * nothing beside a name but rank and position. What is drawn, in what order
 * and with which count is `memberDirectoryOf`'s; this only puts it on screen.
 *
 * The helpers are declared inside the component, at its two-space
 * indentation, so the sign-in suite's scoped extraction reads each one.
 */
export function MemberDirectory({ screen }: { readonly screen: MemberDirectoryScreen }): ReactNode {
  const { directory, search, searchField, changeSearch, clearSearch, retry, shown, positionShown } = screen;

  function renderGroup(group: DirectoryGroup): ReactNode {
    const headingId = directoryHeadingIdOf(group);

    return (
      <Card key={group.id} className="min-w-0 p-4 sm:p-6">
        <section aria-labelledby={headingId} className="grid min-w-0 content-start gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <h2 id={headingId} className="min-w-0 break-words font-heading text-lg font-bold">
              {group.name}
            </h2>
            {/* WORDS, never a colour alone: the caller's own team says so. */}
            {group.own ? <Badge>{t('ljudi.directory.own')}</Badge> : null}
            <span className="ml-auto text-sm tabular-nums text-muted-foreground">
              {t('smjene.roster.count', { count: group.members.length })}
            </span>
          </div>
          <RosterLines members={group.members} shown={shown} positionShown={positionShown} />
        </section>
      </Card>
    );
  }

  function renderBody(): ReactNode {
    if (directory.kind === DIRECTORY_LOADING) {
      return (
        <div className="grid gap-4 lg:grid-cols-2">
          {SKELETON_GROUPS.map((group) => (
            <Card key={group} className="grid gap-3 p-4 sm:p-6">
              <div className="h-6 w-1/3 animate-pulse rounded-md bg-muted" />
              {SKELETON_ROWS.map((row) => (
                <div key={row} className="h-6 w-full animate-pulse rounded-md bg-muted" />
              ))}
            </Card>
          ))}
        </div>
      );
    }

    if (directory.kind === DIRECTORY_UNAVAILABLE) {
      return (
        <Card className="grid min-w-0 gap-2 p-4 sm:p-6">
          <Notice role="alert">{t('ljudi.directory.unavailable')}</Notice>
          <Button className="h-11 w-full sm:w-auto sm:justify-self-start" type="button" variant="outline" onClick={retry}>
            {t('ljudi.directory.retry')}
          </Button>
        </Card>
      );
    }

    if (directory.groups.length === 0) {
      return directory.searched ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="text-base">{t('ljudi.directory.noMatch')}</p>
          <Button className="h-11" type="button" variant="outline" onClick={clearSearch}>
            {t('ljudi.directory.clear')}
          </Button>
        </div>
      ) : (
        <p className="text-base">{t('ljudi.directory.noTeams')}</p>
      );
    }

    return <div className="grid gap-4 lg:grid-cols-2">{directory.groups.map(renderGroup)}</div>;
  }

  return (
    <div className="grid min-w-0 gap-4">
      <div className="grid min-w-0 sm:max-w-sm">
        <Label htmlFor="ljudi-directory-search" className="sr-only">
          {t('ljudi.directory.search')}
        </Label>
        <InputGroup>
          <InputGroupIcon>
            <Search />
          </InputGroupIcon>
          <Input
            id="ljudi-directory-search"
            ref={searchField}
            type="search"
            className="h-11 w-full"
            placeholder={t('ljudi.directory.search')}
            value={search}
            onChange={changeSearch}
          />
        </InputGroup>
      </div>
      {renderBody()}
    </div>
  );
}
