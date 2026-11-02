---
title: 'Member surfaces read in glass (15.3)'
type: 'feature'
created: '2026-11-02'
status: 'done'
baseline_commit: '6ea38cf4c86417dbf88392beed7f7c063c5843ee'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-15-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sign-in still shows the navy, blurred-glow brand panel of visual refresh A. That panel is the last consumer of the `--sidebar*` set that 15.2 left for 15.3 to retire (deferred-work, 15.2 planning). On *Danas* (member), the hours and leave `StatTile`s sit bare on the page backdrop, although StatTile is designed to sit inside a card. Every other member screen (Danas admin, Sati, Godišnji, *Zatraži*, Ljudi, `/obavijesti`, error, not-found, pending) already composes opaque Cards on the backdrop, the *Kalendar* pattern.

**Approach:** Make the sign-in brand panel a floating `glass-chrome` panel, inset like the sidebar, with foreground text and an ink tile, and no glows. Then delete the eight `--sidebar*` tokens and everything that pins them. Put *Danas*'s two tiles in one Card. Pin that no screen uses a CSS `blur-*` filter. Update EXPERIENCE.md §Responsive and DESIGN.md's register.

## Boundaries & Constraints

**Always:**
- No change to behaviour, routes, copy, i18n keys or data.
- Glass only through the `@utility glass-*` utilities. The number of `backdrop-filter` utilities in `index.css` stays at 3.
- Text on the glass panel is foreground-strength (DESIGN rule 2).
- *Treba tebe*'s `waiting && 'border-l-4 border-l-destructive'` stays byte-identical.
- Token values change together with DESIGN.md front matter (`theme-fidelity`).

**Ask First:**
- Any restyle of a `components/ui/*` primitive.
- Any other member screen whose composition turns out to be wrong during manual checks.

**Never:**
- The 15.7 filter bar, admin screens (15.4), and dark or fallback tuning (15.5).
- A new glass utility, or `backdrop-blur` or `blur-*` in a `.tsx` file.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Sign-in, desktop | `/prijava/<slug>` at ≥ 1024 px, either theme | Glass brand panel inset 16 px over the blobs, ink tile, foreground text; form Card beside it | N/A |
| Sign-in, phone | < 1024 px | Form only, unchanged | N/A |
| Reduced transparency or forced colours | either emulated | The panel follows `glass-chrome`'s existing fallbacks (opaque card, or `Canvas` + `CanvasText`) | N/A |
| Danas member, tiles loading, unavailable or loaded | each tile state | Both tiles inside one Card; links still go to `/sati` and `/godisnji` | N/A |

</frozen-after-approval>

## Code Map

- `apps/web/src/components/layout/auth-layout.tsx:22-46` -- the navy panel and two `blur-3xl` glows; the only `--sidebar*` consumer. Copy the shape from `features/navigation/components/chrome.tsx:1093` (`glass-chrome … rounded-3xl … sm:my-4 sm:ml-4`). Use the ink pair from `button.tsx:36`.
- `apps/web/src/features/today/components/today-body.tsx:84-87` -- the tiles' `div.grid`. `ui/stat-tile.tsx:16` says "INSIDE a card".
- `apps/web/src/index.css` -- `--sidebar*` light :282-289, dark :376-383, `@theme` :459-466, header comments :54-59 and :106-108.
- DESIGN.md -- front matter counts :8-14, `base-palette` :85-87, :111-118, :140-147; prose :259, :275. EXPERIENCE.md §Responsive :179-192. `epics.md` UX-DR1 if it names `sidebar-*`.
- Tests:
  - `test/theme-css.ts:72,95-102`
  - `test/theme-tokens.test.ts:66-67,118`
  - `test/theme-fidelity.test.ts:169-176,202`
  - `test/theme-contrast.test.ts`: `BASE_PAIRS` :84; `SIDEBAR_PAIRS` :245-288; ring :383; the `sidebar-ring` DEVIATIONS :460,476,488; `band-dark` equal to the raw `sidebar` :1454-1455, rewritten to literals first.
  - `apps/web/src/pages/structural-pins-shell.test.ts:698-723` (the 3 blur utilities) and :764-783 (`--sidebar*` offenders → `[]`)
  - `source-guards.fixture.ts:648,1180` and `key-sources.fixture.ts:137` (auth layout counts)
  - `pages/literal-sweep.test.ts:223`
- `_bmad-output/implementation-artifacts/deferred-work.md:1166,1187` -- the `--sidebar*` entries, both marked RESOLVED here.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/components/layout/auth-layout.tsx` -- Make the panel `glass-chrome`, `rounded-3xl`, inset `lg:my-4 lg:ml-4` at full height, with `text-foreground` throughout and the tile `bg-ink text-ink-foreground`. Delete both glows. Rewrite the doc comment. -- Moves the frame onto the backdrop.
- [x] `apps/web/src/features/today/components/today-body.tsx` -- Make the tiles' wrapper a `Card` (`grid grid-cols-2 gap-3 p-3`). -- StatTile is meant to sit inside a card.
- [x] `apps/web/src/index.css`, DESIGN.md front matter and prose, `test/theme-*.ts` -- Delete the `--sidebar*` set as `deferred-work.md:1187` lists, rewriting `band-dark`'s pin to literal values first. Add a contrast block for the auth panel's text pairs on `glass-chrome` over the page and each blob, unless the existing chrome block already covers them (note which in the PR).
- [x] `apps/web/src/pages/structural-pins-shell.test.ts` -- Expect no `--sidebar*` offenders. Add a pin that no `.tsx` under `apps/web/src` uses a `blur-` or `backdrop-blur` class.
- [x] Fixtures, `source-guards` and `key-sources` -- Update only if the auth layout's counts change.
- [x] EXPERIENCE.md §Responsive -- Add a bullet: sign-in from `lg` up is a glass panel beside the form, and member screens are opaque cards on the page. DESIGN.md -- Drop "the navy sign-in panel" and the `sidebar-*` sentences. Set `updated: 2026-11-02`. `deferred-work.md` -- Mark both entries RESOLVED by 15.3.

**Acceptance Criteria:**
- Given the repo, when it is searched, then no `sidebar` token appears in `index.css`, DESIGN.md front matter or any `.tsx` class, and no `.tsx` uses `blur-*`.
- Given *Danas* (both roles), Sati, Godišnji, *Zatraži*, Ljudi, `/obavijesti`, error, not-found and pending, in both themes, at phone and desktop widths, then every content surface is an opaque Card or Notice on the backdrop, and no `backdrop-filter` sits inside one.
- Given the PR, then lint, typecheck, unit and e2e tests are green.

## Epic AC Deviations

None. The epic lists surfaces only. Error, not-found, pending, Sati, Godišnji, *Zatraži*, Ljudi and `/obavijesti` were checked and need no change. Skeleton bars and the *Godišnji* sent `Notice` on the backdrop are opaque and stay.

## Design Notes

Why a Card around the tiles, not `StatCard`: `StatCard`'s 3xl value would overflow half of a 320 px row, and recolouring `StatTile` on a screen would restyle a primitive. The tile links keep `ring-offset-2`, because inside the Card the offset paints next to the card colour, as in Sati.

## Verification

**Commands:**
- `PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH" pnpm lint && pnpm typecheck && pnpm test` -- expected: green.
- `pnpm test:e2e` -- expected: green. Port 5173 must belong to this worktree; use the shared stack with no reset.

**Manual checks:**
- Screenshots of sign-in at 1280 px, and of *Danas* (member) at 390 px, in both themes.

## Suggested Review Order

**Sign-in on the backdrop**

- Entry point: the brand panel is the sidebar's floating glass shape, foreground text, no glows.
  [`auth-layout.tsx:31`](../../apps/web/src/components/layout/auth-layout.tsx#L31)

- The tile is neutral ink, never the org accent.
  [`auth-layout.tsx:33`](../../apps/web/src/components/layout/auth-layout.tsx#L33)

**Danas tiles in a card**

- StatTile is meant inside a card; one Card holds both tiles.
  [`today-body.tsx:50`](../../apps/web/src/features/today/components/today-body.tsx#L50)

- The loading row is the same Card, so nothing jumps on load.
  [`today-skeleton.tsx:37`](../../apps/web/src/features/today/components/today-skeleton.tsx#L37)

**The `--sidebar*` set retired**

- Eight tokens gone in both themes and `@theme`; the band-dark note keeps the history.
  [`index.css:285`](../../apps/web/src/index.css#L285)

- band-dark, once equal to the raw sidebar pair, now pinned to its literal values.
  [`theme-contrast.test.ts:1459`](../../test/theme-contrast.test.ts#L1459)

- Base token count 28 → 20.
  [`theme-tokens.test.ts:68`](../../test/theme-tokens.test.ts#L68)

**Pins**

- No source reads a sidebar token.
  [`structural-pins-shell.test.ts:783`](../../apps/web/src/pages/structural-pins-shell.test.ts#L783)

- No `.ts`/`.tsx` uses a Tailwind `blur-*` class; DOM `.blur()` calls pass.
  [`structural-pins-shell.test.ts:830`](../../apps/web/src/pages/structural-pins-shell.test.ts#L830)

- The sign-in panel's text and tile read on chrome glass over every blob.
  [`theme-contrast.test.ts:1195`](../../test/theme-contrast.test.ts#L1195)

**Docs**

- Register and the ink-tile rule.
  [`DESIGN.md:258`](../planning-artifacts/ux-designs/ux-shift-2026-09-02/DESIGN.md#L258)

- §Responsive: sign-in, set-password and member screens on the glass page.
  [`EXPERIENCE.md:191`](../planning-artifacts/ux-designs/ux-shift-2026-09-02/EXPERIENCE.md#L191)

- Both `--sidebar*` deferrals marked resolved.
  [`deferred-work.md:1166`](deferred-work.md#L1166)
