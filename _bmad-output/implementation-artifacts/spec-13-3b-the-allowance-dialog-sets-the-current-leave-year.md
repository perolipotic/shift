---
title: 'Story 13.3b: The allowance dialog sets the current leave year'
type: 'feature'
created: '2026-11-10'
status: 'done'
baseline_commit: 'd69d05660e0c8a9873376350d8b8aaf22768003d'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-13-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-13-3-the-allowance-is-set-per-leave-year.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Since 13.3 every balance resolves a per-year allowance, but *Promijeni pravo* still PATCHes `members.leave_allowance_days`, the starting allowance. That rewrites every leave year with no version of its own, past years included.

**Approach:** The write side split from 13.3 (PO, 2026-11-10).
- The dialog inserts a `leave_allowances` version for the current leave year.
- Migration `0056` takes UPDATE on the starting allowance away from sessions, so it is written only when a member is created.

Baseline is d69d0566 (13.3 merged). `hr.json` is a hot file, so no hot-file story runs in parallel.

## Boundaries & Constraints

**Always:**
- **Dialog (PO, 2026-11-10):**
  - It sets the current leave year only. The insert is `{organization_id, member_id, leave_year, days}`.
  - The year and the field's start value are held at opening: `leaveYearNumberOf(today, member.leaveYearStart)` and `memberAllowanceOn(member, today)`. A save at midnight writes the year the dialog shows.
  - Under the field it shows the hint "Vrijedi od {year}. dok se ne promijeni." (new key `ljudi.allowance.validFrom`), tied to the field with `aria-describedby`.
  - *Promijeni pravo* is disabled while today or the leave-year start is unknown.
  - The existing validation (`enteredAllowance`), the offline gate, the focus return and the *spremljeno* notice stay.
  - A refusal maps through `editFailureOf`, so a 42501 reads as *refused*.
  - A save invalidates `MEMBERS_LIST_KEY` (the only read that embeds `leave_allowances`) with `NO_DEPENDENTS`.
- **The member PATCH:** `MemberEdits` no longer carries `leaveAllowanceDays`, and `memberPatchOf` cannot send it. Create keeps it.
- **`0056_members_allowance_privilege.sql`:**
  - `revoke update on table public.members from authenticated, anon;` (anon included: PO, 2026-11-10)
  - `grant update (name, email, role, username, fire_rank) on table public.members to authenticated;` These are every column sessions update today: the app PATCH, and admin-auth's caller-client username update.
  - No other change. INSERT stays, so admin-auth's create still writes the starting allowance.
- **Old persisted cache (decided here):** accepted, with no bump and no forced refetch.
  - Queries use the default `staleTime` 0, so a restored members query refetches on mount when online.
  - Writes are gated offline, and the save invalidates the list.
  - A pre-13.3 row therefore misstates only offline, and only after another device wrote a version.
- **DB tests (CI only):**
  - Every session UPDATE of `leave_allowance_days` in `rls-isolation` is rewritten to a granted column with the same shape (no `where` and a constant, where the case depends on that).
  - Add cases: an admin's PATCH of `leave_allowance_days` gets 42501 and the row is unchanged; the five-column grant is pinned in `provisioning`; 0056 is pinned in `supabase-scaffold`.

**Ask First:** a write of any year other than the current one; a change to the privileges of a column other than `leave_allowance_days`; any copy beyond `validFrom`.

**Never:** carry-over (13.4); the overview year stepper; a backfill or a change to `members.leave_allowance_days` values; applying 0056 locally, patching `test/database.ts`/`e2e/utils/*` to apply it, running DB-connecting root tests locally; committing.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| First change | starting 20, no version, year 2026 | field 20; enter 25 → insert `leave_year 2026, days 25`; card *Pravo* 25 | N/A |
| Correction | v(2026)=25 | field 25; enter 24 → second 2026 row, resolves 24 | N/A |
| Inherited | v(2025)=22, year 2026 | field 22; save writes a 2026 row | N/A |
| Unknown year | `leaveYearStart` null | button disabled | N/A |
| Unchanged value | field saved as opened | nothing written; dialog closes, no *spremljeno* notice, focus to opener (PO, 2026-11-10) | N/A |
| Bad value | `-1`, `20.5`, > smallint | refused before sending, field marked | MEMBER_WRITE_INVALID |
| Not admin / inactive | RLS with check fails | dialog stays open | 42501 → MEMBER_WRITE_REFUSED |
| Session PATCH of starting allowance | any session | refused | 42501 |

## Epic AC Deviations

- AC 1 ("each member's current single value becomes their allowance for the current leave year"): REINTERPRETED in 13.3 (starting allowance, no backfill), unchanged here.
- AC 2 ("Given an allowance changed for this year, a past year's balance uses that year's allowance"): delivered end to end now. NARROWED (PO, 2026-11-10): the app changes only the current leave year, and setting a past or future year stays out. No surface shows a past year until the overview year stepper (deferred).

</frozen-after-approval>

## Code Map

- `apps/web/src/features/members/components/member-allowance-dialog.tsx` -- the field (`defaultValue` :107), the place for the hint; the button :42
- `apps/web/src/features/members/hooks/use-member-basics.ts` -- `openMemberDialog` :101 (hold the year and days in `DialogOpening<Held>`, see `member-edit-context.ts`), the `ALLOWANCE_SAVE` branch of `submit` :163-176, the save and invalidation :202-247
- `apps/web/src/features/members/services/write.ts` -- `MemberEdits` :338, `memberPatchOf` :584, `saveMember` :604; add `saveAllowance` beside it; `wire.ts:611` `editFailureOf` (fix its :629 comment)
- `apps/web/src/features/members/services/list.ts` -- `memberAllowanceOn` :714, `MemberListRow.organizationId/leaveYearStart`; `@shift/domain` `leaveYearNumberOf`
- `supabase/migrations/0004_organization_settings.sql:126-134` -- the revoke and column-grant precedent; `0055` header style
- `supabase/functions/admin-auth/operations.ts:811,930,950` -- caller-client insert and username updates (must keep working)
- `test/rls-isolation.test.ts` -- session updates at :1616, :1645, :1995, :3583-3594, :3685-3714 (no-`where` constant shape), :3792, :6823-6839, :17893; `test/name-key.test.ts:364` (check whether it runs as a session); `test/concurrent-writes.test.ts` (only superuser inserts; verify, expect no change); `test/provisioning.test.ts:760-1040` (privilege-case pattern); `test/supabase-scaffold.test.ts:3258` (0055 block to copy)
- `e2e/pages/people.page.ts:400` `changeAllowance`; `e2e/tests/people/people.spec.ts:610-665`
- `ARCHITECTURE-SPINE.md:65` -- AD-2 *Leave allowance* row; `EXPERIENCE.md:106` -- "`Promijeni pravo` … (the allowance alone)"

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0056_members_allowance_privilege.sql` -- the revoke and the column grant, with a header naming the 13.3b reason
- [x] `ARCHITECTURE-SPINE.md` -- append `Amended 2026-11-10 (story 13.3b)` to AD-2's *Leave allowance* row: sessions cannot update the starting allowance; the app writes only versions
- [x] `members/services/write.ts`, `wire.ts` (+`write.test.ts`) -- `saveAllowance`, `MemberEdits` without the allowance, the matrix's refusal rows
- [x] `members/hooks/use-member-basics.ts`, `member-edit-context.ts`, `components/member-allowance-dialog.tsx`, `pages/structural-pins-members.test.ts` -- the held year and days, the hint, the disabled button, the insert path
- [x] `apps/web/src/lib/i18n/locales/hr.json` -- `ljudi.allowance.validFrom`
- [x] `test/rls-isolation.test.ts`, `name-key.test.ts`, `provisioning.test.ts`, `supabase-scaffold.test.ts` -- the rewrites and the new cases (CI)
- [x] `e2e/pages/people.page.ts`, `e2e/tests/people/people.spec.ts` -- `changeAllowance` awaits the POST to `/rest/v1/leave_allowances`; the dialog steps assert the hint and the prefilled resolved value; grep `e2e/` for `leave_allowance_days` and the members PATCH
- [x] `EXPERIENCE.md:106` -- the allowance dialog sets the current leave year, prefilled, with the hint
- [x] `deferred-work.md` -- mark the 13.3b entry and the old-cache entry `RESOLVED by 13.3b (2026-11-10)`

**Acceptance Criteria:**
- Given an admin on a member page, when they save 25 in *Promijeni pravo*, then one `leave_allowances` row for the current leave year is inserted, no members PATCH is sent, and *Pravo* and *Preostalo* show 25 from one snapshot.
- Given 0056, when admin-auth creates a member or renames one, then both succeed as before.

### Review Findings

- [x] [Review][Patch] The hint names a calendar year where the leave year starts mid-year (DECIDED 2026-11-10: show the leave year's date range, in the form Organizacija uses, e.g. "Vrijedi za godinu godišnjeg {from} – {to} dok se ne promijeni.") — "Vrijedi od {year}. dok se ne promijeni." renders `yearTextOf(held.leaveYear)`. With a leave-year start of 1 July, a dialog opened in March 2027 says "Vrijedi od 2026." while the version covers 1.7.2026–30.6.2027. Organizacija already names a leave year as "Tekuća godina godišnjeg: {from}–{to}". Copy is Ask First.
- [x] [Review][Patch] An unchanged value is written when the record moved under the dialog (DECIDED 2026-11-10: keep the code; add the matrix row "record moved under the dialog → a version is written" outside the frozen block) — the matrix says "field saved as opened → nothing written", but `allowanceSaveOf` (write.ts:771) writes a version when the latest row no longer resolves the held year to the entered value (another admin saved meanwhile) or the row is gone. It avoids a silently dropped revert, but it departs from the frozen row.
- [x] [Review][Patch] E2E never checks which leave year is written or named [e2e/pages/people.page.ts:400] — `allowanceHint` accepts any `\d{4}` and `changeAllowance` checks only `response.ok()`. Wiring that writes the previous leave year, or a hint that shows the calendar year, still passes, because a previous-year version is inherited and *Pravo* reads 25. Assert the POST body (`leave_year` = the fixture's current leave year via `leaveYearStartOf`, `days`) and build the hint with that exact year.
- [x] [Review][Patch] The members WITH CHECK clause is no longer exercised [test/rls-isolation.test.ts:1798] — NO CHANGE NEEDED: `supabase-scaffold.test.ts:822` already pins the update policy's WITH CHECK on `organization_id` by policy name. Original finding: the two cases that move a member into another org now stop at the missing column privilege. `members_update_by_own_active_admin`'s WITH CHECK (0003:343) is unreachable by sessions today, but nothing would notice if it were loosened before a later grant. Add a source pin of the clause in `supabase-scaffold.test.ts`.
- [x] [Review][Patch] The table-wide grant guard misses schema-wide and `public` grants [test/supabase-scaffold.test.ts:3360] — `grant update on all tables in schema public to authenticated` and a `public` grantee pass. Add both shapes, with non-vacuity cases.
- [x] [Review][Patch] The injected-claims case interpolates a SQL literal [test/rls-isolation.test.ts:2041] — bind the email as `$2`, as the rest of the file does.
- [x] [Review][Patch] Stale comments [apps/web/src/features/members/hooks/use-member-basics.ts:56] — "the allowance dialog's one" still reads as a member-write field. `wire.ts:633` "no unique key at all" (the identity primary key is unique: say no key a session's values can collide with). `use-member-edit.ts:85` has a broken reflow.
- [x] [Review][Patch] The deploy-order entry ignores installed PWAs [_bmad-output/implementation-artifacts/deferred-work.md:1453] — `registerType: 'prompt'` keeps an old bundle running past a deploy, so "before or together with" is not enough: an old client PATCHes the starting allowance and reads *refused*. Say to apply 0056 a release after the frontend, or once stale clients are gone (see the 8.1 entry at :946).
- [x] [Review][Defer] *Promijeni pravo* disabled while no year is known is pinned only by source text [apps/web/src/features/members/components/member-allowance-dialog.tsx:51] — deferred, pre-existing: render tests are deferred project-wide.
- [x] [Review][Defer] A landed save whose re-read fails shows the old *Pravo* beside *spremljeno* [apps/web/src/features/members/hooks/use-member-basics.ts:296] — deferred, pre-existing: every member save shares `refreshAfterWrite`'s resolve-on-failure.

## Design Notes

**Amended at code review (PO, 2026-11-10), outside the frozen block:**
- The hint is "Vrijedi od godine godišnjeg {from}–{to} dok se ne promijeni.", the held leave year's first and last day in the form Organizacija uses (*Tekuća godina godišnjeg: {from}–{to}*). The calendar year alone misnamed a leave year starting mid-year. `HeldAllowance` holds `from` and `to` from `leaveYearOf` at opening.
- The matrix's *Unchanged value* row holds while the record is as the dialog read it. When the record moved under the dialog (another admin saved a version, or the row is gone), the entered value is written as a version, so a revert is never dropped without a trace.

The year is held at opening, because 13.3's resolver keys a version by leave year. If the year were recomputed at save, a dialog opened before the leave-year boundary would write next year's version under a hint naming this year.

## Verification

**Commands:**
- `PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH" pnpm lint && … pnpm typecheck` -- pass
- `… pnpm --filter ./apps/web exec vitest run` -- pass
- `SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:1/postgres … pnpm exec vitest run test/supabase-scaffold.test.ts test/resource-hygiene.test.ts` -- pass. The DB-connecting files fail on the dead port, which is expected. DB tests and e2e run in CI.

## Suggested Review Order

**The decision: which year, and whether to write**

- Entry point: the year and resolved days held when the dialog opens.
  [`write.ts:745`](../../apps/web/src/features/members/services/write.ts#L745)

- Unchanged only if the held value still resolves now; otherwise a version for the held year.
  [`write.ts:771`](../../apps/web/src/features/members/services/write.ts#L771)

- The insert: one append-only version; 42501 refused, 23503 the member gone.
  [`write.ts:797`](../../apps/web/src/features/members/services/write.ts#L797)

- The member PATCH can no longer carry the allowance.
  [`write.ts:346`](../../apps/web/src/features/members/services/write.ts#L346)

**Wiring on the member page**

- Submit routes the allowance to the insert; no held year is a refusal, not silence.
  [`use-member-basics.ts:215`](../../apps/web/src/features/members/hooks/use-member-basics.ts#L215)

- Explicit per-scope opening, so the allowance never opens the basics dialog.
  [`use-member-basics.ts:121`](../../apps/web/src/features/members/hooks/use-member-basics.ts#L121)

- An allowance save re-reads the members list only.
  [`use-member-basics.ts:305`](../../apps/web/src/features/members/hooks/use-member-basics.ts#L305)

- The hint names the held year; the button is disabled while no year is known.
  [`member-allowance-dialog.tsx:117`](../../apps/web/src/features/members/components/member-allowance-dialog.tsx#L117)

**Privilege**

- Table revoke from both session roles, five-column grant back.
  [`0056_members_allowance_privilege.sql:33`](../../supabase/migrations/0056_members_allowance_privilege.sql#L33)

- AD-2 amendment, including the column-grant rule for future member columns.
  [`ARCHITECTURE-SPINE.md:75`](../planning-artifacts/architecture/architecture-shift-2026-09-02/ARCHITECTURE-SPINE.md#L75)

**Peripherals**

- Executed unit tests for the helpers, incl. a save across the leave-year boundary.
  [`write.test.ts:2856`](../../apps/web/src/features/members/services/write.test.ts#L2856)

- The session PATCH of the starting allowance gets 42501 (CI).
  [`rls-isolation.test.ts:1641`](../../test/rls-isolation.test.ts#L1641)

- Grant pinned from `information_schema` (CI).
  [`provisioning.test.ts:886`](../../test/provisioning.test.ts#L886)

- Source pins of 0056 and the table-wide-grant guard.
  [`supabase-scaffold.test.ts:3326`](../../test/supabase-scaffold.test.ts#L3326)

- E2E: unchanged save writes nothing; a changed one posts a version.
  [`people.spec.ts:691`](../../e2e/tests/people/people.spec.ts#L691)
