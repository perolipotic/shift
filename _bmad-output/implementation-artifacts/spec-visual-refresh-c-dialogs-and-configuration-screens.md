---
title: 'Visual refresh C — dialogs, new primitives and the configuration screens'
type: 'feature'
created: '2026-09-25'
status: 'done'
review_loop_iteration: 0
baseline_commit: '270f10d8bea8e5f4ed828aaa38b3baf7c5ef1efc'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-visual-refresh-b-content-screens.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-shift-2026-09-02/DESIGN.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-shift-2026-09-02/EXPERIENCE.md'
  - '{project-root}/_bmad-output/planning-artifacts/sprint-change-proposal-2026-09-25-organization-settings.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** After parts A and B, the configuration screens still had the following shape:
- The add forms sat inline above their lists.
- An edit was a separate page with a trailing "back" button.
- Confirmations were buttons that appeared in the page.
- The hour band list and the organization form read as plain stacks of fields.

The owner supplied mockups for Satni pojasi, Organizacija, Postavke rotacije, Ljudi, Nova osoba and Smjene. The owner asked for new primitives, dialogs wherever they fit, and confirmations that are actually modal.

**Approach:**
- New primitives in `components/ui`: `Dialog` and `ConfirmDialog` on the native `<dialog>`, `Callout`, `IconTile`, `StatTile`, `InputGroup`, `OutputField`, `Timeline` and `PageDescription`. `Button` gains a `dashed` variant.
- Hour bands, shift types and teams: add in a dialog opened from the list. Edit in a dialog over the list, driven by the existing `$id` route, with remove or archive beside Save and the confirmation replacing the form inside the dialog.
- Member confirmations (a new password, a status change, a team change): `ConfirmDialog`, keeping each screen's armed state exactly as it was.
- Every screen gets a lede, and fields get leading icons. The hour band screen gets a table, a 24-hour timeline and coverage tiles. The organization form gets an aside, and Ljudi gets icon stat cards and filters inside the table card. The member forms get sections, and the member page gets cards.
- Human decisions taken during the build:
  - **The organization form drops Organization Type and timezone.** Both are written back unchanged, and the timezone is shown read-only. This is recorded by the sprint change proposal of 2026-09-25.
  - **The leave year's start is a day (1–28) and a month**, not a date picker.
  - **An hour band shows its computed end beside its start.** It is never entered (AD-3), and a stored end was declined for now.
  - **Remove and archive stay neutral, never `destructive`** (UX-DR4).
  - **A scheduled team or status change is set apart** on the member page and marked in the member list's team cell.

## Boundaries & Constraints

**Always:**
- Everything parts A and B require: Croatian keys only; light and dark; phone-first; the `h-11` floor; `destructive` never in screens; no state carried by colour alone; OKLCH tokens; no test threshold lowered.
- Primitives contain no `t()` and no literals. A dialog's close label is the screen's.
- Every decision lives in a tested pure `.ts` module (AD-15). That covers the hour band preview, tones, boundaries and scale in `@/hour-bands/list`; the leave-start lists in `@/organization/leave-start`; and the team cell's scheduled marker in `@/members/list`.
- The `$id` routes stay, so a link opens a record and Back closes its dialog.
- Pinned counts in tests may change to match intentional additions, each noted in its test comment.

**Ask First:**
- A new colour token.
- A stored hour band end (migration, domain change).
- Any npm dependency.

**Never:**
- New queries, data, routes or migrations.
- The shift-slot ramp on the hour band timeline.
- A band's tone chosen by its name.

</frozen-after-approval>

## Code Map

- `apps/web/src/components/ui/{dialog,callout,icon-tile,stat-tile,input-group,output-field,timeline}.tsx` — new primitives. `page-header.tsx` gains `PageDescription`, and `button.tsx` gains `dashed`.
- `apps/web/src/hour-bands/list.ts` — `hourBandPreviewOf` (the end a typed start would give), `HourBandTone`, `PartitionBar.boundaries`, `DAY_SCALE`.
- `apps/web/src/organization/leave-start.ts` — `LEAVE_START_DAYS` (1–28) and `LEAVE_START_MONTHS` (CLDR names).
- `apps/web/src/members/list.ts` — `teamCellOf` and `teamMarkerMessageKey`. The team cell carries the change scheduled after today.
- Routes:
  - `organizacija.satni-pojasi(.$id).tsx`, `postavke-rotacije(.tipovi-smjena.$id).tsx` and `ljudi.smjene(.$id).tsx` — list, add dialog, and edit dialog over the list.
  - `organizacija.tsx` — the organization form and aside.
  - `ljudi.tsx`, `ljudi.novi.tsx` and `ljudi.$id.tsx` — the member list, form and page.
- `e2e/{hour-bands,teams,team-position,fire-ranks}.spec.ts` — open the add dialog first, and edit a band in its dialog.

## Tasks & Acceptance

- [x] Primitives written, documented in `components/README.md` and DESIGN.md.
- [x] The hour band list: a table, a timeline, coverage tiles, and an add dialog showing the computed end. The edit dialog puts remove beside Save, with the confirmation in the dialog and no back link.
- [x] Shift types and teams: the same list, add dialog and edit dialog pattern.
- [x] Organization: a lede, an aside with the read-only timezone, the day and month leave start, and no type or timezone field.
- [x] Member confirmations are modal. The member list, form and page are restyled. A scheduled team change is marked in the list and set apart on the page.
- [x] EXPERIENCE.md: modal confirmations, dialogs for small records, computed values shown, and scheduled changes set apart.

**Acceptance:**
- **Given** an admin on any list above, **when** they add or edit, **then** it happens in a dialog.
  - Escape, the backdrop and the close button leave it.
  - A refused save keeps the typed values.
  - An edit dialog's URL is the record's own.
- **Given** a remove or archive, **when** it is offered, **then** one question naming the subject is asked in a dialog. The dialog cannot be dismissed while the write is in flight.
- **Given** a member with a team change dated after today, **when** the list renders, **then** the team cell shows "Od {date}: {team}" beside today's team.

## Verification

- `pnpm --filter @shift/web test`: 1879 passed.
- Root `vitest`: the hygiene, localization and theme suites pass. Failures in the RLS and DB inventory suites follow the shared local database's state, not this change.
- `pnpm lint` and `pnpm typecheck`: clean.
- `pnpm test:e2e`: 28 passed.
- Every changed screen was screenshotted in light mode at 1440 px; the hour bands also in dark at 390 px, and Ljudi checked at 320 px by the responsive suite.

## Suggested Review Order

1. `components/ui/dialog.tsx` — the modal contract everything else relies on.
2. `hour-bands/list.ts` and its tests — the preview, tones and marks.
3. `routes/organizacija.satni-pojasi.tsx` and `.$id.tsx` — the pattern the other lists copy.
4. `routes/organizacija.tsx` — the fields that left the form, and `organization/leave-start.ts`.
5. `members/list.ts` `teamCellOf` and the member screens.
6. `routes/prijava.test.ts` — every pinned count that moved, each with its reason.
