import { useQuery } from '@tanstack/react-query';
import { Link, createRoute, redirect } from '@tanstack/react-router';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';

import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageActions, PageHeader, PageTitle } from '@/components/ui/page-header';
import { StatCard, StatLabel, StatValue } from '@/components/ui/stat-card';
import { Notice } from '@/components/ui/notice';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatNumber } from '@/i18n/format';
import { t } from '@/i18n';
import {
  ALL_LEVELS,
  ALL_TEAMS,
  ARROW_DOWN,
  ARROW_UP,
  DAYS_CELL,
  DEFAULT_SORT,
  LEVEL_CELL,
  TEAM_CELL,
  LEVEL_FILTERS,
  MEMBERS_TABLE,
  MEMBER_COLUMNS,
  NAME_CELL,
  INACTIVE_NAME_CELL,
  SCHEDULED_INACTIVE_NAME_CELL,
  NO_TEXT,
  TEXT_CELL,
  cellClassNameOf,
  chooseLevel,
  chooseTeam,
  isNarrowed,
  levelFilterMessageKey,
  mayReadMembers,
  memberActionName,
  memberCellLookOf,
  memberLevelMessageKey,
  membersMessageKey,
  membersViewOf,
  membersSurfaceStateOf,
  narrowingDependencies,
  nextSortState,
  membersTodayOf,
  membersQueryOptions,
  sortIndicatorOf,
  sortStateOf,
  teamFilterMessageKey,
  teamToStore,
  type LevelFilter,
  type MemberCell,
  type MemberColumnKey,
  type NarrowingInputs,
  type SortIndicator,
  type TeamFilter,
} from '@/members/list';
import { DESTINATIONS } from '@/navigation/destinations';
import { MEMBER_ROLE_UNAVAILABLE, type MemberRoleOutcome } from '@/navigation/role';
import { appLayoutRoute } from '@/routes/_app';
import { supabaseClient } from '@/supabase/client';

/**
 * `Ljudi` — the member list (story 1.5a).
 *
 * ADMIN ONLY, AND THIS IS THE FIRST ROUTE IN THE TREE WHERE THAT IS TRUE. Every
 * other destination leaves role entirely to the database (AD-10), and `_app.tsx`
 * records why: the eight screens held no data, so there was nothing for a route
 * check to protect. This one holds every colleague's address and leave
 * allowance. UX-DR31 gives the member role no configuration surface at all and
 * UX-DR32 groups `Ljudi` under configuration, so the member-facing view of
 * people is story 1.8's team detail — names and membership only. Without the
 * guard below, `/ljudi` would hand every member a superset of that by typing a
 * URL.
 *
 * THE GUARD PROTECTS NOTHING AGAINST A DIRECT API CALL, and it is not pretending
 * to: `members_select_own_organization` deliberately carries no role filter
 * (`0003:286-288`), because a member has to read the list to see who is on a
 * team. What the guard settles is an IA question — which screen a level reaches
 * — and the database still settles who may read what.
 *
 * ONE SNAPSHOT, ONE QUERY KEY (AD-13). Every figure below — the rows, the stated
 * count, the counts beside both filters, and the team options themselves —
 * comes from the single `useQuery` under `MEMBERS_LIST_KEY` and is derived by
 * `narrowMembers`. There is no second read on this screen and there must not be
 * one: the team options are the teams somebody is on today, never a read of
 * `teams`.
 *
 * THIS FILE HOLDS MARKUP AND STATE, NOTHING ELSE. Every rule — the fold, the
 * collation, the sort toggle, the level and team fallbacks, the faceted counts,
 * whether the reset has anything to reset, the labels — is a
 * pure function in `@/members/list`, because a `.tsx` is collected by nothing
 * (AD-15) and the 1.5a review shipped two swapped sort keys green when the
 * pairing lived here.
 *
 * ONE SCROLL CONTAINER. `Table` wraps itself in `overflow-auto`
 * (`components/ui/table.tsx`), which is the container `DESIGN.md:150` grants
 * this screen; nothing here nests a second, and the page body never scrolls
 * sideways at any width.
 *
 * TWO WAYS OUT OF THIS SCREEN AND NO WRITE ON IT (story 1.5b). Creating and
 * editing a member are `/ljudi/novi` and `/ljudi/$id`; this screen links to
 * them and performs neither. Resetting a password and deactivating a member
 * (story 1.6) live on `/ljudi/$id` too; this screen only MARKS an inactive
 * member, in words, as at the organization's today.
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

/**
 * Where a refused session is sent: the FIRST destination, in binding order.
 *
 * READ FROM THE TABLE rather than written as a path here, and REUSING what `/`
 * already decided (`routes/index.tsx`): "where does a person belong" is one
 * question, and a second answer to it in this file is the one that goes stale
 * silently the day the table's first row changes. The first row is reachable by
 * every role, which is what makes it a safe target for a forward that happens
 * precisely because this role reaches nothing here.
 */
const FIRST_DESTINATION = DESTINATIONS[0];

/** How many skeleton rows stand in for the list while it loads. Enough to show
 *  that a LIST is coming rather than a single figure, and few enough not to
 *  promise a length the answer may not have. */
const SKELETON_ROWS = [0, 1, 2, 3, 4];

/**
 * The glyph each sort direction draws.
 *
 * A RECORD KEYED BY THE MODULE'S OWN NAMES, never a ternary: which way the arrow
 * points is `sortIndicatorOf`'s decision and is pinned by execution, and what is
 * left here is only the pairing of a direction to an icon. `prijava.test.ts`
 * pins THAT at source level, because a rendered icon is the one thing no node
 * test can see — and an arrow pointing the wrong way is worse than none, since
 * it contradicts a correct `aria-sort` on the same element.
 */
const SORT_GLYPHS: Record<SortIndicator, typeof ArrowUp> = {
  [ARROW_UP]: ArrowUp,
  [ARROW_DOWN]: ArrowDown,
};

/**
 * What one cell shows, from the value its COLUMN produced.
 *
 * IT TAKES A CELL, NOT A MEMBER, and that is the whole point of the refactor
 * this replaces. The previous version read `member.name`, `member.email` and
 * `member.leaveAllowanceDays` here — in a file vitest never executes (AD-15) —
 * so swapping two of its branches rendered every address under `Ime` with the
 * entire suite green. The column now says what its cell HOLDS
 * (`@/members/list`, pinned there beside `sortValue`), and this function only
 * knows how to render each kind.
 *
 * EXHAUSTIVE, with `never` at the end: a fifth kind is a `pnpm typecheck`
 * failure here until it is told what to draw. `t()` and the number formatter
 * live on this side because a data module calling them would need i18next
 * initialised to be testable at all.
 */
function cellContent(cell: MemberCell): string {
  // VISUAL REFRESH B: every name kind renders its name untouched. The inactive
  // marker moved out of the name and into a badge beside it, whose words
  // `memberCellLookOf` decides.
  if (
    cell.kind === TEXT_CELL ||
    cell.kind === NAME_CELL ||
    cell.kind === INACTIVE_NAME_CELL ||
    cell.kind === SCHEDULED_INACTIVE_NAME_CELL
  ) {
    return cell.text;
  }
  if (cell.kind === LEVEL_CELL) return t(memberLevelMessageKey(cell.level));
  // STORY 1.7b: the team today, and "no team" in positive words — never a
  // blank cell, which would read as a value that did not load.
  if (cell.kind === TEAM_CELL) return cell.team ?? t('smjene.membership.none');
  // `fractionDigits: 0` — an allowance is a whole number of days, and `20,00`
  // in a column of them is the wobble UX-DR40's tabular numerals prevent.
  if (cell.kind === DAYS_CELL) return formatNumber(cell.days, 0);

  const unhandled: never = cell;

  return unhandled;
}

/**
 * One cell, drawn the way `memberCellLookOf` decides (visual refresh B): an
 * initials chip beside every name, a badge for the level, and the inactive
 * marker's badge with its words. EVERY DECISION IS THE MODULE'S; this only
 * passes the marker's key and argument to `t()`.
 *
 * The chip is decorative and hidden by the primitive, and it is drawn EMPTY
 * for a name with no letter so the names stay aligned. The marker is preceded
 * by a visually hidden separator from `hr.json`, so a screen reader announces
 * the name and the marker as two things rather than one run of words.
 */
function CellView({ cell }: { readonly cell: MemberCell }): ReactNode {
  const look = memberCellLookOf(cell);
  const text = cellContent(cell);

  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-x-3 gap-y-1">
      {look.avatar === null ? null : <Avatar>{look.avatar.initials}</Avatar>}
      {look.badge === null ? <span>{text}</span> : <Badge variant={look.badge}>{text}</Badge>}
      {look.status === null ? null : (
        <span>
          <span className="sr-only">{t('ljudi.status.separator')}</span>
          <Badge variant={look.status.variant}>{t(look.status.key, look.status.args)}</Badge>
        </span>
      )}
    </span>
  );
}

export function LjudiScreen() {
  const [search, setSearch] = useState(NO_TEXT);
  const [level, setLevel] = useState<LevelFilter>(ALL_LEVELS);
  const [team, setTeam] = useState<TeamFilter>(ALL_TEAMS);
  const searchField = useRef<HTMLInputElement>(null);
  const [sort, setSort] = useState(DEFAULT_SORT);

  const answer = useQuery(membersQueryOptions(() => supabaseClient().from(MEMBERS_TABLE)));

  // EVERY STATE THIS SCREEN CAN BE IN, decided in `@/members/list` and pinned by
  // execution over real query results. Written here it was four lines of
  // conditional that vitest never ran: replacing `answer.isError || paused` with
  // `paused` shipped green, and a thrown query function then rendered headings
  // with no rows, no count and no message.
  const state = membersSurfaceStateOf(answer);
  const { members, refusal, loading } = state;
  // THE ORGANIZATION'S TODAY, for the inactive marker (story 1.6), from the zone
  // the same one read embeds — `null` until it has settled, which marks nobody.
  const today = membersTodayOf(members, new Date());

  // ONE OBJECT, and the memo's dependencies are DERIVED from it rather than
  // written beside it. `eslint.config.js` registers no `react-hooks` plugin, so
  // nothing lints a dependency array here; dropping `sort` from a hand-written
  // one left the suite green and eslint clean while the arrow flipped and the
  // rows never moved. There is only one list of inputs now, and
  // `members/list.test.ts` pins what it contains.
  const inputs: NarrowingInputs = { members, search, level, team, sort, today };
  // THE SUMMARY ROW COMES OUT OF THE SAME CALL, from the snapshot and never
  // from the narrowed rows: `membersViewOf` is executed by `members/list.test.ts`
  // with a search that matches nobody, and the four figures still count everyone.
  const { summary, narrowed } = useMemo(
    () => membersViewOf(inputs),
    narrowingDependencies(inputs),
  );

  // THE CONTROLS ARE DEAD WHILE THERE IS NOTHING TO NARROW. A live filter over
  // an absent list renders `Sve razine: 0 osoba` beside a failure message, and
  // `0 / 0 / 0` under a pulsing skeleton — a confidently wrong figure in the two
  // states where the surface knows it has no answer. Disabled, they say what is
  // true: there is nothing here to search yet.
  const unanswered = members === null;

  // A TEAM THAT LEFT THE OPTIONS LEAVES THE STATE TOO, adjusted during render
  // (React's documented pattern for state derived from props). It cannot loop:
  // once stored, the value IS the applied one and `teamToStore` returns it.
  const settledTeam = teamToStore(team, narrowed.team, members, today);
  if (settledTeam !== team) setTeam(settledTeam);

  function changeSearch(event: ChangeEvent<HTMLInputElement>): void {
    setSearch(event.target.value);
  }

  function changeLevel(event: ChangeEvent<HTMLSelectElement>): void {
    setLevel(chooseLevel(event.target.value));
  }

  // THE CHOICE IS LOOKED UP AMONG THE OPTIONS ON SCREEN, which are data: a
  // value that is not one of them falls back to every team rather than
  // narrowing to a list nobody explained.
  function changeTeam(event: ChangeEvent<HTMLSelectElement>): void {
    setTeam(chooseTeam(event.target.value, narrowed.teams));
  }

  // ONE ACTION FOR ALL THREE (UX-DR17): the search, the level and the team
  // return to their defaults together. The sort is not a filter and stays.
  function resetFilters(): void {
    setSearch(NO_TEXT);
    setLevel(ALL_LEVELS);
    setTeam(ALL_TEAMS);
    // THE PRESSED BUTTON IS ABOUT TO BE DISABLED, which would drop keyboard
    // focus to the page body. The search is where narrowing starts again.
    searchField.current?.focus();
  }

  function pressColumn(column: MemberColumnKey): void {
    setSort((current) => nextSortState(current, column));
  }

  return (
    <main
      className="mx-auto flex w-full min-w-0 max-w-5xl flex-1 flex-col gap-6 p-6"
      aria-busy={loading}
    >
      <PageHeader>
        <PageTitle asChild>
          <h1>{t('nav.ljudi')}</h1>
        </PageTitle>
        {/* THE WAY IN, and it is a LINK rather than a button that navigates:
            issuing an account is a screen, not an action performed here, so
            middle-click and "open in new tab" work the way they do everywhere
            else. `asChild` is what keeps the 44 px floor and the shared
            appearance on the anchor itself. */}
        <PageActions>
          {/* STORY 1.7a: the teams screen, reached from here rather than from
              the navigation, so the destinations stay eight. */}
          <Button asChild variant="outline" className="h-11">
            <Link to="/ljudi/smjene">{t('smjene.heading')}</Link>
          </Button>
          <Button asChild className="h-11">
            <Link to="/ljudi/novi">{t('ljudi.form.add')}</Link>
          </Button>
        </PageActions>
      </PageHeader>
      {summary === null ? null : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {summary.map((stat) => (
            <StatCard key={stat.label}>
              <StatLabel>{t(stat.label)}</StatLabel>
              {/* A FIGURE THAT CANNOT YET BE STATED is drawn pending, never
                  as a guessed zero: `membersSummaryOf` answers `null` for the
                  active and inactive counts while today is unknown. */}
              {stat.value === null ? (
                <div className="h-8 w-12 animate-pulse rounded-md bg-muted" />
              ) : (
                <StatValue>{formatNumber(stat.value, 0)}</StatValue>
              )}
            </StatCard>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-end gap-4">
        <div className="grid min-w-0 flex-1 gap-2">
          <Label htmlFor="ljudi-search">{t('ljudi.search')}</Label>
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
          <select
            id="ljudi-level"
            className="flex h-11 w-full rounded-md border-[1.5px] border-input bg-card px-3 text-sm transition-[border-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
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
          </select>
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
          <select
            id="ljudi-team"
            className="flex h-11 w-full rounded-md border-[1.5px] border-input bg-card px-3 text-sm transition-[border-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
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
          </select>
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
      {/* OUTSIDE the answered branch, and conditional on both sides: a read that
          produced no row never renders a table, so an explanation rendered
          inside one would be exactly the element nobody can see. `role="alert"`
          announces it on insertion, and both controls point at it by id so it is
          also reachable by moving between them. */}
      {refusal === null ? null : (
        <Notice id="ljudi-error" role="alert">
          {t(membersMessageKey(refusal))}
        </Notice>
      )}
      {unanswered && !loading ? null : (
        <Card className="min-w-0">
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
                        className="h-11 w-full justify-start gap-2 px-2"
                        onClick={press}
                        disabled={unanswered}
                      >
                        <span className="truncate">{t(column.label)}</span>
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
                <TableHead>{t('ljudi.form.actions')}</TableHead>
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
                      <TableCell>
                        {/* NAMED FOR THE MEMBER IT ACTS ON. Four hundred rows
                            each announcing "Uredi osobu" is four hundred controls
                            a screen-reader user cannot tell apart; the name is
                            data, interpolated, and the label is the whole
                            accessible name rather than an `aria-label` competing
                            with visible text. */}
                        <Button asChild variant="ghost" className="h-11">
                          <Link to="/ljudi/$id" params={{ id: member.id }}>
                            {t('ljudi.form.edit', { name: memberActionName(member) })}
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
            </TableBody>
          </Table>
        </Card>
      )}
      {/* STATED, AND STATED AT ZERO. A search matching nothing renders
          `Prikazano 0 osoba` rather than emptying the region: UX-DR20 states the
          fact rather than the absence, and a table that simply goes blank is
          indistinguishable from one that failed to load.

          `role="status"` is the live half. A skeleton says nothing to a screen
          reader, so without a polite region the surface finishes loading in
          silence and the reader has to go looking for what arrived; announcing
          the count is announcing exactly what changed. */}
      {unanswered ? null : (
        <p role="status" className="text-sm text-muted-foreground">
          {t('ljudi.count', { count: narrowed.rows.length })}
        </p>
      )}
    </main>
  );
}

export const ljudiRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/ljudi',
  /**
   * The role guard, and the first one in the tree.
   *
   * THE READER ARRIVES THROUGH THE ROUTER CONTEXT, exactly as `currentSession`
   * does, and for the same two reasons. It is what makes both branches
   * EXECUTABLE from the node suite — `router.test.ts` drives this with a real
   * `{ ok: true, role }` outcome and asserts the redirect and the pass — and it
   * is what keeps the block out of the environment: a `supabaseClient()` call
   * here throws `SUPABASE_ENVIRONMENT_MISSING` synchronously on a fresh clone
   * with no `.env.local`, which is how the 1.5a review's first iteration went
   * red on one assertion and vacuous on the rest.
   *
   * THE ROLE IS READ OUTSIDE THE QUERY CACHE, deliberately. `beforeLoad` runs
   * before the component tree, so the chrome's `MEMBER_ROLE_KEY` entry is not
   * reliably warm, and AD-13 governs two FIGURES on a screen coming from two
   * reads — not a guard that renders nothing.
   *
   * IT FORWARDS, IT DOES NOT REFUSE. A member who types this URL is sent to the
   * first destination with `replace: true`, reusing what `/` already decided: a
   * screen saying "you may not be here" is a screen telling somebody about a
   * destination the navigation never offered them, and a decision left in the
   * history stack makes Back a loop.
   */
  beforeLoad: async ({ context }) => {
    // THREE OUTCOMES, and the third is why the read is wrapped. `readMemberRole`
    // maps every failure it knows about to a code, but the reader can still
    // REJECT — the client throws on a build with no environment, and
    // `getSession` rejects wherever storage is blocked. An escaping rejection
    // resolves this route to neither a redirect nor a component, which is the
    // blank page at HTTP 200 that `__root.tsx` registers no `errorComponent` to
    // catch.
    //
    // FAILING CLOSED: a level that cannot be read is not an administrator's, so
    // the visitor is forwarded like any other refused one. Not silently — a
    // swallowed cause is how a misconfiguration reads as an ordinary redirect.
    let outcome: MemberRoleOutcome;

    try {
      outcome = await context.currentMemberRole();
    } catch (cause) {
      console.error(MEMBER_ROLE_UNAVAILABLE, cause);

      outcome = { ok: false, code: MEMBER_ROLE_UNAVAILABLE };
    }

    if (mayReadMembers(outcome)) return;

    throw redirect({ to: FIRST_DESTINATION.path, replace: true });
  },
  component: LjudiScreen,
});
