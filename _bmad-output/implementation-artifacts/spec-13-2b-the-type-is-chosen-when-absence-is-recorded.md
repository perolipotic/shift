---
title: 'Story 13.2b: The type is chosen when absence is recorded'
type: 'feature'
created: '2026-11-09'
status: 'done'
baseline_commit: 'f9277fb8799eb4210a1d9c17cbf9aa640a6a4102'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-13-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-13-2-leave-has-a-type-everywhere-it-is-recorded-or-reported.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Since 13.2, balances and *Sati* read each record's type, but no session can write a type other than annual leave. The dialog, the request form and approval all write the default.

**Approach:** This is the write side of 13.2. Split at the checkpoint (PO, 2026-11-09): the neutral narrative wording is 13.2c.
- Migration `0054` lets a session name the type and carries it through approval and amend.
- A radio card group chooses the type in the admin leave dialog and in the member's request form.
- The admin and the member themselves see the type where a record or request is shown.

## Boundaries & Constraints

**Always:**
- **Migration `0054_absence_type_writes.sql`:**
  - `leave_records` insert grant gains `absence_type_id`.
  - `leave_requests` gets `absence_type_id uuid not null default` the annual id, with a composite FK `(organization_id, absence_type_id)` → `absence_types` (no cascade) and an index. Its insert grant gains the column.
  - `decide_leave_request` (latest 0046:37) copies the request's type into the record it writes.
  - `amend_leave_record` is dropped and recreated with `p_absence_type_id uuid default null`; null keeps the record's type. The old body and grants (0043:738) are restated.
  - Nothing else changes. The defaults keep old cached clients writing annual leave.
- **The choice (UX-DR50, PO Q3):**
  - `RadioCard`s list every type in the snapshot's `absenceTypes`, in its order, each named by its name and whether it draws. A member may request any type. A single type is still a required one-card group.
  - The group comes after *Od*/*Do* and before the preview (UX-DR47's order).
  - Nothing is preselected on record or request. Until a type is chosen, a reason line ("Odaberi vrstu odsutnosti.") stands in place of the preview. A send without a type marks and focuses the group and sends nothing.
  - Amend prefills the record's type. An amend is unchanged only when both the range and the type are the same.
- **Preview:** it uses the chosen type's `drawsAllowance` through 13.2's `leavePreviewOf`. A non-drawing range shows its days and a line saying the leave balance does not change. Collisions and short-staffing count every type.
- **Type names, admin and self only (PO 2026-11-09):**
  - The admin sees the type as a fact: on each record row on the member page, in the amend dialog, and on the request decision screen, which previews by the request's own type.
  - The member sees the type on each row of their own requests.
  - On the member's *Danas*, the leave case names the type of today's record, and its *Troši … godišnjeg* line shows only the days of drawing records, and only when that sum is more than zero.
  - A snapshot without `absenceTypes`, or a record or request naming an unknown type, makes that surface unavailable, never guessed.
- **The neutral lines this story owns:**
  - The ◷ label and legend (`kalendar.modifier.leave`) read *Odsutnost*.
  - `zaOdluku.resolution.replaceReason` reads "Zamjena za {member} (odsutnost)". Noun forms only: never *odsutan*.
- **The *Uredi* hint (Q8):** the edit dialog of a non-annual type shows a static line: changing whether the type draws re-derives every balance. There is no confirmation.
- DI-8: no type is named in code.
- **Working rules:**
  - Work only in this worktree.
  - Never commit, push, amend, force-push or `git stash`.
  - Use `PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH"`.

**Ask First:** a trigger or check on the type; limiting which types a member may request; any change to collisions or staffing.

**Never:**
- choosing or changing the type at approval;
- a type name in email, push, or any read of another member's leave;
- the 13.2c copy: admin narrative lines, notification texts, request-form headings;
- rewriting stored override reasons (Q9);
- half days or carry-over;
- applying, resetting or `up`-ing migrations on the shared Supabase stack (read-only `psql` only), patching the harness, or running DB-connecting root tests locally.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Record | admin picks *Bolovanje* (not drawing), 3 working days | preview 3 dana, balance after = balance now, the unchanged-balance line; the row names *Bolovanje* | N/A |
| No type | dates entered, no card chosen | reason line; Spremi marks/focuses the group | nothing sent |
| Type-only amend | same range, annual → *Bolovanje* | valid and saved; the balance gives the days back | N/A |
| Unchanged amend | same range, same type | the unchanged reason, as today | nothing sent |
| Request | member picks a type and sends | the request row names it; approval's record carries it | N/A |
| Old client | insert without `absence_type_id` | annual leave | N/A |
| Foreign type | another org's type id | 23503 → generic failure | logged |
| Old cache | snapshot without `absenceTypes` / request row without type | dialog/form unavailable until re-read / annual | retry |
| Member *Danas* | today in a non-drawing record | names its type; no *Troši* line | N/A |

## Epic AC Deviations

- AC 1 (radio card group in the leave dialog and the request form): met.
- AC 2: met in 13.2. Unchanged here, because every chosen type still raises a collision.
- AC 3 (another member reads *odsutan*, never the type): met, REINTERPRETED in its word. The PO chose noun forms (2026-11-09): the app stores no gender, so every line reads *odsutnost*, never the gendered *odsutan*. A member's calendar carries only their own leave (EXPERIENCE.md "Conflict"). The one text another member can read is a replacement reason, which now says *(odsutnost)*. The neutral admin narrative lines are not part of this AC and are 13.2c (PO Q6/Q7).
- AC 4: shipped in 13.2.
- AC 5: UX-DR12, 47 and 50 and their DESIGN.md / EXPERIENCE.md lines (17 shipped in 13.2).

</frozen-after-approval>

## Code Map

- `supabase/migrations/0040_leave_requests.sql:132,350` -- the table and its insert grant; `0028:191` -- the records grant; `0046:37` decide; `0043:738` amend; `0052` -- the FK and index shape to copy
- `apps/web/src/features/leave/services/leave-section.ts:375` `leavePreviewStateOf` (the unchanged rule at :383; rows at :170) -- shared by the dialog, the request form (`my-leave.ts:325`) and the decision screen (`leave-request-review.ts:275`)
- `leave/services/leave-write.ts:277` `recordLeave`, `:402` `amendLeave`; `leave-request-write.ts:219` `sendLeaveRequest` -- add the type
- `leave/services/leave-request-list.ts:54,73` -- request columns gain `absence_type_id`; a row without it is annual (as `leave-list.ts:117`)
- `leave/hooks/use-member-leave.ts:300,649,744` -- preview, save, amend; `components/member-leave-dialog.tsx`, `member-leave-records.tsx`
- `leave/hooks/use-leave-request-form.ts`, `components/leave-request-form.tsx`, `my-leave-requests.tsx`, `leave-request-review-body.tsx`
- `calendar/services/snapshot.ts:431` `absenceTypesOfCalendar` -- the catalog (update its "only *Sati* reads it" comments, :111 and :315)
- `components/ui/radio-group.tsx` `RadioCard`; `organization/components/organization-absence-types-card.tsx:182` -- the hint beside `drawsLocked`
- `today/services/today.ts:479` `todayCaseOf` (records joined by `absenceOn` :340), `today/components/today-card.tsx:39`
- `conflicts/components/conflict-resolution-body.tsx:245`, `resolution-screen.test.ts:782`; `calendar/utils/modifiers.ts:145`
- e2e: `pages/people.page.ts:756` `enterLeave`, `pages/leave.page.ts:192` `enterRequest` (they must pick a type); `utils/database-helper.ts:1159` cleanup; `conflict-resolution.spec.ts:633` and the specs that read `kalendar.modifier.leave` take the key's new value
- Docs: `epics.md:131` (UX-DR12), `:181` (47), `:184` (50); `EXPERIENCE.md:40,64,106,141`; `DESIGN.md:364,373`

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0054_absence_type_writes.sql` -- the grants, the column, the FK, decide, amend
- [x] `test/supabase-scaffold.test.ts`, `rls-isolation.test.ts`, `provisioning.test.ts` -- pin 0054. A member's typed request; an admin's typed record; amend keeps or changes the type; approval copies it; a foreign type gives 23503. Written for CI, never run locally
- [x] `leave-section.ts`, `leave-write.ts`, `leave-request-write.ts`, `leave-request-list.ts`, `my-leave.ts`, `leave-request-review.ts` (+tests) -- the type in preview, write and parse; the unchosen reason; the unchanged rule; the matrix rows
- [x] leave hooks and components -- the `RadioCard` group, the non-drawing line, the type on rows and on the decision screen
- [x] `today/services/today.ts`, `today-card.tsx` (+tests) -- the type and the drawing-only cost
- [x] `organization-absence-types-card.tsx` -- the *Uredi* hint
- [x] `hr.json` (new keys; `kalendar.modifier.leave`, `replaceReason`), and `resource-hygiene.test.ts`, `localization-applied.test.ts` and the unit tests that pin those lines
- [x] `e2e/` -- the helpers pick annual leave; one spec records a non-drawing type and amends it back; cleanup deletes the run type's `leave_request_decisions`, `leave_records`, `leave_requests` before `absence_types`
- [x] Docs -- UX-DR12/47/50, EXPERIENCE.md, DESIGN.md; `deferred-work.md` -- mark :1404 (the open part) and :1416 RESOLVED by 13.2b, the latter naming 13.2c for the wording

**Acceptance Criteria:**
- Given a non-drawing record saved through the dialog, when the balance renders, then it is unchanged, while *Sati*'s *Ostala odsutnost* and the collision count it.
- Given any member-role session, when it reads anything about another member, then no type name reaches it.

## Design Notes

The catalog comes from the calendar snapshot, which the dialog, the form, the decision screen and *Danas* already wait on, so no read is added. Amend stays a remove-and-insert in one transaction. A type-only amend is therefore "amended" to 0047's `leave_record_change` and sends one `LEAVE_RECORD_CHANGED`, which is the truth.

## Verification

**Commands:**
- `PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH" pnpm lint && … pnpm typecheck` -- pass
- `… pnpm --filter ./packages/domain exec vitest run`, `… pnpm --filter ./apps/web exec vitest run`, `… pnpm exec vitest run test/supabase-scaffold.test.ts test/resource-hygiene.test.ts test/notify-boundary.test.ts test/localization-applied.test.ts` -- pass (no DB)
- DB tests and e2e run in CI only.

## Suggested Review Order

**The type travels through the database**

- Entry point: an approval now writes the request's own type into the record.
  [`0054_absence_type_writes.sql:135`](../../supabase/migrations/0054_absence_type_writes.sql#L135)

- Amend gains an optional type; null keeps the record's own.
  [`0054_absence_type_writes.sql:241`](../../supabase/migrations/0054_absence_type_writes.sql#L241)

- Requests carry a type, defaulting to annual so old clients still work.
  [`0054_absence_type_writes.sql:49`](../../supabase/migrations/0054_absence_type_writes.sql#L49)

- Column grants added, nothing restated or widened.
  [`0054_absence_type_writes.sql:42`](../../supabase/migrations/0054_absence_type_writes.sql#L42)

**One preview rule for dialog, form and decision screen**

- No type means a reason, not a preview; unchanged needs range and type equal.
  [`leave-section.ts:405`](../../apps/web/src/features/leave/services/leave-section.ts#L405)

- An empty or missing catalog makes the surface unavailable, never guessed.
  [`leave-section.ts:497`](../../apps/web/src/features/leave/services/leave-section.ts#L497)

- A record naming an unknown type makes the card unavailable.
  [`leave-section.ts:547`](../../apps/web/src/features/leave/services/leave-section.ts#L547)

- A non-drawing range states no in-year part.
  [`leave-section.ts:480`](../../apps/web/src/features/leave/services/leave-section.ts#L480)

**Writes and reads**

- Amend sends the chosen type; record and request inserts name it.
  [`leave-write.ts:436`](../../apps/web/src/features/leave/services/leave-write.ts#L436)

- [`leave-request-write.ts:241`](../../apps/web/src/features/leave/services/leave-request-write.ts#L241)

- Request reads select the type; a row without it is annual.
  [`leave-request-list.ts:57`](../../apps/web/src/features/leave/services/leave-request-list.ts#L57)

**Screens**

- The radio card group, after the dates and before the preview.
  [`member-leave-dialog.tsx:183`](../../apps/web/src/features/leave/components/member-leave-dialog.tsx#L183)

- The member's own requests name their type.
  [`my-leave-requests.tsx:81`](../../apps/web/src/features/leave/components/my-leave-requests.tsx#L81)

- The decision screen names the type as a fact for the admin.
  [`leave-request-review-body.tsx:67`](../../apps/web/src/features/leave/components/leave-request-review-body.tsx#L67)

- *Danas* charges only drawing records.
  [`today.ts:524`](../../apps/web/src/features/today/services/today.ts#L524)

- The conflict hand-off amends by the record's own type; *bez promjene* when nothing returns.
  [`resolution-screen.ts:356`](../../apps/web/src/features/conflicts/services/resolution-screen.ts#L356)

- The static *Uredi* hint for a non-annual type.
  [`organization-absence-types-card.tsx:20`](../../apps/web/src/features/organization/components/organization-absence-types-card.tsx#L20)

**Peripherals**

- e2e cleanup in FK order: decisions, records, requests, then types.
  [`database-helper.ts:1199`](../../e2e/utils/database-helper.ts#L1199)

- `hr.json`: *Odsutnost* legend, *(odsutnost)* reason, the new type keys.
  [`hr.json`](../../apps/web/src/lib/i18n/locales/hr.json)
