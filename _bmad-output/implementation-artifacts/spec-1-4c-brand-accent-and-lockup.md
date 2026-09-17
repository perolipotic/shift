---
title: 'Story 1.4c — the brand accent and the logo lockup'
type: 'feature'
created: '2026-09-17'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'd704ea2ce6a838c45edcc9d98e29cd2c1922ea0c'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** UX-DR5 says an organization's accent tints the application shell and the logo lockup, and neither half exists. There is no accent anywhere — `index.css` carries only shadcn's inherited neutral `--accent` hover token — and no lockup: story 1.4b put the logo on the settings screen, so the only place an organization's own logo appears is the screen where you upload it. The chrome that shipped with the navigation shell renders no branding at all.

**Approach:** A curated set of accents, authored as real tokens under the same measured-contrast rules the other 51 follow, and an organization stores which one it chose — an identifier, never a colour, so colour stays in the theme layer where it is measured. The chrome gains a lockup that renders the organization's logo or its neutral mark, and the accent tints that lockup and the shell chrome, and nothing else.

## Boundaries & Constraints

**Always:**
- **The database stores a key, not a colour.** A `check` constraint enumerates the curated accents, so an accent this build cannot render is unrepresentable rather than validated. The SPA's set and the constraint's set are asserted to agree.
- **Every accent is measured like every other token.** Each is a fill and foreground pair declared once per theme in both light and dark, mapped in `@theme inline`, listed in `BRAND_TOKENS`, and carrying its own contrast pair asserted at AA. An accent that ships without a measured pair is the one thing this curation exists to prevent.
- **No accent may sit in `destructive`'s hue.** `destructive` is reserved exclusively for an unresolved conflict — not a brand accent, and the epic names the pilot fire department's red as the case this rule exists for (UX-DR4). The curated set excludes it by construction, and a test pins the separation rather than trusting the palette.
- **The curated set is exactly four, plus none.** Keys `blue`, `green`, `amber`, `violet`, each with a Croatian label; `brand_accent` null is "no accent" and is the default every organization starts at. Four is a starting set, not a ceiling: adding one is a token pair, a contrast pair, a constraint value and a label, moving together. Red is absent deliberately and permanently — see below.
- **Human decision 2026-09-17: a curated palette, not a free-form colour.** Every other colour in this application has build-time measured contrast; an admin-entered colour would move that guarantee to runtime for the sake of exact brand matching, and would need a runtime guard nothing else here needs.
- The tint reaches the lockup and the shell chrome only. A shift fill, a modifier signal, `primary` and `destructive` are all untouched, and a test asserts it.
- **No theme hook.** `theme-tokens.test.ts:140` bans `.dark`, `[data-theme` and `data-theme=`, and `:47` requires one declaration per token per theme. The accent is selected by naming distinct tokens, never by an attribute or class that reassigns one token's value.
- An organization that has chosen no accent renders the untinted shell it has today — the absence is a neutral default, not an error.
- The chrome reads the organization under `ORGANIZATION_SNAPSHOT_KEY`, the same single key `/organizacija` already uses, so both surfaces share one cache entry and no second snapshot exists (AD-13).
- The lockup renders in both layouts — the sidebar and the phone bar — as the destinations and the exit already do.
- Human decision 2026-09-17: this story covers the accent **and** the lockup, so UX-DR5 becomes literally true rather than half-satisfied. It is the last part of story 1.4 and completes its parent key.

**Ask First:**
- Adding or removing an accent from the curated set once the migration exists — the constraint, the tokens, the labels and the contrast pairs move together.
- Any change to `format.ts`'s exported signatures, or to the shift ramp, modifier or `destructive` tokens.
- Consuming `--sidebar-primary` or `--sidebar-ring`: both are recorded open questions with asymmetric values, and this story must not resolve them silently.

**Never:**
- No free-form colour input, no hex field, no colour picker.
- No runtime contrast computation. Nothing in `apps/web/src` computes a colour ratio today, and a curated palette is what makes that unnecessary.
- No accent on the sign-in screens. They render before any session, so no organization exists to brand — the same reason 1.1d shipped neither logo nor accent.
- No second organization read. If the lockup and the settings screen disagree about the organization, the cause is two reads, and there is exactly one.
- No colour-only meaning anywhere the accent lands. The active destination keeps `aria-current` and its non-colour treatment; the accent may only add to that signal.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Admin chooses an accent | one of the curated set | Saved; the shell and lockup tint on the next render, everywhere both appear | A refused save names the problem and keeps every entered value |
| Organization has no accent | `brand_accent` null | Untinted shell, exactly as today | N/A |
| Accent outside the set | direct API write of an unknown key | Refused by the check constraint | Fails closed at the database, not at the interface |
| Member-role writes an accent | active member, not admin | Refused — the column grant and policy admit only an active admin | Surface offers no control |
| Organization has a logo | `logo_path` set and readable | The lockup renders the logo in both layouts | N/A |
| Organization has no logo | `logo_path` null | The lockup renders the neutral mark carrying the organization's name | Never a broken image |
| Logo unreadable from the chrome | signed URL refused or expired | The lockup falls back to the neutral mark | Reported once, not per layout |
| Organization read fails in the chrome | refusal or transport fault | Navigation still renders; the lockup falls back and the failure is reported | Never an empty shell |

</frozen-after-approval>

## Code Map

**Baseline `d704ea2`**, green: **1064 root / 714 web / 4 domain**, 0 skipped. `nvm use` first (Node 24.19.0) — the nvm v20 bin precedes it in `PATH`, so verify `node -v`. `pnpm build` before `pnpm test`: `localization-applied.test.ts` **fails** rather than skips on a stale build.

### The theme layer, and exactly what an accent owes it

- `index.css:78-134` light `:root`; `:137-196` dark, selected **only** by `@media (prefers-color-scheme: dark)` — `:70-73` records that there is deliberately no class and no attribute. `:196-257` `@theme inline`, 51 `--color-*` lines; a token becomes a Tailwind utility by appearing there.
- The brand delta an accent must never touch: `--primary` `:112-113`, `--destructive` `:114-115`, the six-slot ramp plus non-working `:116-129`, the modifier signals `:130-134` (dark counterparts `:170-192`).
- `theme-css.ts:24-36` `BRAND_TOKENS` is **built**, not literal: 11 base names each expanded to `[name, name-foreground]`, then `.concat('modifier-overridden')` → 23. Accents extend that expansion. `:40-69` `BASE_TOKENS` is a 28-entry literal.
- `theme-tokens.test.ts:35` and `:39` hard-code 23 and 28 — **both move or the new tokens are silently untested** (`deferred-work.md:449` item (f) names this exact failure). `:47` one declaration per token per theme; `:56` present in both; `:83` light and dark must differ, with a `PARITY` exemption list at `:71-78`; `:133` the `@theme inline` mapping.
- `theme-contrast.test.ts` — `wcagContrast` from `culori`, `ratio()` `:98-100`, `composite()` `:89-96` for alpha. `AA_BODY = 4.5` `:21`, `AA_LARGE = 3` `:22`. `BRAND_PAIRS` `:27-37` is where each accent's fill/foreground pair joins. `:406-413` already asserts `destructive` against every fill — the model for asserting an accent is not `destructive`.
- **Nothing in `apps/web/src` computes contrast, parses OKLCH or sets a CSS custom property at runtime** — no `setProperty`, no inline `style` anywhere. The curated palette is what keeps it that way.
- `deferred-work.md:207-208` and `:233-234` — `--sidebar-primary` and `--sidebar-ring` are asymmetric between themes with no recorded design intent, both explicitly deferred "to whichever spec first renders a sidebar control". This story renders one. Do not resolve them; do not consume them.

### The chrome, which is where the lockup goes

- `chrome.tsx:350` the outer flex; `:355` the `<aside>` (`hidden … sm:flex`), whose first child is the collapse `<Button>` at `:364-373` — **there is no header region today**; `:374` the sidebar `<nav>`; `:378-380` the collapsible `<div id="app-destinations">`; `:381` the exit, deliberately outside it; `:398-404` the phone `<nav>`.
- `:346-347` `destinations` and `exit` are computed once and rendered into both bars — the lockup follows that shape, and `prijava.test.ts:965`'s `navBlocks` assertion already requires both bars to carry what the chrome claims to render.
- `:116-119` the role query — `useQuery` over `readMemberRole` with the `MemberTable` seam (`role.ts:150-152`) and an injected session reader (`role.ts:222-224`). The organization read copies this shape.
- **`:210-218` records that the chrome carries no organization read and flags it as the line to revisit.** This is that revisit: `ORGANIZATION_SNAPSHOT_KEY` is one constant key over one shared `QueryClient` (`main.tsx:36`), so a chrome read reuses `/organizacija`'s cache entry rather than adding a second snapshot.
- `:207` sign-out clears the whole cache, so the accent and lockup of a previous member do not survive into the next session.

### What the lockup reuses

- `logo.ts:222-224` `organizationLogoKey`, `:352-378` `readOrganizationLogoUrl`, `:453-457` `organizationLogoMark` (NFC-normalised first code point, `null` for a blank name), `:108` `LOGO_URL_STALE_MS`, `:129` `LOGO_UNREADABLE`.
- `organizacija.tsx:156-172` the derived signed-URL query — `enabled: logoPath !== null`, `staleTime: LOGO_URL_STALE_MS`; `:361-428` `renderLogo`, the `<img>` with `onError` at `:392-397` and the neutral mark at `:383-390`. The lockup is this logic in a shared component, not a second copy.

### Data

- `snapshot.ts:79-94` the snapshot's 13 fields ending in `logoPath`; `:69-70` `ORGANIZATION_COLUMNS`; `:48` the key; `:97-139` `OrganizationEdits` and `OrganizationLogoEdit` kept disjoint by mutual `?: never`; `:152-154` `isLogoEdit`; `:340-355` `organizationEditColumns`. An accent edit joins this union and must stay disjoint from both.
- `0005` is the highest migration. Its `grant update (logo_path)` **unions** with `0004`'s five, so the admin-writable set is exactly six columns today; an accent column adds its own grant line the same way.
- `0002:38-41` forbids a default that encodes one organization's answer — the accent column is nullable with no default.

### Gates, at their values after two stories landed in two days

- `resource-hygiene.test.ts:52-191` `SANCTIONED_SCREEN_KEYS` holds **54**; `RESERVED_STEMS` is now `[]` at `:226`, with its non-vacuity moved onto the detector self-test at `:214-220` — the mechanism survives with an empty list, so a new reserved word has somewhere to go.
- `localization-applied.test.ts:48-128` `SOURCES`; `:380-448` `AUTHORED_VOCABULARY`; `:466` `NAVIGATION_AND_TERMINOLOGY` is now `['Smjena','Smjene','smjena','Nema']`.
- `prijava.test.ts:136-188` `SCREENS` — the navigation chrome is **3** controls, the settings surface **8**. `:702-763` `KEY_SOURCES` — chrome **6**, chrome messages **2**, settings **12**. `:351-408` `STRUCTURAL_ATTRIBUTES` holds 16 and is **global**.
- Detectors and their guards: `navBlocks` `:576-578` guarded `toHaveLength(2)` at `:965`; `linkElements` `:614-616` guarded at `:949`; `ariaCurrentValues` `:590-598` guarded at `:2442`; `bareInputElements` `:553-555` guarded at `:1844`; `buttonElements` `:558-560` — its only guard is a fixed count on the sign-in screen at `:775`, so a new sweep must bring its own length assertion.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/index.css` — a fill and foreground pair for each of `blue`, `green`, `amber` and `violet`, declared once in light and once in dark, each mapped in `@theme inline`. Author them under the same measured-contrast rules as the existing 51; none may sit in `destructive`'s hue.
- [x] `test/theme-css.ts`, `test/theme-tokens.test.ts`, `test/theme-contrast.test.ts` — extend `BRAND_TOKENS`' expansion, move the hard-coded count, and add each accent's contrast pair plus an assertion that every accent is separated from `destructive`.
- [x] `supabase/migrations/0006_organization_accent.sql` — nullable `brand_accent text` with a `check` enumerating the curated keys; its own `grant update (brand_accent)`, unioning with the existing six. Comment why the column holds a key and not a colour.
- [x] `apps/web/src/organization/accent.ts` — the curated set as data: the keys, their Tailwind class literals, and the lookup the chrome uses. One module so the DB constraint, the tokens and the labels have a single source to be asserted against.
- [x] `apps/web/src/organization/accent.test.ts` — the set agrees with the migration's constraint and with the authored tokens; an unknown key resolves to the neutral default rather than throwing.
- [x] `apps/web/src/organization/snapshot.ts` — `brandAccent` on the snapshot and in `ORGANIZATION_COLUMNS`; an accent edit variant kept disjoint from the identity and logo writes.
- [x] `apps/web/src/organization/lockup.tsx` — the logo-or-mark lockup, taking the snapshot and the signed URL, used by both the chrome and (if it reduces duplication) the settings screen.
- [x] `apps/web/src/navigation/chrome.tsx` — read the organization under the existing key, render the lockup in both bars, and apply the accent to the lockup and the shell chrome only.
- [x] `apps/web/src/routes/organizacija.tsx` — the accent control, offering the curated set plus "no accent", following the uncontrolled-field pattern so a refusal keeps every value.
- [x] `apps/web/src/i18n/locales/hr.json` — one label per accent, the "no accent" label, and the lockup's accessible name.
- [x] `test/rls-isolation.test.ts` — the accent column over both fixtures: an admin writes it, a member-role session is refused, a cross-tenant write is a no-op, and a value outside the set is refused by the constraint.
- [x] `test/resource-hygiene.test.ts`, `test/localization-applied.test.ts`, `apps/web/src/routes/prijava.test.ts` — extend all three in the same commit: sanctioned keys, `SOURCES`, `AUTHORED_VOCABULARY`, the chrome's and settings surface's control and key counts.

**Acceptance Criteria:**
- Given an organization with a logo, when any signed-in screen renders, then its lockup appears in the navigation chrome at every viewport width, and no screen renders a broken image.
- Given an organization with an accent, when the shell renders, then the tint reaches the lockup and the shell chrome and nothing else — every shift fill, every modifier signal, `primary` and `destructive` are byte-identical to an organization with no accent.
- Given any accent in the curated set, when its contrast is measured against its own foreground, then it clears AA, and it is separated from `destructive` by the asserted margin.
- Given a member-role session, when it attempts to set the accent by any path, then the write is refused by the database rather than by the interface.

## Spec Change Log

### 2026-09-17 — iteration 0, three adversarial layers, no loopback

**Triage deviation, recorded deliberately.** Spec-rooted findings were routed to `patch` rather than `bad_spec`, following the precedent `spec-1-3b`, `spec-1-4a`, `spec-1-4b` and the navigation shell's part B all set. The architecture held; every fix was additive.

**The finding that mattered most was one the spec's own premise missed.** The separation rule was written against `destructive` alone, because that is the token UX-DR4 reserves. But `--brand-amber` shipped ~4° from `--modifier-uncovered`, and the previously-authored dark amber measured **ΔE 1.5 from `--modifier-uncovered-foreground`** — the same colour to the eye. An organization branded amber would have tinted its shell in the hue the application uses to mean "this shift is uncovered". All eight values were re-tuned; the worst margin is now ΔE 10.8 from any signal and 49° from `destructive`.

Two second-order lessons came out of fixing it, and both are why the sweep now passes for the right reason: the modifier overlays are **alpha** tokens, so measuring their raw fills is what let ΔE 1.5 through — they must be measured through their foregrounds as well. And Tailwind's scanner is text-based and **reads comments**, so prose in `apps/web/src` that spelled out a class name kept `.bg-brand-blue` alive through a mutation that should have killed it.

**KEEP — must survive any re-derivation.**
- **Every reserved signal is a separation target, not just `destructive`.** A blanket 45° rule is arithmetically unsatisfiable here — the five signals sit at ~19°, 76°, 158°, 245° and 290°, leaving only two windows on the circle — so `destructive` keeps hue plus ΔE (red is absent from the set, not merely distant) and the rest get ΔE, with the arithmetic written into the test rather than left implicit.
- **The accent is measured against what it is drawn on**, at the 3:1 non-text floor, not only against its own foreground. `edge` and `frame` are borders; the foreground is not involved there.
- **Class literals are whole, and `accent.ts` is the only file under `src` that spells one out** — asserted by a tree sweep, because an interpolated class emits no rule and paints nothing while every source-text test passes.
- **The built stylesheet is asserted, not the source.** `theme-applied.test.ts` already learned this for `.border-input`; the accents get the same treatment.
- **`ORGANIZATION_COLUMNS` is asserted by content.** Comparing the select list to the constant compares it to itself, and dropping a column makes a feature invisible at the read boundary while writes still succeed.
- **`organizationEditColumns` is exhaustive over a positive predicate**, so a fourth write shape is a typecheck failure rather than a silent timezone refusal.

**Recorded disagreements, all argued rather than skipped.** A 45° rule against every signal cannot be satisfied with these four keys, so the exemption is stated. `frame` and `edge` cannot collapse, because the untinted shell's two neutrals differ and emitting both would make the winner depend on stylesheet order. The positive RLS control cannot run in a rolled-back transaction, because it writes over the real transport as a real session — it is self-healing three ways instead, and now fails loudly on a leftover rather than writing over it. And one regression the review claimed does not reproduce: `Intl.DateTimeFormat` treats `timeZone: undefined` as "use the default", so the old negation chain was unreadable rather than broken — the behaviour is now pinned so nobody reasons from the code's shape again.

**Known-bad state avoided.** An organization branded in the uncovered-shift hue; an accent that paints nothing for anybody because a class was interpolated; a colour control that answers a timezone refusal; a feature invisible at the read boundary with writes succeeding; a `<select>` displaying an accent the row does not hold; and an SPA promoted ahead of its migration failing the organization read on every signed-in screen rather than one.

## Design Notes

**Why a key in the database and a colour in the stylesheet.** Every colour in this application has measured contrast asserted at build time. A colour column would move that guarantee to runtime and put colour maths in `apps/web/src`, which today contains none — no `setProperty`, no OKLCH parsing, no ratio function. Storing which curated accent was chosen keeps the measurement where it already is, makes an unrenderable accent unrepresentable via the `check` constraint, and turns "is this accent readable" from a runtime question into a test.

**Why distinct token names rather than an attribute switch.** The obvious implementation — `[data-accent='…']` blocks reassigning one `--accent` token — collides with two existing assertions: `theme-tokens.test.ts:140` bans attribute hooks, and `:47` requires exactly one declaration per token per theme. Naming each accent's tokens distinctly satisfies both with no test-machinery surgery, and every accent then inherits the single-declaration, dual-theme, divergence and inline-mapping sweeps for free.

**Why the chrome may read the organization.** `chrome.tsx:210-218` flags an organization read as the line to revisit, on AD-13 grounds. AD-13 forbids two figures on a screen coming from two reads, not a second consumer of one key: `ORGANIZATION_SNAPSHOT_KEY` is a single constant over one shared `QueryClient`, so the chrome and `/organizacija` share one cache entry. Two reads under two keys would be the violation, and this is the opposite.

## Verification

**Commands:**
- `nvm use && node -v` — expected: `v24.19.0`. Confirm rather than assume.
- `supabase db reset` — expected: exit 0, `0006` applies, both fixtures load with `brand_accent` null. Then assert the constraint refuses a key outside the curated set.
- `pnpm build && pnpm lint && pnpm typecheck && pnpm test` — expected: all exit 0, no skips, counts above the 1064/714/4 baseline. Build precedes test.
- `git diff --stat apps/web/package.json package.json pnpm-lock.yaml` — expected: empty. No dependency is added.
- Mutation probes — each must fail the suite: point an accent token at `destructive`'s value; drop one accent from the SPA set while leaving it in the constraint; tint a shift fill with the accent; render the lockup in the sidebar only; return the neutral mark when a readable logo exists; drop the accent column from the admin grant.

## Suggested Review Order

**What the accent is allowed to be**

- Start here: four keys, closed, and the type every other module narrows to.
  [`accent.ts:50`](../../apps/web/src/organization/accent.ts#L50)

- An unknown key becomes neutral rather than throwing, because a row may outlive a build.
  [`accent.ts:204`](../../apps/web/src/organization/accent.ts#L204)

- Whole literals, never interpolated: Tailwind scans text, so a template emits no rule.
  [`accent.ts:162`](../../apps/web/src/organization/accent.ts#L162)

**Measured, which is the whole reason the palette is curated**

- Every accent held apart from every reserved signal, with the 45° arithmetic stated.
  [`theme-contrast.test.ts:34`](../../test/theme-contrast.test.ts#L34)

- One fallback, failing closed: the old `?? 0` made an achromatic colour red's own hue.
  [`theme-contrast.test.ts:132`](../../test/theme-contrast.test.ts#L132)

- The borders measured against what they are drawn on, at the non-text floor.
  [`theme-contrast.test.ts:192`](../../test/theme-contrast.test.ts#L192)

- And asserted in the BUILT sheet, because a measured token nothing emits paints nothing.
  [`theme-applied.test.ts:134`](../../test/theme-applied.test.ts#L134)

**The write, which had no executed test at all**

- A positive predicate and an exhaustive `never`: a fourth write shape stops compiling.
  [`snapshot.ts`](../../apps/web/src/organization/snapshot.ts)

- Clearing sends the key with a null value, not an omission PostgREST would drop.
  [`snapshot.test.ts`](../../apps/web/src/organization/snapshot.test.ts)

**The surfaces**

- One hook, so two surfaces no longer register two queryFns against one key.
  [`logo-url.ts:70`](../../apps/web/src/organization/logo-url.ts#L70)

- The lockup the chrome and the settings screen share, rather than a second copy.
  [`chrome.tsx:18`](../../apps/web/src/navigation/chrome.tsx#L18)

- The select remounts when the stored accent changes, so Cancel cannot misreport it.
  [`organizacija.tsx`](../../apps/web/src/routes/organizacija.tsx)

**Deployment**

- The SPA must not reach production ahead of its own column.
  [`DEPLOY.md:421`](../../DEPLOY.md#L421)
