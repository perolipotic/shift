import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SET_PASSWORD_SCREEN_EXEMPT } from '@/features/auth/set-password-screen.fixture';
import { SIGN_IN_SCREEN_EXEMPT } from '@/features/auth/sign-in-screen.fixture';
import {
  CALENDAR_SCREEN_EXEMPT,
  CALENDAR_SCREEN_PARTS,
} from '@/features/calendar/calendar-screen.fixture';
import {
  CONFLICTS_QUEUE_PARTS,
  CONFLICTS_SCREEN_EXEMPT,
  CONFLICT_RESOLUTION_PARTS,
} from '@/features/conflicts/conflicts-screen.fixture';
import { HOURS_SCREEN_EXEMPT, HOURS_SCREEN_PARTS } from '@/features/hours/hours-screen.fixture';
import { LEAVE_SCREEN_EXEMPT, LEAVE_SCREEN_PARTS } from '@/features/leave/leave-screen.fixture';
import { NOTIFICATIONS_SCREEN_EXEMPT } from '@/features/notifications/notifications-screen.fixture';
import { TODAY_SCREEN_EXEMPT } from '@/features/today/today-screen.fixture';
import {
  HOUR_BAND_EDIT_PARTS,
  HOUR_BAND_LIST_PARTS,
  HOUR_BAND_SCREENS_EXEMPT,
} from '@/features/hour-bands/hour-band-screens.fixture';
import {
  SETTINGS_SCREEN_EXEMPT,
  SETTINGS_SCREEN_PARTS,
} from '@/features/organization/settings-screen.fixture';
import {
  SHIFT_TYPE_EDIT_PARTS,
  SHIFT_TYPE_LIST_PARTS,
  SHIFT_TYPE_SCREENS_EXEMPT,
} from '@/features/shift-types/shift-type-screens.fixture';
import {
  TEAM_EDIT_PARTS,
  TEAM_ROSTER_PARTS,
  TEAM_SCREENS_EXEMPT,
} from '@/features/teams/team-screens.fixture';

import {
  ariaHaspopupValues,
  buttonElements,
  CALENDAR_SNAPSHOT_KEYS,
  CONFLICTS_FEATURE,
  CREDENTIAL_COPY_KEYS,
  DANAS,
  DANAS_PAGE,
  finallyBlock,
  GODISNJI,
  HOUR_BAND_EDIT,
  HOUR_BAND_EDIT_HOOK,
  HOUR_BAND_LIST,
  HOUR_BAND_LIST_HOOK,
  HOUR_BAND_LIST_KEYS,
  HOURS_KEYS,
  inputElements,
  KALENDAR,
  LEAVE_FEATURE,
  NOTIFICATIONS,
  NOTIFICATIONS_FEATURE,
  NOTIFICATIONS_KEYS,
  NOTIFICATIONS_PAGE,
  MEMBER_CREATE,
  MEMBER_DIRECTORY,
  MEMBER_EDIT,
  MEMBER_FACTS_KEYS,
  MEMBER_LIST,
  MEMBERS_FEATURE,
  MESSAGE_KEYS,
  MY_LEAVE_KEYS,
  namedHandler,
  NOT_FOUND,
  occurrences,
  POSITION_KEYS,
  RANK_KEYS,
  ZA_ODLUKU,
  RESOLUTION,
  SATI,
  SCREEN,
  SCREENS,
  screenSource,
  SET_PASSWORD_HOOK,
  SET_PASSWORD_PAGE,
  SET_PASSWORD_SCREEN,
  SETTINGS,
  SHARED_FILTER_BAR,
  SHARED_MONTH_NAV,
  SHARED_SORT_CONTROL,
  SHIFT_TYPE_EDIT,
  SHIFT_TYPE_EDIT_HOOK,
  SHIFT_TYPE_LIST,
  SHIFT_TYPE_LIST_HOOK,
  SHIFT_TYPE_LIST_KEYS,
  SIGN_IN_FORM,
  SIGN_IN_HOOK,
  SIGN_IN_PAGE,
  source,
  srcRoot,
  TEAM_EDIT,
  TEAM_EDIT_HOOK,
  TEAM_LIST,
  TEAM_LIST_HOOK,
  TEAM_LIST_KEYS,
  TEAM_LIST_PAGE,
  TEAM_ROSTER,
  TEAM_ROSTER_HOOK,
  TEAM_ROSTER_PAGE,
  TODAY_FEATURE,
  TODAY_KEYS,
} from './source-guards.fixture';
import { KEY_SOURCES } from './key-sources.fixture';

// The sweep's own reach: every screen, page and feature module is read by some
// set below `SCREENS`, so the app-wide sweeps in the sibling files mean something.

/** The auth feature, which holds the sign-in screen's parts. */
const AUTH_FEATURE = join(srcRoot, 'features', 'auth');

/** The organization feature, which holds the settings surface's parts. */
const ORGANIZATION_FEATURE = join(srcRoot, 'features', 'organization');

/** The settings surface's page, which only composes (source structure B2). */
const SETTINGS_PAGE = join(srcRoot, ...SETTINGS_SCREEN_PARTS.page);

/** The *Godišnji* screen's page, which only composes (story 5.2c). */
const GODISNJI_PAGE = join(srcRoot, ...LEAVE_SCREEN_PARTS.page);

/** The *Za odluku* screen's page, which only composes (story 5.3b). */
const ZA_ODLUKU_PAGE = join(srcRoot, ...CONFLICTS_QUEUE_PARTS.page);

/** Story 5.4b's resolution screen's page, which only composes. */
const RESOLUTION_PAGE = join(srcRoot, ...CONFLICT_RESOLUTION_PARTS.page);

/** Story 5.3b's rules: the queue's input, order, rows and guard. Renders no string. */
const CONFLICTS_QUEUE_RULES = join(CONFLICTS_FEATURE, 'services', 'conflicts-queue.ts');

/** The teams feature, which holds both team screens' parts. */
const TEAM_FEATURE = join(srcRoot, 'features', 'teams');

const TEAM_EDIT_PAGE = join(srcRoot, ...TEAM_EDIT_PARTS.page);

const TEAM_ROSTER_PART = join(srcRoot, ...TEAM_ROSTER_PARTS.roster);

/** The hour bands feature, which holds both hour band screens' parts. */
const HOUR_BAND_FEATURE = join(srcRoot, 'features', 'hour-bands');

/** The two hour band pages, which only compose (source structure B5), and their hooks. */
const HOUR_BAND_LIST_PAGE = join(srcRoot, ...HOUR_BAND_LIST_PARTS.page);

const HOUR_BAND_EDIT_PAGE = join(srcRoot, ...HOUR_BAND_EDIT_PARTS.page);

/** The shift types feature, which holds both shift type screens' parts. */
const SHIFT_TYPE_FEATURE = join(srcRoot, 'features', 'shift-types');

/** The two shift type pages, which only compose (source structure B4), and their hooks. */
const SHIFT_TYPE_LIST_PAGE = join(srcRoot, ...SHIFT_TYPE_LIST_PARTS.page);

const SHIFT_TYPE_EDIT_PAGE = join(srcRoot, ...SHIFT_TYPE_EDIT_PARTS.page);

/** The calendar feature, which holds the calendar screen's parts. */
const CALENDAR_FEATURE = join(srcRoot, 'features', 'calendar');

/** The calendar screen's page, which only composes (source structure B3). */
const KALENDAR_PAGE = join(srcRoot, ...CALENDAR_SCREEN_PARTS.page);

/** Story 7.4: the month toolbar's keyboard and picker rules, pure, beside it. */
const MONTH_KEYS = join(srcRoot, 'utils', 'month-keys.ts');

/** Story 7.5: *Kalendar*'s own filter bar, the one Select it replaced. */
const CALENDAR_FILTERS = join(srcRoot, ...CALENDAR_SCREEN_PARTS.filter);

/** Story 7.5: *Sati*'s own filter bar, the two Selects it replaced. */
const HOURS_FILTERS = join(srcRoot, ...HOURS_SCREEN_PARTS.organizationFilters);

/** The hours feature, which holds the *Sati* screen's parts (story 4.1b). */
const HOURS_FEATURE = join(srcRoot, 'features', 'hours');

/** The *Sati* screen's page, which only composes. */
const SATI_PAGE = join(srcRoot, ...HOURS_SCREEN_PARTS.page);

/** Story 7.11: the member page's element ids, named once; no string a screen renders. */
const MEMBER_ELEMENT_IDS = join(srcRoot, 'features', 'members', 'utils', 'element-ids.ts');

/**
 * STORY 8.2e: the read retry's ref callback (`utils/retry-focus.ts`), a
 * stateless module function rather than a hook-created ref. It holds nothing,
 * so there is no ref to create once in a hook; the ref sweeps skip it.
 */
const MODULE_REF_CALLBACKS: ReadonlySet<string> = new Set(['keepFocusOnAlert']);

/**
 * The route modules under `pages/` that are not screens, each for a stated
 * reason. Everything else under `pages/` must be in a `SCREENS` file set, which
 * the read-at-all block asserts off the disk.
 */
const PAGES_NOT_SCREENS = [
  // `/` is redirect-only: it decides where a person belongs and renders
  // nothing, so listing it would assert zero strings on a file with no JSX.
  'index.tsx',
  // STORY 7.13b: `/ljudi/novi` only redirects to *Ljudi*'s add dialog, which
  // leads the member create set.
  'ljudi.novi.tsx',
  // STORY 9.1: the queue's old URLs only redirect to their `/za-odluku`
  // twins, which lead the conflicts sets.
  'raspored.tsx',
  'raspored.$memberId.$date.$teamId.tsx',
  // The root route: an `<Outlet />` in a layout `div`, with no string and no
  // control. `not-found.tsx`, which it registers, is its own entry, and so is
  // the update notice it mounts (story 8.1).
  '__root.tsx',
];

describe('the screen is read at all, so every sweep below means something', () => {
  // THE COUNT IS THE GUARD, because neither list is length-asserted anywhere
  // else and both drive `it.each`: a removed row takes its cases with it, and
  // Vitest reports the shorter run as a pass. A row deleted without a reason
  // fails here until somebody moves the number, which is the moment the removal
  // gets reviewed — the same bargain `expectedFields` and `expectedButtons` strike per screen.
  //
  // FOURTEEN screens: eight `.tsx` that render — the sign-in form, the
  // not-found component, the organization prompt, the settings surface, the
  // member list, the organization lockup, the signed-in layout and the chrome —
  // plus the six placeholder destinations that are still only a heading. `/` is
  // not among them and must not be: it is a redirect-only route with no JSX for
  // any sweep to read.
  //
  // EIGHTEEN key sources: seven of those eight (the layout renders no string of
  // its own), the five `.ts` modules that declare keys and render nothing — the
  // four message mappings plus the member list's rules — and the six
  // destinations.
  it('sweeps every screen and every key source it claims to', () => {
    // STILL FOURTEEN after story 1.5a, and the arithmetic is the reason rather
    // than a coincidence: `/ljudi` left `PLACEHOLDER_SLUGS`, which removed a
    // derived entry, and arrived as a built one. A net of zero is what a
    // destination being BUILT rather than added looks like here.
    //
    // EIGHTEEN key sources, up from seventeen by the same arithmetic plus one:
    // the member list replaces its own placeholder entry, and `@/features/members/services/list`
    // is a new source — the module that holds the column headings, the level
    // labels, the filter options and the refusals, none of which a `.tsx` may
    // declare because nothing executes a `.tsx`.
    // SIXTEEN AFTER STORY 1.5b, and the arithmetic is the reason rather than a
    // coincidence: two `.tsx` that render arrived — the create form and the
    // edit form — and neither replaced a placeholder, because neither is a
    // destination. Nothing left the list.
    //
    // TWENTY-ONE key sources, up from eighteen by THREE and not two: both new
    // screens declare keys, and so does `@/features/members/services/write`, which holds the
    // failure-to-message union. That union cannot live in a `.tsx` — nothing
    // executes one — so the module is a source in its own right, exactly as
    // `@/features/members/services/list` is.
    //
    // EIGHTEEN AND TWENTY-FIVE SINCE STORY 1.7a: the two team screens, and
    // four key sources — both screens and both `@/features/teams` modules.
    //
    // NINETEEN AND TWENTY-SEVEN SINCE STORY 1.8: Danas left the placeholders
    // and arrived as a built entry (net zero), the roster screen is new (one),
    // and so is `@/features/teams/services/roster` as a key source (one more).
    //
    // TWENTY AND TWENTY-EIGHT SINCE VISUAL REFRESH A: the sign-in frame is a
    // new `.tsx` that renders strings, so it is one screen and one key source.
    //
    // TWENTY-TWO AND THIRTY-TWO SINCE STORY 2.1b: the two hour band screens,
    // and four key sources — both screens and both `@/features/hour-bands` modules.
    //
    // TWENTY-THREE AND THIRTY-FIVE SINCE STORY 2.2b: `/postavke-rotacije` left
    // the placeholders and arrived as a built entry (net zero on both lists),
    // the shift type edit screen is new (one each), and so are both
    // `@/features/shift-types` modules as key sources (two more).
    //
    // THIRTY-SEVEN KEY SOURCES SINCE TEAM POSITION: `@/features/members/utils/position`.
    //
    // TWENTY-FOUR AND FORTY SINCE STORY 2.3b: the rotation builder is a new
    // `.tsx` that renders strings (one each), and `@/features/rotation/services/list` and
    // `@/features/rotation/services/write` are key sources (two more).
    //
    // FORTY-ONE KEY SOURCES SINCE STORY 2.4: `@/features/rotation/utils/stepper`.
    //
    // FORTY-TWO SINCE STORY 2.5: `@/features/rotation/utils/warnings`.
    //
    // FORTY-THREE SINCE STORY 2.6: `@/features/rotation/services/history`.
    //
    // FORTY-FOUR SINCE STORY 3.1: `/kalendar` left the placeholders (one
    // generated entry fewer, its own entry instead, so SCREENS holds) and
    // `@/features/calendar/services/snapshot` joined.
    //
    // FORTY-FIVE SINCE STORY 3.2b: `@/features/calendar/utils/modifiers`.
    //
    // FORTY-SIX SINCE STORY 3.5b: `@/features/calendar/services/override-write`.
    //
    // TWENTY-FIVE AND FORTY-EIGHT SINCE STORY 3.5c: the override review is a
    // new `.tsx` that renders strings (one each), and
    // `@/features/rotation/services/override-disposition` is a key source.
    //
    // TWENTY-SEVEN SINCE STORY 5.5b: the shared erasure confirmation, lifted
    // out of the rotation builder; it renders the words it is handed and
    // holds no key, so no key source joins.
    //
    // TWENTY-SIX SINCE STORY 7.7: the organization prompt is gone. Bare
    // `/prijava` renders the sign-in screen, which is already an entry.
    //
    // TWENTY-SEVEN SINCE STORY 7.8: the set-password step.
    // TWENTY-EIGHT SINCE STORY 7.18: the rotation history's dialog.
    // TWENTY-NINE SINCE STORY 7.17: the member directory.
    // THIRTY-ONE SINCE THE ROUTER-GUARDS FIX: the error screen (A148) and the
    // pending skeleton (A224).
    // THIRTY-TWO SINCE STORY 8.1: the update notice.
    // THIRTY-THREE SINCE STORY 8.2: the as-of note.
    // THIRTY-FOUR SINCE STORY 8.3a: the offline write note.
    // THIRTY-FIVE SINCE STORY 9.3: the leave request form.
    // THIRTY-SIX SINCE STORY 9.4: the leave request decision screen.
    // THIRTY-SEVEN SINCE STORY 10.3: the notification settings screen.
    expect(SCREENS).toHaveLength(37);
    //
    // FORTY-NINE SINCE STORY 3.6b: `@/features/calendar/services/roster-write`.
    //
    // STILL TWENTY-FIVE AND FIFTY SINCE STORY 4.1b: `/sati` left the
    // placeholders and arrived as a built entry (net zero on both lists), and
    // `@/features/hours/services/my-hours` is a key source (one more).
    //
    // FIFTY-ONE SINCE STORY 4.2: `@/features/hours/services/organization-hours`.
    //
    // FIFTY-TWO SINCE STORY 4.3: `@/features/hours/services/hours-export`.
    //
    // FIFTY-THREE SINCE STORY 5.1c: `@/features/leave/services/leave-section`.
    //
    // STILL TWENTY-FIVE AND FIFTY-FOUR SINCE STORY 5.2c: `/godisnji` left the
    // placeholders and arrived as a built entry (net zero on both lists), and
    // `@/features/leave/services/my-leave` is a key source (one more).
    //
    // TWENTY-SIX AND FIFTY-SEVEN SINCE STORY 5.4b: one conflict's resolution
    // screen is a new `.tsx` set that renders strings (one each), and
    // `@/features/conflicts/services/resolution-screen` and
    // `@/features/conflicts/services/resolution-write` are key sources (two
    // more).
    //
    // FIFTY-EIGHT SINCE STORY 6.1a: `@/features/today/services/today`.
    //
    // FIFTY-NINE SINCE STORY 6.2: `@/features/today/services/today-duty`.
    //
    // SIXTY SINCE STORY 6.3: `@/features/today/services/admin-today`.
    //
    // SIXTY-ONE SINCE STORY 7.5: `@/utils/filter-bar`.
    //
    // SIXTY SINCE STORY 7.7: the organization prompt, which rendered its own
    // three keys, is gone; the sign-in screen renders its label now.
    //
    // SIXTY-THREE SINCE STORY 7.8: the set-password step, its rules, and the
    // credential copy's mapping.
    //
    // SIXTY-FIVE SINCE STORY 7.11: the member page header's status badge.
    //
    // SIXTY-SIX SINCE STORY 7.18: the rotation history's dialog.
    //
    // SIXTY-SEVEN SINCE STORIES 7.14 AND 7.18 TOGETHER: 7.14's
    // `@/features/hours/services/hours-explanation` and 7.18's history dialog.
    //
    // SIXTY-EIGHT SINCE STORY 7.17: the member directory.
    //
    // SIXTY-NINE SINCE THE ROUTER-GUARDS FIX: the error screen (A148).
    //
    // SEVENTY SINCE THE DEFERRED-WORK SWEEP: decision 16's team move preview.
    //
    // SEVENTY-ONE SINCE E884: the leave overview's rules, for its Stanje chip.
    //
    // SEVENTY-TWO SINCE B449: the calendar's empty-day words.
    //
    // SEVENTY-THREE SINCE THE SHEET'S COPY: the destination copy mapping.
    //
    // SEVENTY-FOUR SINCE STORY 8.1: the update notice.
    //
    // SEVENTY-FIVE SINCE STORY 8.2: the as-of note.
    //
    // SEVENTY-SIX SINCE STORY 8.3a: the offline write note.
    //
    // SEVENTY-SEVEN SINCE STORY 9.3: the leave request form.
    //
    // SEVENTY-NINE SINCE STORY 9.4: the leave request decision screen and its rules.
    // EIGHTY-TWO SINCE STORY 10.3: the notification settings screen and its
    // rules, and the organization's email-notifications switch labels.
    expect(KEY_SOURCES).toHaveLength(82);
  });

  // Vacuous-pass guard. A renamed or moved file would make each "contains no"
  // assertion hold against nothing. A FILE SET is checked file by file, so one
  // emptied file cannot hide behind the others, and its PAGE still has to
  // render something of its own.
  it.each(SCREENS)('finds $name and finds JSX in it', ({ file }) => {
    expect(source(file).length).toBeGreaterThan(200);
    expect(source(file)).toContain('return (');
    if (typeof file !== 'string') {
      for (const part of file) expect(source(part).trim(), `${part} is empty`).not.toBe('');
      expect(source(file[0] ?? ''), 'the page itself renders nothing').toContain('return (');
    }
  });

  it('sweeps every page, so a new route module cannot escape SCREENS', () => {
    // `SCREENS` is a hand list, and its own comment names the hazard: a `.tsx`
    // missing from it is swept by NOTHING. The feature folders got `readdirSync`
    // completeness checks; this is the same check for `pages/`. Every page is
    // either in a screen's file set or exempt below for a stated reason.
    const swept = new Set(
      SCREENS.flatMap(({ file }) => (typeof file === 'string' ? [file] : [...file])),
    );
    const exempt = new Set(
      PAGES_NOT_SCREENS.map((name) => join(srcRoot, 'pages', name)),
    );
    const pages = readdirSync(join(srcRoot, 'pages'))
      .filter((name) => name.endsWith('.tsx'))
      .map((name) => join(srcRoot, 'pages', name));

    expect(pages.length, 'no pages found at all').toBeGreaterThan(10);
    for (const name of PAGES_NOT_SCREENS) {
      expect(pages, `${name} is exempt but does not exist`).toContain(join(srcRoot, 'pages', name));
      expect(swept.has(join(srcRoot, 'pages', name)), `${name} is exempt and swept`).toBe(false);
    }
    for (const page of pages) {
      expect(swept.has(page) || exempt.has(page), `${page} is in no SCREENS entry and not exempt`).toBe(
        true,
      );
    }
  });

  it('sweeps every part of the member screens, so a new file cannot escape the sets', () => {
    // SOURCE STRUCTURE B1. A component, hook or helper added to the members
    // feature and named in no set would be read by no sweep in this file.
    const swept = new Set([...MEMBER_LIST, ...MEMBER_CREATE, ...MEMBER_EDIT]);
    const parts = (folder: string): string[] =>
      readdirSync(join(MEMBERS_FEATURE, folder))
        .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
        .map((name) => join(MEMBERS_FEATURE, folder, name));
    // The rule modules under `utils/` that predate B1 are key sources of
    // their own, read through `KEY_SOURCES`, and render no screen.
    // STORY 7.11: the header's facts (a key source of its own) and the page's
    // element ids, which render nothing.
    const ruleModules = new Set([RANK_KEYS, POSITION_KEYS, CREDENTIAL_COPY_KEYS, MEMBER_FACTS_KEYS, MEMBER_ELEMENT_IDS]);
    const found = [...parts('components'), ...parts('hooks'), ...parts('utils')].filter(
      (file) => !ruleModules.has(file),
    );

    expect(found.length, 'no member screen parts found at all').toBeGreaterThan(10);
    for (const file of found) expect(swept.has(file), `${file} is in no member file set`).toBe(true);
  });

  it('sweeps every part of the settings surface, so a new file cannot escape the set', () => {
    // SOURCE STRUCTURE B2, on B1's terms, and as an EQUALITY: every part the
    // set names exists, and every non-test module under the organization
    // feature's `components/`, `hooks/` and `utils/` is either in the set or
    // exempt for a stated reason (`settings-screen.fixture.ts`).
    const exempt = new Set(
      SETTINGS_SCREEN_EXEMPT.map((entry) => join(ORGANIZATION_FEATURE, entry.file)),
    );
    const found = ['components', 'hooks', 'utils'].flatMap((folder) =>
      readdirSync(join(ORGANIZATION_FEATURE, folder))
        .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
        .map((name) => join(ORGANIZATION_FEATURE, folder, name)),
    );

    for (const file of exempt) expect(found, `${file} is exempt and does not exist`).toContain(file);
    for (const entry of SETTINGS_SCREEN_EXEMPT) expect(entry.why.length).toBeGreaterThan(20);
    for (const file of SETTINGS) {
      expect(existsSync(file), `${file} is in the set and does not exist`).toBe(true);
    }
    expect(
      found.filter((file) => !exempt.has(file)).sort(),
      'the settings file set and the feature folders disagree',
    ).toEqual(SETTINGS.filter((file) => file !== SETTINGS_PAGE).sort());
  });

  it('sweeps every part of the calendar screen, so a new file cannot escape the set', () => {
    // SOURCE STRUCTURE B3, on B2's terms: an EQUALITY between the set and
    // EVERY non-test module anywhere under the calendar feature — its root,
    // `services/`, and `components/`, `hooks/` and `utils/` at any depth — less
    // the modules exempt for a stated reason (`calendar-screen.fixture.ts`).
    // Read recursively, so a nested file cannot escape the set either.
    const exempt = new Set(CALENDAR_SCREEN_EXEMPT.map((entry) => join(CALENDAR_FEATURE, entry.file)));
    const found = readdirSync(CALENDAR_FEATURE, { recursive: true, encoding: 'utf8' })
      .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
      .map((name) => join(CALENDAR_FEATURE, name));

    expect(found, 'the walk reaches the feature root').toContain(join(CALENDAR_FEATURE, 'calendar-screen.fixture.ts'));
    expect(found, 'the walk reaches services/').toContain(CALENDAR_SNAPSHOT_KEYS);
    for (const file of exempt) expect(found, `${file} is exempt and does not exist`).toContain(file);
    for (const entry of CALENDAR_SCREEN_EXEMPT) expect(entry.why.length).toBeGreaterThan(20);
    for (const file of KALENDAR) {
      expect(existsSync(file), `${file} is in the set and does not exist`).toBe(true);
      // NON-VACUITY PER FILE, with a floor rather than "not empty": a part
      // gutted to its imports would otherwise pass every sweep over the set.
      expect(source(file).trim().length, `${file} is all but empty`).toBeGreaterThan(150);
    }
    expect(KALENDAR[0], 'the page is read first').toBe(KALENDAR_PAGE);
    // STORY 4.1b: the month navigation is shared with *Sati*, so it lives
    // outside the feature (`@/components/month-nav`) and is in the set still.
    expect(KALENDAR, 'the shared month navigation left the set').toContain(SHARED_MONTH_NAV);
    // STORY 7.5: so is the filter bar, shared from `@/components/filter-bar`.
    expect(KALENDAR, 'the shared filter bar left the set').toContain(SHARED_FILTER_BAR);
    expect(
      found.filter((file) => !exempt.has(file)).sort(),
      'the calendar file set and the feature folders disagree',
    ).toEqual(
      KALENDAR.filter((file) => file !== KALENDAR_PAGE && file !== SHARED_MONTH_NAV && file !== SHARED_FILTER_BAR).sort(),
    );
  });

  it('sweeps every part of the Sati screen, so a new file cannot escape the set', () => {
    // STORY 4.1b, on the calendar's terms: an EQUALITY between the set and
    // every non-test module under the hours feature, less the exempt ones.
    const exempt = new Set(HOURS_SCREEN_EXEMPT.map((entry) => join(HOURS_FEATURE, entry.file)));
    const found = readdirSync(HOURS_FEATURE, { recursive: true, encoding: 'utf8' })
      .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
      .map((name) => join(HOURS_FEATURE, name));

    expect(found, 'the walk reaches services/').toContain(HOURS_KEYS);
    for (const file of exempt) expect(found, `${file} is exempt and does not exist`).toContain(file);
    for (const entry of HOURS_SCREEN_EXEMPT) expect(entry.why.length).toBeGreaterThan(20);
    for (const file of SATI) {
      expect(existsSync(file), `${file} is in the set and does not exist`).toBe(true);
      expect(source(file).trim().length, `${file} is all but empty`).toBeGreaterThan(150);
    }
    expect(SATI[0], 'the page is read first').toBe(SATI_PAGE);
    expect(SATI, 'the shared month navigation left the set').toContain(SHARED_MONTH_NAV);
    expect(SATI, 'the shared filter bar left the set').toContain(SHARED_FILTER_BAR);
    // STORY 7.6: so is the phone's sort control, shared with Ljudi.
    expect(SATI, 'the shared sort control left the set').toContain(SHARED_SORT_CONTROL);
    expect(
      found.filter((file) => !exempt.has(file)).sort(),
      'the Sati file set and the feature folders disagree',
    ).toEqual(
      // Every shared part — the month toolbar, the filter bar, the sort
      // control, the sortable heading and its glyphs — lives outside the feature.
      SATI.filter((file) => file !== SATI_PAGE && file.startsWith(HOURS_FEATURE)).sort(),
    );
  });

  it('draws every empty mark on Sati as one EmptyMark: the glyph hidden, a word spoken (C587)', () => {
    const marks = join(srcRoot, ...HOURS_SCREEN_PARTS.marks);
    const emptyMark = source(join(srcRoot, 'components', 'ui', 'empty-mark.tsx'));

    // One design: the `—` hidden from readers, the word hidden from the eye.
    expect(emptyMark).toMatch(/<span aria-hidden>\{glyph\}<\/span>/);
    expect(emptyMark).toMatch(/<span className="sr-only">\{word\}<\/span>/);
    // The leave's mark and the team's, each with its own spoken word.
    expect(source(marks).match(/<EmptyMark glyph=\{[^}]+\} word=\{t\('[^']+'\)\} \/>/g)).toHaveLength(2);
    // And nowhere else on the screen is either drawn as a bare glyph.
    for (const file of SATI.filter((one) => one !== marks)) {
      expect(source(file), `${file} draws the no-team mark bare`).not.toContain("t('sati.organization.noTeam')");
      expect(source(file), `${file} draws the leave without its mark`).not.toMatch(/\bleaveShownOf\(/);
    }
  });

  it('draws the month as one toolbar, shared by Kalendar and Sati (story 7.4)', () => {
    const nav = source(SHARED_MONTH_NAV);
    const keys = source(MONTH_KEYS);

    // `Ovaj mjesec` is never a disabled button on the current month: it is a
    // label there, and a button only off it.
    expect(nav, 'Ovaj mjesec is disabled on the current month again').not.toMatch(/disabled=\{month\.isCurrent\}/);
    expect(nav).toMatch(/\{month\.isCurrent \? null : \(\s*<Button/);
    // One group named "Mjesec", and the month is a button that opens a dialog.
    expect(nav).toMatch(/role="group"\s+aria-label=\{t\('kalendar\.month'\)\}/);
    expect(ariaHaspopupValues(nav)).toEqual(['dialog']);
    expect(nav).toMatch(/ref=\{trigger\}[\s\S]{0,240}?aria-haspopup="dialog"\s+aria-expanded=\{open\}/);
    expect(nav).toMatch(/<Popover\s+id=\{pickerId\}[^>]*aria-label=\{t\('kalendar\.monthPicker'\)\}/);
    // While open, the trigger names the picker it opened: the Popover, or below
    // 640 px the bottom sheet (deferred-work E792).
    expect(nav).toMatch(/aria-controls=\{open \? \(isPhone \? sheetId : pickerId\) : undefined\}/);
    expect(nav).toMatch(/<SheetDialog id=\{sheetId\}[^>]*open=\{open && isPhone\}/);
    // The picker belongs to the month it was opened on.
    expect(nav).toMatch(/const open = shownMonth !== null && openOn === shownMonth;/);
    // PgUp and PgDn on the group, by the pure rule, never page-wide.
    expect(nav).toMatch(/onKeyDown=\{stepOnKey\}/);
    expect(nav).toMatch(/monthStepOfKey\(event\.key, event\)[\s\S]{0,80}?event\.preventDefault\(\)/);
    expect(keys).toContain("key === 'PageUp'");
    expect(keys).toContain("key === 'PageDown'");
    expect(nav, 'a page-wide key listener arrived').not.toContain('addEventListener');
    // The heading stays for focus and names, visually hidden.
    expect(nav).toMatch(/<h2 id=\{headingId\} tabIndex=\{-1\} className="sr-only">/);
    // The popover renders no heading, or `monthHeading()` with no name would match it.
    expect(occurrences(nav, '<h2'), 'a second heading arrived in the month toolbar').toBe(1);
    // While no month is shown, the placeholder bar stands in for the toolbar.
    expect(nav).toMatch(/if \(month === null\) \{\s*return <div className="[^"]*animate-pulse[^"]*" \/>;/);
  });

  it('filters Kalendar and Sati through one chip bar, never a Select (story 7.5)', () => {
    const bar = source(SHARED_FILTER_BAR);

    // No `<Select` in either filter: both draw the one shared bar.
    for (const file of [SHARED_FILTER_BAR, CALENDAR_FILTERS, HOURS_FILTERS]) {
      expect(source(file), `${file} draws a Select`).not.toMatch(/<Select\b|<select\b/);
    }
    expect(source(CALENDAR_FILTERS)).toMatch(/<FilterBar\b/);
    expect(source(HOURS_FILTERS)).toMatch(/<FilterBar\b/);
    // A ✕ is named by an expression — the filter and its value — never a literal.
    expect(bar).toMatch(/removeLabel=\{t\(filterRemoveMessageKey\(chip\), \{ value: chip\.value \}\)\}/);
    expect(bar).toMatch(/aria-label=\{removeLabel\}/);
    // STORY 7.13: *Ljudi* draws the same chips through the option-chip bar.
    expect(source(MEMBER_LIST)).toMatch(/<OptionFilterBar\b/);
    expect(source(MEMBER_LIST), 'the member list draws a Select again').not.toMatch(/<Select\b|<select\b/);
    // A chip says it opens a dialog, and while open names the picker it opened.
    // On a phone it opens the sheet, and says so: expanded and controlling it.
    expect(bar).toMatch(
      /aria-haspopup="dialog"\s+aria-expanded=\{expanded\}\s+aria-controls=\{open \? pickerId : \(controls \?\? undefined\)\}/,
    );
    expect(bar).toMatch(/expanded=\{isPhone \? sheetOpen : open === chip\.key\}/);
    // The breakpoint is the shared one, read through ONE store, never a feature's.
    expect(bar).toMatch(/from '@\/hooks\/viewport'/);
    expect(bar, 'the bar reaches into a feature for the breakpoint').not.toMatch(/from '@\/features\//);
    // Focus waits for the change to render, never a frame poll.
    expect(bar, 'focus is polled again').not.toContain('requestAnimationFrame');
    // The summary is a status line, not a banner, and the sheet the native Dialog.
    expect(bar).toMatch(/<p role="status"/);
    expect(bar).toMatch(/<Dialog\b/);
    expect(bar).toMatch(/useCloseWhenWide\(sheetOpen, closeSheet\)/);
    // Sati's old `?tim=` is redirected to `?smjena=`, replacing the entry.
    expect(source(SATI_PAGE)).toMatch(/beforeLoad:[\s\S]{0,200}?legacyHoursSearchOf\(/);
    expect(source(SATI_PAGE)).toMatch(/throw redirect\(\{ to: '\/sati', search: legacy, replace: true \}\)/);
  });

  it('sweeps every part of the Godišnji screen, so a new file cannot escape the set', () => {
    // STORY 5.2c, on *Sati*'s terms: an EQUALITY between the set and every
    // non-test module under the leave feature, less the exempt ones — the
    // admin card's parts among them, which the member edit set sweeps.
    const exempt = new Set(LEAVE_SCREEN_EXEMPT.map((entry) => join(LEAVE_FEATURE, entry.file)));
    const found = readdirSync(LEAVE_FEATURE, { recursive: true, encoding: 'utf8' })
      .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
      .map((name) => join(LEAVE_FEATURE, name));

    expect(found, 'the walk reaches services/').toContain(MY_LEAVE_KEYS);
    for (const file of exempt) expect(found, `${file} is exempt and does not exist`).toContain(file);
    for (const entry of LEAVE_SCREEN_EXEMPT) expect(entry.why.length).toBeGreaterThan(20);
    for (const file of MEMBER_EDIT.filter((part) => part.startsWith(LEAVE_FEATURE))) {
      expect(exempt.has(file), `${file} is a member edit part and not exempt here`).toBe(true);
    }
    for (const file of GODISNJI) {
      expect(existsSync(file), `${file} is in the set and does not exist`).toBe(true);
      expect(source(file).trim().length, `${file} is all but empty`).toBeGreaterThan(150);
    }
    expect(GODISNJI[0], 'the page is read first').toBe(GODISNJI_PAGE);
    expect(
      found.filter((file) => !exempt.has(file)).sort(),
      'the Godišnji file set and the feature folders disagree',
      // The shared sortable heading and its glyphs live in `components/` (Epic 4 retro D2).
    ).toEqual(GODISNJI.filter((file) => file !== GODISNJI_PAGE && file.startsWith(LEAVE_FEATURE)).sort());
  });

  it('sweeps every part of the notification settings screen, so a new file cannot escape the set', () => {
    // STORY 10.3, on *Godišnji*'s terms: an EQUALITY between the set and every
    // non-test module under the notifications feature, less the exempt ones.
    const exempt = new Set(NOTIFICATIONS_SCREEN_EXEMPT.map((entry) => join(NOTIFICATIONS_FEATURE, entry.file)));
    const found = readdirSync(NOTIFICATIONS_FEATURE, { recursive: true, encoding: 'utf8' })
      .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
      .map((name) => join(NOTIFICATIONS_FEATURE, name));

    expect(found, 'the walk reaches services/').toContain(NOTIFICATIONS_KEYS);
    for (const file of exempt) expect(found, `${file} is exempt and does not exist`).toContain(file);
    for (const entry of NOTIFICATIONS_SCREEN_EXEMPT) expect(entry.why.length).toBeGreaterThan(20);
    for (const file of NOTIFICATIONS) {
      expect(existsSync(file), `${file} is in the set and does not exist`).toBe(true);
      expect(source(file).trim().length, `${file} is all but empty`).toBeGreaterThan(150);
    }
    expect(NOTIFICATIONS[0], 'the page is read first').toBe(NOTIFICATIONS_PAGE);
    expect(
      found.filter((file) => !exempt.has(file)).sort(),
      'the notification settings file set and the feature folder disagree',
    ).toEqual(NOTIFICATIONS.filter((file) => file !== NOTIFICATIONS_PAGE).sort());
  });

  it('sweeps every part of the Danas screen, so a new file cannot escape the set', () => {
    // STORY 6.1a, on *Godišnji*'s terms: an EQUALITY between the set and
    // every non-test module under the today feature, less the exempt ones.
    const exempt = new Set(TODAY_SCREEN_EXEMPT.map((entry) => join(TODAY_FEATURE, entry.file)));
    const found = readdirSync(TODAY_FEATURE, { recursive: true, encoding: 'utf8' })
      .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
      .map((name) => join(TODAY_FEATURE, name));

    expect(found, 'the walk reaches services/').toContain(TODAY_KEYS);
    for (const file of exempt) expect(found, `${file} is exempt and does not exist`).toContain(file);
    for (const entry of TODAY_SCREEN_EXEMPT) expect(entry.why.length).toBeGreaterThan(20);
    for (const file of DANAS) {
      expect(existsSync(file), `${file} is in the set and does not exist`).toBe(true);
      expect(source(file).trim().length, `${file} is all but empty`).toBeGreaterThan(150);
    }
    expect(DANAS[0], 'the page is read first').toBe(DANAS_PAGE);
    expect(
      found.filter((file) => !exempt.has(file)).sort(),
      'the Danas file set and the feature folders disagree',
    ).toEqual(DANAS.filter((file) => file !== DANAS_PAGE).sort());
  });

  it('sweeps every part of the Za odluku screens, so a new file cannot escape the sets', () => {
    // STORY 5.3b, on *Sati*'s terms: an EQUALITY between the sets and every
    // non-test module under the conflicts feature, less the exempt ones.
    // TWO DISJOINT SETS SINCE STORY 5.4b: the queue, and one conflict's
    // resolution screen.
    const exempt = new Set(CONFLICTS_SCREEN_EXEMPT.map((entry) => join(CONFLICTS_FEATURE, entry.file)));
    const found = readdirSync(CONFLICTS_FEATURE, { recursive: true, encoding: 'utf8' })
      .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
      .map((name) => join(CONFLICTS_FEATURE, name));

    expect(found, 'the walk reaches services/').toContain(CONFLICTS_QUEUE_RULES);
    for (const file of exempt) expect(found, `${file} is exempt and does not exist`).toContain(file);
    for (const entry of CONFLICTS_SCREEN_EXEMPT) expect(entry.why.length).toBeGreaterThan(20);
    for (const file of [...ZA_ODLUKU, ...RESOLUTION]) {
      expect(existsSync(file), `${file} is in a set and does not exist`).toBe(true);
      expect(source(file).trim().length, `${file} is all but empty`).toBeGreaterThan(150);
    }
    expect(ZA_ODLUKU.filter((file) => RESOLUTION.includes(file)), 'the two sets share a part').toEqual([]);
    expect(ZA_ODLUKU[0], 'the page is read first').toBe(ZA_ODLUKU_PAGE);
    expect(RESOLUTION[0], 'the page is read first').toBe(RESOLUTION_PAGE);
    expect(
      found.filter((file) => !exempt.has(file)).sort(),
      'the Za odluku file sets and the feature folders disagree',
    ).toEqual([...ZA_ODLUKU, ...RESOLUTION].filter((file) => file !== ZA_ODLUKU_PAGE && file !== RESOLUTION_PAGE).sort());
  });

  it('sweeps every part of the shift type screens, so a new file cannot escape the sets', () => {
    // SOURCE STRUCTURE B4, on B3's terms: an EQUALITY between the two sets and
    // EVERY non-test module anywhere under the shift types feature — its root,
    // `services/`, and `components/`, `hooks/` and `utils/` at any depth — less
    // the modules exempt for a stated reason (`shift-type-screens.fixture.ts`).
    // Read recursively, so a nested file cannot escape the sets either.
    const exempt = new Set(SHIFT_TYPE_SCREENS_EXEMPT.map((entry) => join(SHIFT_TYPE_FEATURE, entry.file)));
    const found = readdirSync(SHIFT_TYPE_FEATURE, { recursive: true, encoding: 'utf8' })
      .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
      .map((name) => join(SHIFT_TYPE_FEATURE, name));
    const pages = new Set([SHIFT_TYPE_LIST_PAGE, SHIFT_TYPE_EDIT_PAGE]);

    expect(found, 'the walk reaches the feature root').toContain(
      join(SHIFT_TYPE_FEATURE, 'shift-type-screens.fixture.ts'),
    );
    expect(found, 'the walk reaches services/').toContain(SHIFT_TYPE_LIST_KEYS);
    for (const file of exempt) expect(found, `${file} is exempt and does not exist`).toContain(file);
    // THE EXACT EXEMPTIONS, so a new one is a reviewed change to this test.
    expect([...exempt].sort(), 'the shift type exemptions changed').toEqual(
      ['shift-type-screens.fixture.ts', 'services/list.ts', 'services/write.ts', 'utils/ramp.ts']
        .map((file) => join(SHIFT_TYPE_FEATURE, ...file.split('/')))
        .sort(),
    );
    for (const entry of SHIFT_TYPE_SCREENS_EXEMPT) {
      expect(entry.why.length, `${entry.file} is exempt without a stated reason`).toBeGreaterThan(20);
    }
    // DISJOINT: a part in both sets would have its strings, controls and
    // handlers counted twice.
    for (const file of SHIFT_TYPE_LIST) {
      expect(SHIFT_TYPE_EDIT, `${file} is in both shift type sets`).not.toContain(file);
    }
    for (const file of [...SHIFT_TYPE_LIST, ...SHIFT_TYPE_EDIT]) {
      expect(existsSync(file), `${file} is in a set and does not exist`).toBe(true);
      // NON-VACUITY PER FILE, with a floor rather than "not empty": a part
      // gutted to its imports would otherwise pass every sweep over the set.
      expect(source(file).trim().length, `${file} is all but empty`).toBeGreaterThan(150);
    }
    expect(SHIFT_TYPE_LIST[0], 'the list page is read first').toBe(SHIFT_TYPE_LIST_PAGE);
    expect(SHIFT_TYPE_EDIT[0], 'the edit page is read first').toBe(SHIFT_TYPE_EDIT_PAGE);
    // ONE DECLARATION PER HANDLER PER SET, because the extractors take the
    // first match in a joined set.
    for (const [set, hookFile, names] of [
      [SHIFT_TYPE_LIST, SHIFT_TYPE_LIST_HOOK, ['submit', 'openAdding', 'closeAdding', 'chooseKind']],
      [
        SHIFT_TYPE_EDIT,
        SHIFT_TYPE_EDIT_HOOK,
        ['submit', 'saveTimes', 'cancelTimes', 'archive', 'refresh', 'close', 'clearOutcomes'],
      ],
    ] as const) {
      for (const name of names) {
        expect(
          source(set).match(new RegExp(`function ${name}\\(`, 'g'))?.length,
          `${name} is not declared exactly once in its set`,
        ).toBe(1);
        expect(source(hookFile), `${name} is not in its hook`).toMatch(
          new RegExp(`\\n {2}(?:async )?function ${name}\\(`),
        );
      }
    }
    expect(
      found.filter((file) => !exempt.has(file)).sort(),
      'the shift type file sets and the feature folders disagree',
    ).toEqual([...SHIFT_TYPE_LIST, ...SHIFT_TYPE_EDIT].filter((file) => !pages.has(file)).sort());
  });

  /**
   * The shift type sets' wiring, read PER FILE (source structure B4): the
   * set-wide sweeps below take the first match in a joined set, so a part
   * could shadow the hook's ref, handler or write and still read as wired.
   */
  const SHIFT_TYPE_SETS = [
    {
      name: 'the shift type list',
      set: SHIFT_TYPE_LIST,
      hookFile: SHIFT_TYPE_LIST_HOOK,
      submits: ['submit'],
    },
    {
      name: 'the shift type edit form',
      set: SHIFT_TYPE_EDIT,
      hookFile: SHIFT_TYPE_EDIT_HOOK,
      submits: ['submit', 'saveTimes'],
    },
  ];
  const SHIFT_TYPE_HANDLERS =
    'submit|saveTimes|cancelTimes|archive|chooseKind|openAdding|closeAdding|refresh|close|clearOutcomes';
  const SHIFT_TYPE_WRITES = [
    'supabaseClient(',
    'createShiftType(',
    'renameShiftType(',
    'correctShiftTypeTimes(',
    'cancelScheduledTimes(',
    'archiveShiftType(',
  ];

  it('remounts the edit screen per type, keyed by the route id', () => {
    expect(source(SHIFT_TYPE_EDIT_PAGE), 'the edit screen is not keyed by the route id').toMatch(
      /return <ShiftTypeScreen key=\{id\} id=\{id\} \/>;/,
    );
  });

  it.each(SHIFT_TYPE_SETS)('creates every attached ref once, in the hook, on $name', ({ set, hookFile }) => {
    const attached = [...source(set).matchAll(/\bref=\{(\w+)\}/g)].map((found) => found[1] ?? '')
      .filter((name) => !MODULE_REF_CALLBACKS.has(name));

    expect(attached.length, 'no ref is attached at all').toBeGreaterThan(3);
    for (const name of new Set(attached)) {
      expect(occurrences(source(set), `const ${name} = useRef`), `${name} is not created exactly once`).toBe(1);
      expect(source(hookFile), `${name} is not created in the hook`).toContain(`const ${name} = useRef`);
    }
  });

  it.each(SHIFT_TYPE_SETS)('declares no handler outside the hook on $name', ({ set, hookFile }) => {
    const shadow = new RegExp(`\\b(?:(?:const|let)\\s+(?:${SHIFT_TYPE_HANDLERS})\\s*=|function\\s+(?:${SHIFT_TYPE_HANDLERS})\\s*\\()`);

    for (const part of set.filter((file) => file !== hookFile)) {
      expect(source(part), `${part} declares a handler of its own`).not.toMatch(shadow);
    }
  });

  it.each(SHIFT_TYPE_SETS)('binds every form to a named submit handler on $name', ({ set, submits }) => {
    const forms = set.flatMap((part) => [...source(part).matchAll(/<form\b(?:=>|[^>])*>/g)].map((found) => found[0]));
    const bound = new RegExp(`onSubmit=\\{[\\s\\S]{0,160}?\\b(?:${submits.join('|')})\\b`);

    expect(forms.length, 'no form found').toBe(submits.length);
    for (const form of forms) expect(form, 'a form is bound to no named submit handler').toMatch(bound);
  });

  it('binds the times form to saveTimes', () => {
    const times = /<form\b(?:=>|[^>])*>/.exec(source(join(srcRoot, ...SHIFT_TYPE_EDIT_PARTS.times)))?.[0] ?? '';

    expect(times, 'the times form is gone').not.toBe('');
    expect(times, 'the times form does not submit through saveTimes').toMatch(
      /onSubmit=\{[\s\S]{0,160}?\bsaveTimes\(/,
    );
  });

  it.each(SHIFT_TYPE_SETS)('writes only from the hook on $name', ({ set, hookFile }) => {
    for (const part of set.filter((file) => file !== hookFile)) {
      for (const write of SHIFT_TYPE_WRITES) {
        expect(source(part), `${part} calls ${write}`).not.toContain(write);
      }
    }
  });

  it('sweeps every part of the hour band screens, so a new file cannot escape the sets', () => {
    // SOURCE STRUCTURE B5, on B4's terms: an EQUALITY between the two sets and
    // EVERY non-test module anywhere under the hour bands feature — its root,
    // `services/`, and `components/`, `hooks/` and `utils/` at any depth — less
    // the modules exempt for a stated reason (`hour-band-screens.fixture.ts`).
    // Read recursively, so a nested file cannot escape the sets either.
    // ANY SCRIPT MODULE (`.[cm]?[jt]sx?`), less tests and declaration files,
    // so a part cannot escape by its extension; and ANY `*.fixture.*`, which
    // renders nothing, is left out of the comparison by its shape.
    const exempt = new Set(HOUR_BAND_SCREENS_EXEMPT.map((entry) => join(HOUR_BAND_FEATURE, entry.file)));
    const walked = readdirSync(HOUR_BAND_FEATURE, { recursive: true, encoding: 'utf8' })
      .filter(
        (name) =>
          /\.[cm]?[jt]sx?$/.test(name) && !/\.test\.[cm]?[jt]sx?$/.test(name) && !/\.d\.[cm]?ts$/.test(name),
      )
      .map((name) => join(HOUR_BAND_FEATURE, name));
    const found = walked.filter((file) => !/\.fixture\.[cm]?[jt]sx?$/.test(file));
    const pages = new Set([HOUR_BAND_LIST_PAGE, HOUR_BAND_EDIT_PAGE]);

    expect(walked, 'the walk reaches the feature root').toContain(
      join(HOUR_BAND_FEATURE, 'hour-band-screens.fixture.ts'),
    );
    expect(found, 'the walk reaches services/').toContain(HOUR_BAND_LIST_KEYS);
    for (const file of exempt) expect(walked, `${file} is exempt and does not exist`).toContain(file);
    // THE EXACT EXEMPTIONS, so a new one is a reviewed change to this test.
    expect([...exempt].sort(), 'the hour band exemptions changed').toEqual(
      ['hour-band-screens.fixture.ts', 'services/list.ts', 'services/surface-keys.ts', 'services/write.ts']
        .map((file) => join(HOUR_BAND_FEATURE, ...file.split('/')))
        .sort(),
    );
    for (const entry of HOUR_BAND_SCREENS_EXEMPT) {
      expect(entry.why.length, `${entry.file} is exempt without a stated reason`).toBeGreaterThan(20);
    }
    // DISJOINT: a part in both sets would have its strings, controls and
    // handlers counted twice.
    for (const file of HOUR_BAND_LIST) {
      expect(HOUR_BAND_EDIT, `${file} is in both hour band sets`).not.toContain(file);
    }
    for (const file of [...HOUR_BAND_LIST, ...HOUR_BAND_EDIT]) {
      expect(existsSync(file), `${file} is in a set and does not exist`).toBe(true);
      // NON-VACUITY PER FILE, with a floor rather than "not empty": a part
      // gutted to its imports would otherwise pass every sweep over the set.
      expect(source(file).trim().length, `${file} is all but empty`).toBeGreaterThan(150);
    }
    expect(HOUR_BAND_LIST[0], 'the list page is read first').toBe(HOUR_BAND_LIST_PAGE);
    expect(HOUR_BAND_EDIT[0], 'the edit page is read first').toBe(HOUR_BAND_EDIT_PAGE);
    // ONE DECLARATION PER HANDLER PER SET, because the extractors take the
    // first match in a joined set.
    for (const [set, hookFile, names] of [
      [HOUR_BAND_LIST, HOUR_BAND_LIST_HOOK, ['submit', 'openAdding']],
      [HOUR_BAND_EDIT, HOUR_BAND_EDIT_HOOK, ['submit', 'remove', 'refresh', 'close']],
    ] as const) {
      for (const name of names) {
        expect(
          source(set).match(new RegExp(`function ${name}\\(`, 'g'))?.length,
          `${name} is not declared exactly once in its set`,
        ).toBe(1);
        expect(source(hookFile), `${name} is not in its hook`).toMatch(
          new RegExp(`\\n {2}(?:async )?function ${name}\\(`),
        );
      }
    }
    expect(
      found.filter((file) => !exempt.has(file)).sort(),
      'the hour band file sets and the feature folders disagree',
    ).toEqual([...HOUR_BAND_LIST, ...HOUR_BAND_EDIT].filter((file) => !pages.has(file)).sort());
  });

  /**
   * The hour band sets' wiring, read PER FILE (source structure B5, on B4's
   * terms): the set-wide sweeps below take the first match in a joined set, so
   * a part could shadow the hook's ref, handler or write and still read as
   * wired.
   */
  const HOUR_BAND_SETS = [
    {
      name: 'the hour band list',
      set: HOUR_BAND_LIST,
      hookFile: HOUR_BAND_LIST_HOOK,
      submits: ['submit'],
    },
    {
      name: 'the hour band edit form',
      set: HOUR_BAND_EDIT,
      hookFile: HOUR_BAND_EDIT_HOOK,
      submits: ['submit'],
    },
  ];
  const HOUR_BAND_HANDLERS = 'submit|openAdding|remove|refresh|close';
  const HOUR_BAND_WRITES = [
    'supabaseClient',
    'HOUR_BANDS_TABLE',
    '.from(',
    'createHourBand(',
    'updateHourBand(',
    'removeHourBand(',
  ];

  it('remounts the band edit screen per band, keyed by the route id', () => {
    expect(source(HOUR_BAND_EDIT_PAGE), 'the band edit screen is not keyed by the route id').toMatch(
      /return <HourBandScreen key=\{id\} id=\{id\} \/>;/,
    );
    // BELOW THE KEY: the hook is called in the keyed screen, so a new id
    // remounts its state, and never in the wrapper that reads the id.
    const page = source(HOUR_BAND_EDIT_PAGE);
    const wrapper = /export function OrganizacijaSatniPojasScreen\([\s\S]*?\n\}/.exec(page)?.[0] ?? '';
    const keyed = /\nfunction HourBandScreen\([\s\S]*?\n\}/.exec(page)?.[0] ?? '';

    expect(wrapper, 'the wrapper could not be extracted').toContain('useParams()');
    expect(keyed, 'the keyed screen could not be extracted').not.toBe('');
    expect(keyed, 'the edit hook is not called below the key').toContain('useHourBandEdit(id)');
    expect(wrapper, 'the edit hook is called above the key').not.toContain('useHourBandEdit(');
    expect(occurrences(page, 'useHourBandEdit('), 'the edit hook is called more than once').toBe(1);
  });

  it.each(HOUR_BAND_SETS)('creates every attached ref once, in the hook, on $name', ({ set, hookFile }) => {
    // `closeRef` as well as `ref`: the edit dialog's close takes the focus a
    // landed removal leaves behind through `DialogHeader`'s `closeRef`.
    const attached = [...source(set).matchAll(/\b(?:ref|closeRef)=\{([^}]*)\}/g)].map((found) => found[1] ?? '')
      .filter((name) => !MODULE_REF_CALLBACKS.has(name));

    expect(attached.length, 'no ref is attached at all').toBeGreaterThan(1);
    // A BARE NAME, so it resolves to a hook-created `const`; `screen.x` would not.
    for (const name of attached) expect(name, `an attached ref is not a bare name: ${name}`).toMatch(/^\w+$/);
    for (const name of new Set(attached)) {
      expect(occurrences(source(set), `const ${name} = useRef`), `${name} is not created exactly once`).toBe(1);
      expect(source(hookFile), `${name} is not created in the hook`).toContain(`const ${name} = useRef`);
    }
  });

  it('attaches the dialog close the removal focuses, on the band edit form', () => {
    expect(source(HOUR_BAND_EDIT_PAGE), 'the dialog close is not attached to the hook ref').toContain(
      'closeRef={closeButton}',
    );
    const remove = namedHandler(source(HOUR_BAND_EDIT_HOOK), 'remove');

    expect(remove.length, 'remove could not be extracted').toBeGreaterThan(80);
    // ONLY ON A LANDED REMOVAL: a refused one keeps the band, and its block.
    expect(remove, 'the removal does not focus the dialog close on success only').toMatch(
      /\n {6}if \(outcome\.ok\) closeButton\.current\?\.focus\(\);/,
    );
    expect(occurrences(source(HOUR_BAND_EDIT_HOOK), 'closeButton.current'), 'the close is focused elsewhere').toBe(1);
    expect(finallyBlock(remove), 'the removal is not disarmed in its finally').toContain('setArmed(false)');
  });

  it('keys the band form by landed saves, on the band edit form', () => {
    const form = /<form\b(?:=>|[^>])*>/.exec(source(join(srcRoot, ...HOUR_BAND_EDIT_PARTS.body)))?.[0] ?? '';

    expect(form, 'the band form is gone').not.toBe('');
    expect(form, 'the band form is not keyed by landed saves').toContain('key={hourBandFormKey(band, saves)}');
  });

  it('focuses the name field once the add dialog opens, from the list hook only', () => {
    expect(occurrences(source(HOUR_BAND_LIST), 'useEffect('), 'an effect besides the one focus effect').toBe(1);
    expect(source(HOUR_BAND_LIST_HOOK), 'the focus effect changed').toMatch(
      /useEffect\(\s*\(\)\s*=>\s*\{\s*if\s*\(adding\)\s*nameField\.current\?\.focus\(\);?\s*\},\s*\[adding\],?\s*\);/,
    );
  });

  it.each(HOUR_BAND_SETS)('declares no handler outside the hook on $name', ({ set, hookFile }) => {
    const shadow = new RegExp(`\\b(?:(?:const|let)\\s+(?:${HOUR_BAND_HANDLERS})\\s*=|function\\s+(?:${HOUR_BAND_HANDLERS})\\s*\\()`);
    // Nor the hooks a handler is built from, nor a handler handed on as an
    // object key of a part's own.
    const wiring = /\buseNavigate\(|\buseQueryClient\(|[{,]\s*(?:submit|remove|close)\s*:/;

    for (const part of set.filter((file) => file !== hookFile)) {
      expect(source(part), `${part} declares a handler of its own`).not.toMatch(shadow);
      expect(source(part), `${part} builds or hands on a handler of its own`).not.toMatch(wiring);
    }
  });

  it.each(HOUR_BAND_SETS)('binds every form to a named submit handler on $name', ({ set, submits }) => {
    const forms = set.flatMap((part) => [...source(part).matchAll(/<form\b(?:=>|[^>])*>/g)].map((found) => found[0]));
    const bound = new RegExp(`onSubmit=\\{[\\s\\S]{0,160}?\\b(?:${submits.join('|')})\\b`);

    expect(forms.length, 'no form found').toBe(submits.length);
    for (const form of forms) expect(form, 'a form is bound to no named submit handler').toMatch(bound);
  });

  it.each(HOUR_BAND_SETS)('writes only from the hook on $name', ({ set, hookFile }) => {
    for (const part of set.filter((file) => file !== hookFile)) {
      for (const write of HOUR_BAND_WRITES) {
        expect(source(part), `${part} calls ${write}`).not.toContain(write);
      }
    }
    expect(source(hookFile), 'the hook reaches no client').toContain('supabaseClient(');
  });

  it('sweeps every part of the team screens, so a new file cannot escape the sets', () => {
    // SOURCE STRUCTURE B6, on B4's and B5's terms: an EQUALITY between the two
    // sets and EVERY non-test module anywhere under the teams feature — its
    // root, `services/`, and `components/`, `hooks/` and `utils/` at any depth —
    // less the modules exempt for a stated reason (`team-screens.fixture.ts`).
    // Read recursively, so a nested file cannot escape the sets either.
    // ANY SCRIPT MODULE (`.[cm]?[jt]sx?`), less tests and declaration files,
    // so a part cannot escape by its extension; and ANY `*.fixture.*`, which
    // renders nothing, is left out of the comparison by its shape.
    const exempt = new Set(TEAM_SCREENS_EXEMPT.map((entry) => join(TEAM_FEATURE, entry.file)));
    const walked = readdirSync(TEAM_FEATURE, { recursive: true, encoding: 'utf8' })
      .filter(
        (name) =>
          /\.[cm]?[jt]sx?$/.test(name) && !/\.test\.[cm]?[jt]sx?$/.test(name) && !/\.d\.[cm]?ts$/.test(name),
      )
      .map((name) => join(TEAM_FEATURE, name));
    const found = walked.filter((file) => !/\.fixture\.[cm]?[jt]sx?$/.test(file));
    // THREE SETS SINCE SOURCE STRUCTURE B7: the roster is the third.
    const pages = new Set([TEAM_LIST_PAGE, TEAM_EDIT_PAGE, TEAM_ROSTER_PAGE]);

    expect(walked, 'the walk reaches the feature root').toContain(join(TEAM_FEATURE, 'team-screens.fixture.ts'));
    expect(found, 'the walk reaches services/').toContain(TEAM_LIST_KEYS);
    for (const file of exempt) expect(walked, `${file} is exempt and does not exist`).toContain(file);
    // THE EXACT EXEMPTIONS, so a new one is a reviewed change to this test.
    expect([...exempt].sort(), 'the team exemptions changed').toEqual(
      [
        'team-screens.fixture.ts',
        'services/list.ts',
        'services/write.ts',
        'services/roster.ts',
        'services/dependents.ts',
        // STORY 8.2b: the directory's and the roster's keys as one snapshot each.
        'services/surface-keys.ts',
        // STORY 7.17: the directory's rules, and its two parts, which are the
        // sign-in suite's MEMBER_DIRECTORY set rather than a team screen's.
        'services/directory.ts',
        'hooks/use-member-directory.ts',
        'components/member-directory.tsx',
      ]
        .map((file) => join(TEAM_FEATURE, ...file.split('/')))
        .sort(),
    );
    for (const part of MEMBER_DIRECTORY) {
      expect(exempt, `${part} is a directory part and not exempt from the team sets`).toContain(part);
    }
    for (const entry of TEAM_SCREENS_EXEMPT) {
      expect(entry.why.length, `${entry.file} is exempt without a stated reason`).toBeGreaterThan(20);
    }
    // DISJOINT: a part in both sets would have its strings, controls and
    // handlers counted twice.
    for (const file of TEAM_LIST) {
      expect(TEAM_EDIT, `${file} is in both team sets`).not.toContain(file);
      expect(TEAM_ROSTER, `${file} is in the list and the roster sets`).not.toContain(file);
    }
    for (const file of TEAM_EDIT) {
      expect(TEAM_ROSTER, `${file} is in the edit and the roster sets`).not.toContain(file);
    }
    for (const file of [...TEAM_LIST, ...TEAM_EDIT, ...TEAM_ROSTER]) {
      expect(existsSync(file), `${file} is in a set and does not exist`).toBe(true);
      // NON-VACUITY PER FILE, with a floor rather than "not empty": a part
      // gutted to its imports would otherwise pass every sweep over the set.
      expect(source(file).trim().length, `${file} is all but empty`).toBeGreaterThan(150);
    }
    expect(TEAM_LIST[0], 'the list page is read first').toBe(TEAM_LIST_PAGE);
    expect(TEAM_EDIT[0], 'the edit page is read first').toBe(TEAM_EDIT_PAGE);
    expect(TEAM_ROSTER[0], 'the roster page is read first').toBe(TEAM_ROSTER_PAGE);
    // ONE DECLARATION PER HANDLER PER SET, because the extractors take the
    // first match in a joined set. The roster declares none (asserted below).
    for (const [set, hookFile, names] of [
      [TEAM_LIST, TEAM_LIST_HOOK, ['submit', 'openAdding']],
      [TEAM_EDIT, TEAM_EDIT_HOOK, ['submit', 'archive', 'refresh', 'close']],
    ] as const) {
      for (const name of names) {
        expect(
          source(set).match(new RegExp(`function ${name}\\(`, 'g'))?.length,
          `${name} is not declared exactly once in its set`,
        ).toBe(1);
        expect(source(hookFile), `${name} is not in its hook`).toMatch(
          new RegExp(`\\n {2}(?:async )?function ${name}\\(`),
        );
      }
    }
    expect(
      found.filter((file) => !exempt.has(file)).sort(),
      'the team file sets and the feature folders disagree',
    ).toEqual([...TEAM_LIST, ...TEAM_EDIT, ...TEAM_ROSTER].filter((file) => !pages.has(file)).sort());
  });

  /**
   * The team sets' wiring, read PER FILE (source structure B6, on B4's and
   * B5's terms): the set-wide sweeps below take the first match in a joined
   * set, so a part could shadow the hook's ref, handler or write and still
   * read as wired.
   */
  const TEAM_SETS = [
    {
      name: 'the team list',
      set: TEAM_LIST,
      hookFile: TEAM_LIST_HOOK,
      submits: ['submit'],
    },
    {
      name: 'the team edit form',
      set: TEAM_EDIT,
      hookFile: TEAM_EDIT_HOOK,
      submits: ['submit'],
    },
  ];
  const TEAM_HANDLERS = 'submit|openAdding|archive|refresh|close';
  const TEAM_WRITES = ['supabaseClient', 'TEAMS_TABLE', '.from(', 'createTeam(', 'renameTeam(', 'archiveTeam('];

  it('remounts the team screen per route id, so no state crosses teams', () => {
    expect(source(TEAM_EDIT_PAGE), 'the team edit screen is not keyed by the route id').toMatch(
      /return <TeamScreen key=\{id\} id=\{id\} \/>;/,
    );
    // BELOW THE KEY: the hook is called in the keyed screen, so a new id
    // remounts its state, and never in the wrapper that reads the id.
    const page = source(TEAM_EDIT_PAGE);
    const wrapper = /export function LjudiSmjenaScreen\([\s\S]*?\n\}/.exec(page)?.[0] ?? '';
    const keyed = /\nfunction TeamScreen\([\s\S]*?\n\}/.exec(page)?.[0] ?? '';

    expect(wrapper, 'the wrapper could not be extracted').toContain('useParams()');
    expect(keyed, 'the keyed screen could not be extracted').not.toBe('');
    expect(keyed, 'the edit hook is not called below the key').toContain('useTeamEdit(id)');
    expect(wrapper, 'the edit hook is called above the key').not.toContain('useTeamEdit(');
    expect(occurrences(page, 'useTeamEdit('), 'the edit hook is called more than once').toBe(1);
  });

  it.each([
    { name: 'the team list', set: TEAM_LIST, page: TEAM_LIST_PAGE, hook: 'useTeamList(' },
    { name: 'the team edit form', set: TEAM_EDIT, page: TEAM_EDIT_PAGE, hook: 'useTeamEdit(' },
    { name: 'the team roster', set: TEAM_ROSTER, page: TEAM_ROSTER_PAGE, hook: 'useTeamRoster(' },
  ])('holds one instance of its hook, in the page, on $name', ({ set, page, hook }) => {
    // ONE INSTANCE PER SET: a part calling the hook itself would hold state of
    // its own, split from the page's, and every guard above would still pass.
    // Counted over the set less the hook file, which declares it.
    const callers = set.filter((file) => !source(file).includes(`export function ${hook}`));

    expect(callers.length, 'the hook file is not in the set').toBe(set.length - 1);
    expect(occurrences(screenSource(callers), hook), `${hook} is not called exactly once`).toBe(1);
    expect(occurrences(source(page), hook), `${hook} is not called in the page`).toBe(1);
    expect(occurrences(source(TEAM_LIST_PAGE), 'useTeamEdit('), 'the list page runs the edit hook').toBe(0);
    expect(occurrences(source(TEAM_EDIT), 'useTeamList('), 'the edit set runs the list hook').toBe(0);
    expect(occurrences(source([...TEAM_LIST, ...TEAM_EDIT]), 'useTeamRoster('), 'a team screen runs the roster hook').toBe(0);
    expect(occurrences(source(TEAM_ROSTER), 'useTeamList('), 'the roster runs the list hook').toBe(0);
    expect(occurrences(source(TEAM_ROSTER), 'useTeamEdit('), 'the roster runs the edit hook').toBe(0);
  });

  it.each(TEAM_SETS)('creates every attached ref once, in the hook, on $name', ({ set, hookFile }) => {
    // `ref` and ANY `*Ref` prop, so a ref handed on through a primitive's own
    // prop (`closeRef`, as the hour band dialog does) is read too.
    const attached = [...source(set).matchAll(/\b(?:ref|\w+Ref)=\{([^}]*)\}/g)].map((found) => found[1] ?? '')
      .filter((name) => !MODULE_REF_CALLBACKS.has(name));

    expect(attached.length, 'no ref is attached at all').toBeGreaterThan(0);
    // A BARE NAME, so it resolves to a hook-created `const`; `screen.x` would not.
    for (const name of attached) expect(name, `an attached ref is not a bare name: ${name}`).toMatch(/^\w+$/);
    for (const name of new Set(attached)) {
      expect(occurrences(source(set), `const ${name} = useRef`), `${name} is not created exactly once`).toBe(1);
      expect(source(hookFile), `${name} is not created in the hook`).toContain(`const ${name} = useRef`);
    }
  });

  it('disarms the archive confirmation in its finally, on the team edit form', () => {
    const archive = namedHandler(source(TEAM_EDIT_HOOK), 'archive');

    expect(archive.length, 'archive could not be extracted').toBeGreaterThan(80);
    expect(finallyBlock(archive), 'the archive is not disarmed in its finally').toContain('setArmed(false)');
  });

  it('keys the team form by landed renames, on the team edit form', () => {
    const form = /<form\b(?:=>|[^>])*>/.exec(source(join(srcRoot, ...TEAM_EDIT_PARTS.body)))?.[0] ?? '';

    expect(form, 'the team form is gone').not.toBe('');
    expect(form, 'the team form is not keyed by landed renames').toContain('key={teamFormKey(team, renames)}');
  });

  it('focuses the name field once the add dialog opens, from the team list hook only', () => {
    // `Effect(`, so a layout or insertion effect is counted too.
    expect(occurrences(source(TEAM_LIST), 'Effect('), 'an effect besides the one focus effect').toBe(1);
    expect(occurrences(source(TEAM_EDIT), 'Effect('), 'an effect arrived on the team edit form').toBe(0);
    expect(source(TEAM_LIST_HOOK), 'the focus effect changed').toMatch(
      /useEffect\(\s*\(\)\s*=>\s*\{\s*if\s*\(adding\)\s*nameField\.current\?\.focus\(\);?\s*\},\s*\[adding\],?\s*\);/,
    );
  });

  it('focuses the name field on every refusal of the add, the missing claim included', () => {
    // A SOURCE GUARD, not a runtime test: the missing-claim branch reads the
    // session's own access token inside the hook, and the node suite renders
    // no hook, so nothing here can drive it. Both refusal branches are read
    // out of the one `submit`, each up to its own `return`.
    const submit = namedHandler(source(TEAM_LIST_HOOK), 'submit');
    const missingClaim = /if \(organization === null\) \{([\s\S]*?)\breturn;/.exec(submit)?.[1] ?? '';
    const refused = /if \(!outcome\.ok\) \{([\s\S]*?)\breturn;/.exec(submit)?.[1] ?? '';

    expect(submit.length, 'submit could not be extracted').toBeGreaterThan(80);
    expect(missingClaim, 'the missing-claim refusal is gone').toContain('setFailure(TEAM_WRITE_REFUSED)');
    expect(missingClaim, 'the missing-claim refusal does not focus the name').toContain('name.focus()');
    expect(refused, 'the ordinary refusal is gone').toContain('setFailure(outcome.code)');
    expect(refused, 'the ordinary refusal does not focus the name').toContain('name.focus()');
  });

  it.each(TEAM_SETS)('declares no handler outside the hook on $name',({ set, hookFile }) => {
    const shadow = new RegExp(`\\b(?:(?:const|let)\\s+(?:${TEAM_HANDLERS})\\s*=|function\\s+(?:${TEAM_HANDLERS})\\s*\\()`);
    // Nor the hooks a handler is built from, nor a handler handed on as an
    // object key of a part's own, nor the client and table a write is made on.
    const wiring = new RegExp(
      `\\buseNavigate\\(|\\buseQueryClient\\(|[{,]\\s*(?:${TEAM_HANDLERS})\\s*:|\\bsupabaseClient\\b|\\bTEAMS_TABLE\\b|\\.from\\(`,
    );

    for (const part of set.filter((file) => file !== hookFile)) {
      expect(source(part), `${part} declares a handler of its own`).not.toMatch(shadow);
      expect(source(part), `${part} builds or hands on a handler of its own`).not.toMatch(wiring);
    }
  });

  it.each(TEAM_SETS)('binds every form to a named submit handler on $name', ({ set, submits }) => {
    const forms = set.flatMap((part) => [...source(part).matchAll(/<form\b(?:=>|[^>])*>/g)].map((found) => found[0]));
    const bound = new RegExp(`onSubmit=\\{[\\s\\S]{0,160}?\\b(?:${submits.join('|')})\\b`);

    expect(forms.length, 'no form found').toBe(submits.length);
    for (const form of forms) expect(form, 'a form is bound to no named submit handler').toMatch(bound);
  });

  it.each(TEAM_SETS)('writes only from the hook on $name', ({ set, hookFile }) => {
    for (const part of set.filter((file) => file !== hookFile)) {
      for (const write of TEAM_WRITES) {
        expect(source(part), `${part} calls ${write}`).not.toContain(write);
      }
    }
    expect(source(hookFile), 'the hook reaches no client').toContain('supabaseClient(');
  });

  /**
   * STATE AND NAVIGATION OUTSIDE A HOOK (source structure B7, the review):
   * every React and router hook a part could hold state, a transition or a
   * navigation of its own with. `useParams` is not among them: each page reads
   * its route once, which the per-set `useParams(` count pins.
   */
  const NON_HOOK_STATE =
    /\buse(?:State|Ref|Query|Reducer|ActionState|Optimistic|Transition|FormStatus|Router|Navigate|QueryClient)\b/;

  it.each([
    { name: 'the sign-in screen', set: SCREEN, hookFile: SIGN_IN_HOOK },
    { name: 'the team roster', set: TEAM_ROSTER, hookFile: TEAM_ROSTER_HOOK },
  ])('holds no state or navigation outside the hook on $name', ({ set, hookFile }) => {
    for (const part of set.filter((file) => file !== hookFile)) {
      expect(source(part), `${part} holds state or navigation of its own`).not.toMatch(NON_HOOK_STATE);
    }
    expect(occurrences(source(set), 'useParams('), 'a part reads the route params besides the page').toBe(1);
    expect(occurrences(source(set[0] ?? ''), 'useParams('), 'the page does not read its route').toBe(1);
  });

  it('keeps the roster read bounded, and the settings derived only in the hook', () => {
    const hook = source(TEAM_ROSTER_HOOK);
    const read = /useQuery\(\{\s*queryKey: TEAM_ROSTER_KEY\(id\),[\s\S]*?\}\);/.exec(hook)?.[0] ?? '';

    expect(read, 'no roster read to inspect').not.toBe('');
    expect(read, 'the roster read has no cache floor').toContain('staleTime: TEAM_ROSTER_READ_STALE_MS');
    expect(read, 'the roster read re-runs on every window focus').toContain('refetchOnWindowFocus: false');
    // The organization read's `retry: false` is pinned by the chrome-policy case.
    const returned = /\n {2}return \{([^}]*)\};/.exec(hook)?.[1] ?? '';

    expect(returned, "the hook's return object could not be extracted").not.toBe('');
    for (const name of ['shown', 'positionShown']) {
      expect(returned, `the hook does not return ${name}`).toMatch(new RegExp(`\\b${name}\\b`));
    }
    const component = source(TEAM_ROSTER_PART);
    const taken = /const \{([^}]*)\} = screen;/.exec(component)?.[1] ?? '';

    for (const name of ['shown', 'positionShown']) {
      expect(taken, `the component does not take ${name} from the screen`).toMatch(new RegExp(`\\b${name}\\b`));
      expect(component, `the component declares its own ${name}`).not.toMatch(
        new RegExp(`\\b(?:const|let|var)\\s+${name}\\b`),
      );
    }
  });

  it('offers no interaction on the roster but its one link back', () => {
    // The roster is read-only: its one control is the link back to Danas,
    // drawn as a `<Button asChild>` around the `<Link>` (counted as 1 in
    // SCREENS). No native button and no event handler of any name.
    const buttons = buttonElements(source(TEAM_ROSTER));

    expect(buttons, 'a button arrived on the roster').toHaveLength(1);
    expect(buttons[0], 'the one button is not the link back').toContain('asChild');
    expect(source(TEAM_ROSTER_PAGE), 'the one button does not wrap the link back').toMatch(
      /<Button asChild[^>]*>\s*<Link to="\/danas">/,
    );
    for (const part of TEAM_ROSTER) {
      expect(source(part), `${part} renders a native button`).not.toMatch(/<button\b/);
      expect(source(part), `${part} binds an event handler`).not.toMatch(/\bon[A-Z]\w*=/);
    }
  });

  it('keeps the sign-in fields, the slug and the form state where they belong', () => {
    // NO NATIVE FIELD in any part, so the `<Input>` guards cannot be bypassed.
    // STORY 7.7's one exception: the URL slug's row carries the organization
    // in the form data as a HIDDEN input, which is no control, so it needs no
    // label, ref or tap target. Exactly that one, and only that shape.
    const HIDDEN_ORGANIZATION = '<input type="hidden" name="organization" value={shownSlug} />';

    expect(occurrences(source(SIGN_IN_FORM), HIDDEN_ORGANIZATION), 'the row does not carry the organization').toBe(1);
    for (const part of SCREEN) {
      expect(source(part).replace(HIDDEN_ORGANIZATION, ''), `${part} renders a bare input`).not.toMatch(/<input\b/);
      expect(source(part), `${part} declares a slug of its own`).not.toMatch(/\b(?:const|let|var)\s+slug\b/);
    }
    // THE SLUG COMES IN: the hook takes it, the page hands its route's in.
    // STORY 7.7: the URL slug OR NONE. Bare `/prijava` hands `undefined`, and
    // the form then offers the organization field instead of the row.
    expect(source(SIGN_IN_HOOK), 'the hook does not take the slug').toContain(
      'export function useSignIn(slug: string | undefined)',
    );
    expect(source(SIGN_IN_PAGE), 'the page does not hand the slug to the hook').toContain('useSignIn(slug)');
    // THE FORM'S STATE IS THE HOOK'S, taken from the screen and never its own:
    // the three fields' refs, the row-or-field switch, the toggle and the
    // disclosure (story 7.7) as much as the refusal and the exchange.
    // The organization's row-or-field is its own component in the form file,
    // so every destructure of `screen` there is read together.
    const form = source(SIGN_IN_FORM);
    const taken = [...form.matchAll(/const \{([^}]*)\} = screen;/g)].map((found) => found[1] ?? '').join(',');
    const names = [
      'organizationField',
      'usernameField',
      'passwordField',
      'organizationEditable',
      'passwordShown',
      'forgotOpen',
      'failure',
      'pending',
      'changeOrganization',
      'togglePassword',
      'toggleForgot',
      'organizationInput',
      'submit',
    ];

    expect(taken, 'the form takes nothing from the screen').not.toBe('');
    for (const name of names) {
      expect(taken, `the form does not take ${name} from the screen`).toMatch(new RegExp(`\\b${name}\\b`));
      expect(form, `the form declares its own ${name}`).not.toMatch(new RegExp(`\\b(?:const|let|var)\\s+${name}\\b`));
    }
  });

  /**
   * The roster's set (source structure B7, on B6's terms): the third team set,
   * read-only, so what its hook holds is two reads and their derivations, and
   * what no part may hold is a handler, a ref, a form or an effect.
   */
  const ROSTER_WIRING = new RegExp(
    `\\buseNavigate\\(|\\buseQueryClient\\(|[{,]\\s*(?:${TEAM_HANDLERS})\\s*:|\\bsupabaseClient\\b|\\borganizationTable\\b|\\bTEAMS_TABLE\\b|\\.from\\(`,
  );

  it('remounts the roster per route id, with its hook below the key', () => {
    const page = source(TEAM_ROSTER_PAGE);
    const wrapper = /export function SmjenaScreen\([\s\S]*?\n\}/.exec(page)?.[0] ?? '';
    const keyed = /\nfunction RosterScreen\([\s\S]*?\n\}/.exec(page)?.[0] ?? '';

    expect(page, 'the roster is not keyed by the route id').toMatch(/return <RosterScreen key=\{id\} id=\{id\} \/>;/);
    expect(wrapper, 'the wrapper could not be extracted').toContain('useParams()');
    expect(keyed, 'the keyed screen could not be extracted').not.toBe('');
    expect(keyed, 'the roster hook is not called below the key').toContain('useTeamRoster(id)');
    expect(wrapper, 'the roster hook is called above the key').not.toContain('useTeamRoster(');
    expect(occurrences(source(TEAM_ROSTER), 'useParams('), 'a part reads the route params besides the page').toBe(1);
  });

  it('holds no handler, ref, form or effect anywhere on the roster', () => {
    const set = source(TEAM_ROSTER);

    expect(set, 'the roster declares a handler').not.toMatch(
      new RegExp(`\\b(?:(?:const|let)\\s+(?:${TEAM_HANDLERS})\\s*=|function\\s+(?:${TEAM_HANDLERS})\\s*\\()`),
    );
    expect(occurrences(set, 'useRef'), 'a ref arrived on the roster').toBe(0);
    expect(set, 'a ref is attached on the roster').not.toMatch(/\b(?:ref|\w+Ref)=\{/);
    expect(occurrences(set, '<form'), 'a form arrived on the roster').toBe(0);
    expect(occurrences(set, 'useState'), 'state arrived on the roster').toBe(0);
    // `Effect(`, so a layout or insertion effect is counted too.
    expect(occurrences(set, 'Effect('), 'an effect arrived on the roster').toBe(0);
  });

  it('reads and reaches the client only from the roster hook', () => {
    for (const part of TEAM_ROSTER.filter((file) => file !== TEAM_ROSTER_HOOK)) {
      expect(source(part), `${part} builds or hands on wiring of its own`).not.toMatch(ROSTER_WIRING);
      expect(source(part), `${part} reads of its own`).not.toContain('useQuery(');
    }
    expect(source(TEAM_ROSTER_HOOK), 'the roster hook reaches no client').toContain('supabaseClient()');
  });

  it('sweeps every part of the sign-in screen, so a new file cannot escape the set', () => {
    // SOURCE STRUCTURE B7, on B6's terms: an EQUALITY between the set and
    // EVERY non-test module anywhere under the auth feature — its root,
    // `services/`, and `components/` and `hooks/` at any depth — less the
    // modules exempt for a stated reason (`sign-in-screen.fixture.ts`): the
    // fixture, `services/address.ts`, `services/last-organization.ts` (story
    // 7.7), `services/return-target.ts`, `services/sign-in.ts` and
    // `services/sign-out.ts`. ANY
    // SCRIPT MODULE (`.[cm]?[jt]sx?`), less tests and declaration files, and
    // ANY `*.fixture.*`, which renders nothing, is left out by its shape.
    // STORY 7.8: the set-password step shares the feature, so the walk
    // answers to BOTH sets and both exemption lists.
    const exemptions = [...SIGN_IN_SCREEN_EXEMPT, ...SET_PASSWORD_SCREEN_EXEMPT];
    const exempt = new Set(exemptions.map((entry) => join(AUTH_FEATURE, ...entry.file.split('/'))));
    const walked = readdirSync(AUTH_FEATURE, { recursive: true, encoding: 'utf8' })
      .filter(
        (name) =>
          /\.[cm]?[jt]sx?$/.test(name) && !/\.test\.[cm]?[jt]sx?$/.test(name) && !/\.d\.[cm]?ts$/.test(name),
      )
      .map((name) => join(AUTH_FEATURE, name));
    const found = walked.filter((file) => !/\.fixture\.[cm]?[jt]sx?$/.test(file));

    expect(walked, 'the walk reaches the feature root').toContain(join(AUTH_FEATURE, 'sign-in-screen.fixture.ts'));
    expect(found, 'the walk reaches services/').toContain(MESSAGE_KEYS);
    for (const file of exempt) expect(walked, `${file} is exempt and does not exist`).toContain(file);
    // THE EXACT EXEMPTIONS, so a new one is a reviewed change to this test.
    expect([...exempt].sort(), 'the sign-in exemptions changed').toEqual(
      [
        'sign-in-screen.fixture.ts',
        'set-password-screen.fixture.ts',
        'services/address.ts',
        'services/last-organization.ts',
        'services/return-target.ts',
        'services/set-password.ts',
        'services/sign-in.ts',
        'services/sign-out.ts',
      ]
        .map((file) => join(AUTH_FEATURE, ...file.split('/')))
        .sort(),
    );
    for (const entry of exemptions) {
      expect(entry.why.length, `${entry.file} is exempt without a stated reason`).toBeGreaterThan(20);
    }
    // DISJOINT from EVERY other screen in `SCREENS` — the member, settings,
    // calendar, hour band, shift type and three team sets, the rotation
    // builder and every single-file screen — so no part is counted on two
    // screens.
    const others = SCREENS.filter((screen) => screen.file !== SCREEN).flatMap((screen) =>
      typeof screen.file === 'string' ? [screen.file] : [...screen.file],
    );

    expect(SCREENS.filter((screen) => screen.file === SCREEN), 'the sign-in set is not one screen').toHaveLength(1);
    expect(others, 'the other sets were not read').toEqual(
      expect.arrayContaining([NOT_FOUND, ...TEAM_ROSTER, ...KALENDAR, ...SETTINGS, ...MEMBER_EDIT]),
    );
    for (const file of SCREEN) expect(others, `${file} is in the sign-in set and another`).not.toContain(file);
    // AND THE SET-PASSWORD SET IS DISJOINT from every other screen too.
    const besidesSetPassword = SCREENS.filter((screen) => screen.file !== SET_PASSWORD_SCREEN).flatMap(
      (screen) => (typeof screen.file === 'string' ? [screen.file] : [...screen.file]),
    );

    for (const file of SET_PASSWORD_SCREEN) {
      expect(besidesSetPassword, `${file} is in the set-password set and another`).not.toContain(file);
      expect(existsSync(file), `${file} is in the set and does not exist`).toBe(true);
      expect(source(file).trim().length, `${file} is all but empty`).toBeGreaterThan(150);
    }
    expect(SET_PASSWORD_SCREEN[0], 'the set-password page is read first').toBe(SET_PASSWORD_PAGE);
    expect(
      source(SET_PASSWORD_SCREEN).match(/function submit\(/g)?.length,
      'the set-password submit is not declared exactly once',
    ).toBe(1);
    expect(source(SET_PASSWORD_HOOK), 'the set-password submit is not in its hook').toMatch(
      /\n {2}(?:async )?function submit\(/,
    );
    for (const file of SCREEN) {
      expect(existsSync(file), `${file} is in the set and does not exist`).toBe(true);
      // NON-VACUITY PER FILE, with a floor rather than "not empty".
      expect(source(file).trim().length, `${file} is all but empty`).toBeGreaterThan(150);
    }
    expect(SCREEN[0], 'the sign-in page is read first').toBe(SIGN_IN_PAGE);
    // ONE DECLARATION of the one handler, in the hook, at 2-space indentation.
    expect(source(SCREEN).match(/function submit\(/g)?.length, 'submit is not declared exactly once').toBe(1);
    expect(source(SIGN_IN_HOOK), 'submit is not in its hook').toMatch(/\n {2}(?:async )?function submit\(/);
    expect(
      found.filter((file) => !exempt.has(file)).sort(),
      'the two auth file sets and the feature folders disagree',
    ).toEqual(
      [
        ...SCREEN.filter((file) => file !== SIGN_IN_PAGE),
        ...SET_PASSWORD_SCREEN.filter((file) => file !== SET_PASSWORD_PAGE),
      ].sort(),
    );
  });

  it('holds one instance of its hook, in the page, on the sign-in screen', () => {
    const callers = SCREEN.filter((file) => !source(file).includes('export function useSignIn('));

    expect(callers.length, 'the hook file is not in the set').toBe(SCREEN.length - 1);
    expect(occurrences(screenSource(callers), 'useSignIn('), 'useSignIn( is not called exactly once').toBe(1);
    expect(occurrences(source(SIGN_IN_PAGE), 'useSignIn('), 'useSignIn( is not called in the page').toBe(1);
  });

  it('creates every attached ref once, in the hook, on the sign-in screen', () => {
    const attached = [...source(SCREEN).matchAll(/\b(?:ref|\w+Ref)=\{([^}]*)\}/g)].map((found) => found[1] ?? '');

    // THREE SINCE STORY 7.7: the organization field joined the username and
    // the password.
    expect(attached.length, 'not all three fields carry a ref').toBe(3);
    // A BARE NAME, so it resolves to a hook-created `const`; `screen.x` would not.
    for (const name of attached) expect(name, `an attached ref is not a bare name: ${name}`).toMatch(/^\w+$/);
    for (const name of new Set(attached)) {
      expect(occurrences(source(SCREEN), `const ${name} = useRef`), `${name} is not created exactly once`).toBe(1);
      expect(source(SIGN_IN_HOOK), `${name} is not created in the hook`).toContain(`const ${name} = useRef`);
    }
    expect(occurrences(source(SCREEN), '= useRef'), 'a ref is created besides the three fields and the in-flight flag').toBe(4);
    expect(source(SIGN_IN_HOOK), 'the in-flight ref is not in the hook').toContain('const exchanging = useRef(false);');
  });

  it('declares no handler outside the hook on the sign-in screen', () => {
    const shadow = /\b(?:(?:const|let)\s+submit\s*=|function\s+submit\s*\()/;
    // Nor the hooks a handler is built from, nor `submit` handed on as an
    // object key of a part's own, nor the client a sign-in is made on.
    const wiring = /\buseNavigate\(|\buseQueryClient\(|[{,]\s*submit\s*:|\bsupabaseClient\b|\.from\(|\bsignIn\(/;

    for (const part of SCREEN.filter((file) => file !== SIGN_IN_HOOK)) {
      expect(source(part), `${part} declares a handler of its own`).not.toMatch(shadow);
      expect(source(part), `${part} builds or hands on a handler of its own`).not.toMatch(wiring);
      expect(source(part), `${part} holds state of its own`).not.toMatch(/\buse(?:State|Ref|Query)\b/);
    }
    // THE PAGE HOLDS NO NAVIGATION: `/` is reached from the hook's submit.
    expect(source(SIGN_IN_PAGE), 'the sign-in page navigates').not.toContain('useNavigate');
  });

  it('binds its one form to submit, with no effect, on the sign-in screen', () => {
    const forms = SCREEN.flatMap((part) => [...source(part).matchAll(/<form\b(?:=>|[^>])*>/g)].map((found) => found[0]));

    expect(forms.length, 'not exactly one form').toBe(1);
    for (const form of forms) {
      expect(form, 'the form is bound to no named submit handler').toMatch(/onSubmit=\{[\s\S]{0,160}?\bsubmit\b/);
    }
    // `Effect(`, so a layout or insertion effect is counted too.
    expect(occurrences(source(SCREEN), 'Effect('), 'an effect arrived on the sign-in screen').toBe(0);
    expect(source(SIGN_IN_HOOK), 'the hook reaches no client').toContain('supabaseClient()');
  });

  it('finds the controls it is about to measure', () => {
    // SOURCE STRUCTURE B7: in the form, the part that renders them, and over
    // the whole set, so no other part grows a field or a button.
    //
    // STORY 7.7: THREE fields — the organization, the username and the
    // password — and FOUR buttons: `Promijeni` on the URL slug's row, the
    // password's show/hide toggle, `Prijava`, and the `Zaboravljena lozinka?`
    // disclosure. Exactly one is `type="submit"`.
    expect(inputElements(source(SIGN_IN_FORM))).toHaveLength(3);
    expect(buttonElements(source(SIGN_IN_FORM))).toHaveLength(4);
    expect(inputElements(source(SCREEN))).toHaveLength(3);
    expect(buttonElements(source(SCREEN))).toHaveLength(4);
    expect(occurrences(source(SIGN_IN_FORM), 'type="submit"'), 'not exactly one submit button').toBe(1);
    expect(occurrences(source(SIGN_IN_FORM), 'type="button"'), 'a non-submit button would submit').toBe(3);
  });
});
