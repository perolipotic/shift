import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SET_PASSWORD_PARTS } from '@/features/auth/set-password-screen.fixture';
import { SIGN_IN_PARTS } from '@/features/auth/sign-in-screen.fixture';
import { CALENDAR_SCREEN_PARTS } from '@/features/calendar/calendar-screen.fixture';
import {
  CONFLICTS_QUEUE_PARTS,
  CONFLICT_RESOLUTION_PARTS,
  LEAVE_REQUEST_REVIEW_PARTS,
} from '@/features/conflicts/conflicts-screen.fixture';
import { HOURS_SCREEN_PARTS } from '@/features/hours/hours-screen.fixture';
import { LEAVE_REQUEST_PARTS, LEAVE_SCREEN_PARTS } from '@/features/leave/leave-screen.fixture';
import { NOTIFICATIONS_SCREEN_PARTS } from '@/features/notifications/notifications-screen.fixture';
import { TODAY_SCREEN_PARTS } from '@/features/today/today-screen.fixture';
import {
  HOUR_BAND_EDIT_PARTS,
  HOUR_BAND_LIST_PARTS,
} from '@/features/hour-bands/hour-band-screens.fixture';
import { SETTINGS_SCREEN_PARTS } from '@/features/organization/settings-screen.fixture';
import {
  SHIFT_TYPE_EDIT_PARTS,
  SHIFT_TYPE_LIST_PARTS,
} from '@/features/shift-types/shift-type-screens.fixture';
import {
  TEAM_EDIT_PARTS,
  TEAM_LIST_PARTS,
  TEAM_ROSTER_PARTS,
} from '@/features/teams/team-screens.fixture';
import { leafKeys } from '@/lib/i18n/resource-tree.fixture';

// The shared header of the app-wide source guards in this folder: the paths of
// every screen's source set, `SCREENS`, and the helpers that read and sweep them.

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
 *   - all three fields carry an accessible name, and the one refusal is bound
 *     to all three (story 7.7). `htmlFor`/`id` is the only thing that ties a
 *     `<Label>` to its `<Input>`, and getting it wrong leaves a screen reader
 *     announcing "edit text, blank" on a password field.
 *   - the screen REACHES the authentication seam. This was the inverse claim
 *     until story 1.3b — the screen was inert, and the block asserted it named
 *     no `supabase`, no `fetch(`, no `useState`, no `localStorage`. That is now
 *     false of a screen that signs people in, so the block is narrowed to the
 *     new truth rather than deleted: the handler is real, it goes through the
 *     `@/features/auth/services` modules rather than assembling a request inline, and it
 *     still stops the browser's own submission.
 *   - `destructive` appears nowhere. UX-DR4 reserves it exclusively for an
 *     unresolved conflict, and a refused sign-in is not one — it is the error
 *     surface this story ships, and it may not use it.
 *
 * Every read is lazy and every detector is self-tested on synthetic sources in
 * `sweep-detectors.test.ts`, the idiom `packages/domain/test/purity.test.ts`
 * established: a regex that stopped matching would make each sweep pass having
 * proved nothing.
 */

export const srcRoot = fileURLToPath(new URL('..', import.meta.url));

/** The sign-in page, which only composes (source structure B7), its hook and its form. */
export const SIGN_IN_PAGE = join(srcRoot, ...SIGN_IN_PARTS.page);

export const SIGN_IN_HOOK = join(srcRoot, ...SIGN_IN_PARTS.hook);

export const SIGN_IN_FORM = join(srcRoot, ...SIGN_IN_PARTS.form);

/**
 * The sign-in screen. A FILE SET since source structure B7 — the page, its
 * hook and its form — read as one source like the team screens, and written
 * ONCE in `sign-in-screen.fixture.ts`. A per-file needle is asserted in the
 * part that must hold it.
 */
export const SCREEN: readonly string[] = Object.values(SIGN_IN_PARTS).map((parts) => join(srcRoot, ...parts));

/** Story 7.8's set-password step: its page, which only composes, its hook and its form. */
export const SET_PASSWORD_PAGE = join(srcRoot, ...SET_PASSWORD_PARTS.page);

export const SET_PASSWORD_HOOK = join(srcRoot, ...SET_PASSWORD_PARTS.hook);

/**
 * The first sign-in's set-password step (story 7.8): a second, DISJOINT file
 * set under the auth feature, written ONCE in `set-password-screen.fixture.ts`.
 */
export const SET_PASSWORD_SCREEN: readonly string[] = Object.values(SET_PASSWORD_PARTS).map((parts) =>
  join(srcRoot, ...parts),
);

/** Its rules: the local refusals, the save's failures and the live checks' state, off `\w*MessageKey` unions. */
export const SET_PASSWORD_KEYS = join(srcRoot, 'features', 'auth', 'services', 'set-password.ts');

export const NOT_FOUND = join(srcRoot, 'pages', 'not-found.tsx');

/** The root route's error screen (A148), and the shared pending skeleton (A224). */
export const ERROR_SCREEN = join(srcRoot, 'pages', 'error.tsx');

const ROUTE_PENDING = join(srcRoot, 'pages', 'pending.tsx');

// `pages/index.tsx` IS NOT A SCREEN and is swept by nothing here: `/` forwards
// a signed-in visitor to the first destination and renders nothing, so the file
// carries no JSX and no key for any sweep below to read.
// `test/localization-applied.test.ts` still lists it, which is about build
// FRESHNESS rather than strings.
export const LAYOUT = join(srcRoot, 'pages', '_app.tsx');

const RESOURCE = join(srcRoot, 'lib', 'i18n', 'locales', 'hr.json');

/** Its state, its one read, its dialogs and its five named writes. */
export const SETTINGS_HOOK = join(srcRoot, ...SETTINGS_SCREEN_PARTS.hook);

/** The logo's dialog: the shared lockup, the file picker and its visible action. */
export const SETTINGS_LOGO = join(srcRoot, ...SETTINGS_SCREEN_PARTS.logo);

/** Story 7.18: the fire-rank setting's card and dialog. */
export const SETTINGS_FIRE_RANKS = join(srcRoot, ...SETTINGS_SCREEN_PARTS.fireRanks);
/** Story 10.3: the email-notifications card and its dialog. */
export const SETTINGS_EMAIL_NOTIFICATIONS = join(srcRoot, ...SETTINGS_SCREEN_PARTS.emailNotifications);

/**
 * Story 1.4a's settings surface: the first destination that is not a
 * placeholder. A file set since source structure B2, read as one source like
 * the member screens, and written ONCE in `settings-screen.fixture.ts`, which
 * `snapshot.test.ts` reads too.
 */
export const SETTINGS: readonly string[] = Object.values(SETTINGS_SCREEN_PARTS).map((parts) =>
  join(srcRoot, ...parts),
);

/**
 * A screen that is more than one file: its page, the hook holding its state,
 * reads and handlers, and the components and helpers its sections moved into
 * (source structure B1). Every sweep reads the set as ONE source, in this
 * order, so a guard that targeted the screen's file before the split targets
 * the same text after it and keeps its count.
 */
type SourceSet = string | readonly string[];

/** The members feature, which holds the three member screens' parts. */
export const MEMBERS_FEATURE = join(srcRoot, 'features', 'members');

/** Story 1.5a's member list: the second, and the first that renders a table. */
export const MEMBER_LIST: readonly string[] = [
  join(srcRoot, 'pages', 'ljudi.tsx'),
  join(MEMBERS_FEATURE, 'hooks', 'use-member-list.ts'),
  join(MEMBERS_FEATURE, 'components', 'member-table.tsx'),
  // Story 7.6: the same rows stacked below 640 px, and the phone's sort
  // control *Sati* shares, from `@/components/sort-control`.
  join(MEMBERS_FEATURE, 'components', 'member-rows.tsx'),
  join(srcRoot, 'components', 'sort-control.tsx'),
  join(MEMBERS_FEATURE, 'components', 'member-filters.tsx'),
  // Story 7.13: the option-chip bar only *Ljudi* draws, over the shared
  // chip, picker and sheet primitives of `@/components/filter-bar`.
  join(srcRoot, 'components', 'option-filter-bar.tsx'),
  join(MEMBERS_FEATURE, 'components', 'cell-view.tsx'),
  join(MEMBERS_FEATURE, 'utils', 'cell-content.ts'),
  // Epic 4 retro D2: the one glyph record every sorted heading draws from.
  join(srcRoot, 'components', 'sort-glyphs.ts'),
];

/**
 * Story 7.17: `/ljudi` is role-scoped, and a member-role session gets the
 * read-only directory instead of the list. Its markup and hook live in the
 * teams feature and are composed by `pages/ljudi.tsx`, which is read with the
 * list above; the directory is a DISJOINT set of its own, so the list's
 * one-read and one-search sweeps keep meaning the list. Its member lines are
 * the roster's (`TEAM_ROSTER_PARTS.lines`), swept there, and its rules are
 * `@/features/teams/services/directory`, executed by `directory.test.ts`.
 */
export const MEMBER_DIRECTORY: readonly string[] = [
  join(srcRoot, 'features', 'teams', 'components', 'member-directory.tsx'),
  join(srcRoot, 'features', 'teams', 'hooks', 'use-member-directory.ts'),
];

/**
 * The member list's rules, as a `.ts` module that renders nothing.
 *
 * It declares keys in TWO shapes — three `\w*MessageKey` return-type unions and
 * a column table whose entries carry a heading key each — and both are keys this
 * application can put on screen, so both have to be read or the set comparison
 * below is weaker by eleven. It is the first entry here whose reader is neither
 * `translationKeys` nor `messageKeyUnion`, for that reason.
 */
export const MEMBER_LIST_KEYS = join(srcRoot, 'features', 'members', 'services', 'list.ts');

/**
 * Story 1.5b's two member forms, and the module that holds every rule they
 * apply.
 *
 * NEITHER SCREEN IS A DESTINATION. `/ljudi/novi` and `/ljudi/$id` are reached
 * from the member list rather than from the navigation, so neither appears in
 * `@/features/navigation/utils/destinations` and neither is covered by the destination table
 * below — which is precisely why they are named here by hand: a `.tsx` that
 * renders and is absent from `SCREENS` is swept by nothing at all.
 */
export const MEMBER_CREATE: readonly string[] = [
  // STORY 7.13b: no page of its own any more. *Dodaj osobu* is a dialog on
  // Ljudi, and `/ljudi/novi` only redirects to it, so the dialog leads the set.
  join(MEMBERS_FEATURE, 'components', 'member-add-dialog.tsx'),
  join(MEMBERS_FEATURE, 'hooks', 'use-member-create.ts'),
  // STORY 7.8: the one-time credential's line with `Kopiraj`, shared with
  // the edit form's reset.
  join(MEMBERS_FEATURE, 'components', 'credential-line.tsx'),
  join(MEMBERS_FEATURE, 'utils', 'refusal-text.ts'),
];

/** The leave feature, which holds the member page's leave card (story 5.1c). */
export const LEAVE_FEATURE = join(srcRoot, 'features', 'leave');

/** Story 5.1c's rules: the leave card's reasons and refusals, off two `\w*MessageKey` unions. */
export const LEAVE_SECTION_KEYS = join(LEAVE_FEATURE, 'services', 'leave-section.ts');

/**
 * Story 5.2c's *Godišnji*: the viewer's own allowance, days used and balance,
 * a file set on *Sati*'s terms, written ONCE in `leave-screen.fixture.ts`.
 */
export const GODISNJI: readonly string[] = Object.values(LEAVE_SCREEN_PARTS).map((parts) => join(srcRoot, ...parts));

/** Story 9.3: the request form's files, page first. */
export const LEAVE_REQUEST: readonly string[] = Object.values(LEAVE_REQUEST_PARTS).map((parts) =>
  join(srcRoot, ...parts),
);

/** Story 5.2c's rules: the screen's two lines and its three tiles' labels. */
export const MY_LEAVE_KEYS = join(LEAVE_FEATURE, 'services', 'my-leave.ts');

/** E884's rules: the overview's Stanje options and chip values, off `\w*MessageKey` unions. */
export const LEAVE_OVERVIEW_KEYS = join(LEAVE_FEATURE, 'services', 'leave-overview.ts');

/** The conflicts feature, which holds the *Za odluku* screen's parts (story 5.3b). */
export const CONFLICTS_FEATURE = join(srcRoot, 'features', 'conflicts');

/**
 * Story 5.3b's *Za odluku*: the conflicts queue, a file set on *Sati*'s terms,
 * written ONCE in `conflicts-screen.fixture.ts`.
 */
export const ZA_ODLUKU: readonly string[] = Object.values(CONFLICTS_QUEUE_PARTS).map((parts) => join(srcRoot, ...parts));

/**
 * Story 5.4b's one conflict, decided on its own screen: the second, disjoint
 * set in `conflicts-screen.fixture.ts`. Not a destination, so named here by
 * hand, as the member forms are.
 */
export const RESOLUTION: readonly string[] = Object.values(CONFLICT_RESOLUTION_PARTS).map((parts) => join(srcRoot, ...parts));

/**
 * Story 9.4's one leave request, decided on its own screen: a third *Za
 * odluku* set in `conflicts-screen.fixture.ts`, its parts in the leave feature.
 */
export const LEAVE_REQUEST_REVIEW: readonly string[] = Object.values(LEAVE_REQUEST_REVIEW_PARTS).map((parts) =>
  join(srcRoot, ...parts),
);

/** Story 9.4's rules: the decision screen's base lines, closed line and refusals, off literal and `\w*MessageKey` unions. */
export const LEAVE_REQUEST_REVIEW_KEYS = join(LEAVE_FEATURE, 'services', 'leave-request-review.ts');

/** Story 10.3: the notifications feature, which holds `/obavijesti`. */
export const NOTIFICATIONS_FEATURE = join(srcRoot, 'features', 'notifications');

/** Story 10.3: `/obavijesti`'s files, page first. */
export const NOTIFICATIONS: readonly string[] = Object.values(NOTIFICATIONS_SCREEN_PARTS).map((parts) =>
  join(srcRoot, ...parts),
);

/** Story 10.3: the page itself, which the set is read from first. */
export const NOTIFICATIONS_PAGE = join(srcRoot, 'pages', 'obavijesti.tsx');

/** Story 10.3: the screen's rules, its saved lines off one `\w*MessageKey` union. */
export const NOTIFICATIONS_KEYS = join(NOTIFICATIONS_FEATURE, 'services', 'settings.ts');

/** Story 10.4: the push section's rules, its saved lines off one `\w*MessageKey` union. */
export const PUSH_KEYS = join(NOTIFICATIONS_FEATURE, 'services', 'push.ts');

/** Story 5.4b's rules: the resolution screen's facts, strip and lines, off `\w*MessageKey` unions. */
export const RESOLUTION_SCREEN_KEYS = join(CONFLICTS_FEATURE, 'services', 'resolution-screen.ts');

/** Story 7.9: the replacement candidates' three group headings, off `candidateGroupMessageKey`. */
export const REPLACEMENT_CANDIDATE_KEYS = join(srcRoot, 'features', 'calendar', 'utils', 'replacement-candidates.ts');

/** Story 5.4b's write: its three refusals, off `resolutionFailureMessageKey`. */
export const RESOLUTION_WRITE_KEYS = join(CONFLICTS_FEATURE, 'services', 'resolution-write.ts');

export const MEMBER_EDIT: readonly string[] = [
  join(srcRoot, 'pages', 'ljudi.$id.tsx'),
  join(MEMBERS_FEATURE, 'hooks', 'use-member-edit.ts'),
  // THE RETRO SPLIT (A16, A21): the page's reads stay in `use-member-edit`,
  // each card's state and handlers are a hook of its own, and the screen they
  // share is typed beside them.
  join(MEMBERS_FEATURE, 'hooks', 'member-edit-context.ts'),
  join(MEMBERS_FEATURE, 'hooks', 'use-member-basics.ts'),
  join(MEMBERS_FEATURE, 'hooks', 'use-member-team.ts'),
  join(MEMBERS_FEATURE, 'hooks', 'use-member-status.ts'),
  join(MEMBERS_FEATURE, 'hooks', 'use-member-reset.ts'),
  join(MEMBERS_FEATURE, 'components', 'member-basics-card.tsx'),
  join(MEMBERS_FEATURE, 'components', 'member-team-card.tsx'),
  join(MEMBERS_FEATURE, 'components', 'member-status-card.tsx'),
  join(MEMBERS_FEATURE, 'components', 'member-reset-card.tsx'),
  // STORY 7.11: the page's title — the person's name — and the allowance's
  // dialog, which the page hands the leave card as a slot.
  join(MEMBERS_FEATURE, 'components', 'member-page-header.tsx'),
  join(MEMBERS_FEATURE, 'components', 'member-allowance-dialog.tsx'),
  // STORY 7.8: the reset's credential line with `Kopiraj`, shared with the
  // create form.
  join(MEMBERS_FEATURE, 'components', 'credential-line.tsx'),
  join(MEMBERS_FEATURE, 'utils', 'refusal-text.ts'),
  join(MEMBERS_FEATURE, 'utils', 'date-refusal.ts'),
  // STORY 5.5e: the copy of the team and status cards' erasure dialogs.
  join(MEMBERS_FEATURE, 'utils', 'erasure-copy.ts'),
  // STORY 5.1c: the leave card the page composes after the status card, and
  // its hook. Its rules are `LEAVE_SECTION_KEYS`, a key source of its own.
  join(LEAVE_FEATURE, 'hooks', 'use-member-leave.ts'),
  join(LEAVE_FEATURE, 'components', 'member-leave-card.tsx'),
  // STORY 5.2b: the card's list of live records and its removal confirmation.
  join(LEAVE_FEATURE, 'components', 'member-leave-records.tsx'),
  // STORY 7.12: the card's record and amend dialog, the od–do fields' one home.
  join(LEAVE_FEATURE, 'components', 'member-leave-dialog.tsx'),
  // STORY 9.4: the dialog's conflict lines, extracted unchanged and shared
  // with a leave request's decision screen.
  join(LEAVE_FEATURE, 'components', 'leave-conflict-lines.tsx'),
];

/** The two team pages, which only compose (source structure B6), and their hooks. */
export const TEAM_LIST_PAGE = join(srcRoot, ...TEAM_LIST_PARTS.page);

export const TEAM_LIST_HOOK = join(srcRoot, ...TEAM_LIST_PARTS.hook);

export const TEAM_EDIT_HOOK = join(srcRoot, ...TEAM_EDIT_PARTS.hook);

/**
 * Story 1.7a's two team screens and the two modules holding their rules. Like
 * the member forms, neither screen is a destination, so they are named here by
 * hand: a `.tsx` absent from `SCREENS` is swept by nothing.
 *
 * FILE SETS since source structure B6 — each a page, its hook and its
 * components — read as one source like the hour band screens, and written
 * ONCE in `team-screens.fixture.ts`. The two sets are DISJOINT, so no string,
 * control or handler is counted twice.
 */
export const TEAM_LIST: readonly string[] = Object.values(TEAM_LIST_PARTS).map((parts) => join(srcRoot, ...parts));

export const TEAM_EDIT: readonly string[] = Object.values(TEAM_EDIT_PARTS).map((parts) => join(srcRoot, ...parts));

export const TEAM_LIST_KEYS = join(srcRoot, 'features', 'teams', 'services', 'list.ts');

export const TEAM_WRITE_KEYS = join(srcRoot, 'features', 'teams', 'services', 'write.ts');

/**
 * Story 1.8's roster screen, the Danas destination it is reached from, and the
 * module holding both surfaces' rules. The roster is not a destination, so it
 * is in no destination table; its parts come from `team-screens.fixture.ts`
 * (source structure B7). Danas left the placeholders in story 1.8.
 */
export const TEAM_ROSTER_PAGE = join(srcRoot, ...TEAM_ROSTER_PARTS.page);

export const TEAM_ROSTER_HOOK = join(srcRoot, ...TEAM_ROSTER_PARTS.hook);

/**
 * A FILE SET since source structure B7 — the page, its hook and the roster
 * component — and the third, disjoint set in `team-screens.fixture.ts`.
 */
export const TEAM_ROSTER: readonly string[] = Object.values(TEAM_ROSTER_PARTS).map((parts) => join(srcRoot, ...parts));

/** The *Danas* page, which composes the cards and keeps the team line (story 6.1a). */
export const DANAS_PAGE = join(srcRoot, ...TODAY_SCREEN_PARTS.page);

/**
 * A FILE SET since story 6.1a — the page, the hook holding its reads, the
 * cards and, since story 6.1b, the two tiles — on *Godišnji*'s terms, written ONCE in `today-screen.fixture.ts`.
 * The team line stays in the page, which the roster's sweeps read alone.
 */
export const DANAS: readonly string[] = Object.values(TODAY_SCREEN_PARTS).map((parts) => join(srcRoot, ...parts));

/** The today feature, which holds the *Danas* screen's parts. */
export const TODAY_FEATURE = join(srcRoot, 'features', 'today');

/** Story 6.1a's rules: today's three cases, the next shift's two headings, and the two lines in place of a case. */
export const TODAY_KEYS = join(TODAY_FEATURE, 'services', 'today.ts');

/** Story 6.2's rules: the duty-block's headline, its end line, each leg's state and whose shift a leg is. */
export const TODAY_DUTY_KEYS = join(TODAY_FEATURE, 'services', 'today-duty.ts');

/** SINCE STORY 6.3: an admin's rules — the subtitle's status, the rows' badges, the coverage, the absences and the week's cells. */
export const TODAY_ADMIN_KEYS = join(TODAY_FEATURE, 'services', 'admin-today.ts');

export const TEAM_ROSTER_KEYS = join(srcRoot, 'features', 'teams', 'services', 'roster.ts');

export const HOUR_BAND_LIST_HOOK = join(srcRoot, ...HOUR_BAND_LIST_PARTS.hook);

export const HOUR_BAND_EDIT_HOOK = join(srcRoot, ...HOUR_BAND_EDIT_PARTS.hook);

/**
 * Story 2.1b's two hour band screens and the two modules holding their rules.
 * Neither screen is a destination — both are reached from `Organizacija` — so
 * they are named here by hand, as the team screens are.
 *
 * FILE SETS since source structure B5 — each a page, its hook and its
 * components — read as one source like the shift type screens, and written
 * ONCE in `hour-band-screens.fixture.ts`. The two sets are DISJOINT, so no
 * string, control or handler is counted twice.
 */
export const HOUR_BAND_LIST: readonly string[] = Object.values(HOUR_BAND_LIST_PARTS).map((parts) =>
  join(srcRoot, ...parts),
);

export const HOUR_BAND_EDIT: readonly string[] = Object.values(HOUR_BAND_EDIT_PARTS).map((parts) =>
  join(srcRoot, ...parts),
);

export const HOUR_BAND_LIST_KEYS = join(srcRoot, 'features', 'hour-bands', 'services', 'list.ts');

export const HOUR_BAND_WRITE_KEYS = join(srcRoot, 'features', 'hour-bands', 'services', 'write.ts');

export const SHIFT_TYPE_LIST_HOOK = join(srcRoot, ...SHIFT_TYPE_LIST_PARTS.hook);

export const SHIFT_TYPE_EDIT_HOOK = join(srcRoot, ...SHIFT_TYPE_EDIT_PARTS.hook);

/**
 * Story 2.2b's two shift type screens and the two modules holding their rules.
 * The list IS the `Postavke rotacije` destination, which left the placeholders
 * when it was built; the edit screen is reached from it only.
 *
 * FILE SETS since source structure B4 — each a page, its hook and its
 * components — read as one source like the member, settings and calendar
 * screens, and written ONCE in `shift-type-screens.fixture.ts`. The two sets
 * are DISJOINT, so no string, control or handler is counted twice.
 */
export const SHIFT_TYPE_LIST: readonly string[] = Object.values(SHIFT_TYPE_LIST_PARTS).map((parts) =>
  join(srcRoot, ...parts),
);

export const SHIFT_TYPE_EDIT: readonly string[] = Object.values(SHIFT_TYPE_EDIT_PARTS).map((parts) =>
  join(srcRoot, ...parts),
);

export const SHIFT_TYPE_LIST_KEYS = join(srcRoot, 'features', 'shift-types', 'services', 'list.ts');

export const SHIFT_TYPE_WRITE_KEYS = join(srcRoot, 'features', 'shift-types', 'services', 'write.ts');

/**
 * Story 2.3b's rotation builder and the two modules holding its keys. The
 * section renders on `/postavke-rotacije`, below the shift types, from a file
 * of its own — the shift type screens are pinned to one query — so it is named
 * here by hand. `@/features/rotation/utils/draft` declares no key.
 */
export const ROTATION_SECTION: readonly string[] = [
  join(srcRoot, 'features', 'rotation', 'components', 'rotation-section.tsx'),
  // THE RETRO SPLIT (A21, A26): the builder's state, read and handlers are
  // its hook's, and its sections, notices, stepper and save bar are parts
  // the section composes. One builder, read as one set.
  join(srcRoot, 'features', 'rotation', 'hooks', 'use-rotation-builder.ts'),
  join(srcRoot, 'features', 'rotation', 'components', 'rotation-notices.tsx'),
  join(srcRoot, 'features', 'rotation', 'components', 'rotation-stepper.tsx'),
  join(srcRoot, 'features', 'rotation', 'components', 'rotation-pattern-card.tsx'),
  join(srcRoot, 'features', 'rotation', 'components', 'rotation-preview-card.tsx'),
  join(srcRoot, 'features', 'rotation', 'components', 'rotation-save-bar.tsx'),
];

/**
 * Story 7.18: `Povijest rotacije` left the builder's page for a dialog behind
 * a header button — a component of its own, rendered in the builder's header.
 */
export const ROTATION_HISTORY_DIALOG = join(srcRoot, 'features', 'rotation', 'components', 'rotation-history-dialog.tsx');

export const ROTATION_LIST_KEYS = join(srcRoot, 'features', 'rotation', 'services', 'list.ts');

export const ROTATION_WRITE_KEYS = join(srcRoot, 'features', 'rotation', 'services', 'write.ts');

/** Story 2.4's phone stepper rules: each step's name and Dalje's label per target step. */
export const ROTATION_STEPPER_KEYS = join(srcRoot, 'features', 'rotation', 'utils', 'stepper.ts');

/** Story 2.5's save warnings: every line, its date detail, the count and the separators. */
export const ROTATION_WARNING_KEYS = join(srcRoot, 'features', 'rotation', 'utils', 'warnings.ts');

/** Story 2.6's rotation history: the three statuses and the unknown author. */
export const ROTATION_HISTORY_KEYS = join(srcRoot, 'features', 'rotation', 'services', 'history.ts');

/**
 * Story 3.5c's review of the overrides a rotation change left pending: a
 * component of its own, rendered by the builder after its notices, and the
 * module holding its refusals and what a landed disposition says.
 */
export const ROTATION_OVERRIDE_REVIEW = join(srcRoot, 'features', 'rotation', 'components', 'override-review.tsx');

/**
 * The erasure confirmation (story 5.5b), lifted out of the rotation builder
 * and shared with the calendar's roster changes: its own entry, since both
 * surfaces render it with their own words and it holds no key.
 */
const ERASURE_DIALOG = join(srcRoot, 'features', 'conflicts', 'components', 'erasure-dialog.tsx');

export const ROTATION_DISPOSITION_KEYS = join(srcRoot, 'features', 'rotation', 'services', 'override-disposition.ts');

/**
 * Story 3.1's calendar: the `Kalendar` destination, built, and the module
 * holding its read failure. `@/features/calendar/utils/month` declares no key.
 * A file set since source structure B3 — the page, its two hooks, its
 * components and two helpers — read as one source like the member and
 * settings screens, and written ONCE in `calendar-screen.fixture.ts`, which
 * `features/calendar/services/snapshot.test.ts` reads too.
 */
export const KALENDAR: readonly string[] = Object.values(CALENDAR_SCREEN_PARTS).map((parts) =>
  join(srcRoot, ...parts),
);

export const CALENDAR_SNAPSHOT_KEYS = join(srcRoot, 'features', 'calendar', 'services', 'snapshot.ts');

/** The month navigation *Kalendar* and *Sati* share (story 4.1b): a part of both sets. */
export const SHARED_MONTH_NAV = join(srcRoot, ...CALENDAR_SCREEN_PARTS.monthNav);

/** Story 7.5: the filter bar *Kalendar* and *Sati* share: a part of both sets. */
export const SHARED_FILTER_BAR = join(srcRoot, ...CALENDAR_SCREEN_PARTS.filterBar);

/** Story 7.5: the filter bar's model — its chips, summary and the month locative — pure, beside it. */
export const FILTER_BAR_KEYS = join(srcRoot, 'utils', 'filter-bar.ts');

/** Story 7.6: the phone's sort control *Sati* and *Ljudi* share: a part of both sets. */
export const SHARED_SORT_CONTROL = join(srcRoot, ...HOURS_SCREEN_PARTS.sortControl);

/**
 * Story 4.1b's *Sati*: the viewer's own month of hours, a file set on the
 * calendar's terms, written ONCE in `hours-screen.fixture.ts`.
 */
export const SATI: readonly string[] = Object.values(HOURS_SCREEN_PARTS).map((parts) => join(srcRoot, ...parts));

/** Story 4.1b's rules: the one failure message *Sati* renders. */
export const HOURS_KEYS = join(srcRoot, 'features', 'hours', 'services', 'my-hours.ts');

/** Story 4.2's rules: the two lines an admin's empty table renders. */
export const ORGANIZATION_HOURS_KEYS = join(srcRoot, 'features', 'hours', 'services', 'organization-hours.ts');

/** Story 4.3's rules: the export's headings, sheet and file names, and its action's two labels. */
export const HOURS_EXPORT_KEYS = join(srcRoot, 'features', 'hours', 'services', 'hours-export.ts');

/** Story 7.14's rules: a figure's explanation, its words and the three words a shift's source reads as. */
export const HOURS_EXPLANATION_KEYS = join(srcRoot, 'features', 'hours', 'services', 'hours-explanation.ts');

/** Story 3.5b's override writes: the six refusals the day detail's form and confirmation render. */
export const CALENDAR_OVERRIDE_WRITE_KEYS = join(srcRoot, 'features', 'calendar', 'services', 'override-write.ts');

/** Story 3.6b's roster writes: the six refusals and the two landed notices the roster form and confirmation render. */
export const CALENDAR_ROSTER_WRITE_KEYS = join(srcRoot, 'features', 'calendar', 'services', 'roster-write.ts');

/** Story 3.2b's modifier vocabulary: the four marks' labels and a cell with no rotation. */
export const CALENDAR_MODIFIER_KEYS = join(srcRoot, 'features', 'calendar', 'utils', 'modifiers.ts');

/** B449: what an empty day or month says, inactive or on no team; shared with *Danas*. */
export const CALENDAR_EMPTY_DAY_KEYS = join(srcRoot, 'features', 'calendar', 'utils', 'empty-day.ts');

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
export const MEMBER_WRITE_KEYS = join(srcRoot, 'features', 'members', 'services', 'wire.ts');

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
export const CHROME = join(srcRoot, 'features', 'navigation', 'components', 'chrome.tsx');

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
export const LOCKUP = join(srcRoot, 'features', 'organization', 'components', 'lockup.tsx');

/**
 * The update notice (story 8.1): a `.tsx` that is not a route, mounted by the
 * root shell above every route, sign-in included. Swept like the chrome, for
 * the chrome's reason.
 */
export const UPDATE_NOTICE = join(srcRoot, 'components', 'update-notice.tsx');

/**
 * The as-of note (story 8.2): a `.tsx` that is not a route, shared by *Danas*
 * and *Kalendar* under their headings while a snapshot is drawn offline.
 * Swept on its own, as the update notice is, so its one string counts once.
 */
export const OFFLINE_NOTE = join(srcRoot, 'components', 'offline-note.tsx');

/**
 * The offline write note (story 8.3a): a `.tsx` that is not a route, drawn
 * beside every gated write control while offline. Swept on its own, as the
 * as-of note is, so its two strings count once.
 */
export const OFFLINE_WRITE_NOTE = join(srcRoot, 'components', 'offline-write-note.tsx');

/**
 * The sign-in steps' shared frame (visual refresh A): the brand panel both
 * sign-in screens render around their card. Not a route, and swept anyway for
 * the reason the chrome and the lockup are — it renders strings.
 */
export const AUTH_LAYOUT = join(srcRoot, 'components', 'layout', 'auth-layout.tsx');

/** The curated accent set as data, and the fourth `\w*MessageKey` module. */
export const ACCENT_KEYS = join(srcRoot, 'features', 'organization', 'utils', 'accent.ts');

/** The fixed rank list as data (member rank), and its two label mappings. */
export const RANK_KEYS = join(srcRoot, 'features', 'members', 'utils', 'rank.ts');

/** Story 10.3: the organization's email-notifications switch, its labels off two `\w*MessageKey` unions. */
export const EMAIL_NOTIFICATIONS_KEYS = join(srcRoot, 'features', 'organization', 'utils', 'email-notifications.ts');

/** Story 7.11: the member page header's status badge, off one `\w*MessageKey` union. */
export const MEMBER_FACTS_KEYS = join(srcRoot, 'features', 'members', 'utils', 'member-facts.ts');

/** Decision 16's *Što se mijenja*: the team dialog's two lines, each with or without a range. */
export const MEMBER_MOVE_PREVIEW_KEYS = join(srcRoot, 'features', 'members', 'services', 'team-move-preview.ts');

/** The fixed position list as data (team position), and its label mapping. */
export const POSITION_KEYS = join(srcRoot, 'features', 'members', 'utils', 'position.ts');

/** Story 7.8's `Kopiraj`: the copy and its two status lines' mapping. */
export const CREDENTIAL_COPY_KEYS = join(srcRoot, 'features', 'members', 'utils', 'credential-copy.ts');

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
// EMPTY SINCE STORY 5.3b: `/raspored` (now `/za-odluku`) was the last placeholder, and left when
// it gained the conflicts queue. The list and its cross-checks stay, so a new
// destination registered as only a heading still lands under the tight counts.
export const PLACEHOLDER_SLUGS: readonly string[] = [];

export const DESTINATION_SCREENS = PLACEHOLDER_SLUGS.map((slug) => ({
  name: `the ${slug} destination`,
  file: join(srcRoot, 'pages', `${slug}.tsx`),
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
export const SCREENS = [
  // `expectedFields` and `expectedButtons` are what stop the general tap-target
  // sweep passing on an empty set: two of these screens carry no control at all
  // today, so a loop with no count behind it read as coverage while asserting
  // nothing on half its cases. A screen that gains a control fails here until
  // the number moves, which is the moment somebody confirms the new control is
  // measured.
  //
  // TWO NUMBERS, NOT ONE TOTAL. A field is an `<Input>` or a `<Select>`, a
  // button is a `<Button>`. They were one `expectedControls` sum until the
  // test-sweeps cleanup, and a sum cannot notice what the comments below say it
  // notices: a sixth field arriving in the same change as a removed button left
  // the total unchanged. The totals the comments below narrate are the two
  // numbers added together.
  // SEVEN SINCE STORY 7.7: three fields (organization, username, password)
  // and four buttons (`Promijeni`, the password toggle, `Prijava` and the
  // `Zaboravljena lozinka?` disclosure). The bare-`/prijava` prompt's two
  // controls went with it.
  { name: 'the sign-in screen', file: SCREEN, expectedFields: 3, expectedButtons: 4 },
  // STORY 7.8. FIVE on the set-password step: the new password and its
  // repeat, the show/hide toggle, `Spremi i nastavi` and `Odjava`.
  { name: 'the set-password screen', file: SET_PASSWORD_SCREEN, expectedFields: 2, expectedButtons: 3 },
  { name: 'the not-found component', file: NOT_FOUND, expectedFields: 0, expectedButtons: 1 },
  // A148. ONE on the error screen: *Pokušaj ponovno*. It shows nothing of the
  // error itself, which the literal sweeps below hold it to.
  { name: 'the error screen', file: ERROR_SCREEN, expectedFields: 0, expectedButtons: 1 },
  // A224. ZERO on the pending skeleton, which renders no string either, and is
  // swept so it stays that way.
  { name: 'the pending skeleton', file: ROUTE_PENDING, expectedFields: 0, expectedButtons: 0 },
  // STORY 8.1. ONE on the update notice: *Osvježi*.
  { name: 'the update notice', file: UPDATE_NOTICE, expectedFields: 0, expectedButtons: 1 },
  // STORY 8.2. ZERO on the as-of note: a status, no control.
  { name: 'the as-of note', file: OFFLINE_NOTE, expectedFields: 0, expectedButtons: 0 },
  // STORY 8.3a. ZERO on the offline write note: a status, no control.
  { name: 'the offline write note', file: OFFLINE_WRITE_NOTE, expectedFields: 0, expectedButtons: 0 },
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
  //
  // ELEVEN SINCE MEMBER RANK: the fire-rank setting's `<select>`, written on
  // change like the accent.
  // NINE SINCE DESIGN REFRESH C: the type and zone inputs left the form; the
  // leave year's day and month are selects now, still two controls.
  // TEN SINCE THE SETTINGS FIX: the read's retry, rendered beside the message
  // only when a read has failed, so a failed read has something to act with.
  // ELEVEN SINCE STORY 7.18, the page of facts with a dialog per change, each
  // written once: the hour band link and the read's retry; the shared
  // dialog's cancel and save; *Profil*'s `Promijeni` (one row component for
  // three facts), the name dialog's field, and the logo's choose action;
  // the two `Uredi` buttons; and the leave year's day and month selects. The
  // accent and the fire-rank setting are radio groups, which are not fields
  // anybody types in, and a slug, a zone or a locale control would still be
  // the count moving.
  // NINE BUTTONS since the *Satni pojasi* card's `Otvori` (deferred work from 7.18).
  // TEN since story 10.3: the email-notifications card's `Uredi`.
  { name: 'the organization settings surface', file: SETTINGS, expectedFields: 3, expectedButtons: 10 },
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
  //
  // TEN SINCE STORY 7.6: the phone's shared sort control — its `Poredano:`
  // trigger and one column `Button` written once inside the map over the
  // columns. The stacked row's name is a `<Link>` stretched over the row,
  // which no detector reads, and it replaces the row's pencil on a phone.
  //
  // SEVEN SINCE STORY 7.13: the two `<select>`s and the reset gave way to the
  // shared option-chip bar (`@/components/filter-bar`, counted in the
  // Kalendar and Sati sets) and its summary line's `Poništi filtre`.
  // EIGHT with the option-chip bar's own `Filtri` (`option-filter-bar.tsx`,
  // read with the member list since it is only *Ljudi*'s).
  // NINE SINCE THE DEFERRED-WORK SWEEP: the read failure's retry.
  { name: 'the member list', file: MEMBER_LIST, expectedFields: 1, expectedButtons: 8 },
  // EIGHT on the create form: four `<Input>`s — name, username, address,
  // allowance — the level `<select>`, and three `<Button>`s, which are Save,
  // Cancel and the link back to the list. The count is what notices a SIXTH
  // FIELD, which on these screens is how `organization_id` or an active flag
  // would arrive: both look like ordinary controls and both are forbidden for
  // reasons invisible in a diff — the first is pinned by the update policy on
  // both sides (`0003:331-351`) and the second is story 1.6's.
  //
  // NINE SINCE MEMBER RANK: the rank `<select>`, rendered only while the
  // organization uses ranks — written once, so counted once.
  //
  // TEN SINCE STORY 7.8: `Kopiraj` beside the issued password.
  //
  // ELEVEN SINCE STORY 7.13b, a dialog in two steps: the link back to the list
  // is gone (the dialog's close is the primitive's own), and the second step
  // adds *Dodaj još jednu* and *Otvori stranicu osobe*.
  { name: 'the member create form', file: MEMBER_CREATE, expectedFields: 6, expectedButtons: 5 },
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
  //
  // TWENTY-TWO SINCE MEMBER RANK: the rank `<select>`, as on the create form.
  //
  // TWENTY-THREE SINCE TEAM POSITION: the position `<select>` in the team
  // block, written once and shown only while the setting is on.
  //
  // TWENTY-SEVEN SINCE STORY 5.1c: the leave card's od and do `<Input>`s, its
  // save `<Button>`, and the retry its unavailable line offers.
  //
  // THIRTY-TWO SINCE STORY 5.2b: each record row's Izmijeni and Ukloni,
  // written once inside the map over the records, the form's amend cancel,
  // and the removal confirmation's cancel and confirm.
  //
  // THIRTY-THREE SINCE STORY 5.4d: "Natrag na Za odluku", shown while the
  // page was reached from a conflict.
  //
  // THIRTY-FIVE SINCE STORY 5.5e: the "Pokušaj ponovno" a team or status
  // confirmation offers when what its change would erase cannot be checked,
  // one in each card. The erasure dialog's own controls are the shared
  // component's, swept as an entry of their own.
  //
  // THIRTY-SIX SINCE STORY 7.8: `Kopiraj` beside the reset's password, the
  // create form's credential line, written once and shared.
  //
  // FORTY-SIX SINCE STORY 7.11, facts and dialogs: each card's header button
  // (Uredi, Promijeni, the status action, Dodijeli novu lozinku, Promijeni pravo); each
  // dialog's close button, cancel and final button (basics, allowance, team,
  // status) less the old in-card offers and confirmations they replace; the
  // allowance's own field; and the withdrawals, which stay card buttons
  // behind their own confirmations.
  //
  // FORTY-SEVEN SINCE STORY 7.12: the leave card's od–do form moves into its
  // dialog — the same two fields and Spremi, its cancel now always drawn —
  // and the card's header gains *Upiši godišnji*.
  // FORTY-NINE SINCE THE DEFERRED-WORK SWEEP: the retries beside the member
  // read's and the teams read's failures. The reset's password moved into a
  // dialog with its `Sakrij lozinku`; its close is the shared header's.
  { name: 'the member edit form', file: MEMBER_EDIT, expectedFields: 12, expectedButtons: 37 },
  // STORY 1.7a. FOUR on the team list: the link back to `Ljudi`, the one name
  // `<Input>`, the add `<Button>`, and ONE row link written once inside the map
  // over the teams — the same count at zero teams as at nine. SIX on one team:
  // the name `<Input>`, Save, the archive offer, the confirm and cancel that
  // replace it, and the link back. No delete control exists on either, which is
  // what the counts keep true.
  // DESIGN REFRESH C: SIX on the team list, the add form in a dialog with the
  // button that opens it and its cancel; FIVE on one team, a dialog over the
  // list whose own close replaced the link back.
  // SEVEN AND SIX SINCE THE DEFERRED-WORK SWEEP: each read failure's retry.
  { name: 'the team list', file: TEAM_LIST, expectedFields: 1, expectedButtons: 6 },
  { name: 'the team edit form', file: TEAM_EDIT, expectedFields: 1, expectedButtons: 5 },
  // STORY 1.8. ONE on the roster: the link back to Danas, a `<Button asChild>`.
  // No field, no form and no write — the count is what notices one arriving.
  // ZERO on Danas: its one new control is the `<Link>` to the roster, which
  // neither detector matches by construction and the link sweep measures.
  // ONE SINCE STORY 6.1a: the unavailable alert's retry, which reads the
  // calendar snapshot and the viewer's own leave again. The link to the
  // calendar is a `<Link>`, which no detector reads.
  // STILL ONE SINCE STORY 6.1b: the retry reads every key Danas reads again,
  // and the two tiles are `<Link>`s to *Sati* and *Godišnji*, whose own
  // retries are one tap away. No control of their own.
  // STILL ONE SINCE STORY 6.2: the duty-block offers nothing to tap.
  // TWO SINCE STORY 6.3: the admin body's unavailable alert has a retry of
  // its own, which reads the queue's three keys again. Every row of *Treba
  // tebe*, "Otvori Za odluku" and each block's way to its list view is a
  // `<Link>`, which no detector reads.
  { name: 'the team roster', file: TEAM_ROSTER, expectedFields: 0, expectedButtons: 1 },
  // STORY 7.17. THREE on the member directory: *Traži osobu*, the
  // unavailable notice's retry and *Poništi pretragu*. No line is a link and
  // nothing writes.
  { name: 'the member directory', file: MEMBER_DIRECTORY, expectedFields: 1, expectedButtons: 2 },
  { name: 'the Danas destination', file: DANAS, expectedFields: 0, expectedButtons: 2 },
  // STORY 3.1. THREE on Kalendar: the previous month, `Ovaj mjesec` and the
  // next month. The grid is a table and offers nothing (day detail is 3.4).
  // STORY 3.2a: five — the previous and next months, `Ovaj mjesec`, and the
  // two buttons of the mode switch. STILL FIVE SINCE STORY 3.2b: the grid's
  // cells take focus as one roving tab stop, and are cells, not controls.
  // SEVEN SINCE STORY 3.3a: the team filter's `Select` and its reset, the
  // reset written once however often it shows.
  // EIGHT SINCE STORY 3.4b: a day-list day's button that opens its detail,
  // written once inside the map over the days. A grid cell opens the detail
  // too, but stays a `gridcell`, not a control, and the Dialog's close is
  // `DialogHeader`'s own `<Button>`, not the screen's.
  // FOURTEEN SINCE STORY 3.5b: the admin's override form in the day detail —
  // its type `Select`, its reason `Input` and its save — the removal's
  // action, and its confirmation's cancel and confirm.
  // TWENTY-ONE SINCE STORY 3.6b: the admin's roster form — its "Skida se"
  // and "Dolazi" `Select`s, its reason `Input` and its save — the removal
  // written once inside the map over a block's changes, and its
  // confirmation's cancel and confirm.
  // TWENTY-TWO SINCE STORY 5.3c: the unavailable alert's retry, which reads
  // the schedule and the leave the marks stand on again.
  // TWENTY-THREE SINCE STORY 5.5b: the retry beside the refusal when what a
  // roster change would erase cannot be checked, written once and shown in
  // the form or in the removal's confirmation. The erasure confirmation's own
  // controls are the shared `ErasureDialog`'s, counted there.
  // TWENTY-FOUR SINCE STORY 5.5f: the retry beside the refusal when what a
  // shift-type override would erase cannot be checked, written once and shown
  // in the form or in the removal's confirmation. Its erasure confirmation's
  // controls are the shared `ErasureDialog`'s, counted there.
  // TWENTY-EIGHT SINCE STORY 7.4: the month toolbar's ‹, month trigger and ›,
  // `Ovaj mjesec` (now drawn only off the current month), and the month
  // picker's year ‹ and › and its month button, written once inside the map
  // over the twelve months.
  // THIRTY-FOUR SINCE STORY 7.5: the filter `Select` and its reset gave way
  // to the shared filter bar's eight — `Filtri`, the chip, its ✕ (each
  // written once inside the map over the chips), a picker option (written
  // once inside the map over the options), the Osoba search `Input`,
  // `Poništi filtre`, and the sheet's `Poništi` and `Prikaži`. The sheet's
  // Smjena rows are radio items, never a `<Button>`, and its close is
  // `DialogHeader`'s own.
  // THIRTY-NINE SINCE STORY 7.9: the day detail's footer — "Promijeni
  // sastav" and "Promijeni tip smjene" — each change dialog's cancel, and
  // "Odluči", a `<Button asChild>` over the link, written once
  // inside the map over the day's conflicts.
  // THIRTY-FOUR BUTTONS SINCE DEFERRED-WORK E795: the month picker footer's `Ovaj mjesec`.
  { name: 'the Kalendar destination', file: KALENDAR, expectedFields: 6, expectedButtons: 34 },
  // STORY 4.1b. THREE on Sati: the month navigation it shares with the
  // calendar — the previous month, `Ovaj mjesec` and the next month. The
  // figures are read, never pressed.
  // SIX SINCE STORY 4.2: an admin's organization table — its team and person
  // `Select`s, and ONE sortable heading `Button` written once in `SortHead`,
  // however many columns. The name links are `<Link>`s, which no detector
  // reads; each carries `min-h-11` all the same.
  // SEVEN SINCE STORY 4.3: the table's one export `Button`, beside the filters.
  // EIGHT SINCE STORY 5.3d: the unavailable message's retry, which reads the
  // snapshot and the leave the conflict count stands on again. The conflicts
  // heading is plain text, never a sort.
  // TWELVE SINCE STORY 7.4: the shared month toolbar grew from three to
  // seven — the month trigger, and the picker's year ‹ and › and its month
  // button, written once inside the map over the twelve months.
  // TWENTY SINCE STORY 7.5: the two filter `Select`s gave way to the shared
  // filter bar's eight, counted in the Kalendar set too, and the empty
  // table's two ways out, `Ukloni filtar: Smjena B` and `Poništi filtre`.
  // TWENTY-TWO SINCE STORY 7.6: the phone's shared sort control — its
  // `Poredano:` trigger and one column `Button` inside the map over the
  // columns — counted in the member list too. The stacked rows reuse the
  // table's `EmptyResult`, so its two ways out are not written twice.
  // TWENTY-THREE SINCE STORY 7.14: the ⓘ `Button` beside an hours figure,
  // written once in `ExplainButton` however many figures carry one.
  // TWENTY-THREE BUTTONS SINCE DEFERRED-WORK E795: the month picker footer's `Ovaj mjesec`.
  { name: 'the Sati destination', file: SATI, expectedFields: 1, expectedButtons: 23 },
  // STORY 5.2c. ONE on Godišnji: the retry its unavailable alert offers. The
  // three figures are read, never pressed, and nothing here writes: a member
  // requests no leave (story 5.3 is conflicts, not requests).
  // SIX SINCE STORY 7.15: the member's retry above (1); the admin's
  // overview — its search `<Input>` (2), the sortable heading `Button`
  // written once in `SortHead` (3), its own retry (4) and *Poništi
  // pretragu* (5); and the page's own retry when the calendar cannot name
  // the viewer's role (6). The phone's `SortControl` is a shared component,
  // and every row's name is a `<Link>`; nothing on the overview writes.
  // ONE MORE BUTTON SINCE E884: the search moved into the overview's filter
  // bar (still the one field), whose chips are the shared
  // `OptionFilterBar`'s, and the empty line the chips leave offers
  // *Poništi filtre*.
  // NINE SINCE STORY 9.3: a member's *Zatraži godišnji*, a `<Button asChild>`
  // link to the request form; and in their requests list *Povuci zahtjev*,
  // written once inside the map over the rows, and the list's own retry.
  { name: 'the Godišnji destination', file: GODISNJI, expectedFields: 1, expectedButtons: 9 },
  // STORY 9.3. On the request form: the od and do `<Input>`s, *Pošalji*,
  // *Odustani* (a `<Button asChild>` link back to Godišnji), the figures'
  // unavailable alert's retry, *Natrag na Godišnji* above the title (written
  // once, drawn in every state), and the page's own retry when the calendar
  // cannot name the role. No type and no half day (Epic 13), and nothing
  // that decides: the count is what notices one arriving.
  { name: 'the leave request form', file: LEAVE_REQUEST, expectedFields: 2, expectedButtons: 5 },
  // STORY 5.3b. ONE on Za odluku: the retry its unavailable alert offers. The
  // queue is read, never pressed: no `Riješi` and no bulk action. STILL ONE
  // SINCE STORY 5.4b: each row became a `<Link>` to its resolution screen,
  // written once inside the map over the rows, which no detector reads.
  { name: 'the Za odluku destination', file: ZA_ODLUKU, expectedFields: 0, expectedButtons: 1 },
  // STORY 5.4b. On one conflict's screen: the way back (written once, drawn
  // in every state and again under a refusal that the conflict is gone), ‹
  // and ›, Odustani and Spremi odluku, and the unavailable alert's retry. The
  // one radio card is the radio group's, not a `<Button>`. No checkbox and no
  // bulk action exist, which is what the count keeps true.
  // STILL SIX SINCE STORY 5.4c: the second card and the candidate picker's
  // rows are radio items of their own groups, never a `<Button>`.
  { name: 'the conflict resolution screen', file: RESOLUTION, expectedFields: 0, expectedButtons: 6 },
  // STORY 9.4. On one leave request's decision screen: *Natrag na Za odluku*
  // (written once, drawn in every state), the unavailable alert's retry, and
  // *Odbij* and *Odobri*. No confirmation, no reason field (Epic 9 has none)
  // and no bulk action, which is what the count keeps true.
  { name: 'the leave request decision screen', file: LEAVE_REQUEST_REVIEW, expectedFields: 0, expectedButtons: 4 },
  // STORY 10.3. ONE on *Obavijesti*: the unavailable alert's retry. The email
  // on/off is a radio group, never a `<Button>`, and the address is shown,
  // never a field: the count is what notices an address input arriving.
  // Two buttons since story 10.4: each section's retry.
  { name: 'the notification settings screen', file: NOTIFICATIONS, expectedFields: 0, expectedButtons: 2 },
  // STORY 2.1b. FIVE on the band list: the link back to `Organizacija`, the
  // name `<Input>`, the start `<Input type="time">`, the add `<Button>`, and ONE
  // row link written once inside the map over the bands — the same count at
  // zero bands as at twelve. Only a name and a start: no window, duration or
  // midnight control exists, which is what the count keeps true. SEVEN on one
  // band: the two fields, Save, the removal offer, the confirm and cancel that
  // replace it, and the link back.
  // SEVEN ON THE LIST SINCE DESIGN REFRESH C: the add form moved into a
  // dialog, which brought the button that opens it and the dialog's own
  // cancel. The dialog's close button is `DialogHeader`'s, not the screen's.
  // EIGHT SINCE THE DEFERRED-WORK SWEEP: the read failure's retry.
  { name: 'the hour band list', file: HOUR_BAND_LIST, expectedFields: 2, expectedButtons: 6 },
  // SIX ON ONE BAND SINCE DESIGN REFRESH C: the edit form is a dialog over the
  // list, and the link back gave way to the dialog's own close.
  // SEVEN SINCE THE DEFERRED-WORK SWEEP: the read failure's retry.
  { name: 'the hour band edit form', file: HOUR_BAND_EDIT, expectedFields: 2, expectedButtons: 5 },
  // STORY 2.2b. SIX on the shift type list: the name `<Input>`, the working /
  // non-working `<select>`, the start and end `<Input type="time">`s (a
  // non-working type is offered neither), the add `<Button>`, and ONE row link
  // written once inside the map over the types. No colour, emoji, multiplier,
  // valid-days or hour-band control exists, which is what the count keeps true.
  // ELEVEN on one type: the name and Save; the times block's date, start, end
  // and submit, and the cancel that replaces them while a correction is
  // scheduled; the archive offer, the confirm and cancel that replace it; and
  // the link back. No `is_working` control and no delete.
  // DESIGN REFRESH C: EIGHT on the list, the add form in a dialog with the
  // button that opens it and its cancel; TEN on one type, a dialog over the
  // list whose own close replaced the link back.
  // NINE SINCE STORY 7.6: the stacked row's edit link below 640 px, the same
  // 44 px `<Button asChild>` link as the table's, written once inside the map.
  // TEN AND ELEVEN SINCE THE DEFERRED-WORK SWEEP: each read failure's retry.
  { name: 'the shift type list', file: SHIFT_TYPE_LIST, expectedFields: 4, expectedButtons: 6 },
  { name: 'the shift type edit form', file: SHIFT_TYPE_EDIT, expectedFields: 4, expectedButtons: 7 },
  // STORY 2.3b, AS RENEGOTIATED. SEVEN on the rotation builder, each written
  // once however many steps and teams there are: a step's drag handle and
  // remove (the move arrows are gone), the new step's `<select>` and the add,
  // the anchor date, one team's step `<select>`, and the save. No
  // effective-date control (2.6) and no delete of a pattern.
  // EIGHT SINCE THE OWNER ADDITION: `Rasporedi ravnomjerno`, which only
  // fills the draft.
  // NINE SINCE THE CYCLES CHOICE: the preview's native `<select>`.
  // TWELVE SINCE STORY 2.4: the phone stepper's bar step (written once for
  // all four), Natrag and Dalje. No width switch in script: all three are
  // hidden from `sm` up by CSS.
  // SIXTEEN SINCE STORY 2.6: the `Vrijedi od` date, the cancel offered beside
  // the scheduled refusal, and its confirmation's keep and confirm. The
  // history is a table and offers nothing.
  // TWENTY-ONE SINCE STORY 5.5a: the erasure confirmation's two toggles per
  // row (written once), its "Natrag na uređivanje" and its own save, and the
  // retry beside the refusal when the check cannot be derived.
  // SEVENTEEN SINCE STORY 5.5b: the confirmation's four moved with it to the
  // shared `ErasureDialog`, counted below; the retry stays.
  // EIGHTEEN SINCE STORY 5.5g: the retry inside the cancel's confirmation,
  // when what the cancel would erase cannot be checked. The cancel's own
  // erasure dialog is a second shared `ErasureDialog`, counted below.
  // NINETEEN SINCE STORY 5.5c: the save bar's "Odbaci promjene". The save
  // moved from the header into the bar and is still written once.
  // TWENTY SINCE THE DEFERRED-WORK SWEEP: the read failure's retry.
  { name: 'the rotation builder', file: ROTATION_SECTION, expectedFields: 5, expectedButtons: 15 },
  // STORY 7.18. ONE on the rotation history: the header button that opens
  // it. The dialog's close is `DialogHeader`'s, and the table offers nothing.
  { name: 'the rotation history', file: ROTATION_HISTORY_DIALOG, expectedFields: 0, expectedButtons: 1 },
  // STORY 5.5b. FOUR on the shared erasure confirmation, each written once
  // however many rows: a row's "Potvrdi brisanje" and "Zadrži", "Natrag na
  // uređivanje" and its own save.
  { name: 'the erasure confirmation', file: ERASURE_DIALOG, expectedFields: 0, expectedButtons: 4 },
  // STORY 3.5c. NINE on the override review, each written once however many
  // overrides are pending: a row's confirm, amend and discard; the amend's
  // type `<select>`, reason, cancel and save; and the discard's cancel and
  // confirm. The amend dialog's close is `DialogHeader`'s, not the screen's.
  // TEN SINCE STORY 5.5h: the retry beside the refusal when what a confirm or
  // an amend would erase cannot be checked, written once and shown in the
  // review or inside the amend's dialog. Its erasure confirmation's controls
  // are the shared `ErasureDialog`'s, counted there.
  { name: 'the rotation override review', file: ROTATION_OVERRIDE_REVIEW, expectedFields: 2, expectedButtons: 8 },
  // ZERO on every remaining placeholder (four since story 2.2b built
  // `/postavke-rotacije`), and asserted rather than assumed: a placeholder is a
  // heading and nothing else, so the first control any of them grows is a
  // later story's work arriving without that story's review. The count is also
  // what keeps the tap-target sweep from reading as coverage on screens it
  // finds nothing to measure.
  ...DESTINATION_SCREENS.map((destination) => ({ ...destination, expectedFields: 0, expectedButtons: 0 })),
  // The layout renders no string of its own, and is swept anyway: it is a
  // `.tsx` under `pages/`, so the literal, bare-text and `destructive` sweeps
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
  { name: 'the signed-in layout', file: LAYOUT, expectedFields: 0, expectedButtons: 0 },
  // SIX on the chrome: the collapse (on the page since the sidebar redesign),
  // the theme's segmented pill (human decisions 2026-09-25/26), the profile
  // card that discloses the exit, the exit, the retry that makes the role
  // read's failure something a person can act on, and *Više* (story 7.3),
  // which replaced the theme's cycling glyph when the phone bar lost it.
  // SEVEN with story 8.4's *Instaliraj*: one button, rendered in the profile
  // menu and in the sheet, that opens the held install prompt or discloses
  // the iOS steps. The sheet's close is `DialogHeader`'s own button,
  // measured with the primitive. The
  // destinations are `<Link>`s, which neither detector matches by construction —
  // they are swept by name in the chrome block below, with their own count — so
  // this number is the seven BUTTONS and nothing else. It is what notices an
  // eighth arriving: on a component that renders above every destination in the
  // application, a control nobody reviewed is a control on eight screens.
  { name: 'the navigation chrome', file: CHROME, expectedFields: 0, expectedButtons: 7 },
  // ZERO on the lockup, and it is a claim rather than an accident of what has
  // been built: nothing about an organization's logo is pressable. It is not a
  // link to the organization, not a menu trigger and not a home button — which
  // is also why it is exempt from UX-DR40's 44 px floor and may be 32 px inside
  // the phone bar, where nine real targets already compete for the width. The
  // first handler added here would make it a control nobody measured.
  { name: 'the organization lockup', file: LOCKUP, expectedFields: 0, expectedButtons: 0 },
  // ZERO on the sign-in frame (visual refresh A): the brand panel is a product
  // name, a headline and a subline. A control here would be a sign-in
  // affordance outside the two frozen forms.
  { name: 'the sign-in frame', file: AUTH_LAYOUT, expectedFields: 0, expectedButtons: 0 },
];

/**
 * A `.ts` module that renders no JSX but holds `t()` keys.
 *
 * `signInMessageKey` moved the two refusal keys out of the screen and into
 * `@/features/auth/services/sign-in`, where a node test can EXECUTE the pairing — swapping
 * the branches of the ternary it replaced passed every assertion in this file.
 * The keys have to stay in scope for the set comparison below, or every key
 * this application renders would no longer equal every key it declares.
 */
export const MESSAGE_KEYS = join(srcRoot, 'features', 'auth', 'services', 'sign-in.ts');

/** The same shape, for story 1.4a's four organization failures. */
export const ORGANIZATION_MESSAGE_KEYS = join(srcRoot, 'features', 'organization', 'utils', 'messages.ts');

/** The same shape again, for the chrome's role and sign-out failures. */
export const NAVIGATION_MESSAGE_KEYS = join(srcRoot, 'features', 'navigation', 'utils', 'messages.ts');

/** The same shape for the *Više* sheet's copy per destination (story 7.3's mockup). */
export const DESTINATION_COPY_KEYS = join(srcRoot, 'features', 'navigation', 'utils', 'destination-copy.ts');

/** UX-DR40's tap-target floor, in CSS pixels. */
export const TARGET_FLOOR_PX = 44;

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
export function stripComments(source: string): string {
  return source.replace(BLOCK_COMMENT, '').replace(LINE_SLASH, '$1');
}

/** A screen's file set read as one comment-blind source, joined in order. */
export function screenSource(set: readonly string[]): string {
  return set.map((file) => stripComments(readFileSync(file, 'utf8'))).join('\n');
}

export function source(file: SourceSet): string {
  return typeof file === 'string' ? stripComments(readFileSync(file, 'utf8')) : screenSource(file);
}

/** How many times a needle appears. The counting idiom
 *  `features/organization/services/snapshot.test.ts` uses for its one-read assertions. */
export function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
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
export function submitHandler(screen: string): string {
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
/** A top-level exported function of a module, from `export` to its closing brace. */
export function exportedFunction(text: string, name: string): string {
  return new RegExp(`export (?:async )?function ${name}\\([\\s\\S]*?\\n\\}`).exec(text)?.[0] ?? '';
}

export function namedHandler(screen: string, name: string): string {
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
export function componentFunction(screen: string, name: string): string {
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
export function finallyBlock(screen: string): string {
  return /\}\s*finally\s*\{([\s\S]*?)\n {4}\}/.exec(screen)?.[1] ?? '';
}

/** Every key handed to `t()`, in source order. */
export function translationKeys(text: string): string[] {
  return [...text.matchAll(/\bt\(\s*'([^']+)'/g)].map((found) => found[1] ?? '');
}

/**
 * The keys `signInMessageKey` can return, read off its RETURN TYPE.
 *
 * `@/features/auth/services/sign-in` renders no JSX and calls no `t()`, so `translationKeys`
 * finds nothing in it — and the two refusal keys would drop out of the
 * rendered set entirely, taking the "every key declared is rendered" claim with
 * them.
 *
 * The union is the right place to read them from rather than a second-best one:
 * it is what makes `t(signInMessageKey(failure))` type-check against `hr.json`
 * (`lib/i18n/index.ts`), so a key that is not in the resource file is already a
 * `pnpm typecheck` failure, and a key added to the function body without being
 * added to the union is too.
 */
export function messageKeyUnion(text: string): string[] {
  // `\w*MessageKey` rather than `signInMessageKey`, because story 1.4a writes
  // the second instance of this shape (`organizationMessageKey`) and a reader
  // pinned to the first one would return nothing for it — silently dropping four
  // keys out of the rendered set and weakening the set comparison below by four.
  const signature = /function \w*MessageKey\([\s\S]*?\):([^{]*)\{/.exec(text)?.[1] ?? '';

  return [...signature.matchAll(/'([^']+)'/g)].map((found) => found[1] ?? '');
}

/**
 * Every `\w*MessageKey` return union in a file, not only the first: the
 * calendar's override writes (story 3.5b) map their refusals through one and
 * what a landed write says through another.
 */
export function messageKeyUnions(text: string): string[] {
  return [...text.matchAll(/function \w*MessageKey\([\s\S]*?\):([^{]*)\{/g)].flatMap((found) =>
    [...(found[1] ?? '').matchAll(/'([^']+)'/g)].map((quoted) => quoted[1] ?? ''),
  );
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
 * Self-tested on both polarities in `sweep-detectors.test.ts`, like every other
 * detector here: a reader that found nothing would make the set comparison pass
 * on a resource file missing all eleven.
 */
export function memberListKeys(text: string): string[] {
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
 * Self-tested on both polarities in `sweep-detectors.test.ts`, like every other
 * detector here.
 */
export function memberWriteKeys(text: string): string[] {
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
export const STRUCTURAL_ATTRIBUTES = new Set([
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
  // `variant` is NOT here, though story 1.4a first put it here: it is exempt
  // only on the primitives whose `variant` is a closed set (`VARIANT_COMPONENTS`
  // below), because this set applies to every attribute on every element.
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
  // ADDED by story 5.1c's leave card, and named for the reason `aria-current`
  // is: `aria-live` takes its value from a CLOSED, NON-TEXTUAL vocabulary the
  // ARIA specification fixes — `off`, `polite`, `assertive` — and renders
  // nowhere. The leave preview's reason is announced through it without the
  // `status` role, which the screen's own confirmations already carry.
  'aria-live',
  // ADDED by story 1.5a's member list, and it is a loosening of a GLOBAL
  // allowlist — this set applies to all fourteen swept screens — so it is named
  // and justified rather than waved through, exactly as `role`,
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
  // ADDED by design refresh C's dialogs, on `aria-describedby`'s own argument:
  // `aria-labelledby` is an ID REFERENCE LIST. Its value names the dialog's
  // heading on the same page and renders nowhere, so nothing user-facing can
  // hide in it. `aria-label` remains guarded.
  'aria-labelledby',
  // ADDED by story 3.1's calendar grid, and it is a loosening of a GLOBAL
  // allowlist, so it is named. `scope` on a table header takes its value from
  // a CLOSED, NON-TEXTUAL vocabulary HTML fixes — `row`, `col`, `rowgroup`,
  // `colgroup` — and renders nowhere; it is what ties a date's row and a
  // team's column to their cells for assistive technology. `aria-label`
  // remains guarded.
  'scope',
  // ADDED by story 7.3's *Više* button, and it is a loosening of a GLOBAL
  // allowlist, so it is named. `aria-haspopup` takes its value from a CLOSED,
  // NON-TEXTUAL vocabulary the ARIA specification fixes — `true`, `false`,
  // `menu`, `listbox`, `tree`, `grid`, `dialog` — and renders nowhere; it tells
  // a screen reader that *Više* opens a dialog. Paid for like `aria-current`:
  // `ariaHaspopupValues` holds every value on every swept screen to that
  // vocabulary. `aria-label` remains guarded.
  'aria-haspopup',
]);

/**
 * The primitives whose `variant` prop is structure, not content.
 *
 * Story 1.4a admitted `variant` for one button, on the argument that it takes a
 * value from `buttonVariants`' own closed set — `default`, `outline`,
 * `secondary`, `ghost`, `link` — and selects a class list, never text: a value
 * outside the set is a `tsc` error. That argument is true of a COMPONENT, not
 * of the attribute name, so the exemption is scoped to the components it was
 * argued for rather than sitting on the global allowlist above, where it
 * exempted `variant` on any future element whose prop is free text. `Badge`
 * and `IconTile` are `cva` primitives in `components/ui` on the same terms.
 * Note `buttonVariants`' sixth member is `destructive`, which is banned
 * separately and by name in every screen, so this does not widen that.
 * `Notice` joined in story 8.2: its `variant` is the closed set `offline`,
 * which picks the WifiSlash icon of the as-of note and no text.
 */
const VARIANT_COMPONENTS = new Set(['Button', 'Badge', 'IconTile', 'Notice']);

/**
 * The text with every `variant` attribute on a {@link VARIANT_COMPONENTS}
 * element removed, quoted or braced. The element is the nearest opening tag
 * before the attribute — an attribute value holding an arrow carries `>` but
 * never `<`, so the nearest `<Name` is the tag it sits on.
 */
function withoutComponentVariants(text: string): string {
  return text.replace(/\bvariant=(?:"[^"]*"|\{[^{}]*\})/g, (attribute, offset: number) => {
    const tags = [...text.slice(0, offset).matchAll(/<([A-Za-z][\w.]*)/g)];
    const tag = tags.at(-1)?.[1];

    return tag !== undefined && VARIANT_COMPONENTS.has(tag) ? '' : attribute;
  });
}

/** Content inside a template literal, with every `${…}` removed. */
export function templateStaticText(raw: string): string {
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
 * A WIDENING, so it is deliberately narrow: only a container with no nested
 * braces of its own, and only the names in {@link STRUCTURAL_EXPRESSION_ATTRIBUTES}
 * — an explicit subset, NOT the whole allowlist. Generated from the whole set,
 * every entry added to the allowlist for its quoted form was exempted in
 * expression form too, with no review moment of its own. Every other attribute
 * keeps firing in every form, which the detector block below proves on both
 * polarities.
 */
export const STRUCTURAL_EXPRESSION_ATTRIBUTES = [
  // Story 1.3b, the case this exists for: an id reference rendered only on
  // failure, so the value has to be a branch.
  'aria-describedby',
  // Class lists chosen by state (the active row, the today cell). A class
  // name renders nowhere; the theme sweeps own what it may say.
  'className',
  // A closed ARIA vocabulary chosen by state — `page` on the active
  // destination, `step` on the rotation's current step — never a name.
  'aria-current',
  // `true` or `false`, chosen by whether the field's value was refused.
  'aria-invalid',
  // An input type chosen by state: the password toggle's `text`/`password`,
  // and `date`. HTML's closed set, rendering nothing of its own.
  'type',
];

const STRUCTURAL_EXPRESSION = new RegExp(
  `\\b(?:${STRUCTURAL_EXPRESSION_ATTRIBUTES.join('|')})=\\{[^{}]*\\}`,
  'g',
);

export function unsanctionedLiterals(text: string): string[] {
  const withoutKeys = withoutComponentVariants(text).replace(/\bt\(\s*'[^']+'/g, 't(');
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

export function stripTypeArguments(text: string): string {
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
export function jsxTextWithContent(text: string): string[] {
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
 *
 * Read off the same neutralized text as {@link jsxTextWithContent}: the tag's
 * `[^>]*` stops at the first `>`, so an `<h1>` carrying an arrow or a generic
 * in an attribute read as no heading at all.
 */
export function headingKey(text: string): string | null {
  const neutralized = stripTypeArguments(text).replace(/=>/g, '__');

  return /<h1\b[^>]*>\s*\{t\('([^']+)'\)\}/.exec(neutralized)?.[1] ?? null;
}

/** `htmlFor` values, in source order. */
export function labelTargets(text: string): string[] {
  return [...text.matchAll(/htmlFor="([^"]+)"/g)].map((found) => found[1] ?? '');
}

/** Every `<Input …/>` element's attribute block. */
export function inputElements(text: string): string[] {
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
export function bareInputElements(text: string): string[] {
  return [...text.matchAll(/<input\b([\s\S]*?)\/>/g)].map((found) => found[1] ?? '');
}

/**
 * Every `<Select …>` opening tag's attribute block — the primitive, which
 * renders the native `<select>`. Capital-`S` since the primitive arrived, for
 * the reason `inputElements` reads `<Input`: the composed `className` the 44 px
 * sweep measures is written on the primitive. A bare `<select>` on a screen is
 * refused outright in the select-look block below.
 *
 * Added by story 1.4c, and a FOURTH control detector rather than a widening of
 * the three, for the reason `linkElements` is a third: a native `<select>` is
 * not a `<Button>` and must not be counted as one — `expectedButtons` on every
 * other screen is a tight number, and folding a new element type into it would
 * loosen all of them to cover one file. What it shares with a button is the
 * only thing asserted through it: a person taps it, so UX-DR40's floor applies.
 *
 * Every consumer brings its own length assertion, the rule every element regex
 * here follows.
 */
export function selectElements(text: string): string[] {
  return [...text.matchAll(/<Select\b([\s\S]*?)>/g)].map((found) => found[1] ?? '');
}

/** Every `<Button …>` opening tag's attribute block. */
export function buttonElements(text: string): string[] {
  return [...text.matchAll(/<Button\b([^>]*?)\/?>/g)].map((found) => found[1] ?? '');
}

/**
 * Every `<nav …>…</nav>` block, opening tag to closing tag.
 *
 * Added because COUNTING the chrome's controls says nothing about WHERE they
 * are. Two bars render from the same two variables, and deleting `{exit}` from
 * one of them leaves the `<Link>` count at one, the chrome's `expectedButtons`
 * unchanged, and every responsive-class assertion untouched — a phone build with navigation and
 * no way to sign out, green. The only thing that notices is reading each bar's
 * contents, which is what this extracts.
 *
 * Non-greedy, which is correct here and would not be if a `<nav>` were ever
 * nested inside another; the consumer asserts the count, so that day fails
 * loudly rather than silently merging two bars into one.
 */
export function navBlocks(text: string): string[] {
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
export function ariaCurrentValues(text: string): string[] {
  return [...text.matchAll(/aria-current=(?:"([^"]*)"|\{([^}]*)\})/g)].flatMap((found) => {
    const literal = found[1];

    if (literal !== undefined) return [literal];

    return [...(found[2] ?? '').matchAll(/'([^']*)'/g)].map((quoted) => quoted[1] ?? '');
  });
}

/**
 * Every LITERAL value an `aria-haspopup` attribute is given, on any screen.
 *
 * The twin of `ariaInvalidValues`, for the entry story 7.3 put on
 * `STRUCTURAL_ATTRIBUTES`: the exemption holds only while every value stays in
 * the ARIA vocabulary, and this is what reads them.
 */
export function ariaHaspopupValues(text: string): string[] {
  return [...text.matchAll(/aria-haspopup="([^"]*)"/g)].map((found) => found[1] ?? '');
}

export function linkElements(text: string): string[] {
  return [...text.matchAll(/<Link\b([^>]*?)\/?>/g)].map((found) => found[1] ?? '');
}

export function attributeOf(element: string, name: string): string | null {
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
export function idTokens(value: string | null): string[] {
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
export function describedByIds(element: string): string[] {
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
export function heightPx(className: string | null): number | null {
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

/** Every leaf key path in the resource file (the shared flattener). */
export function resourceKeys(): string[] {
  return leafKeys(JSON.parse(readFileSync(RESOURCE, 'utf8')));
}
