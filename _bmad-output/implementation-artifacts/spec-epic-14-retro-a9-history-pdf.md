---
title: 'Epic 14 retro A9 (PDF part): the history PDF keeps a row whole, draws every character and refuses an oversized export'
type: 'bugfix'
created: '2026-11-17'
status: 'in-review'
baseline_commit: 'bb661d8c1c92889356b4c1c8f0a0075834b51875'
review_loop_iteration: 1
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Three 14.3 deferrals (`deferred-work.md`, source `spec-14-3-…`): a *Povijest promjena* row that does not fit at a page foot continues with empty *Vrijeme*, *Autor*, *Vrsta*, *Predmet* cells (and `dontBreakRows` alone drops a row taller than a page); a character Roboto lacks (emoji, CJK, `→` in free text, raw JSON) prints as an empty box; and the export is built on the main thread with no cap.

**Approach:** Split an entry's changes into table rows that always fit one page, each repeating the identifying cells, later ones marked *(nastavak)*, under `dontBreakRows: true`. Substitute every character the registered Roboto faces cannot draw (read from their own `cmap`), transliterating arrows, and add one header note when anything was replaced. Refuse an export above 2000 changes with a Croatian message to narrow the period or filters, and yield to the UI between build stages below it. Founder approval: epic 14 retro A9 "fix all", 2026-11-17, unattended.

## Boundaries & Constraints

**Always:** pdfmake stays imported only by `services/pdf.ts`, by `import()`. Rows stay the screen's rows, in order (AD-13). Every Croatian string in `hr.json`. A generated PDF is rasterized and looked at (A10 rule). The existing UX states (closed when empty, inert while building, failed line, done line) keep working.

**Ask First:** a wider embedded font (new asset, bundle cost); a web worker.

**Never:** truncating a change's text; dropping a row; touching the DB stack; a second read.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Short row at page foot | row fits a page | moved whole to the next page, cells filled | N/A |
| 90-change entry | one row, 90 one-line changes | 4 table rows, each with time, author, kind, subject; rows 2-4 marked *(nastavak)*; every change printed once, in order | N/A |
| One huge change | a 3000-character side | its text split across continuation rows at whitespace, nothing lost | N/A |
| Emoji, CJK, arrow | `Zamjena 👍 → 张伟` | `Zamjena � -> ��`; one note line under the header | N/A |
| Only Roboto text | č ć đ š ž | unchanged, no note | N/A |
| Over the cap | 2001 changes shown | nothing built; alert names the count and the limit, asks to narrow period or filters | offered again |

## Epic AC Deviations

Story 14.3: "the file holds exactly the filtered rows in their order, built from the rendered snapshot and never a second read":
- **Narrowed (cap):** above 2000 changes no file is built; the admin narrows the period or filters. Why: pdfmake's layout blocks the tab and grows linearly (measured, Design Notes).
- **Reinterpreted (continuation):** an entry too tall for a page spans several table rows marked *(nastavak)*; it is still one entry, in its order, nothing omitted.
- **Reinterpreted (characters):** a character the PDF font cannot draw is substituted and a note says so; the screen still shows the original.

</frozen-after-approval>

## Code Map

- `apps/web/src/features/history/services/pdf.ts` -- the only pdfmake module: `historyDocumentOf` (widths, `changesCellOf`, `rowCellsOf`), `writeHistoryExport` (loads pdfmake + `vfs_fonts`).
- `apps/web/src/features/history/services/history-export.ts` -- the model (`HistoryExport`, `historyExportOf`, `exportHistory`, action predicates); every rule the node suite executes.
- `apps/web/src/features/history/hooks/use-history-export.ts` -- wiring; failure and done lines keyed to the rows built.
- `apps/web/src/features/history/components/history-export.tsx` -- button + notices.
- `apps/web/src/features/history/services/pdf.test.ts` -- private cmap parser (moves to `font-coverage.ts`), coverage of the build's own words.
- `apps/web/src/lib/i18n/locales/hr.json` -- `history.export.*`.
- `node_modules/.pnpm/pdfmake@0.3.13/.../js/{Printer,TableProcessor,PageElementWriter}.js` -- read-only: layout is one synchronous `layoutDocument` (no yield possible inside it); `dontBreakRows` commits a row as an unbreakable block, and a block taller than a page is lost.

## Tasks & Acceptance

**Execution:**
- [x] `services/font-coverage.ts` (new) -- byte-based cmap reader (from `pdf.test.ts`), base64 decode, shared coverage of the faces -- runs in browser and node.
- [x] `services/history-pdf-text.ts` (new) -- `drawableText(text, covers)` per grapheme (NFC; transliterate `→ ← ↔ ⇒ ⇐ ⇔`; NFKC if covered; uncovered whitespace to a space, invisible format characters dropped; else `U+FFFD`), and `drawableExport(model, covers)` mapping every drawn string and appending `model.glyphNote` once when a visible character was replaced.
- [x] `services/history-export.ts` -- model gains `continued` and `glyphNote`; `HISTORY_EXPORT_LIMIT = 2000`, `historyExportCount`, `historyExportOverLimit`; `exportHistory` yields before building.
- [x] `services/pdf.ts` -- `historyChunksOf(row)`: estimated heights (1 em per character, Roboto line height, the 4 pt change gap) packed into a 400 pt budget, an oversized change split at whitespace; continuation rows repeat the identifying cells with *(nastavak)*; `dontBreakRows: true`; the writer substitutes against the registered faces and yields between stages.
- [x] `hooks/use-history-export.ts`, `components/history-export.tsx` -- refuse over the limit with an alert keyed to the rows.
- [x] `hr.json` -- `history.export.continued`, `.glyphNote`, `.tooLarge`.
- [x] Tests: `font-coverage`/`history-pdf-text`/`history-export`/`pdf` unit tests; `pdf.render.test.ts` renders with pdfmake in node and proves no cell node is dropped; `HISTORY_PDF_OUT=<dir>` writes the PDFs for rasterizing.
- [x] `deferred-work.md` (three 14.3 entries RESOLVED), `sprint-status.yaml` item 69 note.

**Acceptance Criteria:**
- Given the 90-change fixture rendered by pdfmake 0.3.13, when what pdfmake draws is recorded, then every cell node's text is drawn, in order (none dropped; a node's `positions` would not prove it), and every continuation row draws the identifying cells and *(nastavak)*.
- Given the faces in `vfs_fonts`, when any string of the build's own words is drawn, then nothing is substituted; given user text with emoji/CJK/arrows, then the drawn text is fully covered.
- Given typecheck, lint, web/domain unit tests and the three DB-free root tests, when run, then they pass.

## Design Notes

- **Cap 2000, measured.** pdfmake lays out and renders synchronously; only the stages around it can yield. In node on this machine (AMD EPYC 9354P), entries of 3 changes each: 500 → 1.5 s, 1000 → 1.9 s, 2000 → 2.9 s, 5000 → 7.6 s (2.0 MB), under the old layout. A laptop or phone is 2-4× slower, so 5000 would freeze a tab 15-30 s; 2000 keeps it to a few seconds while covering a busy month (re-measured below with the new layout).
- **Worker not chosen:** the definition holds functions (footer, layouts) that cannot be posted, the worker chunk would need its own precache exclusion, and only CI e2e could run it.
- **Chunk estimate is an upper bound:** 1 em (8 pt) per character against Roboto's ~0.5 em average roughly halves real height, absorbing word-wrap waste; 400 pt + header row + padding < 515 pt usable height (pinned).
- Identifying cells are bounded by the names' 100-character limit (`char_length(name) <= 100`), far under the budget.

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint` -- 0.
- `pnpm --filter @shift/web test`, `pnpm --filter @shift/domain test` -- pass.
- `pnpm exec vitest run test/resource-hygiene.test.ts test/supabase-scaffold.test.ts test/static-hosting.test.ts` (and the other DB-free root files) -- pass, after `pnpm build`.
- `HISTORY_PDF_OUT=<dir> pnpm --filter @shift/web exec vitest run src/features/history/services/pdf.render.test.ts`, then `pdftoppm -png` -- pages looked at.

**Results (2026-11-17, Node 24.19.0, after the review patches):** typecheck 0; lint 0; `pnpm build` 0, entry chunk 1,774.3 kB vs 1,769.2 kB at baseline (+0.29%: the coverage reader, the substitution and the words), `pdfmake-*.js` and `vfs_fonts-*.js` still separate chunks, precache 14 entries; web 172 files / 6502 tests pass; domain 16 / 855 pass (one run of `pnpm -r test` timed out `hours.test.ts`'s 1000-configuration property at 5.28 s under load; domain is untouched and passed alone); DB-free root tests resource-hygiene, supabase-scaffold, static-hosting, import-cycles, feature-boundaries, key-hygiene, localization-applied, theme-contrast: 8 files / 2955 pass. No DB-connecting test and no e2e was run (CI is the gate).

**The rendered PDFs** (pdfmake 0.3.13 node build, the `vfs_fonts` faces; written by `pdf.render.test.ts`, rasterized with `pdftoppm -png -r 100`, opened and looked at):
- `history-realistic.pdf`, 9 pages, 60 entries + the start of history. Page 1: title, the seven header lines and the note *Napomena: znakovi koje PDF ne može prikazati … znakom �, a strelice znakovima poput ->.*; the 100-character name wraps inside *Autor* and *Predmet*; the unbroken e-mail address breaks inside *Bilo* and *Sada*, nothing past the page edge. Page 2: the last 7 short rows, then blank: the 90-change entry's first row (29 changes) does not fit below them and moves whole. Pages 3–5: the 90-change entry as four rows (29, 29, 29, 3 changes), each with *16.11.2026 09:05*, *Đurđa Šoštarić*, *Raspored · promijenjeno*, *Ljiljana Kovačević, 1.–31.12.2026*; rows 2–4 have *(nastavak)* in italics under the time; *Dan 1.12.* to *Dan 90.12.* each once, in order (`pdftotext`: 90 of 90). Pages 6–7: the 3000-character note as five rows, split between words, each continuation marked; then `Zoë � Anić`, `�� -> Smjena B`, `Napomena: Zamjena � -> ��`, `OK � � => gotovo`, `meta: {"a":"->","b":[1,2]}`: no empty box anywhere. Row rules at 250 dpi are even.
- `history-plain.pdf`, 11 pages, 120 three-change entries: no row cut by a page, no *(nastavak)*, no note.
- Without the chunking (budget raised to 40000 pt, then restored), the same fixture's PDF has 0 of the 90 lines and no *Ljiljana*: pdfmake dropped the row, though its nodes had `positions`; the render test now fails on it (it checks what pdfmake draws, not positions).

**Measured cap** (node, AMD EPYC 9354P, entries of 3 changes, new layout): 500 → 1.4–2.2 s, 1000 → 1.4 s, 2000 → 2.9–3.4 s (797 kB), 5000 → 7.6 s (2.0 MB).

**Results of the second review's patches (2026-11-17, Node 24.19.0):** typecheck 0; lint 0; `pnpm build` 0, entry chunk 1,774.6 kB, `pdfmake-*.js` and `vfs_fonts-*.js` still separate chunks, precache 14 entries; web 172 files / 6507 tests pass; domain 16 / 855 pass; the same eight DB-free root files: 8 / 2957 pass. Re-rendered `history-realistic.pdf` (9 pages), `history-glyphs.pdf` (9) and `history-plain.pdf` (11) and rasterized them (`pdftoppm -png -r 60`): page 4 is the 90-change entry's second row, *16.11.2026 09:05*, *Đurđa Šoštarić*, *Raspored · promijenjeno*, *Ljiljana Kovačević, 1.–31.12.2026* and *(nastavak)* beside *Dan 30.12.* to *Dan 58.12.*; page 7 ends the 3000-character note's continuations and draws `Zoë � Anić`, `�� -> Smjena B`, `OK � � => gotovo` with no empty box; `pdftotext`: 90 of 90 day lines, 7 *(nastavak)*. The review's Artifact Renderer also rendered four harder fixtures (100-character unbroken names, a 3200-character URL beside 4200 characters of base64, 5000 `W`, Arabic, Hebrew, Devanagari, Thai, Korean, zalgo marks, a 4000-word note, 700 rows; 112 pages): nothing past a margin, no row cut, no text lost, no box.

**Residual risks:** a name or text in a script Roboto lacks (Arabic, Hebrew, Devanagari, Thai, Korean, CJK) prints as a run of `�`, unreadable though flagged by the note (deferred: a wider font is Ask First). The cap counts entries, not their changes (deferred: an export of 2000 many-change entries passes it at several times the measured cost). pdfmake's layout is one synchronous call: up to about 3 s on a server CPU at the cap, several seconds on a slow phone, with *Izvoz…* painted first. A tall entry that does not fit below the rows above it leaves up to about three quarters of that page blank (the 400 pt budget, chosen for few continuations). The row-height estimate takes 1 em a character; Roboto's widest glyph (1.18 em) is covered by the page's slack (pinned), but word-wrap waste on text of only the widest glyphs is not; the identifying cells of the longest names are pinned under the budget. A split change's later pieces do not repeat its field label, and *Bilo*'s and *Sada*'s pieces are paired by position, not meaning. The hook's and component's refusal wiring runs in no test (a node-only suite; the decision is the tested `historyExportPressOf`, and `exportHistory` refuses too); no e2e reaches 2001 rows (deferred). The browser writer (substitution against the browser `vfs_fonts`, yields, download) runs only in CI e2e.

## Review Triage Log

### 2026-11-17 — Review (blind, edge-case, verification-gap, epic AC auditor)

- Epic AC auditor: every deviation from 14.3's AC is listed; the lazy-load AC still met. No finding.
- `[medium]` `[patch]` The render test rebuilt the writer's composition instead of running it: `historyPdfDefinitionOf` (substitute, then lay out) is now what both the writer and `pdf.render.test.ts` use.
- `[medium]` `[patch]` The refusal lived only in the hook: `historyExportPressOf` decides a press (tested), and `exportHistory` refuses over the limit itself (tested: writer never called).
- `[medium]` `[patch]` The 1 em estimate is not an upper bound for Roboto's widest glyph (1.18 em, e.g. `U+FFFD`): pinned that a chunk of only the widest glyphs, in every face, still fits a page; 1 em kept (1.2 em would make the frozen 90-change case six rows).
- `[medium]` `[patch]` Identifying cells were outside the pinned budget: `historyIdentifyingHeightOf` and a test for the longest names.
- `[low]` `[patch]` CR LF, CR, U+2028 and U+2029 became spaces: now line breaks. A covered letter with an uncovered mark lost the letter: now the letter stays and only the mark is replaced. The unreachable `'?'` fallback is gone (every face has `U+FFFD`, tested).
- `[low]` `[patch]` `yieldToUi` waited a task, not a frame: now `requestAnimationFrame` then a task. The fonts' coverage is read after a yield.
- `[low]` `[patch]` The render test's prototype patch is restored after the suite; its coverage check reads everything pdfmake drew (title, header, columns, footers), not only table nodes. A nested-spread test line reformatted.
- `[medium]` `[defer]` The cap counts entries, not their changes: `deferred-work.md`.
- Rejected: a finding that the deferrals should not be marked RESOLVED before merge (the founder's instruction; sprint item 69 stays `open`, CI pending); a pre-emptive over-limit hint (the spec refuses on the press); the newline at a piece boundary (the boundary is the row break); `findLastIndex` (inside the build's browser baseline); literal invisible characters (they are escapes; `hr.json` holds `�` as the character it shows).

### 2026-11-17 — Second review (blind, edge-case, verification-gap, acceptance auditor, epic AC auditor, artifact renderer), unattended

- Epic AC auditor: every deviation from 14.3's ACs is listed; lazy load and no second read still hold. No finding. Acceptance auditor: no AC, intent line or boundary violated.
- `[medium]` `[patch]` `yieldToUi` waited on `requestAnimationFrame`, which a hidden tab never runs: an admin who switched tabs after *Izvoz* stalled the build at four yields. It now waits at most 100 ms (`HISTORY_EXPORT_FRAME_WAIT_MS`) for a frame; both paths tested with fake timers.
- `[medium]` `[patch]` A digit or sign the font draws with a mark it lacks (`5` + U+20DD) lost its base to one `�`, and a letter with several marks moved covered marks ahead of one trailing `�`: now any covered non-mark base stays and each missing mark is replaced in place (tested).
- `[low]` `[patch]` A supplementary variation selector (U+E0100–U+E01EF) was not invisible (spurious `�` and note), and the prepended concatenation marks (Arabic number sign, U+0600…), format characters that do draw, were dropped silently: both fixed and tested.
- `[low]` `[patch]` `➡` (and the emoji `➡️`), `⬅`, `⟹`, `⟸`, `⟷` printed as `�`: transliterated (tested). `↑`/`↓` have no ASCII reading and stay `�`.
- `[low]` `[patch]` A line cut at the character budget could part a letter from a mark the font draws apart: `linesOf` cuts by grapheme.
- `[low]` `[patch]` The render test's continuation check was `>= 3` under a comment claiming the author is repeated: it now requires exactly the chunks' continuations in what pdfmake drew (7), the 90-change entry as four rows, and its subject drawn four times.
- `[low]` `[patch]` The identifying-height pin covered a member and a team, but a swap's subject names up to four members and two teams (`subjectsOfRows`): pinned for six 100-character names through `formatList`.
- `[low]` `[patch]` The spec: AC 1 named node positions, which the render test deliberately does not trust (reworded to what is checked); `status` was `done` with CI pending (now `in-review`, per the A11 done-rule); `review_loop_iteration`; the first log's "Rejected" line read as if the ledger edits were rejected (reworded).
- `[medium]` `[defer]` Arabic, Hebrew, Devanagari, Thai, Korean and CJK text prints as runs of `�` (Artifact Renderer, rendered): readable output needs a wider embedded font, which this spec puts under Ask First (bundle and precache cost). `deferred-work.md`.
- `[low]` `[defer]` The hook's and component's refusal wiring runs in no test: needs a CI e2e that seeds more than 2000 events (or a DOM test environment the web suite does not have). `deferred-work.md`.
- Rejected: the PDF metadata title being substituted (the title is the build's fixed *Povijest promjena*, never user text: checked); the refusal logged as a failure inside `exportHistory` (defence in depth only, the hook refuses first, so a user never sees it); a second press not re-announcing the alert (the failure line behaves the same way; the alert is still on screen); the glyph note not naming NFKC replacements (its *npr.* gives examples; full-width and ligature forms are the same letters); `{limit, number} promjena` not pluralized (the limit is the constant 2000); identifying cells above the budget (bounded by the six-name pin above); a missing face throwing (it is the generic failed line, the right outcome); blank page space and sparse long-text continuations (the documented 400 pt budget and 1 em estimate, a deliberate upper bound); a split change's later pieces without the field label (the label is part of the change's text, not a separate field; documented); the render test patching pdfmake at module load (restored in `afterAll`, files are isolated); the cap measured only in node (documented, deferred with the entry count); duplication of `offsetOf` in `pdf.test.ts` (test-only, reads tables the coverage reader does not).

## Suggested Review Order

**A row is never cut by a page**

- Entry point: an entry's changes packed into page-safe table rows.
  [`pdf.ts:193`](../../apps/web/src/features/history/services/pdf.ts#L193)

- The budget and why a chunk always fits an empty page.
  [`pdf.ts:93`](../../apps/web/src/features/history/services/pdf.ts#L93)

- Safe only because of the chunking; pdfmake drops taller rows.
  [`pdf.ts:303`](../../apps/web/src/features/history/services/pdf.ts#L303)

- Continuations repeat the identifying cells and say *(nastavak)*.
  [`pdf.ts:260`](../../apps/web/src/features/history/services/pdf.ts#L260)

- Identifying cells' estimated height, pinned for the longest names.
  [`pdf.ts:135`](../../apps/web/src/features/history/services/pdf.ts#L135)

**What Roboto cannot draw**

- Per grapheme: transliterate, NFKC, drop invisibles, else `U+FFFD`.
  [`history-pdf-text.ts:55`](../../apps/web/src/features/history/services/history-pdf-text.ts#L55)

- Every drawn string mapped; one header note when anything visible changed.
  [`history-pdf-text.ts:107`](../../apps/web/src/features/history/services/history-pdf-text.ts#L107)

- Coverage from the faces' own cmap, shared across all four.
  [`font-coverage.ts:90`](../../apps/web/src/features/history/services/font-coverage.ts#L90)

- The writer's composition, also what the render test renders.
  [`pdf.ts:325`](../../apps/web/src/features/history/services/pdf.ts#L325)

- Graphemes from the one `Intl` site, made lazily.
  [`format.ts:549`](../../apps/web/src/lib/i18n/format.ts#L549)

**The cap and the yields**

- 2000, with the measurement that justifies it.
  [`history-export.ts:204`](../../apps/web/src/features/history/services/history-export.ts#L204)

- A press decides ignore, refuse or build.
  [`history-export.ts:232`](../../apps/web/src/features/history/services/history-export.ts#L232)

- A frame, then a task, between build stages.
  [`history-export.ts:244`](../../apps/web/src/features/history/services/history-export.ts#L244)

- The service refuses too, whoever calls it.
  [`history-export.ts:302`](../../apps/web/src/features/history/services/history-export.ts#L302)

- Writer stages: coverage, definition, then pdfmake's one synchronous call.
  [`pdf.ts:335`](../../apps/web/src/features/history/services/pdf.ts#L335)

- The hook refuses before any build, keyed to the rows.
  [`use-history-export.ts:66`](../../apps/web/src/features/history/hooks/use-history-export.ts#L66)

- The refusal alert.
  [`history-export.tsx:43`](../../apps/web/src/features/history/components/history-export.tsx#L43)

**Tests and words**

- Real pdfmake render; checks what was drawn, not node positions.
  [`pdf.render.test.ts:230`](../../apps/web/src/features/history/services/pdf.render.test.ts#L230)

- Budget, widest glyph, 90-change split, huge-change split, continuations.
  [`pdf.test.ts:212`](../../apps/web/src/features/history/services/pdf.test.ts#L212)

- The three new Croatian strings.
  [`hr.json:335`](../../apps/web/src/lib/i18n/locales/hr.json#L335)
