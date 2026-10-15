import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { TODAY_SCREEN_PARTS } from '@/features/today/today-screen.fixture';
import {
  HOUR_BAND_EDIT_PARTS,
  HOUR_BAND_LIST_PARTS,
} from '@/features/hour-bands/hour-band-screens.fixture';
import { ARROW_DOWN, ARROW_UP, MEMBERS_LIST_KEY } from '@/features/members/services/list';
import {
  TEAM_EDIT_PARTS,
  TEAM_LIST_PARTS,
  TEAM_ROSTER_PARTS,
} from '@/features/teams/team-screens.fixture';

import {
  attributeOf,
  buttonElements,
  componentFunction,
  DANAS,
  DANAS_PAGE,
  exportedFunction,
  finallyBlock,
  heightPx,
  HOUR_BAND_EDIT,
  HOUR_BAND_EDIT_HOOK,
  HOUR_BAND_LIST,
  HOUR_BAND_LIST_HOOK,
  HOUR_BAND_LIST_KEYS,
  inputElements,
  labelTargets,
  LEAVE_FEATURE,
  linkElements,
  MEMBER_CREATE,
  MEMBER_EDIT,
  MEMBER_LIST,
  MEMBER_LIST_KEYS,
  MEMBER_WRITE_KEYS,
  MEMBERS_FEATURE,
  namedHandler,
  occurrences,
  ROTATION_DISPOSITION_KEYS,
  ROTATION_HISTORY_DIALOG,
  ROTATION_HISTORY_KEYS,
  ROTATION_LIST_KEYS,
  ROTATION_OVERRIDE_REVIEW,
  ROTATION_SECTION,
  ROTATION_STEPPER_KEYS,
  ROTATION_WARNING_KEYS,
  ROTATION_WRITE_KEYS,
  selectElements,
  SETTINGS_FIRE_RANKS,
  SETTINGS_HOOK,
  SHIFT_TYPE_EDIT,
  SHIFT_TYPE_EDIT_HOOK,
  SHIFT_TYPE_LIST,
  SHIFT_TYPE_LIST_HOOK,
  SHIFT_TYPE_LIST_KEYS,
  SHIFT_TYPE_WRITE_KEYS,
  source,
  srcRoot,
  submitHandler,
  TEAM_EDIT,
  TEAM_EDIT_HOOK,
  TEAM_LIST,
  TEAM_LIST_HOOK,
  TEAM_LIST_KEYS,
  TEAM_LIST_PAGE,
  TEAM_ROSTER,
  TEAM_ROSTER_HOOK,
  TEAM_ROSTER_PAGE,
  TEAM_WRITE_KEYS,
  TODAY_KEYS,
} from './source-guards.fixture';

// The member and team screens: the list's one read and its filters, the roster, rank
// and position, the two member forms, and the re-reads after a write.

/** Story 7.17: the member lines, shared by the roster and the member directory. */
const TEAM_ROSTER_LINES = join(srcRoot, ...TEAM_ROSTER_PARTS.lines);

/** SINCE E804: the caller's team today and its one link to the roster, in the today card and the admin's subtitle. */
const OWN_TEAM_LINE = join(srcRoot, ...TODAY_SCREEN_PARTS.ownTeamLine);

/**
 * Story 5.5h: the review's state and wiring moved into a hook of its own, so
 * the component renders and the hook holds the latch, the erasure check and
 * the writes. The two are read as one set wherever a claim is about the
 * review as a whole; the component alone stays the screen and key entry.
 */
const ROTATION_OVERRIDE_REVIEW_HOOK = join(srcRoot, 'features', 'rotation', 'hooks', 'use-override-review.ts');

const ROTATION_OVERRIDE_REVIEW_SET: readonly string[] = [ROTATION_OVERRIDE_REVIEW, ROTATION_OVERRIDE_REVIEW_HOOK];

/** Story 5.5h's pure part of the review's erasure guard: the row's change and the refusals' codes. */
const ROTATION_OVERRIDE_REVIEW_ERASURES = join(srcRoot, 'features', 'rotation', 'services', 'override-review-erasures.ts');

/** A call of `name`, spelled so this file never contains the call it forbids. */
function callOf(name: string): string {
  return `${name}(`;
}

describe('the member list computes nothing it renders', () => {
  /**
   * THE CLASS OF DEFECT THIS CLOSES, and the reason it is a detector rather than
   * three more assertions.
   *
   * `apps/web/vitest.config.ts` collects `src/**\/*.test.ts` in a NODE
   * environment (AD-15), so `pages/ljudi.tsx` is executed by nothing in this
   * repository. Every rule written there is therefore unverifiable by
   * construction, and round 2 of review demonstrated it three times over on this
   * one file: swapping the name and address branches of a `cellText` helper
   * rendered every address under `Ime` with 864/864 green; narrowing an
   * `isError || paused` check to `paused` left a thrown query function drawing
   * headings with no rows and no message; dropping `sort` from a memo's
   * dependency array flipped the arrow while the rows never moved, green AND
   * eslint-clean.
   *
   * Patching the three instances leaves the class. What stops it recurring is
   * this: the screen may not COMPUTE a value it renders. Every member field it
   * shows arrives through `@/features/members/services/list`, where a node test can execute the
   * decision — so a branch in the screen that reaches into a member row is
   * refused here whatever it happens to return today.
   */

  /** Every field a member row carries, read off the interface that declares it. */
  function memberRowFields(text: string): string[] {
    const body = /export interface MemberListRow \{([\s\S]*?)\n\}/.exec(text)?.[1] ?? '';

    return [...body.matchAll(/readonly (\w+)\??:/g)].map((found) => found[1] ?? '');
  }

  /**
   * The fields the screen may not reach for.
   *
   * `id` is the exception and the only one: `<TableRow key={member.id}>` is
   * React's reconciliation key, not a rendered value — nobody reads it and no
   * branch decides anything by it — and a list that keys its rows by index
   * rather than by identity is its own defect. Every other field is content.
   */
  const RENDERED_FIELD_EXEMPTIONS = ['id'];

  it('knows which fields it is guarding, so the sweep below is not vacuous', () => {
    // Read off `list.ts` rather than written here, so a fifth field added to the
    // row is guarded the day it exists rather than the day somebody remembers.
    const fields = memberRowFields(source(MEMBER_LIST_KEYS));

    expect(fields).toEqual([
      'id',
      'organizationId',
      'name',
      // `username` JOINED IN STORY 1.5b, and it is guarded like every other
      // content field: `0007` put the issued credential on `members`, and the
      // list must not start rendering it by reaching into a row — it renders in
      // no column at all, and the edit form is what shows it.
      'username',
      'email',
      'role',
      'leaveAllowanceDays',
      // MEMBER RANK: read for the edit form and guarded like the rest — a rank
      // column on the list is an Ask First, so the list may not reach for it.
      'fireRank',
      // STORY 1.6's THREE, all guarded: the account id the edit screen compares
      // with the session's subject, the status history the marker is read off,
      // and the organization's zone that "today" is read in. None may be
      // reached for by the list itself.
      'authUserId',
      'statusVersions',
      // STORY 1.7b: the team history the team cell is read off, guarded like
      // the status history.
      'teamVersions',
      'timeZone',
    ]);
    for (const exempt of RENDERED_FIELD_EXEMPTIONS) expect(fields).toContain(exempt);
  });

  /**
   * Source with every quoted string emptied.
   *
   * `t('ljudi.role')` is a translation KEY, and the field sweep below would read
   * the `.role` inside it as a property access on a member row — a false
   * positive on the one shape this screen is supposed to use. Strings carry no
   * property access, so emptying them loses nothing the sweep wants.
   */
  function withoutStrings(text: string): string {
    return text.replace(/'[^'\n]*'/g, "''").replace(/"[^"\n]*"/g, '""');
  }

  it('reaches for no member field of its own', () => {
    const screen = withoutStrings(source(MEMBER_LIST));
    const guarded = memberRowFields(source(MEMBER_LIST_KEYS)).filter(
      (field) => !RENDERED_FIELD_EXEMPTIONS.includes(field),
    );

    expect(guarded.length, 'no field is being guarded at all').toBeGreaterThan(0);
    for (const field of guarded) {
      expect(
        screen,
        `the member list reads .${field} itself — put the value on MEMBER_COLUMNS, where features/members/services/list.test.ts can execute it`,
      ).not.toMatch(new RegExp(`\\.\\s*${field}\\b`));
    }
  });

  it('would notice a field access, and not notice an ordinary property', () => {
    // BOTH POLARITIES, the idiom every detector in this file follows: a reader
    // that matched nothing would make the sweep above pass on a screen that
    // computes every cell it draws.
    const offending = 'const shown = member.name;';
    const compliant = 'const shown = cellContent(column.cell(member));';

    expect(withoutStrings(offending)).toMatch(/\.\s*name\b/);
    expect(withoutStrings(compliant)).not.toMatch(/\.\s*name\b/);
    // `column.label` and `cell.text` are ordinary properties of things that are
    // not member rows, and the sweep must not fire on either.
    expect('t(column.label)').not.toMatch(/\.\s*(email|leaveAllowanceDays|organizationId)\b/);
    // And a translation KEY that happens to contain a field name is not a field
    // access — the false positive this helper exists for, on both polarities.
    expect(withoutStrings("t('ljudi.role')")).not.toMatch(/\.\s*role\b/);
    expect(withoutStrings('member.role')).toMatch(/\.\s*role\b/);
  });

  it('hands every cell value through untouched rather than transforming it', () => {
    // THE RESIDUAL HALF of the same class. The sweep above stops the screen
    // READING a member field; this stops it CHANGING one it was handed. A
    // `cell.text.trim()` slipped past every assertion in this repository — it is
    // in a file nothing executes, and the value still comes from the column — and
    // trimming is only the harmless end of that range: the same position takes a
    // `slice`, a `toUpperCase`, or a fallback that quietly replaces an empty
    // address with a word.
    //
    // Each branch's returned expression is pinned exactly. `t()` and the number
    // formatter are the two transformations this function is FOR — a data module
    // calling either would need i18next initialised to be testable at all — and
    // they are named here rather than left to a pattern, so a third arriving is
    // a decision somebody makes in front of a reviewer.
    const body =
      /function cellContent\([^)]*\)[^{]*\{([\s\S]*?)\n\}/.exec(source(MEMBER_LIST))?.[1] ?? '';

    expect(body.length, 'cellContent is gone, so this pins nothing').toBeGreaterThan(0);
    expect(
      [...body.matchAll(/return ([^;]+);/g)].map((found) => (found[1] ?? '').trim()),
      'a cell value is transformed on its way to the screen',
    ).toEqual([
      // VISUAL REFRESH B: every name kind returns its name untouched, in ONE
      // branch. Story 1.6's two inactive-marker sentences that stood here left
      // the name: the marker is a badge BESIDE it now, rendered by `cellStatus`,
      // so the name itself is no longer wrapped in anything.
      'cell.text',
      // STORY 7.13: the status column's fact, its key and its date both the
      // module's (`memberStatusMessageKey`, `memberStatusArgsOf`).
      't(memberStatusMessageKey(cell), memberStatusArgsOf(cell))',
      't(memberLevelMessageKey(cell.level))',
      // STORY 1.7b, a FIFTH: the team today, or "no team" stated in positive
      // words (`Bez smjene`) where a blank would read as not loaded. The
      // fallback is the one the module's `null` asks for, not a replacement
      // of a value that arrived.
      "cell.team ?? t('smjene.membership.none')",
      'formatNumber(cell.days, 0)',
      'unhandled',
    ]);
  });

  it('passes the inactive marker through untouched, deciding nothing (visual refresh B)', () => {
    // The marker's words are `@/features/members/services/list`'s decision now
    // (`memberStatusMessageKey`, inside `memberCellLookOf`), where
    // `features/members/services/list.test.ts` EXECUTES the pairing of each name cell to its key.
    // What is left to pin at source is that the screen only hands that key and
    // its argument to `t()`: no marker key spelled here, and no branch on the
    // cell's kind that could pick one.
    const screen = source(MEMBER_LIST);
    const view = /function CellView\([^)]*\)[^{]*\{([\s\S]*?)\n\}/.exec(screen)?.[1] ?? '';

    expect(view.length, 'CellView is gone, so this pins nothing').toBeGreaterThan(0);
    expect(view).toContain('t(look.status.key, look.status.args)');
    expect(view, 'the screen branches on the cell kind itself').not.toMatch(/cell\.kind/);
    expect(screen, 'a marker key is spelled on the screen').not.toMatch(
      /t\('ljudi\.status\.inactive(Scheduled)?'/,
    );
  });

  it('would notice a transformed return, and not notice the untouched one', () => {
    // Both polarities on the reader itself, the idiom every detector here
    // follows.
    const reader = (text: string): string[] =>
      [...(/function cellContent\([^)]*\)[^{]*\{([\s\S]*?)\n\}/.exec(text)?.[1] ?? '').matchAll(
        /return ([^;]+);/g,
      )].map((found) => (found[1] ?? '').trim());

    expect(reader('function cellContent(cell: X): string {\n  return cell.text;\n}')).toEqual([
      'cell.text',
    ]);
    expect(
      reader('function cellContent(cell: X): string {\n  return cell.text.trim();\n}'),
    ).toEqual(['cell.text.trim()']);
    expect(reader('const x = 1;')).toEqual([]);
  });

  it('draws the sort arrow the way the module names it', () => {
    // WHAT NO NODE TEST CAN SEE. `sortIndicatorOf` decides the DIRECTION and
    // `features/members/services/list.test.ts` pins it against `aria-sort`; what is left in the
    // screen is which glyph each direction draws, and an arrow pointing the
    // wrong way is worse than none because it contradicts a correct `aria-sort`
    // on the same element. A record keyed by the module's own names, asserted
    // pair by pair.
    // SINCE THE EPIC 4 RETRO (D2) the record is the shared one, keyed by the
    // direction's own names — `ARROW_UP` and `ARROW_DOWN` are `up` and `down`.
    const screen = source(MEMBER_LIST);

    expect(ARROW_UP).toBe('up');
    expect(ARROW_DOWN).toBe('down');
    expect(screen, 'the sort glyphs are no longer a keyed record').toMatch(/\bup:\s*ArrowUp\b/);
    expect(screen).toMatch(/\bdown:\s*ArrowDown\b/);
    expect(screen, 'the member table no longer draws from the shared record').toMatch(
      /SORT_DIRECTION_GLYPHS\[indicator\]/,
    );
    // And no ternary picking between the two, which is the shape that gets
    // inverted silently.
    expect(
      screen,
      'the screen branches between the two arrows instead of looking one up',
    ).not.toMatch(/\?\s*ArrowUp\s*:|\?\s*ArrowDown\s*:/);
  });
});

describe('the member list reads once, under one key', () => {
  /**
   * AD-13, the shape `features/organization/services/snapshot.test.ts` established. Two figures on
   * a screen coming from two reads is the failure this refuses, and on this
   * surface there are five — the rows, the stated count and three counts beside
   * the filter — every one of which must be derived from the one answer.
   */

  it('declares a single query key and uses that constant', () => {
    const screen = source(MEMBER_LIST);

    expect(MEMBERS_LIST_KEY).toEqual(['members']);
    // The key is named in ONE place, the query options every screen reading it
    // uses — two `queryFn`s for one key is how a cache bound goes dead.
    expect(occurrences(source(MEMBER_LIST_KEYS), 'queryKey: MEMBERS_LIST_KEY')).toBe(1);
    expect(
      occurrences(screen, 'queryKey:'),
      'the member list defines its own query rather than using the one definition',
    ).toBe(0);
  });

  it('reads the member list exactly once, however many figures it draws', () => {
    // A second `useQuery` here is the ordinary way AD-13 gets broken: nothing
    // fails, the screen just shows two answers from two moments — and on a list
    // of several hundred people it also doubles the most expensive read in the
    // application.
    const screen = source(MEMBER_LIST);

    expect(occurrences(screen, 'useQuery(')).toBe(1);
    expect(occurrences(screen, 'useQuery(membersQueryOptions(')).toBe(1);
    expect(occurrences(screen, callOf('readMembers')), 'only the query options call the reader').toBe(0);
  });

  it.each([
    { name: 'the team key', options: TEAM_LIST_KEYS, key: 'queryKey: TEAMS_LIST_KEY' },
    { name: 'the hour band key', options: HOUR_BAND_LIST_KEYS, key: 'queryKey: HOUR_BANDS_LIST_KEY' },
  ])('names $name as a query key in one place, the query options', ({ options, key }) => {
    // Two `queryFn`s for one key is how a cache bound goes dead; the screens
    // only ever name the key to invalidate it.
    expect(occurrences(source(options), key)).toBe(1);
  });

  it('reads the teams on the member edit screen through the one team definition', () => {
    const screen = source(MEMBER_EDIT);

    expect(occurrences(screen, 'teamsQueryOptions(')).toBe(1);
    expect(occurrences(screen, callOf('readTeams')), 'only the query options call the reader').toBe(0);
  });

  it.each([
    {
      name: 'the team list',
      file: TEAM_LIST,
      hookFile: TEAM_LIST_HOOK,
      refreshes: ['queryClient, TEAMS_LIST_KEY, TEAM_CREATE_DEPENDENTS'],
    },
    {
      name: 'the team edit form',
      file: TEAM_EDIT,
      hookFile: TEAM_EDIT_HOOK,
      refreshes: ['queryClient, TEAMS_LIST_KEY, landed ? TEAM_CHANGE_DEPENDENTS : NO_DEPENDENTS'],
    },
  ])('reads the teams exactly once, under the one team key, on $name', ({ file, hookFile, refreshes }) => {
    // STORY 1.7a, AD-13. The rows, both counts and the edited team all come
    // from one read under `TEAMS_LIST_KEY`. The create's organization is the
    // session's own claim, never a second query.
    // SOURCE STRUCTURE B6: counted over the whole set, so a second read in any
    // part fails; the read and the re-reads are asserted IN THE HOOK, the one
    // file that must hold them; and every ban holds PER PART.
    const screen = source(file);
    const hook = source(hookFile);

    expect(file, 'the hook is not in the set').toContain(hookFile);
    expect(occurrences(screen, 'useQuery(')).toBe(1);
    expect(occurrences(screen, 'useQuery(teamsQueryOptions(')).toBe(1);
    expect(occurrences(hook, 'useQuery('), 'the one read is not in the hook').toBe(1);
    expect(occurrences(hook, 'teamsQueryOptions('), 'the one read is not in the hook').toBe(1);
    expect(occurrences(screen, 'teamsQueryOptions('), 'the team options are called outside the one read').toBe(1);
    expect(occurrences(screen, callOf('readTeams')), 'only the query options call the reader').toBe(0);
    // THE AMENDED RULE (AD-13): a write re-reads its own key and every key
    // declared as depending on what it wrote, and nothing else. Every re-read
    // is `refreshAfterWrite` IN THE HOOK, on the one team key, with one of the
    // lists `@/features/teams/services/dependents` declares for that write
    // (the builder, and since the list-refresh fix the member list, Danas and
    // the rosters) — so no key is named here and nothing bypasses the lists.
    expect(occurrences(screen, 'queryKey:'), 'a key is named on a team screen').toBe(0);
    expect(occurrences(screen, 'invalidateQueries('), 'a re-read bypasses the declared dependents').toBe(0);
    expect(
      [...screen.matchAll(/refreshAfterWrite\(([^;]*?)\);/g)].map((found) =>
        (found[1] ?? '').replace(/\s+/g, ' ').replace(/,\s*$/, '').trim(),
      ),
      'a write re-reads something besides its own key and its declared dependents',
    ).toEqual(refreshes);
    expect(occurrences(hook, 'refreshAfterWrite('), 'a re-read is started outside the hook').toBe(
      occurrences(screen, 'refreshAfterWrite('),
    );
    expect(source(TEAM_LIST_KEYS), 'the team read has no cache floor').toContain(
      'staleTime: TEAMS_READ_STALE_MS',
    );
    for (const part of file) {
      expect(source(part), `useMutation arrived in ${part}; this repository uses a pending ref`).not.toContain(
        'useMutation',
      );
    }
  });

  it.each([
    {
      name: 'the hour band list',
      file: HOUR_BAND_LIST,
      hookFile: HOUR_BAND_LIST_HOOK,
      refreshes: ['queryClient, HOUR_BANDS_LIST_KEY, HOUR_BAND_WRITE_DEPENDENTS'],
    },
    {
      name: 'the hour band edit form',
      file: HOUR_BAND_EDIT,
      hookFile: HOUR_BAND_EDIT_HOOK,
      refreshes: ['queryClient, HOUR_BANDS_LIST_KEY, landed ? HOUR_BAND_WRITE_DEPENDENTS : NO_DEPENDENTS'],
    },
  ])('reads the bands exactly once, under the one band key, on $name', ({ file, hookFile, refreshes }) => {
    // STORY 2.1b, AD-13. The rows, the count, the bar and the edited band all
    // come from one read under `HOUR_BANDS_LIST_KEY`.
    // SOURCE STRUCTURE B5: counted over the whole set, so a second read in any
    // part fails; the read and the re-read are asserted IN THE HOOK, the one
    // file that must hold them; and every ban holds PER PART.
    const screen = source(file);
    const hook = source(hookFile);

    expect(file, 'the hook is not in the set').toContain(hookFile);
    expect(occurrences(screen, 'useQuery(')).toBe(1);
    expect(occurrences(screen, 'useQuery(hourBandsQueryOptions(')).toBe(1);
    expect(occurrences(hook, 'useQuery('), 'the one read is not in the hook').toBe(1);
    expect(occurrences(hook, 'hourBandsQueryOptions('), 'the one read is not in the hook').toBe(1);
    expect(occurrences(screen, callOf('readHourBands')), 'only the query options call the reader').toBe(0);
    // STORY 4.1b, THE AMENDED RULE (AD-13), on the team screens' terms: every
    // re-read is `refreshAfterWrite` IN THE HOOK, on the one band key, with the
    // dependents `@/features/teams/services/dependents` declares for a band
    // write (the calendar snapshot *Sati* derives hours from).
    expect(occurrences(screen, 'queryKey:'), 'a key is named on a band screen').toBe(0);
    expect(occurrences(screen, 'invalidateQueries('), 'a re-read bypasses the declared dependents').toBe(0);
    expect(
      [...screen.matchAll(/refreshAfterWrite\(([^;]*?)\);/g)].map((found) =>
        (found[1] ?? '').replace(/\s+/g, ' ').replace(/,\s*$/, '').trim(),
      ),
      'a write re-reads something besides its own key and its declared dependents',
    ).toEqual(refreshes);
    expect(occurrences(hook, 'refreshAfterWrite('), 'a re-read is started outside the hook').toBe(
      occurrences(screen, 'refreshAfterWrite('),
    );
    expect(source(HOUR_BAND_LIST_KEYS), 'the band read has no cache floor').toContain(
      'staleTime: HOUR_BANDS_READ_STALE_MS',
    );
    for (const part of file) {
      expect(source(part), `useMutation arrived in ${part}; this repository uses a pending ref`).not.toContain(
        'useMutation',
      );
    }
  });

  it('enters only a name and a start, and derives nothing on either band screen', () => {
    // STORY 2.1b, AD-3. The window, duration and midnight flag are shown
    // read-only and come from `@/features/hour-bands/services/list`, which reads the domain.
    // SOURCE STRUCTURE B5: the two fields are counted over the set, the time
    // field is asserted in the part that renders it, and the bans hold PER PART.
    for (const [file, fields] of [
      [HOUR_BAND_LIST, join(srcRoot, ...HOUR_BAND_LIST_PARTS.addDialog)],
      [HOUR_BAND_EDIT, join(srcRoot, ...HOUR_BAND_EDIT_PARTS.body)],
    ] as const) {
      expect(file, 'the fields part is not in the set').toContain(fields);
      expect(inputElements(source(file)), `${file[0]} enters something besides a name and a start`).toHaveLength(2);
      expect(inputElements(source(fields)), `${fields} does not render both fields`).toHaveLength(2);
      expect(source(fields)).toContain('type="time"');
      for (const part of file) {
        const screen = source(part);

        expect(screen, `${part} reaches past the list module into the domain`).not.toContain(
          '@shift/domain',
        );
        expect(screen, `${part} recomputes a band itself`).not.toMatch(
          /\b1440\b|MINUTES_PER_DAY|startMinute\s*[-+%]/,
        );
      }
    }
  });

  it('draws the bar hidden from assistive technology, its uncovered stretch hatched and flagged', () => {
    // SOURCE STRUCTURE B5: read in the part that renders the bar.
    const bar = componentFunction(source(join(srcRoot, ...HOUR_BAND_LIST_PARTS.timeline)), 'renderBar');

    expect(HOUR_BAND_LIST, 'the bar part is not in the list set').toContain(
      join(srcRoot, ...HOUR_BAND_LIST_PARTS.timeline),
    );
    expect(occurrences(source(HOUR_BAND_LIST), 'function renderBar('), 'the bar is drawn twice').toBe(1);
    expect(bar.length, 'renderBar could not be extracted').toBeGreaterThan(80);
    expect(bar).toContain('aria-hidden={true}');
    // The hatch is `TimelineGap`'s, the primitive the uncovered stretch is drawn with.
    expect(bar, 'the uncovered stretch is not hatched').toContain('<TimelineGap');
    expect(source(join(srcRoot, 'components', 'ui', 'timeline.tsx'))).toContain('hatch-uncovered');
    expect(bar, 'the uncovered stretch is not flagged in words').toContain(
      "t('organization.hourBands.uncovered')",
    );
    expect(bar, 'a covered stretch is not labelled with its band').toContain('{segment.name}');
    for (const part of [...HOUR_BAND_LIST, ...HOUR_BAND_EDIT]) {
      expect(source(part), `${part} paints a shift type colour`).not.toContain('shift-slot');
    }
  });

  it.each([
    { name: 'the shift type list', file: SHIFT_TYPE_LIST, hookFile: SHIFT_TYPE_LIST_HOOK },
    { name: 'the shift type edit form', file: SHIFT_TYPE_EDIT, hookFile: SHIFT_TYPE_EDIT_HOOK },
  ])('reads the shift types exactly once, under the one key, on $name', ({ file, hookFile }) => {
    // STORY 2.2b, AD-13. The rows, the slots, the times, "today" and the edited
    // type all come from one read under `SHIFT_TYPES_LIST_KEY`.
    // SOURCE STRUCTURE B4: counted over the whole set, so a second read in any
    // part fails; the read and the re-reads are asserted IN THE HOOK, the one
    // file that must hold them; and every ban below holds PER PART.
    const screen = source(file);
    const hook = source(hookFile);

    expect(file, 'the hook is not in the set').toContain(hookFile);
    expect(occurrences(screen, 'useQuery(')).toBe(1);
    expect(occurrences(screen, 'shiftTypesQueryOptions(')).toBe(1);
    expect(occurrences(hook, 'useQuery('), 'the one read is not in the hook').toBe(1);
    expect(occurrences(hook, 'shiftTypesQueryOptions('), 'the one read is not in the hook').toBe(1);
    // STORY 2.3b: a shift type write also invalidates the rotation builder's
    // own snapshot, which draws the types too — and nothing else.
    expect(occurrences(screen, 'queryKey:')).toBe(
      occurrences(screen, 'queryKey: SHIFT_TYPES_LIST_KEY') + occurrences(screen, 'queryKey: ROTATION_KEY'),
    );
    expect(screen, 'a write is not followed by a re-read of the one list').toContain(
      'invalidateQueries({ queryKey: SHIFT_TYPES_LIST_KEY })',
    );
    expect(screen, 'a shift type write leaves the rotation builder showing old types').toContain(
      'invalidateQueries({ queryKey: ROTATION_KEY })',
    );
    expect(occurrences(screen, 'invalidateQueries({ queryKey: ROTATION_KEY })')).toBe(
      occurrences(screen, 'invalidateQueries({ queryKey: SHIFT_TYPES_LIST_KEY })'),
    );
    expect(hook, 'the two re-reads are not started together').toMatch(
      /Promise\.all\(\[\s*queryClient\.invalidateQueries\(\{ queryKey: SHIFT_TYPES_LIST_KEY \}\),\s*queryClient\.invalidateQueries\(\{ queryKey: ROTATION_KEY \}\),?\s*\]\)/,
    );
    expect(occurrences(hook, 'invalidateQueries({ queryKey: SHIFT_TYPES_LIST_KEY })')).toBe(
      occurrences(screen, 'invalidateQueries({ queryKey: SHIFT_TYPES_LIST_KEY })'),
    );
    for (const part of file) {
      const text = source(part);

      expect(text, `useMutation arrived in ${part}; this repository uses a pending ref`).not.toContain(
        'useMutation',
      );
      expect(text, `${part} reaches past the list module into the domain`).not.toContain(
        '@shift/domain',
      );
      expect(text, `${part} recomputes a duration itself`).not.toMatch(
        /\b1440\b|MINUTES_PER_DAY|startMinute\s*[-+%]|endMinute\s*[-+%]/,
      );
      // UX-DR6: colour is the slot's, never a choice, and never a named token.
      expect(text, `${part} paints a colour of its own`).not.toMatch(
        /type="color"|shift-day|shift-night|shift-slot-/,
      );
    }
  });

  it('reads the rotation once, under its own key, and re-reads only its declared dependents, on the rotation builder', () => {
    // STORY 2.3b, AD-13. The teams, types, steps, assignments and "today" all
    // come from one read under `ROTATION_KEY`; the cancel re-reads only it.
    // STORY 5.5a: a landed save re-reads its own key and the dependents
    // `@/features/teams/services/dependents` declares for it — the calendar
    // snapshot, the leave and the resolutions — through `refreshAfterWrite`,
    // and the erasure check's three reads are the hook's, fetched on a press.
    const screen = source(ROTATION_SECTION);
    const check = source(join(srcRoot, 'features', 'rotation', 'hooks', 'use-erasure-check.ts'));
    // STORY 5.5b: the three core reads moved to the shared hook; the rotation
    // read stays the builder's own addition, beside them.
    const reads = source(join(srcRoot, 'features', 'conflicts', 'hooks', 'use-erasure-reads.ts'));

    expect(occurrences(screen, 'useQuery(')).toBe(1);
    expect(occurrences(screen, 'useQuery(rotationQueryOptions(')).toBe(1);
    expect(occurrences(screen, 'queryKey:')).toBe(occurrences(screen, 'queryKey: ROTATION_KEY'));
    expect(screen).toContain('invalidateQueries({ queryKey: ROTATION_KEY })');
    expect(screen).toContain('refreshAfterWrite(queryClient, ROTATION_KEY, ROTATION_SAVE_DEPENDENTS)');
    // STORY 5.5g: a landed cancel re-reads the same dependents through its
    // own declared list; a stale one still re-reads only `ROTATION_KEY`.
    expect(screen).toContain('refreshAfterWrite(queryClient, ROTATION_KEY, ROTATION_CANCEL_DEPENDENTS)');
    expect(occurrences(screen, 'refreshAfterWrite(')).toBe(2);
    expect(occurrences(check, 'useQuery('), 'the check observes its reads between presses').toBe(0);
    expect(occurrences(check, 'staleTime: 0')).toBe(1);
    expect(occurrences(check, "networkMode: 'always'"), 'a fetch could pause offline').toBe(1);
    expect(check, 'the builder no longer stands on the shared core reads').toContain('useErasureReads()');
    expect(occurrences(reads, 'useQuery('), 'the check observes its reads between presses').toBe(0);
    expect(occurrences(reads, 'staleTime: 0')).toBe(3);
    expect(occurrences(reads, "networkMode: 'always'"), 'a fetch could pause offline').toBe(3);
    expect(screen, 'useMutation arrived; this repository uses a pending ref').not.toContain('useMutation');
    expect(screen, 'no in-flight ref guards a second save').toMatch(/saving\.current = true/);
    expect(screen, 'the in-flight ref is never released').toMatch(/finally \{\s*saving\.current = false;/);
    // AD-7: nothing on the builder projects, takes a modulo or counts a cycle.
    expect(screen, 'the builder reaches past its modules into the domain').not.toContain('@shift/domain');
    // STORY 2.6 LIFTED THE BAN on the draft's `effectiveFrom`: the section
    // reads it for `Vrijedi od`. The COLUMN stays out — only `@/features/rotation/services/write`
    // names what is sent.
    expect(screen, 'the builder names a column the save sends').not.toMatch(/effective_from/);
    expect(screen).not.toMatch(/type="color"|shift-day|shift-night|shift-slot-|destructive/);
    // AS RENEGOTIATED: steps reorder by `@dnd-kit`, by the handle only, with
    // mouse, touch and keyboard sensors — never native HTML5 drag-and-drop,
    // which is unreliable on touch. The drop is `withStepMovedTo`'s, and no
    // reorder is computed here (`arrayMove`, a splice).
    expect(screen).toMatch(/from '@dnd-kit\/core'/);
    expect(screen).toMatch(/from '@dnd-kit\/sortable'/);
    for (const sensor of ['MouseSensor', 'TouchSensor', 'KeyboardSensor']) {
      expect(screen, `no ${sensor}`).toContain(`useSensor(${sensor}`);
    }
    expect(screen).toContain('setActivatorNodeRef');
    expect(screen).toContain('withStepMovedTo(');
    expect(screen).not.toMatch(/\bdraggable=|onDrop=|onDragStart=|arrayMove|\.splice\(/);
    expect(screen, 'dnd-kit would announce in English').toContain('announcements: announcementsOf(');
    expect(screen, 'dnd-kit would instruct in English').toContain('screenReaderInstructions:');
  });

  /**
   * A file's CODE alone: comments, and the contents of every string and
   * template literal, blanked — so a `%` in prose or in a class name is not
   * read as an operator, and one between two operands (`a%b`) still is.
   */
  function codeOnly(text: string): string {
    return text
      .replaceAll(/\/\*[\s\S]*?\*\//g, ' ')
      .replaceAll(/\/\/[^\n]*/g, ' ')
      .replaceAll(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, "''");
  }

  it('reads a modulo in code, and none in prose or strings', () => {
    expect(codeOnly('const i = a%b;')).toContain('%');
    expect(codeOnly('x %= 2;')).toContain('%');
    expect(codeOnly("// a % b\nconst w = 'w-[50%]';\n/* 10 % */ const t = `${'%'}`;")).not.toContain('%');
  });

  it('keeps projection and modulo out of every rotation module and the builder, and a rotation out of storage', () => {
    // AD-7: the builder's draft is projected by `@shift/domain` alone; no
    // cycle length, offset integer or projected shift is written.
    for (const file of [
      ROTATION_LIST_KEYS,
      ROTATION_WRITE_KEYS,
      ...ROTATION_SECTION,
      ROTATION_HISTORY_DIALOG,
      join(srcRoot, 'features', 'rotation', 'utils', 'draft.ts'),
      ROTATION_STEPPER_KEYS,
      ROTATION_WARNING_KEYS,
      ROTATION_HISTORY_KEYS,
      ROTATION_OVERRIDE_REVIEW,
      ROTATION_OVERRIDE_REVIEW_HOOK,
      ROTATION_OVERRIDE_REVIEW_ERASURES,
      ROTATION_DISPOSITION_KEYS,
    ]) {
      const text = readFileSync(file, 'utf8');

      expect(codeOnly(text), `${file} takes a modulo`).not.toContain('%');
      expect(text, `${file} writes a derived value`).not.toMatch(/cycle_length|offset_index|projected_/);
    }
  });

  it('switches the phone stepper by CSS alone, never by a width read in script', () => {
    // STORY 2.4: one DOM tree at every width. A section that is not the
    // current step is hidden below `sm` by a class; nothing measures the
    // window, so a resize across 640 px has no state to reconcile.
    for (const file of [...ROTATION_SECTION, ROTATION_STEPPER_KEYS, join(srcRoot, 'features', 'rotation', 'hooks', 'draft-store.ts')]) {
      expect(codeOnly(readFileSync(file, 'utf8')), `${file} reads the width in script`).not.toMatch(
        /matchMedia|innerWidth|outerWidth|clientWidth|ResizeObserver|screen\.width/,
      );
    }
    // The step bar and Natrag / Dalje are `sm:hidden`; each section's wrapper
    // takes its class from the stepper rules.
    const section = source(ROTATION_SECTION);

    expect(occurrences(section, 'sm:hidden')).toBe(2);
    for (const step of [1, 2, 3, 4]) {
      expect(section).toContain(`stepSectionClassOf(shown, ${step})`);
    }
  });

  it('keeps is_working and select off the edit screen, and deletes only a scheduled version, through its seam', () => {
    // STORY 2.2b. `is_working` is fixed at creation; the edit screen has no
    // select at all, and neither screen sends a delete of a type.
    // PER PART since source structure B4, so a moved file cannot carry one.
    for (const part of SHIFT_TYPE_EDIT) {
      expect(selectElements(source(part)), `a select on ${part}`).toEqual([]);
      expect(source(part), `${part} names is_working`).not.toContain('is_working');
    }
    expect(source(SHIFT_TYPE_LIST_KEYS) + source(SHIFT_TYPE_WRITE_KEYS)).not.toMatch(
      /archived:\s*false/,
    );
    // THE ONLY DELETE is the cancellation of a scheduled version, on the
    // versions table's seam; `shift_types` has no delete verb in its seam and
    // no `.delete(` anywhere else.
    const writes = source(SHIFT_TYPE_WRITE_KEYS);
    const typeSeam = /export interface ShiftTypeWriteTable \{[\s\S]*?\n\}/.exec(writes)?.[0] ?? '';

    expect(typeSeam, 'the shift_types seam could not be extracted').toContain('update(');
    expect(typeSeam, 'the shift_types seam grew a delete').not.toContain('delete(');
    expect(occurrences(writes, '.delete()'), 'a second delete arrived').toBe(1);
    expect(exportedFunction(writes, 'cancelScheduledTimes'), 'the one delete is not the cancellation').toContain(
      '.delete()',
    );
    for (const file of [...SHIFT_TYPE_LIST, ...SHIFT_TYPE_EDIT]) {
      expect(source(file), `${file} deletes directly`).not.toContain('.delete(');
    }
  });

  it('deletes only the scheduled rotation change through the cancel, and a failed save\'s own pattern through the cleanup', () => {
    // STORY 2.6, decision 2a. The deletes in `@/features/rotation` are the cancel's,
    // on its own seam, and (0025) the cleanup of a failed save's own pattern,
    // on its own seam; the save's insert seam grew no delete and no update.
    const writes = source(ROTATION_WRITE_KEYS);
    const insertSeam = /export interface RotationInsertTable \{[\s\S]*?\n\}/.exec(writes)?.[0] ?? '';

    expect(insertSeam, 'the insert seam could not be extracted').toContain('insert(');
    expect(insertSeam, 'the insert seam grew a delete').not.toContain('delete(');
    expect(occurrences(writes, '.delete()'), 'a third delete arrived').toBe(2);
    expect(exportedFunction(writes, 'cancelScheduledRotation'), 'a delete is not the cancel').toContain('.delete()');
    expect(exportedFunction(writes, 'discardUnassignedPattern'), 'a delete is not the cleanup').toContain('.delete()');
    expect(source(ROTATION_SECTION), 'the builder deletes directly').not.toContain('.delete(');
    // Neutral, never `destructive`, and confirmed in a `ConfirmDialog`.
    expect(source(ROTATION_SECTION)).toContain('<ConfirmDialog');
    expect(source(ROTATION_SECTION)).not.toContain('destructive');
    // The cancel guards on the save's ref and releases it on every path.
    // STORY 5.5g: the guarded handler runs the erasure check first; the write
    // itself is `writeCancel`, whose outcome `settleCancel` follows with the
    // declared dependents when it landed and `ROTATION_KEY` alone when stale.
    const cancel = namedHandler(source(ROTATION_SECTION), 'cancelScheduled');
    const writeCancel = namedHandler(source(ROTATION_SECTION), 'writeCancel');
    const confirmCancel = namedHandler(source(ROTATION_SECTION), 'confirmCancelErasures');

    expect(cancel.length, 'the cancel handler could not be extracted').toBeGreaterThan(80);
    expect(writeCancel.length, 'the cancel write could not be extracted').toBeGreaterThan(80);
    expect(confirmCancel.length, 'the cancel dialog\'s save could not be extracted').toBeGreaterThan(80);
    expect(writeCancel).toContain('cancelScheduledRotation(');
    expect(occurrences(source(ROTATION_SECTION), 'cancelScheduledRotation('), 'a second cancel path arrived').toBe(1);
    expect(cancel).toContain('checkCancelErasures(');
    expect(cancel).toMatch(/if \(saving\.current\) return;/);
    expect(finallyBlock(cancel)).toContain('saving.current = false');
    expect(finallyBlock(cancel)).toContain('setPending(false)');
    expect(confirmCancel).toContain('checkCancelErasures(');
    expect(confirmCancel).toMatch(/if \(saving\.current \|\| !cancelErasures\.confirmed\) return;/);
    expect(finallyBlock(confirmCancel)).toContain('saving.current = false');
    expect(finallyBlock(confirmCancel)).toContain('setPending(false)');
    // The re-reads are `settleCancel`'s, which the write ends in.
    const settle = namedHandler(source(ROTATION_SECTION), 'settleCancel');

    expect(writeCancel).toContain('settleCancel(');
    expect(settle).toContain('refreshAfterWrite(queryClient, ROTATION_KEY, ROTATION_CANCEL_DEPENDENTS)');
    expect(settle).toContain('invalidateQueries({ queryKey: ROTATION_KEY })');
    // THE DIALOG'S SAVE TAKES TODAY AGAIN, and never deletes with yesterday's.
    expect(confirmCancel).toContain('rotationTodayOf(');
  });

  it('reviews the pending overrides neutrally, holds its dialogs while a write is in flight, and re-reads the rotation and, once landed, its dependents', () => {
    // STORY 3.5c. The review reads nothing of its own — the builder's snapshot
    // is its answer — and every call it makes is
    // `@/features/rotation/services/override-disposition`'s.
    // STORY 5.5h, DELIBERATELY: the review is the component and its hook
    // (`use-override-review`), read as one set. The component renders and
    // reads no query; the hook holds the latch, the erasure check — whose
    // three reads are the shared `useErasureReads`'s fetches, never observed —
    // and the writes. A landed confirm or amend re-reads the rotation with its
    // declared dependents; a discard and every refusal re-read `ROTATION_KEY`
    // alone.
    const review = source(ROTATION_OVERRIDE_REVIEW_SET);
    const component = source(ROTATION_OVERRIDE_REVIEW);
    const hook = source(ROTATION_OVERRIDE_REVIEW_HOOK);

    expect(occurrences(review, 'useQuery('), 'the review reads a second time').toBe(0);
    expect(occurrences(review, 'queryKey:')).toBe(occurrences(review, 'queryKey: ROTATION_KEY'));
    expect(hook).toContain('invalidateQueries({ queryKey: ROTATION_KEY })');
    expect(hook).toContain('refreshAfterWrite(queryClient, ROTATION_KEY, ROTATION_SAVE_DEPENDENTS)');
    expect(occurrences(review, 'refreshAfterWrite(')).toBe(1);
    expect(hook).toContain('useErasureReads(');
    expect(component, 'the component reads or writes for itself').not.toMatch(/useQueryClient|supabaseClient|ROTATION_KEY/);
    expect(review, 'the review reaches past its modules into the domain').not.toContain('@shift/domain');
    expect(review, 'the review calls a function directly').not.toContain('.rpc(');
    expect(review, 'the review writes a table').not.toMatch(/\.(insert|update|upsert|delete)\(/);
    expect(review).not.toContain('destructive');
    expect(review).not.toMatch(/\baccent\b/);
    // The discard is ONE neutral confirmation; the amend a Dialog that the
    // backdrop and Escape cannot close while it saves.
    expect(component).toContain('<ConfirmDialog busy={pending}');
    expect(component).toContain('dismissible={!pending}');
    expect(component).toContain('<ErasureDialog');
    // ONE LATCH, taken by every handler that writes and released on every path.
    for (const name of ['discard', 'confirm', 'amend', 'confirmReviewErasures']) {
      const handler = namedHandler(hook, name);

      expect(handler.length, `${name} could not be extracted`).toBeGreaterThan(80);
      // Anchored on the exact handler, never one whose name merely starts so.
      expect(handler.startsWith(`async function ${name}(`), `${name} matched another handler`).toBe(true);
      expect(finallyBlock(handler), `${name} never releases the latch`).toContain('writing.current = false');
      expect(finallyBlock(handler), `${name} never settles`).toContain('setPending(false)');
    }
    expect(hook, 'no in-flight ref guards a second write').toMatch(/writing\.current = true/);
    expect(namedHandler(hook, 'confirmReviewErasures')).toMatch(
      /if \(writing\.current \|\| busy \|\| !confirmation\.confirmed\) return;/,
    );
    // DISCARD IS NEVER CHECKED (human, 2026-10-05): the check is asked by the
    // confirm, the amend and the erasure dialog's save, and nothing else.
    expect(namedHandler(hook, 'discard')).not.toContain('checkErasures(');
    expect(occurrences(hook, 'await checkErasures(')).toBe(3);
    for (const name of ['confirm', 'amend', 'confirmReviewErasures']) {
      expect(namedHandler(hook, name), `${name} asks no check`).toContain('await checkErasures(');
    }
    // The builder renders it once, after its notices, and no second time.
    expect(occurrences(source(ROTATION_SECTION), '<OverrideReview ')).toBe(1);
  });

  it('offers an archived team nothing that writes', () => {
    // An archived team is frozen by the database's update policy; its screen
    // must not offer a control the database will refuse.
    // SOURCE STRUCTURE B6: read in the part that renders the team.
    const body = join(srcRoot, ...TEAM_EDIT_PARTS.body);
    const archived = componentFunction(source(body), 'renderArchived');

    expect(TEAM_EDIT, 'the body part is not in the edit set').toContain(body);
    expect(occurrences(source(TEAM_EDIT), 'function renderArchived('), 'an archived team is drawn twice').toBe(1);
    expect(archived.length, 'renderArchived could not be extracted').toBeGreaterThan(80);
    expect(archived).not.toMatch(/<(Button|Input|form|select|Link|TeamArchive\w*)\b/);
    expect(componentFunction(source(body), 'renderTeam')).toMatch(
      /if \(team\.archived\) return renderArchived\(team\);/,
    );
  });

  it('describes the name field by the rename refusal alone', () => {
    // SOURCE STRUCTURE B6: the field in the part that renders it, the archive
    // in the hook that declares it.
    const body = source(join(srcRoot, ...TEAM_EDIT_PARTS.body));

    expect(body).toContain('aria-invalid={failure !== null}');
    expect(body).toContain("aria-describedby={failure === null ? undefined : 'team-form-error'}");
    expect(occurrences(source(TEAM_EDIT), 'aria-invalid='), 'another field is marked invalid').toBe(1);
    const archive = namedHandler(source(TEAM_EDIT_HOOK), 'archive');

    expect(archive.length, 'archive could not be extracted').toBeGreaterThan(80);
    expect(archive, 'an archive refusal marks the name field').not.toMatch(/\bsetFailure\(outcome/);
  });

  it('disarms the archive confirmation when a rename is submitted', () => {
    const submit = namedHandler(source(TEAM_EDIT_HOOK), 'submit');

    expect(submit.length, 'submit could not be extracted').toBeGreaterThan(80);
    expect(submit).toContain('setArmed(false)');
  });

  it('announces confirmations and never the counts', () => {
    // SOURCE STRUCTURE B6: counted over the set, and the one live region
    // asserted in the page, the part that renders it.
    const screen = source(TEAM_LIST);

    expect(occurrences(screen, 'role="status"'), 'only the created confirmation is live').toBe(1);
    expect(source(TEAM_LIST_PAGE)).toMatch(/role="status"[^>]*>\s*\{t\('smjene\.created'\)\}/);
  });

  it('clears a confirmation when the name is edited again', () => {
    // A confirmation describes the last save, not what is typed now.
    // SOURCE STRUCTURE B6: each in the part that renders its field.
    expect(source(join(srcRoot, ...TEAM_LIST_PARTS.addDialog))).toMatch(
      /onChange=\{\(\) => \{[\s\S]{0,120}?setCreated\(false\)/,
    );
    expect(source(join(srcRoot, ...TEAM_EDIT_PARTS.body))).toMatch(
      /onChange=\{\(\) => \{[\s\S]{0,120}?setSaved\(null\)/,
    );
  });

  it('offers no delete of a team anywhere on the surface', () => {
    // Removing a team archives it; the database refuses a delete from anybody.
    // SOURCE STRUCTURE B6: PER PART of both sets, and the two rule modules.
    for (const file of [...TEAM_LIST, ...TEAM_EDIT, TEAM_LIST_KEYS, TEAM_WRITE_KEYS]) {
      expect(source(file), `${file} reaches for a delete`).not.toMatch(/\.delete\(/);
      expect(source(file), `${file} writes archived: false`).not.toMatch(/archived:\s*false/);
    }
  });

  it('bounds that read rather than re-running it on every window focus', () => {
    // Several hundred rows AND an exact count, which costs the database a second
    // pass over the same index. `features/members/services/list.test.ts` pins that the bound
    // exists; this pins that the one query definition passes it, and that both
    // member screens read through that definition.
    const options = source(MEMBER_LIST_KEYS);

    expect(options, 'the member list read has no cache floor').toContain(
      'staleTime: MEMBERS_READ_STALE_MS',
    );
    expect(options, 'the member list re-reads on every window focus').toContain(
      'refetchOnWindowFocus: false',
    );
    for (const file of [MEMBER_LIST, MEMBER_EDIT]) {
      expect(source(file), `${file} defines its own member query`).toContain(
        'useQuery(membersQueryOptions(',
      );
    }
  });
});

describe('the roster and the Danas line read once, show names only, and write nothing', () => {
  /** Every field a member row carries, read off the interface in `@/features/members/services/list`. */
  function memberRowFields(text: string): string[] {
    const body = /export interface MemberListRow \{([\s\S]*?)\n\}/.exec(text)?.[1] ?? '';

    return [...body.matchAll(/readonly (\w+)\??:/g)].map((found) => found[1] ?? '');
  }

  /** Source with every quoted string emptied, so a key is not a field access. */
  function withoutStrings(text: string): string {
    return text.replace(/'[^'\n]*'/g, "''").replace(/"[^"\n]*"/g, '""');
  }

  /** What a roster member is: an id, a name, a rank (member rank) and a
   *  position (team position) (CAP-5). */
  const ROSTER_FIELDS = ['id', 'name', 'fireRank', 'position'];

  // MEMBER RANK: the roster also reads the ORGANIZATION snapshot, under its one
  // shared key, for the setting that decides whether a rank is shown. That is a
  // second consumer of the chrome's own cache entry (AD-13), not a second read
  // of the roster, so it is counted separately rather than loosening the pin.
  const SURFACES = [
    {
      name: 'the team roster',
      file: TEAM_ROSTER,
      hookFile: TEAM_ROSTER_HOOK,
      read: 'readTeamRoster(',
      key: 'TEAM_ROSTER_KEY(id)',
      organizationReads: 1,
    },
    {
      name: 'the Danas destination',
      file: DANAS_PAGE,
      hookFile: DANAS_PAGE,
      read: 'readOwnTeamToday(',
      key: 'OWN_TEAM_KEY',
      organizationReads: 0,
    },
  ];
  /** The surfaces with a read of their own: Danas's line reads the calendar snapshot since E804. */
  const READING_SURFACES = SURFACES.filter((surface) => surface.name !== 'the Danas destination');

  it('derives the Danas line from the calendar snapshot, with no read of its own (E804, AD-13)', () => {
    for (const file of DANAS) {
      const screen = source(file);

      expect(screen, `${file} reads the own team again`).not.toContain('readOwnTeamToday(');
      expect(screen, `${file} names the own-team key`).not.toContain('OWN_TEAM_KEY');
    }
    expect(source(TODAY_KEYS), 'the today view does not carry the own team').toContain('ownTeam: ownTeamOf(snapshot, today)');
  });

  it.each(READING_SURFACES)('reads exactly once, under its one key, on $name', ({ file, hookFile, read, key, organizationReads }) => {
    // AD-13. The roster's name, flag, count and names are one RPC's answer;
    // the Danas line is the caller's own row, derived in `@/features/teams/services/roster`.
    // SOURCE STRUCTURE B7: counted over the roster's whole set, so a read in
    // any part fails, and asserted IN THE HOOK, the one file that must hold it.
    for (const screen of [source(file), source(hookFile)]) {
      expect(occurrences(screen, 'useQuery(')).toBe(1 + organizationReads);
      expect(occurrences(screen, read)).toBe(1);
      // The organization through its one factory, never a key spelled out beside it.
      expect(occurrences(screen, 'queryKey:')).toBe(1);
      expect(occurrences(screen, `queryKey: ${key}`)).toBe(1);
      expect(occurrences(screen, 'queryKey: ORGANIZATION_SNAPSHOT_KEY')).toBe(0);
      expect(occurrences(screen, 'organizationSnapshotQueryOptions(')).toBe(organizationReads);
      expect(screen, 'the read has no cache floor').toContain('staleTime: TEAM_ROSTER_READ_STALE_MS');
    }
  });

  it.each(SURFACES)('offers no write, form or field on $name', ({ file }) => {
    // SOURCE STRUCTURE B7: PER PART of the roster's set.
    for (const part of typeof file === 'string' ? [file] : file) {
      const screen = source(part);

      expect(screen, `${part} reaches for useMutation`).not.toContain('useMutation');
      expect(screen, `${part} writes`).not.toMatch(/\.(delete|insert|update|upsert)\(/);
      expect(screen, `${part} renders a form or a field`).not.toMatch(/<(form|Input|input|select|textarea|Label)\b/);
      expect(screen, `${part} reached past \`@/features/teams/services/roster\` for its rules`).not.toContain(
        "from '@/features/members/services/list'",
      );
    }
  });

  it.each(SURFACES)('reaches for no member field but id and name on $name', ({ file }) => {
    // THE NO-FIELD DETECTOR. Every other field a member row carries — email,
    // username, role, allowance, the histories and the zone — is either not
    // the roster's to show or is derived in `@/features/teams/services/roster`, where a node test
    // executes it. A screen reaching for one is refused here.
    const screen = withoutStrings(source(file));
    const guarded = memberRowFields(source(MEMBER_LIST_KEYS)).filter(
      (field) => !ROSTER_FIELDS.includes(field),
    );

    expect(guarded.length, 'no field is being guarded at all').toBeGreaterThan(5);
    for (const field of guarded) {
      expect(screen, `${file} reads .${field}`).not.toMatch(new RegExp(`\\.\\s*${field}\\b`));
    }
  });

  it('would notice a guarded field access, and not an id or a name', () => {
    // BOTH POLARITIES, as every detector in this file.
    const pattern = (field: string) => new RegExp(`\\.\\s*${field}\\b`);

    expect(withoutStrings('<li>{member.email}</li>')).toMatch(pattern('email'));
    expect(withoutStrings('<li>{member.name}</li>')).not.toMatch(pattern('email'));
    expect(withoutStrings("t('ljudi.email')")).not.toMatch(pattern('email'));
  });

  it('links Danas to the roster of the team it names, and to nothing else', () => {
    // The line's own part, which draws the one link for the member's today
    // card and the admin's subtitle alike (E804); the page draws none of its
    // own, and the week's link to the calendar is a card's (story 6.1a).
    const screen = source(OWN_TEAM_LINE);

    expect(linkElements(source(DANAS_PAGE)), 'the page draws a link of its own').toHaveLength(0);
    expect(linkElements(screen)).toHaveLength(1);
    expect(screen).toContain('to="/smjene/$id"');
    expect(screen).toContain('params={{ id: team.id }}');
    expect(heightPx(/className="([^"]*)"/.exec(linkElements(screen)[0] ?? '')?.[1] ?? null)).toBeGreaterThanOrEqual(44);
    // The roster's only way out is back to Danas: no other surface links in.
    // SOURCE STRUCTURE B7: over the whole set, and in the page, which draws it.
    expect(linkElements(source(TEAM_ROSTER)).map((link) => /to="([^"]+)"/.exec(link)?.[1])).toEqual([
      '/danas',
    ]);
    expect(linkElements(source(TEAM_ROSTER_PAGE)).map((link) => /to="([^"]+)"/.exec(link)?.[1])).toEqual([
      '/danas',
    ]);
  });
});

describe('the member list filters are dead while unanswered, and the reset restores the defaults', () => {
  /**
   * TWO I/O ROWS OF THE FILTER SPECS live only in markup and the hook, which
   * no test executes (AD-15): "unanswered — the search and the chips are
   * disabled" and "reset — one press returns the URL to its defaults" (story
   * 7.13: no search, every level, every team, `aktivni`, by name ascending).
   * `isNarrowed` itself is executed in `features/members/services/list.test.ts`;
   * what is read here is the wiring. The checks are one pure function over
   * source text, so the self-tests below can prove each mutation fails.
   */
  function filterWiringFaults(text: string): string[] {
    const faults: string[] = [];
    const selects = selectElements(text);
    const inputs = inputElements(text);

    if (selects.length !== 0) faults.push(`expected no select, found ${String(selects.length)}`);
    if (inputs.length !== 1) faults.push(`expected one Input, found ${String(inputs.length)}`);
    for (const control of inputs) {
      if (!control.includes('disabled={unanswered}')) faults.push('the search is live while unanswered');
    }

    const bar = /<OptionFilterBar\b[\s\S]*?\n {4}\/>/.exec(text)?.[0] ?? '';

    if (bar === '') faults.push('no chip bar');
    if (!/\n {6}disabled=\{unanswered\}/.test(bar)) faults.push('the chips are live while unanswered');
    const showClear = /showClear=\{([^}]*)\}/.exec(bar)?.[1] ?? '';

    if (!/!unanswered\b/.test(showClear)) faults.push('the reset is live while unanswered');
    if (!/isNarrowed\(filters\)/.test(showClear)) faults.push('the reset ignores whether anything is narrowed');
    if (!/onReset=\{list\.clearFilters\}/.test(bar)) faults.push('the sheet\'s reset moves focus behind the sheet');
    if (!/onClear=\{list\.resetFilters\}/.test(bar)) faults.push('the reset is not the hook\'s');
    if (!/const team = unanswered \? filters\.team : narrowed\.team;/.test(text)) {
      faults.push('the team chip does not show the team the rows were narrowed by');
    }

    const clear = /function clearFilters\(\)[^{]*\{([\s\S]*?)\n {2}\}/.exec(text)?.[1] ?? '';
    const body = /function resetFilters\(\)[^{]*\{([\s\S]*?)\n {2}\}/.exec(text)?.[1] ?? '';

    if (!/\bgo\(\s*DEFAULT_FILTERS\s*\)/.test(clear)) faults.push('the reset does not return the URL to its defaults');
    if (!/\bsetText\(\s*NO_TEXT\s*\)/.test(clear)) faults.push('the reset keeps the search box');
    if (/focus\(/.test(clear)) faults.push('the sheet\'s reset moves focus');
    if (!/\bclearFilters\(\)/.test(body)) faults.push('the reset does not clear');
    if (!/searchField\.current\?\.focus\(\)/.test(body)) faults.push('the reset drops focus');

    return faults;
  }

  it('disables the search and the chips while unanswered, and the reset restores the defaults', () => {
    expect(filterWiringFaults(source(MEMBER_LIST))).toEqual([]);
  });

  it.each([
    { name: 'the search losing its guard', from: 'onChange={changeSearch}\n              disabled={unanswered}', to: 'onChange={changeSearch}' },
    { name: 'the chips losing their guard', from: '      disabled={unanswered}\n      describedBy', to: '      describedBy' },
    { name: 'the reset dropping unanswered', from: 'showClear={!unanswered && isNarrowed(filters)}', to: 'showClear={isNarrowed(filters)}' },
    { name: 'the reset ignoring isNarrowed', from: 'showClear={!unanswered && isNarrowed(filters)}', to: 'showClear={!unanswered}' },
    { name: 'the sheet resetting with focus', from: 'onReset={list.clearFilters}', to: 'onReset={list.resetFilters}' },
    { name: 'the reset keeping the URL', from: '    go(DEFAULT_FILTERS);\n', to: '' },
    { name: 'the reset keeping the box', from: '    setText(NO_TEXT);\n    go(DEFAULT_FILTERS);', to: '    go(DEFAULT_FILTERS);' },
    { name: 'the team chip showing the stored team', from: 'const team = unanswered ? filters.team : narrowed.team;', to: 'const team = filters.team;' },
  ])('would notice $name', ({ from, to }) => {
    const screen = source(MEMBER_LIST);

    expect(screen, 'the mutation no longer applies to the screen').toContain(from);
    expect(filterWiringFaults(screen.replace(from, to)).length).toBeGreaterThan(0);
  });
});

describe('the member list owns exactly one scroll container, and states its count', () => {
  /**
   * DESIGN.md §Layout & Spacing: from 640 px wide content scrolls inside its
   * own container, never the page (below 640 px the member list is stacked
   * rows, story 7.6, and has no table to scroll). Two things can break that
   * and only the source says which: the primitive giving up its wrapper, and
   * the screen nesting a second one around it. Neither is visible to any other
   * assertion in this repository — there is no DOM to measure (AD-15) — so both
   * are read here, together, because fixing one by breaking the other would
   * otherwise pass.
   */

  /** The vendored table primitive, whose wrapper IS the scroll container. */
  const TABLE_PRIMITIVE = join(srcRoot, 'components', 'ui', 'table.tsx');

  it('keeps the scroller on the table primitive, where shadcn puts it', () => {
    const primitive = source(TABLE_PRIMITIVE);

    expect(primitive.length, 'the table primitive is missing').toBeGreaterThan(200);
    expect(
      primitive,
      'the table primitive no longer wraps itself in a scroller — the page scrolls sideways instead',
    ).toMatch(/<div className="[^"]*overflow-auto[^"]*">/);
  });

  it('nests no second scroller around it on the screen', () => {
    // TWO overlapping scrollers is the other half of the same defect: a phone
    // gets two scrollbars, the outer one takes the gesture, and the table's own
    // never moves. The screen must add none of its own.
    expect(
      source(MEMBER_LIST),
      'the member list nests a scroll container around the one the table already owns',
    ).not.toMatch(/overflow-(x-)?auto|overflow-x-scroll/);
  });

  it('never hides a figure because it is zero', () => {
    // UX-DR20 states the fact rather than the absence: a search matching
    // nothing renders `Prikazano 0 osoba`, and a surface that emptied the
    // region instead would be indistinguishable from one that failed to load.
    // `features/members/services/list.test.ts` proves the narrowing RETURNS zero; what no
    // executable assertion can reach is the screen deciding not to render it,
    // so the shape that would — a branch on an empty list — is refused here.
    const screen = source(MEMBER_LIST);

    // STORY 7.13: the count is the summary line's, every figure at zero too.
    expect(screen, 'the member list never renders its count').toMatch(/t\(membersSummaryMessageKey\(summary\)/);
    expect(
      screen,
      'the member list branches on an empty list, which is how a stated zero disappears',
    ).not.toMatch(/\.length\s*(===|!==|>|<)\s*0/);
  });
});

describe('member rank: the setting gates display and entry, and deletes nothing', () => {
  /**
   * MEMBER RANK. Every rule here is executed in `@/features/members/utils/rank`; what is read
   * here is the wiring a `.tsx` holds and nothing executes (AD-15).
   */
  it('offers the setting as one labelled radio group in its own dialog', () => {
    const card = source(SETTINGS_FIRE_RANKS);
    const radios = /<RadioGroup\b([\s\S]*?)>/.exec(card)?.[1] ?? '';

    expect(radios, 'no fire-rank setting on the settings surface').not.toBe('');
    expect(radios).toContain('aria-labelledby={ORGANIZATION_FIRE_RANKS_LABEL_ID}');
    expect(radios, 'what switching it off keeps, or the refusal, is not said').toContain(
      'aria-describedby={failure === null ? ORGANIZATION_FIRE_RANKS_HINT_ID : ORGANIZATION_FIRE_RANKS_REFUSED_DESCRIPTION}',
    );
    expect(radios).toContain('disabled={pending}');
    expect(card).toContain('FIRE_RANKS_OPTIONS.map(');
    expect(card).toContain('t(fireRanksMessageKey(option))');
    // SEEDED FROM THE ROW, so the dialog opens on what the organization uses.
    expect(card).toContain('useState(fireRanksValue(organization.usesFireRanks))');
    // THE FACT AND THE LANDED SAVE are both read off the row.
    expect(card, 'the fact is not what the row holds').toContain(
      't(fireRanksMessageKey(organization.usesFireRanks))',
    );
    expect(card, 'a landed save does not say what the row now holds').toContain(
      't(fireRanksStatusMessageKey(organization.usesFireRanks))',
    );
    // AN UNEXPECTED VALUE KEEPS THE STORED SETTING (`fireRanksOf`, executed).
    expect(card).toContain('saveFireRanks(fireRanksOf(chosen, organization.usesFireRanks))');
  });

  it('writes the setting on its own, on its Spremi', () => {
    const write = componentFunction(source(SETTINGS_HOOK), 'saveFireRanks');

    expect(write, 'no saveFireRanks function to read').not.toBe('');
    expect(write).toContain('{ usesFireRanks: uses }');
    expect(write).toContain('updateOrganization(');
    for (const handler of ['saveName', 'saveLeaveYear']) {
      expect(componentFunction(source(SETTINGS_HOOK), handler), 'an identity save carries the setting').not.toContain(
        'usesFireRanks',
      );
    }
  });

  it.each([
    {
      name: 'the member create form',
      file: MEMBER_CREATE,
      options: 'RANK_OPTIONS.map(',
      stored: 'null',
    },
    {
      name: 'the member edit form',
      file: MEMBER_EDIT,
      options: 'rankOptionsFor(member.fireRank).map(',
      stored: 'member.fireRank',
    },
  ])('offers the rank on $name only while the setting is on', ({ file, options, stored }) => {
    const screen = source(file);
    const handler = submitHandler(screen);

    expect(screen, 'the rank control is not gated on the setting').toMatch(
      /\{offersRank \? renderRank\([^)]*\) : null\}/,
    );
    expect(screen).toContain('const offersRank = ranksShownIn(');
    // THROUGH THE ONE FACTORY, which names the snapshot key; `snapshot.test.ts`
    // asserts the key it registers. A key written here would be a second one.
    expect(screen, 'the organization is not read through the one factory').toContain(
      'organizationSnapshotQueryOptions(',
    );
    expect(screen, 'the organization is read under a key of its own').not.toMatch(
      /useQuery\(\{\s*queryKey: ORGANIZATION_SNAPSHOT_KEY/,
    );
    expect(screen, 'the snapshot key is spelled by hand').not.toContain("['organization']");
    expect(screen).toContain(options);
    expect(screen).toContain('t(rankMessageKey(option))');
    expect(labelTargets(screen)).toContain('member-rank');
    // ONE EXECUTED CALL decides what the save sends (`rankEditOf`, run in
    // `rank.test.ts`), with the row's own rank as the stored value — never
    // `null`, which would wipe a rank the control merely showed.
    expect(handler, 'the rank edit is not decided by the tested helper').toContain(
      `...rankEditOf(${stored}, rank?.value ?? null, offersRank)`,
    );
    expect(screen, 'the rank control is not seeded by the tested helper').toContain(
      `defaultValue={rankInitialValue(${stored})}`,
    );
    expect(handler).not.toContain('chosenRank(');
  });

  it.each([
    { name: 'the member create form', file: MEMBER_CREATE, readers: [join(MEMBERS_FEATURE, 'hooks', 'use-member-create.ts')] },
    // TWO HOOKS SINCE STORY 5.1c, ONE READ EACH: the leave card's hook reads
    // the leave year off the same cache entry, through the same factory — a
    // second consumer of one read policy, never a second policy.
    {
      name: 'the member edit form',
      file: MEMBER_EDIT,
      readers: [join(MEMBERS_FEATURE, 'hooks', 'use-member-edit.ts'), join(LEAVE_FEATURE, 'hooks', 'use-member-leave.ts')],
    },
  ])("reads the organization on $name through the one read policy", ({ file, readers }) => {
    // B1'S REVIEW FOUND TWO POLICIES on one cache entry: the create screen read
    // `ORGANIZATION_SNAPSHOT_KEY` with no `retry: false` and no `staleTime`, the
    // edit screen with both. Both now go through the factory, whose key, retry
    // and bound `snapshot.test.ts` asserts, and neither spells any of it out.
    // COUNTED PER FILE: each named hook reads it exactly once, every other
    // file of the set not at all.
    const screen = source(file);

    for (const part of typeof file === 'string' ? [file] : file) {
      const reads = readers.includes(part) ? 1 : 0;

      expect(
        source(part).match(/useQuery\(\s*organizationSnapshotQueryOptions\(/g) ?? [],
        `the organization is not read exactly ${String(reads)} time(s) through the factory in ${part}`,
      ).toHaveLength(reads);
      expect(occurrences(source(part), 'organizationSnapshotQueryOptions('), `the factory is called again in ${part}`).toBe(
        reads,
      );
    }
    expect(screen, 'the read is spelled out beside the factory').not.toContain('readOrganization(');
    expect(screen, 'a read policy is spelled out beside the factory').not.toMatch(
      /retry: false|ORGANIZATION_READ_STALE_MS/,
    );
    // THE UNWRAP IS SHARED too, rather than repeated per screen: `ranksShownIn`,
    // executed in `rank.test.ts`.
    expect(screen, 'the snapshot is unwrapped by hand').toContain('ranksShownIn(');
    expect(screen, 'the snapshot is unwrapped by hand').not.toMatch(/\.ok \? [\w.]+\.snapshot : null/);
  });

  it.each([
    // SOURCE STRUCTURE B7: the roster's read, in the hook that holds it.
    { name: 'the team roster', file: TEAM_ROSTER_HOOK },
  ])("reads the organization on $name through the chrome's own factory", ({ file }) => {
    // The deferred fix-member-screens item: one query function and one policy
    // for the key, whichever of the chrome and the roster mounted first.
    const screen = source(file);

    expect(screen.match(/useQuery\(\s*organizationSnapshotQueryOptions\(/g) ?? []).toHaveLength(1);
    expect(screen, 'the read is spelled out beside the factory').not.toContain('readOrganization(');
    expect(screen, 'a read policy is spelled out beside the factory').not.toMatch(/retry: false|ORGANIZATION_READ_STALE_MS/);
  });

  it('shows the rank on the roster only while the setting is on, as text', () => {
    // SOURCE STRUCTURE B7: the setting derived in the hook, the line drawn in
    // the component.
    // STORY 7.17: the lines are a part of their own, shared with the directory.
    const screen = source(TEAM_ROSTER_LINES);

    expect(screen).toContain('rosterRankMessageKey(member.fireRank, shown)');
    expect(source(TEAM_ROSTER_HOOK)).toContain('const shown = ranksShown(');
    expect(occurrences(source(TEAM_ROSTER), 'ranksShown('), 'the setting is derived twice').toBe(1);
    // WHICH LINE is `rosterLineOf`'s decision (`position.test.ts` runs all four).
    expect(screen).toContain('rosterLineOf(member.name, rank, position, (key) => t(key))');
    expect(screen).toContain('line.key === null ? line.text : t(line.key, line.values)');
  });
});

describe('team position: the setting gates the position control and the roster text', () => {
  /**
   * TEAM POSITION. Every rule is executed in `@/features/members/utils/position` and
   * `@/features/members/services/write`; what is read here is the wiring the `.tsx` holds.
   */
  it('offers the position beside the team only through the tested gates', () => {
    const screen = source(MEMBER_EDIT);
    const position =
      selectElements(screen).find((control) => control.includes('id="member-position"')) ?? '';

    expect(position, 'no position control on the member edit form').not.toBe('');
    expect(labelTargets(screen)).toContain('member-position');
    // THE SETTING AS A STATE (on, off, pending, failed), and the offer from it:
    // no move until it is known (`write.test.ts` runs all four).
    expect(screen).toContain('const positionsSetting = teamPositionsSettingOf(organization);');
    expect(screen).toContain('const offersPosition = teamPositionsOn(positionsSetting);');
    expect(screen).toContain('teamOfferFor(form.member, activeTeams, today, positionsSetting)');
    expect(screen).toContain('teamPositionsRefusalOf(positionsSetting)');
    expect(screen, 'the screen derives the setting on its own').not.toContain('positionsShown(');
    // Shown only for a picked team, while positions are offered.
    expect(screen).toMatch(/!offersPositionFor\(offered, pickedTeam\)\) return null;/);
    expect(position).toContain('defaultValue={positionPickerDefault(offered, pickedTeam)}');
    expect(screen).toContain('<Fragment key={pickedTeam}>');
    expect(screen).toContain('t(positionMessageKey(option))');
    // ONE SOURCE for the picked team: the state, for the position control and
    // the confirmation alike — never the DOM.
    expect(screen).toContain('chosenTeam(pickedTeam, offered)');
    expect(screen).toContain('teamPositionToSend(offered, pickedTeam, ');
    expect(screen, 'the picked team is read back off the DOM').not.toMatch(/teamField/);
    expect(screen).toContain('key={teamSelectKey(offered)}');
    expect(screen).toMatch(/confirmation\.position,\s*\);/);
    // A refusal for a missing position re-reads the organization.
    expect(screen).toMatch(
      /teamRefusalRereadsOrganization\(outcome\.refusal\.code\)\)[\s\S]{0,120}?queryKey: ORGANIZATION_SNAPSHOT_KEY/,
    );
    expect(screen).toContain('teamScheduledLineOf(member, today, offersPosition)');
  });

  it('shows the position on the roster only while the setting is on, as text', () => {
    // SOURCE STRUCTURE B7: the setting derived in the hook, the line drawn in
    // the component.
    // STORY 7.17: the lines are a part of their own, shared with the directory.
    const screen = source(TEAM_ROSTER_LINES);

    expect(source(TEAM_ROSTER_HOOK)).toContain('const positionShown = positionsShown(snapshot);');
    expect(occurrences(source(TEAM_ROSTER), 'positionsShown('), 'the setting is derived twice').toBe(1);
    expect(screen).toContain('rosterPositionMessageKey(member.position, positionShown)');
    expect(screen).toContain('rosterLineOf(member.name, rank, position, (key) => t(key))');
  });
});

describe('the two member forms write through the seam and keep nothing back', () => {
  /**
   * Story 1.5b's screens, swept for the four things no node test could see any
   * other way — and every one of them is a claim about a `.tsx`, which is
   * executed by nothing at all (AD-15).
   *
   * The BEHAVIOUR of the write path — the PostgREST-versus-function branch, the
   * partial save, the form gates — is executed in `features/members/services/write.test.ts`
   * against stubs. What is left here is that the screens ROUTE through it, hold
   * no branch of their own, and do not keep the one value in this system that
   * cannot be recovered.
   */

  /** Every `console.<method>(…)` call and its arguments. */
  function consoleCalls(text: string): string[] {
    return [...text.matchAll(/console\.\w+\([^;]*?\)/g)].map((found) => found[0]);
  }

  /** The three files the issued credential passes through. */
  const CREDENTIAL_PATH = [
    { name: 'the member create form', file: MEMBER_CREATE },
    { name: 'the member edit form', file: MEMBER_EDIT },
    { name: 'the member write rules', file: MEMBER_WRITE_KEYS },
  ];

  it.each(CREDENTIAL_PATH)('persists nothing of the credential in $name', ({ file }) => {
    // SHOWN EXACTLY ONCE is the story's acceptance criterion, and "once" is a
    // claim about every place a value can outlive a render. Browser storage
    // survives the tab; a query cache survives the navigation; and `console`
    // survives both — which is the one the previous iteration shipped, because
    // every assertion about the credential was about the SCREEN and a log line
    // is not on the screen.
    const text = source(file);

    for (const store of ['localStorage', 'sessionStorage', 'indexedDB', 'setQueryData']) {
      expect(text, `${store} is reached for on a path the credential travels`).not.toContain(store);
    }
  });

  it.each(CREDENTIAL_PATH)('logs no credential in $name, whatever else it logs', ({ file }) => {
    // Deliberately NOT "logs nothing": every one of these files logs a cause it
    // cannot render, and must. What it may not do is name the credential in one
    // — `console.error(MEMBER_CREATED, body)` reads as an ordinary diagnostic
    // and puts the password in a place anybody with the tab open can read long
    // after the panel is gone.
    const calls = consoleCalls(source(file));

    for (const call of calls) {
      for (const secret of ['credential', 'password', 'Password']) {
        expect(call, `a console call names ${secret}: ${call}`).not.toContain(secret);
      }
    }
  });

  it('would notice a credential in a log, and not notice an ordinary one', () => {
    // BOTH POLARITIES. A reader that matched no call at all would make the sweep
    // above pass over a file that logs the password on every create.
    expect(consoleCalls("console.error(CODE, credential);")).toEqual([
      'console.error(CODE, credential)',
    ]);
    expect(consoleCalls('console.error(CODE, cause);')[0]).not.toContain('credential');
    expect(consoleCalls('setFailure(code);')).toEqual([]);
  });

  it('shows the credential once and never re-reads it from anywhere', () => {
    // The panel is fed from the RETURNED outcome and from nothing else. Reading
    // it back off a query, a ref or a route search parameter would be a second
    // copy, and a second copy is what "exactly once" forbids.
    const screen = source(MEMBER_CREATE);

    expect(screen, 'the credential is not component state').toMatch(
      /useState<IssuedCredential \| null>\(null\)/,
    );
    expect(screen, 'the credential does not come from the create outcome').toContain(
      'setCredential(outcome.credential)',
    );
    // The form and the panel are MUTUALLY EXCLUSIVE, so there is no moment at
    // which a second create could overwrite a password nobody has read yet.
    expect(screen, 'the form and the credential panel can be on screen together').toMatch(
      /credential === null \? renderForm\(\) : renderCredential\(credential\)/,
    );
  });

  it('shows the RESET credential once and never re-reads it from anywhere either', () => {
    // THE SAME SHAPE ON THE SECOND SCREEN THAT ISSUES ONE, and the pair is the
    // point: `CREDENTIAL_PATH` above already sweeps this file for storage and
    // for logs, but nothing said the panel is fed from the returned outcome
    // rather than from a query, a ref or a route search parameter — and a
    // second copy is what "exactly once" forbids.
    const screen = source(MEMBER_EDIT);

    expect(screen, 'the credential is not component state').toMatch(
      /useState<RaisedForMember<ResetCredential> \| null>\(null\)/,
    );
    expect(screen, 'the credential does not come from the reset outcome').toContain(
      'setIssued({ member: member.id, raised: outcome.credential })',
    );
    // AND IT CAN BE PUT AWAY. A panel with no dismiss blocks every later reset
    // on the one account with no other recovery route, for as long as the
    // screen stays open — and iteration 0 shipped a doc comment describing a
    // dismiss control that existed nowhere.
    expect(screen, 'a shown credential can never be cleared').toContain('setIssued(null)');
  });

  it('decides the reset stage in a function a test runs, not in the screen', () => {
    // AD-15: a `.tsx` is executed by nothing. The four-stage decision — offer,
    // confirmation, in flight, shown — is `resetStageOf` in `@/features/members/services/write`,
    // where `write.test.ts` drives every branch. What is left here is that the
    // screen ASKS it and holds no stage branch of its own over the flags.
    const screen = source(MEMBER_EDIT);

    expect(screen, 'the screen does not route through the stage function').toMatch(
      /resetStageOf\(armedFor !== null, resetPending, credential\)/,
    );

    // CALLING IT IS NOT CONSULTING IT. The assertion above matches the call
    // text and nothing else, and the screen held its own `armedFor !== null`
    // branch one line below it — so `RESET_IDLE` and `RESET_ARMED` were stages
    // the function returned and its only consumer never read, and two of the
    // four lived in a copy of the rule no test executes. The copy DISAGREED
    // with the original in exactly the case `write.test.ts` pins: with a
    // request in flight and the armed flag already cleared, `resetStageOf`
    // answers `busy` and `armedFor !== null` answers "render the plain,
    // ENABLED offer".
    const render = componentFunction(screen, 'renderReset');
    const confirmation = componentFunction(screen, 'renderConfirmation');

    expect(render, 'no reset block to read').not.toBe('');
    for (const named of ['RESET_SHOWN', 'RESET_ARMED', 'RESET_BUSY', 'RESET_IDLE']) {
      expect(
        `${render}\n${confirmation}`,
        `${named} is a stage the function returns and the screen never reads`,
      ).toContain(`stage === ${named}`);
    }
    // AND THE RULE IS NOT RE-DERIVED BESIDE IT. A bare `armedFor !== null`
    // deciding what to render is the second copy, whatever else the block says.
    expect(
      render,
      'the reset block decides armed-versus-idle without consulting the stage',
    ).not.toMatch(/if\s*\(\s*armedFor !== null\s*\)/);
  });

  it('keeps the confirmation mounted while the reset is in flight', () => {
    // THE DEFECT THIS EXISTS FOR. Disarming before the await unmounts the
    // confirm pair and renders the plain, ENABLED offer for the whole request,
    // so the busy state is carried by no control at all and a second press
    // starts a second reset. The disarm therefore belongs in the `finally`,
    // after the request has settled — which is also where both flags are
    // cleared.
    const handler = namedHandler(source(MEMBER_EDIT), 'issue');
    const block = finallyBlock(handler);

    expect(handler, 'no reset handler to read').not.toBe('');
    expect(block, 'the reset disarms outside its finally, so the offer can render mid-flight')
      .toContain('setArmed(null)');
    // And nothing disarms BEFORE the await: `setArmed(null)` appears in this
    // handler exactly once, inside the block above.
    expect(occurrences(handler, 'setArmed(null)'), 'the reset disarms more than once').toBe(1);

    // AND THE CONFIRMATION CARRIES THE BUSY STATE. A pair that stays mounted
    // but stays pressable is the same defect reached a different way: the
    // second press starts a second reset over the first one's answer.
    const confirmation = componentFunction(source(MEMBER_EDIT), 'renderConfirmation');

    expect(confirmation, 'no confirmation to read').not.toBe('');
    expect(confirmation, 'the confirmation never reads the in-flight stage').toContain(
      'stage === RESET_BUSY',
    );
    for (const element of buttonElements(confirmation)) {
      expect(element, `a confirmation control stays pressable in flight: ${element}`).toContain(
        'disabled={busy}',
      );
    }
    expect(confirmation, 'nothing announces the wait to assistive technology').toContain(
      'aria-busy={busy}',
    );
  });

  it('needs a second, distinct confirmation before anything is reset', () => {
    // ONE PRESS RESETS NOTHING. The offer only arms; the confirm is what calls
    // the write path, and it names the member so the second press is a more
    // specific decision rather than the same press twice.
    const screen = source(MEMBER_EDIT);
    const offer = componentFunction(screen, 'renderReset');
    const confirmation = componentFunction(screen, 'renderConfirmation');

    expect(offer, 'no offer to read').not.toBe('');
    expect(offer, 'the offer resets instead of arming').not.toContain('void issue()');
    expect(offer, 'the offer does not arm the confirmation').toContain('setArmed({');
    expect(confirmation, 'no confirmation to read').not.toBe('');
    expect(confirmation, 'the confirmation does not send the reset').toContain('void issue()');
    // BOTH HALVES OF THE PAIR: a confirmation with no way out is a control that
    // can only be answered one way.
    expect(confirmation, 'the confirmation cannot be cancelled').toContain('setArmed(null)');
  });

  it('renders the shown credential above every gate on the read', () => {
    // IT OUTRANKS EVERYTHING ELSE ON THE SCREEN, deliberately inverting the
    // gating rule the rest of this surface follows: a refetch that drops the
    // row, or a read that re-settles failed, must leave the password standing,
    // because looking again cannot recover it. Returning `null` for an absent
    // member ABOVE the shown branch is what erased it.
    const render = componentFunction(source(MEMBER_EDIT), 'renderReset');
    const shown = render.indexOf('RESET_SHOWN');
    const gate = render.indexOf('member === null');

    expect(shown, 'the reset block never checks for a shown credential').toBeGreaterThan(-1);
    expect(gate, 'the reset block never gates on the member row').toBeGreaterThan(-1);
    expect(shown, 'the member gate runs before the shown credential is rendered').toBeLessThan(gate);
  });

  it('renders no usable form once the organization read has settled failed', () => {
    // `organizacija.tsx:697-707`'s gating, copied IN FULL. Gated on "there is no
    // organization" alone this returns a skeleton for a read that has already
    // failed — an indefinitely pulsing bar, indistinguishable from a slow read,
    // with the message that explains it rendered by nothing. The decision is
    // `createFormStateOf`, which `write.test.ts` executes; what this pins is
    // that the screen asks it and returns NOTHING rather than a form.
    const render = componentFunction(source(MEMBER_CREATE), 'renderForm');

    expect(render, 'no renderForm to read').not.toBe('');
    expect(render, 'the create form is not gated on there being an organization').toMatch(
      /form\.organizationId === null/,
    );
    expect(render, 'a settled failed read still draws a skeleton for ever').toMatch(
      /form\.loading \?[\s\S]{0,200}?: null/,
    );
    expect(source(MEMBER_CREATE), 'the screen decides its own gating instead of asking').toContain(
      'createFormStateOf(',
    );
  });

  it('renders no form for a member id that reaches nobody', () => {
    // The same claim on the other screen, and the refusal it produces is its
    // OWN code rather than the policy refusal: `memberFormRefusalOf` settles
    // that, and a form seeded from nothing would save its defaults over
    // somebody's record.
    const screen = source(MEMBER_EDIT);

    expect(screen, 'the edit screen decides its own gating instead of asking').toContain(
      'memberFormRefusalOf(',
    );
    const render = componentFunction(screen, 'renderBody');

    expect(render, 'no renderBody to read').not.toBe('');
    expect(render, 'the edit form renders without a member to seed it from').toMatch(
      /form\.member !== null/,
    );
    expect(render, 'a settled failure still draws a skeleton for ever').toMatch(
      /form\.loading \?[\s\S]{0,200}?: null/,
    );
  });

  it('starts each opening of a dialog from the record as it is now (story 7.11)', () => {
    // Every field is uncontrolled, so `defaultValue` seeds the DOM at MOUNT and
    // never again. Each dialog's body is keyed to its OPENING rather than to
    // the row: a new opening seeds from the record as it is now, and a refetch
    // during one — a refused rename re-reads the list — leaves what is typed
    // alone. Five dialogs: the basics, the allowance, the team, the status
    // and — since story 7.12 — the leave record's, one body for new and amend.
    const screen = source(MEMBER_EDIT);

    expect(occurrences(screen, '<Fragment key={opening.key}>'), 'a dialog body is not keyed to its opening').toBe(5);
    expect(screen, 'the edit screen still keys a form to the row').not.toContain('memberFormKey(');
  });

  it('offers one link in the add dialog: the new member\'s page, from the second step only (story 7.13b)', () => {
    // The dialog closes onto the list, so it needs no way back; its one link
    // opens the page of the person it just created, and only when the reply
    // named the row.
    const screen = source(MEMBER_CREATE);
    const links = linkElements(screen);

    expect(links).toHaveLength(1);
    expect(attributeOf(links[0] ?? '', 'to')).toBe('/ljudi/$id');
    expect(componentFunction(screen, 'renderForm'), 'the page link is on the first step').not.toContain('<Link');
    expect(componentFunction(screen, 'renderCredential')).toContain('issued.memberId === null ? null');
  });

  it.each([
    { name: 'the member edit form', file: MEMBER_EDIT },
  ])('gives $name a way back to the list that is not a reset', ({ file }) => {
    // NEITHER ROUTE IS A DESTINATION, so the chrome offers no way off either
    // screen — and `type="reset"` restores the fields rather than leaving. A
    // screen reachable by URL whose only exit is the browser's Back button is a
    // dead end on a phone, where the tab bar is the only other navigation.
    const screen = source(file);
    const links = linkElements(screen);

    // STORY 5.4d: the edit form adds ONE more, "Natrag na konflikte" to the
    // queue, shown only while the page was reached from a conflict.
    expect(links, 'the screen offers a different number of links than its ways back').toHaveLength(file === MEMBER_EDIT ? 2 : 1);
    expect(attributeOf(links[0] ?? '', 'to'), 'the way back does not go to the list').toBe('/ljudi');
    expect(
      links.slice(1).map((link) => attributeOf(link, 'to')),
      'a link beyond the way back to the list goes anywhere but the conflicts queue',
    ).toEqual(file === MEMBER_EDIT ? ['/raspored'] : []);
    // And the link is NOT inside the gated branch: a read that settled failed
    // renders no form, and an exit rendered inside one would be the element
    // nobody can reach.
    expect(
      componentFunction(screen, 'renderForm'),
      'the way back is inside the branch that needs a successful read',
    ).not.toContain('<Link');
  });

  it.each([
    { name: 'the member create form', file: MEMBER_CREATE, seam: 'createMember(' },
    { name: 'the member edit form', file: MEMBER_EDIT, seam: 'saveMember(' },
  ])('routes $name through the write seam and builds nothing of its own', ({ file, seam }) => {
    const screen = source(file);

    expect(screen, `the screen no longer reaches ${seam}`).toContain(seam);
    expect(screen, 'the screen reaches the privileged function directly').not.toContain('.invoke(');
    for (const forbidden of ['fetch(', 'shift.invalid', 'createClient(']) {
      expect(screen, `the screen reaches for ${forbidden}`).not.toContain(forbidden);
    }
  });

  /** The one helper the member forms turn a refusal's keys into text with. */
  const REFUSAL_TEXT = join(MEMBERS_FEATURE, 'utils', 'refusal-text.ts');

  /**
   * Whether a form card renders its refusal through the helper. Read off the
   * CARD ALONE: both file sets include the helper, so a set-wide search for
   * the mapping is satisfied by the helper whatever the card renders.
   */
  function rendersRefusalText(card: string): boolean {
    return card.includes('refusalText(refusal)');
  }

  it.each([
    {
      name: 'the member create form',
      file: MEMBER_CREATE,
      card: join(MEMBERS_FEATURE, 'components', 'member-add-dialog.tsx'),
    },
    {
      name: 'the member edit form',
      file: MEMBER_EDIT,
      card: join(MEMBERS_FEATURE, 'components', 'member-basics-card.tsx'),
    },
  ])('delegates the failure-to-message pairing on $name rather than branching', ({ file, card }) => {
    // The shape every screen in this application is held to: a ternary over
    // codes written in a `.tsx` is executed by nothing, and swapping two of its
    // branches reports a taken username as a service outage with the suite
    // green. `memberWriteMessageKeys` is executed in `write.test.ts`.
    const screen = source(file);
    const helper = source(REFUSAL_TEXT);

    expect(
      rendersRefusalText(source(card)),
      'the form card no longer renders its refusal through refusalText',
    ).toBe(true);
    expect(helper, 'the helper no longer renders through the mapping').toContain(
      'memberWriteMessageKeys(refusal)',
    );
    expect(helper, 'the helper no longer joins the keys with the separator').toContain(
      'MESSAGE_SEPARATOR',
    );
    for (const key of ['ljudi.form.error.refused', 'ljudi.form.error.usernameTaken']) {
      expect(screen, `${key} is branched on in the screen`).not.toContain(key);
    }
  });

  it('would notice a form card rendering the refusal code instead of its text', () => {
    // BOTH POLARITIES, on the real card: the swap a reviewer showed passed the
    // set-wide check, because the helper carried the mapping for it.
    for (const name of ['member-add-dialog.tsx', 'member-basics-card.tsx']) {
      const card = source(join(MEMBERS_FEATURE, 'components', name));

      expect(rendersRefusalText(card), name).toBe(true);
      expect(
        rendersRefusalText(card.replace('{refusalText(refusal)}', '{String(refusal.code)}')),
        name,
      ).toBe(false);
    }
  });

  it('shows the credential BEFORE it refreshes the list, and survives a failed refresh', () => {
    // MUTATION-PROVEN ORDERING. `invalidateQueries` AWAITS the refetch, so it
    // rejects when the browser is offline or the session has just expired.
    // Written before `setCredential`, that rejection jumped to the handler's
    // catch, rendered "try again", and threw away the only copy of a password
    // for an account that had already been created — the admin told the write
    // failed about an account they now cannot hand to anybody. The one value
    // this story documents as unrecoverable may not depend on a cache refresh
    // succeeding.
    const handler = submitHandler(source(MEMBER_CREATE));

    expect(handler, 'no submit handler to read').not.toBe('');
    expect(
      handler.indexOf('setCredential(outcome.credential)'),
      'the list is refreshed before the credential is shown, so a failed refresh destroys it',
    ).toBeLessThan(handler.indexOf('invalidateQueries('));
    // AND ISOLATED, not merely ordered: a rejection after the panel is set
    // would still reach the outer catch and replace it with a refusal.
    expect(handler, 'the refresh can still take the credential down with it').toMatch(
      /try \{[^}]*invalidateQueries\([\s\S]{0,160}?\}\s*catch/,
    );
  });

  it('keeps the specific refusal when refreshing the list is what failed', () => {
    // The same ordering on the edit screen, and what it protects is the
    // `saved: true` half of a partial save: the four ordinary fields really did
    // reach the database, and a rejecting refetch replacing that with the
    // generic failure is the one fact the spec was amended to introduce being
    // discarded by something unrelated to it.
    const handler = submitHandler(source(MEMBER_EDIT));

    expect(handler, 'no submit handler to read').not.toBe('');
    expect(handler.search(/refreshAfterWrite\(/), 'the save no longer refreshes the list').toBeGreaterThan(0);
    expect(
      handler.indexOf('setFailure(outcome.refusal)'),
      'the list is refreshed before the refusal is surfaced, so a failed refresh replaces it',
    ).toBeLessThan(handler.search(/refreshAfterWrite\(/));
    expect(handler, 'the refresh can still take the refusal down with it').toMatch(
      /try \{[^}]*refreshAfterWrite\([\s\S]{0,240}?\}\s*catch/,
    );
  });

  it('invalidates the member list rather than patching what it believes it wrote', () => {
    // `organizacija.tsx:293`'s rule, and there is no `useMutation` anywhere in
    // this application to carry an optimistic patch instead. What is on screen
    // after a write is what the database holds.
    expect(source(MEMBER_CREATE), 'the write does not refresh the list').toMatch(
      /invalidateQueries\(\{\s*queryKey:\s*MEMBERS_LIST_KEY\s*\}\)/,
    );
    // The edit screen's writes re-read the list through the declared
    // dependents' one call, the list as the own key.
    expect(source(MEMBER_EDIT), 'the write does not refresh the list').toMatch(
      /refreshAfterWrite\(\s*queryClient,\s*MEMBERS_LIST_KEY,/,
    );
  });

  it('confirms a save, because nothing else on the edit screen would', () => {
    // Every field is uncontrolled and remounts to the values it was just saved
    // with, so a successful save leaves the screen looking EXACTLY as it did
    // before the press — indistinguishable from a click that did nothing, on
    // the one surface whose whole job is changing a record. The create screen
    // has its credential panel; this is the edit screen's.
    const screen = source(MEMBER_EDIT);

    expect(screen, 'a successful save says nothing at all').toContain("t('ljudi.form.saved')");
    // `role="status"` and never `role="alert"`: the assertive region is the
    // refusal's, and a second one would be a second thing competing to be
    // announced.
    expect(screen, 'the confirmation competes with the refusal to be announced').toMatch(
      // VISUAL REFRESH B: the `Notice` primitive renders the `<p>`.
      /<Notice role="status"[\s\S]{0,120}?ljudi\.form\.saved/,
    );
  });

  it('scopes what it raised to the member it was raised about', () => {
    // ONE COMPONENT INSTANCE SERVES EVERY ROW: moving between two members
    // changes a route param, not the component, so state survives the move. The
    // FORM remounts via `memberFormKey` and the alert above it did not, so a
    // refusal raised on one member stood over another's form. The decision is
    // `raisedForMember`, executed in `write.test.ts`; what this pins is that
    // the screen asks it rather than reading the state directly.
    const screen = source(MEMBER_EDIT);

    expect(screen, 'the refusal is not scoped to a member').toMatch(
      /raisedForMember\(failure, id\)/,
    );
    expect(screen, 'the confirmation is not scoped to a member').toMatch(
      /raisedForMember\(saved, id\)/,
    );
  });

  it.each([
    {
      name: 'the member create form',
      file: MEMBER_CREATE,
      // B298: the name, the username and the address, refused by the form itself.
      marked: ['member-leave', 'member-name', 'member-username', 'member-email'],
      leaveId: "id=\"member-leave\"",
      leaveMark: "aria-invalid={invalidField === 'member-leave'}",
    },
    // The status and team dates are marked by their own blocks' refusals; see
    // the date test below.
    {
      name: 'the member edit form',
      file: MEMBER_EDIT,
      // STORY 5.1c: the leave card's od and do, marked by its own refusals.
      // STORY 7.11: the allowance's field is in its own dialog, its id named
      // once (`MEMBER_ALLOWANCE_FIELD_ID`, `member-leave`), so it is matched
      // by its constant rather than a literal.
      // B298: the name, the username and the address, refused by the form itself.
      marked: [
        null,
        'member-leave-from',
        'member-leave-to',
        'member-status-date',
        'member-team-date',
        'member-name',
        'member-username',
        'member-email',
      ],
      leaveId: 'id={MEMBER_ALLOWANCE_FIELD_ID}',
      leaveMark: 'aria-invalid={invalidField === MEMBER_ALLOWANCE_FIELD_ID}',
    },
  ])('names the offending field on $name when it refuses one itself', ({ file, marked: ids, leaveId, leaveMark }) => {
    // THE ONE REFUSAL EACH SCREEN RAISES ITSELF is also the one it knows the
    // FIELD for — an allowance that is not a whole number the column can hold —
    // and a five-field form saying "Unesena vrijednost nije dopuštena." with no
    // indication of which value leaves somebody re-reading all five.
    // `aria-invalid` carries it to assistive technology; moving focus carries
    // it to everybody else.
    const screen = source(file);
    const handler = submitHandler(screen);

    expect(handler, 'no submit handler to read').not.toBe('');
    expect(handler, 'the locally-refused field is not marked').toMatch(
      /leaveAllowanceDays === null[\s\S]{0,400}?setInvalidField\(/,
    );
    expect(handler, 'focus is not moved to the field the message is about').toMatch(
      /leaveAllowanceDays === null[\s\S]{0,400}?\.focus\(\)/,
    );
    // B298: the form is `noValidate`, so a blank name or username and a
    // malformed address are refused here too, the field marked and focused.
    expect(handler, 'the entered fields are not refused by the form itself').toMatch(
      /memberEntryRefusalOf\([\s\S]{0,700}?setInvalidField\([\s\S]{0,80}?\.focus\(\)/,
    );
    // The mark is CLEARED before the next attempt, or a corrected field stays
    // announced as invalid for the rest of the session.
    expect(handler, 'the invalid mark is never cleared').toContain('setInvalidField(null)');

    const marked = inputElements(screen).filter((input) => input.includes('aria-invalid'));

    expect(
      marked.map((input) => attributeOf(input, 'id')).sort((a, b) => String(a).localeCompare(String(b))),
      'the marked controls are not the ones the refusals are about',
    ).toEqual([...ids].sort((a, b) => String(a).localeCompare(String(b))));
    expect(
      marked.find((input) => input.includes(leaveId)),
      'the leave field is not marked by the form refusal',
    ).toContain(leaveMark);
  });

  it.each([
    {
      name: 'the status block',
      id: 'member-status-date',
      flag: 'statusDateInvalid',
      refusal: 'statusRefusal',
      mark: 'statusDateMark',
      setMark: 'setStatusDateMark',
      key: 'statusBlockKey',
      arm: 'armStatus',
      change: 'writeStatus',
    },
    {
      name: 'the team block',
      id: 'member-team-date',
      flag: 'teamDateInvalid',
      refusal: 'teamRefusal',
      mark: 'teamDateMark',
      setMark: 'setTeamDateMark',
      key: 'teamBlockKey',
      arm: 'armTeam',
      // STORY 5.5e: the server refusal is the writer's.
      change: 'writeTeam',
    },
  ])(
    'marks the date on $name invalid when its own refusal names it',
    ({ id, flag, refusal, mark, setMark, key, arm, change }) => {
      // FOUND BY B1'S REVIEW: a preflight refusal moved focus to the date and
      // said nothing to assistive technology about it being the wrong value,
      // while the leave field on the same screen was marked. WHICH refusals name
      // the date is `dateMarkFor`'s decision and whether the mark still stands is
      // `dateMarked`'s, both executed in `date-refusal.test.ts`; what this pins is
      // that the control reads them off its OWN block's refusal and history.
      const screen = source(MEMBER_EDIT);
      const input = inputElements(screen).find((element) => attributeOf(element, 'id') === id) ?? '';

      expect(input, `no ${id} control to read`).not.toBe('');
      expect(input, 'the date is not marked by the tested decision').toContain(`aria-invalid={${flag}}`);
      // ON THE BLOCK'S OWN REFUSAL AND HISTORY, so a remounted block starts
      // unmarked and another block's refusal never marks it.
      expect(screen, 'the mark is not derived from this block\'s own refusal').toMatch(
        new RegExp(
          `const ${flag} = dateMarked\\(\\s*${mark},\\s*${refusal},\\s*` +
            `form\\.member === null \\? null : ${key}\\(form\\.member\\),?\\s*\\);`,
        ),
      );
      // RAISED FROM BOTH SITES, and told which one: `MEMBER_WRITE_INVALID` names
      // the date only from the preflight.
      expect(namedHandler(screen, arm), 'the preflight refusal marks no date').toMatch(
        new RegExp(`${setMark}\\(dateMarkFor\\(raised, ${key}\\(member\\), true\\)\\)`),
      );
      expect(namedHandler(screen, change), 'the server refusal marks no date').toContain(
        `${setMark}(dateMarkFor(outcome.refusal, ${key}(member), false))`,
      );
    },
  );

  it.each([
    { name: 'the member create form', file: MEMBER_CREATE },
    { name: 'the member edit form', file: MEMBER_EDIT },
  ])('bounds the allowance on $name at what the column can hold', ({ file }) => {
    // `0002:145` types `leave_allowance_days` as `smallint`, so 32768 is not a
    // large allowance — it is `22003`, a refusal about a storage type naming
    // nothing an admin can act on. AD-3 prefers a control that cannot EXPRESS
    // the broken case, which is the argument `0002:106` already makes about the
    // leave year's day.
    const bounded = inputElements(source(file)).filter((input) =>
      input.includes('max={LEAVE_ALLOWANCE_MAX}'),
    );

    expect(bounded, 'the allowance field carries no upper bound').toHaveLength(1);
  });

  it('renders aria-sort only on the columns that sort', () => {
    // THE ACTIONS COLUMN IS NOT SORTABLE, and `none` is not "this column does
    // not sort" — it is "this column sorts and is not currently sorted". On a
    // header carrying a link, it offers assistive technology exactly the
    // affordance the column exists without.
    const screen = source(MEMBER_LIST);
    const heads = [...screen.matchAll(/<TableHead\b([^>]*)>/g)].map((found) => found[1] ?? '');

    // TWO: the one written inside the map over `MEMBER_COLUMNS`, and the
    // actions column's own. The count is what notices a third arriving.
    expect(heads, 'the member list no longer renders the headers this reads').toHaveLength(2);
    expect(
      heads.filter((head) => head.includes('aria-sort')),
      'aria-sort is on a column that does not sort, or missing from one that does',
    ).toHaveLength(1);
    // The unsorted one is the actions column, named rather than inferred from
    // its position: a `<th>` with no text is announced as nothing at all.
    expect(screen, 'the actions column carries no heading').toMatch(
      /<TableHead[^>]*>\{t\('ljudi\.form\.actions'\)\}<\/TableHead>/,
    );
  });

  it('names the row action after the member it acts on', () => {
    // Four hundred rows announcing the same three words is four hundred
    // controls a screen-reader user cannot tell apart. WHICH field names it is
    // a decision, and it lives in `@/features/members/services/list` where `list.test.ts`
    // executes it — `member.email` here would announce every address in the
    // organization, and a tenth of the rows carry none.
    const screen = source(MEMBER_LIST);

    expect(screen, 'the row action does not interpolate the member').toMatch(
      /t\('ljudi\.form\.edit',\s*\{\s*name:\s*memberActionName\(member\)\s*\}\)/,
    );
  });
});

describe('a team or membership write re-reads every screen that shows it, once it landed', () => {
  /**
   * THE AMENDED CONVENTION (AD-13): a write invalidates its own key AND every
   * key whose read embeds or derives from the rows it writes. The lists are
   * declared once, in `@/features/teams/services/dependents`, and executed
   * against a real cache by `dependents.test.ts`. What is pinned here is the
   * wiring no node test can run: each write hands its own key and ITS list, and
   * the list only once the write landed — a refusal changed no row.
   */
  // The page's hook and, since the retro split (A16, A21), each card's own.
  const MEMBER_EDIT_HOOK = [
    join(MEMBERS_FEATURE, 'hooks', 'use-member-edit.ts'),
    join(MEMBERS_FEATURE, 'hooks', 'use-member-basics.ts'),
    join(MEMBERS_FEATURE, 'hooks', 'use-member-team.ts'),
    join(MEMBERS_FEATURE, 'hooks', 'use-member-status.ts'),
    join(MEMBERS_FEATURE, 'hooks', 'use-member-reset.ts'),
  ];
  /** The keys the member edit screen itself reads: the only ones it may name. */
  const MEMBER_EDIT_OWN = ['MEMBERS_LIST_KEY', 'TEAMS_LIST_KEY', 'ORGANIZATION_SNAPSHOT_KEY'];
  const refreshesIn = (text: string): string[] =>
    [...text.matchAll(/refreshAfterWrite\(([^;]*?)\);/g)].map((found) =>
      (found[1] ?? '').replace(/\s+/g, ' ').replace(/,\s*$/, '').trim(),
    );

  it.each([
    // STORY 5.5e: the team and status writes are their writers', which the
    // cards' confirmations and their erasure dialogs both call.
    { handler: 'writeTeam', gate: 'outcome.ok', dependents: 'MEMBERSHIP_WRITE_DEPENDENTS' },
    { handler: 'writeStatus', gate: 'outcome.ok', dependents: 'MEMBERSHIP_WRITE_DEPENDENTS' },
    { handler: 'submit', gate: 'outcome.ok || outcome.refusal.saved', dependents: 'MEMBER_SAVE_DEPENDENTS' },
  ])('re-reads $dependents after a landed $handler on the member edit screen', ({ handler, gate, dependents }) => {
    const body = namedHandler(source(MEMBER_EDIT_HOOK), handler);

    expect(body.length, `${handler} could not be extracted`).toBeGreaterThan(80);
    expect(refreshesIn(body), `${handler} does not re-read its declared dependents once it landed`).toEqual([
      `queryClient, MEMBERS_LIST_KEY, ${gate} ? ${dependents} : NO_DEPENDENTS`,
    ]);
    // AFTER the outcome is known, and in a `try` of its own, so a failed
    // re-read never turns a landed write into a refusal.
    expect(body.indexOf('const outcome = await'), `${handler} re-reads before it writes`).toBeLessThan(
      body.indexOf('refreshAfterWrite('),
    );
    expect(body, `${handler}'s re-read can take the outcome down with it`).toMatch(
      /try \{\s*await refreshAfterWrite\([\s\S]{0,800}?\}\s*catch \(cause\) \{\s*console\.error\(/,
    );
  });

  it('names no key on the member edit screen besides its own reads', () => {
    // Every other key it re-reads is a declared dependent, reached only
    // through `refreshAfterWrite`.
    const hook = source(MEMBER_EDIT_HOOK);
    const named = [...hook.matchAll(/invalidateQueries\(\{ queryKey: (\w+) \}\)/g)].map((found) => found[1]);

    expect(named.length, 'the reader found no re-read at all').toBeGreaterThan(0);
    expect(occurrences(hook, 'invalidateQueries('), 'a re-read the reader cannot see').toBe(named.length);
    for (const key of named) expect(MEMBER_EDIT_OWN, `${String(key)} is not the screen's own`).toContain(key);
    expect(hook, 'a dependent is named outside the declared lists').not.toMatch(/OWN_TEAM_KEY|TEAM_ROSTERS?_KEY/);
  });

  it.each([
    { hook: TEAM_LIST_HOOK, state: 'teamsSurfaceStateOf', notice: 'teamsNoticeOf' },
    { hook: join(MEMBERS_FEATURE, 'hooks', 'use-member-list.ts'), state: 'membersSurfaceStateOf', notice: 'membersNoticeOf' },
    { hook: HOUR_BAND_LIST_HOOK, state: 'hourBandsSurfaceStateOf', notice: 'hourBandsNoticeOf' },
    { hook: SHIFT_TYPE_LIST_HOOK, state: 'shiftTypesSurfaceStateOf', notice: 'shiftTypesNoticeOf' },
    { hook: TEAM_ROSTER_HOOK, state: 'teamRosterSurfaceStateOf', notice: 'teamRosterNoticeOf' },
  ])('announces a paused refetch on the list through $notice, never through the state', ({ hook, state, notice }) => {
    // A PAUSE OVER CACHED ROWS IS NOT A REFUSAL (the edit forms stay mounted),
    // so a list that read `refusal` off the state would say nothing about it.
    const text = source(hook);

    expect(text, `${hook} no longer reads the state`).toContain(`const state = ${state}(answer);`);
    expect(text, `${hook} announces the state's refusal, not the notice`).toContain(
      `const refusal = ${notice}(state);`,
    );
    expect(text, `${hook} still takes the refusal off the state`).not.toMatch(
      /const \{[^}]*\brefusal\b[^}]*\} = state;/,
    );
  });

  it.each([TEAM_EDIT_HOOK, HOUR_BAND_EDIT_HOOK, SHIFT_TYPE_EDIT_HOOK, join(MEMBERS_FEATURE, 'hooks', 'use-member-edit.ts')])(
    'keeps the edit form on a paused refetch in %s',
    (hook) => {
      // The edit hooks read the plain refusal: a pause never hides the form.
      expect(source(hook), 'an edit form hides itself on a pause').not.toMatch(/NoticeOf\(/);
    },
  );

  it('re-reads after a team create only once the create landed', () => {
    // A refused create returns before the re-read: nothing was written, and
    // the builder has no new team to bind.
    const body = namedHandler(source(TEAM_LIST_HOOK), 'submit');
    const refused = /if \(!outcome\.ok\) \{[\s\S]*?\breturn;\s*\}/.exec(body);

    expect(body.length, 'submit could not be extracted').toBeGreaterThan(80);
    expect(refused, 'the refused create no longer returns').not.toBeNull();
    expect(occurrences(body, 'refreshAfterWrite('), 'the create re-reads more than once').toBe(1);
    expect(
      (refused?.index ?? Infinity) + (refused?.[0].length ?? 0),
      'the create re-reads before its refusal returns',
    ).toBeLessThan(body.indexOf('refreshAfterWrite('));
  });

  it('re-reads the team change dependents only after a landed rename or archive', () => {
    const hook = source(TEAM_EDIT_HOOK);

    for (const name of ['submit', 'archive']) {
      const body = namedHandler(hook, name);

      expect(body.length, `${name} could not be extracted`).toBeGreaterThan(80);
      expect(occurrences(body, 'refresh('), `${name} re-reads more than once`).toBe(1);
      expect(body, `${name} re-reads the dependents whatever the outcome`).toContain('await refresh(outcome.ok);');
    }
  });
});
