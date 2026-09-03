---
title: 'Story 1.1b — The theme layer'
type: 'feature'
created: '2026-09-03'
status: 'ready-for-dev'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `apps/web/src/index.css` is a bare `@import 'tailwindcss'` — no `@theme` block, no colour token, and none of the shadcn base variables its own `components.json` presumes with `cssVariables: true`. `iconLibrary: lucide` is declared with no `lucide-react` installed, and the face DESIGN.md relies on for Croatian diacritics is absent.

**Approach:** Make `components.json`'s contract true. Author the shadcn neutral base plus DESIGN.md's 46 brand tokens in OKLCH, each in light and dark, selected purely by `prefers-color-scheme`. Pin the icon and font packages the config already promises. Prove it with three tests: every token paired, every contrast ratio measured, the shipped face covering Croatian.

## Boundaries & Constraints

**Always:**
- Every token defined in **both** themes (UX-DR1). Light is bare `:root`; dark is a `prefers-color-scheme: dark` block only.
- Values converted from DESIGN.md's `colors:` front matter — never invented or re-derived.
- Exact pins (`.npmrc` sets `save-exact=true`). Tests are `.ts`, node environment, no jsdom (AD-15).

**Ask First:**
- Any theme toggle, setting or persisted preference — UX-DR2 forbids the surface, so no `.dark` hook or `data-theme` attribute either.
- A `shift-day`, `shift-night` or any semantically-named ramp token (UX-DR6); `destructive` for anything but an unresolved conflict (UX-DR4).
- A contrast failure in ramp slots 3–6 — `[ASSUMPTION]`, unexercised by the pilot, so a failure is a design question, not a value to nudge.

**Never:**
- No user-facing string of any kind — no screen, navigation or copy (1.1c, 1.1d).
- No i18next, formatting module or resource file (1.1c). No organization accent wiring (1.4).
- No shadcn primitive generated here; only the variables one would consume.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Either theme | light, or `prefers-color-scheme: dark` | Every token resolves to that theme's value | An unpaired token fails the token test |
| Contrast | any foreground/background pair | ≥4.5:1 body, ≥3:1 large text and UI | Test names the pair and measured ratio |
| Diacritics | the shipped Geist face | Covers č ć ž š đ Č Ć Ž Đ Š | Test names missing codepoints |
| Conversion | DESIGN.md hex → OKLCH | 46 tokens, all `oklch(...)` | A stray hex value fails the token test |

</frozen-after-approval>

## Code Map

- `_bmad-output/planning-artifacts/ux-designs/ux-shift-2026-09-02/DESIGN.md` -- **read-only source of truth**: its `colors:` front matter is the authoritative 46-token hex enumeration. Shape: `primary`/`destructive` ×4 each (base, foreground, dark, foreground-dark) = 8; `shift-slot-1`…`6` ×4 = 24; `shift-nonworking` ×4; `modifier-leave`/`modifier-uncovered` ×4 each; `modifier-overridden` ×2, no foreground pair = 46 exactly. The "fourth modifier signal" is conflict, reusing `destructive` (UX-DR4) rather than owning tokens. The two overlay modifiers are `rgba(...)`, not solid.
- `apps/web/src/index.css:1-5` -- a comment plus `@import 'tailwindcss'`. Everything lands here.
- `apps/web/components.json` -- `cssVariables: true`, `baseColor: neutral`, `iconLibrary: lucide`, `tailwind.config: ""`. CSS-first Tailwind 4 wired through `@tailwindcss/vite`: no JS config exists and none should be created.
- `test/` -- its own vitest project; all three new tests belong here. **Idiom:** `test/supabase-scaffold.test.ts` for parsing a shipped file (`node:fs`, root via `fileURLToPath(new URL('..', import.meta.url))`, never `process.cwd()`); `apps/web/src/router.test.ts` for phrasing — JSDoc citing the story and why the test exists, `describe` as a plain-English invariant, `it` as a behavioural clause, never "should". Guard vacuous passes before asserting a filtered set is empty.

Pinned versions, directory shape and AD-14/15/17 are in the loaded `epic-1-context.md` — do not re-derive them.

## Tasks & Acceptance

**Execution:**
- [ ] `apps/web/package.json`, root `package.json` -- pin `lucide-react@1.40.0` and `@fontsource-variable/geist@5.3.0` in the app; `culori@4.0.2` as a root devDependency for the two colour tests -- the first two satisfy promises `components.json` and DESIGN.md already make; culori parses `oklch()` and computes WCAG contrast, verified against black/white = 21.00
- [ ] `apps/web/src/index.css` -- the shadcn neutral base in OKLCH, then a `@theme` block with all 46 brand tokens converted from DESIGN.md; every dark value in one `prefers-color-scheme: dark` block; import the Geist variable face, bind `--font-sans`, expose `tabular-nums` (UX-DR40) -- one file, so a missing pair shows in a single read
- [ ] `test/theme-tokens.test.ts` -- parse `index.css`: all 46 tokens present by name, each with a light and a dark value, every colour in OKLCH, no `shift-day`/`shift-night`-style name, no `.dark` or `data-theme` hook -- catches a half-finished conversion and a smuggled toggle
- [ ] `test/theme-contrast.test.ts` -- contrast for every foreground/background pair in both themes via culori; ≥4.5:1 body, ≥3:1 large/UI, failing with the pair name and measured ratio. The two `rgba(...)` modifiers have no standalone contrast — composite each over every ramp slot first, then measure -- UX-DR3 as a number, not a promise
- [ ] `test/typography-coverage.test.ts` -- parse the imported Geist CSS from `node_modules` and assert a declared `unicode-range` covers all ten of **č ć ž š đ Č Ć Ž Đ Š** (U+0106/7, U+010C/D, U+0110/1, U+0160/1, U+017D/E) -- no font-binary parsing needed, and it catches the actual failure mode named in Design Notes

**Acceptance Criteria:**
- Given a clean checkout, when `pnpm install && pnpm build && pnpm lint && pnpm typecheck && pnpm test` runs, then every command exits 0
- Given the built CSS, when inspected, then light and dark both ship and the only selector distinguishing them is `prefers-color-scheme` (UX-DR2)
- Given the rendered shell, when OS appearance is switched, then it repaints with no reload and no flash of the wrong theme
- Given the bundle, when searched, then it holds no user-facing text beyond the existing `<title>`

## Spec Change Log

## Design Notes

**Why the shadcn base is in scope.** `cssVariables: true` with `baseColor: neutral` is the contract that primitives read `--background`, `--foreground`, `--border` and `--ring` from CSS. Story 1.1a wrote `components.json` but never ran an init that emits them, so shipping only the brand delta leaves the first primitive pointing at undefined properties — which renders as invisible text rather than raising an error. The delta sits on the base; it does not replace it.

**Why ramp tokens are numbered, never named.** Shift types take slots in creation order and the always-visible label carries the distinction (UX-DR6). A `shift-night` token would encode an organization's naming into the theme, and no code may branch on an admin-entered name. Past six, a slot repeats.

**The two overlay modifiers.** `modifier-leave` and `modifier-uncovered` are `rgba(...)` deliberately — they compose over a slot fill rather than replacing it (UX-DR8), so the conversion must preserve alpha.

**The font risk is the subset, not the glyph.** `@fontsource-variable/geist@5.3.0` ships five subsets. Every Croatian diacritic sits in `latin-ext`; the `latin` subset (U+0000–00FF plus scattered singles) contains none of them. The package's default entry declares all five, so importing `@fontsource-variable/geist` is correct — but importing a narrower entry silently drops Croatian and produces exactly the mid-word fallback DESIGN.md warns about. That is what the coverage test guards.

## Verification

**Commands:**
- `pnpm install && pnpm build && pnpm lint && pnpm typecheck && pnpm test` -- expected: exit 0
- `grep -c "oklch(" apps/web/src/index.css` -- expected: at least 46
- `grep -nEi "#[0-9a-f]{3,8}\b|shift-(day|night)|data-theme|\.dark\b" apps/web/src/index.css || echo CLEAN` -- expected: `CLEAN`
- `pnpm ls --recursive jsdom || echo NO-JSDOM` -- expected: `NO-JSDOM`

**Manual checks:**
- Switching OS appearance repaints the shell with no reload and no flash of the wrong theme
