import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { MEMBERS_LIST_KEY } from '@/members/list';
import { DESTINATIONS } from '@/navigation/destinations';

/**
 * The sign-in path's screens, asserted at source level (story 1.1d, extended by
 * story 1.3b).
 *
 * AD-15 bans jsdom and `apps/web/vitest.config.ts` collects `src/**\/*.test.ts`
 * only, so a `.tsx` test here would be silently NOT COLLECTED — green, and
 * asserting nothing. That rules out rendering the screen, which means the
 * properties worth guarding have to be read off the source instead:
 *
 *   - every user-facing string reaches `t()`. `eslint.config.js`'s L2 block is
 *     the merge gate and it fires on JSX shapes; this is the complementary
 *     claim, that the only string literals left in the file sit on structural
 *     attributes nobody reads.
 *   - the keys used and the keys declared are the same set, in both
 *     directions. A typo is a `tsc` error (`CustomTypeOptions` types keys off
 *     `hr.json`), but a key declared and never rendered is not — and an
 *     unrendered string is a string nobody reviewed.
 *   - 44 px tap targets. MUTATION-PROVEN GAP: deleting all four
 *     `className="h-11"` reverted every control on the one screen nobody can
 *     skip to the inherited 36 px, with 900 tests green.
 *   - the boundary the theme layer raised is the boundary the control draws.
 *     MUTATION-PROVEN GAP too: `border-input` → `border-border` in `input.tsx`
 *     left `--input`'s measured 3.23:1 true of a token nothing consumed.
 *   - both fields carry an accessible name, and the reset guidance is bound to
 *     the password field. `htmlFor`/`id` is the only thing that ties a
 *     `<Label>` to its `<Input>`, and getting it wrong leaves a screen reader
 *     announcing "edit text, blank" on a password field.
 *   - the screen REACHES the authentication seam. This was the inverse claim
 *     until story 1.3b — the screen was inert, and the block asserted it named
 *     no `supabase`, no `fetch(`, no `useState`, no `localStorage`. That is now
 *     false of a screen that signs people in, so the block is narrowed to the
 *     new truth rather than deleted: the handler is real, it goes through the
 *     `@/supabase` modules rather than assembling a request inline, and it
 *     still stops the browser's own submission.
 *   - `destructive` appears nowhere. UX-DR4 reserves it exclusively for an
 *     unresolved conflict, and a refused sign-in is not one — it is the error
 *     surface this story ships, and it may not use it.
 *
 * Every read is lazy and every detector is self-tested on synthetic sources at
 * the bottom, the idiom `packages/domain/test/purity.test.ts` established: a
 * regex that stopped matching would make each sweep pass having proved nothing.
 */

const srcRoot = fileURLToPath(new URL('..', import.meta.url));
const SCREEN = join(srcRoot, 'routes', 'prijava.tsx');
const NOT_FOUND = join(srcRoot, 'routes', 'not-found.tsx');
const ORGANIZATION = join(srcRoot, 'routes', 'prijava-organizacija.tsx');
// `routes/index.tsx` IS NOT A SCREEN and is swept by nothing here: `/` forwards
// a signed-in visitor to the first destination and renders nothing, so the file
// carries no JSX and no key for any sweep below to read.
// `test/localization-applied.test.ts` still lists it, which is about build
// FRESHNESS rather than strings.
const LAYOUT = join(srcRoot, 'routes', '_app.tsx');
const INPUT_PRIMITIVE = join(srcRoot, 'components', 'ui', 'input.tsx');
const RESOURCE = join(srcRoot, 'i18n', 'locales', 'hr.json');
/** Story 1.4a's settings surface: the first destination that is not a placeholder. */
const SETTINGS = join(srcRoot, 'routes', 'organizacija.tsx');

/** Story 1.5a's member list: the second, and the first that renders a table. */
const MEMBER_LIST = join(srcRoot, 'routes', 'ljudi.tsx');

/**
 * The member list's rules, as a `.ts` module that renders nothing.
 *
 * It declares keys in TWO shapes — three `\w*MessageKey` return-type unions and
 * a column table whose entries carry a heading key each — and both are keys this
 * application can put on screen, so both have to be read or the set comparison
 * below is weaker by eleven. It is the first entry here whose reader is neither
 * `translationKeys` nor `messageKeyUnion`, for that reason.
 */
const MEMBER_LIST_KEYS = join(srcRoot, 'members', 'list.ts');

/**
 * Story 1.5b's two member forms, and the module that holds every rule they
 * apply.
 *
 * NEITHER SCREEN IS A DESTINATION. `/ljudi/novi` and `/ljudi/$id` are reached
 * from the member list rather than from the navigation, so neither appears in
 * `@/navigation/destinations` and neither is covered by the destination table
 * below — which is precisely why they are named here by hand: a `.tsx` that
 * renders and is absent from `SCREENS` is swept by nothing at all.
 */
const MEMBER_CREATE = join(srcRoot, 'routes', 'ljudi.novi.tsx');
const MEMBER_EDIT = join(srcRoot, 'routes', 'ljudi.$id.tsx');

/**
 * Story 1.7a's two team screens and the two modules holding their rules. Like
 * the member forms, neither screen is a destination, so they are named here by
 * hand: a `.tsx` absent from `SCREENS` is swept by nothing.
 */
const TEAM_LIST = join(srcRoot, 'routes', 'ljudi.smjene.tsx');
const TEAM_EDIT = join(srcRoot, 'routes', 'ljudi.smjene.$id.tsx');
const TEAM_LIST_KEYS = join(srcRoot, 'teams', 'list.ts');
const TEAM_WRITE_KEYS = join(srcRoot, 'teams', 'write.ts');

/**
 * Story 1.8's roster screen, the Danas destination it is reached from, and the
 * module holding both surfaces' rules. The roster is not a destination, so it
 * is named here by hand; Danas left the placeholders in the same commit.
 */
const TEAM_ROSTER = join(srcRoot, 'routes', 'smjene.$id.tsx');
const DANAS = join(srcRoot, 'routes', 'danas.tsx');
const TEAM_ROSTER_KEYS = join(srcRoot, 'teams', 'roster.ts');

/**
 * Story 2.1b's two hour band screens and the two modules holding their rules.
 * Neither screen is a destination — both are reached from `Organizacija` — so
 * they are named here by hand, as the team screens are.
 */
const HOUR_BAND_LIST = join(srcRoot, 'routes', 'organizacija.satni-pojasi.tsx');
const HOUR_BAND_EDIT = join(srcRoot, 'routes', 'organizacija.satni-pojasi.$id.tsx');
const HOUR_BAND_LIST_KEYS = join(srcRoot, 'hour-bands', 'list.ts');
const HOUR_BAND_WRITE_KEYS = join(srcRoot, 'hour-bands', 'write.ts');

/**
 * The member write path's rules, as a `.ts` module that renders nothing.
 *
 * THE THIRD NEW KEY SOURCE, and it has to be its own entry rather than folded
 * into either screen: the failure-to-message union cannot live in a `.tsx`,
 * because nothing executes one (AD-15) and swapping two branches of it would
 * report a taken username as a service outage with the whole suite green. It
 * declares its keys in TWO shapes — the `\w*MessageKey` return union, and the
 * one named constant holding the partial-save sentence that is rendered BESIDE
 * a reason rather than instead of one.
 *
 * `wire.ts` AND NOT `write.ts`, and the difference is load-bearing rather than
 * organizational: the mapping has to be importable by
 * `test/admin-auth-boundary.test.ts`, which is the one file that can reach both
 * trees and therefore the only place the FUNCTION's SQLSTATE mapping and this
 * one can be held to the same answer. `write.ts` reaches
 * `@supabase/supabase-js` transitively and pnpm's isolated linker means the
 * root project cannot resolve it, so a mapping written there is a mapping
 * nothing can bind — and the two paths' fall-throughs were opposites for
 * exactly that long. `write.ts` re-exports every name.
 */
const MEMBER_WRITE_KEYS = join(srcRoot, 'members', 'wire.ts');
/**
 * The navigation chrome, part B: a `.tsx` that is not a route at all.
 *
 * It is swept by everything in this file anyway, and that is the point rather
 * than an accident of where it sits. Every claim below — no bare text, no
 * unsanctioned literal, a 44 px floor on every control, no `destructive` — is a
 * property of a file that RENDERS, not of a file that is registered as a route.
 * The chrome renders on every one of the eight destinations, so a literal
 * smuggled in here reaches more screens than one in any route module could.
 */
const CHROME = join(srcRoot, 'navigation', 'chrome.tsx');

/**
 * The organization lockup (story 1.4c): the second `.tsx` here that is not a
 * route, and the first that renders on two surfaces at once.
 *
 * It is swept by everything in this file for the reason the chrome is — every
 * claim below is a property of a file that RENDERS — and the reach is wider
 * still: the lockup is drawn by the chrome, which is drawn above all eight
 * destinations, AND by the settings surface. A literal smuggled in here reaches
 * every signed-in screen in the application.
 */
const LOCKUP = join(srcRoot, 'organization', 'lockup.tsx');

/**
 * The sign-in steps' shared frame (visual refresh A): the brand panel both
 * sign-in screens render around their card. Not a route, and swept anyway for
 * the reason the chrome and the lockup are — it renders strings.
 */
const AUTH_LAYOUT = join(srcRoot, 'components', 'auth-layout.tsx');

/** The curated accent set as data, and the fourth `\w*MessageKey` module. */
const ACCENT_KEYS = join(srcRoot, 'organization', 'accent.ts');

/**
 * The one signed-URL read behind every lockup.
 *
 * It exists because the settings surface and the chrome had a copy each: two
 * `queryFn`s registered for ONE query key, so whichever mounted first owned the
 * fetch and the other's cache bound and retry policy were dead code that read
 * as live. Every claim about how the logo URL is fetched is made against this
 * file now, and against the two surfaces only that they route through it.
 */
const LOGO_URL = join(srcRoot, 'organization', 'logo-url.ts');

/**
 * The seven titled placeholders still standing after story 1.4a.
 *
 * EIGHT UNTIL THIS COMMIT. `/organizacija` is a real screen now — a form with
 * five fields, two buttons and a refusal message — so it is named separately
 * below rather than inheriting the placeholder's counts, which are what make
 * these entries tight: exactly one string, exactly zero controls. Leaving it in
 * this list would have meant loosening those counts for all eight, which is the
 * shape that lets the next destination grow a control nobody reviewed.
 *
 * The split is CROSS-CHECKED against the destination table below, so a
 * destination can be in neither list only by failing a test.
 *
 * They are screens by this file's definition — a `.tsx` that renders a string —
 * so they join every sweep below rather than a subset chosen by hand. Each
 * renders exactly one `nav.*` heading and nothing else, which is what makes the
 * counts in `SCREENS` and `KEY_SOURCES` the tight numbers they are: a control
 * added to any of them, or a second string, fails here until somebody says why.
 *
 * Derived from the slug list rather than written out eight times, because the
 * three facts per entry are the same three facts and a hand-copied block is
 * where the ninth destination gets added to one list and not the other.
 *
 * The slug list is itself a hand-copied fourth copy of the eight — after the
 * router, the destination table and `hr.json` — so it is CROSS-CHECKED against
 * the table below rather than trusted. Without that, a ninth destination added
 * everywhere but here would silently escape the control count, the tap-target
 * floor, the literal sweeps and the per-file key count, all of which read only
 * what this list names. `router.test.ts` pins the same table against the
 * registered router, so the four copies are held together end to end.
 */
const PLACEHOLDER_SLUGS = [
  'kalendar',
  'sati',
  'godisnji',
  'raspored',
  'postavke-rotacije',
];

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
const BUILT_SLUGS = ['organizacija', 'ljudi', 'danas'];

/** Every registered destination, however much of it is built. */
const DESTINATION_SLUGS = [...PLACEHOLDER_SLUGS, ...BUILT_SLUGS];

const DESTINATION_SCREENS = PLACEHOLDER_SLUGS.map((slug) => ({
  name: `the ${slug} destination`,
  file: join(srcRoot, 'routes', `${slug}.tsx`),
}));

/**
 * Every screen that renders a string, so each sweep runs over all of them.
 *
 * A `.tsx` carrying a string and missing from this list is swept by NOTHING —
 * the ESLint block is the only other guard, and it cannot see a key that is
 * declared and never rendered, a literal on an unguarded attribute, or a
 * control below the tap-target floor. A route module that renders nothing is
 * the one thing that does not belong: `/` is redirect-only, so listing it would
 * assert zero strings and zero controls on a file that cannot have either.
 *
 * The length of the list is asserted where the sweeps begin, because `it.each`
 * over a shortened list is a quieter pass than a failing assertion.
 */
const SCREENS = [
  // `expectedControls` is what stops the general tap-target sweep passing on an
  // empty set: two of these screens carry no control at all today, so a loop
  // with no count behind it read as coverage while asserting nothing on half
  // its cases. A screen that gains a control fails here until the number moves,
  // which is the moment somebody confirms the new control is measured.
  { name: 'the sign-in screen', file: SCREEN, expectedControls: 3 },
  { name: 'the not-found component', file: NOT_FOUND, expectedControls: 1 },
  { name: 'the organization prompt', file: ORGANIZATION, expectedControls: 2 },
  // EIGHT, and it was seven until story 1.4b: the settings surface carries five
  // fields — name, type, timezone and the leave year's month and day — plus a
  // save, a cancel, and now the logo's choose action. The number is what notices
  // a sixth FIELD, which on this screen is how the slug or the locale would
  // arrive: both are ordinary-looking controls and both are forbidden for
  // reasons that are invisible in a diff.
  //
  // The file input itself is a bare `<input type="file" className="sr-only">`
  // and so is counted by neither detector, which is deliberate rather than a
  // gap: what a pointer meets is the `<Button>`, that is what has to clear the
  // 44 px floor, and a native file input renders its own chrome in the
  // BROWSER's language — the one string on this screen that could never come
  // from `hr.json`. Its accessible name and its label binding are asserted by
  // name in the settings block below, since the general sweeps cannot see it.
  // NINE SINCE STORY 1.4c: the accent `<select>` joined the eight. It is counted
  // by the general sweep rather than only by its own block, because a control
  // type known to one screen and to nothing else escapes the tap-target floor
  // everywhere else — which is the state `<Link>` was in until the chrome
  // brought it in.
  //
  // TEN SINCE STORY 2.1b: a `<Button asChild>` link to the hour band editor,
  // reached from here rather than from the navigation.
  { name: 'the organization settings surface', file: SETTINGS, expectedControls: 10 },
  // THREE on the member list, and the count is what keeps a fourth from
  // arriving unreviewed: the search field, the permission-level filter, and ONE
  // `<Button>` — the sort control, written once inside a map over
  // `MEMBER_COLUMNS` rather than four times, which is the same property that
  // makes a fifth column one edit. A second `<Button` in this file means a row
  // action has appeared, and row actions are the deferred half of story 1.5
  // (`admin-auth` still answers 501).
  // FIVE SINCE STORY 1.5b, up from three, and the two that arrived are both
  // `<Button asChild>` wrapping a `<Link>`: the add action beside the heading,
  // and one row action written once inside the map over the rows. They are
  // links rather than buttons because issuing and editing an account are
  // SCREENS — middle-click and "open in new tab" work the way they do
  // everywhere else — and `asChild` is what puts the 44 px floor on the anchor
  // itself rather than on a wrapper a pointer never meets.
  //
  // The number still notices a fourth: this screen writes nothing, so a
  // `<Button>` here that is not a link is a write arriving on the list.
  //
  // SIX SINCE STORY 1.7a: a second `<Button asChild>` link beside the add
  // action, to the teams screen. Still a link, still no write on this list.
  //
  // EIGHT SINCE THE TEAM FILTER: the team `<select>` beside the level one, and
  // the reset `<Button>`, which is the one non-link button here and still
  // writes nothing — it only returns the three filters to their defaults.
  { name: 'the member list', file: MEMBER_LIST, expectedControls: 8 },
  // EIGHT on the create form: four `<Input>`s — name, username, address,
  // allowance — the level `<select>`, and three `<Button>`s, which are Save,
  // Cancel and the link back to the list. The count is what notices a SIXTH
  // FIELD, which on these screens is how `organization_id` or an active flag
  // would arrive: both look like ordinary controls and both are forbidden for
  // reasons invisible in a diff — the first is pinned by the update policy on
  // both sides (`0003:331-351`) and the second is story 1.6's.
  { name: 'the member create form', file: MEMBER_CREATE, expectedControls: 8 },
  // TWELVE on the edit form: the same eight, plus the admin-issued reset's
  // FOUR `<Button>`s — the offer, the confirm and cancel that replace it, and
  // the dismiss on the shown credential. Four and not one, because the reset is
  // a two-step confirmation whose panel has to be closable: a single control
  // here would mean one press replaces somebody's credential, and a panel with
  // no dismiss blocks every later reset on the one account with no other
  // recovery route. The FIELD count is unchanged, which is the half this number
  // still guards.
  //
  // SIXTEEN SINCE STORY 1.6: the status block's date `<Input>`, its offer, and
  // the confirm and cancel that replace the offer — the same two-step shape the
  // reset has, because one press must not end somebody's access.
  //
  // TWENTY-ONE SINCE STORY 1.7b: the team block's `<select>` and date
  // `<Input>`, its offer, and the confirm and cancel that replace the offer —
  // the status block's shape, because one press must not move somebody.
  { name: 'the member edit form', file: MEMBER_EDIT, expectedControls: 21 },
  // STORY 1.7a. FOUR on the team list: the link back to `Ljudi`, the one name
  // `<Input>`, the add `<Button>`, and ONE row link written once inside the map
  // over the teams — the same count at zero teams as at nine. SIX on one team:
  // the name `<Input>`, Save, the archive offer, the confirm and cancel that
  // replace it, and the link back. No delete control exists on either, which is
  // what the counts keep true.
  { name: 'the team list', file: TEAM_LIST, expectedControls: 4 },
  { name: 'the team edit form', file: TEAM_EDIT, expectedControls: 6 },
  // STORY 1.8. ONE on the roster: the link back to Danas, a `<Button asChild>`.
  // No field, no form and no write — the count is what notices one arriving.
  // ZERO on Danas: its one new control is the `<Link>` to the roster, which
  // neither detector matches by construction and the link sweep measures.
  { name: 'the team roster', file: TEAM_ROSTER, expectedControls: 1 },
  { name: 'the Danas destination', file: DANAS, expectedControls: 0 },
  // STORY 2.1b. FIVE on the band list: the link back to `Organizacija`, the
  // name `<Input>`, the start `<Input type="time">`, the add `<Button>`, and ONE
  // row link written once inside the map over the bands — the same count at
  // zero bands as at twelve. Only a name and a start: no window, duration or
  // midnight control exists, which is what the count keeps true. SEVEN on one
  // band: the two fields, Save, the removal offer, the confirm and cancel that
  // replace it, and the link back.
  { name: 'the hour band list', file: HOUR_BAND_LIST, expectedControls: 5 },
  { name: 'the hour band edit form', file: HOUR_BAND_EDIT, expectedControls: 7 },
  // ZERO on all seven, and asserted rather than assumed: a destination is a
  // heading and nothing else in this story, so the first control any of them
  // grows is a later story's work arriving without that story's review. The
  // count is also what keeps the tap-target sweep from reading as coverage on
  // eight screens it finds nothing to measure.
  ...DESTINATION_SCREENS.map((destination) => ({ ...destination, expectedControls: 0 })),
  // The layout renders no string of its own, and is swept anyway: it is a
  // `.tsx` under `routes/`, so the literal, bare-text and `destructive` sweeps
  // all apply to it, and being outside this list is exactly how a file becomes
  // guarded by nothing. Its own `<Outlet />` claim is asserted separately
  // below, because no sweep here can see a component that renders the wrong
  // thing.
  //
  // STILL ZERO, and that is a claim rather than a leftover: the layout wraps the
  // chrome around the outlet and owns no control of its own. Every control the
  // signed-in application offers lives in the entry below, which is where the
  // count moved to — the layout gaining one would mean the chrome had started
  // leaking back into the route module the guard lives in.
  { name: 'the signed-in layout', file: LAYOUT, expectedControls: 0 },
  // THREE on the chrome: the sidebar's collapse, the exit, and the retry that
  // makes the role read's failure something a person can act on. The
  // destinations are `<Link>`s, which neither detector matches by construction —
  // they are swept by name in the chrome block below, with their own count — so
  // this number is the three BUTTONS and nothing else. It is what notices a
  // fourth arriving: on a component that renders above every destination in the
  // application, a control nobody reviewed is a control on eight screens.
  { name: 'the navigation chrome', file: CHROME, expectedControls: 3 },
  // ZERO on the lockup, and it is a claim rather than an accident of what has
  // been built: nothing about an organization's logo is pressable. It is not a
  // link to the organization, not a menu trigger and not a home button — which
  // is also why it is exempt from UX-DR40's 44 px floor and may be 32 px inside
  // the phone bar, where nine real targets already compete for the width. The
  // first handler added here would make it a control nobody measured.
  { name: 'the organization lockup', file: LOCKUP, expectedControls: 0 },
  // ZERO on the sign-in frame (visual refresh A): the brand panel is a product
  // name, a headline and a subline. A control here would be a sign-in
  // affordance outside the two frozen forms.
  { name: 'the sign-in frame', file: AUTH_LAYOUT, expectedControls: 0 },
];

/**
 * The screens that own a form, an uncontrolled field and a submit handler.
 *
 * Named separately because the wiring sweeps below apply to exactly these and
 * are meaningless on the other two — and because running them over `SCREEN`
 * alone is how the organization prompt shipped with the identical shape and
 * none of the coverage. The missing-`ref` mutation that reached a browser was
 * caught on one screen and stayed live on the other.
 */
const FORM_SCREENS = [
  // `inFlight` is the name of the ref that guards a second concurrent submit,
  // or `null` for a screen that starts nothing to be in flight. It is carried
  // per entry for the same reason `effect` is: the in-flight sweeps were pinned
  // to the sign-in screen by name — `exchanging.current` written out as a
  // literal — so deleting `setPending(false)` from the settings surface's
  // `finally` left the whole suite green while the identically shaped sign-in
  // screen was protected against exactly that.
  { name: 'the sign-in screen', file: SCREEN, effect: 'signIn(', inFlight: 'exchanging' },
  // The prompt awaits nothing and holds no failure state — it validates what was
  // typed and navigates — so there is no in-flight flag to clear and no refusal
  // to surface. `null` rather than a name, and the derived list below asserts it
  // is not empty, so "every screen opted out" cannot read as coverage.
  {
    name: 'the organization prompt',
    file: ORGANIZATION,
    effect: 'organizationDestination(',
    inFlight: null,
  },
  // Story 1.4a. The settings surface is the third screen with a form, and it is
  // the one with the most to lose from getting the uncontrolled-ref shape wrong:
  // five fields rather than two, so a refusal that re-rendered them away would
  // discard five entered values instead of a password.
  {
    name: 'the organization settings surface',
    file: SETTINGS,
    effect: 'updateOrganization(',
    inFlight: 'saving',
  },
  // Story 1.5b's two. Both await a write and both hold a refusal, so every
  // sweep below applies — and applying them is the point rather than a bonus:
  // the settings surface only gained the in-flight coverage when a second
  // screen with the identical shape shipped without it, and these are the
  // third and fourth.
  //
  // `issuing` rather than `saving` on the create screen, because the two verbs
  // are different: one writes over a row and the other brings an account into
  // existence. The name is carried per entry, so neither sweep can be pinned
  // to one file's spelling.
  {
    name: 'the member create form',
    file: MEMBER_CREATE,
    effect: 'createMember(',
    inFlight: 'issuing',
  },
  { name: 'the member edit form', file: MEMBER_EDIT, effect: 'saveMember(', inFlight: 'saving' },
  // Story 1.7a's two. `creating` on the list, which brings a team into
  // existence, and `writing` on one team, shared by its rename and its archive
  // because the two must never run at once on the same row.
  { name: 'the team list', file: TEAM_LIST, effect: 'createTeam(', inFlight: 'creating' },
  { name: 'the team edit form', file: TEAM_EDIT, effect: 'renameTeam(', inFlight: 'writing' },
  // Story 2.1b's two, on the team screens' terms: `creating` on the list, and
  // `writing` on one band, shared by its save and its removal.
  {
    name: 'the hour band list',
    file: HOUR_BAND_LIST,
    effect: 'createHourBand(',
    inFlight: 'creating',
  },
  {
    name: 'the hour band edit form',
    file: HOUR_BAND_EDIT,
    effect: 'updateHourBand(',
    inFlight: 'writing',
  },
];

/** The form screens that await something, so something can be in flight. */
const IN_FLIGHT_SCREENS = FORM_SCREENS.filter(
  (screen): screen is typeof screen & { inFlight: string } => screen.inFlight !== null,
);

/**
 * Every AWAITING HANDLER in the application, rather than every screen that owns
 * one — and the distinction is the finding this closes.
 *
 * `submitHandler`, `finallyBlock` and the ref-guard sweep were all pinned to
 * the FIRST match in a file: `function submit(`, the first `finally`, the first
 * `if (…) return;`. That was exactly right while every screen held one awaiting
 * handler, and it went blind the moment one held two — the edit form's password
 * reset awaits, holds its own in-flight ref and its own refused branch, and not
 * one of the three sweeps could see any of it. Deleting `setResetPending(false)`
 * from the reset's `finally` would have left the whole suite green with the
 * confirmation stuck busy for ever on the one surface that can recover an
 * account with no email address.
 *
 * So the sweeps below are driven by HANDLER, each one extracted by name, and a
 * screen contributes as many entries as it has handlers that await.
 */
const IN_FLIGHT_HANDLERS = [
  ...IN_FLIGHT_SCREENS.map((screen) => ({
    ...screen,
    handler: 'submit',
    pending: 'setPending',
    failure: 'setFailure',
  })),
  {
    // THE SECOND AWAITING HANDLER ON THE EDIT FORM. Its flags are its own on
    // purpose: sharing `saving` with the form would make a reset in flight
    // disable Save and the other way round — two unrelated actions blocking
    // each other, neither of which the person asked for.
    name: "the member edit form's password reset",
    file: MEMBER_EDIT,
    effect: 'resetPassword(',
    inFlight: 'resetting',
    handler: 'issue',
    pending: 'setResetPending',
    failure: 'setFailure',
  },
  {
    // STORY 1.6, THE THIRD AWAITING HANDLER ON THE EDIT FORM, with its own
    // flags for the reason the reset has its own.
    name: "the member edit form's status change",
    file: MEMBER_EDIT,
    effect: 'changeMemberStatus(',
    inFlight: 'statusing',
    handler: 'changeStatus',
    pending: 'setStatusPending',
    // ITS OWN REFUSAL STATE, so the date control is described by the status
    // block's alert and never by an unrelated error on the form.
    failure: 'setStatusFailure',
  },
  {
    // STORY 1.7b, THE FOURTH AWAITING HANDLER ON THE EDIT FORM: the team
    // change, with its own flags for the reason the status change has its own.
    // Offered on the caller's own row too, so it must never share a ref with
    // the status block.
    name: "the member edit form's team change",
    file: MEMBER_EDIT,
    effect: 'changeMemberTeam(',
    inFlight: 'teaming',
    handler: 'changeTeam',
    pending: 'setTeamPending',
    failure: 'setTeamFailure',
  },
  {
    // STORY 1.7a, the team edit form's second awaiting handler. It shares the
    // rename's `writing` ref on purpose: a rename and an archive of one team
    // in flight together would race on the same row.
    name: "the team edit form's archive",
    file: TEAM_EDIT,
    effect: 'archiveTeam(',
    inFlight: 'writing',
    handler: 'archive',
    pending: 'setPending',
    // ITS OWN REFUSAL STATE, announced inside the archive block, so a refused
    // archive never marks the name field invalid.
    failure: 'setArchiveFailure',
  },
  {
    // STORY 2.1b, the band edit form's second awaiting handler, sharing the
    // save's `writing` ref for the reason the team archive does.
    name: "the hour band edit form's removal",
    file: HOUR_BAND_EDIT,
    effect: 'removeHourBand(',
    inFlight: 'writing',
    handler: 'remove',
    pending: 'setPending',
    // ITS OWN REFUSAL STATE, announced inside the removal block.
    failure: 'setRemoveFailure',
  },
];

/**
 * A `.ts` module that renders no JSX but holds `t()` keys.
 *
 * `signInMessageKey` moved the two refusal keys out of the screen and into
 * `@/supabase/sign-in`, where a node test can EXECUTE the pairing — swapping
 * the branches of the ternary it replaced passed every assertion in this file.
 * The keys have to stay in scope for the set comparison below, or every key
 * this application renders would no longer equal every key it declares.
 */
const MESSAGE_KEYS = join(srcRoot, 'supabase', 'sign-in.ts');

/** The same shape, for story 1.4a's four organization failures. */
const ORGANIZATION_MESSAGE_KEYS = join(srcRoot, 'organization', 'messages.ts');

/** The same shape again, for the chrome's role and sign-out failures. */
const NAVIGATION_MESSAGE_KEYS = join(srcRoot, 'navigation', 'messages.ts');

/** UX-DR40's tap-target floor, in CSS pixels. */
const TARGET_FLOOR_PX = 44;
/** Tailwind's spacing scale: `h-11` is 11 × 0.25rem at a 16px root. */
const SPACING_STEP_PX = 4;
const ROOT_FONT_PX = 16;

const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
/** `//` to end of line. The leading class keeps `https://` inside a string
 *  intact — the two-pass idiom from `test/key-hygiene.test.ts`. */
const LINE_SLASH = /(^|[\s;,{}()[\]])\/\/[^\n]*/g;

/**
 * Comment-blind source, and load-bearing here rather than merely tidy: the
 * screen's own header explains why `destructive` is absent and quotes the
 * Croatian copy, both of which a comment-aware scan would report as offences.
 */
function stripComments(source: string): string {
  return source.replace(BLOCK_COMMENT, '').replace(LINE_SLASH, '$1');
}

function source(file: string): string {
  return stripComments(readFileSync(file, 'utf8'));
}

/** How many times a needle appears. The counting idiom
 *  `organization/snapshot.test.ts` uses for its one-read assertions. */
function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** A call of `name`, spelled so this file never contains the call it forbids. */
function callOf(name: string): string {
  return `${name}(`;
}

/**
 * A screen's `submit` handler, from its signature to its closing brace.
 *
 * SCOPED extraction rather than a file-wide match, and that is the whole point
 * of it: the assertions built on it claim things about what the handler DOES,
 * and a file-wide regex would find the same tokens in an import, a comment that
 * survived stripping, or a second function. The closing brace is matched at the
 * handler's own indentation, which is two spaces inside the component.
 */
function submitHandler(screen: string): string {
  return namedHandler(screen, 'submit');
}

/**
 * Any handler declared inside a component, BY NAME, from its signature to its
 * closing brace at the component's own two-space indentation.
 *
 * `submitHandler` above is this with the name written in, and it stayed that
 * way one story too long: a screen with a SECOND awaiting handler — the edit
 * form's password reset — was swept by nothing at all, because every reader
 * here matched `function submit(` and stopped. Extraction by name is what lets
 * `IN_FLIGHT_HANDLERS` carry one entry per handler rather than one per file.
 */
function namedHandler(screen: string, name: string): string {
  return new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n {2}\\}`).exec(screen)?.[0] ?? '';
}

/**
 * One helper function declared inside a component, from its signature to its
 * closing brace at the component's own two-space indentation.
 *
 * Added by the 1.4a review. The settings surface renders its form from
 * `renderSettings()`, which returns early when there is no snapshot — so
 * anything written INSIDE it is reachable only once a row has been read, and
 * the refusal message was. Scoped extraction rather than a file-wide match, for
 * the reason `submitHandler` is: the claim is about what is inside this
 * function, and a file-wide search answers a different question.
 */
function componentFunction(screen: string, name: string): string {
  return (
    new RegExp(`function ${name}\\([^)]*\\)[^{]*\\{[\\s\\S]*?\\n {2}\\}`).exec(screen)?.[0] ?? ''
  );
}

/**
 * The body of a `finally`, matched at its own indentation.
 *
 * IT RETURNS THE FIRST ONE IN WHATEVER IT IS GIVEN, which is why the sweeps
 * below hand it ONE EXTRACTED HANDLER rather than a whole file. Handed the
 * file, a screen with two awaiting handlers has its second `finally` read by
 * nothing — and the second is the newer one, so the coverage is always missing
 * exactly where it was last needed.
 */
function finallyBlock(screen: string): string {
  return /\}\s*finally\s*\{([\s\S]*?)\n {4}\}/.exec(screen)?.[1] ?? '';
}

/** Every key handed to `t()`, in source order. */
function translationKeys(text: string): string[] {
  return [...text.matchAll(/\bt\(\s*'([^']+)'/g)].map((found) => found[1] ?? '');
}

/**
 * The keys `signInMessageKey` can return, read off its RETURN TYPE.
 *
 * `@/supabase/sign-in` renders no JSX and calls no `t()`, so `translationKeys`
 * finds nothing in it — and the two refusal keys would drop out of the
 * rendered set entirely, taking the "every key declared is rendered" claim with
 * them.
 *
 * The union is the right place to read them from rather than a second-best one:
 * it is what makes `t(signInMessageKey(failure))` type-check against `hr.json`
 * (`i18n/index.ts`), so a key that is not in the resource file is already a
 * `pnpm typecheck` failure, and a key added to the function body without being
 * added to the union is too.
 */
function messageKeyUnion(text: string): string[] {
  // `\w*MessageKey` rather than `signInMessageKey`, because story 1.4a writes
  // the second instance of this shape (`organizationMessageKey`) and a reader
  // pinned to the first one would return nothing for it — silently dropping four
  // keys out of the rendered set and weakening the set comparison below by four.
  const signature = /function \w*MessageKey\([\s\S]*?\):([^{]*)\{/.exec(text)?.[1] ?? '';

  return [...signature.matchAll(/'([^']+)'/g)].map((found) => found[1] ?? '');
}

/**
 * Every key the member-list module declares, in EITHER shape.
 *
 * `messageKeyUnion` above reads one signature — it uses `exec`, so the first —
 * and this module carries three: the two refusals, the two permission-level
 * labels, and the three counted filter options. It also carries the four column
 * HEADINGS, which are not a return type at all but `label` entries on the table
 * the surface renders its headings, its skeleton cells and its body cells from.
 * Eleven keys in two shapes, and a reader pinned to either one would drop the
 * other out of the rendered set and weaken the comparison below by that much.
 *
 * Self-tested on both polarities at the bottom of this file, like every other
 * detector here: a reader that found nothing would make the set comparison pass
 * on a resource file missing all eleven.
 */
function memberListKeys(text: string): string[] {
  const unions = [...text.matchAll(/function \w*MessageKey\([\s\S]*?\):([^{]*)\{/g)].flatMap(
    (found) => [...(found[1] ?? '').matchAll(/'([^']+)'/g)].map((quoted) => quoted[1] ?? ''),
  );
  const headings = [...text.matchAll(/\blabel: '([^']+)'/g)].map((found) => found[1] ?? '');

  return [...unions, ...headings];
}

/**
 * Every key the member write path declares, in EITHER shape.
 *
 * `messageKeyUnion` above reads a `\w*MessageKey` signature and would find ten
 * of the eleven; the eleventh is `PARTIAL_SAVE_KEY`, a named constant rather
 * than a return type, because it is rendered BESIDE one of the ten rather than
 * instead of one — a refused rename that already wrote the four ordinary fields
 * has to say both what landed and what did not. A reader pinned to the union
 * alone would drop it out of the rendered set and let `hr.json` hold a message
 * nothing renders.
 *
 * The constant pattern is deliberately narrow — `<NAME>_KEY` at export, and only
 * in this file — so it cannot start matching a query key or a table name
 * somewhere else.
 *
 * Self-tested on both polarities at the bottom of this file, like every other
 * detector here.
 */
function memberWriteKeys(text: string): string[] {
  const unions = [...text.matchAll(/function \w*MessageKey\([\s\S]*?\):([^{]*)\{/g)].flatMap(
    (found) => [...(found[1] ?? '').matchAll(/'([^']+)'/g)].map((quoted) => quoted[1] ?? ''),
  );
  const constants = [...text.matchAll(/^export const \w+_KEY = '([^']+)';/gm)].map(
    (found) => found[1] ?? '',
  );

  return [...unions, ...constants];
}

/**
 * Attributes and properties whose string value is structure, not content.
 *
 * An allowlist, not a denylist of the guarded seven: a denylist passes for the
 * attribute nobody thought of, and `label` on a component is user-facing while
 * `name` on an input is not — which is exactly the distinction the ESLint guard
 * cannot make without type information. Here there is a handful of files to
 * read, so naming the permitted set outright is both possible and honest — and
 * every addition to it is a deliberate widening, made in the commit that needs
 * it and proved on both polarities in the detector block below.
 */
const STRUCTURAL_ATTRIBUTES = new Set([
  'className',
  'id',
  'name',
  'type',
  'method',
  'autoComplete',
  'autoCapitalize',
  'autoCorrect',
  'aria-describedby',
  'htmlFor',
  'path',
  'to',
  // ADDED by story 1.3b, and it is a loosening, so it is named rather than
  // waved through: `role` takes a value from a fixed ARIA vocabulary — `alert`,
  // `status`, `dialog` — and never renders. Nothing user-facing can hide in it,
  // which is the test every entry on this list has to pass.
  'role',
  // ADDED by story 1.4a, and it is a loosening, so it is named rather than waved
  // through: `variant` takes a value from `buttonVariants`' own closed set —
  // `default`, `outline`, `secondary`, `ghost`, `link` — and selects a class
  // list, never text. It passes the same test `role` passes: nothing
  // user-facing can hide in it, because a value outside the set is a `tsc`
  // error. Note the sixth member of that set is `destructive`, which is banned
  // separately and by name in every screen, so widening here does not widen
  // that.
  'variant',
  // ADDED by the navigation chrome, and it is a loosening of a GLOBAL
  // allowlist — this set applies to every screen in the application, so it is
  // named and justified rather than waved through, exactly as `role` and
  // `variant` were.
  //
  // `aria-current` takes its value from a CLOSED, NON-TEXTUAL vocabulary the
  // ARIA specification fixes — `page`, `step`, `location`, `date`, `time`,
  // `true`, `false` — and nothing outside it means anything to a screen reader.
  // Nothing user-facing can hide in it, which is the test every entry on this
  // list has to pass. It is also the one attribute the active-destination
  // treatment cannot do without: UX-DR37 wants the current entry signalled
  // without relying on colour, and `aria-current="page"` is the half of that
  // signal a person who cannot see the styling receives.
  //
  // The widening is narrower than it looks in one respect worth naming: the
  // guarded-attribute half of `eslint.config.js`'s L2 block does not include
  // `aria-current` either, and for the same reason — it is a state, not a name.
  // `aria-label` remains guarded in both places.
  'aria-current',
  // ADDED with it, and the argument is one this list already accepted once:
  // `aria-controls` is an ID REFERENCE LIST, exactly like `aria-describedby`
  // three entries up. Its value names elements on the page and renders nowhere,
  // so nothing user-facing can hide in it — and the chrome's collapse needs it,
  // because a disclosure that names no region leaves a screen-reader user with
  // `aria-expanded` and no way to reach what it expanded.
  //
  // The exemption is paid for twice over: the block below resolves every id this
  // attribute names against an element the file actually renders, so an
  // exempted value that points at nothing is still a failure.
  'aria-controls',
  // ADDED by story 1.5a's member list, and it is a loosening of a GLOBAL
  // allowlist — this set applies to all fourteen swept screens — so it is named
  // and justified rather than waved through, exactly as `role`, `variant`,
  // `aria-current` and `aria-controls` were.
  //
  // `aria-sort` takes its value from a CLOSED, NON-TEXTUAL vocabulary the ARIA
  // specification fixes — `ascending`, `descending`, `other`, `none` — and
  // nothing outside it means anything to a screen reader. Nothing user-facing
  // can hide in it, which is the test every entry on this list has to pass. It
  // is also a STATE rather than a name, the argument `aria-current` was admitted
  // on, and the same reason `eslint.config.js`'s guarded-attribute half does not
  // include it either. `aria-label` remains guarded in both places.
  //
  // THE EXEMPTION IS PAID FOR GLOBALLY, and that matters because the allowlist
  // is global: the justification above is only true while it is ENFORCED, and it
  // was argued from one screen's usage. `ariaSortValues` below collects every
  // `aria-sort` value on every swept screen and holds each to the ARIA
  // vocabulary, so `aria-sort="Ime"` on any screen in the application is a
  // failure rather than a literal in the one attribute nothing else looks at.
  // That is the same bargain `aria-current` struck.
  'aria-sort',
  // ADDED by story 1.5b's member forms, and it is a loosening of a GLOBAL
  // allowlist — this set applies to all sixteen swept screens — so it is named
  // and justified rather than waved through, exactly as the five entries above
  // it were.
  //
  // `aria-invalid` takes its value from a CLOSED, NON-TEXTUAL vocabulary the
  // ARIA specification fixes — `true`, `false`, `grammar`, `spelling` — and
  // nothing outside it means anything to a screen reader. It is a STATE rather
  // than a name, the argument `aria-current` and `aria-sort` were admitted on,
  // and the same reason `eslint.config.js`'s guarded-attribute half does not
  // include it either. `aria-label` remains guarded in both places.
  //
  // THE EXEMPTION IS PAID FOR, like `aria-sort`'s: `ariaInvalidValues` below
  // collects every literal value of it on every swept screen and holds each to
  // that vocabulary, so `aria-invalid="Dani godišnjeg odmora"` is a failure
  // rather than a literal in the one attribute nothing else looks at.
  'aria-invalid',
]);

/** Content inside a template literal, with every `${…}` removed. */
function templateStaticText(raw: string): string {
  return raw.replace(/\$\{[^}]*\}/g, '');
}

/**
 * String literals that are neither a `t()` key nor a structural value.
 *
 * `t('…')` calls and `import … from '…'` are removed first, so what is left is
 * every remaining literal paired with the name it sits under — or with nothing,
 * which is itself an offence. Both `name="value"` and `name: 'value'` count as
 * sitting under a name: `createRoute`'s `path` is a property, not an attribute,
 * and reading only the JSX form would let an object literal through.
 *
 * BACKTICKS are scanned as well as quotes. The quote-only character class
 * could not see a template literal at all, which is the one string form the
 * ESLint guard needed three selectors to cover — and the shape a `t()`
 * argument widens into when someone reaches for interpolation. A template
 * whose only content is `${…}` is not a hard-coded string and passes.
 */
/**
 * A structural attribute written as an EXPRESSION rather than a quoted value.
 *
 * `aria-describedby={failure === null ? undefined : 'sign-in-error'}` is the
 * same structural value the quoted form carried — an id reference — and it has
 * to be an expression because the element it names renders only on failure.
 * Without this the scan reads the literal as sitting under the name `undefined`
 * and reports an id as user-facing text.
 *
 * A WIDENING, so it is deliberately narrow: only the names already on the
 * allowlist, and only a container with no nested braces of its own. Every other
 * attribute keeps firing in every form, which the detector block below proves
 * on both polarities.
 */
const STRUCTURAL_EXPRESSION = new RegExp(
  `\\b(?:${[...STRUCTURAL_ATTRIBUTES].join('|')})=\\{[^{}]*\\}`,
  'g',
);

function unsanctionedLiterals(text: string): string[] {
  const withoutKeys = text.replace(/\bt\(\s*'[^']+'/g, 't(');
  const withoutStructural = withoutKeys.replace(STRUCTURAL_EXPRESSION, '');
  const withoutImports = withoutStructural.replace(/^\s*import[^;]+;/gm, '');
  const offenders: string[] = [];
  const named = '(?:([A-Za-z-]+)\\s*[=:]\\s*\\{?\\s*)?';

  // A quoted literal cannot contain a raw newline, so `.` is correct here and
  // stops a runaway match spanning half the file.
  for (const found of withoutImports.matchAll(new RegExp(`${named}(['"])(.*?)\\2`, 'g'))) {
    const [, attribute, , value = ''] = found;
    if (attribute !== undefined && STRUCTURAL_ATTRIBUTES.has(attribute)) continue;
    offenders.push(value);
  }

  // A template literal may span lines, so this one is deliberately greedy over
  // newlines and non-greedy over backticks.
  for (const found of withoutImports.matchAll(new RegExp(`${named}\`([\\s\\S]*?)\``, 'g'))) {
    const [, attribute, raw = ''] = found;
    if (attribute !== undefined && STRUCTURAL_ATTRIBUTES.has(attribute)) continue;
    if (!/[\p{L}\p{N}]/u.test(templateStaticText(raw))) continue;
    offenders.push(raw);
  }

  return offenders;
}

/**
 * A TypeScript type-argument list, which is not JSX however much it looks it.
 *
 * `useRef<HTMLInputElement>(null)` and `Promise<void>` put a `>` and a later
 * `<` in the file with ordinary code between them, so the text scan below read
 * `(null); const passwordField = useRef` as user-facing text and reported four
 * offences on a compliant screen — the same class of false positive the `=>`
 * substitution exists for, and one this file could not have met until a screen
 * held a generic call.
 *
 * The `<` must be preceded by an IDENTIFIER CHARACTER, which is what separates
 * the two: a JSX element's `<` always follows whitespace, `(`, `{` or `>`. The
 * body admits no `<` or `>` of its own, so nested generics need another pass,
 * and it admits no `=`, so a JSX opening tag with attributes can never match.
 */
const TYPE_ARGUMENTS = /(?<=[A-Za-z0-9_$])<[A-Za-z0-9_$.,|&\s[\]'"]*>/g;

function stripTypeArguments(text: string): string {
  // To a fixed point, for `useState<Record<string, string>>`. Each pass only
  // ever shortens the text, so it terminates.
  let previous = text;

  for (;;) {
    const next = previous.replace(TYPE_ARGUMENTS, '');

    if (next === previous) return next;

    previous = next;
  }
}

/**
 * JSX text runs: everything between a `>` and the next `<`.
 *
 * `=>` is neutralized first, or an arrow function's body would read as a text
 * run, and so are type-argument lists (above). A run holding a brace is an
 * expression container rather than text, so `{t('auth.heading')}` is correctly
 * not text at all.
 */
function jsxTextWithContent(text: string): string[] {
  return [...stripTypeArguments(text).replace(/=>/g, '__').matchAll(/>([^<>{}]+)</g)]
    .map((found) => found[1] ?? '')
    .filter((run) => /[\p{L}\p{N}]/u.test(run));
}

/**
 * The key a screen's `<h1>` renders, or `null`.
 *
 * Added by story 1.4a, when a destination stopped being a heading and nothing
 * else: source order was standing in for "the heading is the destination's own
 * label", and the two came apart the moment a screen rendered eight strings.
 * Whitespace-tolerant, because a long key puts the call on its own line.
 */
function headingKey(text: string): string | null {
  return /<h1\b[^>]*>\s*\{t\('([^']+)'\)\}/.exec(text)?.[1] ?? null;
}

/** `htmlFor` values, in source order. */
function labelTargets(text: string): string[] {
  return [...text.matchAll(/htmlFor="([^"]+)"/g)].map((found) => found[1] ?? '');
}

/** Every `<Input …/>` element's attribute block. */
function inputElements(text: string): string[] {
  return [...text.matchAll(/<Input\b([\s\S]*?)\/>/g)].map((found) => found[1] ?? '');
}

/**
 * Every BARE `<input …/>` element's attribute block — lowercase only.
 *
 * Added by story 1.4b. The logo's file picker is a plain `<input type="file">`
 * rather than the shadcn primitive, so `inputElements` above does not see it
 * (its pattern is capital-`I` `<Input`) and neither does any sweep built on it.
 * That is deliberate — what a pointer meets is a `<Button>` — but it means the
 * one control on this screen that carries a file is guarded by NOTHING unless
 * it is read separately, which is what this exists for.
 */
function bareInputElements(text: string): string[] {
  return [...text.matchAll(/<input\b([\s\S]*?)\/>/g)].map((found) => found[1] ?? '');
}

/**
 * Every `<select …>` opening tag's attribute block.
 *
 * Added by story 1.4c, and a FOURTH control detector rather than a widening of
 * the three, for the reason `linkElements` is a third: a native `<select>` is
 * not a `<Button>` and must not be counted as one — `expectedControls` on every
 * other screen is a tight number, and folding a new element type into it would
 * loosen all of them to cover one file. What it shares with a button is the
 * only thing asserted through it: a person taps it, so UX-DR40's floor applies.
 *
 * Every consumer brings its own length assertion, the rule every element regex
 * here follows.
 */
function selectElements(text: string): string[] {
  return [...text.matchAll(/<select\b([\s\S]*?)>/g)].map((found) => found[1] ?? '');
}

/** Every `<Button …>` opening tag's attribute block. */
function buttonElements(text: string): string[] {
  return [...text.matchAll(/<Button\b([^>]*?)\/?>/g)].map((found) => found[1] ?? '');
}

/**
 * Every `<nav …>…</nav>` block, opening tag to closing tag.
 *
 * Added because COUNTING the chrome's controls says nothing about WHERE they
 * are. Two bars render from the same two variables, and deleting `{exit}` from
 * one of them leaves the `<Link>` count at one, `expectedControls` at three, and
 * every responsive-class assertion untouched — a phone build with navigation and
 * no way to sign out, green. The only thing that notices is reading each bar's
 * contents, which is what this extracts.
 *
 * Non-greedy, which is correct here and would not be if a `<nav>` were ever
 * nested inside another; the consumer asserts the count, so that day fails
 * loudly rather than silently merging two bars into one.
 */
function navBlocks(text: string): string[] {
  return [...text.matchAll(/<nav\b[\s\S]*?<\/nav>/g)].map((found) => found[0]);
}

/**
 * Every value an `aria-current` attribute can take, in either syntax.
 *
 * The attribute is on `STRUCTURAL_ATTRIBUTES` above, which EXEMPTS it from the
 * literal sweep on every screen in the application — and the argument that
 * earned the exemption was that its vocabulary is closed and non-textual. That
 * argument is only true while it is enforced: `aria-current="Danas"` is a
 * user-facing literal sitting in the one attribute nothing else now looks at.
 * This is what looks at it.
 */
function ariaCurrentValues(text: string): string[] {
  return [...text.matchAll(/aria-current=(?:"([^"]*)"|\{([^}]*)\})/g)].flatMap((found) => {
    const literal = found[1];

    if (literal !== undefined) return [literal];

    return [...(found[2] ?? '').matchAll(/'([^']*)'/g)].map((quoted) => quoted[1] ?? '');
  });
}

/**
 * Every LITERAL value an `aria-invalid` attribute is given, on any screen.
 *
 * The twin of `ariaSortValues` below, and it exists for the identical reason:
 * `aria-invalid` is on `STRUCTURAL_ATTRIBUTES`, which exempts it from the
 * literal sweep everywhere, and the argument that earned the exemption is only
 * true while it is enforced.
 *
 * Only the QUOTED form is collected. Both member forms write the expression
 * form — `aria-invalid={invalidField === 'member-leave'}` — whose value is a
 * boolean and whose inner literal is an element id, not a word anybody reads;
 * a sweep over the expression form would report that id as user-facing text.
 * What must never appear is a quoted value outside the ARIA vocabulary.
 */
function ariaInvalidValues(text: string): string[] {
  return [...text.matchAll(/aria-invalid="([^"]*)"/g)].map((found) => found[1] ?? '');
}

/**
 * Every value an `aria-sort` attribute can take, in either syntax.
 *
 * The twin of `ariaCurrentValues` above, and it exists for the identical
 * reason: `aria-sort` is on `STRUCTURAL_ATTRIBUTES`, which EXEMPTS it from the
 * literal sweep on every screen in the application, and the argument that earned
 * the exemption was that its vocabulary is closed and non-textual. That argument
 * is only true while it is enforced — `aria-sort="Ime"` is a user-facing literal
 * sitting in the one attribute nothing else now looks at. This is what looks at
 * it, and it looks on every screen rather than on the one that introduced it.
 */
function ariaSortValues(text: string): string[] {
  return [...text.matchAll(/aria-sort=(?:"([^"]*)"|\{([^}]*)\})/g)].flatMap((found) => {
    const literal = found[1];

    if (literal !== undefined) return [literal];

    return [...(found[2] ?? '').matchAll(/'([^']*)'/g)].map((quoted) => quoted[1] ?? '');
  });
}

/**
 * Every `<Link …>` opening tag's attribute block.
 *
 * Added by the navigation chrome, and it is a THIRD control detector rather than
 * a widening of the two above, deliberately. A router link is not a `<Button>`
 * and must not be counted as one — `expectedControls` on every other screen is a
 * tight number, and folding links into it would loosen all of them to cover one
 * file. What a link shares with a button is the only thing asserted through it:
 * a person taps it, so UX-DR40's floor applies.
 *
 * Every consumer of this brings its own length assertion. Both element regexes
 * above are non-vacuously guarded by each of theirs, and copying one without
 * that guard is precisely how a sweep goes quiet.
 */
function linkElements(text: string): string[] {
  return [...text.matchAll(/<Link\b([^>]*?)\/?>/g)].map((found) => found[1] ?? '');
}

function attributeOf(element: string, name: string): string | null {
  return new RegExp(`${name}="([^"]+)"`).exec(element)?.[1] ?? null;
}

/**
 * An `aria-describedby` value split into the ids it actually names.
 *
 * The attribute is an ID REFERENCE LIST — space-separated, any amount of
 * whitespace — and reading it as one id was correct only while there was one
 * description to point at. `null` in, empty out, so an absent attribute cannot
 * masquerade as an id and be "found" in a source file that mentions nothing.
 */
function idTokens(value: string | null): string[] {
  return (value ?? '').split(/\s+/).filter((token) => token !== '');
}

/**
 * Every id an element's `aria-describedby` can name, in either syntax.
 *
 * The attribute became CONDITIONAL — the element it points at renders only on
 * failure, and a reference to an absent id is silently ignored, so the static
 * form described a control by something that was not on the page in the common
 * case. `attributeOf` reads `name="…"` only, so it returns `null` for the
 * expression form and the old assertion failed a screen that was correct.
 *
 * Both branches of the expression are collected, because both are shipped:
 * every id NAMED anywhere in the attribute must resolve, whichever branch put
 * it there.
 */
function describedByIds(element: string): string[] {
  const literal = attributeOf(element, 'aria-describedby');

  if (literal !== null) return idTokens(literal);

  const expression = /aria-describedby=\{([^}]*)\}/.exec(element)?.[1];

  if (expression === undefined) return [];

  return [...expression.matchAll(/'([^']*)'/g)].flatMap((found) => idTokens(found[1] ?? ''));
}

/**
 * The tallest height a className can be shown to set, in CSS pixels.
 *
 * Returns `null` rather than 0 when it can prove nothing, so "no height class
 * at all" and "a height class of zero" cannot be confused — the mutation that
 * found this gap deleted the class outright.
 */
function heightPx(className: string | null): number | null {
    if (className === null) return null;

    const found: number[] = [];
    for (const match of className.matchAll(/(?:^|\s)(?:min-)?h-(\d+(?:\.\d+)?)(?=\s|$)/g)) {
      found.push(Number(match[1]) * SPACING_STEP_PX);
    }
    for (const match of className.matchAll(/(?:^|\s)(?:min-)?h-\[(\d+(?:\.\d+)?)(px|rem)\]/g)) {
      found.push(Number(match[1]) * (match[2] === 'rem' ? ROOT_FONT_PX : 1));
    }

    return found.length === 0 ? null : Math.max(...found);
}

/** Every leaf key path in the resource file, dotted the way i18next resolves. */
function resourceKeys(): string[] {
  const walk = (node: unknown, prefix: string): string[] => {
    if (typeof node !== 'object' || node === null) return [prefix];

    return Object.entries(node).flatMap(([key, value]) =>
      walk(value, prefix === '' ? key : `${prefix}.${key}`),
    );
  };

  return walk(JSON.parse(readFileSync(RESOURCE, 'utf8')), '');
}

/**
 * Every source that contributes a key, with the reader that finds them in it.
 *
 * The reader is named per entry rather than assumed, because they are not the
 * same shape: a screen renders `t('key')`, and the message mapping declares its
 * keys as a return-type union in a `.ts` module that renders nothing. Both are
 * "a key this application can put on screen", and the set comparison below is
 * only true if both are read.
 */
const KEY_SOURCES = [
  { name: 'the sign-in screen', file: SCREEN, keys: translationKeys, strings: 5 },
  { name: 'the not-found component', file: NOT_FOUND, keys: translationKeys, strings: 2 },
  { name: 'the organization prompt', file: ORGANIZATION, keys: translationKeys, strings: 3 },
  // THREE on the sign-in frame (visual refresh A): the brand panel's product
  // name, headline and subline, written once and rendered around both steps,
  // so neither step's own count moved.
  { name: 'the sign-in frame', file: AUTH_LAYOUT, keys: translationKeys, strings: 3 },
  { name: 'the failure-to-message mapping', file: MESSAGE_KEYS, keys: messageKeyUnion, strings: 2 },
  // TWELVE on the settings surface: its own `nav.organizacija` heading, five
  // field labels, the save and cancel actions, the logo's own label, the choose
  // action — rendered TWICE, once as the button's text and once as the hidden
  // file input's `aria-label`, because the two controls are one affordance and
  // a screen reader must hear the same word the eye sees — and
  // `nav.organizacija` a second time, as the neutral mark's accessible name for
  // the unreachable case where the organization's own name is blank. The set
  // comparison below dedupes, so twelve `t()` calls over ten keys is correct
  // rather than a count that drifted.
  //
  // The refusal is NOT among them — it reaches `t()` through
  // `organizationMessageKey`, which is the next entry, for the reason the
  // sign-in refusals do: a ternary over codes written in a `.tsx` is executed
  // by nothing.
  // TWELVE on the settings surface, and it is the same number for a different
  // reason since story 1.4c. The logo's `<img>` and neutral mark moved into the
  // shared lockup, taking the mark's borrowed `nav.organizacija` fallback with
  // them; the accent control's own label arrived in its place. Its five OPTION
  // names are not here — they reach `t()` through `accentMessageKey`, which is
  // the entry below, for the reason every refusal on this screen does: a lookup
  // written in a `.tsx` is executed by nothing.
  //
  // So: `nav.organizacija` as the heading, five field labels, the accent label,
  // the save and cancel actions, the logo's own label, and the choose action
  // rendered TWICE — once as the button's text and once as the hidden file
  // input's `aria-label`, because the two controls are one affordance and a
  // screen reader must hear the word the eye sees. The set comparison below
  // dedupes, so twelve calls over eleven keys is correct rather than drift.
  //
  // THIRTEEN SINCE STORY 2.1b: the link to the hour band editor, which renders
  // that screen's own heading as its text.
  { name: 'the organization settings surface', file: SETTINGS, keys: translationKeys, strings: 13 },
  {
    // EIGHT on the member list since story 1.5b, up from five, and the number is
    // still small because most of what this screen says is read off a table
    // rather than written into the markup.
    // Its own `nav.ljudi` heading, the search field's label, the level filter's
    // label — which is the COLUMN's key `ljudi.role` rendered a second time,
    // because the control filters exactly what that column shows and two words
    // for one thing is two things to a reader — the table's caption, and the
    // stated row count.
    //
    // The four column headings are NOT among them, and neither are the three
    // filter options, the two level labels or the two refusals: every one of
    // those reaches `t()` through `@/members/list`, which is the entry below.
    // A lookup written in a `.tsx` is executed by nothing (AD-15), and the 1.5a
    // review shipped two swapped sort keys green for exactly that reason.
    // The three that arrived are the add action, the actions column's own
    // heading — a `<th>` with no text is announced as nothing at all — and the
    // row action, whose name INTERPOLATES the member it acts on because four
    // hundred rows announcing the same three words is four hundred controls a
    // screen-reader user cannot tell apart.
    //
    // TEN SINCE STORY 1.6: the inactive marker, which INTERPOLATES the name it
    // sits beside, and the scheduled-deactivation marker, which interpolates
    // the date as well. Whether a member is inactive today or scheduled out is
    // `@/members/list`'s decision, as at the organization's today; the screen
    // only renders the kind of cell the column produced.
    //
    // ELEVEN SINCE STORY 1.7a: the link to the teams screen, which renders
    // `smjene.heading`, the teams screen's own heading, as its text.
    //
    // TWELVE SINCE STORY 1.7b: `smjene.membership.none`, the team cell's
    // positive words for a member on no team today.
    //
    // ELEVEN SINCE VISUAL REFRESH B: the two marker keys LEFT for
    // `@/members/list` (`memberStatusMessageKey`, counted there), where their
    // pairing to a cell is executed, and `ljudi.status.separator` arrived: the
    // visually hidden separator read between a name and its marker badge.
    //
    // THIRTEEN SINCE THE TEAM FILTER: its label, which is the team COLUMN's
    // key `smjene.membership.column` rendered a second time for the reason
    // `ljudi.role` is, and the reset. The three team options reach `t()`
    // through `teamFilterMessageKey`, counted with the rules below.
    name: 'the member list',
    file: MEMBER_LIST,
    keys: translationKeys,
    strings: 13,
  },
  {
    // STORY 1.7a. EIGHT on the team list: its heading, the link back
    // (`nav.ljudi`, the destination it returns to), the name label, the add
    // action, the created confirmation, the active group's heading and count,
    // and the archived group's count, which IS its heading. Both counts are ICU
    // plurals and are rendered at zero. The row action (edit or view) and the
    // refusals reach `t()` through the two `@/teams` modules.
    name: 'the team list',
    file: TEAM_LIST,
    keys: translationKeys,
    strings: 8,
  },
  {
    // EIGHT on one team: the name label, Save, the archive offer, prompt,
    // confirm and cancel, the note an archived team carries instead of
    // controls, and the link back. The heading (edit or view) and the saved
    // confirmation (renamed or archived) are chosen in `@/teams`, below.
    name: 'the team edit form',
    file: TEAM_EDIT,
    keys: translationKeys,
    strings: 8,
  },
  {
    // FIVE over three unions, so read by `memberListKeys`, which reads every
    // union rather than the first: the row action (edit, or view for an
    // archived team), the one-team heading by the same rule, and the read
    // failure. Zero rows is an answer here, not a refusal.
    name: 'the team list rules',
    file: TEAM_LIST_KEYS,
    keys: memberListKeys,
    strings: 5,
  },
  {
    // NINE over two unions: seven refusals — the empty name, the taken name,
    // the stale screen, the outright refusal, another invalid value, the
    // service, and a team the list lacks — and the two confirmations, a rename
    // and an archive, which are different sentences on purpose.
    //
    // TEN SINCE STORY 1.7b: the in-use refusal, an archive of a team somebody
    // is on today or is scheduled onto.
    name: 'the team write rules',
    file: TEAM_WRITE_KEYS,
    keys: memberListKeys,
    strings: 10,
  },
  {
    // STORY 1.8. FOUR on the roster: the heading while there is no roster to
    // name, the archived note, the ICU plural count, and the link back. The
    // team's name and the members' names are data.
    name: 'the team roster',
    file: TEAM_ROSTER,
    keys: translationKeys,
    strings: 4,
  },
  {
    // ONE on Danas: its own `nav.danas` heading. The line's words and its
    // refusal reach `t()` through `@/teams/roster`, below.
    name: 'the Danas destination',
    file: DANAS,
    keys: translationKeys,
    strings: 1,
  },
  {
    // FIVE over three unions: the roster's two refusals (unknown, and the
    // service), the Danas line's two openings (the team label, or no team),
    // and the own-row read's one refusal.
    name: 'the team roster rules',
    file: TEAM_ROSTER_KEYS,
    keys: memberListKeys,
    strings: 5,
  },
  {
    // STORY 2.1b. THIRTEEN on the band list: its heading, the link back
    // (`nav.organizacija`), the name and start labels, the add action, the
    // created confirmation, the ICU count, the row action, the window and
    // duration labels, the midnight flag, the coverage sentence, and the bar's
    // uncovered flag. Every figure is data from `@/hour-bands/list`; the
    // duration's shape and the refusals reach `t()` through the two modules.
    name: 'the hour band list',
    file: HOUR_BAND_LIST,
    keys: translationKeys,
    strings: 13,
  },
  {
    // TWELVE on one band: its heading, the two field labels, Save, the window
    // and duration labels, the midnight flag, the removal offer, prompt,
    // confirm and cancel, and the link back.
    name: 'the hour band edit form',
    file: HOUR_BAND_EDIT,
    keys: translationKeys,
    strings: 12,
  },
  {
    // FOUR over two unions: the duration's three shapes and the read failure.
    name: 'the hour band list rules',
    file: HOUR_BAND_LIST_KEYS,
    keys: memberListKeys,
    strings: 4,
  },
  {
    // ELEVEN over two unions: nine refusals — the blank name, the taken name,
    // the taken start, the invalid start, the stale screen, the outright
    // refusal, another invalid value, the service, and a band the list lacks —
    // and the two confirmations, an edit and a removal.
    name: 'the hour band write rules',
    file: HOUR_BAND_WRITE_KEYS,
    keys: memberListKeys,
    strings: 11,
  },
  {
    // THIRTEEN on the create form: its own heading, five field labels, the save
    // and cancel actions, the link back to the list, and the credential panel's
    // three — plus `ljudi.form.username` a SECOND time, as that panel's label
    // for the username it just issued. The set comparison below dedupes, so
    // thirteen calls over twelve keys is correct rather than drift.
    //
    // The password is not among them and never will be: it is data, generated
    // in `admin-auth`, and the one value in this system no later read can
    // recover.
    name: 'the member create form',
    file: MEMBER_CREATE,
    keys: translationKeys,
    strings: 13,
  },
  {
    // EIGHTEEN on the edit form: its own heading, five field labels, save,
    // cancel, the link back, the confirmation that a save landed, and the
    // admin-issued reset's EIGHT — the offer, the confirmation's prompt, its
    // confirm and cancel, and the shown panel's four (that it was issued, the
    // label over the password, the write-it-down sentence, and the dismiss).
    //
    // The password is not among them and never will be: it is data, generated
    // in `admin-auth`, and the one value in this system no later read can
    // recover. `ljudi.form.credentialOnce` is rendered a SECOND time here — the
    // create panel already shows it — and the set comparison below dedupes, so
    // eighteen calls over seventeen keys is correct rather than drift.
    //
    // `ljudi.form.saved` is the tenth and it is not decoration: every field
    // here is uncontrolled and remounts to the values it was just saved with,
    // so without it a successful save looks identical to a press that did
    // nothing.
    //
    // TWENTY-ONE SINCE STORY 1.6: the status block's three literal keys — the
    // date control's label, the confirmation's cancel, and the confirmation
    // that a change landed. Its status lines, offer, prompt and confirm vary
    // with the member's history and reach `t()` through `@/members/wire`,
    // which is the entry below.
    //
    // TWENTY-EIGHT SINCE STORY 1.7b: the team block's seven literal calls —
    // the line stating the team today, `Bez smjene` twice (as that line's
    // value and as the picker's "no team" option), the picker's and the date's
    // labels, the confirmation's cancel, and the confirmation that a change
    // landed. Its scheduled line, offer, prompt and confirm reach `t()`
    // through `@/members/wire`.
    name: 'the member edit form',
    file: MEMBER_EDIT,
    keys: translationKeys,
    strings: 28,
  },
  {
    // THIRTEEN on the member write path's rules: eleven `ljudi.form.error.*`
    // refusals, the LIST's own refusal — reused rather than reworded, because
    // `/ljudi/$id` is reachable by URL and a read the database declines
    // outright is not a failed write — and the partial-save sentence. It is the
    // second key source read by neither `translationKeys` nor
    // `messageKeyUnion`; see `memberWriteKeys`, which reads both shapes this
    // module declares keys in.
    //
    // THE ELEVENTH REFUSAL IS THE RESET'S. "The password was not changed" is
    // its own sentence rather than the service fallback because this surface is
    // the ONLY recovery an account with no email address has, and the fact an
    // admin needs before they tell somebody anything is whether the credential
    // moved at all.
    //
    // THIRTY-FIVE SINCE STORY 1.6: seven refusals a status change can earn —
    // a past date, the caller's own row, a date that already has a version, a
    // date before the latest one, a change that changes nothing, a
    // cancellation of a change already in effect, and a list behind the
    // database (look again); ELEVEN keys the offer,
    // prompt and confirm take across the three changes (a prompt for today
    // and one for a later date, for each of deactivate and reactivate); and
    // the FOUR status lines — today's in the present, the scheduled change's
    // in the future. Paired by `statusOfferMessageKey` and its siblings so
    // the pairing is executed rather than written into the screen.
    //
    // FIFTY-FOUR SINCE STORY 1.7b, all under `smjene.membership.*`: eight team
    // refusals, the two offers (move, cancel the scheduled move), five prompts
    // (onto a team or onto none, today or later, and the cancellation), the
    // two confirms, and the two scheduled lines (onto a team, onto none).
    name: 'the member write rules',
    file: MEMBER_WRITE_KEYS,
    keys: memberWriteKeys,
    strings: 54,
  },
  {
    // ELEVEN on the member list's rules: four column headings, two permission
    // levels, three counted filter options and two refusals. It is the first
    // key source read by neither `translationKeys` nor `messageKeyUnion` — see
    // `memberListKeys`, which reads both shapes this module declares keys in.
    // TWELVE SINCE STORY 1.7b: the team column's heading.
    // EIGHTEEN SINCE VISUAL REFRESH B: the summary row's four stat labels, read
    // off `membersSummaryOf`'s `label:` entries the way the headings are, and
    // the two inactive-marker keys, which moved here from the screen as
    // `memberStatusMessageKey`'s return union.
    // TWENTY-ONE SINCE THE TEAM FILTER: `teamFilterMessageKey`'s three counted
    // options — every team, a named team, and no team.
    name: 'the member list rules',
    file: MEMBER_LIST_KEYS,
    keys: memberListKeys,
    strings: 21,
  },
  {
    // ONE on the lockup: the accessible name it falls back to when the
    // organization's own name is blank. `0002:72` makes that unreachable from
    // the database, but an empty accessible name on a `role="img"` is an
    // element a screen reader announces as nothing at all. Everything else the
    // lockup shows is DATA — the organization's name, its logo — and data is
    // never a key.
    name: 'the organization lockup',
    file: LOCKUP,
    keys: translationKeys,
    strings: 1,
  },
  {
    // FIVE, for four curated accents and no accent — the fourth instance of the
    // `\w*MessageKey` shape, after sign-in, the organization's refusals and the
    // chrome's. It is a mapping rather than a list because the mutation it
    // refuses is invisible in a diff: two swapped branches leave an
    // organization that chose green reading `Plava`, and a `.tsx` lookup is
    // executed by nothing (AD-15). `accent.test.ts` runs it.
    name: 'the accent-to-label mapping',
    file: ACCENT_KEYS,
    keys: messageKeyUnion,
    strings: 5,
  },
  {
    // TEN since story 1.4b, and one function rather than two: the surface
    // shows exactly one message region, so a second mapping would need a
    // screen-side ternary choosing between them — the executed-by-nothing
    // branch this entry exists to abolish.
    name: 'the organization failure-to-message mapping',
    file: ORGANIZATION_MESSAGE_KEYS,
    keys: messageKeyUnion,
    strings: 10,
  },
  // SIX literal keys on the chrome — the navigation landmark's name twice (one
  // per bar), the collapse's two state-dependent names, the exit and the retry —
  // and that count is smaller than what the chrome RENDERS, which is the
  // interesting part. The eight destination labels reach `t()` as
  // `t(destination.key)`, read off `@/navigation/destinations` rather than
  // written here, so `translationKeys` finds none of them and must not: a chrome
  // that named its own keys would be a ninth copy of the destination list, and
  // the whole reason that table is data is that a test can execute it. The eight
  // stay in the set comparison below because the eight destination screens each
  // render their own heading.
  // SEVEN SINCE VISUAL REFRESH A: the sidebar's muted section label renders
  // `shell.navigation` a third time — the landmark's own name, made visible and
  // `aria-hidden` so it is not announced twice.
  { name: 'the navigation chrome', file: CHROME, keys: translationKeys, strings: 7 },
  {
    // TWO, for three role codes and one sign-out code. The collapse is the
    // decision `messages.test.ts` executes; what this count pins is that there
    // are exactly two messages to collapse into, so a third failure that quietly
    // grew its own message has to be justified here first.
    name: 'the chrome failure-to-message mapping',
    file: NAVIGATION_MESSAGE_KEYS,
    keys: messageKeyUnion,
    strings: 2,
  },
  // ONE each, exactly. The seven together are what make the set comparison
  // below hold once `hr.json` gained eight `nav.*` keys: a key declared and
  // never rendered is a string nobody reviewed, and a destination rendering two
  // keys is a screen this story did not sanction.
  ...DESTINATION_SCREENS.map((destination) => ({
    ...destination,
    keys: translationKeys,
    strings: 1,
  })),
];

describe('the screen is read at all, so every sweep below means something', () => {
  // THE COUNT IS THE GUARD, because neither list is length-asserted anywhere
  // else and both drive `it.each`: a removed row takes its cases with it, and
  // Vitest reports the shorter run as a pass. A row deleted without a reason
  // fails here until somebody moves the number, which is the moment the removal
  // gets reviewed — the same bargain `expectedControls` strikes per screen.
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
    // the member list replaces its own placeholder entry, and `@/members/list`
    // is a new source — the module that holds the column headings, the level
    // labels, the filter options and the refusals, none of which a `.tsx` may
    // declare because nothing executes a `.tsx`.
    // SIXTEEN AFTER STORY 1.5b, and the arithmetic is the reason rather than a
    // coincidence: two `.tsx` that render arrived — the create form and the
    // edit form — and neither replaced a placeholder, because neither is a
    // destination. Nothing left the list.
    //
    // TWENTY-ONE key sources, up from eighteen by THREE and not two: both new
    // screens declare keys, and so does `@/members/write`, which holds the
    // failure-to-message union. That union cannot live in a `.tsx` — nothing
    // executes one — so the module is a source in its own right, exactly as
    // `@/members/list` is.
    //
    // EIGHTEEN AND TWENTY-FIVE SINCE STORY 1.7a: the two team screens, and
    // four key sources — both screens and both `@/teams` modules.
    //
    // NINETEEN AND TWENTY-SEVEN SINCE STORY 1.8: Danas left the placeholders
    // and arrived as a built entry (net zero), the roster screen is new (one),
    // and so is `@/teams/roster` as a key source (one more).
    //
    // TWENTY AND TWENTY-EIGHT SINCE VISUAL REFRESH A: the sign-in frame is a
    // new `.tsx` that renders strings, so it is one screen and one key source.
    //
    // TWENTY-TWO AND THIRTY-TWO SINCE STORY 2.1b: the two hour band screens,
    // and four key sources — both screens and both `@/hour-bands` modules.
    expect(SCREENS).toHaveLength(22);
    expect(KEY_SOURCES).toHaveLength(32);
  });

  // Vacuous-pass guard. A renamed or moved file would make each "contains no"
  // assertion hold against nothing.
  it.each(SCREENS)('finds $name and finds JSX in it', ({ file }) => {
    expect(source(file).length).toBeGreaterThan(200);
    expect(source(file)).toContain('return (');
  });

  it('finds the controls it is about to measure', () => {
    expect(inputElements(source(SCREEN))).toHaveLength(2);
    expect(buttonElements(source(SCREEN))).toHaveLength(1);
  });
});

describe('every user-facing string on the screen resolves through a key', () => {
  it.each(SCREENS)('leaves no bare JSX text in $name', ({ file }) => {
    expect(jsxTextWithContent(source(file))).toEqual([]);
  });

  it.each(SCREENS)('leaves no string or template literal off a structural attribute in $name', ({ file }) => {
    expect(unsanctionedLiterals(source(file))).toEqual([]);
  });

  it.each(KEY_SOURCES)('renders $strings strings on $name', ({ file, keys, strings }) => {
    // A count per source, so a string that stopped being rendered fails rather
    // than quietly disappearing from the screen. TWO on the mapping and no
    // more: a third message would mean a third code, and the three upstream
    // refusals share one on purpose.
    expect(keys(source(file))).toHaveLength(strings);
  });
});

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
    const file = join(srcRoot, 'routes', `${path.slice(1)}.tsx`);
    const screen = source(file);

    // READ OFF THE `<h1>`, not off source order, since story 1.4a. Seven of the
    // eight render exactly one string, so `toEqual([key])` and "the heading is
    // the key" were the same assertion for them; the settings surface renders
    // eight, and the one that has to be the destination's own is the HEADING —
    // a screen whose `<h1>` drifted to some other key is a page titled something
    // the navigation does not call it. Their per-file exact counts in
    // `KEY_SOURCES` keep the other seven as tight as they were.
    expect(headingKey(screen), `${path} does not title itself ${key}`).toBe(key);
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
      /import\s*\{[^}]*\bAppChrome\b[^}]*\}\s*from\s*'@\/navigation\/chrome'/,
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

  it('puts the destinations AND the exit in both bars, not merely somewhere', () => {
    // MUTATION-PROVEN GAP, and the demonstration is the reason this block exists
    // at all: deleting `{exit}` from the phone `<nav>` alone left the `<Link>`
    // count at one, `expectedControls` at three and every responsive-class
    // assertion untouched — 327 tests green on a phone build with navigation and
    // no way to sign out, on the device this story's whole argument is built
    // around. Counting controls says nothing about where they are.
    const bars = navBlocks(source(CHROME));

    // NON-VACUITY, and specifically the count rather than "more than zero": one
    // bar is the mutation where a whole layout was deleted, and three is a `<nav>`
    // nested inside another, which the non-greedy extraction above would report
    // wrongly.
    expect(bars, 'the chrome does not render exactly two navigation bars').toHaveLength(2);

    for (const bar of bars) {
      expect(bar, `a navigation bar renders no destinations: ${bar}`).toContain('{destinations}');
      expect(bar, `a navigation bar renders no exit: ${bar}`).toContain('{exit}');
    }
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
    const collapsible = /<div\s+id="app-destinations"[\s\S]*?<\/div>/.exec(chrome)?.[0] ?? '';

    expect(collapsible, 'no collapsible region to read').not.toBe('');
    expect(collapsible, 'the collapsible region holds no destinations').toContain('{destinations}');
    expect(
      collapsible,
      'the exit is inside the collapsible region, so collapsing hides the way out',
    ).not.toContain('{exit}');
    expect(
      collapsible,
      'the region is not actually collapsed by the toggle state',
    ).toMatch(/className=\{expanded \?/);
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
    const link = linkElements(source(CHROME))[0] ?? '';
    const className = attributeOf(link, 'className') ?? '';

    expect(link, 'the chrome never marks the current destination').toMatch(/aria-current=\{/);
    expect(
      /aria-\[current=page\]:(?:font-bold|font-semibold|underline)/.test(className),
      'the active entry is distinguished by colour alone',
    ).toBe(true);
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

describe('the exit ends the session and says so when it cannot', () => {
  it('routes through the supabase module rather than calling the client inline', () => {
    // The same claim the sign-in screen carries, on the other direction of the
    // same seam: the outcome mapping is in a `.ts` module a node test executes,
    // and the chrome's job is to reach it.
    const chrome = source(CHROME);

    for (const required of ["from '@/supabase/sign-out'", 'signOut(', 'supabaseClient()']) {
      expect(chrome, `the chrome no longer reaches ${required}`).toContain(required);
    }
    // A BARE `fetch(`, matched with a boundary rather than as a substring. The
    // other screens use `not.toContain('fetch(')`, which is correct there and
    // wrong here: this component calls `member.refetch()` to re-read the role,
    // and a substring check reports that as a hand-assembled request. The
    // boundary is what keeps the sweep about what it means — a request built in
    // a component rather than routed through the `@/supabase` modules.
    expect(chrome, 'the chrome assembles a request of its own').not.toMatch(/(?<![\w.])fetch\(/);
    expect(chrome, 'the chrome builds a client of its own').not.toContain('createClient(');
  });

  it('lands the person on a sign-in route, and only once the session actually ended', () => {
    // MUTATION-PROVEN SHAPE, and the mutation is the tempting one: navigating
    // first and reading the outcome after. A refused sign-out leaves the session
    // live, so a navigation on that path lands on a sign-in route the layout's
    // own guard bounces straight back off — which reads as "the button did
    // nothing" rather than as the failure it is.
    const handler = componentFunction(source(CHROME), 'leave');

    expect(handler, 'no sign-out handler to read').not.toBe('');
    expect(handler, 'a successful sign-out does not navigate to a sign-in route').toMatch(
      /navigate\(\{\s*to:\s*'\/prijava'\s*\}\)/,
    );
    expect(handler, 'the refused branch does not put the returned code on screen').toMatch(
      /!outcome\.ok[\s\S]{0,200}?setFailure\(outcome\.code\)/,
    );
    expect(
      handler.indexOf('setFailure(outcome.code)'),
      'the handler navigates before it has read the outcome',
    ).toBeLessThan(handler.indexOf('navigate('));
  });

  it('empties the query cache with the session, which is the shared-device case', () => {
    // `main.tsx` builds ONE `QueryClient` for the page load and a client-side
    // navigation does not reload the page — so without this, `['member-role']`
    // and `['organization']` survive the sign-out and the next person to sign in
    // on the same device sees the previous member's destinations and the
    // previous organization's snapshot until each refetch settles. On a shared
    // shift-work device that is the exact failure the exit exists to prevent.
    //
    // ONLY ON THE REVOKED PATH: clearing after a refused sign-out would throw
    // away a working session's cache for nothing.
    const handler = componentFunction(source(CHROME), 'leave');

    expect(handler, 'the cache outlives the session').toContain('queryClient.clear()');
    expect(
      handler.indexOf('revoked = true'),
      'the cache is cleared before the session is known to have ended',
    ).toBeLessThan(handler.indexOf('queryClient.clear()'));
  });

  it('does not report a failed navigation as a failed sign-out', () => {
    // The session is GONE at that point. Reporting it as a failure tells
    // somebody "Odjava trenutačno nije moguća" while they are already signed
    // out, on a chrome that still looks signed in — the one thing a sign-out
    // control must never say. The console carries the navigation failure; the
    // screen does not contradict the database.
    const handler = componentFunction(source(CHROME), 'leave');

    expect(handler, 'nothing records whether the revocation actually happened').toContain(
      'let revoked = false',
    );
    expect(handler, 'the catch reports every failure as a failed sign-out').toMatch(
      /if \(!revoked\) setFailure\(SIGN_OUT_FAILED\)/,
    );
  });

  it('guards on a ref and clears the in-flight flag on every path', () => {
    // The two defects every handler in this application is swept for: a guard on
    // React state is stale inside a handler already called once this tick, so a
    // double press starts two revocations; and clearing the flag outside a
    // `finally` leaves the control dead after the first refusal, with nothing on
    // screen to say why.
    const handler = componentFunction(source(CHROME), 'leave');
    const block = finallyBlock(source(CHROME));

    expect(handler, 'the sign-out handler has no in-flight guard').toMatch(
      /if\s*\([\s\S]*?leaving\.current[\s\S]*?\)\s*\{?\s*return;/,
    );
    expect(block, 'the sign-out handler has no finally, so a path can leave it in flight').not.toBe(
      '',
    );
    expect(block, 'the finally does not re-enable the control').toContain('setPending(false)');
    expect(block, 'the finally does not clear the in-flight ref').toContain(
      'leaving.current = false',
    );
    expect(handler, 'nothing is surfaced when the call throws outside its own mapping').toMatch(
      /catch[\s\S]{0,400}?setFailure\(/,
    );
  });

  it('logs the cause it cannot render', () => {
    // The catch that swallows `SUPABASE_ENVIRONMENT_MISSING` is how a
    // misconfiguration reads as an outage — the failure `client.ts` exists to
    // prevent and that `prijava.tsx` reintroduced once already.
    expect(source(CHROME), 'the catch reports nothing to the console').toMatch(
      /catch\s*\([\s\S]{0,400}?console\.error\(/,
    );
  });
});

describe('the member list computes nothing it renders', () => {
  /**
   * THE CLASS OF DEFECT THIS CLOSES, and the reason it is a detector rather than
   * three more assertions.
   *
   * `apps/web/vitest.config.ts` collects `src/**\/*.test.ts` in a NODE
   * environment (AD-15), so `routes/ljudi.tsx` is executed by nothing in this
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
   * shows arrives through `@/members/list`, where a node test can execute the
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
        `the member list reads .${field} itself — put the value on MEMBER_COLUMNS, where members/list.test.ts can execute it`,
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
    // The marker's words are `@/members/list`'s decision now
    // (`memberStatusMessageKey`, inside `memberCellLookOf`), where
    // `members/list.test.ts` EXECUTES the pairing of each name cell to its key.
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
    // `members/list.test.ts` pins it against `aria-sort`; what is left in the
    // screen is which glyph each direction draws, and an arrow pointing the
    // wrong way is worse than none because it contradicts a correct `aria-sort`
    // on the same element. A record keyed by the module's own names, asserted
    // pair by pair.
    const screen = source(MEMBER_LIST);

    expect(screen, 'the sort glyphs are no longer a keyed record').toMatch(
      /\[ARROW_UP\]:\s*ArrowUp/,
    );
    expect(screen).toMatch(/\[ARROW_DOWN\]:\s*ArrowDown/);
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
   * AD-13, the shape `organization/snapshot.test.ts` established. Two figures on
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
    { name: 'the team list', file: TEAM_LIST },
    { name: 'the team edit form', file: TEAM_EDIT },
  ])('reads the teams exactly once, under the one team key, on $name', ({ file }) => {
    // STORY 1.7a, AD-13. The rows, both counts and the edited team all come
    // from one read under `TEAMS_LIST_KEY`. The create's organization is the
    // session's own claim, never a second query.
    const screen = source(file);

    expect(occurrences(screen, 'useQuery(')).toBe(1);
    expect(occurrences(screen, 'useQuery(teamsQueryOptions(')).toBe(1);
    expect(occurrences(screen, callOf('readTeams')), 'only the query options call the reader').toBe(0);
    // Every key named — the re-read's — is the one team key.
    expect(occurrences(screen, 'queryKey: TEAMS_LIST_KEY')).toBeGreaterThan(0);
    expect(occurrences(screen, 'queryKey:')).toBe(occurrences(screen, 'queryKey: TEAMS_LIST_KEY'));
    expect(source(TEAM_LIST_KEYS), 'the team read has no cache floor').toContain(
      'staleTime: TEAMS_READ_STALE_MS',
    );
    expect(screen, 'a write is not followed by a re-read of the one list').toContain(
      'invalidateQueries({ queryKey: TEAMS_LIST_KEY })',
    );
    expect(screen, 'useMutation arrived; this repository uses a pending ref').not.toContain(
      'useMutation',
    );
  });

  it.each([
    { name: 'the hour band list', file: HOUR_BAND_LIST },
    { name: 'the hour band edit form', file: HOUR_BAND_EDIT },
  ])('reads the bands exactly once, under the one band key, on $name', ({ file }) => {
    // STORY 2.1b, AD-13. The rows, the count, the bar and the edited band all
    // come from one read under `HOUR_BANDS_LIST_KEY`.
    const screen = source(file);

    expect(occurrences(screen, 'useQuery(')).toBe(1);
    expect(occurrences(screen, 'useQuery(hourBandsQueryOptions(')).toBe(1);
    expect(occurrences(screen, callOf('readHourBands')), 'only the query options call the reader').toBe(0);
    expect(occurrences(screen, 'queryKey: HOUR_BANDS_LIST_KEY')).toBeGreaterThan(0);
    expect(occurrences(screen, 'queryKey:')).toBe(
      occurrences(screen, 'queryKey: HOUR_BANDS_LIST_KEY'),
    );
    expect(source(HOUR_BAND_LIST_KEYS), 'the band read has no cache floor').toContain(
      'staleTime: HOUR_BANDS_READ_STALE_MS',
    );
    expect(screen, 'a write is not followed by a re-read of the one list').toContain(
      'invalidateQueries({ queryKey: HOUR_BANDS_LIST_KEY })',
    );
    expect(screen, 'useMutation arrived; this repository uses a pending ref').not.toContain(
      'useMutation',
    );
  });

  it('enters only a name and a start, and derives nothing on either band screen', () => {
    // STORY 2.1b, AD-3. The window, duration and midnight flag are shown
    // read-only and come from `@/hour-bands/list`, which reads the domain.
    for (const file of [HOUR_BAND_LIST, HOUR_BAND_EDIT]) {
      const screen = source(file);

      expect(inputElements(screen), `${file} enters something besides a name and a start`).toHaveLength(2);
      expect(screen).toContain('type="time"');
      expect(screen, `${file} reaches past the list module into the domain`).not.toContain(
        '@shift/domain',
      );
      expect(screen, `${file} recomputes a band itself`).not.toMatch(
        /\b1440\b|MINUTES_PER_DAY|startMinute\s*[-+%]/,
      );
    }
  });

  it('draws the bar hidden from assistive technology, its uncovered stretch hatched and flagged', () => {
    const bar = componentFunction(source(HOUR_BAND_LIST), 'renderBar');

    expect(bar.length, 'renderBar could not be extracted').toBeGreaterThan(80);
    expect(bar).toContain('aria-hidden={true}');
    expect(bar, 'the uncovered stretch is not hatched').toContain('hatch-uncovered');
    expect(bar, 'the uncovered stretch is not flagged in words').toContain(
      "t('organization.hourBands.uncovered')",
    );
    expect(bar, 'a covered stretch is not labelled with its band').toContain('{segment.name}');
    expect(bar, 'the bar paints a shift type colour').not.toContain('shift-slot');
  });

  it('offers an archived team nothing that writes', () => {
    // An archived team is frozen by the database's update policy; its screen
    // must not offer a control the database will refuse.
    const archived = componentFunction(source(TEAM_EDIT), 'renderArchived');

    expect(archived.length, 'renderArchived could not be extracted').toBeGreaterThan(80);
    expect(archived).not.toMatch(/<(Button|Input|form|select)\b/);
    expect(componentFunction(source(TEAM_EDIT), 'renderTeam')).toMatch(
      /if \(team\.archived\) return renderArchived\(team\);/,
    );
  });

  it('describes the name field by the rename refusal alone', () => {
    const screen = source(TEAM_EDIT);

    expect(screen).toContain('aria-invalid={failure !== null}');
    expect(screen).toContain("aria-describedby={failure === null ? undefined : 'team-form-error'}");
    expect(namedHandler(screen, 'archive'), 'an archive refusal marks the name field').not.toMatch(
      /\bsetFailure\(outcome/,
    );
  });

  it('disarms the archive confirmation when a rename is submitted', () => {
    expect(namedHandler(source(TEAM_EDIT), 'submit')).toContain('setArmed(false)');
  });

  it('remounts the team screen per route id, so no state crosses teams', () => {
    expect(source(TEAM_EDIT)).toMatch(/<TeamScreen key=\{id\} id=\{id\} \/>/);
  });

  it('announces confirmations and never the counts', () => {
    const screen = source(TEAM_LIST);

    expect(occurrences(screen, 'role="status"'), 'only the created confirmation is live').toBe(1);
    expect(screen).toMatch(/role="status"[^>]*>\s*\{t\('smjene\.created'\)\}/);
  });

  it('clears a confirmation when the name is edited again', () => {
    // A confirmation describes the last save, not what is typed now.
    expect(source(TEAM_LIST)).toMatch(/onChange=\{\(\) => \{[\s\S]{0,120}?setCreated\(false\)/);
    expect(source(TEAM_EDIT)).toMatch(/onChange=\{\(\) => \{[\s\S]{0,120}?setSaved\(null\)/);
  });

  it('offers no delete of a team anywhere on the surface', () => {
    // Removing a team archives it; the database refuses a delete from anybody.
    for (const file of [TEAM_LIST, TEAM_EDIT, TEAM_LIST_KEYS, TEAM_WRITE_KEYS]) {
      expect(source(file), `${file} reaches for a delete`).not.toMatch(/\.delete\(/);
      expect(source(file), `${file} writes archived: false`).not.toMatch(/archived:\s*false/);
    }
  });

  it('bounds that read rather than re-running it on every window focus', () => {
    // Several hundred rows AND an exact count, which costs the database a second
    // pass over the same index. `members/list.test.ts` pins that the bound
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
  /** Every field a member row carries, read off the interface in `@/members/list`. */
  function memberRowFields(text: string): string[] {
    const body = /export interface MemberListRow \{([\s\S]*?)\n\}/.exec(text)?.[1] ?? '';

    return [...body.matchAll(/readonly (\w+)\??:/g)].map((found) => found[1] ?? '');
  }

  /** Source with every quoted string emptied, so a key is not a field access. */
  function withoutStrings(text: string): string {
    return text.replace(/'[^'\n]*'/g, "''").replace(/"[^"\n]*"/g, '""');
  }

  /** What a roster member is: an id and a name, and nothing else (CAP-5). */
  const ROSTER_FIELDS = ['id', 'name'];

  const SURFACES = [
    { name: 'the team roster', file: TEAM_ROSTER, read: 'readTeamRoster(', key: 'TEAM_ROSTER_KEY(id)' },
    { name: 'the Danas destination', file: DANAS, read: 'readOwnTeamToday(', key: 'OWN_TEAM_KEY' },
  ];

  it.each(SURFACES)('reads exactly once, under its one key, on $name', ({ file, read, key }) => {
    // AD-13. The roster's name, flag, count and names are one RPC's answer;
    // the Danas line is the caller's own row, derived in `@/teams/roster`.
    const screen = source(file);

    expect(occurrences(screen, 'useQuery(')).toBe(1);
    expect(occurrences(screen, read)).toBe(1);
    expect(occurrences(screen, 'queryKey:')).toBe(1);
    expect(occurrences(screen, `queryKey: ${key}`)).toBe(1);
    expect(screen, 'the read has no cache floor').toContain('staleTime: TEAM_ROSTER_READ_STALE_MS');
  });

  it.each(SURFACES)('offers no write, form or field on $name', ({ file }) => {
    const screen = source(file);

    expect(screen).not.toContain('useMutation');
    expect(screen).not.toMatch(/\.(delete|insert|update|upsert)\(/);
    expect(screen).not.toMatch(/<(form|Input|input|select|textarea|Label)\b/);
    expect(screen, 'a surface reached past `@/teams/roster` for its rules').not.toContain(
      "from '@/members/list'",
    );
  });

  it.each(SURFACES)('reaches for no member field but id and name on $name', ({ file }) => {
    // THE NO-FIELD DETECTOR. Every other field a member row carries — email,
    // username, role, allowance, the histories and the zone — is either not
    // the roster's to show or is derived in `@/teams/roster`, where a node test
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
    const screen = source(DANAS);

    expect(linkElements(screen)).toHaveLength(1);
    expect(screen).toContain('to="/smjene/$id"');
    expect(screen).toContain('params={{ id: shown.team.id }}');
    expect(heightPx(/className="([^"]*)"/.exec(linkElements(screen)[0] ?? '')?.[1] ?? null)).toBeGreaterThanOrEqual(44);
    // The roster's only way out is back to Danas: no other surface links in.
    expect(linkElements(source(TEAM_ROSTER)).map((link) => /to="([^"]+)"/.exec(link)?.[1])).toEqual([
      '/danas',
    ]);
  });
});

describe('every native select draws the one Input look (visual refresh B)', () => {
  /**
   * The six `<select>`s stay native, and their class strings stay LITERAL,
   * because the 44 px sweep reads `h-11` off a quoted `className`. A literal
   * written six times is six places to drift, so this holds all six to one
   * another and to the string `components/README.md` documents. SIX SINCE THE
   * TEAM FILTER: the member list has two, level and team.
   */
  const SELECT_SCREENS = [MEMBER_LIST, MEMBER_CREATE, MEMBER_EDIT, SETTINGS];
  const README = join(srcRoot, 'components', 'README.md');

  function selectClasses(): string[] {
    return SELECT_SCREENS.flatMap((file) =>
      selectElements(source(file)).map((control) => attributeOf(control, 'className') ?? ''),
    );
  }

  it('finds all six, so the comparison is not vacuous', () => {
    expect(selectClasses()).toHaveLength(6);
  });

  it('gives all six the identical class string, and it is the documented one', () => {
    const documented =
      /Select class string:\s*`([^`]+)`/.exec(readFileSync(README, 'utf8'))?.[1] ?? '';

    expect(documented.length, 'README no longer documents the select class string').toBeGreaterThan(0);
    for (const classes of selectClasses()) expect(classes).toBe(documented);
  });
});

describe('the member list filters are dead while unanswered, and the reset restores all three', () => {
  /**
   * TWO I/O ROWS OF THE TEAM FILTER SPEC live only in `ljudi.tsx` markup, which
   * no test executes (AD-15): "unanswered — both selects and reset disabled"
   * and "reset — one press returns search, level and team to their defaults".
   * `isNarrowed` itself is executed in `members/list.test.ts`; what is read here
   * is the wiring. The checks are one pure function over source text, so the
   * self-tests below can prove each mutation fails.
   */
  function filterWiringFaults(text: string): string[] {
    const faults: string[] = [];
    const selects = selectElements(text);
    const inputs = inputElements(text);

    if (selects.length !== 2) faults.push(`expected two selects, found ${String(selects.length)}`);
    if (inputs.length !== 1) faults.push(`expected one Input, found ${String(inputs.length)}`);
    for (const control of [...selects, ...inputs]) {
      if (!control.includes('disabled={unanswered}')) faults.push('a filter control is live while unanswered');
    }

    const reset = buttonElements(text).find((button) => button.includes('onClick={resetFilters}'));
    const disabled = /disabled=\{([^}]*)\}/.exec(reset ?? '')?.[1] ?? '';

    if (reset === undefined) faults.push('no reset button');
    if (!/\bunanswered\b/.test(disabled)) faults.push('the reset is live while unanswered');
    if (!disabled.includes('isNarrowed(')) faults.push('the reset ignores whether anything is narrowed');
    if (!/isNarrowed\(\s*search\s*,\s*level\s*,\s*narrowed\.team\s*\)/.test(disabled)) {
      faults.push('the reset does not judge the search, the level and the applied team');
    }

    const teamSelect = selects.find((control) => control.includes('onChange={changeTeam}'));

    if (!/value=\{\s*narrowed\.team\s*\}/.test(teamSelect ?? '')) {
      faults.push('the team select does not show the team the rows were narrowed by');
    }

    const body = /function resetFilters\(\)[^{]*\{([\s\S]*?)\n {2}\}/.exec(text)?.[1] ?? '';

    for (const [setter, value] of [
      ['setSearch', 'NO_TEXT'],
      ['setLevel', 'ALL_LEVELS'],
      ['setTeam', 'ALL_TEAMS'],
    ] as const) {
      if (!new RegExp(`\\b${setter}\\(\\s*${value}\\s*\\)`).test(body)) {
        faults.push(`the reset does not call ${setter}(${value})`);
      }
    }

    return faults;
  }

  it('disables both selects and the search while unanswered, and the reset restores all three', () => {
    expect(filterWiringFaults(source(MEMBER_LIST))).toEqual([]);
  });

  it.each([
    { name: 'the level select losing its guard', from: 'onChange={changeLevel}\n            disabled={unanswered}', to: 'onChange={changeLevel}' },
    { name: 'the team select losing its guard', from: 'onChange={changeTeam}\n            disabled={unanswered}', to: 'onChange={changeTeam}' },
    { name: 'the search losing its guard', from: 'onChange={changeSearch}\n            disabled={unanswered}', to: 'onChange={changeSearch}' },
    { name: 'the reset dropping unanswered', from: 'disabled={unanswered || !isNarrowed(', to: 'disabled={!isNarrowed(' },
    { name: 'the reset dropping isNarrowed', from: 'disabled={unanswered || !isNarrowed(search, level, narrowed.team)}', to: 'disabled={unanswered}' },
    { name: 'the reset keeping the search', from: '    setSearch(NO_TEXT);\n    setLevel(ALL_LEVELS);', to: '    setLevel(ALL_LEVELS);' },
    { name: 'the reset keeping the level', from: '    setLevel(ALL_LEVELS);\n    setTeam(ALL_TEAMS);', to: '    setTeam(ALL_TEAMS);' },
    { name: 'the reset keeping the team', from: '    setLevel(ALL_LEVELS);\n    setTeam(ALL_TEAMS);', to: '    setLevel(ALL_LEVELS);' },
  ])('would notice $name', ({ from, to }) => {
    const screen = source(MEMBER_LIST);

    expect(screen, 'the mutation no longer applies to the screen').toContain(from);
    expect(filterWiringFaults(screen.replace(from, to)).length).toBeGreaterThan(0);
  });

  it.each([
    { name: 'the team select showing the stored team', from: /value=\{\s*narrowed\.team\s*\}/, to: 'value={team}' },
    {
      name: 'the reset judging the stored team',
      from: /isNarrowed\(\s*search\s*,\s*level\s*,\s*narrowed\.team\s*\)/,
      to: 'isNarrowed(search, level, team)',
    },
    {
      name: 'the reset ignoring the level',
      from: /isNarrowed\(\s*search\s*,\s*level\s*,/,
      to: 'isNarrowed(search, ALL_LEVELS,',
    },
  ])('would notice $name, whatever the whitespace', ({ from, to }) => {
    const screen = source(MEMBER_LIST);

    expect(screen, 'the mutation no longer applies to the screen').toMatch(from);
    expect(filterWiringFaults(screen.replace(from, to)).length).toBeGreaterThan(0);
  });
});

describe('the member list owns exactly one scroll container, and states its count', () => {
  /**
   * `DESIGN.md:150`: wide content scrolls inside its own container, never the
   * page, and it names the member list explicitly. Two things can break that
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
    // `members/list.test.ts` proves the narrowing RETURNS zero; what no
    // executable assertion can reach is the screen deciding not to render it,
    // so the shape that would — a branch on an empty list — is refused here.
    const screen = source(MEMBER_LIST);

    expect(screen, 'the member list never renders its count').toMatch(/t\('ljudi\.count'/);
    expect(
      screen,
      'the member list branches on an empty list, which is how a stated zero disappears',
    ).not.toMatch(/\.length\s*(===|!==|>|<)\s*0/);
  });
});

describe('the keys rendered and the keys declared are the same set', () => {
  /**
   * DEDUPED, which it was not before story 1.3b.
   *
   * `used()` was a sorted concatenation, so a key rendered at two call sites
   * appeared twice and `toEqual` against the declared list failed even though
   * the two SETS were identical — a screen that renders the same message from
   * two branches is an ordinary thing, and the comparison is about sets.
   */
  const used = (): string[] =>
    [...new Set(KEY_SOURCES.flatMap((entry) => entry.keys(source(entry.file))))].sort();

  /** The resource file's screen strings: everything that is not a plural. */
  const declared = (): string[] => resourceKeys().filter((key) => !key.startsWith('count.')).sort();

  it('renders every screen key the resource file declares', () => {
    expect(used()).toEqual(declared());
  });

  it('finds every ljudi key somewhere in the two files that own them, whatever shape it took', () => {
    // THE CATCH-ALL the shape-specific readers cannot be. `memberListKeys` knows
    // two shapes — a `\w*MessageKey` return union and a `label:` entry on the
    // column table — and `translationKeys` knows one, `t('…')`. A key declared
    // any OTHER way (a `Record` literal, a `satisfies`, a third mapping
    // function) is in `hr.json`, renders on screen, and escapes the
    // rendered-versus-declared comparison above entirely, because nothing reads
    // it. This does not care about the shape: every `ljudi.*` key the resource
    // file declares has to appear literally in one of the two files that own
    // this surface, and the comparison above still has to have counted it.
    // FIVE FILES SINCE STORY 1.5b, not two: the `ljudi.form.*` block is rendered
    // by the two member forms and mapped by `@/members/write`, so a sweep over
    // the list and its rules alone would report every one of those keys as
    // declared and written nowhere — or, worse, would have been narrowed to the
    // `ljudi.` prefix it could still find.
    const owned = [MEMBER_LIST, MEMBER_LIST_KEYS, MEMBER_CREATE, MEMBER_EDIT, MEMBER_WRITE_KEYS]
      .map((file) => source(file))
      .join('\n');
    const declared = resourceKeys().filter((key) => key.startsWith('ljudi.'));

    expect(declared.length, 'no ljudi keys to sweep at all').toBeGreaterThan(0);
    for (const key of declared) {
      expect(owned, `${key} is declared in hr.json and written nowhere the readers look`).toContain(
        key,
      );
      expect(
        used(),
        `${key} is written in the source but no reader here counts it — add its shape to memberListKeys`,
      ).toContain(key);
    }
  });

  it('declares every key the two screens render', () => {
    // The same claim from the other side, and not redundant: `toEqual` on two
    // empty arrays would pass, so this pins both lists non-empty.
    expect(used().length).toBeGreaterThan(0);
    for (const key of used()) expect(resourceKeys()).toContain(key);
  });
});

describe('every control on the screen clears the 44 px tap-target floor', () => {
  /**
   * MUTATION-PROVEN GAP. The inherited primitives are `h-9` — 36 px — and the
   * screen composes `h-11` onto each of them. Deleting all four `h-11` classes
   * left 900 tests green while every control on the one screen nobody can skip
   * dropped 8 px below UX-DR40's floor.
   *
   * The height is asserted on the COMPOSED className rather than on the
   * primitive, because that is where the fix lives: the primitives are
   * inherited byte-verbatim and must not be edited.
   */
  it.each([0, 1])('gives input %i a height of at least 44 px', (index) => {
    const element = inputElements(source(SCREEN))[index] ?? '';
    const measured = heightPx(attributeOf(element, 'className'));

    expect(measured, `input ${index} declares no usable height class`).not.toBeNull();
    expect(measured).toBeGreaterThanOrEqual(TARGET_FLOOR_PX);
  });

  it('gives the submit button a height of at least 44 px', () => {
    const element = buttonElements(source(SCREEN))[0] ?? '';
    const measured = heightPx(attributeOf(element, 'className'));

    expect(measured, 'the submit button declares no usable height class').not.toBeNull();
    expect(measured).toBeGreaterThanOrEqual(TARGET_FLOOR_PX);
  });

  it('gives the not-found link the same floor, since it is also a control', () => {
    const element = buttonElements(source(NOT_FOUND))[0] ?? '';
    const measured = heightPx(attributeOf(element, 'className'));

    expect(measured, 'the not-found link declares no usable height class').not.toBeNull();
    expect(measured).toBeGreaterThanOrEqual(TARGET_FLOOR_PX);
  });

  it.each(SCREENS)('clears the floor on every control in $name', ({ file, expectedControls }) => {
    // The named assertions above are the mutation-proven ones and stay. This is
    // the general claim they cannot make: a control added to any screen later,
    // on any of the four, is measured without anyone remembering to add a case
    // — which is how the organization prompt's own two controls got covered.
    const screen = source(file);

    // THREE DETECTORS, not two. `<select>` joined in story 1.4c, and it joined
    // the GENERAL sweep rather than only the named block that introduced it:
    // a control type known to one screen's own block and to nothing else is a
    // control type that escapes the floor and the count everywhere else, which
    // is exactly the state `<Link>` was in until the chrome brought it in.
    const controls = [
      ...inputElements(screen),
      ...buttonElements(screen),
      ...selectElements(screen),
    ];

    // NON-VACUITY. Without this the loop asserts nothing on a screen it finds
    // no controls on, and it already found none on two of the four — so half
    // its cases were passing on an empty set while reading as coverage. It also
    // records the detectors' reach: they match self-closing `<Input />`,
    // `<Button` and `<select` only, so a raw `<button>` or a future primitive is
    // invisible here and the count is what would notice it disappearing.
    expect(controls.length, `no control detected on ${file}`).toBe(expectedControls);

    for (const element of controls) {
      const measured = heightPx(attributeOf(element, 'className'));

      expect(measured, `a control declares no usable height class: ${element}`).not.toBeNull();
      expect(measured).toBeGreaterThanOrEqual(TARGET_FLOOR_PX);
    }
  });
});

describe('the boundary the theme layer raised is the one the control draws', () => {
  /**
   * MUTATION-PROVEN GAP, and the same shape as story 1.1b's original loopback.
   * `--input` was raised to 3.23:1 for WCAG 1.4.11 and measured in
   * `test/theme-contrast.test.ts`; changing one class in `input.tsx` from
   * `border-input` to `border-border` left every ratio true of a token that
   * nothing on screen consumed, with the whole suite green.
   *
   * `test/theme-applied.test.ts` holds the other half — that the BUILT sheet
   * emits a `.border-input` rule. This is the source-level half, so a
   * build-less checkout still refuses the mutation.
   */
  it('draws the text input boundary from --input', () => {
    const primitive = source(INPUT_PRIMITIVE);

    expect(
      primitive,
      'input.tsx no longer names border-input — the raised token is not the one the control draws',
    ).toContain('border-input');
  });

  it('does not draw it from --border, which is pinned below AA on purpose', () => {
    expect(source(INPUT_PRIMITIVE)).not.toContain('border-border');
  });
});

describe('both credential fields carry an accessible name', () => {
  it('gives every input a label bound by htmlFor', () => {
    const screen = source(SCREEN);
    const targets = labelTargets(screen);
    const inputs = inputElements(screen);

    expect(inputs).toHaveLength(2);
    expect(targets).toHaveLength(2);
    for (const input of inputs) {
      const id = attributeOf(input, 'id');

      expect(id, `an <Input> carries no id, so no <Label> can name it`).not.toBeNull();
      expect(targets, `no <Label htmlFor> points at ${String(id)}`).toContain(id);
    }
  });

  it('gives the two fields distinct ids', () => {
    // Two inputs sharing one id satisfies the assertion above — every id is
    // pointed at by some label — while one field goes unnamed and the other is
    // named twice.
    const ids = inputElements(source(SCREEN)).map((input) => attributeOf(input, 'id'));

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain(null);
  });

  it('points every htmlFor at an input that exists', () => {
    // The other direction. A label whose `htmlFor` names nothing is announced
    // as an orphan and names no control at all.
    const ids = inputElements(source(SCREEN)).map((input) => attributeOf(input, 'id'));

    for (const target of labelTargets(source(SCREEN))) {
      expect(ids, `<Label htmlFor="${target}"> points at no input`).toContain(target);
    }
  });

  it('binds the reset guidance and the refusal to the password field', () => {
    // Static text that nothing in the tab order passes through, so
    // `aria-describedby` is the only route to a screen-reader user. Asserted as
    // a RESOLVING reference, not merely a present attribute: every id the
    // attribute can name, in either branch, must be an id this screen renders.
    const screen = source(SCREEN);
    const password = inputElements(screen).find(
      (input) => attributeOf(input, 'type') === 'password',
    );
    const ids = describedByIds(password ?? '');

    expect(ids.length, 'the password field describes nothing').toBeGreaterThan(0);
    for (const id of ids) {
      expect(screen, `no element carries id="${id}"`).toContain(`id="${id}"`);
    }
  });

  it('binds the refusal to the username field too, since it concerns both', () => {
    // One message for the pair. A description reachable from only one of the
    // two fields is unreachable from wherever the person actually is.
    const screen = source(SCREEN);
    const username = inputElements(screen).find(
      (input) => attributeOf(input, 'autoComplete') === 'username',
    );
    const password = inputElements(screen).find(
      (input) => attributeOf(input, 'type') === 'password',
    );
    const shared = describedByIds(username ?? '').filter((id) =>
      describedByIds(password ?? '').includes(id),
    );

    expect(shared, 'the two fields share no description').not.toEqual([]);
    for (const id of shared) expect(screen).toContain(`id="${id}"`);
  });

  it('names the refusal only while the refusal is on the page', () => {
    // The runtime defect a resolving-reference assertion structurally cannot
    // see: `<p id="sign-in-error">` renders only on failure, so a STATIC
    // `aria-describedby="sign-in-error"` described both fields by an element
    // that is absent in the common case. Assistive technology ignores a
    // dangling reference silently, and the source-level lookup above passes
    // either way — the id is in the file.
    //
    // So the shape is asserted, not just the resolution: the error id may only
    // reach the attribute through an expression that branches on the failure.
    const screen = source(SCREEN);
    // VISUAL REFRESH B: the refusal is drawn by the `Notice` primitive, which
    // renders the `<p>`, so the element read here is `<Notice`. Same shape.
    const errorId = /<Notice\s+id="([\w-]+)"\s+role="alert"/.exec(screen)?.[1];

    expect(errorId, 'no role="alert" element to describe the fields by').not.toBeUndefined();

    for (const input of inputElements(screen)) {
      const described = describedByIds(input);

      if (!described.includes(String(errorId))) continue;

      expect(
        attributeOf(input, 'aria-describedby'),
        `a field names ${String(errorId)} unconditionally, so it dangles until something fails`,
      ).toBeNull();
      expect(
        /aria-describedby=\{[^}]*failure[^}]*\}/.test(input),
        'the description is not conditioned on there being a failure',
      ).toBe(true);
    }
  });

  it('keeps the reset guidance bound in BOTH branches, since it never goes away', () => {
    // The other polarity of the conditional. Making the whole attribute
    // conditional on a failure would silently drop the password-reset guidance
    // — permanent, always rendered, and reachable only this way — from every
    // screen that has not failed yet, which is all of them.
    const screen = source(SCREEN);
    const password =
      inputElements(screen).find((input) => attributeOf(input, 'type') === 'password') ?? '';
    const branches = [...(/aria-describedby=\{([^}]*)\}/.exec(password)?.[1] ?? '').matchAll(
      /'([^']*)'/g,
    )].map((found) => idTokens(found[1] ?? ''));

    expect(branches.length, 'the password description is not a two-branch expression').toBe(2);
    for (const branch of branches) {
      expect(branch, 'a branch drops the password-reset guidance').toContain('password-reset');
    }
  });

  it('lets the credential manager fill both fields', () => {
    // `autoComplete` is what makes a saved credential offerable, and the VALUE
    // is what decides it: `off` and `on` are both non-null and neither offers
    // a credential, so a presence check would pass for the shape that breaks
    // every password manager. It is also why the `<form>` element is there at
    // all — outside a form the attribute is ignored.
    const CREDENTIAL_TOKENS = new Set(['username', 'current-password', 'new-password', 'email']);

    for (const input of inputElements(source(SCREEN))) {
      const declared = attributeOf(input, 'autoComplete');

      expect(declared, 'an <Input> declares no autoComplete').not.toBeNull();
      expect(
        CREDENTIAL_TOKENS.has(declared ?? ''),
        `autoComplete="${String(declared)}" is not a credential-manager value`,
      ).toBe(true);
    }
  });

  it('masks the password field', () => {
    const types = inputElements(source(SCREEN)).map((input) => attributeOf(input, 'type'));

    expect(types).toContain('password');
    expect(types).toContain('text');
  });

  it('keeps the phone keyboard out of an admin-issued username', () => {
    const username = inputElements(source(SCREEN)).find(
      (input) => attributeOf(input, 'autoComplete') === 'username',
    );

    expect(attributeOf(username ?? '', 'autoCapitalize')).toBe('none');
    expect(attributeOf(username ?? '', 'autoCorrect')).toBe('off');
    expect(username).toContain('spellCheck={false}');
  });
});

describe('every field on the settings surface carries an accessible name', () => {
  /**
   * The same claims the credential form makes, on the screen that has five
   * fields instead of two (story 1.4a).
   *
   * Written as its own block rather than folded into the one above, because the
   * assertions there are about `type="password"` and `autoComplete="username"` —
   * facts about credentials, not about forms. What generalizes is the binding:
   * `htmlFor`/`id` is the only thing that ties a `<Label>` to its `<Input>`, and
   * getting it wrong leaves a screen reader announcing "edit text, blank" on a
   * field whose value decides what timezone the whole organization renders in.
   */
  it('gives every field a label bound by htmlFor, and every label a field', () => {
    // SIX LABELLED FIELDS since story 1.4c: the five `<Input>`s and the accent
    // `<select>`. The select is counted through its own detector rather than
    // folded into `inputElements`, for the reason `linkElements` is separate —
    // every other screen's `<Input>` count is a tight number, and widening a
    // shared detector to cover one file loosens all of them. What matters here
    // is that nothing on the screen is labelled by accident: every control has
    // an id a `<Label>` names, and every `<Label>` names a control that exists.
    const screen = source(SETTINGS);
    const targets = labelTargets(screen);
    const inputs = inputElements(screen);
    const selects = selectElements(screen);
    const ids = [...inputs, ...selects].map((element) => attributeOf(element, 'id'));

    expect(inputs).toHaveLength(5);
    expect(selects, 'the accent control is not a select any more').toHaveLength(1);
    expect(targets).toHaveLength(6);
    expect(ids, 'a field carries no id, so no <Label> can name it').not.toContain(null);
    expect(new Set(ids).size, 'two fields share one id').toBe(ids.length);
    for (const id of ids) {
      expect(targets, `no <Label htmlFor> points at ${String(id)}`).toContain(id);
    }
    for (const target of targets) {
      expect(ids, `<Label htmlFor="${target}"> points at no field`).toContain(target);
    }
  });

  it('binds the refusal to every field, and only while it is on the page', () => {
    // One message for five fields: a description reachable from only one of them
    // is unreachable from wherever the person actually is. CONDITIONAL, for the
    // reason the sign-in screen's is — the element renders only on a refusal,
    // and a reference to an absent id is ignored in silence, which is worse than
    // no reference because the source-level lookup passes either way.
    const screen = source(SETTINGS);
    // VISUAL REFRESH B: the refusal is drawn by the `Notice` primitive, which
    // renders the `<p>`, so the element read here is `<Notice`. Same shape.
    const errorId = /<Notice\s+id="([\w-]+)"\s+role="alert"/.exec(screen)?.[1];

    expect(errorId, 'no role="alert" element to describe the fields by').not.toBeUndefined();
    expect(screen, `no element carries id="${String(errorId)}"`).toContain(
      `id="${String(errorId)}"`,
    );

    for (const input of inputElements(screen)) {
      expect(describedByIds(input), 'a field describes nothing').toContain(String(errorId));
      expect(
        attributeOf(input, 'aria-describedby'),
        `a field names ${String(errorId)} unconditionally, so it dangles until something fails`,
      ).toBeNull();
      expect(
        /aria-describedby=\{[^}]*refusal[^}]*\}/.test(input),
        'the description is not conditioned on there being a refusal',
      ).toBe(true);
    }
  });

  it('bounds the leave-year day at 28, so the control cannot express the broken case', () => {
    // `0002:106` admits 1-28 by SHAPE rather than by validation, because a leave
    // year starting on the 30th has no boundary in February. The spec's I/O
    // matrix says the control cannot express the value; a `max` of 31 would make
    // it expressible and turn a shape into a refusal somebody has to read.
    const screen = source(SETTINGS);
    const day = inputElements(screen).find((input) => /id="[\w-]*leave-day"/.test(input));
    const month = inputElements(screen).find((input) => /id="[\w-]*leave-month"/.test(input));

    expect(day, 'no leave-year day field on the settings surface').not.toBeUndefined();
    expect(month, 'no leave-year month field on the settings surface').not.toBeUndefined();
    expect(day).toContain('max={28}');
    expect(day).toContain('min={1}');
    expect(month).toContain('max={12}');
    expect(month).toContain('min={1}');
  });

  it('keeps every entered value by never controlling a field', () => {
    // UX-DR34, and the reason this screen is uncontrolled: a refused save must
    // keep all five entered values. `value={…}` on any of them is the shape that
    // loses them on the render that shows the refusal; `defaultValue={…}` is not
    // — it seeds an uncontrolled field and never re-renders it away.
    for (const input of inputElements(source(SETTINGS))) {
      expect(attributeOf(input, 'value'), 'a settings field is controlled').toBeNull();
      expect(input.includes('value={') && !input.includes('defaultValue={')).toBe(false);
    }
  });

  it('delegates the failure-to-message pairing rather than branching on it', () => {
    const screen = source(SETTINGS);

    expect(screen, 'the screen no longer renders its message through the mapping').toContain(
      't(organizationMessageKey(',
    );
    for (const key of [
      'organization.error.refused',
      'organization.error.name',
      'organization.error.invalid',
      'organization.error.timezone',
      'organization.error.unavailable',
    ]) {
      expect(screen, `${key} is branched on in the screen`).not.toContain(key);
    }
  });

  it('builds no request and no client of its own', () => {
    const screen = source(SETTINGS);

    for (const forbidden of ['fetch(', 'createClient(', 'localStorage']) {
      expect(screen, `the settings screen reaches for ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('renders the refusal outside the branch that needs a snapshot to exist', () => {
    // MUTATION-PROVEN GAP, found by the 1.4a review. The alert lived inside
    // `renderSettings`, after its `organization === null` early return — so it
    // was reachable only once a row had been read, and a read that was REFUSED
    // or UNAVAILABLE produced no row, no form, and therefore no message. The
    // one element that explains the failure was behind the success.
    const screen = source(SETTINGS);
    const gated = componentFunction(screen, 'renderSettings');

    expect(gated, 'no renderSettings function to read').not.toBe('');
    expect(screen, 'the screen renders no alert at all').toContain('role="alert"');
    expect(
      gated,
      'the refusal is inside the snapshot-gated branch, so a failed read shows nothing',
    ).not.toContain('role="alert"');
    expect(
      gated,
      'the refusal message is inside the snapshot-gated branch',
    ).not.toContain('organizationMessageKey(');
  });

  it('shows the skeleton only while the read is actually pending', () => {
    // The other half of the same defect. Gated on `organization === null`, the
    // skeleton was what a permanently failed read looked like: an indefinitely
    // pulsing bar, byte-identical to a slow one, with no message and no way
    // forward. UX-DR40 asks for a skeleton rather than a spinner; it does not
    // ask for one that never resolves.
    const gated = componentFunction(source(SETTINGS), 'renderSettings');

    expect(gated, 'no renderSettings function to read').not.toBe('');
    expect(gated, 'the screen renders no skeleton').toContain('animate-pulse');
    expect(
      gated,
      'the skeleton is not conditioned on the query being pending, so a settled failure pulses forever',
    ).toMatch(/isPending[\s\S]{0,120}?animate-pulse/);
  });
});

describe('the logo control the general sweeps structurally cannot see', () => {
  /**
   * STORY 1.4b. Every other control on this screen is an `<Input>` or a
   * `<Button>`, and every sweep above is built on those two detectors. The file
   * picker is neither: it is a bare `<input type="file">` kept off-screen, and
   * the affordance a pointer meets is a `<Button>` that opens it.
   *
   * That split is the right one — a native file input renders its own chrome in
   * the BROWSER's language, which is the one string on this screen that could
   * never come from `hr.json`, and it cannot be sized to UX-DR40's 44 px floor
   * either — but it puts the input outside every general assertion in this file.
   * So each property it would otherwise have inherited is claimed here by name.
   */

  it('keeps exactly one file picker, off-screen but still in the accessibility tree', () => {
    const screen = source(SETTINGS);
    const pickers = bareInputElements(screen);

    // NON-VACUITY first: with no bare input found, every assertion below would
    // pass against an empty string and read as coverage.
    expect(pickers, 'no bare <input> on the settings surface').toHaveLength(1);

    const picker = pickers[0] ?? '';

    expect(attributeOf(picker, 'type'), 'the picker is not a file input').toBe('file');
    expect(attributeOf(picker, 'id'), 'the picker carries no id to open it by').not.toBeNull();
    // `sr-only` and NOT `hidden`: `hidden` removes the control from the
    // accessibility tree and from the tab order, which would leave the logo
    // unreachable by keyboard with the visible button doing nothing for anyone
    // who cannot use a pointer.
    expect(picker, 'the picker is not kept off-screen').toContain('sr-only');
    expect(picker, 'the picker is removed from the accessibility tree').not.toMatch(
      /(^|\s)hidden(\s|$|=)/,
    );
    expect(picker, 'the picker carries no accessible name').toMatch(/aria-label=\{t\(/);
    expect(picker, 'the picker describes nothing when the upload is refused').toMatch(
      /aria-describedby=\{[^}]*refusal[^}]*\}/,
    );
    // DISABLED TOO, and not only the button. Carried on the button alone, a
    // keyboard user reaching the input directly could choose a second file
    // mid-upload and get silence — the in-flight guard returns without a word.
    expect(picker, 'the picker stays live while an upload is in flight').toMatch(
      /disabled=\{[^}]+\}/,
    );
    // The accept hint is DERIVED from the bucket's allowlist rather than typed
    // here, so a hint offering a type the bucket refuses is not expressible.
    expect(picker, 'the accept hint is written by hand rather than derived').toContain(
      'accept={ORGANIZATION_LOGO_ACCEPT}',
    );
  });

  it('gives the picker a visible action that clears the tap-target floor', () => {
    const screen = source(SETTINGS);
    const buttons = buttonElements(screen);

    // FOUR SINCE STORY 2.1b: the link to the hour band editor.
    expect(buttons, 'the settings surface lost a button').toHaveLength(4);

    const choose = buttons.find((element) => element.includes('onClick={openLogoPicker}')) ?? null;

    expect(choose, 'nothing on the screen opens the file picker').not.toBeNull();
    expect(choose, 'the choose action would submit the settings form').toContain('type="button"');
    // THE CONTROL A PERSON ACTUALLY OPERATES is the button, so the refusal has
    // to be reachable from it: describing only the off-screen input leaves the
    // message unreachable from wherever a pointer user actually is.
    expect(choose ?? '', 'the visible action describes nothing when the upload is refused').toMatch(
      /aria-describedby=\{[^}]*refusal[^}]*\}/,
    );
    expect(choose ?? '', 'the in-flight state is not announced').toMatch(/aria-busy=\{[^}]+\}/);

    const measured = heightPx(attributeOf(choose ?? '', 'className'));

    expect(measured, 'the choose action declares no usable height class').not.toBeNull();
    expect(measured).toBeGreaterThanOrEqual(TARGET_FLOOR_PX);
  });

  it('disables both controls while either handler is in flight', () => {
    // ONE MESSAGE REGION, two handlers: a save started while an upload is in
    // flight takes the region from a refusal nobody has read yet, and whichever
    // finished last owned it. Both flags on every control is the half of the fix
    // that is visible; the guards below are the other half.
    const screen = source(SETTINGS);
    // STORY 2.1b's link to the hour band editor NAVIGATES rather than writes,
    // so no in-flight flag applies to it — and exactly one such link exists,
    // so this exemption cannot quietly widen to a write.
    const links = buttonElements(screen).filter((element) => element.includes('asChild'));

    expect(links, 'the settings surface grew a second link').toHaveLength(1);

    for (const element of buttonElements(screen).filter((candidate) => !links.includes(candidate))) {
      expect(
        element,
        `a control is disabled by only some of the in-flight flags: ${element}`,
      ).toMatch(/disabled=\{busy\}/);
    }
  });

  it('never renders a broken image, however the signed URL stops working', () => {
    // A signed URL is a capability with a deadline, so a tab left open past the
    // expiry renders the browser's broken-image glyph — the exact state the
    // acceptance criterion forbids. Two defences, both asserted: the cache is
    // bounded below the expiry, and the element falls back when the load fails
    // for any reason a timer cannot predict.
    //
    // ASSERTED ON THE ONE MODULE THAT FETCHES IT since story 1.4c. Both surfaces
    // read the same logo under the same derived key, and they had a copy of this
    // machinery each — two `queryFn`s for one key, so whichever mounted first
    // owned the fetch and the other copy's bounds were dead code. The three
    // defences are properties of the read, so they live where the read is.
    const reader = source(LOGO_URL);

    expect(reader, 'the derived key is not the snapshot’s own').toContain(
      'queryKey: organizationLogoKey(logoPath)',
    );
    expect(reader, 'the signed URL is cached without regard for its expiry').toContain(
      'staleTime: LOGO_URL_STALE_MS',
    );
    expect(reader, 'a settled refusal is retried as though it were slow').toContain('retry: false');
    expect(reader, 'storage is asked even when the column says there is nothing').toContain(
      'enabled: logoPath !== null',
    );
    expect(reader, 'a URL the browser cannot load is never taken back').toContain(
      'setUnrenderable(readable)',
    );

    // And both surfaces route through it rather than round it.
    for (const file of [SETTINGS, CHROME]) {
      const screen = source(file);

      expect(screen, 'a surface fetches the signed URL itself').toContain('useRenderableLogo(');
      expect(screen, 'a surface still registers its own logo query').not.toContain(
        'queryKey: organizationLogoKey(',
      );
      expect(screen, 'the lockup has no failure path, so a dead URL renders broken').toContain(
        'onUnrenderable={logo.onUnrenderable}',
      );
    }
  });

  it('never sends the logo reference from the form submit', () => {
    // THE CLOBBER the two disjoint write shapes exist to prevent: a save of the
    // five identity fields that also carried `logo_path` would overwrite a logo
    // uploaded seconds earlier, silently, with a PATCH that reports success.
    const handler = submitHandler(source(SETTINGS));

    expect(handler, 'no submit handler to read').not.toBe('');
    expect(handler, 'the identity save carries the logo reference with it').not.toContain(
      'logoPath',
    );
  });

  it('delegates the whole upload rather than sequencing it here', () => {
    // A `.tsx` is collected by nothing (AD-15), so a sequence written here is
    // read as source text and never executed — and the mutation that permits is
    // not subtle: passing `organization.slug` where the policies authorize
    // `organization.id` typechecks, lints, and leaves every assertion in this
    // repository green while every upload is refused 403 at runtime. The
    // sequence, the ordering and the path are executed in `logo.test.ts`
    // against a recorder; what is left to assert here is that the screen ROUTES
    // through it and derives no path of its own.
    const upload = componentFunction(source(SETTINGS), 'uploadLogo');

    expect(upload, 'no uploadLogo function to read').not.toBe('');
    expect(upload, 'the screen no longer routes through the upload module').toContain(
      'replaceOrganizationLogo(',
    );
    expect(upload, 'the screen hands over something other than the snapshot').toMatch(
      /replaceOrganizationLogo\([\s\S]{0,240}?\n\s+organization,/,
    );
    for (const sequenced of ['organizationLogoPath(', 'uploadOrganizationLogo(', 'logoPath:']) {
      expect(
        source(SETTINGS),
        `the screen sequences the upload itself by naming ${sequenced}`,
      ).not.toContain(sequenced);
    }
    expect(upload, 'the refused upload is not put on screen').toMatch(
      /!outcome\.ok[\s\S]{0,160}?setFailure\(outcome\.code\)/,
    );
    // ONE invalidation, and it is the snapshot's key: the derived URL is keyed
    // underneath it, so refetching the row refetches the preview with it.
    expect(upload, 'the preview is not refreshed after an upload').toContain(
      'invalidateQueries({ queryKey: ORGANIZATION_SNAPSHOT_KEY })',
    );
  });

  it('clears the in-flight flag on every path, and guards on both refs not on state', () => {
    // The same two defects the submit handler is swept for, on the second
    // handler this screen grew: `setUploadingLogo(false)` outside a `finally`
    // leaves the button dead after the first refusal, and a guard on state is
    // stale inside a handler already called once this tick.
    //
    // BOTH REFS, in both handlers. They share one message region and
    // `setFailure(null)` here erases whatever the other put there, so a guard
    // on its own flag alone lets one handler wipe a refusal nobody has read.
    const upload = componentFunction(source(SETTINGS), 'uploadLogo');
    const submit = submitHandler(source(SETTINGS));

    expect(upload, 'no uploadLogo function to read').not.toBe('');
    expect(upload, 'the upload has no finally, so a path can leave it in flight').toMatch(
      /\}\s*finally\s*\{/,
    );
    for (const [name, handler] of [
      ['uploadLogo', upload],
      ['submit', submit],
    ] as const) {
      expect(handler, `${name} does not guard on the upload flag`).toMatch(
        /if\s*\([\s\S]*?uploading\.current[\s\S]*?\)\s*\{?\s*return;/,
      );
      expect(handler, `${name} does not guard on the save flag`).toMatch(
        /if\s*\([\s\S]*?saving\.current[\s\S]*?\)\s*\{?\s*return;/,
      );
    }
    expect(upload, 'the finally does not re-enable the action').toContain(
      'setUploadingLogo(false)',
    );
    expect(upload, 'the finally does not clear the in-flight ref').toContain(
      'uploading.current = false',
    );
    expect(upload, 'nothing is surfaced when the call throws outside its own mapping').toMatch(
      /catch[\s\S]{0,200}?setFailure\(/,
    );
  });

  it('logs a read it could not render rather than falling back in silence', () => {
    // A persistently unreadable logo and an organization with no logo look
    // identical on screen, by design — that is the matrix's own row. Which is
    // exactly why the read has to leave a trace somewhere: silence is how a
    // misconfigured bucket stays undiagnosed, and `uploadLogo` already logs.
    // READ OFF THE SHARED MODULE since story 1.4c, and the placement is the
    // claim: the logging sits in the query FUNCTION rather than beside an
    // element, which is what makes "reported once, not per layout" true — the
    // chrome renders the lockup into two bars.
    const reader = componentFunction(source(LOGO_URL), 'signedLogoUrl');

    expect(reader, 'no signedLogoUrl function to read').not.toBe('');
    expect(reader, 'a failed read reports nothing at all').toMatch(
      /!outcome\.ok[\s\S]{0,80}?console\.error\(/,
    );
  });

  it('clears the picker after a chosen file, so the same file can be chosen twice', () => {
    // A file input fires no `change` event when the same file is chosen twice
    // running, so without the reset "the upload was refused, try that file
    // again" does nothing at all — the retry a person is most likely to make.
    const chooser = componentFunction(source(SETTINGS), 'chooseLogo');

    expect(chooser, 'no chooseLogo function to read').not.toBe('');
    expect(chooser, 'the picker is never cleared').toContain('value = NO_FILE_CHOSEN');
    expect(chooser, 'nothing is uploaded when a file is chosen').toContain('uploadLogo(');
  });
});

describe('the screen reaches the authentication seam rather than faking one', () => {
  /**
   * THE INVERSE of story 1.1d's block, which asserted this screen was inert and
   * named `supabase`, `fetch(`, `useState` and `localStorage` as offences. It
   * was self-labelled "until story 1.3 wires it", and this is that story — so
   * the claim is narrowed to the new truth rather than deleted, and the tokens
   * are not renamed to evade it. What is still refused is the shape those
   * tokens were standing in for: a request assembled inline, an address built
   * in a screen, and a submission that leaks a password into the URL.
   */

  it('still keeps a typed password out of the URL, the history and the CDN log', () => {
    // UNCHANGED and still load-bearing, precisely BECAUSE there is a handler
    // now: if the handler ever does not run — a bundle that failed to load, a
    // script error — the browser submits the form itself, and the default
    // method is GET.
    expect(source(SCREEN)).toContain('method="post"');
  });

  it.each(FORM_SCREENS)("routes $name's own onSubmit into its submit handler", ({ file }) => {
    // Scoped to the `<form>` element rather than searched for anywhere in the
    // file: a handler defined and never bound is a screen whose button does
    // nothing, which is exactly what this file used to assert was correct.
    //
    // OVER BOTH FORM SCREENS. Reading only the sign-in screen left the
    // organization prompt — same form, same handler shape — covered by nothing.
    const screen = source(file);
    const formBlock = /<form\b[\s\S]*?<\/form>/.exec(screen)?.[0];

    expect(formBlock, 'no <form>...</form> element on the screen').not.toBeUndefined();
    expect(screen, 'the submit handler is gone').toMatch(/function submit\(/);
    // `\bsubmit\b` rather than `submit(`: one screen binds an arrow that calls
    // it, the other binds the function itself, and both are correct bindings.
    expect(
      formBlock,
      "the form's onSubmit does not reach the screen's submit handler",
    ).toMatch(/onSubmit=\{[\s\S]{0,160}?\bsubmit\b/);
  });

  it.each(FORM_SCREENS)('prevents the default submission first on $name', ({ file, effect }) => {
    // `preventDefault` is no longer the whole handler — it is the first thing
    // the real one does, because a POST to a static host is a 405 that discards
    // every entered value, the opposite of UX-DR34.
    //
    // The old assertion required an inline arrow whose body contained no `}`,
    // which no real handler can satisfy. This asserts the ORDER instead:
    // prevention inside the handler, before the screen's own effect.
    const screen = source(file);

    expect(screen, 'the handler does not prevent the default submission').toMatch(
      /function submit\([\s\S]*?preventDefault\(\)/,
    );
    expect(
      screen.indexOf('preventDefault()'),
      `${effect} runs before the default submission is stopped`,
    ).toBeLessThan(screen.indexOf(effect));
  });

  it('exchanges credentials through the supabase modules, not inline', () => {
    // The positive half of the frozen boundary's replacement. `supabase` is no
    // longer forbidden here — it is REQUIRED, and required as an import of the
    // two modules that own the client and the mapping.
    const screen = source(SCREEN);

    for (const required of [
      "from '@/supabase/client'",
      "from '@/supabase/sign-in'",
      'supabaseClient()',
      'signIn(',
    ]) {
      expect(screen, `the sign-in screen no longer reaches ${required}`).toContain(required);
    }
  });

  it('builds no request and no address of its own', () => {
    // What the forbidden-token sweep was really protecting. A screen that
    // assembled the AD-12 address itself would put the `@`, the slug and the
    // reserved domain in a file where `prijava.test.ts` forbids every literal —
    // and would be a second place for the expression `seed.sql` already holds.
    const screen = source(SCREEN);

    for (const forbidden of ['fetch(', 'shift.invalid', 'localStorage', 'createClient(']) {
      expect(screen, `the sign-in screen reaches for ${forbidden}`).not.toContain(forbidden);
    }
  });

  it.each(FORM_SCREENS)('attaches a ref to every field the handler reads on $name', ({ file }) => {
    // MUTATION-PROVEN GAP, and the mutation was the first draft of this screen.
    // The two `useRef` calls were declared and read in the handler but never
    // put on the `<Input>` elements, so `current` stayed null, the handler
    // returned at its own guard, and the button did nothing at all — with the
    // whole suite green, `pnpm lint` clean and `pnpm typecheck` clean, because
    // the refs ARE used, just not attached.
    //
    // Asserted as a resolving pair rather than as a present attribute: the ref
    // an input names has to be the one the handler dereferences, or this passes
    // for a screen wired to two objects nobody reads.
    const screen = source(file);
    const attached = inputElements(screen).map((input) => /ref=\{(\w+)\}/.exec(input)?.[1] ?? null);

    expect(attached.length, 'no <Input> on a screen that has a form').toBeGreaterThan(0);

    expect(attached, 'an <Input> carries no ref, so the handler cannot read it').not.toContain(null);
    expect(new Set(attached).size, 'two fields share one ref').toBe(attached.length);
    for (const name of attached) {
      expect(screen, `ref ${String(name)} is declared on an input and never created`).toContain(
        `const ${String(name)} = useRef`,
      );
      expect(screen, `ref ${String(name)} is attached and never read`).toContain(
        `${String(name)}.current`,
      );
    }
  });

  it.each(FORM_SCREENS)('guards on $name against a ref that is still null', ({ file }) => {
    // The other half: the handler must not assume the element is there. The
    // guard is what turns the mutation above into a no-op rather than a crash,
    // which is also why the assertion above is needed to notice it happening.
    expect(source(file)).toMatch(/=== null[\s\S]{0,80}?return;/);
  });

  it('has an in-flight screen to sweep at all', () => {
    // NON-VACUITY for the three sweeps below, which run over `IN_FLIGHT_SCREENS`
    // rather than over `FORM_SCREENS`. A `null` written into every entry would
    // make all three loops assert nothing while still reading as coverage —
    // which is the shape the per-screen sweeps were introduced to end.
    // FOUR SINCE STORY 1.5b. Two screens with the identical await-and-refuse
    // shape joined, and the whole reason these sweeps are driven off a list is
    // that the settings surface was covered by none of them until a second
    // screen made the gap obvious.
    // EIGHT SINCE STORY 2.1b: the two hour band screens.
    expect(IN_FLIGHT_SCREENS.length, 'no form screen declares an in-flight ref').toBe(8);
    expect(
      IN_FLIGHT_SCREENS.map((screen) => screen.inFlight).sort(),
      'the in-flight ref names drifted from the screens that hold them',
    ).toEqual([
      'creating',
      'creating',
      'exchanging',
      'issuing',
      'saving',
      'saving',
      'writing',
      'writing',
    ]);
    // NINE HANDLERS OVER SIX SCREENS, and the mismatch is the point: the member
    // edit form owns three awaiting handlers and the team edit form two, and
    // while these sweeps counted SCREENS the extra ones were read by none of
    // them. A list that silently fell back
    // to one entry per file would make every sweep below miss exactly the
    // handler that was added last.
    // TEN SINCE STORY 1.7b: the member edit form's fourth, the team change.
    // THIRTEEN SINCE STORY 2.1b: the band list's add, and the band edit
    // form's save and its removal, which is its own handler.
    expect(IN_FLIGHT_HANDLERS.length, 'an awaiting handler is swept by nothing').toBe(13);
    expect(
      IN_FLIGHT_HANDLERS.map((entry) => `${entry.handler}/${entry.inFlight}`).sort(),
      'the in-flight handler names drifted from the handlers that hold them',
    ).toEqual([
      'archive/writing',
      'changeStatus/statusing',
      'changeTeam/teaming',
      'issue/resetting',
      'remove/writing',
      'submit/creating',
      'submit/creating',
      'submit/exchanging',
      'submit/issuing',
      'submit/saving',
      'submit/saving',
      'submit/writing',
      'submit/writing',
    ]);
    // NON-VACUITY ON THE EXTRACTOR ITSELF. A `namedHandler` that answered `''`
    // for every name would make all three sweeps below assert nothing at all.
    for (const entry of IN_FLIGHT_HANDLERS) {
      expect(
        namedHandler(source(entry.file), entry.handler).length,
        `${entry.handler} on ${entry.file} could not be extracted`,
      ).toBeGreaterThan(80);
    }
  });

  it.each(IN_FLIGHT_HANDLERS)(
    'clears the in-flight flag on every path on $name, and guards on a ref not on state',
    ({ file, handler: named, failure }) => {
      // TWO defects in one shape. `pending` was cleared only on the failure
      // branch, so the moment the awaited call stopped resolving the button was
      // disabled forever with nothing on screen to say why — `finally` is what
      // makes that unreachable. And the guard reads a REF: state is stale inside
      // a handler already called once this tick, so a second submit (double
      // click, Enter as the click lands) fired a second concurrent call.
      //
      // OVER EVERY SCREEN THAT AWAITS SOMETHING, since the 1.4a review. Pinned
      // to the sign-in screen this protected one of the two files with the
      // identical shape, and deleting the settings surface's `finally` was free.
      // SCOPED TO THE HANDLER, since the edit form grew a second one. Read off
      // the whole file, all three of these were satisfied by whichever handler
      // came first and said nothing whatsoever about the other.
      const scoped = namedHandler(source(file), named);

      expect(scoped, `${named} could not be extracted, so nothing below is asserted`).not.toBe('');
      expect(scoped, 'this handler has no finally, so a path can leave it in flight').toMatch(
        /\}\s*finally\s*\{/,
      );

      const guard = /if\s*\([\s\S]*?\)\s*\{?\s*return;/.exec(scoped)?.[0] ?? '';

      expect(guard, 'the in-flight guard reads React state, which is stale within a tick').toMatch(
        /\.current\b/,
      );
      expect(scoped, 'nothing is surfaced when the call throws outside its own mapping').toMatch(
        new RegExp(`catch[\\s\\S]{0,400}?${failure}\\(`),
      );
    },
  );

  it.each(IN_FLIGHT_HANDLERS)('surfaces the refused outcome code on $name', ({ file, handler: named, failure }) => {
    // MUTATION-PROVEN GAP, found by the 1.4a review: deleting
    // `setFailure(outcome.code)` from the settings surface's handler left the
    // whole suite green, and a refused save then looked exactly like a saved
    // one — the button re-enabled, the values still there, nothing said. The
    // `catch` assertion above covers the THROWN path only, and a policy refusal
    // never throws.
    const handler = namedHandler(source(file), named);

    expect(handler, 'no handler to read').not.toBe('');
    // `outcome.code` OR `outcome.refusal`, because story 1.5b's outcome carries
    // one more fact than a code: whether the ordinary fields were written
    // before the rename was refused. A flat code there would discard the half
    // of the answer that says four values really are in the database.
    // The refusal may be WRAPPED on its way to the state — the edit screen
    // scopes it to the member it was raised about, so a refusal from one row
    // cannot stand over another's form — but what reaches `setFailure` has to
    // be the outcome's own, not a constant the handler invented.
    expect(
      handler,
      'the refused branch does not put the returned code on screen',
    ).toMatch(
      new RegExp(
        `outcome\\.ok[\\s\\S]{0,200}?${failure}\\([\\s\\S]{0,80}?outcome\\.(?:code|refusal)`,
      ),
    );
  });

  it('keeps every entered value by never controlling the fields', () => {
    // UX-DR34: a refused save keeps every entered value. Uncontrolled inputs
    // keep what was typed because nothing re-renders them away — so the state
    // this screen holds is the FAILURE, never the credentials. A `value={…}` on
    // either field is the shape that loses them on the render that shows the
    // error.
    const screen = source(SCREEN);

    for (const input of inputElements(screen)) {
      expect(attributeOf(input, 'value'), 'a credential field is controlled').toBeNull();
      expect(input, 'a credential field is controlled').not.toContain('value={');
    }
  });

  it('delegates the failure-to-message pairing rather than branching on it', () => {
    // The screen used to hold `failure === SIGN_IN_REFUSED ? credentials :
    // unavailable`, and nothing could run it: swapping the branches passed
    // every assertion here while a wrong password reported a service outage.
    // The mapping is executed in `sign-in.test.ts` now, and what is left to
    // assert is that the screen ROUTES through it and holds no branch of its
    // own over the codes.
    const screen = source(SCREEN);

    expect(screen, 'the screen no longer renders its message through the mapping').toContain(
      't(signInMessageKey(',
    );
    for (const key of ['auth.error.credentials', 'auth.error.unavailable']) {
      expect(screen, `${key} is branched on in the screen again`).not.toContain(key);
    }
  });

  it('signs in against the slug from the URL, and not one of its own', () => {
    // Nothing pinned this. A hard-coded slug, or `slug` dropped from the
    // credentials object, passed every test in the suite — and would send every
    // sign-in to one tenant, or to none.
    const screen = source(SCREEN);

    expect(screen, 'the screen never reads the slug from the route params').toMatch(
      /const \{\s*slug\s*\}\s*=\s*[\w.]*useParams\(\)/,
    );

    const call = /signIn\(([\s\S]*?)\}\)/.exec(screen)?.[1];

    expect(call, 'the screen does not call signIn at all').not.toBeUndefined();
    expect(call, 'the slug is not among the credentials handed to signIn').toMatch(
      /(?:^|[\s,{])slug\s*,/,
    );
  });

  it('lands a signed-in visitor on / and nowhere else', () => {
    // MUTATION-PROVEN GAP. Nothing in this repository read a `navigate(` call:
    // a grep across every test file returned zero matches, so `to: '/prijava'`
    // here passed the entire suite while a correct sign-in established a
    // session and then dropped the person back on the organization prompt —
    // which, with no signed-in guard on that route, renders as though nothing
    // happened. The story's first acceptance criterion was verified only by
    // somebody remembering to run the manual browser check.
    const handler = submitHandler(source(SCREEN));

    expect(handler, 'the sign-in screen has no submit handler').not.toBe('');
    expect(handler, 'a successful sign-in does not navigate to /').toMatch(
      /navigate\(\{\s*to:\s*'\/'\s*\}\)/,
    );
  });

  it.each(IN_FLIGHT_HANDLERS)(
    'clears the in-flight state inside the finally on $name, not merely near one',
    ({ file, inFlight, handler: named, pending }) => {
      // The assertion this replaces matched `/\}\s*finally\s*\{/` against the
      // whole file, which is the existence of the keyword and nothing about what
      // it does. Deleting `setPending(false)` from inside it passed — and left
      // `pending` true after the first wrong password, so `disabled={pending}`
      // kept the button dead on the most common error path, with the entered
      // values still on screen and no way to retry.
      //
      // The ref NAME comes from the screen's own entry since the 1.4a review.
      // Hard-coded as `exchanging.current = false` this could only ever be true
      // of one file, so the settings surface's `saving` ref was swept by nothing.
      // HANDED ONE HANDLER, not the file. `finallyBlock` returns the FIRST
      // `finally` it finds, so the edit form's second awaiting handler — its
      // password reset — was covered by nothing for as long as this read the
      // whole screen: deleting `setResetPending(false)` left the confirmation
      // stuck busy for ever with the suite green.
      const block = finallyBlock(namedHandler(source(file), named));

      expect(block, `${named} has no finally, so a path can leave it in flight`).not.toBe('');
      // THE SETTER NAME COMES FROM THE ENTRY, for the reason the ref name does:
      // two handlers on one screen hold two different pending flags, and a
      // hard-coded `setPending` is true of one of them by accident.
      expect(block, 'the finally does not re-enable the control').toContain(`${pending}(false)`);
      expect(block, 'the finally does not clear the in-flight ref').toContain(
        `${inFlight}.current = false`,
      );
    },
  );

  it('logs the cause it cannot render', () => {
    // The catch swallowed `SUPABASE_ENVIRONMENT_MISSING` whole while its own
    // comment claimed "the console still carries the stable code". Nothing
    // wrote to the console, so a deployment with no environment showed a
    // working-looking form saying "try again" forever and left no trace
    // anywhere — the misconfiguration-as-outage failure `client.ts` exists to
    // prevent, reintroduced two files downstream.
    const screen = source(SCREEN);

    expect(screen, 'the catch reports nothing to the console').toMatch(
      /catch\s*\([\s\S]{0,600}?console\.error\(/,
    );
  });

  it('requires both credentials before it asks the service about them', () => {
    // The organization prompt marks its one field `required` and says why: the
    // browser's own validation stops an empty submission in the user's own
    // language. The credential form marked neither, so a blank submit reached
    // `normalizeUsername`, was refused locally, and rendered "Korisničko ime
    // ili lozinka nisu točni." — telling somebody their credentials are wrong
    // when they had not entered any. UX-DR34 names the problem instead.
    for (const input of inputElements(source(SCREEN))) {
      expect(input, `a credential field is not required: ${input}`).toContain('required');
    }
  });
});

describe('the organization prompt reaches the tenant it was given', () => {
  it('navigates to the parameterized form with the slug it just validated', () => {
    // MUTATION-PROVEN GAP, and the widest one this story shipped. This hop is
    // the entire product behaviour of the screen, and no test read it: replace
    // the call with `navigate({ to: '/prijava' })` and the prompt silently does
    // nothing on submit; hard-code `params: { slug: 'dvd-kastel-novi' }` and
    // every visitor of every organization is sent to one tenant's form, where
    // their correct credentials are refused with the deliberately
    // indistinguishable message. Both type-check, both keep `slug` referenced
    // so no lint fires, and both passed the whole suite.
    //
    // The PAIR is what matters: the destination must be the parameterized
    // route, and the parameter must be the value `organizationDestination`
    // returned rather than a literal of the handler's own.
    const handler = submitHandler(source(ORGANIZATION));

    expect(handler, 'the organization prompt has no submit handler').not.toBe('');
    expect(handler, 'the prompt does not navigate to the per-tenant form').toMatch(
      /navigate\(\{\s*to:\s*'\/prijava\/\$slug'/,
    );
    expect(handler, 'the prompt derives no slug from what was typed').toMatch(
      /const\s+slug\s*=\s*organizationDestination\(/,
    );
    expect(handler, 'the slug handed to the route is not the validated one').toMatch(
      /params:\s*\{\s*slug\s*\}/,
    );
  });

  it('surfaces a rejected navigation instead of discarding it', () => {
    // `void navigate(...)` on a promise that rejects is an unhandled rejection:
    // the prompt stays put with no explanation and nothing in the console. The
    // sign-in screen's equivalent call is inside a try/catch for the same
    // reason. No message reaches the screen — one would begin the enumeration
    // oracle this screen is built to avoid — so the console is the whole of it.
    const handler = submitHandler(source(ORGANIZATION));

    expect(handler, 'a rejected navigation is discarded rather than reported').toMatch(
      /navigate\([\s\S]{0,200}?\.catch\(/,
    );
    expect(handler, 'the rejected navigation reports nothing').toContain('console.error(');
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
    for (const file of [SETTINGS, CHROME]) {
      const screen = source(file);

      expect(screen, 'a surface renders the lockup twice or not at all').toContain(
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
    // `expectedControls: 0` above says nothing was COUNTED; this says nothing
    // is there. The lockup is 32 px in the phone bar, which is only defensible
    // while it is not pressable — an `onClick` here would put a target 12 px
    // under UX-DR40's floor on every signed-in screen in the application.
    const lockup = source(LOCKUP);

    for (const forbidden of ['onClick', '<Button', '<Link', 'href', 'navigate(']) {
      expect(lockup, `the lockup carries ${forbidden}, which makes it a control`).not.toContain(
        forbidden,
      );
    }
  });
});

describe('the lockup reaches both layouts, not merely the one on a laptop', () => {
  /**
   * MUTATION-PROVEN GAP, and the same one `{exit}` closed: the destinations and
   * the exit are rendered into two bars from two variables, and deleting one of
   * the two references leaves every count, every responsive class and every
   * accessible name untouched. A lockup in the sidebar alone is a phone build
   * with no branding at all, on the device this epic's whole argument is built
   * around — and nobody testing at laptop width would ever see it.
   */
  /**
   * The phone layout's sticky container.
   *
   * It is a `<div>` rather than the `<nav>` since the 1.4c review: the lockup is
   * branding, not a destination, so it belongs outside the navigation landmark —
   * and it was inside this one while sitting outside the sidebar's, which made a
   * phone announce an image as part of the navigation that a laptop correctly
   * did not. The wrapper holds the lockup and the landmark, exactly as the
   * `<aside>` does. Non-greedy to its own closing tag, which is correct while it
   * holds no nested `<div>`; the consumers assert what is inside it, so the day
   * one arrives fails loudly rather than silently widening.
   */
  const phoneBar = (chrome: string): string =>
    /<div\s+className=\{`sticky[\s\S]*?<\/div>/.exec(chrome)?.[0] ?? '';

  it('renders the lockup once, into the sidebar and into the phone bar', () => {
    const chrome = source(CHROME);
    const aside = /<aside\b[\s\S]*?<\/aside>/.exec(chrome)?.[0] ?? '';
    const bar = phoneBar(chrome);

    expect(aside, 'no <aside> to read').not.toBe('');
    expect(bar, 'no phone bar to read').not.toBe('');

    // COMPUTED ONCE and rendered twice, exactly as `destinations` and `exit`
    // are: two copies of the element would be two places for the fallback, the
    // accessible name and the accent to drift, and two console entries for one
    // unreadable logo.
    expect(
      [...chrome.matchAll(/<OrganizationLockup\b/g)],
      'the chrome builds more than one lockup',
    ).toHaveLength(1);
    expect(aside, 'the sidebar renders no lockup').toContain('{lockup}');
    expect(bar, 'the phone bar renders no lockup').toContain('{lockup}');
  });

  it('keeps the lockup out of both navigation landmarks, not just one of them', () => {
    // BRANDING IS NOT A DESTINATION. The lockup sat inside the phone `<nav>` and
    // outside the sidebar's until the 1.4c review, so the same image was part of
    // the navigation landmark on a phone and not on a laptop — and it sat inside
    // the `overflow-x-auto` region whose own comment says nine 44 px targets
    // already do not fit across a phone, stealing width from them and scrolling
    // away from the person it identifies.
    const chrome = source(CHROME);
    const bars = navBlocks(chrome);

    expect(bars, 'the chrome does not render exactly two navigation bars').toHaveLength(2);
    for (const bar of bars) {
      expect(bar, `a navigation landmark carries the lockup: ${bar}`).not.toContain('{lockup}');
      // And the destinations and the exit are still INSIDE the landmark, which
      // is the half this could otherwise break by moving everything out.
      expect(bar, `a navigation bar renders no destinations: ${bar}`).toContain('{destinations}');
      expect(bar, `a navigation bar renders no exit: ${bar}`).toContain('{exit}');
    }
    // The scroller is the landmark, so the lockup is beside it rather than in it.
    expect(
      phoneBar(chrome).slice(0, phoneBar(chrome).indexOf('<nav')),
      'the lockup is not the phone bar’s first child, before the scrolling landmark',
    ).toContain('{lockup}');
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

    expect(chrome, 'the chrome does not read the organization at all').toContain(
      'queryKey: ORGANIZATION_SNAPSHOT_KEY',
    );
    expect(chrome, 'the chrome spells the snapshot key by hand').not.toContain("['organization']");
    expect(chrome, 'the chrome fetches the signed URL itself').toContain('useRenderableLogo(');
  });

  it('bounds the read it performs on every signed-in screen', () => {
    // THE COST OF READING EVERYWHERE. The settings surface's copy of this read
    // is a screen somebody opens deliberately; this one mounts on every
    // destination, so unbounded it refetches the row on every navigation and
    // every window focus — for a border colour and a logo — and retries a
    // transport fault three times before settling.
    const chrome = source(CHROME);
    const read = /const organizationRead = useQuery\(\{[\s\S]*?\n {2}\}\);/.exec(chrome)?.[0] ?? '';

    expect(read, 'no organization query to read').not.toBe('');
    expect(read, 'the chrome re-reads the organization on every mount and focus').toContain(
      'staleTime: ORGANIZATION_READ_STALE_MS',
    );
    expect(read, 'a settled refusal is retried as though it were slow').toContain('retry: false');
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
    // width where both are in the tree.
    const chrome = source(CHROME);
    const reader = componentFunction(chrome, 'readBranding');

    expect(reader, 'no readBranding function to read').not.toBe('');
    expect(reader, 'an unreadable organization is never reported at all').toMatch(
      /!outcome\.ok[\s\S]{0,80}?console\.error\(/,
    );
    expect(
      chrome,
      'the organization read feeds the alert region, which is about the role and the exit',
    ).not.toMatch(/organizationMessageKey\(/);
  });
});

describe('the accent control offers a curated set and nothing else', () => {
  /**
   * STORY 1.4c, and this block exists for the reason the logo picker's does:
   * the control is a native `<select>`, which is neither an `<Input>` nor a
   * `<Button>`, so every general sweep in this file structurally cannot see it.
   * Each property it would otherwise have inherited is claimed here by name.
   */

  it('is exactly one select, with an accessible name and the 44 px floor', () => {
    const screen = source(SETTINGS);
    const selects = selectElements(screen);

    // NON-VACUITY first: with no `<select>` found, every assertion below would
    // pass against an empty string and read as coverage.
    expect(selects, 'no accent control on the settings surface').toHaveLength(1);

    const control = selects[0] ?? '';
    const id = attributeOf(control, 'id');

    expect(id, 'the accent control carries no id to name it by').not.toBeNull();
    expect(screen, `no <Label htmlFor="${String(id)}">`).toContain(`htmlFor="${String(id)}"`);
    expect(labelTargets(screen), 'the accent control is not labelled').toContain(String(id));
    expect(control, 'the accent control describes nothing when the write is refused').toMatch(
      /aria-describedby=\{[^}]*refusal[^}]*\}/,
    );
    expect(control, 'the in-flight state is not announced').toMatch(/aria-busy=\{[^}]+\}/);
    // DISABLED BY THE OTHER TWO HANDLERS AND NOT BY ITS OWN WRITE. `disabled` on
    // an element that currently has focus moves focus to `<body>`, so a control
    // that disables itself from inside its own `onChange` ejects every keyboard
    // user from it on every choice — and then re-enables itself somewhere they
    // are no longer standing. Its own second change is serialised instead.
    expect(control, 'the accent control is not locked while another write runs').toMatch(
      /disabled=\{writingElsewhere\}/,
    );
    expect(
      control,
      'the accent control disables itself from inside its own change handler',
    ).not.toMatch(/disabled=\{busy\}/);

    const measured = heightPx(attributeOf(control, 'className'));

    expect(measured, 'the accent control declares no usable height class').not.toBeNull();
    expect(measured).toBeGreaterThanOrEqual(TARGET_FLOOR_PX);

    // THE AFFORDANCES ITS FIVE NEIGHBOURS GET FROM THE PRIMITIVE. This one is a
    // native element styled by hand, so everything `components/ui/input.tsx`
    // composes it has to be composed here — and the two that are invisible in a
    // screenshot are the two that matter: a keyboard user with no focus ring
    // cannot see where they are, and a disabled control that looks identical to
    // a live one is a control people press. The boundary is `--input`'s, which
    // is the token story 1.1d raised to 3.23:1 for WCAG 1.4.11.
    const composed = attributeOf(control, 'className') ?? '';

    expect(composed, 'the accent control draws no focus indicator').toContain(
      'focus-visible:ring-ring',
    );
    expect(composed, 'the accent control looks the same disabled as live').toContain(
      'disabled:opacity-50',
    );
    expect(composed, 'the accent control does not draw the raised input boundary').toContain(
      'border-input',
    );
  });

  it('offers the curated options rather than a set written into the screen', () => {
    // A LIST WRITTEN HERE would be a fifth copy of the accent set — after the
    // check constraint, the tokens, the module and `hr.json` — and the one
    // copy no test could compare against the others. The options come from the
    // module `accent.test.ts` pins to `0006`, and their names come from the
    // mapping it executes.
    const screen = source(SETTINGS);

    expect(screen, 'the options are not read off the curated set').toContain(
      'BRAND_ACCENT_OPTIONS.map(',
    );
    expect(screen, 'the option names are not resolved through the tested mapping').toContain(
      't(accentMessageKey(option))',
    );
  });

  it('offers no way to express a colour, which is the whole of the curation', () => {
    // The frozen "Never": no free-form colour input, no hex field, no colour
    // picker. Every colour in this application has its contrast measured at
    // BUILD time, and any of these three would move that guarantee to runtime —
    // which would need a contrast function in `apps/web/src`, where there is
    // none.
    const screen = source(SETTINGS);

    expect(screen, 'the screen offers a native colour picker').not.toContain('type="color"');
    expect(screen, 'the screen accepts a hand-written colour').not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    for (const forbidden of ['oklch(', 'rgb(', 'hsl(', 'setProperty']) {
      expect(screen, `the screen names ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('serialises a second choice rather than dropping it', () => {
    // A `<select>` fires a change per ARROW KEY in several browsers, so somebody
    // arrowing to the accent they want passes through the ones in between —
    // and a handler that returns early while a write is in flight would leave
    // the row holding whichever one they passed through first. Latest wins: the
    // choice made over the top is held and applied when the first settles.
    const accentWrite = componentFunction(source(SETTINGS), 'applyAccent');

    expect(accentWrite, 'no applyAccent function to read').not.toBe('');
    expect(accentWrite, 'a second choice is dropped on the floor').toMatch(
      /tinting\.current[\s\S]{0,120}?queuedAccent\.current = accent/,
    );
    expect(accentWrite, 'the queued choice is never applied').toMatch(
      /finally[\s\S]{0,400}?applyAccent\(next\)/,
    );
  });

  it('keeps a failed refetch out of the write’s own outcome', () => {
    // The row has already changed by the time the invalidation runs, so a
    // refetch that rejects must not be reported as a refused save: that tells
    // somebody their accent was rejected while the database holds it and the
    // next reload shows it. Its own `catch`, and no `setFailure` inside it.
    const accentWrite = componentFunction(source(SETTINGS), 'applyAccent');
    const invalidation =
      /try \{\s*await queryClient\.invalidateQueries[\s\S]*?catch[\s\S]*?\n {6}\}/.exec(
        accentWrite,
      )?.[0] ?? '';

    expect(invalidation, 'the invalidation is not guarded at all').not.toBe('');
    expect(invalidation, 'a failed refetch reports the landed write as refused').not.toContain(
      'setFailure(',
    );
    expect(invalidation, 'a failed refetch is swallowed in silence').toContain('console.error(');
  });

  it('shows what the row holds beside the control that changes it', () => {
    // THE ONLY CONFIRMATION this write gets. Every other write on this screen is
    // attached to a Save button, so its `aria-busy` going off beside a button
    // the person pressed is the signal; the accent writes on change, and
    // `aria-busy` alone announces that something started and never that it
    // landed. `role="status"` rather than a second `role="alert"`, which would
    // be a second assertive thing competing to be announced.
    //
    // READ OUT OF THE SNAPSHOT and not out of the control, which is the half
    // that makes it honest: after a refusal the control shows what was chosen
    // and this shows what the database holds, and the difference is the thing
    // somebody needs to see.
    const screen = source(SETTINGS);

    expect(screen, 'nothing reports what the stored accent is').toContain('role="status"');
    expect(screen, 'the status line is read off the control rather than the row').toContain(
      'storedAccentLabel(organization.brandAccent)',
    );
    // AND IT SAYS WHAT THE ROW HOLDS even when this build has no name for it.
    // `accentMessageKey` folds an unrecognised key to `Neutralna`, which is
    // right for the class it resolves and a lie here.
    const label = componentFunction(screen, 'storedAccentLabel');

    expect(label, 'no storedAccentLabel function to read').not.toBe('');
    expect(label, 'the status line renames an accent it cannot resolve').toMatch(
      /brandAccentOf\(accent\) === null && accent !== null/,
    );
  });

  it('shows an accent this build cannot render rather than claiming there is none', () => {
    // A row written by a newer build is an ordinary state during a deploy.
    // Collapsed into `Neutralna`, the control claimed the organization had no
    // accent AND made every other option unreachable by keyboard — selecting the
    // option already shown fires no change event, so there was no path back to
    // the `null` the screen was claiming to display. Rendered as its own option,
    // the row is described honestly and every other option is one change away.
    const screen = source(SETTINGS);

    expect(screen, 'an unrenderable stored accent is hidden behind the neutral option').toMatch(
      /brandAccentOf\(organization\.brandAccent\) === null &&/,
    );
    expect(screen, 'the unknown option carries no value').toContain(
      '<option value={organization.brandAccent}>',
    );
    // Its label is the stored VALUE, because this build has no name for it —
    // and data is never a key.
    expect(screen, 'the unknown accent is given a translated name it cannot have').toContain(
      '{organization.brandAccent}</option>',
    );
  });

  it('writes the accent on its own, never on the form submit', () => {
    // THE CLOBBER the three disjoint write shapes exist to prevent, and the
    // accent's case is the sharper one: its control sits INSIDE the form, so a
    // submit that also carried `brandAccent` would overwrite a choice made
    // while somebody was typing, and an accent write that carried the five
    // fields would push a half-typed name the moment the picker was touched.
    const screen = source(SETTINGS);
    const handler = submitHandler(screen);
    const accentWrite = componentFunction(screen, 'applyAccent');

    expect(handler, 'no submit handler to read').not.toBe('');
    expect(handler, 'the identity save carries the accent with it').not.toContain('brandAccent');
    expect(accentWrite, 'no applyAccent function to read').not.toBe('');
    expect(accentWrite, 'the accent write does not go through the tested module').toContain(
      'updateOrganization(',
    );
    expect(accentWrite, 'the accent write carries the identity fields with it').not.toContain(
      'nameField',
    );
    // ONE INVALIDATION, under the key the chrome reads too, so the shell tints
    // itself from the same refetch rather than from a second read.
    expect(accentWrite, 'nothing refreshes the shell after the accent is written').toContain(
      'invalidateQueries({ queryKey: ORGANIZATION_SNAPSHOT_KEY })',
    );
  });

  it('keeps the choice on screen when the write is refused', () => {
    // UX-DR34: a refused save names the problem and keeps every entered value.
    // The control is UNCONTROLLED like the five inputs beside it — `defaultValue`
    // and no `value` — so a refusal leaves it showing what was chosen instead of
    // snapping back to the stored accent, which would look like the press did
    // nothing.
    const control = selectElements(source(SETTINGS))[0] ?? '';

    expect(control, 'no accent control to read').not.toBe('');
    expect(control, 'the accent control is not seeded from the snapshot').toContain(
      'defaultValue={organization.brandAccent ?? NO_BRAND_ACCENT}',
    );
    // REMOUNTED WHEN THE ROW CHANGES. `defaultValue` sets `defaultSelected` at
    // MOUNT and never again, so after a successful write the element's RESET
    // state still named the accent the row held when the screen opened — and
    // `Cancel` is `type="reset"`, so pressing it snapped the control back to an
    // accent the database no longer holds while the shell stayed tinted.
    expect(control, 'the control never remounts, so Cancel restores a stale accent').toContain(
      'key={organization.brandAccent ?? NO_BRAND_ACCENT}',
    );
    expect(control, 'the accent control is controlled, so a refusal discards the choice').not.toMatch(
      /(?<![A-Za-z])value=\{/,
    );
  });
});

/** The closed set `aria-current` admits (WAI-ARIA 1.2). Nothing else is a
 *  state; everything else is text, and text is what the allowlist exempted this
 *  attribute on the promise of never carrying. */
const ARIA_CURRENT_VOCABULARY = new Set(['page', 'step', 'location', 'date', 'time', 'true', 'false']);

describe('the two member forms write through the seam and keep nothing back', () => {
  /**
   * Story 1.5b's screens, swept for the four things no node test could see any
   * other way — and every one of them is a claim about a `.tsx`, which is
   * executed by nothing at all (AD-15).
   *
   * The BEHAVIOUR of the write path — the PostgREST-versus-function branch, the
   * partial save, the form gates — is executed in `members/write.test.ts`
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
    // confirmation, in flight, shown — is `resetStageOf` in `@/members/write`,
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
    // `organizacija.tsx:551-561`'s gating, copied IN FULL. Gated on "there is no
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

  it('remounts the edit form with the row, so a refetch cannot leave it stale', () => {
    // Every field is uncontrolled, so `defaultValue` seeds the DOM at MOUNT and
    // never again — and this screen refetches after every successful save.
    // Without the key the fields show what the row held when the screen opened,
    // and `Odustani`, which is `type="reset"`, snaps them back to that. The
    // fingerprint itself is executed in `write.test.ts`; what is pinned here is
    // that the form actually carries it.
    expect(source(MEMBER_EDIT), 'the edit form never remounts with its row').toMatch(
      /<form\s+key=\{memberFormKey\(member\)\}/,
    );
  });

  it.each([
    { name: 'the member create form', file: MEMBER_CREATE },
    { name: 'the member edit form', file: MEMBER_EDIT },
  ])('gives $name a way back to the list that is not a reset', ({ file }) => {
    // NEITHER ROUTE IS A DESTINATION, so the chrome offers no way off either
    // screen — and `type="reset"` restores the fields rather than leaving. A
    // screen reachable by URL whose only exit is the browser's Back button is a
    // dead end on a phone, where the tab bar is the only other navigation.
    const screen = source(file);
    const links = linkElements(screen);

    expect(links, 'the screen offers no link at all').toHaveLength(1);
    expect(attributeOf(links[0] ?? '', 'to'), 'the way back does not go to the list').toBe('/ljudi');
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

  it.each([
    { name: 'the member create form', file: MEMBER_CREATE },
    { name: 'the member edit form', file: MEMBER_EDIT },
  ])('delegates the failure-to-message pairing on $name rather than branching', ({ file }) => {
    // The shape every screen in this application is held to: a ternary over
    // codes written in a `.tsx` is executed by nothing, and swapping two of its
    // branches reports a taken username as a service outage with the suite
    // green. `memberWriteMessageKeys` is executed in `write.test.ts`.
    const screen = source(file);

    expect(screen, 'the screen no longer renders its message through the mapping').toContain(
      'memberWriteMessageKeys(refusal)',
    );
    for (const key of ['ljudi.form.error.refused', 'ljudi.form.error.usernameTaken']) {
      expect(screen, `${key} is branched on in the screen`).not.toContain(key);
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
    expect(
      handler.indexOf('setFailure(outcome.refusal)'),
      'the list is refreshed before the refusal is surfaced, so a failed refresh replaces it',
    ).toBeLessThan(handler.indexOf('invalidateQueries('));
    expect(handler, 'the refresh can still take the refusal down with it').toMatch(
      /try \{[^}]*invalidateQueries\([\s\S]{0,160}?\}\s*catch/,
    );
  });

  it('invalidates the member list rather than patching what it believes it wrote', () => {
    // `organizacija.tsx:254`'s rule, and there is no `useMutation` anywhere in
    // this application to carry an optimistic patch instead. What is on screen
    // after a write is what the database holds.
    for (const file of [MEMBER_CREATE, MEMBER_EDIT]) {
      expect(source(file), 'the write does not refresh the list').toMatch(
        /invalidateQueries\(\{\s*queryKey:\s*MEMBERS_LIST_KEY\s*\}\)/,
      );
    }
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
    { name: 'the member create form', file: MEMBER_CREATE },
    { name: 'the member edit form', file: MEMBER_EDIT },
  ])('names the offending field on $name when it refuses one itself', ({ file }) => {
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
    // The mark is CLEARED before the next attempt, or a corrected field stays
    // announced as invalid for the rest of the session.
    expect(handler, 'the invalid mark is never cleared').toContain('setInvalidField(null)');

    const marked = inputElements(screen).filter((input) => input.includes('aria-invalid'));

    expect(marked, 'no control carries aria-invalid at all').toHaveLength(1);
    expect(
      attributeOf(marked[0] ?? '', 'id'),
      'the marked control is not the one the refusal is about',
    ).toBe('member-leave');
  });

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
      /<TableHead>\{t\('ljudi\.form\.actions'\)\}<\/TableHead>/,
    );
  });

  it('names the row action after the member it acts on', () => {
    // Four hundred rows announcing the same three words is four hundred
    // controls a screen-reader user cannot tell apart. WHICH field names it is
    // a decision, and it lives in `@/members/list` where `list.test.ts`
    // executes it — `member.email` here would announce every address in the
    // organization, and a tenth of the rows carry none.
    const screen = source(MEMBER_LIST);

    expect(screen, 'the row action does not interpolate the member').toMatch(
      /t\('ljudi\.form\.edit',\s*\{\s*name:\s*memberActionName\(member\)\s*\}\)/,
    );
  });
});

describe('the exempted attribute keeps the promise that exempted it', () => {
  /**
   * `aria-current` went onto the GLOBAL `STRUCTURAL_ATTRIBUTES` allowlist, which
   * excuses it from the literal sweep on EVERY screen in the application — and
   * the argument that earned the exemption was that its vocabulary is closed and
   * non-textual. An argument is not an enforcement: `aria-current="Danas"` is a
   * user-facing Croatian literal sitting in the one attribute nothing else now
   * looks at, and it would render to a screen reader as the element's current
   * state. This is the enforcement.
   */
  it('admits only ARIA state values wherever aria-current appears', () => {
    const found = SCREENS.flatMap(({ file }) => ariaCurrentValues(source(file)));

    // NON-VACUITY. With no `aria-current` anywhere the loop asserts nothing while
    // reading as coverage — which is the state every screen but the chrome is in,
    // so the count has to come from the sweep rather than be assumed.
    expect(found.length, 'no aria-current anywhere, so this sweep proves nothing').toBeGreaterThan(
      0,
    );
    for (const value of found) {
      expect(
        ARIA_CURRENT_VOCABULARY.has(value),
        `aria-current="${value}" is not an ARIA state — it is text in an attribute the allowlist exempted`,
      ).toBe(true);
    }
  });

  /**
   * `aria-sort` joined the same global allowlist in story 1.5a, on the same
   * argument, and it is held to the same enforcement — GLOBALLY, over every
   * swept screen, rather than over the one screen that introduced it. That
   * scoping is the finding: the allowlist applies to all fourteen, so a
   * justification drawn from one of them buys an exemption on the other
   * thirteen, and `aria-sort="Ime"` on any of them would be a Croatian literal
   * in an attribute nothing else looks at.
   */
  const ARIA_SORT_VOCABULARY = new Set(['ascending', 'descending', 'other', 'none']);

  it.each(SCREENS)('admits only ARIA validity states wherever aria-invalid is quoted in $name', ({ file }) => {
    // What pays for `aria-invalid`'s place on the global allowlist. The member
    // forms write it as an expression, so this finds nothing on them today —
    // which is exactly the state `aria-current` and `aria-sort` are in on
    // fifteen of the sixteen screens, and the sweep is about the attribute
    // rather than about the screen that introduced it.
    for (const value of ariaInvalidValues(source(file))) {
      expect(['true', 'false', 'grammar', 'spelling'], `aria-invalid="${value}"`).toContain(value);
    }
  });

  it('reads aria-invalid in the quoted syntax, and finds none where there is none', () => {
    // BOTH POLARITIES. A reader that matched nothing would make the sweep above
    // pass on a screen carrying a Croatian sentence in that attribute.
    expect(ariaInvalidValues('<input aria-invalid="true" />')).toEqual(['true']);
    expect(ariaInvalidValues('<input aria-invalid="Dani godišnjeg odmora" />')).toEqual([
      'Dani godišnjeg odmora',
    ]);
    expect(ariaInvalidValues('<input aria-invalid={flag} />')).toEqual([]);
    expect(ariaInvalidValues('<input />')).toEqual([]);
  });

  it('admits only ARIA sort states wherever aria-sort is written as a literal', () => {
    const found = SCREENS.flatMap(({ file }) => ariaSortValues(source(file)));

    for (const value of found) {
      expect(
        ARIA_SORT_VOCABULARY.has(value),
        `aria-sort="${value}" is not an ARIA sort state — it is text in an attribute the allowlist exempted`,
      ).toBe(true);
    }
    // NO NON-VACUITY GUARD ON `found`, deliberately, and the case below is why:
    // the one screen that uses the attribute COMPUTES its value rather than
    // writing one, so an empty result here is the correct state of the world
    // rather than a sweep that has gone quiet. The reader's own reach is proved
    // on synthetic sources below, and what the computed value can be is pinned
    // by the case that follows.
    expect(found, 'a screen writes an aria-sort literal — see the case below').toEqual([]);
  });

  it('computes every aria-sort value through the function pinned to that vocabulary', () => {
    // WHERE THE ENFORCEMENT ACTUALLY LIVES for the one screen that uses it.
    // `aria-sort={sortStateOf(sort, column.key)}` cannot carry a Croatian word,
    // because `sortStateOf` returns one of three ARIA states and
    // `members/list.test.ts` pins it against those three literally. A screen
    // that started computing the attribute some other way would escape both this
    // and the literal sweep above, so the route is pinned rather than assumed.
    const uses = [...source(MEMBER_LIST).matchAll(/aria-sort=\{([^}]*)\}/g)].map(
      (found) => found[1] ?? '',
    );

    expect(uses.length, 'the member list no longer reports a sort state at all').toBe(1);
    for (const use of uses) {
      expect(use, 'aria-sort is computed by something other than sortStateOf').toContain(
        'sortStateOf(',
      );
    }
  });

  it('reads aria-sort in both syntaxes, and finds none where there is none', () => {
    // Detector self-test, both polarities: a reader that returned nothing would
    // make the sweep above pass on a screen carrying a literal in it.
    expect(ariaSortValues('<th aria-sort="ascending">')).toEqual(['ascending']);
    expect(ariaSortValues("<th aria-sort={sorted ? 'descending' : 'none'}>")).toEqual([
      'descending',
      'none',
    ]);
    expect(ariaSortValues('<th className="x">')).toEqual([]);
  });
});

describe('the screen uses no reserved signal', () => {
  it.each(SCREENS)('names no destructive utility in $name', ({ file }) => {
    // UX-DR4: `destructive` is reserved exclusively for an unresolved conflict.
    // Comment-blind, so the screen's own explanation of the rule does not trip
    // it — which is what makes the assertion about the markup.
    expect(source(file)).not.toContain('destructive');
  });
});

describe('the detectors find what they claim to find', () => {
  // Synthetic sources, so each regex is proved on the shape it exists to catch
  // rather than on the one file that happens to be compliant today.
  const compliant = [
    'export function Probe() {',
    '  return (',
    '    <p className="text-sm">{t(\'auth.heading\')}</p>',
    '  );',
    '}',
  ].join('\n');
  const withText = compliant.replace(">{t('auth.heading')}<", '>Prijava<');
  const withLiteral = compliant.replace('className="text-sm"', 'aria-label="Zatvori"');
  const withTemplate = compliant.replace("{t('auth.heading')}", '{`Prijava`}');

  it('reads a key out of a t() call and finds none where there is none', () => {
    expect(translationKeys(compliant)).toEqual(['auth.heading']);
    expect(translationKeys('const x = 1;')).toEqual([]);
  });

  it('reports bare JSX text and stays silent on an expression container', () => {
    expect(jsxTextWithContent(withText)).toEqual(['Prijava']);
    expect(jsxTextWithContent(compliant)).toEqual([]);
  });

  it('reports a literal on a non-structural attribute and allows className', () => {
    expect(unsanctionedLiterals(withLiteral)).toEqual(['Zatvori']);
    expect(unsanctionedLiterals(compliant)).toEqual([]);
  });

  it('allows a structural attribute written as an expression, and only those', () => {
    // The widening the conditional description needed, on BOTH polarities. The
    // first shape is what the screen ships; the second is the shape that must
    // keep firing, and it differs only in the attribute's name.
    expect(
      unsanctionedLiterals("<Input aria-describedby={f === null ? undefined : 'sign-in-error'} />"),
    ).toEqual([]);
    expect(unsanctionedLiterals("<Input aria-label={f === null ? undefined : 'Zatvori'} />")).toEqual(
      ['Zatvori'],
    );
    // A nested container is not matched, so nothing hides inside one.
    expect(unsanctionedLiterals("<p className={cn({ a: 'Danas' })} />")).toEqual(['Danas']);
  });

  it('reports a template literal, which the quote-only class could not see', () => {
    expect(unsanctionedLiterals(withTemplate)).toEqual(['Prijava']);
  });

  it('allows a template that interpolates a value and holds no text of its own', () => {
    expect(unsanctionedLiterals('const label = `${n}`;')).toEqual([]);
    expect(templateStaticText('${n} dana')).toBe(' dana');
  });

  it('does not mistake an arrow function body for JSX text', () => {
    // Without the `=>` substitution this reports ` handler() ` as user-facing
    // text, and the sweep becomes a rule people work around.
    expect(jsxTextWithContent('const f = () => handler();')).toEqual([]);
  });

  it('does not mistake a type-argument list for JSX text', () => {
    // The false positive story 1.3b's refs and state hooks produced. All four
    // shapes are in the sign-in screen today.
    expect(jsxTextWithContent('const a = useRef<HTMLInputElement>(null); const b = f<T>(x);')).toEqual(
      [],
    );
    expect(jsxTextWithContent('function s(e: FormEvent<HTMLFormElement>): Promise<void> {}')).toEqual(
      [],
    );
    expect(stripTypeArguments('useState<Record<string, string>>(x)')).toBe('useState(x)');
    expect(stripTypeArguments('useState<A | null>(x)')).toBe('useState(x)');
  });

  it('still reports bare text once type arguments are neutralized', () => {
    // BOTH polarities, because a substitution that ate JSX would make every
    // text sweep in this file pass on any screen at all. A tag's `<` follows
    // whitespace, `(`, `{` or `>` — never an identifier character.
    expect(jsxTextWithContent('<p>Prijava</p>')).toEqual(['Prijava']);
    expect(stripTypeArguments('<Input id="a" />')).toBe('<Input id="a" />');
    expect(stripTypeArguments('<p>Prijava</p>')).toBe('<p>Prijava</p>');
  });

  it('records where the type-argument strip over-reaches into JSX', () => {
    // The polarity the two self-tests above miss, and it is a real one: they
    // only ever put a CLOSING tag after the text, and `</p>` is excluded by the
    // character class because of the `/`. An OPENING tag after text is not —
    // `Prijava<span>` puts `<` directly after an identifier character, which is
    // exactly the lookbehind's condition, so the strip eats `<span>` and merges
    // two runs into one.
    //
    // Asserted as it BEHAVES rather than as it should behave, because the
    // imprecision loses no literal: the merged run is still reported, so the
    // sweep still fails on hard-coded text. Written down so the next person to
    // widen this regex sees the boundary rather than discovering it.
    expect(stripTypeArguments('<p>Prijava<span>x</span></p>')).toBe('<p>Prijavax</span></p>');
    expect(jsxTextWithContent('<p>Prijava<span>x</span></p>')).toEqual(['Prijavax']);
  });

  it('binds a form to its own handler and refuses one that is merely nearby', () => {
    // The matcher that replaced the deleted `onSubmit` regex got no self-test,
    // and its 160-character window was an unasserted magic bound. Both
    // polarities: a binding inside the window is found, and a `submit` that is
    // only mentioned far away from the attribute is not.
    expect('<form onSubmit={(e) => { void submit(e); }}>').toMatch(
      /onSubmit=\{[\s\S]{0,160}?\bsubmit\b/,
    );
    expect('<form onSubmit={noop}>').not.toMatch(/onSubmit=\{[\s\S]{0,160}?\bsubmit\b/);
    expect(`<form onSubmit={noop}>${' '.repeat(200)}submit`).not.toMatch(
      /onSubmit=\{[\s\S]{0,160}?\bsubmit\b/,
    );
  });

  it('extracts a handler and its finally rather than matching the file', () => {
    const screen = [
      'export function Probe() {',
      '  async function submit(event) {',
      '    try {',
      '      await navigate({ to: 1 });',
      '    } finally {',
      '      setPending(false);',
      '    }',
      '  }',
      '}',
      'function elsewhere() { setPending(true); }',
    ].join('\n');

    expect(submitHandler(screen)).toContain('navigate({ to: 1 })');
    expect(submitHandler(screen), 'the extraction ran past the handler').not.toContain('elsewhere');
    expect(finallyBlock(screen)).toContain('setPending(false)');
    expect(finallyBlock('function submit() { const x = 1; }')).toBe('');
    expect(submitHandler('const noHandlerHere = 1;')).toBe('');
  });

  it('reads a height off every class shape and nothing off none', () => {
    expect(heightPx('h-11 w-full')).toBe(44);
    expect(heightPx('h-9')).toBe(36);
    expect(heightPx('min-h-12')).toBe(48);
    expect(heightPx('h-[44px]')).toBe(44);
    expect(heightPx('h-[2.75rem]')).toBe(44);
    // `h-full` and `h-auto` prove no pixel height, and neither does a class
    // that merely starts with the same letters.
    expect(heightPx('h-full')).toBeNull();
    expect(heightPx('w-full items-center')).toBeNull();
    expect(heightPx(null)).toBeNull();
  });

  it('would refuse the mutation that deleted the height classes', () => {
    // The gap this block exists for, proved on the mutated shape rather than
    // only on the compliant one.
    expect(heightPx('h-9')).toBeLessThan(TARGET_FLOOR_PX);
  });

  it('strips comments before scanning, in both syntaxes', () => {
    expect(stripComments('/* Prijava */ const x = 1;').trim()).toBe('const x = 1;');
    expect(stripComments('const x = 1; // Prijava').trim()).toBe('const x = 1;');
  });

  it('reads an attribute value and finds none where the attribute is absent', () => {
    expect(attributeOf('id="username" type="text"', 'id')).toBe('username');
    expect(attributeOf('id="username" type="text"', 'placeholder')).toBeNull();
  });

  it('allows a variant and still refuses the attribute next to it', () => {
    // The entry story 1.4a added to the allowlist, proved on BOTH polarities.
    // Widening the set is the one edit to this file that can quietly stop it
    // catching things, so the neighbouring offence has to still be caught.
    expect(unsanctionedLiterals('<Button variant="outline">{t(\'organization.save\')}</Button>')).toEqual(
      [],
    );
    expect(unsanctionedLiterals('<Button variant="outline" title="Spremi" />')).toEqual(['Spremi']);
  });

  it('reads a message-key union off either mapping, not only the first one', () => {
    // The generalization story 1.4a needed. A reader pinned to
    // `signInMessageKey` returns nothing for `organizationMessageKey`, which
    // drops four keys out of the rendered set and makes the set comparison
    // quietly weaker by four rather than red.
    const signature = [
      'export function organizationMessageKey(',
      '  failure: OrganizationFailure,',
      "): 'organization.error.refused' | 'organization.error.name' {",
      '  return failure === ORGANIZATION_REFUSED',
      '}',
    ].join('\n');

    expect(messageKeyUnion(signature)).toEqual([
      'organization.error.refused',
      'organization.error.name',
    ]);
  });

  it('allows a role and still refuses the attribute next to it', () => {
    // The entry story 1.3b added to the allowlist, proved on BOTH polarities:
    // widening the set is the one edit to this file that can quietly stop it
    // catching things, so the neighbouring offence has to still be caught.
    expect(unsanctionedLiterals('<p role="alert">{t(\'auth.heading\')}</p>')).toEqual([]);
    expect(unsanctionedLiterals('<p role="alert" aria-label="Greška" />')).toEqual(['Greška']);
  });

  it('reads describedby ids out of a literal and out of a conditional', () => {
    // The matcher loosened for the conditional attribute, on both polarities.
    // A version that saw only the literal form returns nothing for the shape
    // the screen actually ships, and every id assertion above passes vacuously.
    expect(describedByIds('id="a" aria-describedby="one two"')).toEqual(['one', 'two']);
    expect(
      describedByIds("id=\"a\" aria-describedby={f === null ? 'password-reset' : 'sign-in-error password-reset'}"),
    ).toEqual(['password-reset', 'sign-in-error', 'password-reset']);
    expect(describedByIds("aria-describedby={f === null ? undefined : 'sign-in-error'}")).toEqual([
      'sign-in-error',
    ]);
    expect(describedByIds('id="a" type="text"')).toEqual([]);
  });

  it('splits an aria-describedby token list and finds no id in nothing', () => {
    // The matcher loosened for the refusal message. A version that returned the
    // whole value as one token would look up an id no element can carry, and a
    // version that returned `['']` would "find" `id=\"\"` in any file.
    expect(idTokens('sign-in-error password-reset')).toEqual(['sign-in-error', 'password-reset']);
    expect(idTokens('  spaced   out  ')).toEqual(['spaced', 'out']);
    expect(idTokens('single')).toEqual(['single']);
    expect(idTokens(null)).toEqual([]);
    expect(idTokens('')).toEqual([]);
  });

  it('would report a key rendered twice once, which is what the set claim means', () => {
    // The dedupe `used()` gained. Without it a screen that renders one message
    // from two branches fails the set comparison while the two sets are equal.
    const twice = "{t('auth.heading')}{t('auth.heading')}";

    expect(translationKeys(twice)).toEqual(['auth.heading', 'auth.heading']);
    expect([...new Set(translationKeys(twice))]).toEqual(['auth.heading']);
  });

  it('finds every self-closing Input and nothing where there is none', () => {
    const two = '<Input id="a" /><p>text</p><Input id="b" className="h-11" />';

    expect(inputElements(two)).toEqual([' id="a" ', ' id="b" className="h-11" ']);
    expect(inputElements('<p>no inputs here</p>')).toEqual([]);
  });

  it('finds a bare input and never the shadcn primitive, which is a different control', () => {
    // BOTH polarities. A detector that also matched `<Input>` would report the
    // five settings fields as file pickers and make the single-picker assertion
    // fail on correct code; one that matched neither would make every claim
    // about the picker pass against an empty string.
    const mixed = '<Input id="a" className="h-11" /><input id="b" type="file" />';

    expect(bareInputElements(mixed)).toEqual([' id="b" type="file" ']);
    expect(bareInputElements('<Input id="a" />')).toEqual([]);
    expect(bareInputElements('<p>no inputs here</p>')).toEqual([]);
  });

  it('finds every Button, self-closing or not, and nothing where there is none', () => {
    const two = '<Button type="submit">Go</Button><Button className="h-11" disabled />';

    expect(buttonElements(two)).toEqual([' type="submit"', ' className="h-11" disabled ']);
    expect(buttonElements('<p>no buttons here</p>')).toEqual([]);
  });

  it('finds every Link and never a Label, which starts the same way', () => {
    // BOTH polarities, and the near-miss is the point: `<Label` shares four
    // characters with `<Link`, and a detector without the word boundary would
    // report the settings surface's five labels as navigation links and measure
    // them against a floor they are not controls for. One that matched neither
    // would make every claim about the chrome pass against an empty list.
    const mixed = '<Link to="/danas" className="h-11">x</Link><Label htmlFor="a" />';

    expect(linkElements(mixed)).toEqual([' to="/danas" className="h-11"']);
    expect(linkElements('<Label htmlFor="a" />')).toEqual([]);
    expect(linkElements('<p>no links here</p>')).toEqual([]);
  });

  it('allows aria-current and still refuses the attribute next to it', () => {
    // The entry the navigation chrome added to the allowlist, proved on BOTH
    // polarities. Widening that set is the one edit to this file that can
    // quietly stop it catching things, so the neighbouring offence has to still
    // be caught — in the quoted form and in the expression form, since the
    // active treatment ships as the latter.
    expect(unsanctionedLiterals('<Link aria-current="page">{t(\'nav.danas\')}</Link>')).toEqual([]);
    expect(
      unsanctionedLiterals("<Link aria-current={active ? 'page' : undefined} to={path} />"),
    ).toEqual([]);
    expect(unsanctionedLiterals('<Link aria-current="page" title="Danas" />')).toEqual(['Danas']);
    expect(
      unsanctionedLiterals("<Link aria-current={active ? 'page' : undefined} alt='Danas' />"),
    ).toEqual(['Danas']);
  });

  it('extracts each nav block and never merges two into one', () => {
    // BOTH polarities. A version that matched greedily would return ONE block
    // spanning both bars, and "every bar renders the exit" would then be
    // satisfied by one bar that does — which is exactly the mutation the sweep
    // exists to catch. One that matched nothing would make the same sweep pass
    // against an empty list.
    const two = '<nav id="a">{destinations}</nav><p>x</p><nav id="b">{exit}</nav>';

    expect(navBlocks(two)).toEqual(['<nav id="a">{destinations}</nav>', '<nav id="b">{exit}</nav>']);
    expect(navBlocks('<p>no navigation here</p>')).toEqual([]);
  });

  it('reads aria-current values out of both syntaxes and none out of neither', () => {
    // The sweep that keeps the allowlist exemption honest is only as good as
    // this reader: one that returned nothing would let `aria-current="Danas"`
    // through on every screen in the application.
    expect(ariaCurrentValues('<Link aria-current="page" />')).toEqual(['page']);
    expect(ariaCurrentValues("<Link aria-current={a ? 'page' : undefined} />")).toEqual(['page']);
    expect(ariaCurrentValues('<Link aria-current="Danas" />')).toEqual(['Danas']);
    expect(ariaCurrentValues("<Link aria-current={a ? 'step' : 'page'} />")).toEqual(['step', 'page']);
    expect(ariaCurrentValues('<Link to="/danas" />')).toEqual([]);
  });

  it('allows aria-controls and still refuses the attribute next to it', () => {
    // The second entry the chrome added to the allowlist, proved on both
    // polarities. It is an id reference list exactly as `aria-describedby` is,
    // and the neighbouring offence has to keep firing.
    expect(unsanctionedLiterals('<Button aria-controls="app-destinations" />')).toEqual([]);
    expect(unsanctionedLiterals('<Button aria-controls="app-destinations" title="Izbornik" />')).toEqual(
      ['Izbornik'],
    );
  });

  it('extracts a component helper and stops at its own closing brace', () => {
    // The extraction the 1.4a review needed, on both polarities: a version that
    // ran past the function would swallow the component's own return and make
    // "the alert is not inside it" false on correct code, and one that matched
    // nothing would make the same assertion pass on the broken code.
    const component = [
      'export function Probe() {',
      '  function renderSettings() {',
      '    return <div className="animate-pulse" />;',
      '  }',
      '',
      '  return <p role="alert">x</p>;',
      '}',
    ].join('\n');

    expect(componentFunction(component, 'renderSettings')).toContain('animate-pulse');
    expect(
      componentFunction(component, 'renderSettings'),
      'the extraction ran past the helper',
    ).not.toContain('role="alert"');
    expect(componentFunction(component, 'missing')).toBe('');
  });

  it('reads the heading key off an h1, on one line or three', () => {
    // Both polarities and both layouts. A reader that returned `null` for the
    // multi-line form would make the destination-binding assertion fail on a
    // correct screen; one that returned the first key in the file would make it
    // pass on a screen titled by the wrong one.
    expect(headingKey('<h1 className="x">{t(\'nav.danas\')}</h1>')).toBe('nav.danas');
    expect(
      headingKey('<h1 className="x">\n  {t(\'nav.organizacija\')}\n</h1>'),
    ).toBe('nav.organizacija');
    expect(headingKey("<p>{t('nav.danas')}</p>")).toBeNull();
    expect(headingKey('const x = 1;')).toBeNull();
  });

  it('reads htmlFor values in source order and finds none where there are none', () => {
    expect(labelTargets('<Label htmlFor="username" /><Label htmlFor="password" />')).toEqual([
      'username',
      'password',
    ]);
    expect(labelTargets('<Label>text</Label>')).toEqual([]);
  });

  it('reads every key the member-list module declares, in both of its shapes', () => {
    // The reader story 1.5a adds, self-tested on both polarities like every
    // other detector here. It has to find THREE unions rather than the first
    // one — `messageKeyUnion` uses `exec` and would stop at the refusals — and
    // it has to find the column table's headings, which are not a return type
    // at all. A reader that found neither would make the set comparison above
    // pass against a resource file missing all eleven.
    const module = [
      "export function membersMessageKey(",
      "  failure: MembersFailure,",
      "): 'ljudi.error.refused' | 'ljudi.error.unavailable' {",
      '  return x;',
      '}',
      'export function memberLevelMessageKey(role: MemberRole): \'ljudi.admin\' | \'ljudi.member\' {',
      '  return y;',
      '}',
      'export const MEMBER_COLUMNS = [',
      "  { key: NAME_COLUMN, label: 'ljudi.name', sortValue: (m) => m.name },",
      "  { key: EMAIL_COLUMN, label: 'ljudi.email', sortValue: (m) => m.email },",
      '];',
    ].join('\n');

    expect(memberListKeys(module)).toEqual([
      'ljudi.error.refused',
      'ljudi.error.unavailable',
      'ljudi.admin',
      'ljudi.member',
      'ljudi.name',
      'ljudi.email',
    ]);
    // Both polarities: a module that declares neither shape yields nothing, and
    // a screen's own `t()` calls are NOT keys this reader may claim — those are
    // `translationKeys`' and counting them twice would hide a key that stopped
    // being declared.
    expect(memberListKeys('export function other(): string { return x; }')).toEqual([]);
    expect(memberListKeys(compliant)).toEqual([]);
  });

  it('reads the write path keys in both of its shapes, and none where there are none', () => {
    // BOTH POLARITIES, and both shapes. A reader that found only the union would
    // drop the partial-save sentence out of the rendered set, and `hr.json`
    // could then hold a message nothing renders; a reader that found nothing at
    // all would make the set comparison pass against a resource file missing
    // every one of the eleven.
    const module = [
      "export const PARTIAL_SAVE_KEY = 'ljudi.form.error.saved';",
      "export function memberWriteMessageKey(failure: F): 'a.one' | 'a.two' {",
      "  return 'a.one';",
      '}',
    ].join('\n');

    expect(memberWriteKeys(module)).toEqual(['a.one', 'a.two', 'ljudi.form.error.saved']);
    // A query key is not a message key, and the narrow constant pattern is what
    // keeps `MEMBERS_LIST_KEY` and `MEMBER_ROLE_KEY` out of the rendered set.
    expect(memberWriteKeys("export const MEMBERS_LIST_KEY = ['members'] as const;")).toEqual([]);
    expect(memberWriteKeys('const x = 1;')).toEqual([]);
  });

  it('reads the message keys off the mapping signature and none off a screen', () => {
    // The reader added when the two refusal keys left the screen. One that
    // returned nothing would drop both from the rendered set and make the
    // "every declared key is rendered" comparison quietly weaker by two.
    const signature = [
      'export function signInMessageKey(',
      '  failure: SignInFailure,',
      "): 'auth.error.credentials' | 'auth.error.unavailable' {",
      '  return failure === SIGN_IN_UNAVAILABLE',
      '}',
    ].join('\n');

    expect(messageKeyUnion(signature)).toEqual([
      'auth.error.credentials',
      'auth.error.unavailable',
    ]);
    expect(messageKeyUnion('export function other(): string { return x; }')).toEqual([]);
    expect(messageKeyUnion(compliant)).toEqual([]);
  });

  it('flattens resource keys the way i18next resolves them', () => {
    // Guards the key-set comparison: a walker that returned nothing would make
    // both directions of it pass on any file.
    expect(resourceKeys()).toContain('auth.heading');
    expect(resourceKeys()).toContain('count.days');
  });
});
