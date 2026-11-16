---
title: 'Story 14.3: The change history exports to PDF'
type: 'feature'
created: '2026-11-16'
status: 'done'
baseline_revision: '9a8fa7e3d2ac39c23c353315c3abc47287c25ab5'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-14-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-14-2-an-admin-reads-the-change-history.md'
  - '{project-root}/apps/web/src/components/README.md'
warnings: [oversized]
deferred:
  - summary: >-
      A name or value the user wrote with a character Roboto lacks (emoji, CJK, an arrow in free text, raw JSON of an unknown column) prints as an empty box in the PDF.
    evidence: |-
      Blind and edge-case review. The font test covers every character the build's own words, dates and numbers draw, and a fixture; user data is not substituted or checked at runtime.
    location: >-
      apps/web/src/features/history/services/pdf.ts
    severity: low
  - summary: >-
      A busy 366-day period builds the whole PDF on the main thread with a nested table per row, with no cap, warning or worker; the tab can freeze while it builds.
    evidence: |-
      Blind review. Same root as 14.2's deferred "renders every row with no cap or windowing"; pilot volume is small.
    location: >-
      apps/web/src/features/history/services/pdf.ts
    severity: low
---

<intent-contract>

## Intent

**Problem:** *Povijest promjena* (story 14.2) shows an admin the filtered change history, but it cannot be handed on: there is no `Izvezi u PDF` (UX-DR51, CAP-24).

**Approach:** Apply the spine's AD-11 "The PDF (14.3)" bullet exactly, on the hours export's pattern (`features/hours/services/hours-export.ts` + `xlsx.ts` + `hooks/use-hours-export.ts` + `components/organization-hours-export.tsx`): one pure module builds a writer-agnostic document model from exactly the rows the screen rendered (`view.rows`, in order) plus the organization, period, filters and generation time; one module alone knows `pdfmake` and loads it by dynamic `import()`; a secondary `Izvezi u PDF` action on the ready page downloads it and says what it wrote.

## Boundaries & Constraints

**Always:**
- Baseline: story 14.2's review commit on this branch (`9a8fa7e`); hot files (`hr.json`, structural pins, `test/localization-applied.test.ts`) are touched by this story alone, sequentially.
- The export's input is the ready view's `rows` (`HistoryRow[]`, the same array the table/stacked rows render) — no second read, no re-filtering, no re-wording of a row (AD-13). Its header names the organization (the organization snapshot's `name`), the period (choice words and its `from`–`to` dates), every active Osoba/Smjena/Vrsta filter by the label the chip shows (or `… sve`), the summary `Prikazano: N od M`, the begins statement when the page shows it, and the generation time — all in the organization's zone.
- `pdfmake` pinned exactly `0.3.13` in `apps/web/package.json` only: the spine's Stack row requires a version at least two weeks old; 0.3.14 (2026-11-08) is not until 2026-11-22. Never weaken `pnpm-workspace.yaml`/`.npmrc` policy. No `@types/pdfmake` or any other dependency: a local ambient declaration types the subset used.
- `features/history/services/pdf.ts` is the ONLY module importing `pdfmake` (both `pdfmake/build/pdfmake` and `pdfmake/build/vfs_fonts`), only via `await import(...)`, and registers the fonts itself with `addVirtualFileSystem(vfs)`; default font Roboto.
- Roboto has no `→`: the PDF has separate *Bilo* and *Sada* columns; a node test proves every character the document definition draws (fixture with č ć đ š ž, every `history.*` word the export can draw, dates, times, numbers, page footer) is in the cmap of the Roboto faces used (decoded from `pdfmake/build/vfs_fonts.js`).
- Workbox `globIgnores` excludes the writer's chunks, so export is online-only; a built-output test proves the writer chunks are absent from `sw.js`'s precache and from the entry chunk, and named by the entry only inside `import()`.
- Every word from `hr.json` via static keys; key-hygiene/resource-hygiene/localization-applied stay green. File name like the hours export: `t('history.export.fileName', …)` + `.pdf`, organization through the hours module's `fileNameSafeOf`.
- Admin only: the action lives on the admin-guarded page and is drawn only in the ready state.
- Obey the bmad-build customization facts (Epic AC Deviations, e2e grep for changed surfaces, DB-free root tests run locally, STRICT DATABASE RULE, resolved deferrals marked).

**Block If:**
- pdfmake 0.3.13 cannot be bundled by Vite 8/rolldown or produces a PDF only with a dependency beyond pdfmake itself.

**Never:**
- No server, Edge Function, migration, paid service, or runtime caching; no `window.print`; no persistence of history data (no change to persisted key roots, offline paths or `DEVICE_SNAPSHOT_SHAPE`).
- No change to what the table shows, to `historyRowsOf`'s output, or to the read.
- No local Supabase stack, DB-connecting root test or e2e run.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Export | ready view, 3 rows, `?smjena=T&razdoblje=90-dana` | `Povijest promjena <Org> <from> <to>.pdf` downloads; the table holds the same 3 rows in order; header says `Smjena: <team name>`, `Osoba: sve`, `Vrsta: sve`, the period words and dates, generation time; status line names the file and `3 promjene` | — |
| Change sides | a rename; an addition; a deletion; no visible field | *Bilo* `Naziv: A` / *Sada* `Naziv: B`; addition: *Bilo* empty, *Sada* `Naziv: B`; deletion: the reverse; none: `Bez promijenjenih polja` spanning both | — |
| Marker / reconstructed | marker row; backfilled row | marker drawn with `Početak povijesti`; reconstructed with `Rekonstruirano` in the *Vrsta* cell; the status count excludes the marker | — |
| No rows | period or filters leave none | button natively `disabled` | — |
| Double press | press while building | second press ignored (ref), button `aria-disabled`, label `Izvoz…` | — |
| Writer fails | dynamic import fails (offline after load) or `download` rejects | `Notice role="alert"` failed line; button offered again; logged `HISTORY_EXPORT_FAILED` | never thrown |
| View changes | filter/period change, or a read that changes the rows, after a download/failure | the status/failure line disappears (belongs to the rows it was built from) | — |
| Long table | many rows | repeated header row on each page, landscape A4, `Stranica n od m` footer | — |

</intent-contract>

## Code Map

- `apps/web/src/features/hours/services/hours-export.ts` -- the pattern: model + `exportHours(view, name, write)` guarded (logs, returns `null`), `hoursExportEmpty/Disabled/MessageKey`, `HoursExportDone`, `fileNameSafeOf` (reuse; export it via `FEATURE_PUBLIC.hours` `'services/hours-export', // history`). `services/xlsx.ts` -- the only-writer-module pattern. `hooks/use-hours-export.ts` -- the hook to mirror (ref guard, `live` ref, failure/written keyed to the view object). `components/organization-hours-export.tsx` -- the component to mirror.
- `apps/web/src/features/history/hooks/use-change-history.ts` -- `HistoryReadyView` (add `period: HistoryPeriod` and `organizationName: string`); `rows` is recomputed each render today: memoize the ready derivation (`filteredHistoryEntries` + `historyRowsOf`) on `snapshot`, the offered member/team/kind and `zone`, so the rows' identity is stable while the view is (the export's notices key on it). `filters` (offered) and the option views give the chip labels.
- `apps/web/src/features/history/services/history-rows.ts` -- `HistoryRow` (`time, author, kind, subject, reconstructed, marker, changes[{column, field, before, after}]`), `historyPeriodText`, `historyKindText`, `HistoryBeginsView` + `historyBeginsMessageKey`. Read-only.
- `apps/web/src/features/history/components/history-body.tsx` -- ready branch: draw the new `HistoryExport` component under the begins statement, above the rows (`px-4`). `history-filters.tsx` -- the chip label rule (`labelOf`) to mirror for the header's filter lines.
- `apps/web/src/lib/i18n/format.ts` -- `formatDate`, `formatTime`, `formatIsoDate` for the generation time and period dates in the zone.
- `apps/web/vite.config.ts` -- `workbox.globIgnores` (add the writer chunks' patterns; keep `push-sw.js`). If the default chunk names are unstable, name them via the build's output options so the ignore is exact.
- `test/static-hosting.test.ts` (`notBuilt` skip pattern, `read('sw.js')`) and `test/localization-applied.test.ts:1937` (the XLSX entry-chunk test: marker string, one chunk, `import()` only) -- add the PDF writer's equivalents. If the sweeps over all chunks (`chunkPaths`/`allChunks`) count third-party words from the pdfmake chunks, exclude exactly the writer chunks from those sweeps, by their marker, and say so.
- `eslint.config.js:262` `FEATURE_PUBLIC.hours` -- add `'services/hours-export'` with consumer comment `// history`.
- `node_modules/.pnpm/pdfmake@0.3.13/.../pdfmake/src/browser-extensions/{index,OutputDocumentBrowser}.js` -- API: default export `pdfMake` with `addVirtualFileSystem(vfs)`, `createPdf(def).download(fileName): Promise<void>`; `build/vfs_fonts.js` is CJS `module.exports = vfs` (`{'Roboto-Regular.ttf': base64, Medium, Italic, MediumItalic}`); `build/pdfmake.js` is the UMD browser bundle (package `browser` field). No types shipped.
- `apps/web/src/lib/i18n/locales/hr.json` `history.*` -- reuse `column.*`, `added`/`removedValue` (`{field}: {value}` sides), `noChanges`, `reconstructed`, `markerBadge`, `chip.*`, `summary`, `begins*`, `caption`; add `history.export.*`.
- `e2e/pages/history.page.ts`, `e2e/tests/history/history.spec.ts`, `e2e/pages/hours.page.ts:380-395` (`exportButton`, `exportFailed`, `exportDownload` pattern).
- Docs: `_bmad-output/planning-artifacts/epics.md:185` (UX-DR51 "*Planned:*"), `ux-designs/ux-shift-2026-09-02/EXPERIENCE.md:46` ("*Izvezi u PDF* is story 14.3's") and its export bullet near `:130`, spine Stack row `:298` and AD-11 (add `Applied 2026-11-16 (story 14.3)`), spine CAP-24 row unchanged unless wording differs.
- Deferred inputs: `deferred-work.md` has no entry addressed to 14.3 (grep `14.3`/`Epic 14`: entries 378/570/577/703/757/913/916 are closed to "Epic 14's history" and satisfied by 14.1/14.2; 504/655 are 14.1/14.2's). The epic context's open question ("A filter that leaves no row closes it") is answered: the action is natively disabled when no row is drawn, as the hours export's.

## Tasks & Acceptance

**Execution:**
- `apps/web/package.json`, `pnpm-lock.yaml` -- `pdfmake: "0.3.13"` (already added by planning via `pnpm --filter @shift/web add pdfmake@0.3.13`; verify, do not re-pick).
- `apps/web/src/features/history/services/pdfmake.d.ts` (or `apps/web/src/pdfmake.d.ts`) -- ambient `declare module 'pdfmake/build/pdfmake'` / `'pdfmake/build/vfs_fonts'` typing only what `pdf.ts` uses.
- `apps/web/src/features/history/services/history-export.ts` (+ `history-export.test.ts`) -- `HistoryExport` model `{ fileName, title, lines: string[] (organization, period, filters, summary, generated, begins?), columns: [Vrijeme, Autor, Vrsta, Predmet, Bilo, Sada], rows: { time, author, kind, badge: string|null, subject, changes: {before, after}[] , none: string|null }[], pageText(page,pages) }`; `historyExportOf(input)`; `exportHistory(input, write)` guarded like `exportHours` → `{ fileName, count } | null` (count excludes the marker); `historyExportEmpty/Disabled/MessageKey`. Tests: rows equal `input.rows` in order and count; each side text; marker/reconstructed badges; header lines for default and narrowed filters, period words + dates, generation time in the zone; file name sanitising; guard returns `null` and logs on a throwing writer.
- `apps/web/src/features/history/services/pdf.ts` (+ `pdf.test.ts`) -- `historyDocumentOf(model)` (pure pdfmake definition: landscape A4, `defaultStyle.font = 'Roboto'`, table `headerRows: 1`, widths fitted, *Bilo*/*Sada* as a `colSpan: 2` cell holding a borderless two-column table so each change's sides align, `none` spanning both; footer page text; `info.title`), and `writeHistoryExport(model)`: dynamic-imports the writer and the vfs, `addVirtualFileSystem`, `createPdf(...).download(fileName)`. Test: walk every string in `historyDocumentOf(fixture)` (and `footer(1..3, 3)`) and assert each code point is in the cmap of the face it is drawn in (decode the TTFs from `pdfmake/build/vfs_fonts.js` via `createRequire`; parse `cmap` formats 4/12 in the test); also every string value under `history.*` used by the export (all except `change` and `column.changes`, which hold `→`) and the done/failed lines; a detector self-test that `→` is NOT in the font.
- `apps/web/src/features/history/hooks/use-history-export.ts` -- mirror `useHoursExport`, keyed by the ready view's `rows` identity; generation time `new Date()` at press.
- `apps/web/src/features/history/components/history-export.tsx` -- mirror `OrganizationHoursExport` (secondary `h-11` button, `aria-busy`, alert on failure, status line on success).
- `apps/web/src/features/history/hooks/use-change-history.ts`, `components/history-body.tsx` -- expose `period`/`organizationName`, memoize rows, draw the export in the ready branch.
- `apps/web/src/lib/i18n/locales/hr.json` -- `history.export`: `action` "Izvezi u PDF", `pending` "Izvoz…", `failed` "Izvoz nije uspio. Osvježi stranicu i pokušaj ponovno.", `done` (plural over promjena, naming `{fileName}`), `fileName` "Povijest promjena {organization} {from} {to}" (ISO dates), `organization` "Organizacija: {name}", `period` "Razdoblje: {value} ({from} – {to})", `generated` "Izrađeno: {date} u {time}", `page` "Stranica {page} od {pages}", `before` "Bilo", `after` "Sada". Register in hygiene tests as they require.
- `apps/web/vite.config.ts` -- `globIgnores` for the writer chunks; `test/static-hosting.test.ts` and `test/localization-applied.test.ts` -- built-output pins above.
- `eslint.config.js` -- `FEATURE_PUBLIC.hours` += `'services/hours-export'`.
- `e2e/pages/history.page.ts` (`exportButton`, `exportFailed`, `exportDone`, `exportDownload()`), `e2e/tests/history/history.spec.ts` -- admin narrows by the seeded team, exports: `suggestedFilename()` matches `Povijest promjena … .pdf`, file starts `%PDF-`, the status line names the file and the shown count; member has no button (page forwards). Grep `e2e/` for any assertion the new button could break (e.g. button counts on the history page).
- Docs: UX-DR51 and EXPERIENCE.md (shipped wording); spine Stack row → `0.3.13` (with the age rule), AD-11 `Applied 2026-11-16 (story 14.3)` (chunk names/ignores, font test, colSpan layout, header lines).
- `sprint-status.yaml` -- `14-3-the-change-history-exports-to-pdf` through the workflow.

**Acceptance Criteria:**
- Given a filtered history, when the admin chooses `Izvezi u PDF`, then a PDF downloads whose table holds exactly `view.rows` in order (no read is issued), with the organization name, the period, the active filters and the generation time, in Croatian.
- Given `pnpm build`, when the output is inspected, then `pdfmake` is in no entry chunk, loaded only by `import()`, and absent from `sw.js`'s precache list; the entry chunk's size is unchanged within noise.
- Given `pnpm typecheck`, `pnpm lint`, `pnpm -r test`, `pnpm build` and the DB-free root tests, when run, then they pass (known Node-22 failures aside).

## Spec Change Log

## Review Triage Log

### 2026-11-16 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 7 (high 0, medium 3, low 4)
- defer: 2 (low 2)
- reject: 22 (low 22)
- addressed_findings:
  - `[medium]` `[patch]` One shared `{}` was the spanned sixth cell of every row, and pdfmake writes layout state onto nodes; each row now gets a fresh object (`spannedCell()`).
  - `[medium]` `[patch]` `dontBreakRows: true` would clip or overflow a row taller than a page (a member deletion with every field); removed, so a tall row splits across pages under the repeated header.
  - `[medium]` `[patch]` The *Vrijeme* column (62 pt, `noWrap`) was narrower than `16. 11. 2026. 10:42` at 8 pt and would spill into *Autor*; widened to 80 pt and allowed to wrap.
  - `[low]` `[patch]` The e2e proved the status line leaves on a view change only through a full reload; it now removes the team chip in the page (`HistoryPage.removeTeamChip`).
  - `[low]` `[patch]` No e2e ran the failure path; added one that aborts the writer's modules and asserts the alert, the label back and the focus kept (the hours export's test).
  - `[low]` `[patch]` EXPERIENCE.md and the hook's comment said any read removes the line; a refetch with identical data keeps the rows' identity, so the wording is now "a read that changes the rows".
  - `[low]` `[patch]` `history-body.tsx`'s doc comment re-wrapped.
- rejected: marker-only export enabled (the marker is a drawn row); long unbroken tokens; stale line after offline (the export unmounts outside the ready state); remount mid-build double download; further rolldown splits and lazy-route chunk placement (tests find chunks by marker; one entry today); unoffered filter label and period words vs dates (the hook passes the offered filters, so neither can differ); file name ignoring filters; e2e file-name regex for an empty organization name; `fileNameSafeOf` coupling (spec decision); walker/format-12 detector completeness; organization-source begins test; midnight generation test; epic context regenerated per the workflow; spec/sprint status mid-run; rolldown runtime chunk nuance (it holds interop only); no-feedback when the view changes mid-build (the hours pattern); failure wording; empty-rows e2e (pure rule unit-tested); PDF byte content and network observation in e2e; hook/component unit tests (the repo has none; e2e covers them in CI).

### 2026-11-16 — Independent second review (rendered PDF)
- patch: 3 (high 1, low 2)
- defer: 1 (low)
- addressed_findings:
  - `[high]` `[patch]` On a rendered export, one unbroken word (a long e-mail address or link) in a `'*'` column widened the whole table past the page, so *Bilo* and *Sada* went off the page for every row. All columns, and the two sides of a change, now have widths in points computed from the page, so pdfmake breaks the word inside its cell. Pinned in `pdf.test.ts`.
  - `[low]` `[patch]` Each change's sides sat 2 pt lower than the row's other cells, because the nested table added its own padding. The nested table now has no padding on its outer edges, so *Bilo* starts where the row's text does and *Sada* sits under its header.
  - `[low]` `[patch]` Nothing loaded the production writer chunks (the e2e runs the dev prebundle). `test/static-hosting.test.ts` now imports the built `pdfmake-*`/`vfs_fonts-*` chunks, checks that their `default` is the writer and the vfs, and writes a `%PDF-`. The I/O matrix "View changes" row now says "a read that changes the rows".
- deferred: a row split across a page break continues with empty identifying cells (`dontBreakRows` drops a row taller than a page in 0.3.13).

## Design Notes

Document sketch (pdf.ts):
```ts
{ pageOrientation: 'landscape', pageSize: 'A4', pageMargins: [32, 40, 32, 40],
  info: { title: model.title }, defaultStyle: { font: 'Roboto', fontSize: 8 },
  footer: (page, pages) => ({ text: model.pageText(page, pages), alignment: 'right', margin: [32, 12] }),
  content: [ { text: model.title, bold: true, fontSize: 14 }, ...model.lines.map((text) => ({ text })),
    { table: { headerRows: 1, widths: [80, 70, 90, '*', '*', '*'],
      body: [ headerCells, ...rows.map(rowCells) ] } } ] }
// rowCells: [time, author, {stack:[kind, badge?]}, subject, {colSpan:2, table/none}, {}]
```
Bold = Roboto-Medium; italic badge = Roboto-Italic — the font test checks each string against the face it uses.

## Epic AC Deviations

- "the file holds exactly the filtered rows in their order … with the organization name, the period and the generation time": met; the header also lists the active filters and the begins statement. No deviation.
- "the PDF writer is lazily loaded in `apps/web` only, and the spine's Stack table names its pinned version": met (0.3.13). No deviation.
- UX-DR51's single *Bilo → sada* column is drawn in the PDF as two columns, *Bilo* and *Sada* (Roboto has no `→`; spine AD-11). Reinterpreted.

## Verification

**Commands:**
- `export PATH=/root/.local/bin:$PATH` first.
- `pnpm install` -- lockfile consistent.
- `pnpm typecheck`, `pnpm lint` -- exit 0.
- `pnpm -r test` -- pass except the 4 known Node-22 `format.test.ts` cases (rerun a `leave-overview` timeout).
- `pnpm build` -- exit 0; compare entry chunk size with the baseline build; `grep` `apps/web/dist/sw.js` shows no writer chunk.
- `pnpm exec vitest run test/resource-hygiene.test.ts test/supabase-scaffold.test.ts test/import-cycles.test.ts test/feature-boundaries.test.ts test/key-hygiene.test.ts test/theme-contrast.test.ts test/localization-applied.test.ts test/static-hosting.test.ts` -- all pass (the 2 known `test/e2e-fixture.test.ts` failures are not in this list).

**Manual checks (if no CLI):**
- No local stack: the e2e download runs only in CI.

## Auto Run Result

Status: done (review complete; e2e runs only in CI).

**Summary:** *Povijest promjena* has `Izvezi u PDF`. `history-export.ts` builds a writer-agnostic model from exactly the ready view's `rows` (memoized in `useChangeHistory`, so their identity is stable) plus the organization, the period words and dates, the three filter lines in the chips' words, the summary, the generation time in the organization's zone and the begins statement; *Bilo* and *Sada* are two columns (Roboto has no `→`). `pdf.ts` is the only module importing `pdfmake` (0.3.13, pinned exactly; 0.3.14 is under the spine's two-week age rule until 2026-11-22), by `import()` only, and registers the fonts with `addVirtualFileSystem`. The writer's chunks are kept out of the precache (`globIgnores`), so the export is online only, as the history.

**Files changed (key):**
- `apps/web/src/features/history/services/history-export.ts` (+ test): the model, header lines, file name, guard.
- `apps/web/src/features/history/services/pdf.ts` (+ test incl. cmap font-coverage), `services/pdfmake.d.ts`: the only writer module and its types.
- `apps/web/src/features/history/hooks/use-history-export.ts`, `components/history-export.tsx`; `use-change-history.ts` (memoized ready view with `period`, `organizationName`, `zone`), `history-body.tsx`.
- `hr.json` `history.export.*`; `vite.config.ts` `globIgnores`; `eslint.config.js` `FEATURE_PUBLIC.hours` += `services/hours-export`; `apps/web/package.json` + lockfile (`pdfmake` 0.3.13).
- Tests/pins: `test/static-hosting.test.ts`, `test/localization-applied.test.ts`, `test/resource-hygiene.test.ts`, page sweep/key-source/source-guard fixtures.
- e2e: `e2e/pages/history.page.ts`, `e2e/tests/history/history.spec.ts` (download, status line, chip-driven removal, failure path, member has no button).
- Docs: UX-DR51 (`epics.md`), EXPERIENCE.md, spine Stack row and AD-11 `Applied 2026-11-16 (story 14.3)`, `epic-14-context.md` (recompiled).

**Review:** 7 patches (medium 3, low 4), 2 deferred (low), 22 rejected.

**Follow-up review:** recommended (patched medium 3, low 4; score 3×3+4 = 13).

**Verification:** `pnpm install --frozen-lockfile` up to date; `pnpm typecheck` 0; `pnpm lint` 0; `pnpm build` 0 — entry chunk 1,760.6 kB vs 1,755.8 kB at baseline (+0.27%, the export code and words), writer chunks `pdfmake-*.js` 769 kB and `vfs_fonts-*.js` 855 kB absent from `sw.js`, precache 14 entries (13 + a 0.6 kB `rolldown-runtime` interop chunk); `pnpm -r test`: domain 734/734, web 6439 pass, 4 fail (the known Node-22 `format.test.ts` cases); 8 DB-free root tests (resource-hygiene, supabase-scaffold, import-cycles, feature-boundaries, key-hygiene, theme-contrast, localization-applied, static-hosting) 2923/2923.

**Deferred inputs:** no `deferred-work.md` entry is addressed to 14.3 (grep `14.3`, `Epic 14`); the closed entries leaving work to "Epic 14's history" were satisfied by 14.1/14.2.

**Residual risks:** the real writer (UMD interop of `pdfmake/build/pdfmake` and the CJS `vfs_fonts` in the built bundle, and the download) runs only in CI e2e; nobody has looked at the rendered pages; user-written characters outside Roboto print as boxes (deferred).

