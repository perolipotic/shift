---
title: 'A member opens Godišnji and sees their own allowance, days used and balance (5.2c)'
type: 'feature'
created: '2026-10-01'
status: 'done'
baseline_commit: 'b0f3e32b0ee2d24ab3ec01ffcd8615610fa1ba62'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
  - '{project-root}/e2e/README.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The admin records, amends and removes leave (5.1c, 5.2b), but the member tab Godišnji (`pages/godisnji.tsx`) is still only a title. A member cannot see how much leave is left (FR-45, CAP-15). Their only read path is a direct select on `leave_records`, and that select returns admin auth ids (`created_by`/`removed_by`).

**Approach:**
- Add migration `0030`, a SECURITY DEFINER function that returns only the caller's own live records, shaped `id, member_id, during`.
- Godišnji uses it to show the viewer's allowance, the days used in the current leave year and the balance, all computed by `leaveBalanceOf` from `@shift/domain`.
- It shows nobody else's leave.

## Boundaries & Constraints

**Always:**
- **The read function.**
  - Copy `calendar_roster_overrides()` (0026): `language sql stable security definer set search_path = ''`, no arguments.
  - Filter on: the JWT `organization_id`, an active `current_member_access()`, `members.auth_user_id = auth.uid()`, and `removed_at is null`.
  - Revoke execute from public, anon and service_role. Grant it to authenticated.
  - It never returns `created_by`, `removed_by` or another member's row, and it works for an admin's own member row too, because admins see the tab as well.
- **One computation.**
  - `features/leave/services` holds a pure `myLeaveOf`, built from:
    - the calendar snapshot (schedule, `viewer.memberId`, today in the org zone);
    - the viewer's own members row (`leave_allowance_days`);
    - the organization's leave-year start;
    - the function's records, parsed by `leaveRecordsOf`.
  - It returns figures or a state code, never strings. It catches the domain `RangeError` as unavailable.
- **The screen.**
  - Godišnji stays a thin page. It renders three `StatTile`s, in this order: allowance, used this leave year, balance. Each is a `count.days` plural, mirroring `hours-summary.tsx`.
  - While loading, a skeleton (no spinner).
  - A failed or paused read shows a `Notice role="alert"` with a retry.
  - A viewer with no team membership sees their own line, worded to the member. It states what is true, and no figures appear.
- **Freshness.** Use a new query key for the own records and add it to `LEAVE_WRITE_DEPENDENTS`. No optimistic figures (UX-DR29).
- **Registration.**
  - All copy comes from `hr.json` and is registered in the hygiene and string tests.
  - Godišnji moves from the placeholder slugs to the built slugs.
  - No horizontal scroll at 390 px.

**Ask First:**
- Listing the member's own records (dates), upcoming leave, or the leave-year span on the screen.
- Revoking table-wide SELECT on `created_by`/`removed_by` from `authenticated`. The leak stays in the ledger (deferred-work :618) unless approved.
- Any change to `domain/leave`, to 0028/0029, or to the admin card's behaviour.

**Never:**
- No leave request, edit or removal by a member, and no conflicts (5.3).
- No direct `leave_records` select from the member surface.
- No figure computed in SQL.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Figures | allowance 20; one own record over 3 working days in this leave year | 20 / 3 / 17 | skeleton while loading |
| No leave | allowance 20, no records | 20 / 0 / 20 | N/A |
| Others' leave | another member in the org has records | the viewer's figures are unchanged; the function returns none of their rows | N/A |
| Removed record | own record soft-removed | not returned; balance restored | N/A |
| Crosses year | record spans the leave-year start | only in-year days count | N/A |
| Over balance | used > allowance | negative balance shown as a number | N/A |
| No team | viewer has no membership | member-worded line, no figures | N/A |
| Read fails | rpc or snapshot error | alert + retry | `RangeError` → unavailable |
| Anon / other org | no JWT, or another tenant's records | refused / not returned | N/A |

## Epic AC Deviations

- **Met here:** "Given a member's own view, When they open their leave, Then they see their allowance, days used and balance, and no other member's (CAP-15, CAP-5)".
- **DEFERRED to 5.3 (unchanged from 5.2a/5.2b):** "every conflict it caused is cleared". Ledger: the 5.2a "Story 5.3 must assert" entry.

</frozen-after-approval>

## Code Map

- `apps/web/src/pages/godisnji.tsx` -- the placeholder today. Route `:44-48`. Mirror `pages/sati.tsx:35-68` (a thin page with `useX` + body/notice).
- `apps/web/src/features/hours/`
  - `hooks/use-hours.ts:38-76` -- calendar query plus `calendarSurfaceStateOf`.
  - `services/my-hours.ts:178,~294` -- input from `snapshot.viewer`, and `RangeError` mapped to unavailable.
  - `components/hours-body.tsx` and `hours-summary.tsx` -- `StatTile` usage and the skeleton.
  - `hours-screen.fixture.ts` -- the parts and exempt list to copy as `leave-screen.fixture.ts`.
- `apps/web/src/features/leave/`
  - `hooks/use-member-leave.ts:140-158` -- the four admin reads. Reuse the members, organization and calendar query options. Replace the records read with the rpc.
  - `services/leave-section.ts:199-249` -- `memberLeaveBaseOf`. Mirror its state codes (`LOADING`/`UNAVAILABLE`/`UNSCHEDULED`). Do not reuse its admin wording.
  - `services/leave-list.ts:24,38,77-100,125-180` -- `leaveRecordsOf`, `LEAVE_RECORDS_KEY` and `LEAVE_WRITE_DEPENDENTS`.
- Domain and data:
  - `packages/domain/src/leave.ts:61-72,286` -- `LeaveBalanceInput` and `leaveBalanceOf`.
  - `features/calendar/utils/month.ts:787` -- `memberScheduleInputOf`.
  - The members RLS (0011:36-52) already allows a member their own row. Verify that `membersQueryOptions` resolves for the member role; if it does not, read the one row narrowly.
- `supabase/migrations/0030_my_leave_records.sql` -- the new function. The template is `0026_roster_overrides.sql:212-258`, and the access helper is `0003_access_control.sql:107-122`. Before taking the number 0030, check the main checkout for untracked migrations.
- `test/rls-isolation.test.ts`
  - Add the function to the pg_proc whitelist (both lists, :1155-1250).
  - Add a suite next to 5.2a (~16928), using `actAs`, `tokenFor` and `rest('rpc/…')`.
- Registration:
  - `apps/web/src/pages/prijava.test.ts` -- `PLACEHOLDER_SLUGS` 462 → `BUILT_SLUGS` 489, `SCREENS` ~509, `KEY_SOURCES` 1738 (its length assert at 2600), and a sweep test like 2690-2712.
  - `test/resource-hygiene.test.ts` -- the plural and flat key lists.
  - `apps/web/src/router.test.ts:25,163,313`, `test/localization-applied.test.ts:411` and `test/feature-boundaries.test.ts`.
- e2e:
  - Mirror `e2e/tests/hours/hours.spec.ts:199-279` (member `storageState`) and `e2e/pages/hours.page.ts` (register it in `custom-fixtures.ts`).
  - Seed with `seedLeaveMember`/`seedLeaveRecord`/`seedTeamRotation` (`e2e/utils/database-helper.ts:239,305`). `seedLeaveMember` hides its password: return the credentials and sign in a fresh context, so the shared fixture member keeps no leave.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0030_my_leave_records.sql` and `test/rls-isolation.test.ts` -- the function, its grants and the whitelist. Node cases: own live rows only, no removed row, no other member, no other org, anon refused, an admin's own rows, and no `created_by` column.
- [x] `apps/web/src/features/leave/services/my-leave.ts` (+test) -- `myLeaveOf` plus the state codes and message keys. Cover every matrix row.
- [x] `apps/web/src/features/leave/services/leave-list.ts` -- the own-records query options (rpc, new key), with the key added to `LEAVE_WRITE_DEPENDENTS`.
- [x] `apps/web/src/features/leave/hooks/use-my-leave.ts`, `components/my-leave-*.tsx`, `leave-screen.fixture.ts` and `pages/godisnji.tsx` -- the wiring, the tiles, skeleton, notice and retry.
- [x] `hr.json` plus the registration tests listed in the Code Map.
- [x] `e2e/tests/leave/my-leave.spec.ts`, `e2e/pages/leave.page.ts` and `e2e/utils/database-helper.ts`. With a seeded rotation:
  - a member sees 20 / N / 20−N;
  - another member's record leaves the figures unchanged;
  - an admin's removal restores the balance on reload;
  - 390 px has no horizontal scroll.

**Acceptance Criteria:**
- Given a member signed in, when they call the function through PostgREST, then every returned row has their `member_id`, and no row carries `created_by` or `removed_by`.
- Given the admin amends a member's record, when that member reloads Godišnji, then the three figures equal the admin card's figures for them.

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint` -- expected: exit 0
- `pnpm build && pnpm test` -- expected: all green
- `pnpm exec playwright test e2e/tests/leave e2e/tests/people` -- expected: all pass

## Suggested Review Order

**The read path**

- Entry point: a definer function answers the caller's own live rows, never an author id.
  [`0030_my_leave_records.sql:28`](../../supabase/migrations/0030_my_leave_records.sql#L28)

- The own-member and live-row filter; execute only for authenticated.
  [`0030_my_leave_records.sql:52`](../../supabase/migrations/0030_my_leave_records.sql#L52)

- The web reads it through rpc only, under its own key.
  [`leave-list.ts:276`](../../apps/web/src/features/leave/services/leave-list.ts#L276)

- Admin leave writes now refetch the viewer's own Godišnji.
  [`dependents.ts:85`](../../apps/web/src/features/teams/services/dependents.ts#L85)

**The figures**

- One pure view model: four reads in, figures or a state code out.
  [`my-leave.ts:104`](../../apps/web/src/features/leave/services/my-leave.ts#L104)

- No team ever: its own line, no figures.
  [`my-leave.ts:131`](../../apps/web/src/features/leave/services/my-leave.ts#L131)

- Any thrown error is unavailable, as on the admin card.
  [`my-leave.ts:152`](../../apps/web/src/features/leave/services/my-leave.ts#L152)

**The screen**

- Retry re-reads every read the screen stands on.
  [`use-my-leave.ts:72`](../../apps/web/src/features/leave/hooks/use-my-leave.ts#L72)

- Skeleton, alert with retry, the unscheduled line, or the three tiles.
  [`my-leave-body.tsx:23`](../../apps/web/src/features/leave/components/my-leave-body.tsx#L23)

- Thin page.
  [`godisnji.tsx:26`](../../apps/web/src/pages/godisnji.tsx#L26)

**Tests**

- Isolation: own live rows only, other member, other org, anon, column shape.
  [`rls-isolation.test.ts:17347`](../../test/rls-isolation.test.ts#L17347)

- Happy path, colleague isolation, admin amend and removal on reload, 390 px.
  [`my-leave.spec.ts:135`](../../e2e/tests/leave/my-leave.spec.ts#L135)

- A failed read shows the alert; retry brings the figures back.
  [`my-leave.spec.ts:204`](../../e2e/tests/leave/my-leave.spec.ts#L204)

- The seeded member now returns their credentials.
  [`database-helper.ts:246`](../../e2e/utils/database-helper.ts#L246)
