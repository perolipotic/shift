# Sprint Change Proposal: the app takes direction G, "Staklo" (glass)

- **Date:** 2026-10-30
- **Author:** Developer (correct-course), for Perolipotic
- **Mode:** Batch, run non-interactively. Every question the workflow would ask the human is in §6, *Decisions for the product owner*, with a recommendation.
- **Scope classification:** Moderate. It adds a new epic and rewrites several DESIGN.md sections. There is no PRD or architecture change, unless decision D6 brings the week view into v1.
- **Status:** Proposed. It waits for the product owner's decisions D1–D10.

---

## 1. Issue Summary

**Trigger:** users told the product owner that the app looks old-fashioned and does not look like a modern SaaS product. The UX designer answered with seven visual directions for the *Kalendar* screen. The product owner picked **direction G, "Staklo"**, and asked for the effort and a plan.

**Category:** a new requirement from the stakeholder (perception and brand). It is not a defect. Nothing is broken, and no flow changes.

**Evidence:**

- **The feedback.** Users said it in their own words, as the product owner reports it. No measured defect stands behind it. Unlike the 2026-10-02 redesign, there are no screenshots of failures. For this reason the plan starts with a **pilot** that the product owner reviews on a phone with real data before the rest of the app moves (§3).
- **The direction.** Two mockups of G, at 1280 × 860 and 390 × 844:
  - `scratchpad/kalendar-templates/G-desktop.dc.html`
  - `scratchpad/kalendar-templates/G-mobitel.dc.html`

  They live in a session scratchpad, which does not last. Copy them into `ux-designs/ux-shift-2026-10-30-glass/` (handoff, §5).
- **What G is:**
  - frosted translucent panels: `rgba(255,255,255,.58)` with `backdrop-filter: blur(24px) saturate(160%)`, a 1 px white border at 80 % and a soft shadow `0 10px 40px rgba(30,40,70,.10)`;
  - a pale `#E8EDF5` page with three large blurred colour blobs (blue `#B9D3FF`, lilac `#E2CCFF`, mint `#C6F0E2`);
  - **Outfit** for all text, with radii from 14 to 30 px and Phosphor **fill** icons;
  - a floating glass sidebar on the desktop and a floating glass pill tab bar on the phone;
  - near-black `#111827` primary buttons, with `#2F55B8` for links, the selection and today;
  - shift cells kept on the slot ramp as near-opaque cards (light blue slot-1, deep indigo slot-2), and the conflict red `#D93A46` unchanged.

**What the mockups show that the app does not have.** These are the expectation risks. The product owner should know them before the pilot (§6):

1. **The desktop mockup is a week view, and the phone mockup is a day view** with a week strip. The app has a month view (a grid, plus *Moj raspored* as a day list on the phone). The PRD puts **weekly and daily Calendar views out of scope for v1**, and this was re-confirmed on 2026-10-10 (PRD §Out of Scope, line 536; deferred list, line 1017). The pilot puts G's look on the **month** view. The week and day views are a separate optional story (15.6), and they need a PRD change.
2. **The mockup copy is not binding.** It says "konflikt", "2 konflikta", "Konflikt u Smjeni C" and "Riješi". The UI has not said *konflikt* since story 9.1, and a hygiene test enforces it (UX-DR46). The words are *Odsutnost u smjeni*, *čeka odluku* and *Odluči*.
3. **The mockup changes the information architecture, and the redesign does not.** The mockup's sidebar order is Danas, Kalendar, Za odluku, Ljudi, Sati, Godišnji, Postavke. The binding order (UX-DR32) stays: Danas, Kalendar, Sati, Godišnji, Za odluku, Ljudi, Postavke rotacije, Organizacija.
4. **The mockup adds a red count badge on *Za odluku*.** The app has no navigation count today. The *Za odluku* count includes pending leave requests (UX-DR46), so a red badge would put `destructive` on something that is not an unresolved conflict, which UX-DR4 forbids (decision D7).
5. **The mockup drops the calendar legend and the leave and uncovered hatches.** Both stay (UX-DR8, UX-DR12).

## 2. Impact Analysis

### 2.1 Checklist status

| Item | Status | Finding |
|---|---|---|
| 1.1 Trigger | [x] | Not a story. User feedback, reported by the product owner. |
| 1.2 Problem | [x] | A new stakeholder requirement: the visual register reads as dated. |
| 1.3 Evidence | [!] | Qualitative only. The pilot (15.1) is the validation step. |
| 2.1 Current epic | [x] | Epic 10 can be completed as planned (§2.6). |
| 2.2 Epic-level change | [x] | A new **Epic 15**, in the style of Epic 7. |
| 2.3 Future epics | [x] | Epics 11–14 inherit the new look through the primitives. 11.3's `warning` token is measured against the new surfaces (§2.6). |
| 2.4 Obsoleted or new epics | [x] | None obsoleted. The week and day views are a candidate for after v1. |
| 2.5 Order | [x] | Epic 15 runs after 10.3 and in parallel with 10.4. It lands before 11.3. |
| 3.1 PRD | [x] | No change, unless D6 brings the week view into v1. NFR-22 (two-second month render) becomes a guard for the performance budget. |
| 3.2 Architecture | [N/A] | No AD names a font or an icon library. Two dependencies change (§2.4). |
| 3.3 UX docs | [!] | DESIGN.md: most sections. EXPERIENCE.md: four sections. UX-DR: 9 lines, plus a new UX-DR53 (§4). |
| 3.4 Other artifacts | [!] | Theme, typography and shell-pin tests (§2.5). CI, deploy and e2e need no change. There are no screenshot tests. |
| 4.1 Direct adjustment | Viable | A new epic of 5 stories, plus 1 optional. |
| 4.2 Rollback | Not viable | Nothing to revert. Every surface works. |
| 4.3 MVP review | Not needed | v1 scope holds. Only D6 would touch it. |
| 6.3 Approval | [!] | Pending (§6). |
| 6.4 sprint-status | [!] | Apply when approved (§4.6). |

### 2.2 Epic impact

- **New Epic 15, "The app looks current, and still reads at a glance".** It has five stories and an optional sixth (§4.1). It reworks the surfaces of every shipped epic. It changes no behaviour, no data and no copy, and it rolls back no completed story.
- **Epic 10.** 10.3 adds *Obavijesti* to *Više* and a settings surface. 10.4 adds the push toggle. Both are built from primitives, so both inherit the new look. Overlap and order are in §2.6.
- **Epics 11–14.**
  - New screens keep the rule that screens compose primitives and never restyle them, so they come out in glass without extra work.
  - **11.3** adds a `warning` token and a fifth glyph. Both should be measured against the final palette, so Epic 15 lands before 11.3, and the glyph is a Phosphor icon.
  - **13.2** changes a legend word.
  - **14.2** adds a table. All of this follows from the primitives.

### 2.3 UX docs (DESIGN.md, EXPERIENCE.md, the UX-DR list)

The sections that change, and how. The edits are applied by the story that ships them (§4.3):

| Doc / section | Change |
|---|---|
| DESIGN.md front matter | `primary` and the light/dark `primary` pair re-tuned (D3). `base-palette` rewritten: the page, card and popover become glass-aware, and the navy `sidebar-*` set becomes a glass set. A new `glass:` block (page, blobs, chrome and reading alphas, blur, saturate, border, shadow) in both themes. `elevation` re-specified. `typography` rewritten (D1). `rounded` widened (14–30 px). `components` amended (Button, Card, Dialog, Popover, Shell). The slot ramp, `destructive` and the modifiers stay, if D4 is accepted. |
| Brand & Style | The premise **"quiet competence" stays**: the product must be trusted with a schedule, and nothing about it should try to be liked. The register sentence changes: *"slate surfaces, a navy sidebar, one blue primary"* becomes *"light glass chrome over a pale page, ink actions, one blue for selection, and a single red held in reserve"*. The style reference moves from shiftapp-v2 to the G mockups. The two layers (tokens, then primitives) stay unchanged. |
| Colors | The register paragraph is rewritten. *The reserved hue* stays word for word. *Organization branding*: the accent tints the lockup tile and a 2 px edge on the glass sidebar and on the tab bar. The accent window was tuned for the navy sidebar (3:1 on navy and on white), so it is re-measured against glass (D5). *The working-shift ramp* and *the dark ramp* stay (D4). |
| Typography | Rewritten for Outfit (D1). The two requirements, Latin Extended-A and tabular figures, stay word for word. |
| Layout & Spacing | The page skeleton stays (`max-w-5xl`, `PageHeader` first). New text: the floating sidebar and tab bar sit inset from the viewport edge (16–20 px). The phone page reserves the tab bar's height plus the safe-area inset at its bottom, so the last row is never hidden under the bar. |
| Elevation & Depth | Rewritten into **Elevation, glass and depth**. The glass rules in §4.4 go here. |
| Shapes | The new radii. Cells in the month grid keep a small radius (≤ 10 px), so a dense grid still reads as a grid and not as a field of pills. The larger radii are for chrome, cards and the agenda cards in the optional day view. |
| Components | Button (default becomes ink), Card, Dialog (glass panel, a tinted `::backdrop` with no blur), Popover, Shell (glass sidebar and pill bar, where the active item keeps a non-colour cue), Notice and consequence-strip (each names a lucide icon, which becomes Phosphor), Timeline (its `dark` tone is "the navy sidebar pair" and needs its own token), month toolbar, filter chip, filter sheet. |
| Do's and Don'ts | Add the glass do's and don'ts (§4.4). "Don't introduce a motion token" stays. Glass needs no motion. |
| EXPERIENCE.md | §Foundation (the UI system names the style reference), §Responsive & Platform (floating bar, safe area), §Accessibility Floor (reduced transparency, forced colours, worst-case backdrop), §Component Patterns (icon names). §IA and §Key Flows are unchanged. |
| UX-DR (`epics.md`) | UX-DR1 (the token count), UX-DR3 (glass alphas stay OKLCH with alpha), UX-DR5 (where the accent tints), UX-DR11 (lucide `CircleDashed`), UX-DR26 (mockup controls under 44 px are raised), UX-DR40 (typography), UX-DR45 (the WifiOff icon), and UX-DR31/32 (the shell form, not the IA). New: **UX-DR53**, glass. UX-DR2, 4, 6, 7, 8, 12 and 37 are unchanged and are listed in §2.7 as hard rules. |

### 2.4 Technical impact

**Fonts.** *DM Sans + Syne + Shift Figures* becomes **Outfit**, so one variable face replaces two variable faces and five derived figure files.

- **Package.** `@fontsource-variable/outfit` 5.3.0, OFL-1.1, self-hosted. It has two subsets, latin (32 KB woff2) and latin-ext (15 KB), and a variable `wght` axis from 100 to 900.
- **Croatian.** Measured on the package's own files: the latin-ext subset carries all ten letters, **č ć ž š đ Č Ć Ž Đ Š**. `test/typography-coverage.test.ts` runs the same check when the import lands.
- **Tabular figures.** Measured: Outfit has a real `tnum` feature in its GSUB. Under `tnum`, all ten digits have the same advance of **590 units at 400, 500, 600 and 700**. Its default digits are proportional (`1` is 321 units, `0` is 659).
  - So the reason Shift Figures exists, "DM Sans ships no `tnum`", no longer applies.
  - **Recommendation (D1):** retire Shift Figures and `scripts/fonts/build-figures.py`. Set `font-variant-numeric: tabular-nums` once on `html` in `@layer base`. The rule "every digit is tabular" then holds by construction, as it does today, and one advance across weights still aligns a mixed-weight column.
  - Verify one thing in the pilot: the `1`/`7`/`l` shapes at 12 px in the compressed grid, because Syne's "17 reads as ı7" was the origin of story 7.2.
- **Weights.** The app uses 400–800 today, and `PageTitle` is extrabold. G uses 400–700. Map 800 to 700.

**Icons.** lucide-react 1.39.0 becomes `@phosphor-icons/react` 2.1.10 (MIT, `sideEffects: false`, one ES module per icon, tree-shakeable).

- **Scope.** lucide is imported in **66 files**, as **53 distinct icons**. A mapping table covers every one of them, for example `TriangleAlert` → `Warning`, `CircleDashed` → `CircleDashed`, `Clock3` → `Clock`, `WifiOff` → `WifiSlash`, `GripVertical` → `DotsSixVertical`, and `ChevronLeft`/`ChevronRight` → `CaretLeft`/`CaretRight`.
- **The weights catch.** Phosphor offers six weights (thin, light, regular, bold, fill, duotone), but **each icon module carries all six**, because the weight is a prop resolved at runtime from a `Map` of six SVG trees. Measured on the package for the 56 icons the app and G need:
  - all six weights: **≈ 33 KB gzip** (170 KB raw);
  - the `fill` weight alone: **≈ 5 KB gzip**.
- **Recommendation (D2).** One local module, `components/ui/icon.tsx`, is the only place that imports an icon library. Screens name icons through it. The pilot measures the main chunk. If the six-weight cost is over 15 KB gzip on top of today's lucide cost, the module switches to fill-only SVGs generated from `@phosphor-icons/core`, with no screen changing. The facade also makes the library swap a single line next time.
- **The leave and uncovered marks.** Story 5.3c drew them as lucide `Clock` and `CircleDashed`, and `typography-coverage.test.ts` (line 370) and `features/calendar/utils/modifiers.test.ts` pin those imports. The pins move to the Phosphor names. The marks must stay told apart by shape, not only by fill.

**The navy register.** `--sidebar` and its seven companions are navy in both themes today, and four things depend on them:

- `test/theme-contrast.test.ts` measures the sidebar pairs, the sidebar ring and the accent window against navy;
- the Dialog `::backdrop` is sidebar-tinted;
- the Timeline's `dark` tone is "the navy sidebar pair";
- `chrome.tsx` (1,157 lines) spells `bg-sidebar` and `border-sidebar-border` in nine places.

All of them change in 15.1 (shell) and 15.2 (Dialog, Timeline).

**No change:** the data, domain, Supabase, RLS, routes, i18n keys and copy, the PWA manifest (its theme colour may follow the page), CI and deploy.

### 2.5 Tests

| Test | Lines | Churn | Why |
|---|---|---|---|
| `test/theme-fidelity.test.ts` | 229 | High | It round-trips DESIGN.md's front matter against `index.css`. The new `glass:` block, the rewritten `base-palette` and `primary` all move in step. |
| `test/theme-contrast.test.ts` | 1,082 | High | The sidebar pairs, the sidebar ring and the accent window are re-measured against glass. New pairs are measured **against the worst-case backdrop** (§4.4), reusing its `composite()` helper (line 135). The slot pairs stay, if D4 is accepted. |
| `test/theme-tokens.test.ts` | 346 | Medium | One declaration per token per theme, for the new tokens. |
| `test/theme-applied.test.ts` | 204 | Medium | `@layer base` now paints the page backdrop and `tabular-nums`. |
| `test/typography-coverage.test.ts` | 377 | High | `FACES` becomes one Outfit entry. The Shift Figures weight coverage is removed or replaced by a `tnum` assertion. The lucide import pin (line 373) changes. |
| `pages/structural-pins-shell.test.ts` | 1,105 | High | The chrome, the 56 px phone cell, the sheet and the sidebar treatment. |
| `pages/structural-pins-{controls,members,settings}.test.ts` | 3,206 | Low–medium | Only where a pin names a class the primitives change. |
| `features/calendar/utils/modifiers.test.ts`, `test/localization-applied.test.ts` | — | Low | The lucide import and the `icons.ts` comment. |
| e2e (Playwright) | — | Low | Selectors are role- and name-based, and there are no screenshot assertions. The tab bar's position changes, so a phone test that taps the last row may need a scroll. |

### 2.6 Running in parallel with Epic 10 and Epics 11–14

- **10.3 (Više → Obavijesti)** and **10.4 (web push).** Both touch `chrome.tsx` (the *Više* sheet's rows) and add the `/obavijesti` surface. Epic 15 touches `chrome.tsx` in 15.1 (sidebar and tab bar) and the sheet's look in 15.2.
  - **Recommendation:** merge 10.3 first. It is one small settings surface, still in backlog with no spec. 15.1 starts from that `main`. 10.4 is mostly the service worker, `notify` and the subscription table, and its UI is one toggle on `/obavijesti`. It runs in parallel with 15.1 and 15.2, merges `origin/main` when either lands, and inherits the look from the primitives.
  - Conflicts are expected in `chrome.tsx` and `structural-pins-shell.test.ts` only. Neither side may restyle the other's part.
- **Epic 11** starts after 15.2. 11.3's `warning` token and short-staffed glyph are measured against the new surfaces and drawn as a Phosphor icon.
- **Epics 12–14** can run at any point. New screens use primitives only, a rule that is already in force.
- **Parallel sessions share the checkout and the stack.** Epic 15 touches no migration, so it cannot collide on migration numbers. It does hold `index.css`, `components/ui/*` and `chrome.tsx` for its duration. Two sessions must not hold those files at once.

### 2.7 Hard rules that stay, word for word

1. **The conflict red is reserved.** `destructive` `#D93A46` (dark `#E85B66`) marks only an unresolved conflict. It is never a badge on a mixed count (D7), never a delete button and never an accent.
2. **No colour is the sole carrier of meaning** (UX-DR37). Every shift state keeps its glyph and its fill or ring. The active navigation item keeps a non-colour cue (semibold plus an underline or indicator, and `aria-current`) on the glass pill as well.
3. **Colour goes by slot, never by shift-type name** (UX-DR6). No sun or moon icon for *Dan* or *Noć*, no `shift-day`/`shift-night` token, and no icon that encodes a type. The label is the type's own name, which is data.
4. **Tabular figures** wherever numbers align (UX-DR40). With Outfit this means `tnum` everywhere (D1).
5. **Latin Extended-A coverage** for every face, measured before it lands.
6. **44 px targets** (UX-DR26). The mockup's 42 px desktop nav rows, 42 px ‹ › buttons and ~33 px view switch are raised to 44.
7. **Both themes** (UX-DR2), with every token defined in both. G was drawn light only, so the dark glass values in §4.4 are this proposal's own and are measured in 15.5.
8. **Screens compose primitives and never restyle them.** Glass is a primitive treatment, never a screen class string.

## 3. Recommended Approach

**Direct adjustment, with a pilot gate:** a new Epic 15. Its first story is a pilot that the product owner accepts on a phone before any other screen moves.

1. **15.1 Pilot.** The tokens in both themes, Outfit, the page backdrop, glass on the shell (desktop sidebar and phone pill bar), *Kalendar*'s month view in full, and the icon swap. The PR stays **open and unmerged** until the product owner has used it on their own phone with the demo organization's real data (D8). If the decision is no-go, Epic 15 stops at the cost of about two sessions, and nothing on `main` changed.
2. **15.2 Primitives and layered surfaces.** Each primitive is restyled once in `components/ui`, so every screen moves at the same time.
3. **15.3 Member surfaces** and **15.4 Admin surfaces.** Fixes at screen level only where composition, not a primitive, is wrong.
4. **15.5 Dark glass, contrast, fallbacks and performance.** The closing sweep.
5. **15.6 (optional, outside v1 unless D6):** the week view on the desktop and the day view on the phone.

**Rationale:**

- The pilot buys the product owner real glass on real data at about a third of the cost. It covers the screen the feedback was about, and it carries the risks that could sink the direction: contrast over moving content, and blur performance on a low-end Android.
- Doing primitives before screens is the lesson of Epic 7. A primitive changes every screen at once, so 15.3 and 15.4 are mostly checking, not rewriting.
- **Alternatives rejected:**
  - *Restyle everything in one PR.* This is how visual refresh A worked: #30, 59 files, +8,278 lines, in one PR. It gives no gate, and a no-go would cost it all.
  - *Keep the navy and add glass only to dialogs.* It does not answer the feedback.

### Effort

**Evidence:**

- Visual refresh A (2026-09-25, #30) restyled the design system, shell, sign-in and content screens in one PR: 59 files, +8,278 / −651.
- Epic 7's foundations 7.1–7.4 were four PRs merged on one day (2026-10-06), at +584 to +1,400 lines each.
- All 21 Epic 7 stories merged between 2026-10-06 and 2026-10-10.
- The surface today: 23 primitives, about 181 non-test `.tsx` files across 13 features, 66 files importing lucide, and about 6,800 lines of theme, typography and structural-pin tests.

| Story | Size | Agent sessions | Notes |
|---|---|---|---|
| 15.1 Pilot | L | 2 | The largest test churn: fidelity, contrast, tokens, typography and the shell pins. The icon swap is mechanical through the facade. |
| 15.2 Primitives and layered surfaces | M | 1 | 23 primitives, Dialog/Popover/sheets, the Timeline token. |
| 15.3 Member surfaces | M | 1 | Sign-in, Danas (both roles), Sati, Godišnji and the request form, the Ljudi directory, error pages. |
| 15.4 Admin surfaces | M | 1 | Za odluku and both decision screens, Ljudi and the member page, day detail, rotation builder, Organizacija, hour bands, teams. |
| 15.5 Dark, contrast, fallbacks, performance | M | 1 | Includes the measurement on a low-end Android and the docs close-out. |
| **Core total** | | **6** (5 if 15.3 and 15.4 fold into one) | |
| 15.6 Week and day views (optional) | L | 1.5–2 | New functionality. Needs a PRD edit (D6). |

**Correction to the earlier figure.** "4–6 agent sessions, 1–2 calendar weeks" is a little optimistic.

- A realistic range is **5–7 sessions** for the core, with the review and fix rounds Epic 7 needed.
- That is **about 2 calendar weeks** when interleaved with 10.4. The pilot alone takes 2–3 days, including the product owner's review pause.
- Four sessions is reachable only if 15.3 and 15.4 fold together and the dark values hold at the first measurement.
- The week and day views are **not** in this figure.

### Risks

| Risk | Likelihood | Evidence | Mitigation |
|---|---|---|---|
| Text on glass fails contrast when content scrolls under it | **High as drawn** | Measured for the mockup's `.58` glass. Over the page and the blobs, muted `#5B6478` reads 5.0–5.5:1. Over a slot-2 cell scrolling under the phone tab bar, it drops to **2.50:1**, and link blue to **2.85:1**. At `.72` the nav text `#3C465C` reads 5.46:1. At `.85` the muted text reads 4.51:1. | Two glass alphas plus the worst-case rule (§4.4). Measured in `theme-contrast` against the darkest content that can sit under the chrome. |
| The mockup's indigo slot-2 weakens the conflict ring | High, if adopted | `#D93A46` on today's slot-2 `#1B2735` is 3.35:1. On the mockup's indigo it is **2.19:1**. The overridden ring drops from 3.41:1 to 2.87:1. | Keep the shipped ramp (D4). |
| Blur costs frames on a low-end Android | Medium | `backdrop-filter` recomposites on every scroll frame under the blurred layer. The mockup's blobs also use `filter: blur(70px)` on 500 px elements. | The performance budget (§4.4). The blobs become static radial gradients. Measured in 15.5 against NFR-22. |
| Bundle weight from Phosphor | Medium | ≈ 33 KB gzip for six weights against ≈ 5 KB for fill only (measured). | The icon facade and a measured switch (D2). |
| Merge conflicts with parallel sessions | Medium | `chrome.tsx`, `index.css` and the shell pins are hot files. | The order in §2.6. Merge `origin/main`, never rebase. |
| Expectation gap: "the mockup was a week view" | Medium | §1. | Say it before the pilot (D6). |
| The look dates quickly | Low–medium | Glass is a current trend. | Glass is a set of tokens: one token switch turns it solid, by the same path as the fallback. |

## 4. Detailed Change Proposals

### 4.1 `epics.md`: new Epic 15

**Epic List entry:**

> ### Epic 15: The app looks current, and still reads at a glance (added 2026-10-30, sprint change)
>
> Users said the app looks old-fashioned. Every screen takes direction G, "Staklo": light glass chrome over a pale page, Outfit, Phosphor icons and ink actions, in both themes. A pilot user still finds each answer in one glance, and nothing a conflict, a slot or a number says has changed.
>
> **Capabilities covered:** none. It reworks the surfaces of every shipped epic.
> **Standalone:** every story restyles a surface that already works. No behaviour, data or copy changes.
> **Implementation notes:** the source is `sprint-change-proposal-2026-10-30-glass-redesign.md` and the G mockups in `ux-designs/ux-shift-2026-10-30-glass/`. 15.1 is a pilot, held unmerged until the product owner accepts it on a phone. Each story updates the DESIGN.md, EXPERIENCE.md and UX-DR lines it changes in the same PR.

**Stories:**

| Id | Story | Depends on |
|---|---|---|
| 15.1 | Pilot: *Kalendar* and the shell in glass, on real data, on a phone | 10.3 merged (§2.6) |
| 15.2 | Every primitive and layered surface in glass, restyled once | 15.1 accepted |
| 15.3 | Member surfaces read in glass: sign-in, Danas, Sati, Godišnji, Ljudi, error pages | 15.2 |
| 15.4 | Admin surfaces read in glass: Za odluku, decisions, member page, day detail, rotation, Organizacija | 15.2 |
| 15.5 | Glass holds in the dark theme, without blur support, and on a low-end phone | 15.3, 15.4 |
| 15.6 | *(optional, outside v1 unless D6)* A week view on the desktop and a day view on the phone | 15.1, PRD edit |

**Story 15.1: Pilot: *Kalendar* and the shell in glass, on real data, on a phone**

As the product owner,
I want to use *Kalendar* in direction G on my own phone with real data,
So that I decide on glass from the app and not from a mockup.

**Acceptance Criteria:**

- **Given** the tokens, **when** `index.css` is read, **then** the page backdrop, both glass alphas, the reading alpha, blur, saturate, border and shadow exist in **both** themes. The page backdrop is `#E8EDF5` with three static radial-gradient blobs, never a `filter: blur()`. `primary`, the ink button pair and the radii follow D3, and every value round-trips with DESIGN.md (`theme-fidelity`).
- **Given** any text, **when** it renders, **then** it is Outfit (self-hosted, latin and latin-ext), every digit uses `tnum`, and DM Sans, Syne and Shift Figures are no longer shipped (D1, `typography-coverage`).
- **Given** a desktop, **when** any signed-in route renders, **then** the sidebar is a floating glass panel inset from the viewport edge. Its active row is a white pill **and** semibold **and** carries a non-colour indicator with `aria-current`. Every row is at least 44 px tall. The organization's accent tints only the lockup tile and the edge (D5).
- **Given** a phone, **when** any signed-in route renders, **then** the tab bar is a floating glass pill above the safe area, with four tabs plus *Više* (UX-DR31/32 unchanged). The page reserves its height, so the last row is reachable. Its text clears 4.5:1 against the darkest content that can scroll under it.
- **Given** *Kalendar* (month toolbar, filter chips and sheet, the grid in both modes, *Moj raspored*'s day list, legend, skeleton), **when** it renders in either theme, **then** it is in G. Cells are opaque slot fills with their label, ring and glyph unchanged (D4). The legend is present. The month grid's cells keep a radius of at most 10 px.
- **Given** any icon in the app, **when** it renders, **then** it comes from `components/ui/icon.tsx` and is a Phosphor `fill` glyph. No file imports `lucide-react`, and the leave and uncovered marks are still told apart by shape (D2).
- **Given** the built app, **when** the main chunk is measured against `main`, **then** the change in icons and fonts is recorded in the PR.
- **Given** the PR, **when** it is ready, **then** it is **not merged** until the product owner has opened `dvd-demo` on their phone and given go or no-go (D8).
- **Given** this story ships, **then** DESIGN.md (front matter, Brand & Style, Colors, Typography, Elevation, Shapes, Shell) and UX-DR40 are updated in the same PR.

**Story 15.2: Every primitive and layered surface in glass, restyled once.** Covers Button (`default` = ink, D3; `outline`, `ghost`, `sidebar` → `chrome`), Card (reading alpha), Input, Badge, Notice, Callout, IconTile, StatCard, StatTile, Table, StackedList, RadioCard and RadioRow, PageHeader, Dialog and ConfirmDialog (glass panel, tinted `::backdrop` with no blur), Popover, the docked sheets (*Više*, filter sheet), and Timeline (its own `dark` tone token, no longer the sidebar pair). No screen file changes, except where a pin moves. Updates DESIGN.md §Components and UX-DR11 and UX-DR45 (icon names).

**Story 15.3: Member surfaces read in glass.** Covers sign-in and set-password (auth layout on the backdrop), Danas (both roles, duty-block, admin cards with *Treba tebe*'s `destructive` edge unchanged), Sati and *Moji sati*, Godišnji and *Zatraži*, the Ljudi directory, `/obavijesti`, error, not-found and pending. Screen-level fixes only where composition is wrong. Updates EXPERIENCE.md §Responsive.

**Story 15.4: Admin surfaces read in glass.** Covers Za odluku (tabs, rows), the resolution and request decision screens (resolution-option, consequence-strip), Ljudi and the member page with its dialogs, the day detail and its change dialogs, the rotation builder and its sticky save bar, Organizacija, hour bands and teams.

**Story 15.5: Glass holds in the dark theme, without blur support, and on a low-end phone.**

- The dark glass values are tuned and pinned.
- `theme-contrast` measures every text and boundary pair on glass against the worst-case backdrop in both themes.
- `@supports not (backdrop-filter)`, `prefers-reduced-transparency: reduce` and `forced-colors: active` each render solid, which a test pins.
- The performance budget (§4.4) is measured on a low-end Android, and the trace is linked from the PR. NFR-22 still holds.
- EXPERIENCE.md §Accessibility Floor and the new UX-DR53 are written.

**Story 15.6 (optional): A week view on the desktop and a day view on the phone.** This is new functionality: a Dan/Tjedan/Mjesec switch, a seven-column week of shift cards, and a phone day agenda with a week strip, per-team coverage (`4 od 5`) and avatars. It needs the PRD's out-of-scope line amended and a new FR, so it is not part of the redesign.

### 4.2 UX-DR edits (`epics.md`)

- **UX-DR40.**
  - **OLD:** "every digit is a DM Sans tabular figure (Shift Figures, derived from DM Sans and leading both font stacks), never Syne"
  - **NEW:** "every digit is an Outfit tabular figure (`tnum`, set once on the document; all ten digits one advance at every weight in use)"
  - Rationale: D1. The measured `tnum` makes the derived face redundant.
- **UX-DR1.** "the 48-token colour layer" gains the glass set. The count is restated by 15.1.
- **UX-DR5.**
  - **OLD:** "may tint the application shell and logo lockup only"
  - **NEW:** "may tint the lockup tile and a 2 px edge on the glass sidebar and tab bar only"
- **UX-DR11.** "lucide `CircleDashed`" → "Phosphor `CircleDashed`".
- **UX-DR45.** "a WifiOff icon" → "a `WifiSlash` icon".
- **UX-DR26.** Add: "Mockup controls drawn under 44 px (the G sidebar rows, the ‹ › buttons, the view switch) are built at 44."
- **New UX-DR53, Glass.** The rules in §4.4, in one paragraph, written by 15.5.

### 4.3 UX docs: change → section, applied by the story that ships it

| Change | DESIGN.md | EXPERIENCE.md | UX-DR | Story |
|---|---|---|---|---|
| Tokens, backdrop, glass alphas | front matter, §Colors, §Elevation | — | 1, 3 | 15.1 |
| Outfit, `tnum` | front matter, §Typography | — | 40 | 15.1 |
| Glass shell, accent edge | §Brand & Style, §Colors (branding), §Components (Shell), §Layout | §Responsive | 5, 31/32 (form only) | 15.1 |
| Icons | §Components (Notice, consequence-strip) | §Component Patterns | 11, 45 | 15.1, 15.2 |
| Ink button, primitives, Dialog, Popover, Timeline | §Components, §Shapes | — | 26 | 15.2 |
| Dark glass, fallbacks, worst case, performance | §Elevation, §Do's and Don'ts | §Accessibility Floor | 53 (new) | 15.5 |
| Week and day views | — | §IA, §Responsive | 18, 41 | 15.6 |

### 4.4 Proposed glass rules (for DESIGN.md §Elevation, glass and depth; final values pinned by 15.1 and 15.5)

1. **Glass is for floating chrome only:** the desktop sidebar, the phone tab bar, the phone's sticky month-toolbar head, a header bar where one floats, and Dialog, ConfirmDialog, Popover and the docked sheets. Nothing else is glass.
2. **Reading surfaces are at least 85 % opaque.** These are tables, stacked lists, the calendar grid and its panel, forms, cards that carry data, the resolution options and the consequence strip. They carry no `backdrop-filter`. Shift cells are **fully opaque** slot fills, so the ramp's measured pairs stay true.
3. **Two glass alphas.**
   - `glass` (light `.58`) is for chrome that sits **beside** content and never over it, such as the desktop sidebar.
   - `glass-over-content` (light **at least .72**) is for chrome that content scrolls **under**, such as the phone tab bar and the sticky head. Text on it is `foreground`-strength, never `muted-foreground`.
   - Muted text appears only on surfaces of at least .85. Measured: at .72, nav text reads 5.46:1 over a slot-2 cell; at .58 it reads 3.99:1.
4. **Contrast is measured against the worst-case backdrop.** For each glass pair, `theme-contrast` composites the glass over (a) the page, (b) each blob at full strength and (c) for `glass-over-content`, the darkest fill that can scroll under it (light: slot-2; dark: the lightest slot). It holds text to 4.5:1 and boundaries and icons to 3:1 against the worst of the three. Blur is ignored, because it only averages toward the measured colours.
5. **Fallbacks render solid.** Under `@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))` and under `@media (prefers-reduced-transparency: reduce)`, every glass token resolves to its opaque card colour. Under `forced-colors: active`, glass resolves to `Canvas` with a `CanvasText` border. `-webkit-backdrop-filter` is always emitted beside the standard property.
6. **Dark theme values** (proposed, measured in 15.5):

   | Token | Value |
   |---|---|
   | page | `#0A1020` |
   | blobs | `#1D3A7A`, `#3B2466`, `#0E4A3C` at about 45 % |
   | `glass` | `rgba(15,23,42,.58)`, blur 24 px, saturate 140 % |
   | `glass-over-content` | at least `rgba(15,23,42,.80)` |
   | border | `rgba(255,255,255,.10)` |
   | shadow | `0 10px 40px rgba(0,0,0,.45)` |
   | reading surface | `rgba(19,32,53,.92)`, today's navy-2 card at 92 % |
   | ink button | `#F1F5F9` fill with `#0B1220` text |

   Dark slots, `destructive` and the modifiers are unchanged.
7. **Performance budget:**
   - `backdrop-filter` only on the fixed layers in rule 1, and **never** on an element inside a scrolling list or grid, a card, a row or a cell.
   - At most **three** blurred layers on screen at once on a phone: tab bar, sticky head and one open panel.
   - Blur radius at most 24 px.
   - The page blobs are static radial gradients on a fixed, non-animated layer, with no `filter: blur()`.
   - No blur on a Dialog `::backdrop`, which is a full-screen layer.
   - Measured in 15.5 on a low-end Android in Chrome, with a Performance trace of scrolling *Kalendar* (admin, all teams) across two months: no long frame over 50 ms attributable to paint or composite, and NFR-22's two-second month render still holds. If the budget fails, glass turns solid on that class of device by the same token path as rule 5.
8. **Don'ts:**
   - Don't put glass on a reading surface, a cell or a row.
   - Don't measure glass contrast against the page alone.
   - Don't animate the blobs.
   - Don't use glass as a state signal. Selection, conflict and override keep their own cues.

### 4.5 PRD and architecture

- **PRD.** No change. If D6 brings 15.6 into v1, edit line 536 ("weekly and daily views" out of scope), edit the deferred list at line 1017, and add a Calendar-views FR before 15.6 starts.
- **Architecture.** No AD changes. The dependency swap (lucide-react → `@phosphor-icons/react`; `@fontsource-variable/dm-sans` and `syne` → `outfit`) is recorded in the 15.1 PR. `scripts/fonts/build-figures.py` and the five `shift-figures-*.woff2` files are removed with their OFL notice, if D1 is accepted.

### 4.6 `sprint-status.yaml` (on approval)

```yaml
  epic-15: backlog
  15-1-pilot-kalendar-and-the-shell-in-glass: backlog
  15-2-every-primitive-and-layered-surface-in-glass: backlog
  15-3-member-surfaces-read-in-glass: backlog
  15-4-admin-surfaces-read-in-glass: backlog
  15-5-glass-holds-in-dark-without-blur-and-on-a-low-end-phone: backlog
  15-6-week-view-and-day-view: backlog   # optional; only if D6 brings it into v1
  epic-15-retrospective: optional
```

## 5. Implementation Handoff

- **Scope:** Moderate. It needs backlog reorganization, and it changes no PRD or architecture.
- **Product owner (now):** answer D1–D10, then approve or revise.
- **Product owner / Developer (on approval):**
  - copy the G mockups from the session scratchpad to `ux-designs/ux-shift-2026-10-30-glass/`;
  - apply §4.1 and §4.2's Epic List entry and story list to `epics.md`, leaving the UX-DR text to the stories that ship it;
  - apply §4.6 to `sprint-status.yaml`.
- **Developer (`bmad-build`), per story:**
  - implement each story;
  - update the DESIGN.md, EXPERIENCE.md and UX-DR lines from §4.3 in the same PR;
  - hold 15.1 open for the product owner's phone review (D8).
- **Order:** 10.3 → 15.1 (pilot gate) → 15.2 → 15.3 and 15.4 (in either order or folded) → 15.5 → Epic 11. 10.4 runs in parallel with 15.1–15.2. 15.6 runs only if D6 says so.

**Success criteria:**

- the product owner gives go on the pilot from their own phone;
- every screen renders in G in both themes, and no file imports lucide, DM Sans or Syne;
- every glass text pair clears 4.5:1, and every boundary and icon clears 3:1, against the worst-case backdrop in `theme-contrast`;
- the solid fallbacks render under no blur support, reduced transparency and forced colours;
- the low-end Android trace meets the budget, and NFR-22 still holds;
- the conflict ring, the slot ramp, the glyphs and the legend read exactly as before.

## 6. Decisions for the product owner

1. **D1 Font.** Should Outfit replace DM Sans, Syne and Shift Figures, with `tnum` set once for every digit? **Recommendation: yes.** Outfit's latin-ext covers all ten Croatian letters, and its `tnum` gives every digit the same advance (590) at every weight in use, both measured. The derived figure face and its build script then go. The pilot checks `1`/`7` legibility at 12 px.
2. **D2 Icons.** Should the app use Phosphor `fill` everywhere, through one local `Icon` facade? **Recommendation: yes, fill everywhere,** as G draws it. Use `@phosphor-icons/react` first. If the measured chunk grows by more than 15 KB gzip, switch the facade to fill-only SVGs from `@phosphor-icons/core`: about 33 KB against about 5 KB gzip for the 56 icons, measured.
3. **D3 Primary.** Should the default button become ink (`#111827`, inverted in dark), with blue kept for selection, today, links, progress and the focus ring and re-tuned to G's `#2F55B8`? **Recommendation: yes.** `#2F55B8` reads 6.75:1 on white, against 5.17:1 for `#2563EB`, and white on ink reads 17.7:1.
4. **D4 Slot ramp.** Should the shipped ramp stay, as opaque cells, rather than the mockup's indigo slot-2? **Recommendation: keep the shipped ramp.** On the mockup's indigo, the conflict ring drops from 3.35:1 to 2.19:1 and the overridden ring from 3.41:1 to 2.87:1. Adopting it would reopen story 7.1's dark ramp as well.
5. **D5 Navy register and accent.** Should the navy sidebar be retired, keeping "quiet competence" as the brand premise, with the organization's accent tinting only the lockup tile and a 2 px glass edge? **Recommendation: yes.** The accent window is re-measured against glass in 15.1. The four accents likely stay, because a light glass sidebar is an easier surface than navy for an accent at L 0.53–0.56.
6. **D6 Week and day views.** The mockups' desktop is a week view and their phone a day view. Both are out of v1 by the PRD (re-confirmed 2026-10-10). **Recommendation: keep them out of Epic 15.** Pilot the look on the month view, and list 15.6 for after v1. If you want them in v1, that is a PRD edit plus 1.5–2 sessions.
7. **D7 Navigation count badge.** The mockup puts a red count on *Za odluku*. **Recommendation: no red badge.** The count includes leave requests, so red would break UX-DR4. If a count is wanted, it is a neutral `Badge` with the same number as the queue, and that is a small separate decision, not part of the redesign.
8. **D8 How the pilot is reviewed.** Deploys are off until `DEPLOY_ENABLED`. **Recommendation:** run the pilot branch with the local demo stack, with Vite bound to the LAN address, and open `dvd-demo` on your own phone. The PR stays unmerged until you give go or no-go.
9. **D9 Order against Epic 10 and 11.** **Recommendation:** 10.3 first, then Epic 15, with 10.4 in parallel and Epic 11 after 15.2. This way 11.3's `warning` token and short-staffed glyph are designed once, on the final surfaces.
10. **D10 Mockup copy and IA.** **Recommendation:** none of the mockup's words or navigation order is adopted. The UI keeps *Odsutnost u smjeni*, *čeka odluku*, *Odluči* and the binding destination order (UX-DR32, UX-DR46). The legend and the leave and uncovered hatches stay.
