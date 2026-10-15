import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DESTINATIONS } from '@/features/navigation/utils/destinations';

import {
  attributeOf,
  buttonElements,
  CHROME,
  componentFunction,
  headingKey,
  heightPx,
  LAYOUT,
  linkElements,
  LOCKUP,
  navBlocks,
  PLACEHOLDER_SLUGS,
  SETTINGS,
  SETTINGS_LOGO,
  source,
  srcRoot,
  TARGET_FLOOR_PX,
  translationKeys,
} from './source-guards.fixture';

// The signed-in shell: the route skeleton, the layout and its outlet, the navigation
// chrome, and the lockup it shares with the settings surface.

/**
 * The destinations that are built screens rather than placeholders.
 *
 * TWO SINCE STORY 1.5a. `/ljudi` moved out of the list above in the same commit
 * that built it — a table with a search field, a level filter, four sortable
 * headings and a refusal message — so the counts above stay the tight ones they
 * are: exactly one string, exactly zero controls, on a screen that is still only
 * a heading. Leaving it there would have meant loosening those counts for all
 * six.
 */
//
// THREE SINCE STORY 1.8: `/danas` left the placeholders when it gained the line
// naming the caller's team today, for the reason `/ljudi` did.
//
// FOUR SINCE STORY 2.2b: `/postavke-rotacije` left the placeholders when it
// gained the shift type list, its add form and its archived section.
//
// FIVE SINCE STORY 3.1: `/kalendar` left the placeholders when it gained the
// month grid and its navigation.
//
// SIX SINCE STORY 4.1b: `/sati` left the placeholders when it gained the
// viewer's month of hours and the month navigation it shares with the calendar.
//
// SEVEN SINCE STORY 5.2c: `/godisnji` left the placeholders when it gained the
// viewer's own allowance, days used and balance.
//
// EIGHT SINCE STORY 5.3b: `/raspored` left the placeholders when it gained the
// conflicts queue — every destination is built.
const BUILT_SLUGS = ['organizacija', 'ljudi', 'danas', 'postavke-rotacije', 'kalendar', 'sati', 'godisnji', 'raspored'];

/** Every registered destination, however much of it is built. */
const DESTINATION_SLUGS = [...PLACEHOLDER_SLUGS, ...BUILT_SLUGS];

/**
 * Every `<Link …>` opening tag's attribute block.
 *
 * Added by the navigation chrome, and it is a THIRD control detector rather than
 * a widening of the two above, deliberately. A router link is not a `<Button>`
 * and must not be counted as one — `expectedButtons` on every other screen is a
 * tight number, and folding links into it would loosen all of them to cover one
 * file. What a link shares with a button is the only thing asserted through it:
 * a person taps it, so UX-DR40's floor applies.
 *
 * Every consumer of this brings its own length assertion. Both element regexes
 * above are non-vacuously guarded by each of theirs, and copying one without
 * that guard is precisely how a sweep goes quiet.
 */
/** The `shell-entry` utility's body in `index.css` (story 7.3): the hover,
 *  focus and current treatment the chrome's link and *Više* share. */
function shellEntryUtility(): string {
  const css = readFileSync(join(srcRoot, 'index.css'), 'utf8');

  return /@utility shell-entry \{([^}]*)\}/.exec(css)?.[1] ?? '';
}

describe('the route skeleton is the one the destination table describes', () => {
  /**
   * Four hand-written copies of the eight destinations exist — the router, the
   * destination table, `hr.json`, and this file's slug list — and only pinning
   * them to each other makes the set of eight a single fact.
   */

  it('partitions the destinations into placeholders and built screens, with no overlap', () => {
    // The split story 1.4a introduced. A destination that fell out of BOTH lists
    // would keep the assertion below green — it reads the union — while escaping
    // the per-file counts, which read the two lists separately.
    expect(PLACEHOLDER_SLUGS.filter((slug) => BUILT_SLUGS.includes(slug))).toEqual([]);
    expect(PLACEHOLDER_SLUGS.length + BUILT_SLUGS.length).toBe(DESTINATION_SLUGS.length);
    expect(BUILT_SLUGS.length, 'nothing is built, so the split asserts nothing').toBeGreaterThan(0);
  });

  it('sweeps exactly the destinations the table names', () => {
    // P7's gap. Every sweep in this file reads `DESTINATION_SCREENS`, so a
    // ninth destination added to the router and the table but not here would
    // ship with no control count, no tap-target floor, no literal sweep and no
    // key count — and nothing in this file would be red, because nothing in
    // this file would know it existed.
    expect([...DESTINATION_SLUGS].sort()).toEqual(
      DESTINATIONS.map((destination) => destination.path.slice(1)).sort(),
    );
  });

  it.each(DESTINATIONS)('renders $key on the file that owns $path', ({ key, path }) => {
    // WHAT NOTHING ELSE BINDS. `danas.tsx` rendering `nav.kalendar` while
    // `kalendar.tsx` renders `nav.danas` satisfies every other assertion in this
    // repository: the per-file count is one either way, the rendered-vs-declared
    // set comparison is unchanged because both keys are still rendered
    // somewhere, and `router.test.ts`'s identity checks pin the component a
    // route renders, never the key that component renders. `/danas` would show
    // "Kalendar" with the whole suite green.
    //
    // The file is derived from the PATH rather than named, so this also pins
    // the third link in the chain: the route path, the file that owns it, and
    // the key that file renders are one fact in three places.
    const file = join(srcRoot, 'pages', `${path.slice(1)}.tsx`);
    const screen = source(file);

    // READ OFF THE `<h1>`, not off source order, since story 1.4a. Seven of the
    // eight render exactly one string, so `toEqual([key])` and "the heading is
    // the key" were the same assertion for them; the settings surface renders
    // eight, and the one that has to be the destination's own is the HEADING —
    // a screen whose `<h1>` drifted to some other key is a page titled something
    // the navigation does not call it. Their per-file exact counts in
    // `KEY_SOURCES` keep the other seven as tight as they were.
    // STORY 7.14: a member's own *Sati* is titled *Moji sati*, an admin's is the destination's.
    const titles = path === '/sati' ? [key, 'sati.title.own'] : [key];

    expect(titles, `${path} does not title itself ${key}`).toContain(headingKey(screen));
    expect(translationKeys(screen), `${path} never renders ${key}`).toContain(key);
  });
});

describe('the signed-in layout renders its outlet', () => {
  it('renders an Outlet, not merely a container', () => {
    // MUTATION-PROVEN GAP. `_app.tsx` is in `localization-applied.test.ts`'s
    // `SOURCES` for build FRESHNESS only and in no source sweep, and
    // `router.test.ts` pins the component by identity — which says the layout
    // renders `AppLayout`, never what `AppLayout` renders. Replacing its body
    // with a plain `<div>` leaves the entire suite green while all eight
    // destinations render an empty shell at HTTP 200: every path still
    // resolves, every guard still runs, and nothing reaches the screen.
    //
    // Comment-blind, like every read in this file, so the header's own prose
    // about the outlet cannot satisfy it.
    const layout = source(LAYOUT);

    expect(layout, 'the layout renders no <Outlet>, so every destination is a blank page').toContain(
      '<Outlet',
    );
    expect(layout, 'the layout does not import Outlet from the router').toMatch(
      /import\s*\{[^}]*\bOutlet\b[^}]*\}\s*from\s*'@tanstack\/react-router'/,
    );
  });

  it('mounts the chrome around it, which is the whole deliverable of part B', () => {
    // MUTATION-PROVEN GAP, and the widest one this story shipped. Reverting this
    // layout to `<div className="flex flex-1 flex-col"><Outlet /></div>` and
    // deleting the import passed the ENTIRE root suite — 1055 tests — with no
    // navigation, no sign-out and no chrome anywhere in the application. Every
    // assertion about `chrome.tsx` reads `chrome.tsx`, and nothing read the one
    // line that puts it on screen.
    //
    // Both halves are needed and neither implies the other: an import with no
    // element renders nothing, and an element with no import does not build.
    const layout = source(LAYOUT);

    expect(layout, 'the layout does not import the chrome').toMatch(
      /import\s*\{[^}]*\bAppChrome\b[^}]*\}\s*from\s*'@\/features\/navigation\/components\/chrome'/,
    );
    expect(layout, 'the layout never renders the chrome').toContain('<AppChrome>');
  });

  it('puts the outlet INSIDE the chrome, not beside it', () => {
    // The shape the assertion above passes for: `<><AppChrome /><Outlet /></>`
    // imports the chrome, renders it, and renders every destination outside it —
    // a navigation bar with no page attached to it. What must be true is
    // structural, so it is read structurally: the returned block's OUTERMOST
    // element is the chrome, and the outlet is nested within.
    const returned = (/return \(([\s\S]*?)\n {2}\);/.exec(source(LAYOUT))?.[1] ?? '').trim();

    expect(returned, 'no returned JSX block on the layout').not.toBe('');
    expect(returned.startsWith('<AppChrome>'), `the layout's outermost element is not the chrome: ${returned}`).toBe(
      true,
    );
    expect(returned.endsWith('</AppChrome>'), 'the chrome does not close around the whole tree').toBe(
      true,
    );
    expect(
      returned.indexOf('<Outlet'),
      'the outlet is not nested inside the chrome',
    ).toBeGreaterThan(returned.indexOf('<AppChrome>'));
  });

  it('renders the outlet unconditionally, not behind a branch', () => {
    // The shape the assertion above passes for: `{signedIn ? <Outlet /> : null}`
    // contains `<Outlet` and renders nothing in the case that matters. The
    // layout's whole job is to be transparent — the guard decides, and what
    // survives the guard renders.
    const layout = source(LAYOUT);
    const returned = /return \(([\s\S]*?)\n {2}\);/.exec(layout)?.[1] ?? '';

    expect(returned, 'no returned JSX block on the layout').not.toBe('');
    expect(returned, 'the outlet is behind a branch').not.toMatch(/[?]|&&/);
    expect(returned).toContain('<Outlet');
  });
});

describe('the chrome the layout wraps every destination in', () => {
  /**
   * THE NAVIGATION SHELL, PART B. Part A registered eight destinations and the
   * table that maps roles to them and shipped no way to reach any of them; this
   * is the component that calls `destinationsFor`, and it renders above every
   * signed-in screen in the application.
   *
   * Source-level, like everything else here, because AD-15 bans jsdom. What that
   * leaves assertable is exactly what a mutation can break silently: which table
   * the links come from, WHERE each control is placed rather than merely how
   * many there are, whether the active entry is signalled by anything but
   * colour, whether a failed role read says so or merely renders nothing, and
   * whether the exit goes through the module a node test can execute.
   */

  it('renders one list of links, not one per layout', () => {
    // NON-VACUITY for every assertion below, and a claim in its own right. Two
    // `<Link>` blocks — one for the tab bar, one for the sidebar — is two copies
    // of the destinations, their order, their icons and their active treatment,
    // and copies drift. ONE element rendered into two containers cannot.
    expect(
      linkElements(source(CHROME)),
      'the chrome renders its destinations from more than one place',
    ).toHaveLength(1);
  });

  it('puts the destinations in both bars and the exit in both layouts, not merely somewhere', () => {
    // MUTATION-PROVEN GAP, and the demonstration is the reason this block exists
    // at all: deleting the exit from the phone layout alone left the `<Link>`
    // count at one, `expectedButtons` unchanged and every responsive-class
    // assertion untouched — a phone build with navigation and no way to sign
    // out, on the device this story's whole argument is built around. Counting
    // controls says nothing about where they are.
    const chrome = source(CHROME);
    const bars = navBlocks(chrome);

    // NON-VACUITY, and specifically the count rather than "more than zero": one
    // bar is the mutation where a whole layout was deleted, and three is a `<nav>`
    // nested inside another, which the non-greedy extraction above would report
    // wrongly.
    expect(bars, 'the chrome does not render exactly two navigation bars').toHaveLength(2);

    // The sidebar renders the role's whole list; the phone bar its four tabs.
    // Both go through the one renderer, so both are the one `<Link>`.
    const [sidebar = '', phone = ''] = bars;

    expect(sidebar, 'the sidebar renders no destinations').toContain('{destinations}');
    expect(phone, 'the phone bar renders no tabs').toContain('{tabs}');
    expect(chrome, 'the tabs are not read off the table').toMatch(
      /const tabs = renderDestinations\(phone === null \? \[\] : phone\.tabs, PLACE\.tab\)/,
    );

    // THE EXIT, ONE PER LAYOUT. On the sidebar it is in the profile menu at the
    // foot of the aside; on a phone it is in the *Više* sheet (story 7.3), and
    // the theme sits beside it in both. Both halves are read, because deleting
    // either one is the mutation above.
    const aside = /<aside\b[\s\S]*?<\/aside>/.exec(chrome)?.[0] ?? '';
    const profile = componentFunction(chrome, 'renderProfile');
    const sheet = componentFunction(chrome, 'renderMore');

    expect(aside, 'the sidebar renders no profile card').toContain('{renderProfile()}');
    expect(profile, 'the profile menu holds no exit').toContain('{renderSignOut()}');
    expect(profile, 'the profile menu holds no theme').toContain('{renderThemeSegments()}');
    expect(sheet, 'the Više sheet holds no exit').toContain('{renderSignOut()}');
    expect(sheet, 'the Više sheet holds no theme').toContain('{renderThemeSegments()}');
    expect(chrome, 'the Više sheet is never rendered').toContain('{renderMore()}');
    // And neither has a second home: the sidebar foot and the phone bar carry
    // no theme and no exit of their own.
    expect(aside, 'the sidebar foot still carries a theme control').not.toContain('renderThemeSegments(');
    expect(phone, 'the phone bar still carries the exit').not.toContain('renderSignOut(');
    expect(phone, 'the phone bar still carries a theme control').not.toMatch(/renderTheme/);
    expect(chrome, 'the collapsed rail still cycles the theme').not.toContain('renderThemeCycle');
  });

  it('gives the phone bar five cells that never scroll, and opens Više as a labelled modal', () => {
    // Story 7.3. The old bar scrolled sideways and an admin saw about three
    // tabs; five equal grid cells cannot overflow, so the current tab is always
    // on screen.
    const chrome = source(CHROME);
    const phone = navBlocks(chrome)[1] ?? '';
    const sheet = componentFunction(chrome, 'renderMore');

    expect(phone, 'no phone bar to read').not.toBe('');
    expect(phone, 'the phone bar scrolls sideways again').not.toContain('overflow-x-auto');
    expect(phone, 'the phone bar is not five equal cells').toContain('grid-cols-5');

    const more = buttonElements(phone).find((element) => element.includes('aria-haspopup'));

    expect(more, 'the phone bar has no Više').not.toBeUndefined();
    expect(more, 'Više does not say it opens a dialog').toContain('aria-haspopup="dialog"');
    expect(more, 'Više does not say whether the sheet is open').toContain('aria-expanded={moreOpen}');
    // Current while the page is one of the sheet's destinations, through the
    // same section rule the links use.
    expect(more, 'Više is never marked current').toContain("aria-current={moreCurrent ? 'page' : undefined}");
    expect(chrome, 'Više decides its own current state by hand').toMatch(
      /const moreHere =[\s\S]{0,160}?isCurrentDestination\(pathname, destination\.path\)/,
    );
    expect(chrome).toContain('const moreCurrent = moreHere !== null;');
    // The SAME treatment as the link, by construction: both carry the one
    // `shell-entry` utility rather than two copies of its classes.
    expect(
      (attributeOf(more ?? '', 'className') ?? '').split(/\s+/),
      'Više does not share the link’s treatment',
    ).toContain('shell-entry');
    expect(more, 'Više hand-copies the current treatment').not.toContain('aria-[current=page]:');

    // The sheet is the one native Dialog, labelled, with a named close.
    expect(sheet, 'the sheet is not the shared Dialog').toContain('<Dialog');
    expect(sheet, 'the sheet carries no name').toContain("aria-label={t('shell.more')}");
    expect(sheet, 'the sheet has no named close').toContain("closeLabel={t('shell.moreClose')}");
    // Its rows are the one link, and the groups come from the table.
    expect(sheet, 'the sheet renders its rows some other way').toContain(
      'renderLink(destination, PLACE.sheet)',
    );
    expect(sheet).toContain('labelledGroups(more,');
    expect(chrome, 'the sidebar does not group its destinations').toContain(
      'labelledGroups(groupDestinations(destinationsFor(role)),',
    );
    expect(chrome, 'the phone layout is not read off the table').toContain('phoneNavigationFor(role)');
  });

  it('closes the sheet on a navigation and on a refused sign-out', () => {
    // A row in the sheet is a navigation; the page it opens must not sit behind
    // a modal. A refused sign-out must close it in the same render as the
    // failure, or the alert it focuses is inert behind the sheet.
    const chrome = source(CHROME);
    const handler = componentFunction(chrome, 'leave');

    expect(chrome, 'the sheet survives a navigation').toMatch(
      /setMoreOpen\(false\);\s*setFailure\(null\);\s*\n\s*\}, \[pathname\]\)/,
    );
    expect(handler, 'a refused sign-out leaves the sheet over its alert').toMatch(
      /setMoreOpen\(false\);\s*setFailure\(outcome\.code\);/,
    );

    // A row that IS the current page changes no pathname, so the row's own
    // press closes the sheet — on the one link, for the sheet placement only.
    const link = linkElements(chrome)[0] ?? '';

    expect(link, 'a sheet row leaves the sheet open on the current page').toContain(
      'onClick={place === PLACE.sheet ? closeMore : undefined}',
    );
    // The collapsed rail's tooltip is the sidebar's alone.
    expect(link, 'the rail tooltip leaks onto tabs and sheet rows').toContain(
      'title={place === PLACE.sidebar && !expanded ? name : undefined}',
    );
    // The close button cannot close what Escape and the backdrop may not.
    expect(componentFunction(chrome, 'closeMore'), 'the close ignores an in-flight sign-out').toMatch(
      /if \(leaving\.current\) return;/,
    );
    expect(componentFunction(chrome, 'renderMore')).toContain('onClose={closeMore}');
    // A viewport that turns wide closes the phone's sheet.
    expect(chrome, 'the sheet stays modal past the breakpoint').toContain(
      'useCloseWhenWide(moreOpen, closeMoreWhenWide)',
    );
  });

  it('keeps the exit outside the collapsible region, so collapsing cannot strand anybody', () => {
    // At and above 640px the tab bar is hidden, so the sidebar is the ONLY
    // chrome — and with the exit inside the collapsible region, collapsing took
    // the way out of the application with it. The collapse resets on reload, so
    // the way back was a page refresh nobody would think to try.
    //
    // Read as a containment question rather than a class question: what the
    // collapse hides is the element `aria-controls` names, so the exit must not
    // be inside it.
    const chrome = source(CHROME);
    //
    // The region is the sidebar's `<nav>` since the redesign, and the way out
    // is the profile card below it, which narrows to its chip but stays.
    const collapsible = /<nav\s+id="app-destinations"[\s\S]*?<\/nav>/.exec(chrome)?.[0] ?? '';

    expect(collapsible, 'no collapsible region to read').not.toBe('');
    expect(collapsible, 'the collapsible region holds no destinations').toContain('{destinations}');
    for (const exit of ['{exit}', 'renderSignOut(', 'renderProfile(']) {
      expect(
        collapsible,
        'the exit is inside the collapsible region, so collapsing hides the way out',
      ).not.toContain(exit);
    }
    expect(
      collapsible,
      'the region is not actually collapsed by the toggle state',
    ).toMatch(/className=\{\s*expanded\s*\?/);
  });

  it('reclaims space when it collapses, rather than hiding a list inside a fixed width', () => {
    // The sidebar kept `w-56` in both states, so the toggle hid the list and
    // moved not one pixel of layout — a control that visibly does nothing, which
    // is the dead affordance the voice rules exist to prevent. The width belongs
    // to the list, so collapsing takes it with it.
    const chrome = source(CHROME);
    const aside = /<aside\b[^>]*>/.exec(chrome)?.[0] ?? '';

    expect(aside, 'no <aside> to read').not.toBe('');
    expect(aside, 'the sidebar fixes its own width, so collapsing reclaims nothing').not.toMatch(
      /\bw-\d+/,
    );
  });

  it('gives the destination links the same 44 px floor every control has', () => {
    // The general sweep over `SCREENS` measures `<Input>` and `<Button>` and
    // structurally cannot see a `<Link>` — so the eight controls a person
    // actually navigates with were measured by nothing until this line. The
    // mutation is one character: drop `h-11` and every entry falls to whatever
    // the flex row gives it.
    const links = linkElements(source(CHROME));

    expect(links.length, 'no link detected on the chrome').toBeGreaterThan(0);
    for (const link of links) {
      const measured = heightPx(attributeOf(link, 'className'));

      expect(measured, `a destination link declares no usable height class: ${link}`).not.toBeNull();
      expect(measured).toBeGreaterThanOrEqual(TARGET_FLOOR_PX);
    }
  });

  it('signals the active destination by aria-current AND by something that is not colour', () => {
    // UX-DR37 and Q21: no meaning by colour alone. BOTH halves are asserted,
    // because each is invisible to the other — `aria-current` alone is a state
    // nobody sighted can see, and a bold entry alone is a state nobody using a
    // screen reader can hear.
    //
    // The treatment is keyed off the attribute itself (`aria-[current=page]:`),
    // which is what stops the two from disagreeing: there is one condition, not
    // two that happen to be written the same way today.
    //
    // Since story 7.3 the treatment is the `shell-entry` utility in
    // `index.css`, shared with *Više* so the two cannot drift: the link must
    // carry it, and the utility must hold the non-colour half.
    const link = linkElements(source(CHROME))[0] ?? '';
    const className = attributeOf(link, 'className') ?? '';

    expect(link, 'the chrome never marks the current destination').toMatch(/aria-current=\{/);
    expect(className.split(/\s+/), 'the link does not carry the shell treatment').toContain('shell-entry');
    expect(
      /aria-\[current=page\]:(?:font-bold|font-semibold|underline)/.test(shellEntryUtility()),
      'the active entry is distinguished by colour alone',
    ).toBe(true);
    expect(shellEntryUtility(), 'the focus ring is not offset by the sidebar').toContain(
      'focus-visible:ring-offset-sidebar',
    );
  });

  it('matches a destination and its descendants, not the exact path alone', () => {
    // Every destination is a SECTION. `pathname === destination.path` drops the
    // current-destination signal — and `aria-current` with it — on the first
    // child route, which Epic 2's day view under `Kalendar` adds, so this breaks
    // on arrival rather than hypothetically. The rule itself is executed in
    // `destinations.test.ts`; what is asserted here is that the chrome routes
    // through it rather than comparing strings of its own.
    const link = linkElements(source(CHROME))[0] ?? '';

    expect(
      link,
      'the active entry is decided by an equality this component wrote itself',
    ).toMatch(/aria-current=\{[^}]*isCurrentDestination\(pathname,[^}]*\}/);
    expect(source(CHROME), 'the chrome compares pathnames by hand').not.toMatch(
      /pathname === destination\.path/,
    );
  });

  it('renders the destinations the role reaches, never the whole table', () => {
    // MUTATION-PROVEN SHAPE. `DESTINATIONS` in place of `destinationsFor(role)`
    // type-checks, lints, renders, and shows a member every admin destination —
    // with `destinations.test.ts` still green, because that file executes the
    // TABLE and never sees what renders it.
    const chrome = source(CHROME);

    expect(chrome, 'the chrome does not filter the destinations by role at all').toContain(
      'destinationsFor(',
    );
    expect(
      chrome,
      'the chrome renders the whole destination table rather than the role’s own',
    ).not.toContain('DESTINATIONS');
  });

  it('holds no permission level of its own', () => {
    // The other half of the claim above. The chrome CONSUMES a role and decides
    // nothing about it: a branch on `'admin'` written here would be a second
    // place the member/admin split lives, unexecutable by any test (AD-15), and
    // free to disagree with the table that `destinations.test.ts` runs.
    const chrome = source(CHROME);

    for (const forbidden of ["'admin'", "'member_role'", 'memberRoleOf(']) {
      expect(chrome, `the chrome branches on ${forbidden} instead of consuming the role`).not.toContain(
        forbidden,
      );
    }
  });

  it('reports a role it could not read rather than rendering an empty bar', () => {
    // THE acceptance criterion this file can carry. An unrecognised or
    // unreadable role must not render as an empty navigation, because an empty
    // navigation is byte-identical to what a member with no access would see.
    // The message is what tells them apart, and it reaches `t()` through the
    // mapping a node test executes rather than a ternary over codes.
    const chrome = source(CHROME);

    expect(chrome, 'the chrome renders no alert at all').toContain('role="alert"');
    expect(chrome, 'the chrome does not render its message through the mapping').toContain(
      't(navigationMessageKey(',
    );
    for (const code of ['MEMBER_ROLE_REFUSED', 'MEMBER_ROLE_UNRECOGNISED', 'shell.error.']) {
      expect(chrome, `${code} is branched on in the chrome`).not.toContain(code);
    }
  });

  it('treats a query that ERRORED as a failure too, not as an empty bar', () => {
    // THE THIRD OUTCOME, and the one a first draft misses. `readMemberRole`
    // folds every failure it knows about into `{ ok: false, code }`, which
    // `useQuery` files as a resolved value — but the queryFn can still throw
    // before reaching it, and a chrome reading only `data` then has no role AND
    // no refusal: an empty bar with no message, the exact state this component
    // is written to make impossible.
    const chrome = source(CHROME);

    expect(chrome, 'the errored query state is read nowhere').toContain('member.isError');
    expect(
      chrome,
      'an errored query produces no failure code, so it renders as an empty bar',
    ).toMatch(/member\.isError[\s\S]{0,120}?MEMBER_ROLE_UNAVAILABLE/);
  });

  it('gives the failed read something to press, since nothing retries it', () => {
    // A failure resolves as DATA rather than as a throw, so TanStack Query files
    // it as settled: no retry, no refetch on focus, nothing that recovers on its
    // own. A message that says a thing is temporarily unavailable, on a screen
    // with no way to ask again, is the dead affordance the voice rules exist to
    // prevent — and it is also the path back for an account an administrator has
    // just reactivated.
    const chrome = source(CHROME);

    expect(chrome, 'nothing on screen re-reads the role').toContain('member.refetch()');
    expect(chrome, 'the retry is not offered to the person').toContain("t('shell.retry')");
    // Offered for the ROLE failure only: a refused sign-out already has its
    // retry in the exit itself, re-enabled by the handler's `finally`.
    expect(chrome, 'the retry is offered for a failure it cannot help').toMatch(
      /roleFailure === null \?/,
    );
  });

  it('moves focus to the refusal and clears it on the next destination', () => {
    // TWO defects in one region. `role="alert"` reaches assistive technology on
    // insertion and reaches a sighted phone user not at all — the exit is at the
    // bottom of the viewport and the message renders at the top of the content
    // column, off screen at the moment of the press. And a failure that only
    // cleared on the next attempt followed the person onto every destination for
    // the rest of the session, sitting in front of a later role failure that
    // nothing would then have shown.
    const chrome = source(CHROME);

    expect(chrome, 'the refusal cannot receive focus').toMatch(/tabIndex=\{-1\}/);
    expect(chrome, 'nothing moves focus to the refusal').toMatch(
      /failure !== null[\s\S]{0,80}?\.focus\(\)/,
    );
    expect(chrome, 'a refusal is never cleared by navigating away').toMatch(
      /setFailure\(null\);\s*\n\s*\}, \[pathname\]\)/,
    );
  });

  it('offers both layouts, and exactly one of them at any width', () => {
    // Two layouts, one architecture: bottom tabs below 640px, a sidebar at and
    // above it. Asserted as the PAIR of responsive classes, because either one
    // alone is a chrome that disappears at half the widths the application is
    // used at — and the phone half is the one nobody testing on a laptop meets.
    const chrome = source(CHROME);

    expect(chrome, 'the tab bar is not hidden once the sidebar appears').toContain('sm:hidden');
    expect(chrome, 'the sidebar is not hidden below the breakpoint').toMatch(/hidden[^"]*sm:flex/);
  });

  it('names both navigation landmarks, and clears the phone’s own bottom inset', () => {
    // Accessibility labels are definition-of-done in this project, and two
    // anonymous `<nav>` landmarks are two regions announced as "navigation" with
    // nothing to tell a reader which one they are in. The same name on both is
    // correct rather than lazy: they are mutually exclusive by media query, so
    // only ever one is in the accessibility tree.
    //
    // The inset is the same claim in the physical dimension: the bar is
    // `sticky`, so content scrolls UNDER it, and on a phone with a home
    // indicator the bar itself sits under the system gesture area.
    const chrome = source(CHROME);
    const bars = navBlocks(chrome);

    expect(bars).toHaveLength(2);
    for (const bar of bars) {
      expect(bar, `a navigation landmark carries no name: ${bar}`).toMatch(
        /aria-label=\{t\('shell\.navigation'\)\}/,
      );
    }
    expect(chrome, 'the sticky bar ignores the phone’s bottom inset').toContain(
      'env(safe-area-inset-bottom',
    );
    expect(chrome, 'nothing clears the sticky bar, so content scrolls under it unreachably').toMatch(
      /pb-\[calc\(4rem/,
    );
  });

  it('names the region the collapse controls, and renders that region', () => {
    // `aria-expanded` says a thing opened; `aria-controls` says WHICH thing, and
    // without it a screen-reader user is told something expanded and given no
    // way to reach it. Asserted as a RESOLVING reference, not merely a present
    // attribute — a reference to an absent id is ignored in silence, which is
    // worse than no reference because the source-level lookup passes either way.
    const chrome = source(CHROME);
    const toggle = buttonElements(chrome).find((element) => element.includes('aria-expanded'));

    expect(toggle, 'nothing on the chrome is a disclosure at all').not.toBeUndefined();

    const controls = attributeOf(toggle ?? '', 'aria-controls');

    expect(controls, 'the collapse names no region').not.toBeNull();
    expect(chrome, `no element carries id="${String(controls)}"`).toContain(
      `id="${String(controls)}"`,
    );
    // And its NAME changes with its state. A disclosure whose name reads the
    // same in both directions leaves `aria-expanded` as the only signal —
    // inaudible to anybody not using assistive technology, invisible to
    // everybody else.
    expect(toggle, 'the collapse never announces which state it is in').toContain('aria-expanded=');
    expect(chrome, 'the collapse reads the same in both states').toMatch(
      /expanded \? t\('shell\.menuHide'\) : t\('shell\.menuShow'\)/,
    );
  });

  it('announces the exit as busy rather than renaming it mid-press', () => {
    // The opposite decision to the collapse's, and deliberately: a disclosure
    // has two states and a name that says which one the press produces, while
    // this has one action. A control whose NAME changes under the pointer is a
    // control voice control can no longer be told to press, so the state travels
    // on `aria-busy` and `disabled` instead — which also takes it out of the tab
    // order while the revocation is in flight.
    const exit =
      buttonElements(source(CHROME)).find((element) => element.includes('onClick={startSignOut}')) ??
      '';

    expect(exit, 'nothing on the chrome signs anybody out').not.toBe('');
    expect(exit, 'the in-flight state is not announced').toMatch(/aria-busy=\{[^}]+\}/);
    expect(exit, 'the exit stays live while a revocation is in flight').toMatch(
      /disabled=\{[^}]+\}/,
    );
  });

  it('keeps the icon beside the label rather than in place of it', () => {
    // The icon is DECORATION. Every entry carries its Croatian name at every
    // width, and the glyph is `aria-hidden` so the name is announced once rather
    // than twice — an icon with an accessible name of its own is the shape that
    // reads "Home, Danas" and the shape that survives somebody deleting the
    // label.
    const chrome = source(CHROME);

    expect(chrome, 'the destination icon is exposed to assistive technology').toMatch(
      /<Icon\s+aria-hidden/,
    );
    // The collapsed rail (human decision 2026-09-25) hides the label VISUALLY
    // only: it is still rendered, as screen-reader text and as the `title`.
    expect(chrome, 'the link renders no label beside its icon').toMatch(
      /const name = t\(destination\.key\);[\s\S]*?<span className="[^"]*sr-only">\{name\}<\/span>/,
    );
    expect(chrome, 'the icon is chosen in the component rather than by the typed map').toContain(
      'destinationIcon(destination.key)',
    );
  });

  it('persists nothing about the layout', () => {
    // Human decision, 2026-09-16: collapse resets on every load, matching the
    // theme layer's stance. These are shared devices, and a layout one person
    // chose following the next person into their shift is a setting nobody asked
    // for and nobody can find to undo.
    const chrome = source(CHROME);

    for (const forbidden of ['localStorage', 'sessionStorage', 'document.cookie']) {
      expect(chrome, `the chrome persists its layout through ${forbidden}`).not.toContain(forbidden);
    }
    // The POSITIVE half, pinned to the collapse specifically. A bare
    // `useState(` was satisfied by the failure and in-flight hooks this
    // component would hold anyway, so it asserted nothing about the layout at
    // all — the state could have moved to storage with that line still green.
    expect(chrome, 'the collapse is not component state').toMatch(
      /const \[expanded, setExpanded\] = useState\(/,
    );
  });

  it('renders no outlet of its own', () => {
    // The layout owns the one `<Outlet/>` and the chrome takes it as children. A
    // second one renders the destination twice; a conditional one renders it
    // never, behind a guard that already said yes.
    expect(source(CHROME), 'the chrome renders a second outlet').not.toContain('<Outlet');
    expect(source(CHROME), 'the chrome does not render what the layout hands it').toContain(
      '{children}',
    );
  });
});

describe('the lockup the chrome and the settings surface share', () => {
  /**
   * STORY 1.4c. Until this commit the only place an organization's own logo
   * appeared was the screen where you upload it; the lockup is what puts it in
   * the navigation chrome, on every signed-in screen at every width.
   *
   * ONE COMPONENT, and that is the claim this block opens with. Written twice
   * it would be two answers to "what does an organization with no logo look
   * like" — the fallback, the accessible name, the broken-image path and the
   * accent are four decisions each, and eight decisions in two places is eight
   * opportunities for one copy to be fixed.
   */

  it('is the one place either surface draws a logo or a mark', () => {
    // MUTATION-PROVEN SHAPE. A `<img src={logoUrl}` left behind on the settings
    // surface would render correctly, pass every sweep in this file, and go on
    // being the copy nobody updates when the fallback changes.
    for (const { file, draws } of [
      { file: SETTINGS, draws: SETTINGS_LOGO },
      { file: CHROME, draws: CHROME },
    ]) {
      const screen = source(file);

      expect(source(draws), 'a surface renders the lockup twice or not at all').toContain(
        '<OrganizationLockup',
      );
      expect(screen, 'a surface draws its own image instead of the lockup').not.toContain('<img');
      expect(screen, 'a surface draws its own neutral mark instead of the lockup').not.toContain(
        'role="img"',
      );
    }
  });

  it('renders the logo it has, and a neutral mark carrying the name when it has none', () => {
    // The acceptance criterion, as far as source text can carry it: the mark is
    // conditioned on there being no URL, and BOTH branches name the
    // organization — one as `alt`, one as the mark's accessible name. Neither
    // says anything about an absence, which is the voice rule and also why
    // `hr.json` has no key for one.
    const lockup = source(LOCKUP);

    // ANCHORED ON THE BRANCH ITSELF, not on the expression appearing somewhere.
    // MUTATION-PROVEN GAP: a bare `/logoUrl === null/` is satisfied by
    // `if (logoUrl !== null || logoUrl === null)`, which draws the neutral mark
    // over a logo that loads perfectly — the acceptance criterion inverted, with
    // 314 tests green.
    expect(lockup, 'the mark is not conditioned on there being no URL').toMatch(
      /\bif \(logoUrl === null\) \{/,
    );
    // And the two branches are the two branches: the mark inside it, the image
    // after it. A file that drew both, or neither in the right order, satisfies
    // every `toContain` below on its own.
    const branch = lockup.indexOf('if (logoUrl === null) {');

    expect(lockup.indexOf('role="img"'), 'the mark is not the no-URL branch').toBeGreaterThan(
      branch,
    );
    expect(lockup.indexOf('<img'), 'the image is not the branch with a URL').toBeGreaterThan(
      lockup.indexOf('role="img"'),
    );
    // ONE FALLBACK FOR BOTH BRANCHES, derived once. `alt=""` is how HTML says
    // "this image is decorative", so an organization whose name is blank had a
    // logo a screen reader announced as nothing at all — the `<img>` took the
    // raw name while only the mark fell back. Asserted as one binding rather
    // than as two, because two are two things that can come apart.
    expect(lockup, 'the accessible name is not derived from the name and a fallback').toMatch(
      /const named = mark === null \? t\('organization\.lockup'\) : organization\.name;/,
    );
    expect(lockup, 'the fallback carries no accessible name').toContain('aria-label={named}');
    expect(lockup, 'the logo can render with no alternative text').toContain('alt={named}');
    expect(lockup, 'the image takes the raw name rather than the fallback').not.toContain(
      'alt={organization.name}',
    );
    // A WHOLE CODE POINT, and the helper that takes it is executed in
    // `logo.test.ts`. `slice(0, 1)` splits a surrogate pair and orphans a
    // combining caron, and Croatian diacritic coverage is an explicit
    // requirement of this project.
    expect(lockup, 'the mark is cut out of the name by code unit').not.toContain('.slice(0, 1)');
    expect(lockup, 'the mark is not derived through the tested helper').toContain(
      'organizationLogoMark(organization.name)',
    );
  });

  it('draws a skeleton while the one read is still pending', () => {
    // UX-DR40 asks for a skeleton rather than a spinner, and the reason it
    // belongs on the lockup is layout: without it neither the card nor the bar
    // has a lockup at all until the row arrives and then grows one, moving
    // everything beside it under whatever the pointer was already heading for.
    const lockup = source(LOCKUP);

    expect(lockup, 'the lockup renders no skeleton').toContain('animate-pulse');
    expect(
      lockup,
      'the skeleton is not conditioned on the read being pending, so a settled failure pulses forever',
    ).toMatch(/pending \?[\s\S]{0,120}?animate-pulse/);
  });

  it('takes the accent through the module that bounds where a tint may land', () => {
    // UX-DR5 scopes the tint to the application shell and the logo lockup. The
    // bound is only a bound while both consumers read it from the one module
    // that defines the three slots — a `bg-brand-<key>` written here would be a
    // fifth place the accent lives, unexecutable by `accent.test.ts`, and free
    // to land on something the scope does not admit.
    //
    // SPELLED WITH A PLACEHOLDER rather than with a real key, deliberately:
    // Tailwind's scanner is TEXT-based and reads comments, so a whole class
    // name written in prose anywhere under `apps/web/src` emits that rule into
    // the built sheet — which silently satisfied
    // `test/theme-applied.test.ts`'s loopback guard while the module that is
    // supposed to produce that class had stopped.
    // `accent.test.ts` sweeps for the same mistake across the tree.
    for (const file of [LOCKUP, CHROME]) {
      const screen = source(file);

      expect(screen, 'the accent is not resolved through the curated module').toContain(
        'brandAccentAppearance(',
      );
      expect(screen, 'a brand accent class is written by hand').not.toMatch(
        /(?:bg|text|border)-brand-/,
      );
    }
  });

  it('is not a control, and holds no handler that would make it one', () => {
    // `expectedFields: 0` and `expectedButtons: 0` above say nothing was
    // COUNTED; this says nothing is there. The lockup is 32 px in the phone
    // bar, which is only defensible while it is not pressable — an `onClick` here would put a target 12 px
    // under UX-DR40's floor on every signed-in screen in the application.
    const lockup = source(LOCKUP);

    for (const forbidden of ['onClick', '<Button', '<Link', 'href', 'navigate(']) {
      expect(lockup, `the lockup carries ${forbidden}, which makes it a control`).not.toContain(
        forbidden,
      );
    }
  });
});

describe('the lockup is rendered once, in the sidebar, and never inside a landmark', () => {
  /**
   * Story 7.3 took the lockup off the phone bar: the five cells need the whole
   * width, and the *Više* sheet names the organization in words beside the
   * person. What stays is the 1.4c rule that branding is not a destination, so
   * it never sits inside a navigation landmark, and the rule that it is ONE
   * element, so its fallback, its name and its accent cannot drift.
   */
  /**
   * The phone layout's sticky container: a `<div>` around the `<nav>`, which
   * stays its direct child (the calendar's layout test finds the bar as the
   * landmark's sticky parent). Non-greedy to its own closing tag, which is
   * correct while it holds no nested `<div>`; the consumers assert what is
   * inside it, so the day one arrives fails loudly rather than silently
   * widening.
   */
  const phoneBar = (chrome: string): string =>
    /<div\s+className=\{`sticky[\s\S]*?<\/div>/.exec(chrome)?.[0] ?? '';

  it('renders the lockup once, into the sidebar and not the phone bar', () => {
    const chrome = source(CHROME);
    const aside = /<aside\b[\s\S]*?<\/aside>/.exec(chrome)?.[0] ?? '';
    const bar = phoneBar(chrome);

    expect(aside, 'no <aside> to read').not.toBe('');
    expect(bar, 'no phone bar to read').not.toBe('');

    expect(
      [...chrome.matchAll(/<OrganizationLockup\b/g)],
      'the chrome builds more than one lockup',
    ).toHaveLength(1);
    expect(aside, 'the sidebar renders no lockup').toContain('{renderLockup()}');
    expect(bar, 'the phone bar still renders the lockup').not.toContain('renderLockup(');
    // The `<nav>` is the bar's FIRST child: nothing sits beside the cells.
    expect(bar, 'the phone bar holds something before its landmark').toMatch(
      /^<div\s+className=\{`sticky[^`]*`\}\s*>\s*<nav\b/,
    );
  });

  it('keeps the lockup out of both navigation landmarks', () => {
    // BRANDING IS NOT A DESTINATION (1.4c review).
    const chrome = source(CHROME);
    const bars = navBlocks(chrome);

    expect(bars, 'the chrome does not render exactly two navigation bars').toHaveLength(2);
    for (const bar of bars) {
      expect(bar, `a navigation landmark carries the lockup: ${bar}`).not.toMatch(/lockup|Lockup/);
      // And the links are still INSIDE each landmark, which is the half this
      // could otherwise break by moving everything out.
      expect(bar, `a navigation bar renders no links: ${bar}`).toMatch(/\{destinations\}|\{tabs\}/);
    }
  });

  it('tints the shell chrome itself, in both layouts', () => {
    // THE OTHER HALF OF UX-DR5: the accent reaches the lockup AND the shell
    // chrome. Both edges, because either one alone is an application tinted at
    // exactly the widths the person testing it happened to use.
    const chrome = source(CHROME);
    const aside = /<aside\b[^>]*>/.exec(chrome)?.[0] ?? '';

    expect(aside, 'the sidebar edge carries no accent').toContain('${accent.edge}');
    expect(phoneBar(chrome), 'the phone bar edge carries no accent').toContain('${accent.edge}');
    expect(chrome, 'the accent is not resolved through the curated module').toContain(
      'brandAccentAppearance(',
    );
  });

  it('reads the organization under the one key the settings surface uses', () => {
    // AD-13 forbids two figures on a screen coming from two READS, not a second
    // consumer of one key. `ORGANIZATION_SNAPSHOT_KEY` is a single constant over
    // the one `QueryClient` `main.tsx` builds, so the chrome and `/organizacija`
    // share a cache entry; two keys — or an inline `['organization']` written by
    // hand here — would be the violation this asserts against.
    const chrome = source(CHROME);

    expect(chrome, 'the chrome does not read the organization through the one factory').toMatch(
      /useQuery\(\s*organizationSnapshotQueryOptions\(/,
    );
    expect(chrome, 'the chrome spells the key out beside the factory').not.toContain('queryKey: ORGANIZATION_SNAPSHOT_KEY');
    expect(chrome, 'the chrome spells the snapshot key by hand').not.toContain("['organization']");
    expect(chrome, 'the chrome fetches the signed URL itself').toContain('useRenderableLogo(');
  });

  it('bounds the read it performs on every signed-in screen', () => {
    // THE COST OF READING EVERYWHERE. The settings surface's copy of this read
    // is a screen somebody opens deliberately; this one mounts on every
    // destination, so unbounded it refetches the row on every navigation and
    // every window focus — for a border colour and a logo — and retries a
    // transport fault three times before settling.
    //
    // THE BOUND IS THE FACTORY'S (`organizationSnapshotQueryOptions`, whose
    // retry and stale bound `snapshot.test.ts` executes): the chrome reads
    // through it and overrides neither, so no mount order picks another policy.
    const chrome = source(CHROME);
    const read = /const organizationRead = useQuery\([\s\S]*?\n {2}\);/.exec(chrome)?.[0] ?? '';

    expect(read, 'no organization query to read').not.toBe('');
    expect(read, 'the chrome does not read through the factory').toContain('organizationSnapshotQueryOptions(');
    expect(read, 'the chrome overrides the factory\'s policy').not.toMatch(/retry:|staleTime:|queryFn:/);
  });

  it('keeps an unreadable organization out of the message region, but not out of the log', () => {
    // The story's matrix: navigation still renders, the lockup falls back, and
    // the failure is REPORTED — to the console, where somebody can diagnose it,
    // and not to the one `role="alert"` region. That region carries the two
    // refusals a person can act on, and a third message about branding they
    // cannot change would compete with them to be announced.
    //
    // The logging is in the query FUNCTION rather than beside an element, which
    // is what makes "reported once, not per layout" true: the lockup renders
    // into two bars, so a `console.error` at the call site fires twice at every
    // width where both are in the tree. It is the FACTORY'S query function
    // now, executed in `snapshot.test.ts`, so it logs whichever consumer
    // mounted first.
    const chrome = source(CHROME);

    expect(chrome, 'the chrome does not read through the logging factory').toContain('organizationSnapshotQueryOptions(');
    expect(chrome, 'the chrome logs beside an element').not.toMatch(/console\.error\(ORGANIZATION_UNAVAILABLE/);
    expect(
      chrome,
      'the organization read feeds the alert region, which is about the role and the exit',
    ).not.toMatch(/organizationMessageKey\(/);
  });
});
