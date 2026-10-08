import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * `hr.json` is the artifact story 1.1d multiplies, and nothing guarded it.
 *
 * Story 1.1c's own frozen boundary says: "No screen, navigation, nav label or
 * terminology string in the resource file — 1.1d owns every screen literal so
 * it reviews them in one place." That is a rule about a file whose whole
 * purpose is to grow, written at the one moment the file is small enough to
 * state it precisely. Nothing enforced it, and nothing enforced UX-DR34's or
 * UX-DR36's constraints on what the strings may say either — so the first
 * screen literal added out of turn, or the first `smjena` used for a shift
 * type, would land with no assertion in its way.
 *
 * Shaped after `test/key-hygiene.test.ts`: a small number of specific fears,
 * each with its own sweep, and a vacuous-pass guard so an unreadable or
 * restructured file cannot look compliant.
 *
 * When a story legitimately adds screen strings, the SANCTIONED_KEYS list is
 * what it updates — deliberately, in the same commit, which is the review
 * moment this exists to create. Story 1.1d did exactly that, and in doing so
 * had to split the list: the three-form ICU assertion below is a rule about
 * PLURALS, and appending `auth.heading` to a single list would have failed it
 * as a non-plural rather than checked it as a screen string.
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const RESOURCE = join(repoRoot, 'apps', 'web', 'src', 'lib', 'i18n', 'locales', 'hr.json');

/** The two plural messages story 1.1c is permitted to ship (`EXPERIENCE.md:81`).
 *  Only these carry an ICU `plural` argument, so only these are checked for the
 *  three Croatian categories. */
const SANCTIONED_PLURAL_KEYS = [
  'count.days',
  'count.conflicts',
  // STORY 1.5a's FOUR, and they are the first plural messages in this file that
  // a screen actually renders — `count.days` and `count.conflicts` were
  // authored ahead of any surface that says them. The member list states a row
  // count and gives every filter option a count of its own (UX-DR19), and a
  // count in Croatian needs all three forms or the noun is wrong: `1 osoba`,
  // `3 osobe`, `5 osoba`, and `21 osoba` again — which `count === 1` gets wrong
  // at 21 and ICU gets right through `Intl.PluralRules`.
  //
  // They are here rather than in the screen list below because that list
  // asserts a plain string and would refuse an ICU argument; splitting them is
  // what makes each list check the thing it is for.
  'ljudi.count',
  'ljudi.filterAll',
  'ljudi.filterAdmin',
  'ljudi.filterMember',
  // STORY 7.6: the unit beside a member's leave allowance on the phone's
  // stacked row, where no column heading stands above it — `1 dan god.`,
  // `2 dana god.`, `21 dan god.`. The figure itself is the cell's own.
  'ljudi.leaveUnit',
  // STORY 1.7a's TWO: the active teams' stated count and the archived group's,
  // both rendered at zero — `0 smjena` — and both ICU so `21 smjena` and
  // `22 smjene` come out right. No count is special-cased (DI-8).
  'smjene.count',
  'smjene.archivedCount',
  // STORY 1.8: how many people are on a team today, rendered at zero too —
  // `0 osoba`, `1 osoba`, `2 osobe`, `5 osoba`, `21 osoba`.
  'smjene.roster.count',
  // STORY 2.1b: how many hour bands the organization has, rendered at zero —
  // `0 pojaseva`, `1 pojas`, `2 pojasa`, `21 pojas`. Durations are NOT here:
  // `12 h` and `1 h 30 min` are units and take no plural.
  'organization.hourBands.count',
  // THE MEMBER LIST'S TEAM FILTER, three options each stating its own count,
  // rendered at zero — `Bez smjene: 0 osoba`. Under `smjene.membership.*`
  // rather than `ljudi.*`, because only the team namespace may say `smjena`.
  // `filterTeam` interpolates the team's name, which is data and never a key.
  'smjene.membership.filterAll',
  'smjene.membership.filterTeam',
  'smjene.membership.filterNone',
  // STORY 2.2b: how many shift types are in use, rendered at zero —
  // `0 tipova smjena`, `1 tip smjene`, `2 tipa smjene`, `21 tip smjene`.
  'rotation.shiftTypes.count',
  // STORY 2.3b: the cycle length under the pattern, rendered at zero —
  // `0 dana`, `1 dan`, `2 dana`, `21 dan`.
  'rotation.builder.cycleLength',
  // OWNER REQUEST: the preview's cycles choice, `1 ciklus`, `2 ciklusa`,
  // `5 ciklusa`.
  'rotation.builder.cycleCount',
  // STORY 2.5: the save's warnings — how many there are (`1 upozorenje`,
  // `2 upozorenja`, `5 upozorenja`), and the days of the next cycle with a
  // gap or a duplicate (`1 dan`, `2 dana`, `5 dana`).
  'rotation.builder.warnings.summary',
  'rotation.builder.warnings.coverageGap',
  'rotation.builder.warnings.duplicateCoverage',
  // STORY 2.6: how many teams one saved change binds, in the history —
  // `1 smjena`, `2 smjene`, `5 smjena`. The builder's namespace may say the Team.
  'rotation.builder.history.teamCount',
  // STORY 3.5c: how many overrides wait for review after a rotation change —
  // `1 izmjena čeka`, `2 izmjene čekaju`, `5 izmjena čeka` — in the review and
  // in the save's confirmation.
  'rotation.builder.overrides.count',
  // STORY 5.5a: how many conflicts a rotation change would erase, in the
  // confirmation's title (`1 konflikt`, `2 konflikta`, `5 konflikata`) and
  // its lede (`1 neriješenog`, `2 neriješena`, `5 neriješenih konflikata`).
  'rotation.builder.erasures.title',
  'rotation.builder.erasures.lede',
  // STORY 5.5a (review): what a guarded save removed, in its confirmation —
  // `Uklonjen 1 konflikt`, `Uklonjena 2 konflikta`, `Uklonjeno 5 konflikata`.
  'rotation.builder.erasures.removed',
  // STORY 5.5b: the same three counts for a calendar roster change — its
  // erasure confirmation's title and lede, and what a guarded write removed.
  'kalendar.detail.rosterChange.erasures.title',
  'kalendar.detail.rosterChange.erasures.lede',
  // A removal's lede, "… Prije uklanjanja odluči za svaki." (review).
  'kalendar.detail.rosterChange.erasures.ledeRemoval',
  'kalendar.detail.rosterChange.erasures.removed',
  // STORY 5.5f: the same counts for a calendar shift-type override — its
  // erasure confirmation's title, a set's and a removal's lede, and what a
  // guarded write removed.
  'kalendar.detail.override.erasures.title',
  'kalendar.detail.override.erasures.lede',
  'kalendar.detail.override.erasures.ledeRemoval',
  'kalendar.detail.override.erasures.removed',
  // STORY 5.5g: the same three counts for cancelling a scheduled rotation
  // change — its erasure dialog's title and lede, and what a guarded cancel
  // removed.
  'rotation.builder.cancelScheduled.erasures.title',
  'rotation.builder.cancelScheduled.erasures.lede',
  'rotation.builder.cancelScheduled.erasures.removed',
  // STORY 5.5h: the same three counts for confirming or amending an override
  // in the builder's review — its erasure dialog's title and lede, and what a
  // guarded disposition removed. A confirm's and an amend's lede are two keys.
  'rotation.builder.overrides.erasures.title',
  'rotation.builder.overrides.erasures.ledeConfirm',
  'rotation.builder.overrides.erasures.ledeAmend',
  'rotation.builder.overrides.erasures.removed',
  // STORY 5.5e: the same three counts for the member page's team and status
  // cards — their erasure dialogs' title and lede, and what a guarded write
  // removed.
  'ljudi.erasures.title',
  'ljudi.erasures.lede',
  'ljudi.erasures.removed',
  // STORY 4.1b: how many shifts the viewer works in the month and in each
  // band — `0 smjena`, `1 smjena`, `2 smjene`, `21 smjena` — and the note on
  // the ones with no times, shown only when there is one.
  'sati.shiftCount',
  'sati.untimed',
  // STORY 5.3d: the viewer's shifts in unresolved conflict on *Sati*, shown
  // only above 0 — `1 smjena`, `2 smjene`, `5 smjena u neriješenom konfliktu`.
  'sati.conflicts',
  // STORY 7.5: the filter bar Kalendar and Sati share — a team's person
  // count (`4 osobe`), the summary line with no filter, a team, or a team and
  // a person (`17 osoba`, `4 osobe od 17`, `0 osoba`), and the sheet's
  // `Prikaži 1 osobu`, `Prikaži 4 osobe`, `Prikaži 17 osoba`.
  'filter.personCount',
  'filter.summary.all',
  'filter.summary.team',
  'filter.summary.both',
  'filter.sheetShow',
  // STORY 5.1c: the leave card's three day counts that are a sentence of their
  // own — the preview's over-balance note and the two lines a landed save
  // shows — each carrying a number that may be negative (`−2 dana`) — and the
  // part of a range crossing the leave year's edge charged to this year. The
  // bare figures render through `count.days`.
  'ljudi.leaveRecord.exceeds',
  'ljudi.leaveRecord.costInYear',
  'ljudi.leaveRecord.saved',
  'ljudi.leaveRecord.savedExceeds',
  // STORY 5.2b: the line a landed amend shows, with what the new range cost.
  // Its over-balance warning is 5.1c's `savedExceeds`.
  'ljudi.leaveRecord.amended',
  // STORY 5.3b: the conflicts queue's count, always shown — `0 neriješenih
  // konflikata` included (UX-DR20). Its own key rather than `count.conflicts`,
  // because the adjective agrees with the noun in all three forms.
  'raspored.count',
  // STORY 5.4b: the resolution screen's four counts — the way back's
  // `Raspored · 7 neriješenih`, the causing record's cost in days, the
  // coverage term's roster (`3 od 4 člana`, `od 5 članova`), and the balance
  // the decision leaves (`16 dana preostalo`).
  'raspored.resolution.back',
  'raspored.resolution.leave',
  'raspored.resolution.coverage',
  'raspored.resolution.balance',
  // STORY 5.4d: what the third card gives back to the balance, `+1 dan`.
  'raspored.resolution.balanceGained',
  // SINCE STORY 6.3: an admin's Danas — how many of the unresolved conflicts are
  // past (`1 na datum koji je prošao`, `3 na datume koji su prošli`), and how
  // many of a shift's roster are present (`3 od 4 člana`, `5 od 5 članova`).
  'danas.admin.needsYou.pastLine',
  'danas.admin.coverage.members',
];

/** The flat screen strings the application is permitted to ship, by the story
 *  that earned each of them: 1.1d's sign-in screen, 1.3b's refusals and
 *  organization prompt, the navigation shell's eight `nav.*` destination
 *  labels, 1.4a's settings surface, 1.4b's logo, and the navigation chrome's
 *  four. Nothing else in the tree may add a key without editing this list, which
 *  is the point: the list IS the review moment, and a story that grows the
 *  resource file has to grow this in the same commit.
 *
 *  NO TOTAL IS WRITTEN HERE ANY MORE. This comment said "thirty-three" against
 *  forty entries, which is the failure mode of a count kept in prose beside the
 *  thing it counts — it is never wrong at a moment anybody is reading it, and it
 *  is stale by the next commit. The exhaustive set comparison below is the count,
 *  and it is the one that fails. */
const SANCTIONED_SCREEN_KEYS = [
  'auth.heading',
  'auth.username',
  'auth.password',
  'auth.submit',
  // STORY 7.7: the button's label while signing in, the password toggle's name,
  // and the forgotten-password disclosure's trigger and panel.
  'auth.pending',
  'auth.passwordShow',
  'auth.forgot.trigger',
  'auth.forgot.heading',
  'auth.forgot.body',
  // Two, not three. A wrong organization (story 7.7), a wrong password, an
  // unknown username and a deactivated account share `auth.error.credentials`: a third message would tell an
  // anonymous caller which usernames exist in an organization, which is the
  // enumeration oracle story 1.3b refused a resolution RPC for.
  'auth.error.credentials',
  'auth.error.unavailable',
  // STORY 7.7: the organization is a field of the one sign-in form — its
  // label, the URL slug row's `Promijeni` and its accessible name, and the
  // field's two hints and its placeholder. The separate prompt's heading and button went with it.
  'auth.organization.label',
  'auth.organization.change',
  'auth.organization.changeLabel',
  'auth.organization.remembered',
  'auth.organization.hint',
  'auth.organization.placeholder',
  // VISUAL REFRESH A's three: the sign-in brand panel's product name, headline
  // and subline, rendered around the sign-in form from `lg` up.
  'auth.brand.name',
  'auth.brand.headline',
  'auth.brand.subline',
  // NO `home.*` KEY, and there is no screen at `/` for one to belong to: it is
  // a redirect-only route. This list is an EQUALITY assertion, so a key added
  // to `hr.json` for a screen that does not render is refused here.
  // The eight destination labels, added by the navigation shell's route
  // skeleton. EIGHT, not nine: `Sati` appears in both UX-DR31's member list and
  // UX-DR32's admin list and is one destination with role-scoped content
  // (human decision, 2026-09-04). There is still no `nav.odjava`, and there is
  // still not meant to be one — the chrome's exit ships as `shell.signOut`
  // below, because this namespace is DESTINATIONS and the exit is an action
  // rather than a place. `apps/web/src/features/navigation/utils/destinations.test.ts` holds
  // the two apart by comparing every `nav.*` key to the eight exactly.
  'nav.danas',
  'nav.kalendar',
  'nav.sati',
  'nav.godisnji',
  'nav.raspored',
  'nav.ljudi',
  'nav.postavkeRotacije',
  'nav.organizacija',
  'notFound.heading',
  'notFound.back',
  // Story 1.4a — the organization settings surface. FIVE labels, one per
  // editable field, and no sixth: the slug is never editable (AD-12 builds every
  // sign-in address from it), the locale is a hard-coded constant so a control
  // over it would change nothing on screen, and the logo and accent are part B.
  //
  // There is deliberately NO `organization.heading`. The screen's `<h1>` is
  // `nav.organizacija` — the destination's own name, which is what the screen
  // IS — so a heading key here would be the same word authored twice and one of
  // the two would be a string nobody renders.
  'organization.name',
  'organization.timezone',
  // DESIGN REFRESH C: the legend over the day and month, which keep their own
  // keys as the two selects' labels. The organization type left the form.
  'organization.leaveYearStart',
  'organization.leaveYearStartMonth',
  'organization.leaveYearStartDay',
  // Story 1.4b — the organization logo. TWO, and neither of them announces an
  // absence: `organization.logo` names the thing, `organization.logoChoose` is
  // the action. There is deliberately no key for "this organization has no
  // logo": the voice rule states the fact rather than the absence, so the empty
  // case is a neutral mark carrying the organization's name as its accessible
  // name and no sentence at all. `Nema` is banned outright in
  // `test/localization-applied.test.ts`, so a key worded that way would fail
  // there as well as here.
  'organization.logo',
  'organization.logoChoose',
  // Story 1.4c — the lockup and the accent. SEVEN, and not one of them
  // announces an absence.
  //
  // `organization.lockup` is the accessible name the lockup falls back to when
  // the organization's own name is blank — `0002:72` makes that unreachable
  // from the database, but an empty accessible name on a `role="img"` is an
  // element a screen reader announces as nothing at all. It replaces the
  // settings surface's borrowed `nav.organizacija` for that job, because the
  // lockup now renders in the chrome too and "Organizacija" there would name
  // the destination rather than the thing on screen.
  'organization.lockup',
  // The accent control's own label, and then FIVE option names — four curated
  // accents plus no accent. They are names for COLOURS and not for the absence
  // of one: `Neutralna` states what the untinted shell is, where `Nema
  // naglaska` would state what it lacks. `Nema` is banned outright in
  // `test/localization-applied.test.ts`, so a key worded that way would fail
  // there as well as here.
  //
  // FIVE, AND NEVER SIX, is the thing this list is really holding: the option
  // names, `0006`'s check constraint, the tokens in `index.css` and the pairs
  // in `test/theme-contrast.test.ts` are four places one accent exists, and
  // `apps/web/src/features/organization/utils/accent.test.ts` refuses them apart. Adding a
  // fifth accent means editing all four in one commit — which is the review
  // moment, and it is deliberately not cheap.
  'organization.accent',
  'organization.accentNone',
  'organization.accentBlue',
  'organization.accentGreen',
  'organization.accentAmber',
  'organization.accentViolet',
  // MEMBER RANK: the fire-rank setting's label and its two states, which are
  // also its status line.
  'organization.fireRanks',
  'organization.fireRanksOff',
  'organization.fireRanksOn',
  // and its status line, which names the setting it is about.
  'organization.fireRanksStatusOff',
  'organization.fireRanksStatusOn',
  // The two words this story EARNS. Both were asserted absent from every built
  // chunk until now (`test/localization-applied.test.ts`), and both move from
  // that ban into the count sweep in the same commit — the stronger of the two
  // claims: absence said nothing may say the word, a count says `hr.json` is the
  // only thing that may.
  'organization.save',
  'organization.cancel',
  // FOUR refusals, and the partition is the point. A policy refusal, a blank
  // name, some other shape on the table and a service failure are four different
  // things to do next, so collapsing them would cost an action — unlike
  // `auth.error.credentials`, where three refusals share one message precisely
  // so an anonymous caller learns nothing.
  'organization.error.refused',
  'organization.error.name',
  'organization.error.invalid',
  // The one refusal on this surface that is not the database's: `0002:93`
  // leaves `timezone` unchecked because `pg_timezone_names` is not immutable,
  // so the value every later screen renders against is validated in
  // `@/lib/i18n/format` and refused before the write.
  'organization.error.timezone',
  // FIVE MORE from story 1.4b, and the partition is the point again. The
  // storage layer refuses in five distinguishable ways — a refused write, a
  // read that reaches nothing, the
  // bucket's size bound, the bucket's type allowlist, and the service failing —
  // and every one of them is a different thing to do next: ask for the rights,
  // shrink the file, export it differently, try again. Two of them NAME A
  // NUMBER or a list, because the bound is the bucket's (`0005`) and repeating
  // it is the only way the person can act on it.
  'organization.error.logoRefused',
  // A SEPARATE MESSAGE from the refusal above, and the separation is the
  // finding it closes: `logoRefused` says an administrator's rights are needed
  // to CHANGE the logo, which is false of a member whose READ was hidden or
  // whose reference resolved to nothing. Two populations, two messages.
  'organization.error.logoUnreadable',
  'organization.error.logoTooLarge',
  'organization.error.logoType',
  'organization.error.logoUnavailable',
  'organization.error.unavailable',
  // Story 1.5a — the member list. ELEVEN plain strings, plus the four counted
  // ones in the plural list above.
  //
  // There is deliberately NO `ljudi.heading`. The screen's `<h1>` is
  // `nav.ljudi` — the destination's own name, which is what the screen IS — so
  // a heading key here would be the same word authored twice, exactly as the
  // settings surface argues.
  //
  // `ljudi.caption` is the TABLE's accessible name and not the screen's: a
  // `<table>` with no caption is announced as "table" and nothing else, and a
  // screen reader user arriving at one wants to know what it lists before they
  // start moving through its cells.
  'ljudi.caption',
  'ljudi.search',
  // FOUR COLUMN HEADINGS and no fifth. `members` carries no `team_id` until
  // story 1.7, hours are epic 4, and active state is versioned (AD-2) and
  // marked in words inside the name cell by story 1.6 — so a fifth heading
  // here would be a later story's work arriving without that story's review.
  //
  // `ljudi.role` is rendered TWICE, as the column's heading and as the level
  // filter's own label, and that is one key rather than two on purpose: the
  // control filters exactly what the column shows, and two words for one thing
  // is two things to a reader.
  'ljudi.name',
  'ljudi.email',
  'ljudi.role',
  'ljudi.leave',
  // TWO LEVELS, and both are NAMES rather than a name and its absence. They are
  // the exhaustive mapping `memberLevelMessageKey` runs, which is what keeps an
  // unrecognised level from rendering as `Član`.
  'ljudi.admin',
  'ljudi.member',
  // TWO REFUSALS, and neither says what a refusal on this surface must never
  // say. `/ljudi` is reachable only through a guard that has already read this
  // session's level and found it to be an administrator's, so
  // `organization.error.refused`'s wording — "za izmjene trebaš ovlasti
  // administratora" — would be false on the one path that reaches the screen.
  // They state what happened instead.
  'ljudi.error.refused',
  'ljudi.error.unavailable',
  // The member list's one reset: search, level and team back to their
  // defaults in a single action (UX-DR17). Plain words, no count.
  'ljudi.reset',
  // The two member forms. TWENTY strings the screens render and TWELVE
  // refusals the write path maps to, and the partition is the point in both
  // halves. Twelve of the twenty are story 1.5b's; the other eight and the
  // twelfth refusal are the admin-issued reset, which is the second half of
  // story 1.5's acceptance clause 1 rather than story 1.6's.
  //
  // There is deliberately no `ljudi.form.name`, `ljudi.form.email`,
  // `ljudi.form.role` or `ljudi.form.leave`: the four fields are the four
  // COLUMNS of the list, and a form labelling the same thing with a second word
  // would be two words for one thing — the argument `ljudi.role` already makes
  // about being both a heading and the filter's label. `ljudi.form.username` is
  // the one field with no column, because `0007`'s username renders in no
  // column (`apps/web/src/features/members/services/list.ts`).
  'ljudi.form.newHeading',
  'ljudi.form.editHeading',
  'ljudi.form.add',
  // The row action's name INTERPOLATES the member it acts on, which is why it
  // is the one key in this file carrying an ICU argument that is not a plural:
  // several hundred rows each announcing the same three words is several
  // hundred controls a screen-reader user cannot tell apart. The name is data,
  // and data is never a key.
  'ljudi.form.edit',
  'ljudi.form.actions',
  'ljudi.form.back',
  'ljudi.form.username',
  // `Spremi` and `Odustani` a SECOND time, in their own namespace rather than
  // borrowed from `organization.*`. The count sweep in
  // `test/localization-applied.test.ts` reads both sides off `hr.json`, so two
  // occurrences move both sides at once; what a borrowed key would cost is the
  // ability to reword one surface's action without rewording the other's.
  'ljudi.form.save',
  'ljudi.form.cancel',
  // The one-showing credential panel. THREE strings, and not one of them is the
  // password: that is data, generated in `admin-auth` and never authored.
  'ljudi.form.created',
  // THE EDIT FORM'S ONLY CONFIRMATION. Its fields are uncontrolled and remount
  // to the values they were just saved with, so without this a successful save
  // is visually identical to a press that did nothing — on the one surface
  // whose whole job is changing a record.
  'ljudi.form.saved',
  'ljudi.form.credential',
  'ljudi.form.credentialOnce',
  // THE ADMIN-ISSUED RESET'S SEVEN, and they are seven rather than two because
  // the reset is a two-step confirmation whose panel has to be closable.
  //
  // The OFFER and the CONFIRM both interpolate the member, which makes them the
  // second and third keys in this file carrying an ICU argument that is not a
  // plural — for the reason `ljudi.form.edit` carries one: a control that
  // replaces somebody's credential may not be indistinguishable from the same
  // control on another person's screen.
  'ljudi.form.reset',
  'ljudi.form.resetPrompt',
  'ljudi.form.resetConfirm',
  // `Odustani` is NOT reused for this one. The form's cancel restores the
  // fields; this one abandons a confirmation, and two controls on one screen
  // reading the same word are two controls a person cannot tell apart.
  'ljudi.form.resetCancel',
  'ljudi.form.resetIssued',
  // ITS OWN LABEL, never `ljudi.form.credential` — "Početna lozinka" is an
  // INITIAL credential, and a reset is precisely the case where there already
  // was one. `ljudi.form.credentialOnce` IS shared, because "write it down,
  // it cannot be shown again" is the same sentence about the same fact.
  'ljudi.form.resetCredential',
  // THE ONLY WAY OUT OF THE SHOWN PANEL, and therefore the only thing that
  // makes a second reset possible at all.
  'ljudi.form.resetDismiss',
  // TWELVE refusals from story 1.5 (story 1.6's three are marked where they
  // sit), and the partition costs nothing it should not. A policy
  // refusal, a bad value, a taken username, a malformed username, an id that
  // reaches nobody, a rename that did not apply, a rename that could not be
  // undone, a PASSWORD that did not change, an account left without a row, the
  // last administrator, and a service failure are eleven different things to do
  // next — and `saved` is the twelfth because it is not a failure at all: it is
  // the half of a partial save that says what DID land, rendered beside
  // whichever of the other eleven says what did not.
  //
  // `resetNotApplied` is its own sentence rather than the service fallback
  // because this surface is the ONLY recovery an account with no email address
  // has: whether the credential moved at all is the fact an admin needs before
  // they read anything out to anybody.
  'ljudi.form.error.refused',
  'ljudi.form.error.invalid',
  'ljudi.form.error.usernameTaken',
  'ljudi.form.error.usernameInvalid',
  'ljudi.form.error.unknown',
  'ljudi.form.error.notApplied',
  'ljudi.form.error.unsettled',
  'ljudi.form.error.resetNotApplied',
  'ljudi.form.error.stranded',
  'ljudi.form.error.lastAdmin',
  // STORY 1.6's SEVEN refusals, each a different thing to do next: choose a
  // date that is not in the past, stop trying on your own row (any change to
  // one's own status, not only a deactivation), choose a date that has no
  // version yet, choose one after the latest change, notice the member already
  // has that status, stop trying to cancel a change that has already happened,
  // and look again at a status that changed underneath the screen. The
  // last-admin refusal is NOT an eighth — a change
  // that would leave no active admin is Q6 reached another way, and it says
  // the sentence `lastAdmin` already says.
  'ljudi.form.error.statusPast',
  'ljudi.form.error.statusSelf',
  'ljudi.form.error.statusTaken',
  'ljudi.form.error.statusOrder',
  'ljudi.form.error.statusUnchanged',
  'ljudi.form.error.statusInEffect',
  'ljudi.form.error.statusStale',
  'ljudi.form.error.unavailable',
  'ljudi.form.error.saved',
  // VISUAL REFRESH B's FOUR: the member list's summary figures, labels only.
  // Each value is counted by `membersSummaryOf` from the one snapshot and
  // rendered through `formatNumber`, so none of these carries a count argument.
  'ljudi.stats.total',
  'ljudi.stats.admins',
  'ljudi.stats.active',
  'ljudi.stats.inactive',
  // MEMBER RANK: the rank control's label, no rank, a code this build lacks,
  // and the eleven fixed rank names, lowercase because they read as a noun
  // phrase beside a name.
  'ljudi.rank.label',
  'ljudi.rank.none',
  'ljudi.rank.unknown',
  'ljudi.rank.trainee',
  'ljudi.rank.firefighter',
  'ljudi.rank.firefighter1',
  'ljudi.rank.nco',
  'ljudi.rank.nco1',
  'ljudi.rank.seniorNco',
  'ljudi.rank.seniorNco1',
  'ljudi.rank.officer',
  'ljudi.rank.officer1',
  'ljudi.rank.seniorOfficer',
  'ljudi.rank.seniorOfficer1',
  // STORY 1.6's STATUS BLOCK, TWENTY-ONE. The list's two markers, which
  // INTERPOLATE the name they sit beside, because an inactive member is marked
  // in words and never by colour alone — one for inactive today, one, in the
  // future tense, for a deactivation already scheduled. On the edit screen:
  // today's status in the present, the scheduled change in the future, the
  // date control's label, the offer, its prompt and its confirmation for each
  // of the three changes — naming the member, for the reason the reset's do,
  // with a present and a future prompt for the two that take a date — the
  // confirmation's cancel, which is NOT `Odustani` for the reason
  // `ljudi.form.resetCancel` is not, and the confirmation that a change landed.
  //
  // VISUAL REFRESH B: the two list markers no longer interpolate the name.
  // They render as a badge BESIDE the name, whose text carries the meaning.
  // The scheduled one reads `Neaktivno od {date}`, with no gendered predicate,
  // because it sits beside names of every gender with no subject of its own.
  // The separator is visually hidden and read before the badge, so a screen
  // reader announces the name and the marker as two things.
  'ljudi.status.inactive',
  'ljudi.status.inactiveScheduled',
  'ljudi.status.separator',
  'ljudi.status.active',
  'ljudi.status.inactiveFrom',
  'ljudi.status.scheduledInactive',
  'ljudi.status.scheduledActive',
  'ljudi.status.date',
  'ljudi.status.deactivate',
  'ljudi.status.reactivate',
  'ljudi.status.withdraw',
  'ljudi.status.deactivatePrompt',
  'ljudi.status.deactivatePromptFuture',
  'ljudi.status.reactivatePrompt',
  'ljudi.status.reactivatePromptFuture',
  'ljudi.status.withdrawPrompt',
  'ljudi.status.deactivateConfirm',
  'ljudi.status.reactivateConfirm',
  'ljudi.status.withdrawConfirm',
  'ljudi.status.cancel',
  'ljudi.status.saved',
  // The navigation chrome, part B — FOUR, and each one is a string that had no
  // surface to live on until this commit.
  //
  // `shell.menu*` names the sidebar's collapse. The control shows a glyph
  // (human decision 2026-09-25), and these words are its `aria-label` and
  // `title`, so the name can still be read and spoken.
  'shell.navigation',
  // TWO names for one control, because a disclosure's name should say which
  // state the press produces. `aria-expanded` carries the state to assistive
  // technology and to nobody else, so a toggle reading the same in both
  // directions is a control whose effect a sighted person has to discover by
  // pressing it.
  'shell.menuShow',
  'shell.menuHide',
  // THE WORD THIS STORY EARNS, and the one the whole file was holding in
  // reserve. It shipped as the imperative `Odjavi se` and became the noun
  // `Odjava` on 2026-09-25 (human decision): the exit sits beside an icon at
  // the foot of the navigation and reads as its last entry.
  'shell.signOut',
  // THE THEME CONTROL (human decision 2026-09-25, reversing UX-DR2). A glyph
  // whose name — `aria-label` and `title` — states the CURRENT preference, one
  // key per value. Since story 7.3 it is one shape, a segmented pill whose
  // group name is this one word, in the profile menu and the *Više* sheet.
  'shell.theme.label',
  'shell.theme.system',
  'shell.theme.light',
  'shell.theme.dark',
  // STORY 7.3: the phone bar's *Više* and the sheet it opens. Its name (the
  // button's word and the sheet's label), the sheet's close, the three group
  // headings (Pregled: destinations every role reaches; Postavke: admin-only;
  // Prikaz: the theme), and the "role · organization" line under the person.
  'shell.more',
  'shell.moreClose',
  'shell.moreGroup.everyone',
  'shell.moreGroup.adminOnly',
  'shell.moreGroup.display',
  'shell.identity',
  // TWO refusals, and the partition is the point in one direction and the
  // collapse in the other. A role that cannot be read, one that reaches no row
  // and one this build does not recognise are three CODES
  // (`apps/web/src/features/navigation/services/role.ts`) and one message, because none of the
  // three leaves the person anything to do but try again — the unrecognised
  // value is logged, where it can be acted on, rather than rendered. The
  // sign-out failure stays its own message because it is a different action:
  // folded together, a refused press would report itself as a navigation
  // problem and leave somebody on a shared device believing they had signed
  // out.
  // The action beside the message rather than inside it. A role read that failed
  // resolves as DATA, so TanStack Query files it as settled and nothing retries
  // it — which made `…Pokušaj ponovno.` an instruction with nothing on screen
  // that could carry it out. The sentence lost those two words when the control
  // gained them.
  'shell.retry',
  'shell.error.destinations',
  'shell.error.signOut',
  // STORY 1.7a: the two team screens. The namespace is `smjene`, never
  // `smjena` — `Smjena` means Team only, and the key names the list. A refused
  // save names its problem: an empty name, a name another team in use carries,
  // and a screen the database no longer matches are three sentences, not one.
  // DESIGN REFRESH C: the member list's lede; the new member screen's lede and
  // aside; the two sections both member forms are split into.
  'ljudi.lede',
  'ljudi.form.newLede',
  'ljudi.form.newAboutTitle',
  'ljudi.form.newAboutBody',
  'ljudi.form.sectionBasics',
  'ljudi.form.sectionSettings',
  // The member edit screen's cards for the status and the password.
  'ljudi.status.heading',
  'ljudi.form.passwordHeading',
  // The member list's marker for a scheduled team change, in the team cell.
  'smjene.membership.markerMove',
  'smjene.membership.markerNone',
  'smjene.membership.markerChange',
  'smjene.heading',
  // DESIGN REFRESH C: the lede, the add dialog (open, heading, close, cancel),
  // the table's actions head, and the archive offer's short word. The link
  // back left the edit screen, which is a dialog over the list now.
  'smjene.lede',
  'smjene.open',
  'smjene.addHeading',
  'smjene.close',
  'smjene.cancel',
  'smjene.actions',
  'smjene.archiveShort',
  'smjene.activeHeading',
  'smjene.name',
  'smjene.add',
  'smjene.created',
  'smjene.edit',
  'smjene.view',
  'smjene.editHeading',
  'smjene.viewHeading',
  'smjene.save',
  'smjene.saved',
  'smjene.archivedDone',
  'smjene.archive',
  'smjene.archivePrompt',
  'smjene.archiveConfirm',
  'smjene.archiveCancel',
  'smjene.archivedNote',
  'smjene.error.unavailable',
  'smjene.error.empty',
  'smjene.error.taken',
  'smjene.error.stale',
  'smjene.error.refused',
  'smjene.error.invalid',
  'smjene.error.saveUnavailable',
  'smjene.error.unknown',
  // STORY 1.7b: an archive of a team somebody is on today, or is scheduled
  // onto, is refused and says so.
  'smjene.error.inUse',
  // STORY 1.7b: team membership on the member list and edit screens. Under
  // `smjene.membership.*` so the one namespace that may say the Team holds
  // them; "no team" is `Bez smjene`, positive words, never `Nema`.
  'smjene.membership.column',
  'smjene.membership.none',
  'smjene.membership.current',
  // TEAM POSITION: the team today and the scheduled change, each with the
  // position it is held in.
  'smjene.membership.currentPosition',
  'smjene.membership.scheduled',
  'smjene.membership.scheduledPosition',
  // and a scheduled change that keeps the team: by position, or neutral while
  // positions are off, never as a move onto the team the member is on.
  'smjene.membership.scheduledPositionOnly',
  'smjene.membership.scheduledChange',
  'smjene.membership.scheduledNone',
  'smjene.membership.team',
  'smjene.membership.date',
  'smjene.membership.move',
  'smjene.membership.movePrompt',
  'smjene.membership.movePromptFuture',
  // TEAM POSITION: a move naming its position, and a position-only change,
  // each today or later.
  'smjene.membership.movePositionPrompt',
  'smjene.membership.movePositionPromptFuture',
  'smjene.membership.positionPrompt',
  'smjene.membership.positionPromptFuture',
  'smjene.membership.removePrompt',
  'smjene.membership.removePromptFuture',
  'smjene.membership.moveConfirm',
  'smjene.membership.withdraw',
  'smjene.membership.withdrawPrompt',
  'smjene.membership.withdrawConfirm',
  'smjene.membership.cancel',
  'smjene.membership.saved',
  'smjene.membership.error.past',
  'smjene.membership.error.taken',
  'smjene.membership.error.order',
  'smjene.membership.error.unchanged',
  // TEAM POSITION: the same team and the same position.
  'smjene.membership.error.positionUnchanged',
  // TEAM POSITION: a team chosen with no position while positions are in use.
  'smjene.membership.error.positionRequired',
  'smjene.membership.error.scheduled',
  'smjene.membership.error.inEffect',
  'smjene.membership.error.archived',
  'smjene.membership.error.stale',
  // STORY 1.8: the roster screen and the Danas line. "No team" on Danas is
  // `smjene.membership.none` again, the words the member list uses.
  'smjene.roster.archived',
  'smjene.roster.back',
  // MEMBER RANK: a roster name with its rank beside it.
  'smjene.roster.withRank',
  // and the roster's own lowercase "unknown rank", beside lowercase labels.
  'smjene.roster.rankUnknown',
  // TEAM POSITION: a roster name with its position, and with both.
  'smjene.roster.withPosition',
  'smjene.roster.withRankAndPosition',
  // TEAM POSITION: the position control's label, the three fixed position
  // nouns, lowercase because they read beside a name, and a code this build
  // lacks.
  'smjene.position.label',
  'smjene.position.commander',
  'smjene.position.driver',
  'smjene.position.firefighter',
  'smjene.position.unknown',
  'smjene.roster.error.unavailable',
  'smjene.today.label',
  'smjene.today.error.unavailable',
  // STORY 2.1b: the hour band editor, under `organization.hourBands` because
  // the bands are an organization setting reached from `Organizacija`. Only a
  // name and a start are entered; the window, duration and midnight flag are
  // shown read-only, and zero bands state their uncovered hours in numbers
  // rather than saying the absence.
  // DESIGN REFRESH C: the organization screen's lede, the aside explaining
  // what its settings do, and the logo's accepted formats under its label.
  'organization.lede',
  'organization.aboutTitle',
  'organization.aboutBody',
  'organization.logoHint',
  'organization.hourBands.heading',
  'organization.hourBands.name',
  'organization.hourBands.start',
  'organization.hourBands.duration.label',
  'organization.hourBands.duration.hours',
  'organization.hourBands.duration.hoursMinutes',
  'organization.hourBands.duration.minutes',
  'organization.hourBands.crossesMidnight',
  'organization.hourBands.uncovered',
  // DESIGN REFRESH C: the page's lede and explainer, the add dialog (its open
  // button, heading, close and cancel), the list and timeline headings, the
  // table's column heads, and the coverage sentence split into two stat tiles.
  // The window label is gone: both dialogs show the start and the computed end
  // side by side, with a hint that the end is never entered.
  'organization.hourBands.end',
  'organization.hourBands.endHint',
  'organization.hourBands.endPending',
  // The removal offer's visible word; its accessible name stays `remove`.
  'organization.hourBands.removeShort',
  'organization.hourBands.lede',
  'organization.hourBands.explainerTitle',
  'organization.hourBands.explainerBody',
  'organization.hourBands.open',
  'organization.hourBands.addHeading',
  'organization.hourBands.close',
  'organization.hourBands.cancel',
  'organization.hourBands.listHeading',
  'organization.hourBands.from',
  'organization.hourBands.to',
  'organization.hourBands.actions',
  'organization.hourBands.timelineHeading',
  'organization.hourBands.covered',
  'organization.hourBands.coveredValue',
  'organization.hourBands.add',
  'organization.hourBands.created',
  'organization.hourBands.edit',
  'organization.hourBands.editHeading',
  'organization.hourBands.save',
  'organization.hourBands.saved',
  'organization.hourBands.remove',
  'organization.hourBands.removePrompt',
  'organization.hourBands.removeConfirm',
  'organization.hourBands.removeCancel',
  'organization.hourBands.removed',
  'organization.hourBands.error.unavailable',
  'organization.hourBands.error.nameEmpty',
  'organization.hourBands.error.nameTaken',
  'organization.hourBands.error.startTaken',
  'organization.hourBands.error.startInvalid',
  'organization.hourBands.error.stale',
  'organization.hourBands.error.refused',
  'organization.hourBands.error.invalid',
  'organization.hourBands.error.saveUnavailable',
  'organization.hourBands.error.unknown',
  // STORY 2.2b: the shift type editor, under `rotation.shiftTypes` because
  // shift types live under Postavke rotacije. The one namespace that may say
  // the Shift Type — `Tip smjene`, never bare `smjena` — see
  // `teamTermOutOfTurn` below.
  'rotation.shiftTypes.heading',
  // DESIGN REFRESH C: the screen's lede, the add dialog (open, heading, close,
  // cancel), the table's column heads, and the archive offer's short word. The
  // link back left the edit screen, which is a dialog now.
  'rotation.shiftTypes.lede',
  'rotation.shiftTypes.open',
  'rotation.shiftTypes.addHeading',
  'rotation.shiftTypes.close',
  'rotation.shiftTypes.cancel',
  'rotation.shiftTypes.columnName',
  'rotation.shiftTypes.actions',
  'rotation.shiftTypes.archiveShort',
  'rotation.shiftTypes.archivedHeading',
  'rotation.shiftTypes.name',
  'rotation.shiftTypes.kind',
  'rotation.shiftTypes.working',
  'rotation.shiftTypes.nonworking',
  'rotation.shiftTypes.start',
  'rotation.shiftTypes.end',
  'rotation.shiftTypes.times',
  'rotation.shiftTypes.duration.label',
  'rotation.shiftTypes.duration.hours',
  'rotation.shiftTypes.duration.hoursMinutes',
  'rotation.shiftTypes.duration.minutes',
  'rotation.shiftTypes.crossesMidnight',
  'rotation.shiftTypes.noTimes',
  'rotation.shiftTypes.scheduled',
  'rotation.shiftTypes.add',
  'rotation.shiftTypes.created',
  'rotation.shiftTypes.edit',
  'rotation.shiftTypes.editHeading',
  'rotation.shiftTypes.viewHeading',
  'rotation.shiftTypes.save',
  'rotation.shiftTypes.renamed',
  'rotation.shiftTypes.timesHeading',
  'rotation.shiftTypes.timesFrom',
  'rotation.shiftTypes.timesNote',
  'rotation.shiftTypes.timesCorrect',
  'rotation.shiftTypes.timesSet',
  'rotation.shiftTypes.timesSaved',
  'rotation.shiftTypes.cancelScheduled',
  'rotation.shiftTypes.timesCancelled',
  'rotation.shiftTypes.archive',
  'rotation.shiftTypes.archivePrompt',
  'rotation.shiftTypes.archiveConfirm',
  'rotation.shiftTypes.archiveCancel',
  'rotation.shiftTypes.archivedDone',
  'rotation.shiftTypes.archivedNote',
  'rotation.shiftTypes.error.unavailable',
  'rotation.shiftTypes.error.nameEmpty',
  'rotation.shiftTypes.error.nameTaken',
  'rotation.shiftTypes.error.timeInvalid',
  'rotation.shiftTypes.error.dateInvalid',
  'rotation.shiftTypes.error.timesRefused',
  'rotation.shiftTypes.error.timesUnchanged',
  'rotation.shiftTypes.error.changeScheduled',
  'rotation.shiftTypes.error.createdWithoutTimes',
  'rotation.shiftTypes.error.stale',
  'rotation.shiftTypes.error.refused',
  'rotation.shiftTypes.error.invalid',
  'rotation.shiftTypes.error.saveUnavailable',
  'rotation.shiftTypes.error.unknown',
  // STORY 2.3b: the rotation builder, under `rotation.builder` — the pattern
  // and its live figures, the shared anchor and each team's step, the cycle
  // preview, the save, and its refusals. There `smjen` names the TEAM, as in
  // `smjene.*`, and the Shift Type may not be said at all (`teamTermOutOfTurn`
  // below): a step's type is shown by its own name, which is data.
  'rotation.builder.patternHeading',
  'rotation.builder.patternLede',
  'rotation.builder.patternEmpty',
  'rotation.builder.stepsCaption',
  'rotation.builder.stepPosition',
  'rotation.builder.archivedStep',
  // AS RENEGOTIATED: the drag handle's name and role description, the
  // keyboard instructions and the four announcements — every word dnd-kit
  // would otherwise say in English.
  'rotation.builder.drag.handle',
  'rotation.builder.drag.roleDescription',
  'rotation.builder.drag.instructions',
  'rotation.builder.drag.lifted',
  'rotation.builder.drag.over',
  'rotation.builder.drag.dropped',
  'rotation.builder.drag.cancelled',
  'rotation.builder.remove',
  'rotation.builder.newStep',
  'rotation.builder.addStep',
  'rotation.builder.cycleLengthLabel',
  'rotation.builder.workingStepsLabel',
  'rotation.builder.nonWorkingStepsLabel',
  'rotation.builder.cycleHoursLabel',
  'rotation.builder.cycleHoursUnknown',
  'rotation.builder.offsetsHeading',
  'rotation.builder.anchor',
  'rotation.builder.anchorNote',
  'rotation.builder.howTitle',
  'rotation.builder.howBody',
  'rotation.builder.columnTeam',
  'rotation.builder.columnOffset',
  'rotation.builder.columnOnAnchor',
  // OWNER ADDITION: spread every team's step evenly over the cycle.
  'rotation.builder.spread',
  'rotation.builder.offsetOf',
  'rotation.builder.stepOption',
  'rotation.builder.offsetsEmpty',
  'rotation.builder.previewHeading',
  'rotation.builder.previewLede',
  'rotation.builder.dayNumber',
  'rotation.builder.cycleLabel',
  'rotation.builder.previewCycles',
  'rotation.builder.save',
  'rotation.builder.saveNote',
  // STORY 5.5c: the save bar's region label, its "Odbaci promjene", and its
  // hint with and without the rotation in force.
  'rotation.builder.saveBar.label',
  'rotation.builder.saveBar.discard',
  'rotation.builder.saveBar.hint',
  'rotation.builder.saveBar.hintInForce',
  'rotation.builder.saved',
  // STORY 2.5: the save's warnings, in the success notice. One date and its
  // types; the rest gap true on the clock (`24 h rada bez slobodnog dana
  // između`), with an unknown duration and an endless pattern each said as
  // such; and the two separators, a list's and a run's. Still the builder's
  // namespace: `smjen` names the team, and a type is shown by its own name.
  'rotation.builder.warnings.date',
  'rotation.builder.warnings.restGap',
  'rotation.builder.warnings.restGapUnknown',
  'rotation.builder.warnings.restGapEndless',
  'rotation.builder.warnings.restGapEndlessUnknown',
  'rotation.builder.warnings.listSeparator',
  'rotation.builder.warnings.typeSeparator',
  // STORY 2.6: a change from a date forward. `Vrijedi od` beside the anchor;
  // the cancel of a scheduled change — its offer beside the refusal, its
  // prompt, keep and confirm, the confirmation and the stale refusal; and
  // `Povijest rotacije` — its heading, lede, empty note, five column heads,
  // the save time, the unknown author and the three statuses, in words.
  'rotation.builder.effectiveFrom',
  'rotation.builder.cancelScheduled.offer',
  'rotation.builder.cancelScheduled.prompt',
  'rotation.builder.cancelScheduled.confirm',
  'rotation.builder.cancelScheduled.keep',
  'rotation.builder.cancelScheduled.done',
  'rotation.builder.cancelScheduled.stale',
  'rotation.builder.history.heading',
  'rotation.builder.history.lede',
  'rotation.builder.history.empty',
  'rotation.builder.history.columnEffective',
  'rotation.builder.history.columnStatus',
  'rotation.builder.history.columnAuthor',
  'rotation.builder.history.columnSaved',
  'rotation.builder.history.columnTeams',
  'rotation.builder.history.savedAt',
  'rotation.builder.history.unknownAuthor',
  'rotation.builder.history.status.scheduled',
  'rotation.builder.history.status.inForce',
  'rotation.builder.history.status.previous',
  // STORY 2.4: the phone stepper, under `rotation.builder.stepper` — the bar's
  // label, the progress line, the four step names, a reached step's
  // "završeno", Natrag, and Dalje naming the step it leads to. Still the
  // builder's namespace, so the team-term rule holds: `Tipovi` alone, never
  // the Shift Type.
  'rotation.builder.stepper.label',
  'rotation.builder.stepper.progress',
  'rotation.builder.stepper.step.types',
  'rotation.builder.stepper.step.pattern',
  'rotation.builder.stepper.step.offsets',
  'rotation.builder.stepper.step.preview',
  'rotation.builder.stepper.done',
  'rotation.builder.stepper.back',
  'rotation.builder.stepper.next.pattern',
  'rotation.builder.stepper.next.offsets',
  'rotation.builder.stepper.next.preview',
  'rotation.builder.error.unavailable',
  'rotation.builder.error.empty',
  'rotation.builder.error.noTeams',
  'rotation.builder.error.scheduled',
  // STORY 2.6: an effective date before today.
  'rotation.builder.error.effectivePast',
  'rotation.builder.error.typeArchived',
  'rotation.builder.error.unchanged',
  'rotation.builder.error.changedToday',
  'rotation.builder.error.refused',
  'rotation.builder.error.saveUnavailable',
  'rotation.builder.error.nothingChanged',
  // STORY 3.1: the calendar — the month heading, the previous and next
  // months, `Ovaj mjesec`, the date column head, the no-rotation label for
  // screen readers, the no-teams note and the one read failure. Its columns
  // are teams, so `smjena` here is the Team.
  'kalendar.monthHeading',
  'kalendar.previous',
  'kalendar.next',
  'kalendar.current',
  // STORY 7.4: the month toolbar — the group's name, the trigger's name, the
  // picker's name, "ovaj mjesec" in the trigger and "ovaj" under the current
  // month in the picker, and the picker's year ‹ and ›.
  'kalendar.month',
  'kalendar.chooseMonth',
  'kalendar.monthPicker',
  'kalendar.thisMonthLabel',
  'kalendar.thisMonthShort',
  'kalendar.previousYear',
  'kalendar.nextYear',
  'kalendar.columnDate',
  'kalendar.noRotation',
  'kalendar.noTeams',
  'kalendar.error.unavailable',
  // STORY 3.2a: the mode switch — its label, *Moj raspored* and *Sve smjene*
  // — the notice for a viewer on no team all month, and a day on no team.
  // `smjen` is the Team here too: `Sve smjene` is every team.
  'kalendar.mode.label',
  'kalendar.mode.moj',
  'kalendar.mode.sve',
  'kalendar.noTeam',
  'kalendar.day.noTeam',
  // STORY 3.2b: the modifier vocabulary — the legend's heading and the four
  // marks' labels, read in the legend and in every cell's label.
  'kalendar.legend',
  'kalendar.modifier.conflict',
  'kalendar.modifier.overridden',
  'kalendar.modifier.leave',
  'kalendar.modifier.uncovered',
  // STORY 5.3c: the unavailable alert's retry, which reads the schedule and
  // the leave the marks stand on again.
  'kalendar.retry',
  // STORY 3.3b: the note for a person on no team all month. The filter
  // itself moved to the shared `filter.*` namespace in story 7.5.
  'kalendar.person.noTeam',
  // STORY 7.5: the filter bar Kalendar and Sati share, which replaced the
  // calendar's one Select (3.3a/3.3b) and Sati's two (4.2): the bar's name,
  // `Filtri` with and without its count, a chip in each of its four states,
  // a ✕'s two names, the pickers' names and options, the search, its match
  // count, `Bez smjene`, the summary for one person (with and without a
  // team), `Poništi filtre`, the phone sheet's title, close, headings, note,
  // `Poništi`, and the empty table's sentences (the generic one for a filter
  // alone included), its way out and the twelve months in the locative. `Smjena` is the Team throughout.
  'filter.label',
  'filter.open',
  'filter.openCount',
  'filter.chip.team',
  'filter.chip.teamAll',
  'filter.chip.person',
  'filter.chip.personAll',
  'filter.remove.team',
  'filter.remove.person',
  'filter.teamPicker',
  'filter.personPicker',
  'filter.allTeams',
  'filter.allPeople',
  'filter.teamGroup',
  'filter.noTeam',
  'filter.search',
  'filter.matches',
  'filter.summary.person',
  'filter.summary.personNoTeam',
  'filter.clear',
  'filter.sheetTitle',
  'filter.sheetClose',
  'filter.team',
  'filter.person',
  'filter.replaceNote',
  'filter.sheetReset',
  'filter.empty.filtered',
  'filter.empty.notInTeam',
  'filter.empty.inTeam',
  'filter.empty.noTeam',
  'filter.empty.removeTeam',
  'filter.monthIn.1',
  'filter.monthIn.2',
  'filter.monthIn.3',
  'filter.monthIn.4',
  'filter.monthIn.5',
  'filter.monthIn.6',
  'filter.monthIn.7',
  'filter.monthIn.8',
  'filter.monthIn.9',
  'filter.monthIn.10',
  'filter.monthIn.11',
  'filter.monthIn.12',
  // STORY 7.6: the phone's sort control Sati and Ljudi share — its visible
  // `Poredano: {column}`, its accessible name with the direction, the two
  // directions, the sorted option, and the name of the list it opens. `{column}` is
  // a heading's own key or a band's name as stored. `sort.option` names the
  // sorted column in the list with its direction, its arrow being hidden.
  'sort.label',
  'sort.name',
  'sort.option',
  'sort.ascending',
  'sort.descending',
  'sort.picker',
  // STORY 3.4b: the day detail — its title (the team and the date), its close, the heading over the roster, a
  // working day with nobody on it, an off day and a day with no rotation.
  // `{team}` is the Team.
  'kalendar.detail.title',
  'kalendar.detail.close',
  'kalendar.detail.roster',
  'kalendar.detail.empty',
  'kalendar.detail.off',
  'kalendar.detail.noRotation',
  // STORY 3.5a: the day detail's override block — its heading, the type the
  // rotation projects, the author (or an unknown one), when it was saved and
  // its reason. `Izmjena` names the change, never a shift type.
  'kalendar.detail.override.heading',
  'kalendar.detail.override.projected',
  'kalendar.detail.override.author',
  'kalendar.detail.override.unknownAuthor',
  'kalendar.detail.override.savedAt',
  'kalendar.detail.override.reason',
  // STORY 3.5b: the admin's override form in the day detail — its heading,
  // the type and reason fields, save and saving; the removal's action, its
  // neutral confirmation (naming the team, the date and the projected type
  // restored), confirm, cancel and removing; and the six refusals.
  'kalendar.detail.override.set.heading',
  'kalendar.detail.override.set.type',
  'kalendar.detail.override.set.reason',
  'kalendar.detail.override.set.save',
  'kalendar.detail.override.set.saving',
  'kalendar.detail.override.remove.action',
  'kalendar.detail.override.remove.prompt',
  'kalendar.detail.override.remove.confirm',
  'kalendar.detail.override.remove.cancel',
  'kalendar.detail.override.remove.removing',
  'kalendar.detail.override.refused.reason',
  'kalendar.detail.override.refused.sameAsProjected',
  'kalendar.detail.override.refused.taken',
  'kalendar.detail.override.refused.gone',
  'kalendar.detail.override.refused.denied',
  'kalendar.detail.override.refused.failed',
  // STORY 3.5b, after review: what a landed write says, in a `role="status"`
  // Notice — the save, and the removal with the type the rotation restores.
  'kalendar.detail.override.saved',
  'kalendar.detail.override.removed',
  // STORY 3.5c: an override a rotation change left pending, in the day detail
  // — the block's heading, body and the type it names, and the removal's
  // prompt and confirmation where no rotation governs the day; and in the
  // rotation builder, `Izmjene za pregled` — its heading and lede, a row's
  // title, type, projected type or no rotation, reason, author and unknown
  // author, the three actions, the amend's dialog, the discard's neutral
  // confirmation, what a landed disposition says and the five refusals.
  'kalendar.detail.override.pending.heading',
  'kalendar.detail.override.pending.body',
  'kalendar.detail.override.pending.type',
  'kalendar.detail.override.pending.removePrompt',
  'kalendar.detail.override.pending.removed',
  'rotation.builder.overrides.heading',
  'rotation.builder.overrides.lede',
  'rotation.builder.overrides.title',
  'rotation.builder.overrides.type',
  'rotation.builder.overrides.projected',
  'rotation.builder.overrides.noRotation',
  'rotation.builder.overrides.reason',
  'rotation.builder.overrides.author',
  'rotation.builder.overrides.unknownAuthor',
  'rotation.builder.overrides.unavailable',
  'rotation.builder.overrides.confirm',
  'rotation.builder.overrides.amend',
  'rotation.builder.overrides.discard',
  'rotation.builder.overrides.amendDialog.title',
  'rotation.builder.overrides.amendDialog.type',
  'rotation.builder.overrides.amendDialog.reason',
  'rotation.builder.overrides.amendDialog.save',
  'rotation.builder.overrides.amendDialog.saving',
  'rotation.builder.overrides.amendDialog.cancel',
  'rotation.builder.overrides.amendDialog.close',
  'rotation.builder.overrides.discardDialog.prompt',
  'rotation.builder.overrides.discardDialog.promptNoRotation',
  'rotation.builder.overrides.discardDialog.confirm',
  'rotation.builder.overrides.discardDialog.cancel',
  'rotation.builder.overrides.discardDialog.discarding',
  'rotation.builder.overrides.done.confirmed',
  'rotation.builder.overrides.done.amended',
  'rotation.builder.overrides.done.discarded',
  'rotation.builder.overrides.refused.denied',
  'rotation.builder.overrides.refused.gone',
  'rotation.builder.overrides.refused.archived',
  'rotation.builder.overrides.refused.reason',
  'rotation.builder.overrides.refused.sameAsProjected',
  'rotation.builder.overrides.refused.failed',
  // STORY 5.5a: the rotation save's erasure confirmation — a row's title and
  // its two second lines (the team free that day, or working without the
  // member), the toggles' group label, "Potvrdi brisanje" and "Zadrži", the
  // way back and the kept hint — and the refusal when what the save would
  // erase cannot be checked, with its retry. The title and the lede are
  // plurals, above.
  'rotation.builder.erasures.rowTitle',
  'rotation.builder.erasures.rowFree',
  'rotation.builder.erasures.rowWithout',
  'rotation.builder.erasures.decision',
  'rotation.builder.erasures.confirm',
  'rotation.builder.erasures.keep',
  'rotation.builder.erasures.back',
  'rotation.builder.erasures.kept',
  // The polite line when the list changed since it was decided (review).
  'rotation.builder.erasures.changed',
  'rotation.builder.erasures.unavailable',
  'rotation.builder.erasures.retry',
  // STORY 5.5g: the cancel's own erasure dialog — the same parts in its own
  // words ("nakon poništavanja: …", "odustani od poništavanja", "Natrag") —
  // and its refusal and retry, inside the cancel's confirmation. The title,
  // the lede and the removed count are plurals, above. ITS OWN BLOCK, not the
  // save's `rotation.builder.erasures.*`: a cancel is no new rotation and
  // leaves no draft to edit, so the save's row line, kept hint and way back
  // would say what is not true here.
  'rotation.builder.cancelScheduled.erasures.rowTitle',
  'rotation.builder.cancelScheduled.erasures.rowFree',
  'rotation.builder.cancelScheduled.erasures.rowWithout',
  'rotation.builder.cancelScheduled.erasures.decision',
  'rotation.builder.cancelScheduled.erasures.confirm',
  'rotation.builder.cancelScheduled.erasures.keep',
  'rotation.builder.cancelScheduled.erasures.back',
  'rotation.builder.cancelScheduled.erasures.kept',
  'rotation.builder.cancelScheduled.erasures.changed',
  'rotation.builder.cancelScheduled.erasures.unavailable',
  'rotation.builder.cancelScheduled.erasures.retry',
  // STORY 3.6a: the day detail's roster changes — the block's heading, an
  // addition, a removal and a replacement (`{out} → {in}`), and the heading
  // of those a rotation change left pending. The author, time, reason and an
  // unknown member reuse 3.5a's `kalendar.detail.override.*`.
  'kalendar.detail.rosterChange.heading',
  'kalendar.detail.rosterChange.added',
  'kalendar.detail.rosterChange.removed',
  'kalendar.detail.rosterChange.replaced',
  'kalendar.detail.rosterChange.pendingHeading',
  // STORY 3.6b: the admin's roster form — its heading, "Skida se" and
  // "Dolazi", the "— nitko —" option, the reason, save and saving, and a
  // member on no team — the removal's action, prompt, confirm, cancel and
  // removing, the two landed notices, the heading of the inert changes, and
  // the six refusals.
  'kalendar.detail.rosterChange.inertHeading',
  'kalendar.detail.rosterChange.set.heading',
  'kalendar.detail.rosterChange.set.out',
  'kalendar.detail.rosterChange.set.in',
  'kalendar.detail.rosterChange.set.none',
  'kalendar.detail.rosterChange.set.reason',
  'kalendar.detail.rosterChange.set.save',
  'kalendar.detail.rosterChange.set.saving',
  'kalendar.detail.rosterChange.set.noTeam',
  'kalendar.detail.rosterChange.remove.action',
  'kalendar.detail.rosterChange.remove.prompt',
  'kalendar.detail.rosterChange.remove.confirm',
  'kalendar.detail.rosterChange.remove.cancel',
  'kalendar.detail.rosterChange.remove.removing',
  'kalendar.detail.rosterChange.saved',
  'kalendar.detail.rosterChange.removedDone',
  'kalendar.detail.rosterChange.refused.member',
  'kalendar.detail.rosterChange.refused.reason',
  'kalendar.detail.rosterChange.refused.taken',
  'kalendar.detail.rosterChange.refused.gone',
  'kalendar.detail.rosterChange.refused.denied',
  'kalendar.detail.rosterChange.refused.failed',
  // EPIC 4 RETRO C2: the roster form's neutral hint for a member who already
  // works an overlapping shift.
  'kalendar.detail.rosterChange.set.overlap',
  // STORY 5.5b: a roster change's erasure confirmation — a row's title and
  // its second line ("nakon promjene: {team} taj dan bez {member}"; no "taj
  // dan slobodna" as the rotation has: a roster change never changes whether
  // the team works that day), the toggles' group label, "Potvrdi brisanje"
  // and "Zadrži", the way back, the kept hint (a save's, and a removal's own)
  // and the changed line — and the refusal when what the change would erase
  // cannot be checked, with its retry. The title, the ledes and the removed
  // count are plurals, above.
  'kalendar.detail.rosterChange.erasures.rowTitle',
  'kalendar.detail.rosterChange.erasures.rowWithout',
  'kalendar.detail.rosterChange.erasures.decision',
  'kalendar.detail.rosterChange.erasures.confirm',
  'kalendar.detail.rosterChange.erasures.keep',
  'kalendar.detail.rosterChange.erasures.back',
  'kalendar.detail.rosterChange.erasures.kept',
  'kalendar.detail.rosterChange.erasures.keptRemoval',
  'kalendar.detail.rosterChange.erasures.changed',
  'kalendar.detail.rosterChange.erasures.unavailable',
  'kalendar.detail.rosterChange.erasures.retry',
  // STORY 5.5f: a shift-type override's erasure confirmation — a row's title
  // and its second line ("nakon promjene: {team} taj dan slobodna"; never
  // "taj dan bez": an override never changes who is rostered), the toggles'
  // group label, "Potvrdi brisanje" and "Zadrži", the way back, the kept
  // hint (a set's, and a removal's own) and the changed line — and the
  // refusal when what the write would erase cannot be checked, with its
  // retry. The title, the ledes and the removed count are plurals, above.
  'kalendar.detail.override.erasures.rowTitle',
  'kalendar.detail.override.erasures.rowFree',
  'kalendar.detail.override.erasures.decision',
  'kalendar.detail.override.erasures.confirm',
  'kalendar.detail.override.erasures.keep',
  'kalendar.detail.override.erasures.back',
  'kalendar.detail.override.erasures.kept',
  'kalendar.detail.override.erasures.keptRemoval',
  'kalendar.detail.override.erasures.changed',
  'kalendar.detail.override.erasures.unavailable',
  'kalendar.detail.override.erasures.retry',
  // STORY 5.5h: the builder's override review's erasure dialog — a row's
  // title and its second line ("nakon promjene: {team} taj dan slobodna"; a
  // shift-type override never changes who is rostered), the toggles' group
  // label, "Potvrdi brisanje" and "Zadrži", the way back, the kept hint and
  // the changed line — and the refusal when what a confirm or an amend would
  // erase cannot be checked, with its retry. The title, the lede and the
  // removed count are plurals, above.
  'rotation.builder.overrides.erasures.rowTitle',
  'rotation.builder.overrides.erasures.rowFree',
  'rotation.builder.overrides.erasures.decision',
  'rotation.builder.overrides.erasures.confirm',
  'rotation.builder.overrides.erasures.keep',
  'rotation.builder.overrides.erasures.back',
  'rotation.builder.overrides.erasures.kept',
  'rotation.builder.overrides.erasures.changed',
  'rotation.builder.overrides.erasures.unavailable',
  'rotation.builder.overrides.erasures.retry',
  // The dialog's own save after a confirm, "Potvrdi izmjenu", apart from "Potvrdi brisanje".
  'rotation.builder.overrides.erasures.saveConfirm',
  // STORY 5.5e: the member page's erasure dialogs, shared by the team and
  // status cards — a row's title and its second line ("nakon promjene:
  // {team} taj dan bez {member}", the team the conflict was on), the
  // toggles' group label, "Potvrdi brisanje" and "Zadrži", the way back, the
  // kept hint and the changed line — and the refusal when what the change
  // would erase cannot be checked, with its retry. The title, the lede and
  // the removed count are plurals, above.
  'ljudi.erasures.rowTitle',
  'ljudi.erasures.rowWithout',
  'ljudi.erasures.decision',
  'ljudi.erasures.confirm',
  'ljudi.erasures.keep',
  'ljudi.erasures.back',
  'ljudi.erasures.kept',
  'ljudi.erasures.changed',
  'ljudi.erasures.unavailable',
  'ljudi.erasures.retry',
  // STORY 4.1b: *Sati* — the total's and the shift count's labels, the bands'
  // heading, the leave row and the one failure. The hours themselves are the
  // band screens' `organization.hourBands.duration.*` units.
  'sati.total',
  'sati.shifts',
  'sati.bands',
  'sati.leave',
  // The mark of an empty figure: a member's leave of 0 reads as an absence,
  // never as `0 h` (Epic 4 retro, R2).
  'sati.noFigure',
  'sati.error.unavailable',
  // STORY 4.2: an admin's organization table on *Sati* — its caption, its
  // column headings, the mark of a member on no team, and the line a month
  // with nobody shows. Band headings are the bands' names as stored, never
  // keys. Its filters and its filtered-empty sentences moved to the shared
  // `filter.*` namespace in story 7.5.
  'sati.organization.caption',
  'sati.organization.member',
  'sati.organization.team',
  'sati.organization.shifts',
  'sati.organization.total',
  'sati.organization.leave',
  'sati.organization.noTeam',
  'sati.organization.emptyMonth',
  // STORY 4.3: the organization table's one export — its action, the label
  // it wears while the file is built, the line a failed build shows, and the
  // sheet's and the file's names. The column headings are 4.2's keys above;
  // the file's band headings are the bands' names as stored.
  'sati.organization.export.action',
  'sati.organization.export.pending',
  'sati.organization.export.failed',
  'sati.organization.export.sheetName',
  'sati.organization.export.fileName',
  // STORY 5.3d: the organization table's and the file's column of shifts in
  // unresolved conflict, and the retry the unavailable message offers when a
  // read failed — the snapshot's or the leave's *Sati* now waits for.
  'sati.organization.conflicts',
  'sati.retry',
  // STORY 5.1c: the member page's leave card — its heading, the used and
  // balance figures' labels (the allowance's is `ljudi.leave`), the form's
  // legend, its two date labels and its action, the preview's two labels, the
  // three reasons no preview is shown, the overlap line (a preview note, and
  // the refusal when the conflict could not be read), the refusal naming the
  // conflicting record's dates, the denied and failed refusals, the line a
  // failed read shows in place of the figures with its retry, the line for a
  // member with no schedule to cost against, the reason a range the domain
  // will not cost is not sent, and the saved line when the re-read after a
  // save did not answer.
  'ljudi.leaveRecord.heading',
  'ljudi.leaveRecord.used',
  'ljudi.leaveRecord.balance',
  'ljudi.leaveRecord.newHeading',
  'ljudi.leaveRecord.from',
  'ljudi.leaveRecord.to',
  'ljudi.leaveRecord.cost',
  'ljudi.leaveRecord.balanceAfter',
  'ljudi.leaveRecord.incomplete',
  'ljudi.leaveRecord.reversed',
  'ljudi.leaveRecord.tooLong',
  'ljudi.leaveRecord.refused',
  'ljudi.leaveRecord.savedPlain',
  'ljudi.leaveRecord.unscheduled',
  'ljudi.leaveRecord.retry',
  'ljudi.leaveRecord.overlap',
  'ljudi.leaveRecord.overlapConflict',
  'ljudi.leaveRecord.save',
  'ljudi.leaveRecord.denied',
  'ljudi.leaveRecord.failed',
  'ljudi.leaveRecord.unavailable',
  // STORY 5.2b: the card's list of live records — its heading and the line
  // for none — each row's two actions, short and named in full; the form's
  // amend mode — its legend naming the record, its save and cancel, and the
  // reason an unchanged range is not sent — the plain amended line and the
  // amend's denied and failed refusals; the removal's confirmation — its
  // prompt naming the range and its cost, confirm, cancel and the label it
  // wears in flight — the removed line, the removal's denied and failed
  // refusals, and the line for a record already gone.
  'ljudi.leaveRecord.recordsHeading',
  'ljudi.leaveRecord.recordsEmpty',
  'ljudi.leaveRecord.amend',
  'ljudi.leaveRecord.amendName',
  'ljudi.leaveRecord.amendHeading',
  'ljudi.leaveRecord.amendSave',
  'ljudi.leaveRecord.amendCancel',
  'ljudi.leaveRecord.unchanged',
  'ljudi.leaveRecord.amendedPlain',
  'ljudi.leaveRecord.amendDenied',
  'ljudi.leaveRecord.amendFailed',
  'ljudi.leaveRecord.remove',
  'ljudi.leaveRecord.removeName',
  'ljudi.leaveRecord.removePrompt',
  'ljudi.leaveRecord.removeConfirm',
  'ljudi.leaveRecord.removeCancel',
  'ljudi.leaveRecord.removing',
  'ljudi.leaveRecord.removed',
  'ljudi.leaveRecord.removeDenied',
  'ljudi.leaveRecord.removeFailed',
  'ljudi.leaveRecord.gone',
  // THE 5.2b REVIEW: the removal prompt's form for a record not wholly in the
  // current leave year, naming the in-year part too, and the row's marker
  // while it is in amend mode.
  'ljudi.leaveRecord.removePromptInYear',
  'ljudi.leaveRecord.amending',
  // STORY 5.4e: the replacement guard — the line naming a replacement an
  // amend or a removal would leave rostered, and the line in its place when
  // the resolutions cannot be read.
  'ljudi.leaveRecord.replacementStays',
  'ljudi.leaveRecord.replacementsUnknown',
  // STORY 5.2c: *Godišnji*, the viewer's own leave — the three tiles' labels
  // (the figures themselves render through `count.days`), the line a failed
  // read shows in place of the figures with its retry, and the viewer's own
  // line, worded to them, when they have never been on a team.
  'godisnji.allowance',
  'godisnji.used',
  'godisnji.balance',
  'godisnji.unavailable',
  'godisnji.unscheduled',
  'godisnji.retry',
  // STORY 5.3b: *Raspored*, the conflicts queue — the true sentence an empty
  // queue states, the words a past row carries beside its dashed border, a
  // row's member and team, its shift type (with its times, or a type with
  // none in effect) and the causing record's range, and the line a refused
  // queue shows with its retry. The count is a plural, listed above.
  'raspored.empty',
  'raspored.past',
  'raspored.who',
  'raspored.detail',
  'raspored.detailTimed',
  'raspored.unavailable',
  'raspored.retry',
  // STORY 5.4b: the resolution screen — the queue's status line once a
  // decision lands; the screen's heading, its place in the queue and ‹ ›
  // (named by the target's date, or plainly at an end); the facts (the
  // conflict's mark, the shift with or without times, who else works that
  // day, or nobody); the radio group's heading and hint, the one card's title
  // and sentence; the strip's three labels, the uncovered mark, the hours as
  // leave (or the empty mark when untimed) and the unchanged balance; the
  // save hint before and after a choice, Odustani, Spremi odluku and its
  // pending label; the line a conflict no longer open shows with its way
  // back, the unavailable line with its retry, and the three refusals.
  'raspored.saved',
  'raspored.resolution.heading',
  'raspored.resolution.position',
  'raspored.resolution.previous',
  'raspored.resolution.previousNone',
  'raspored.resolution.next',
  'raspored.resolution.nextNone',
  'raspored.resolution.mark',
  'raspored.resolution.shiftTimed',
  'raspored.resolution.shift',
  'raspored.resolution.coworkers',
  'raspored.resolution.noCoworkers',
  'raspored.resolution.choice',
  'raspored.resolution.choiceHint',
  'raspored.resolution.acceptTitle',
  'raspored.resolution.acceptBody',
  'raspored.resolution.coverageLabel',
  'raspored.resolution.uncovered',
  'raspored.resolution.hoursLabel',
  'raspored.resolution.hoursAsLeave',
  'raspored.resolution.noHours',
  'raspored.resolution.balanceLabel',
  'raspored.resolution.balanceUnchanged',
  'raspored.resolution.hintChoose',
  'raspored.resolution.hintRecorded',
  'raspored.resolution.cancel',
  'raspored.resolution.save',
  'raspored.resolution.saving',
  'raspored.resolution.missing',
  'raspored.resolution.backToQueue',
  'raspored.resolution.unavailable',
  'raspored.resolution.retry',
  'raspored.resolution.error.gone',
  'raspored.resolution.error.denied',
  'raspored.resolution.error.failed',
  // STORY 5.4c: the second card — its title and sentence, the replacement's
  // name in its strip — the picker's heading, its three group headings and
  // its nobody-to-add line, the hint while nobody is picked or nobody can be, the reason the
  // override is written with, the refusal naming a replacement already on the
  // shift, and the queue's status line naming the replacement.
  'raspored.savedReplace',
  'raspored.resolution.replaceTitle',
  'raspored.resolution.replaceBody',
  'raspored.resolution.replaceReason',
  'raspored.resolution.candidatesHeading',
  'raspored.resolution.candidates.free',
  'raspored.resolution.candidates.working',
  'raspored.resolution.candidates.onLeave',
  'raspored.resolution.noCandidates',
  'raspored.resolution.replacementShown',
  'raspored.resolution.hintChooseReplacement',
  'raspored.resolution.hintNoCandidates',
  'raspored.resolution.error.taken',
  // STORY 5.4d: the third card — its title, its three sentences (the leave
  // starts later, ends earlier, or is removed), the absent member working in
  // its strip and their hours as work — the hint once it is chosen, with a
  // date or for a removal, and the member page's way back to the conflicts.
  'raspored.resolution.amendTitle',
  'raspored.resolution.amendBodyStarts',
  'raspored.resolution.amendBodyEnds',
  'raspored.resolution.amendBodyRemoves',
  'raspored.resolution.amendWorks',
  'raspored.resolution.hoursAsWork',
  'raspored.resolution.hintAmend',
  'raspored.resolution.hintAmendRemove',
  'ljudi.form.backToConflicts',
  // STORY 5.5d: a conflict back because its replacement no longer applies —
  // the line that says to remove it in the calendar and decide again, which a
  // refusal on the held key repeats.
  'raspored.resolution.held',
  // The same as Spremi's hint, "Ukloni je u kalendaru" a link to the day's month.
  'raspored.resolution.heldHint',
  'raspored.resolution.heldAction',
  // STORY 6.1a: *Danas* for the viewer — the heading's date subline; today's
  // three cases and the leave's range; the next shift's plain title, its
  // heading with the days (`count.days`, a plural listed above), the return
  // from leave, and the sentence when none falls within the horizon; the
  // week's heading and its link to the calendar; the line for a viewer with
  // no membership, and the unavailable line with its retry.
  'danas.dateLine',
  'danas.today.working',
  'danas.today.free',
  'danas.today.leave',
  'danas.today.leaveRange',
  'danas.next.title',
  'danas.next.heading',
  'danas.next.returnHeading',
  'danas.next.none',
  'danas.week.heading',
  'danas.week.link',
  'danas.unscheduled',
  'danas.unavailable',
  'danas.retry',
  // STORY 6.1b: what today's leave costs (`count.days`, a plural listed
  // above); the hours tile's kicker, one band's hours and the separator
  // between bands; the leave tile's kicker and its hint. The tiles'
  // unavailable sentences are *Sati*'s and *Godišnji*'s own.
  'danas.today.leaveCost',
  'danas.tiles.hoursKicker',
  'danas.tiles.band',
  'danas.tiles.separator',
  'danas.tiles.leaveKicker',
  'danas.tiles.leaveHint',
  // STORY 6.2: the duty-block — its kicker with the total, the headline
  // until the end or when it ended, the line with what remains or when it
  // starts, the progress, one end of the span, each leg's state in words,
  // and whose shift a leg is (own, a replacement naming the member, added).
  'danas.duty.kicker',
  'danas.duty.until',
  'danas.duty.ended',
  'danas.duty.remaining',
  'danas.duty.startsAt',
  'danas.duty.progress',
  'danas.duty.moment',
  'danas.duty.legDone',
  'danas.duty.legRunning',
  'danas.duty.legUpcoming',
  'danas.duty.noteOwn',
  'danas.duty.noteReplacing',
  'danas.duty.noteAdded',
  // SINCE STORY 6.3: an admin's Danas — the subtitle with its separators and each
  // status (working with or without times, on a duty, on leave, free, on no
  // team); *Treba tebe*'s heading, calm line, a row's date and shift, the two
  // badges and "Otvori konflikte (n)"; the coverage's heading, shift, three
  // phases, three absent states, full shift, none, off line and link; the
  // absences' heading, line and tomorrow's (each with or without a team),
  // none and link; the week's heading, region, team column, four cell names,
  // legend with its two entries and link; and the admin unavailable line.
  // From review: a working team with nobody rostered, the teams with no
  // rotation today, and a one-day absence's line and tomorrow's, each with or
  // without a team.
  // The past share and a coverage row's members are plurals, listed above.
  'danas.admin.subtitle',
  'danas.admin.separator',
  'danas.admin.listSeparator',
  'danas.admin.status.working',
  'danas.admin.status.workingUntimed',
  'danas.admin.status.duty',
  'danas.admin.status.leave',
  'danas.admin.status.free',
  'danas.admin.status.unscheduled',
  'danas.admin.needsYou.heading',
  'danas.admin.needsYou.calm',
  'danas.admin.needsYou.date',
  'danas.admin.needsYou.shiftTimed',
  'danas.admin.needsYou.shift',
  'danas.admin.needsYou.past',
  'danas.admin.needsYou.today',
  'danas.admin.needsYou.open',
  'danas.admin.coverage.heading',
  'danas.admin.coverage.shiftTimed',
  'danas.admin.coverage.shift',
  'danas.admin.coverage.starts',
  'danas.admin.coverage.running',
  'danas.admin.coverage.ended',
  'danas.admin.coverage.absentUnresolved',
  'danas.admin.coverage.absentAccepted',
  'danas.admin.coverage.absentResolved',
  'danas.admin.coverage.full',
  'danas.admin.coverage.nobody',
  'danas.admin.coverage.noRotation',
  'danas.admin.coverage.none',
  'danas.admin.coverage.off',
  'danas.admin.coverage.link',
  'danas.admin.absent.heading',
  'danas.admin.absent.line',
  'danas.admin.absent.lineNoTeam',
  'danas.admin.absent.lineDay',
  'danas.admin.absent.lineDayNoTeam',
  'danas.admin.absent.tomorrow',
  'danas.admin.absent.tomorrowNoTeam',
  'danas.admin.absent.tomorrowDay',
  'danas.admin.absent.tomorrowDayNoTeam',
  'danas.admin.absent.none',
  'danas.admin.absent.link',
  'danas.admin.week.heading',
  'danas.admin.week.region',
  'danas.admin.week.team',
  'danas.admin.week.cellTimed',
  'danas.admin.week.cell',
  'danas.admin.week.cellTimedConflict',
  'danas.admin.week.cellConflict',
  'danas.admin.week.legend',
  'danas.admin.week.legendType',
  'danas.admin.week.legendConflict',
  'danas.admin.week.link',
  'danas.admin.unavailable',
];

/** Everything the resource file is permitted to hold, together. */
const SANCTIONED_KEYS = [...SANCTIONED_PLURAL_KEYS, ...SANCTIONED_SCREEN_KEYS];

/**
 * Vocabulary the application has not earned the right to say, as STEMS.
 *
 * EMPTY TODAY, AND THE MECHANISM STAYS. The list started at seven — `danas,
 * kalendar, godišnji, raspored, ljudi, postavke` plus `odjav` — and every story
 * that authored one of them moved it out into a COUNT in
 * `test/localization-applied.test.ts`, which is the stronger of the two claims:
 * absence says nothing may say the word, a count says `hr.json` is the only
 * thing that may. The navigation chrome authors the last one, so the ledger is
 * empty.
 *
 * Deleting it with the ledger was the obvious move and the wrong one. This is
 * the ONLY sweep in this file that reads message VALUES for unearned vocabulary
 * — the key-set comparison reads keys, and an equality check on three known keys
 * reads three known keys — so removing it left nothing at all scanning what the
 * strings SAY. The next story to reserve a word would have had to rebuild the
 * mechanism before it could use it, which is how a rule quietly stops being one.
 *
 * WHAT MOVED IS THE NON-VACUITY GUARD, off the LIST and onto the DETECTOR. The
 * old `expect(RESERVED_STEMS.length).toBeGreaterThan(0)` made emptying the array
 * fail loudly, which was right while emptying it was a thing a story did by
 * accident and is wrong now that it is the true state of the world. The
 * self-test below proves the predicate still finds a stem when handed one, on
 * both polarities, against a list passed in — so the sweep is demonstrably
 * capable of failing whether or not it currently has anything to fail on.
 *
 * A stem rather than a word because Croatian inflects: `Odjava` is the noun and
 * `Odjavi se` is what a button says, and only one of the two contains the other.
 * Matching the stem catches both, and every form a later story might reach for.
 */
const RESERVED_STEMS: readonly string[] = [];

/** The one namespace whose messages may say `smjen` as the Team (story 1.7a). */
const TEAM_NAMESPACE = 'smjene.';

/**
 * The ONLY namespace whose messages may say the SHIFT TYPE (story 2.2b) — and
 * there `smjen` is admitted only inside the term itself, `tip… smjen…`
 * (`Tip smjene`, `tipova smjena`), never on its own, which would be the Team.
 */
const SHIFT_TYPE_NAMESPACE = 'rotation.shiftTypes.';

/**
 * The rotation builder's namespace (story 2.3b). There `smjen` names the TEAM
 * — the builder binds teams to steps — exactly as in {@link TEAM_NAMESPACE},
 * and `tip… smjen…` is refused: the builder never says the Shift Type, it
 * shows each step's type by its name.
 */
const ROTATION_BUILDER_NAMESPACE = 'rotation.builder.';

/**
 * The calendar's namespace (story 3.1). Its columns are TEAMS, so `smjen`
 * names the Team there as in {@link TEAM_NAMESPACE}, and `tip… smjen…` is
 * refused: a cell shows its shift type by name.
 */
const CALENDAR_NAMESPACE = 'kalendar.';

/**
 * The hours' namespace (story 4.1b). *Sati* counts the SHIFTS a member works,
 * so `smjen` names a worked shift there — `15 smjena`, as the epic's "5 day
 * shifts, 60 hours" reads — and `tip… smjen…` is refused: an hour is never
 * counted by shift type, and nothing there names one.
 */
const HOURS_NAMESPACE = 'sati.';

/**
 * The filter bar's namespace (story 7.5), shared by *Kalendar* and *Sati*:
 * its first chip is `Smjena`, the Team, and an empty table says a person
 * `nije u smjeni Smjena B` — so `smjen` names the Team there, as in
 * `kalendar`, and `tip… smjen…` is refused: no filter is by shift type.
 */
const FILTER_NAMESPACE = 'filter.';

/**
 * *Danas*'s namespace (story 6.1a). It states the viewer's own next SHIFT —
 * `Sljedeća smjena`, the epic's own words — and that they are on no team, so
 * `smjen` names a worked shift or the Team there, as on *Sati*, and
 * `tip… smjen…` is refused: a shift type is shown by its name.
 */
const DANAS_NAMESPACE = 'danas.';

/**
 * The resolution screen's namespace (story 5.4b). It decides what holds for
 * ONE rostered shift — `odluči što vrijedi za ovu smjenu`, the mockup's own
 * words — so `smjen` names that shift there, as on *Sati*, and `tip… smjen…`
 * is refused: the shift type is shown by its name.
 */
const RESOLUTION_NAMESPACE = 'raspored.resolution.';

/**
 * The leave card's replacement guard (story 5.4e), ONE KEY and no namespace:
 * it names the rostered shift a replacement stays on — `ostaje na smjeni
 * {team}`, the spec's own words — so `smjen` names that shift there, as on
 * the resolution screen, and `tip… smjen…` is refused. Every other
 * `ljudi.leaveRecord` message still may not say `smjen` at all.
 */
const LEAVE_REPLACEMENT_KEY = 'ljudi.leaveRecord.replacementStays';

/**
 * The day detail's override copy (story 3.5b), inside the calendar's
 * namespace: the admin changes a team's SHIFT TYPE there, so it says the term
 * — `Tip smjene` is the form's field — and, as in
 * {@link SHIFT_TYPE_NAMESPACE}, says `smjen` only inside it. The team is named
 * by its own name through `{team}`, never by the word.
 */
const CALENDAR_OVERRIDE_NAMESPACE = 'kalendar.detail.override.';

/**
 * The rotation builder's override review (story 3.5c): the admin amends an
 * override's SHIFT TYPE there, so it says the term — `Tip smjene` is the
 * amend's field — and, being the builder's, the TEAM too, as `smjena` (an
 * archived `Smjena ili tip smjene`). Both words, each in its own sense: once
 * the term is taken out, what is left of `smjen` is the Team, which is
 * `rotation.builder`'s to say.
 */
const ROTATION_OVERRIDE_NAMESPACE = 'rotation.builder.overrides.';

/**
 * `Tip smjene` in the inflections of `tip` the copy can use — tip, tipa, tipu,
 * tipom, tipovi, tipova, tipove, tipovima — and no other word starting `tip`
 * (`tipka smjene`, `tipično smjena` are not the term).
 */
const SHIFT_TYPE_TERM = /(?<![\p{L}\p{N}])tip(?:a|u|om|ovi|ova|ove|ovima)?\s+smjen\p{L}*/gu;

/**
 * Whether a message says `smjen` where it may not: anywhere outside the three
 * namespaces; as the Shift Type (`tip smjene`) inside the team one and the
 * rotation builder's; and anywhere but inside `tip… smjen…` in the shift type
 * one. Keyed so the sweep
 * and its self-test run the same predicate.
 */
function teamTermOutOfTurn(key: string, message: string): boolean {
  const lowered = message.toLowerCase();

  if (key.startsWith(ROTATION_OVERRIDE_NAMESPACE)) {
    // The term taken out, `smjen` may remain only as the Team's noun.
    return /smjen(?!a\b|e\b|u\b|om\b|ama\b)/.test(lowered.replace(SHIFT_TYPE_TERM, ''));
  }

  if (key.startsWith(SHIFT_TYPE_NAMESPACE) || key.startsWith(CALENDAR_OVERRIDE_NAMESPACE)) {
    return lowered.replace(SHIFT_TYPE_TERM, '').includes('smjen');
  }

  if (
    !key.startsWith(TEAM_NAMESPACE) &&
    !key.startsWith(ROTATION_BUILDER_NAMESPACE) &&
    !key.startsWith(CALENDAR_NAMESPACE) &&
    !key.startsWith(HOURS_NAMESPACE) &&
    !key.startsWith(FILTER_NAMESPACE) &&
    !key.startsWith(DANAS_NAMESPACE) &&
    !key.startsWith(RESOLUTION_NAMESPACE) &&
    key !== LEAVE_REPLACEMENT_KEY
  ) {
    return lowered.includes('smjen');
  }

  return /\btip\w*\s+smjen/.test(lowered);
}

/** The reserved stem a message carries, or `null`. Lowercased, so an inflected
 *  or capitalized form cannot slip past. The list is a PARAMETER so the sweep
 *  and its self-test run the same predicate — one against what ships, one
 *  against a ledger with an entry in it — and deleting either cannot leave the
 *  other looking green. */
function reservedStemIn(message: string, stems: readonly string[] = RESERVED_STEMS): string | null {
  const lowered = message.toLowerCase();

  return stems.find((stem) => lowered.includes(stem)) ?? null;
}

function resource(): Record<string, unknown> {
  return JSON.parse(readFileSync(RESOURCE, 'utf8')) as Record<string, unknown>;
}

/** Every leaf key path, dotted the way i18next resolves them. */
function leafKeys(node: unknown, prefix = ''): string[] {
  if (typeof node !== 'object' || node === null) return [prefix];

  return Object.entries(node).flatMap(([key, value]) =>
    leafKeys(value, prefix === '' ? key : `${prefix}.${key}`),
  );
}

/** One message by its dotted key path. */
function messageAt(key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], resource());
}

function messages(): string[] {
  const found: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === 'string') {
      found.push(node);
      return;
    }
    if (typeof node === 'object' && node !== null) Object.values(node).forEach(walk);
  };
  walk(resource());

  return found;
}

describe('the resource file holds only what this story sanctions', () => {
  it('parses as an object with keys, so every sweep below means something', () => {
    // Vacuous-pass guard: an empty or restructured file would satisfy every
    // "does not contain" assertion while proving nothing.
    expect(Object.keys(resource()).length).toBeGreaterThan(0);
    expect(messages().length).toBeGreaterThan(0);
  });

  it('holds exactly the sanctioned keys and nothing else', () => {
    // The frozen boundary: 1.1d owns every screen literal so it can review them
    // in one place. A key added outside that review bypasses it.
    expect([...leafKeys(resource())].sort()).toEqual([...SANCTIONED_KEYS].sort());
  });

  it('keeps the two lists disjoint, so neither sweep can go vacuous', () => {
    // A key listed twice would shrink the key-set assertion above without
    // shrinking the file, and a plural key copied into the screen list would
    // escape the three-form check below.
    expect(new Set(SANCTIONED_KEYS).size).toBe(SANCTIONED_KEYS.length);
    expect(SANCTIONED_PLURAL_KEYS.length).toBeGreaterThan(0);
    expect(SANCTIONED_SCREEN_KEYS.length).toBeGreaterThan(0);
  });

  it.each(SANCTIONED_SCREEN_KEYS)('declares %s as a plain string, not an ICU argument', (key) => {
    // The other half of the partition. A screen string that quietly grew a
    // `{count, plural, …}` body would need the three-form check the block below
    // runs only over the plural list, so this is what notices it happening.
    const message = String(messageAt(key));

    expect(message.length).toBeGreaterThan(0);
    // Every ICU argument type, not only `plural` — `select` and
    // `selectordinal` are the same shape of smuggled argument and the bare
    // substring check would miss either.
    expect(
      message,
      `${key} carries an ICU argument and belongs in the plural list`,
    ).not.toMatch(/\{[^,}]+,\s*(plural|select|selectordinal)\s*,/);
  });

  it.each(SANCTIONED_PLURAL_KEYS)('declares %s as an ICU plural with all three Croatian forms', (key) => {
    const message = messageAt(key);

    expect(typeof message).toBe('string');
    // one/few/other, and `other` is not optional: Croatian needs all three, and
    // a message missing one silently renders the wrong noun (L7).
    for (const category of ['one', 'few', 'other']) {
      expect(String(message), `${key} declares no ${category} form`).toContain(`${category} {`);
    }
    expect(String(message)).toContain('plural');
  });
});

describe('the messages obey the voice rules that bind every string', () => {
  it('uses no exclamation mark anywhere', () => {
    // UX-DR34: no exclamation marks, no encouragement, no personality where a
    // fact will do. Cheap to assert now, and the assertion is what makes it
    // true of the hundred strings 1.1d and Epic 3 add.
    for (const message of messages()) {
      expect(message, `${message} carries an exclamation mark`).not.toContain('!');
    }
  });

  it('never says smjena for a shift type', () => {
    // UX-DR36 and the terminology contract: `Smjena` is the Team, `Tip smjene`
    // is the Shift Type, and using the former for the latter is a contract
    // violation however natural it reads.
    //
    // NARROWED BY STORY 1.7a, not relaxed. The team screens are the first to
    // say `smjena`, and they say it under the `smjene` namespace and nowhere
    // else: every message OUTSIDE it still may not mention a team at all, and
    // no message INSIDE it may say `tip smjen` — the Shift Type is still a
    // later epic's word, and the team screens are where it would creep in.
    //
    // AMENDED BY STORY 2.2b, and still narrow: the Shift Type arrives, under
    // `rotation.shiftTypes` ONLY, and there `smjen` may appear only inside the
    // term `tip… smjen…` — a bare `smjena` there would be the Team again.
    //
    // AMENDED BY STORY 2.3b: `rotation.builder` binds teams to steps, so it
    // says the Team as `smjene` does — and, as `smjene` does, never the Shift
    // Type.
    //
    // AMENDED BY STORY 3.1: `kalendar` has a column per team, and says the
    // Team the same way, never the Shift Type.
    //
    // AMENDED BY STORY 3.5b, and narrow: `kalendar.detail.override` changes a
    // team's Shift Type, so there — and only there in `kalendar` — the term
    // `tip… smjen…` is admitted, and `smjen` only inside it.
    //
    // AMENDED BY STORY 3.5c: `rotation.builder.overrides` amends an
    // override's Shift Type and names the Team, so there both are admitted:
    // the term `tip… smjen…`, and `smjen` otherwise only as the Team's noun.
    const found = leafKeys(resource())
      .map((key) => ({ key, message: String(messageAt(key)) }))
      .filter(({ key, message }) => teamTermOutOfTurn(key, message));

    expect(leafKeys(resource()).filter((key) => key.startsWith(TEAM_NAMESPACE)).length).toBeGreaterThan(0);
    expect(
      leafKeys(resource()).filter((key) => key.startsWith(SHIFT_TYPE_NAMESPACE)).length,
    ).toBeGreaterThan(0);
    expect(
      leafKeys(resource()).filter((key) => key.startsWith(ROTATION_BUILDER_NAMESPACE)).length,
    ).toBeGreaterThan(0);
    expect(found, 'a message says smjen out of turn').toEqual([]);
  });

  it('uses an en dash rather than a hyphen for any range', () => {
    // UX-DR34: `19:00–07:00` with U+2013, never a hyphen. No message carries a
    // range today; this is what keeps the first one that does honest.
    for (const message of messages()) {
      expect(message, `${message} appears to use a hyphen as a range separator`).not.toMatch(
        /\d\s*-\s*\d/,
      );
    }
  });

  it('carries no reserved vocabulary', () => {
    // The only sweep in this file that reads what the messages SAY rather than
    // what they are called. It finds nothing today because the ledger is empty;
    // the test below is what proves it would find something if it were not.
    const found = messages()
      .map((message) => ({ message, stem: reservedStemIn(message) }))
      .filter((entry) => entry.stem !== null);

    expect(messages().length, 'no messages to sweep at all').toBeGreaterThan(0);
    expect(found, `a message carries a reserved stem: ${JSON.stringify(found)}`).toEqual([]);
  });

  it('would notice a reserved stem in either Croatian form, ledger or no ledger', () => {
    // THE NON-VACUITY GUARD, moved off the list and onto the predicate — see the
    // block comment where `RESERVED_STEMS` is declared. The version this
    // replaces asserted `RESERVED_STEMS.length > 0`, which was right while the
    // ledger had entries and is simply false now; the version before THAT built
    // its own literals and called `toLowerCase` on them, so it asserted only
    // that JavaScript lowercases strings.
    //
    // Both polarities, and both forms. `Odjavi se` is the one a whole-word ban on
    // the noun could not see, which is why the ledger held stems.
    expect(reservedStemIn('Odjava', ['odjav'])).toBe('odjav');
    expect(reservedStemIn('Odjavi se', ['odjav'])).toBe('odjav');
    expect(reservedStemIn('ODJAVA', ['odjav'])).toBe('odjav');
    expect(reservedStemIn('Prijava', ['odjav'])).toBeNull();
    expect(reservedStemIn('Kratica organizacije', ['odjav'])).toBeNull();
    // And through the REAL ledger on the real file, so the sweep above is proved
    // against the messages it actually reads rather than only against strings
    // written here.
    expect(messages().map((message) => reservedStemIn(message)).filter((stem) => stem !== null)).toEqual(
      [],
    );
  });

  it('says the imperative for an action, the exit being the one named exception', () => {
    // Every action in this application is second person singular imperative —
    // `Spremi`, `Odustani`, `Odaberi sliku` — because destination labels are
    // nouns that NAME PLACES and an action is something a person does.
    //
    // THE EXIT IS THE ONE EXCEPTION, by human decision of 2026-09-25: it sits
    // at the foot of the navigation beside an icon, reads as the last entry of
    // that list, and says the noun `Odjava` the way its neighbours say
    // `Danas` and `Ljudi`. Pinned with `toBe` so the exception stays exactly
    // one string wide; every other action below still has to be a verb.
    expect(String(messageAt('shell.signOut'))).toBe('Odjava');
    // The imperative neighbours it stands with, read off the file rather than
    // assumed: if any of them ever becomes a noun this stops being a rule the
    // exit is following and becomes an exception nobody decided on.
    expect(messageAt('organization.save')).toBe('Spremi');
    expect(messageAt('organization.cancel')).toBe('Odustani');
    // STORY 1.5b's two, and they are here rather than trusted because they are
    // a SECOND authoring of the same two words: two keys for one action is
    // exactly where one of them drifts into a noun while the other stays a
    // verb, and nothing but this line would notice.
    expect(messageAt('ljudi.form.save')).toBe('Spremi');
    expect(messageAt('ljudi.form.cancel')).toBe('Odustani');
    // The three imperatives the member forms add. `Dodaj`, `Uredi` and `Vrati`
    // are all second person singular, which is what every action in this
    // interface is — and the row action is the one that would most naturally
    // have been written as the noun `Uređivanje`, which is the screen's
    // heading and not its control.
    expect(messageAt('ljudi.form.add')).toBe('Dodaj osobu');
    expect(messageAt('ljudi.form.edit')).toBe('Uredi osobu {name}');
    expect(messageAt('ljudi.form.back')).toBe('Vrati se na popis');
    // THE RESET'S FOUR ACTION LABELS, pinned here for the reason `Spremi` and
    // `Odustani` are: they are a THIRD authoring of the same imperative voice,
    // and the offer is the one that would most naturally have been written as
    // the noun `Dodjela nove lozinke` — a heading, not a control. `Dodijeli`,
    // `Potvrdi`, `Odustani` and `Sakrij` are all second person singular.
    expect(messageAt('ljudi.form.reset')).toBe('Dodijeli novu lozinku osobi {name}');
    expect(messageAt('ljudi.form.resetConfirm')).toBe('Potvrdi novu lozinku za osobu {name}');
    expect(messageAt('ljudi.form.resetCancel')).toBe('Odustani od nove lozinke');
    expect(messageAt('ljudi.form.resetDismiss')).toBe('Sakrij lozinku');
    // STORY 1.6's FOUR ACTION LABELS, a FOURTH authoring of the same voice. The
    // offer is the one that would most naturally have been the noun
    // `Deaktivacija` — a status, not a control. `Deaktiviraj`, `aktiviraj`,
    // `Potvrdi` and `Odustani` are all second person singular.
    expect(messageAt('ljudi.status.deactivate')).toBe('Deaktiviraj osobu {name}');
    expect(messageAt('ljudi.status.reactivate')).toBe('Ponovno aktiviraj osobu {name}');
    expect(messageAt('ljudi.status.deactivateConfirm')).toBe('Potvrdi deaktivaciju osobe {name}');
    expect(messageAt('ljudi.status.cancel')).toBe('Odustani od promjene statusa');
    // THE CANCELLATION'S TWO, in the same voice: `Poništi`, not the noun
    // `Poništavanje`, is the control.
    expect(messageAt('ljudi.status.withdraw')).toBe('Poništi zakazanu promjenu za osobu {name}');
    expect(messageAt('ljudi.status.withdrawConfirm')).toBe(
      'Potvrdi poništavanje promjene za osobu {name}',
    );
    // STORY 1.7a's SEVEN, a fifth authoring of the same voice. The archive offer
    // is the one that would most naturally have been the noun `Arhiviranje` —
    // the prompt's subject, not a control.
    expect(messageAt('smjene.add')).toBe('Dodaj smjenu');
    expect(messageAt('smjene.edit')).toBe('Uredi smjenu {name}');
    // An archived team's row opens it for viewing, in the same voice.
    expect(messageAt('smjene.view')).toBe('Prikaži smjenu {name}');
    expect(messageAt('smjene.save')).toBe('Spremi');
    expect(messageAt('smjene.archive')).toBe('Arhiviraj smjenu {name}');
    expect(messageAt('smjene.archiveConfirm')).toBe('Potvrdi arhiviranje smjene {name}');
    expect(messageAt('smjene.archiveCancel')).toBe('Odustani od arhiviranja');
    // STORY 1.7b's FIVE, a sixth authoring of the same voice. The move offer is
    // the one that would most naturally have been the noun `Premještaj` — the
    // prompt's subject, not a control.
    expect(messageAt('smjene.membership.move')).toBe('Promijeni smjenu osobe {name}');
    expect(messageAt('smjene.membership.moveConfirm')).toBe('Potvrdi promjenu smjene osobe {name}');
    expect(messageAt('smjene.membership.withdraw')).toBe(
      'Poništi zakazanu promjenu smjene za osobu {name}',
    );
    expect(messageAt('smjene.membership.withdrawConfirm')).toBe(
      'Potvrdi poništavanje promjene smjene za osobu {name}',
    );
    expect(messageAt('smjene.membership.cancel')).toBe('Odustani od promjene smjene');
    // STORY 2.1b's SIX, a seventh authoring of the same voice. The removal
    // offer is the one that would most naturally have been the noun
    // `Uklanjanje` — the prompt's subject, not a control.
    expect(messageAt('organization.hourBands.add')).toBe('Dodaj pojas');
    expect(messageAt('organization.hourBands.edit')).toBe('Uredi pojas {name}');
    expect(messageAt('organization.hourBands.save')).toBe('Spremi');
    expect(messageAt('organization.hourBands.remove')).toBe('Ukloni pojas {name}');
    expect(messageAt('organization.hourBands.removeConfirm')).toBe('Potvrdi uklanjanje pojasa {name}');
    expect(messageAt('organization.hourBands.removeCancel')).toBe('Odustani od uklanjanja');
    // STORY 2.3b's FOUR, an eighth authoring of the same voice. The save is
    // the one that would most naturally have been the noun `Spremanje
    // rotacije` — a status, not a control; the drag handle the noun
    // `Premještanje`.
    expect(messageAt('rotation.builder.addStep')).toBe('Dodaj korak');
    expect(messageAt('rotation.builder.drag.handle')).toBe('Premjesti korak {position}');
    expect(messageAt('rotation.builder.spread')).toBe('Rasporedi ravnomjerno');
    expect(messageAt('rotation.builder.remove')).toBe('Ukloni korak {position}');
    expect(messageAt('rotation.builder.save')).toBe('Spremi rotaciju');
    // STORY 2.6's TWO, a ninth authoring: the offer is the one that would most
    // naturally have been the noun `Poništavanje` — the prompt's subject.
    expect(messageAt('rotation.builder.cancelScheduled.offer')).toBe('Poništi promjenu zakazanu od {date}');
    expect(messageAt('rotation.builder.cancelScheduled.confirm')).toBe('Potvrdi poništavanje promjene');
    // STORY 4.3's one, in the same voice: `Izvezi`, not the noun `Izvoz`,
    // which is the label the control wears while the file is built.
    expect(messageAt('sati.organization.export.action')).toBe('Izvezi u Excel');
  });
});

describe('the detector reads the file it thinks it does', () => {
  // Guards the helpers themselves: a `leafKeys` that returned nothing would
  // make the key-set assertion pass against any file at all.
  it('flattens nested keys the way i18next resolves them', () => {
    expect(leafKeys({ a: { b: 'x', c: 'y' }, d: 'z' }).sort()).toEqual(['a.b', 'a.c', 'd']);
  });

  it('collects every message, however deeply nested', () => {
    const walked = leafKeys({ one: { two: { three: 'deep' } } });

    expect(walked).toEqual(['one.two.three']);
  });

  it('would notice an exclamation mark, a hyphen range and smjena', () => {
    // The sweeps above are only as good as their patterns; these are the
    // shapes they must catch.
    expect('Spremljeno!').toContain('!');
    expect('19:00-07:00').toMatch(/\d\s*-\s*\d/);
    expect('Tip smjene'.toLowerCase()).toContain('smjen');
  });

  it('would notice smjen outside the team namespace, and the Shift Type inside it', () => {
    // The self-test for the narrowed sweep, on every polarity it decides.
    expect(teamTermOutOfTurn('ljudi.caption', 'Popis smjena')).toBe(true);
    expect(teamTermOutOfTurn('smjena.heading', 'Smjena')).toBe(true);
    expect(teamTermOutOfTurn('smjene.heading', 'Smjene')).toBe(false);
    expect(teamTermOutOfTurn('smjene.count', '{count, plural, one {# smjena}}')).toBe(false);
    expect(teamTermOutOfTurn('smjene.name', 'Tip smjene')).toBe(true);
    expect(teamTermOutOfTurn('smjene.name', 'Tipovi smjena')).toBe(true);
    expect(teamTermOutOfTurn('ljudi.caption', 'Popis osoba')).toBe(false);
    // STORY 2.2b's namespace, on both polarities: the term passes in any
    // inflection; a bare `smjena` beside it, or instead of it, does not; and
    // the term anywhere outside the namespace is still out of turn.
    expect(teamTermOutOfTurn('rotation.shiftTypes.heading', 'Tipovi smjena')).toBe(false);
    expect(teamTermOutOfTurn('rotation.shiftTypes.add', 'Dodaj tip smjene')).toBe(false);
    expect(teamTermOutOfTurn('rotation.shiftTypes.count', '{count, plural, few {# tipa smjene}}')).toBe(false);
    expect(teamTermOutOfTurn('rotation.shiftTypes.name', 'Naziv smjene')).toBe(true);
    expect(teamTermOutOfTurn('rotation.shiftTypes.name', 'Tip smjene iz smjene A')).toBe(true);
    // Near misses: words that START with `tip` but are not the term.
    expect(teamTermOutOfTurn('rotation.shiftTypes.name', 'Tipka smjene')).toBe(true);
    expect(teamTermOutOfTurn('rotation.shiftTypes.name', 'Tipično smjena')).toBe(true);
    expect(teamTermOutOfTurn('rotation.shiftTypes.name', 'Prototip smjene')).toBe(true);
    expect(teamTermOutOfTurn('rotation.shiftTypes.name', 'Tipovima smjena')).toBe(false);
    expect(teamTermOutOfTurn('rotation.pattern.heading', 'Tip smjene')).toBe(true);
    expect(teamTermOutOfTurn('organization.hourBands.name', 'Tip smjene')).toBe(true);
    // STORY 2.3b: the builder may say the Team, and never the Shift Type.
    expect(teamTermOutOfTurn('rotation.builder.offsetsHeading', 'Smjene i pomaci')).toBe(false);
    expect(teamTermOutOfTurn('rotation.builder.offsetOf', 'Pomak smjene {name}')).toBe(false);
    expect(teamTermOutOfTurn('rotation.builder.patternLede', 'Isti tip smjene može se ponoviti.')).toBe(true);
    // STORY 3.5b: the day detail's override copy says the Shift Type, and
    // `smjen` only inside the term; the rest of `kalendar` still never does.
    expect(teamTermOutOfTurn('kalendar.detail.override.set.type', 'Tip smjene')).toBe(false);
    expect(teamTermOutOfTurn('kalendar.detail.override.set.heading', 'Promijeni tip smjene')).toBe(false);
    expect(teamTermOutOfTurn('kalendar.detail.override.remove.prompt', 'Ukloniti izmjenu smjene A?')).toBe(true);
    expect(teamTermOutOfTurn('kalendar.detail.title', 'Tip smjene')).toBe(true);
    expect(teamTermOutOfTurn('kalendar.detail.off', 'Smjena taj dan ne radi.')).toBe(false);
    expect(teamTermOutOfTurn('rotation.builder.patternLede', 'Tipovi smjena')).toBe(true);
    expect(teamTermOutOfTurn('rotation.builder.patternLede', 'Isti tip može se ponoviti.')).toBe(false);
    expect(teamTermOutOfTurn('rotation.builderx.heading', 'Smjena')).toBe(true);
    // STORY 2.4: the stepper's step names sit under the builder's namespace —
    // `Tipovi` alone passes, the Shift Type term does not.
    expect(teamTermOutOfTurn('rotation.builder.stepper.step.types', 'Tipovi')).toBe(false);
    expect(teamTermOutOfTurn('rotation.builder.stepper.step.types', 'Tipovi smjena')).toBe(true);
    expect(teamTermOutOfTurn('rotation.pattern.heading', 'Smjena')).toBe(true);
    // STORY 4.1b: a worked shift in *Sati*, never the Shift Type.
    expect(teamTermOutOfTurn('sati.shiftCount', '{count, plural, one {# smjena}}')).toBe(false);
    expect(teamTermOutOfTurn('sati.shifts', 'Tip smjene')).toBe(true);
    expect(teamTermOutOfTurn('satix.shifts', 'Smjene')).toBe(true);
    // STORY 7.5: the filter bar names the Team, never the Shift Type.
    expect(teamTermOutOfTurn('filter.chip.teamAll', 'Smjena: sve')).toBe(false);
    expect(teamTermOutOfTurn('filter.team', 'Tip smjene')).toBe(true);
    expect(teamTermOutOfTurn('filterx.team', 'Smjena')).toBe(true);
    // Story 5.4e: the one guard line names the shift; its siblings still may not.
    expect(teamTermOutOfTurn('ljudi.leaveRecord.replacementStays', 'Dino ostaje na smjeni Smjena C')).toBe(false);
    expect(teamTermOutOfTurn('ljudi.leaveRecord.replacementStays', 'Tip smjene')).toBe(true);
    expect(teamTermOutOfTurn('ljudi.leaveRecord.replacementsUnknown', 'na smjeni')).toBe(true);
  });

  it('resolves a nested key path to its message and a wrong one to nothing', () => {
    // `messageAt` is what both key-shape assertions read through. A version
    // that returned `undefined` for everything would make the ICU check pass
    // vacuously on a typo'd key name.
    expect(String(messageAt('count.days'))).toContain('plural');
    expect(typeof messageAt('auth.heading')).toBe('string');
    expect(messageAt('auth.headng')).toBeUndefined();
  });
});
