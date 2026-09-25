---
title: 'Visual refresh B — content screens in the shiftapp-v2 style'
type: 'feature'
created: '2026-09-25'
status: 'done'
review_loop_iteration: 0
baseline_commit: '9d116ceefdc36daeba9cddbd84dea0370de04d11'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-visual-refresh-a-design-system-and-shell.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-shift-2026-09-02/DESIGN.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Part A retheme gave the app new tokens, fonts, primitives and shell, but the content screens still use ad-hoc stock layouts. Headings are centred `text-xl`, cards float in the middle of the page, role and status are bare text, and the native selects look older than the inputs. The owner wants the screens to match the mockups, and every future screen to follow the same pattern.

**Approach:**
- Add a small set of layout primitives in `components/ui`: `PageHeader`, `PageTitle`, `StatCard`, `Badge` and `Avatar`.
- Put every screen on one page skeleton: a left-aligned header with actions on the right, then content.
- Show role and status as pill badges, and names with initials avatars.
- Give the members list a summary row of stat cards counted from the list it already loads.
- Unify the native selects and the alert/status boxes with the Input look.

Visual change only. No new queries, data or routes.

## Boundaries & Constraints

**Always:**
- Everything part A's Always list requires: Croatian keys only; light and dark; phone-first; `h-11` floor; `destructive` never in screens; no state carried by colour alone; OKLCH tokens; no test threshold lowered.
- Primitives contain no `t()` and no literals. Screens pass their own `<h1>{t('nav.x')}</h1>` into `PageTitle asChild`, so heading binding holds.
- Every decision (counts, initials, badge kind) lives in a tested pure `.ts` module (AD-15). Figures render through `formatNumber`.
- Stat cards count only data the screen already has in hand, as one snapshot (AD-13).
- Badge meaning is carried by its text. Colour only reinforces it.
- New keys join `SANCTIONED_*` and obey the voice rules: no `smjen` outside `smjene.*`, no `Nema`, en dash for ranges.
- Pinned counts and source lists in tests may change to match intentional additions. Each change is noted in the test comment.

**Ask First:**
- Adding a new colour token such as success or warning.
- Widening a structural detector in `prijava.test.ts`, as opposed to updating a count.
- Replacing the native `<select>` with a component.
- Any new npm dependency.

**Never:**
- New features, data, queries, routes or filters.
- Subtitles or other new explanatory copy beyond stat labels.
- A topbar or search in the shell.
- Coloured status pills that imply new semantics (green, amber, red).
- Emoji.
- Restyling in a screen what a primitive should own.

</frozen-after-approval>

## Code Map

- `apps/web/src/components/ui/card.tsx` -- `CardTitle asChild` precedent (part A). New primitives follow this Slot pattern.
- `apps/web/src/components/auth-layout.tsx` -- precedent for a shared `.tsx` registered in `SCREENS`/`KEY_SOURCES`. Only needed if a component calls `t()`, and the new primitives must not.
- `apps/web/src/components/README.md` -- stale: it says "never restyled". Align it with DESIGN.md's "restyle once in `components/ui`".
- `apps/web/src/routes/ljudi.tsx:230-420` -- members list:
  - It may read only `.id` from a row (`prijava.test.ts:2259-2272`). Avatar and badge values must arrive through `members/list.ts` cell content.
  - `cellContent` returns are pinned at `prijava.test.ts:2292-2331`.
  - Exactly 2 `<TableHead` (`:4700`), no `.length === 0` (`:2617`), no `overflow-auto` (`:2598`).
  - One `useQuery`.
- `apps/web/src/members/list.ts:164-189,405,458,533` -- `cellContent`, `memberTeamOf`, `memberActiveOn`, `memberStatusOf`. Home for the summary counts and avatar cell value.
- `apps/web/src/organization/logo.ts:453-457` + `logo.test.ts:796-823` -- the NFC first-code-point initial. Generalise it into a neutral pure module, e.g. `apps/web/src/components/initials.ts`: first letters of the first and last word, NFC, blank → null.
- `apps/web/src/routes/smjene.$id.tsx`, `danas.tsx` -- only `.id`/`.name` access, no `@/members/list` import, no form controls, 1 `useQuery`, fixed Link counts (`prijava.test.ts:2491-2572`). They may use the neutral initials module.
- `apps/web/src/routes/{ljudi.novi,ljudi.$id,ljudi.smjene,ljudi.smjene.$id,organizacija}.tsx` -- `Card max-w-lg` forms. Five native selects (`ljudi.tsx:290`, `ljudi.novi.tsx:346`, `ljudi.$id.tsx:734,1166`, `organizacija.tsx:701`) share one literal class string. The accent select must keep `h-11 focus-visible:ring-ring disabled:opacity-50 border-input` and its aria/`defaultValue` shape (`prijava.test.ts:4017-4071,4222`).
- Placeholders `kalendar/godisnji/sati/raspored/postavke-rotacije.tsx`, `not-found.tsx` -- a centred h1 today.
- `apps/web/src/routes/prijava.test.ts` -- the 44px floor needs a double-quoted `className="…h-11…"` on every control (`:2721-2750`). The allowed literal attributes are at `:728-823`: no `size="sm"`, `aria-hidden="true"` or `data-*`. Pinned per-screen control and `t()` counts are at `:256-383`. Heading regex `:945`, `:1596-1618`.
- `test/resource-hygiene.test.ts:37,78,537-548,605,722-809` -- sanctioned keys and voice rules.
- `test/localization-applied.test.ts:48,444,793` -- `SOURCES`, vocabulary counts and the `Nema` ban.
- `test/theme-contrast.test.ts` -- add badge pairs here.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/components/ui/{page-header,badge,stat-card,avatar}.tsx` -- add the primitives. None of them has literal copy or `t()`. -- one owner for every future screen's skeleton.
  - `PageHeader`: a flex row, stacking on phone, with a title slot and an actions slot.
  - `PageTitle`: a Slot for `text-2xl font-extrabold`.
  - `StatCard`: a Card with a label slot and a large Syne tabular value.
  - `Badge`: `default` (primary tint), `secondary`, `outline`.
  - `Avatar`: a round initials chip with an `aria-hidden` treatment that is legal under the attribute rules.
- [x] `apps/web/src/components/initials.ts` + test -- pure initials. Move `organizationLogoMark` onto it, or share it with that function, keeping `logo.test.ts` green. -- avatars without new data.
- [x] `apps/web/src/members/list.ts` + tests -- add an unfiltered summary: total, admins, active today, inactive. Expose the avatar and badge kind through cell content. Update the pinned `cellContent` expectations. -- keeps `ljudi.tsx` field-blind.
- [x] `apps/web/src/routes/*.tsx` (all listed screens) -- apply the skeleton:
  - The page is `mx-auto w-full max-w-5xl` with the header first. Form cards are left-aligned `max-w-lg` below the header.
  - Placeholders and not-found use the header rather than centring.
  - The members list gets a 2-column stat row on phone and 4 columns from `lg`. Role and status render as badges, and names get avatars.
  - The roster and Danas get avatars and cards.
  - One refusal and status box style everywhere.
  - Update the five select class strings identically, to the Input look.
  -- consistent screens.
- [x] `apps/web/src/i18n/locales/hr.json`, `test/resource-hygiene.test.ts`, `test/localization-applied.test.ts`, `apps/web/src/routes/prijava.test.ts` -- add the stat labels under `ljudi.stats.*`. Update the counts and source lists. -- tests describe the new screens.
- [x] `test/theme-contrast.test.ts` -- badge pairs at 4.5:1 in both themes: primary tint on card, secondary, and muted-foreground on card. Retune the tint alpha if one of them fails. -- badges are text.
- [x] `apps/web/src/components/README.md`, DESIGN.md primitive table -- document the new primitives and the page skeleton. -- future screens follow them.

**Acceptance Criteria:**
- Given any destination, when rendered, then its title sits top-left in the heading face with actions at the right (stacked on phone), and nothing scrolls sideways at 390px.
- Given the members list with a search typed, when rendered, then the stat cards still show unfiltered totals and the table rows show avatar, name, and role/status badges.
- Given dark theme, when any badge or stat card renders, then its text passes the contrast tests.
- Given the repository, when `pnpm lint`, `pnpm typecheck`, `pnpm --filter @shift/web build` and `pnpm test` run, then all pass.

## Verification

Environment: prefix commands with `PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH"`. The local Supabase stack is running. The dev server on 5173 is serving this worktree.

**Commands:**
- `pnpm lint && pnpm typecheck` -- expected: clean
- `pnpm --filter @shift/web build && pnpm test` -- expected: all green

**Manual checks:**
- Signed in as `ivan.maric` (`dvd-kastel-novi`), view Ljudi, a member, Timovi, Organizacija and Danas at 390px and 1280px in light and dark.

## Suggested Review Order

**The page skeleton**

- The one pattern every screen now follows; read this first.
  [`DESIGN.md:243`](../planning-artifacts/ux-designs/ux-shift-2026-09-02/DESIGN.md#L243)

- Title as a Slot, so screens keep their literal `<h1>{t('nav.x')}` binding.
  [`page-header.tsx:27`](../../apps/web/src/components/ui/page-header.tsx#L27)

- Refusal and status in one primitive; the icon distinguishes them beyond words.
  [`notice.tsx:29`](../../apps/web/src/components/ui/notice.tsx#L29)

**Members list decisions (pure, tested)**

- Summary and narrowing come from one call, so cards can never count filtered rows.
  [`list.ts:1752`](../../apps/web/src/members/list.ts#L1752)

- Avatar, role badge and inactive marker key decided together, outside the screen.
  [`list.ts:1179`](../../apps/web/src/members/list.ts#L1179)

- Active/inactive withheld while today is unknown.
  [`list.ts:1222`](../../apps/web/src/members/list.ts#L1222)

- Screen consumes the view; stays field-blind.
  [`ljudi.tsx:265`](../../apps/web/src/routes/ljudi.tsx#L265)

- Stat row: 2 columns on phone, 4 from `lg`.
  [`ljudi.tsx:316`](../../apps/web/src/routes/ljudi.tsx#L316)

**Primitives**

- First letter per word, skipping punctuation; no `Intl` outside format.ts.
  [`initials.ts:39`](../../apps/web/src/components/initials.ts#L39)

- Badge meaning carried by text; tint reinforces only.
  [`badge.tsx:43`](../../apps/web/src/components/ui/badge.tsx#L43)

- Empty chip keeps names aligned when there are no initials.
  [`avatar.tsx:11`](../../apps/web/src/components/ui/avatar.tsx#L11)

**Tests**

- Badge text measured on card and hovered rows, both themes.
  [`theme-contrast.test.ts:332`](../../test/theme-contrast.test.ts#L332)

- Five native selects must match the documented class string.
  [`prijava.test.ts:2620`](../../apps/web/src/routes/prijava.test.ts#L2620)
