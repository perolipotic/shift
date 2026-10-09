---
title: 'An admin sees everyone''s leave in one overview (7.15)'
type: 'feature'
created: '2026-10-09'
status: 'done'
baseline_commit: '96ae60c810451b870e418141b5caaca85f0050bb'
review_loop_iteration: 1
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-7-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** An admin on *Godišnji* sees only their own three figures. To see who still has leave, they open each person. No read refuses a member who asks for everyone's leave: RLS quietly returns only their own rows.

**Approach:** Build the core of `mockups/leave-1.html` §4. `/godisnji` becomes role-scoped, as *Sati* is. An admin gets one table of the members active today with *Osoba* (a link to `/ljudi/$id`), *Smjena*, *Pravo*, *Iskorišteno* and *Preostalo* for the current leave year. Each row is computed by the member page's own rule. A member keeps today's tiles. The organization's records come through a new definer RPC that raises 42501 for anyone but an active admin.

## Boundaries & Constraints

**Always:**
- **Decisions of 2026-10-09:**
  - a new RPC in migration **0034**, the epic's one migration;
  - the core of the mockup only;
  - members active today only;
  - an admin sees only the overview, without their own tiles.
- **RPC:** `leave_overview_records()` is `security definer`, `set search_path=''` and `stable`. It returns the caller organization's live `leave_records` rows in the `LEAVE_RECORDS_COLUMNS` shape. It raises `insufficient_privilege` / `LEAVE_OVERVIEW_REFUSED` unless `current_member_access()` is an active admin. It does no leave arithmetic. Grants follow 0029: revoke from public, anon and service_role; grant to authenticated.
- **Paging:** the read is paged under `max_rows` with an exact count, as `readOrganizationLeaveRows` does. Share that loop rather than copy it.
- **One rule (Q19):** each row is `memberLeaveBaseOf(sources, memberId, now)` with that member's records. No per-row arithmetic exists outside `leaveBalanceOf`. A member with no schedule shows their *Pravo* and the shipped unscheduled line in place of used/balance, and is left out of the totals.
- **Role:** decided from `snapshot.viewer.role` inside the hook, as in `use-hours.ts`. No new `beforeLoad` role read. A member's session never issues the overview read. An unknown role fails closed to the unavailable state.
- **URL:**
  - `?trazi=` searches names with `foldForSearch`.
  - `?sort=` takes `ime|smjena|pravo|iskoristeno|preostalo`, with a `-` prefix for descending. The default is `ime` ascending.
  - A bad value falls back to its default.
- **Summary line:** `Prikazano: {n} osoba · iskorišteno ukupno {used} dana od {allowance}`, with ICU plurals. Counts show at zero.
- **Below 640 px:** `StackedList`/`StackedRow` with one `Poredano` control.
- Rules live in pure `.ts` files with node tests (AD-15).
- Copy goes in `hr.json` and the sweeps.
- Docs are updated in the same change: UX-DR32/33, EXPERIENCE.md §IA and DESIGN.md.

**Ask First:** a second migration; changing an existing policy; adding a year stepper, filter chips or the *Upisano* column.

**Never:**
- a write action on the overview;
- re-implementing balance or leave-year arithmetic;
- widening `leave_records` or `members` RLS;
- showing the overview to a member through any path.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Admin, 3 active members | records in and outside the leave year | 3 rows. Pravo − Iskorišteno = Preostalo, and each row equals `memberLeaveBaseOf` for that member | N/A |
| Deactivated member | inactive today | no row | N/A |
| Unscheduled member | no memberships | row with Pravo and the unscheduled line; not in the totals | N/A |
| Search `ana`, no hit | `?trazi=zzz` | one empty line and *Poništi pretragu* | N/A |
| Bad sort | `?sort=xyz` | `ime` ascending | N/A |
| Member opens `/godisnji` | member role | own tiles, unchanged; no RPC call | N/A |
| Member calls the RPC | REST or SQL as member, inactive admin or anon | refused | 42501 `LEAVE_OVERVIEW_REFUSED` (401 for anon via REST) |
| Other organization | admin of org A | only A's rows | N/A |
| Any read fails | RPC, members, calendar or org errors | one unavailable notice with retry, no rows | logged under the stable code |

## Epic AC Deviations

- **"every member appears with allowance, days used and balance"** is narrowed to members active today, by the human decision of 2026-10-09. A deactivated person's balance is not something to act on, and Ljudi already lists them under its status filter.
- **"days used and balance … on every row"** is narrowed for a member with no schedule. Their row shows *Pravo* and the shipped unscheduled line, as their own page does (Q19), and they are left out of the totals. Human decision of 2026-10-09 at review.

</frozen-after-approval>

## Code Map

- `supabase/migrations/0034_leave_overview_records.sql` (new) -- the RPC. Copy the shape of `0030_my_leave_records.sql:28-60`, the admin check and refusal of `0029_amend_remove_leave_record.sql:74-117`, and `current_member_access()` from `0008:268`. The RLS it bypasses is `0028:130-155`.
- `test/rls-isolation.test.ts` -- add a block modelled on `:17477-17512` (refused loop) and `:17688-17830` (`my_leave_records` REST/SQL). Register the function in the definer registry at about `:1165-1260`.
- `apps/web/src/features/leave/services/leave-list.ts` -- `readOrganizationLeaveRows` `:381` (paging loop to share), `organizationLeaveRecordsOf` `:466` (parser), `MY_LEAVE_RECORDS_*` `:267-330` (the RPC read pattern). Add `LEAVE_OVERVIEW_RECORDS_KEY` and the query options here.
- `apps/web/src/features/leave/services/leave-section.ts:228` `memberLeaveBaseOf`, the per-row rule. Read it; do not fork it.
- `apps/web/src/features/leave/services/leave-overview.ts` (new) + test -- the view model:
  - rows of the members active today (`memberStatusOf`, `members/services/list.ts:606`);
  - the team name for today, from the calendar snapshot;
  - search, sort, summary, and the search parser for the page.
- `apps/web/src/features/leave/hooks/use-leave-overview.ts` (new) -- the reads of `use-member-leave.ts:232-254` plus the RPC read, gated on the admin role. `use-hours.ts:85-108` is the role gate model.
- `apps/web/src/features/leave/components/leave-overview-{body,table,rows}.tsx` (new) -- modelled on `hours/components/hours-body.tsx:85-118`, `organization-hours-table.tsx` (`SortHead` `:50-80`) and `organization-hours-rows.tsx:76-102`.
- `apps/web/src/pages/godisnji.tsx:17-47` -- role-scoped body and `validateSearch`. Update the docblock.
- Leave writes must invalidate `LEAVE_OVERVIEW_RECORDS_KEY` wherever `ORGANIZATION_LEAVE_RECORDS_KEY` is invalidated (grep).
- `eslint.config.js:216-220` -- `FEATURE_PUBLIC.leave`: add `services/leave-overview` with `// pages`.
- `hr.json` -- `godisnji` `:420-427`, reuse `count.*` `:54-57` and `sort.*` `:1388-1395`.
- Registries:
  - `features/leave/leave-screen.fixture.ts:10-64`;
  - `test/localization-applied.test.ts:627-634`;
  - `pages/prijava.test.ts` (SCREENS `:941` controls; key counts `:2880-2886`, `:2965-2969`);
  - `test/resource-hygiene.test.ts:1574-1579`.
- e2e:
  - `e2e/pages/leave.page.ts` gets the table and rows;
  - `e2e/tests/leave/my-leave.spec.ts:46` is admin-state, so its admin-tile assertions move to the member;
  - `today.spec.ts:412` admin tile equality;
  - phone model `hours/hours.spec.ts:375`.
- Docs:
  - EXPERIENCE.md `:31`, `:40`, `:43`, `:48`, `:62-63`, `:177`;
  - DESIGN.md `:253`, `:281-282`;
  - epics.md UX-DR32 `:148`, UX-DR33 `:149`.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0034_leave_overview_records.sql`, `test/rls-isolation.test.ts` -- the RPC, the registry entry, and the refused/allowed/cross-org cases -- data-layer refusal
- [x] `leave/services/leave-list.ts` + test -- the shared paging loop, the RPC read, the key -- one read
- [x] `leave/services/leave-overview.ts` + `leave-overview.test.ts` -- the matrix rows, sort, search, summary, and a property test that every row equals `memberLeaveBaseOf` with Pravo − Iskorišteno = Preostalo -- the rule
- [x] `leave/hooks/use-leave-overview.ts`, `leave/components/leave-overview-*.tsx`, `pages/godisnji.tsx`, invalidations, `eslint.config.js` -- the surface
- [x] `hr.json` and the registries above -- i18n and sweeps
- [x] `e2e/pages/leave.page.ts`, `my-leave.spec.ts`, `today.spec.ts` -- the admin table at 1280 and 390; a row equals the member page's figures; a member sees their tiles, and a member's RPC call is refused
- [x] EXPERIENCE.md, DESIGN.md, epics.md; `deferred-work.md` (year stepper, chips, *Upisano*); `epic-7-context.md` status; sprint-status 7.15 → `done`, epic-7 → `done` -- docs

**Acceptance Criteria:**
- Given an admin on *Godišnji* at 390 px, then rows are stacked, there is no horizontal scroll, and *Godišnji* is reached from *Više* → *Pregled*.
- Given a row's *Osoba* is chosen, then `/ljudi/$id` opens, and its leave card shows the same three figures.
- Lint (including feature boundaries), typecheck, unit, RLS and e2e tests pass.

## Spec Change Log

## Design Notes

An RLS-only read cannot refuse: a member's select returns their own rows. The RPC adds the refusal and leaves the policies as they are. It returns raw rows, so the arithmetic stays in the domain, where the member page computes it. The RPC's rows feed `memberLeaveBaseOf` in place of the per-member `LEAVE_RECORDS_KEY` read. That makes row equality hold by construction, and the property test proves it.

## Verification

**Commands:**
- `pnpm lint && pnpm typecheck` -- expected: clean
- `pnpm test` -- expected: unit, RLS and sweep suites pass (local Supabase stack up, migration applied)
- `pnpm test:e2e` -- expected: leave, today and phone-navigation specs pass at 1280 and 390

## Suggested Review Order

**Data-layer refusal**

- Entry point: the definer RPC that refuses anyone but an active admin, raw rows only.
  [`0034_leave_overview_records.sql:31`](../../supabase/migrations/0034_leave_overview_records.sql#L31)

- The refusal: a non-UUID claim falls through to 42501, never 22P02.
  [`0034_leave_overview_records.sql:58`](../../supabase/migrations/0034_leave_overview_records.sql#L58)

- RLS proof: refused callers, cross-org isolation, and REST answers.
  [`rls-isolation.test.ts:17861`](../../test/rls-isolation.test.ts#L17861)

**One read, one rule**

- The paging loop is now shared by the organization read and the overview read.
  [`leave-list.ts:410`](../../apps/web/src/features/leave/services/leave-list.ts#L410)

- The overview read and its own key.
  [`leave-list.ts:505`](../../apps/web/src/features/leave/services/leave-list.ts#L505)

- Each row is `memberLeaveBaseOf`: no arithmetic of its own (Q19).
  [`leave-overview.ts:308`](../../apps/web/src/features/leave/services/leave-overview.ts#L308)

- Search, sort and summary run over the memoised rows.
  [`leave-overview.ts:475`](../../apps/web/src/features/leave/services/leave-overview.ts#L475)

- The role gate fails closed on an unknown role.
  [`leave-overview.ts:74`](../../apps/web/src/features/leave/services/leave-overview.ts#L74)

**Surface and URL**

- Admin reads are enabled only for an admin, so a member never calls the RPC.
  [`use-leave-overview.ts:93`](../../apps/web/src/features/leave/hooks/use-leave-overview.ts#L93)

- Rows are memoised apart from search and sort.
  [`use-leave-overview.ts:119`](../../apps/web/src/features/leave/hooks/use-leave-overview.ts#L119)

- The role-scoped page; a search-only `beforeLoad` rewrites a bad `?sort=`.
  [`godisnji.tsx:131`](../../apps/web/src/pages/godisnji.tsx#L131)

- The URL rewrite rule.
  [`leave-overview.ts:176`](../../apps/web/src/features/leave/services/leave-overview.ts#L176)

- Body states: skeleton, unavailable with retry, empty, table or rows.
  [`leave-overview-body.tsx:28`](../../apps/web/src/features/leave/components/leave-overview-body.tsx#L28)

- Desktop table with sortable heads.
  [`leave-overview-table.tsx:80`](../../apps/web/src/features/leave/components/leave-overview-table.tsx#L80)

- Phone stacked rows with one Poredano control.
  [`leave-overview-rows.tsx:29`](../../apps/web/src/features/leave/components/leave-overview-rows.tsx#L29)

- Leave writes invalidate the overview key beside the organization key.
  [`dependents.ts:9`](../../apps/web/src/features/teams/services/dependents.ts#L9)

**Peripherals**

- The leave overview is public to pages only.
  [`eslint.config.js:219`](../../eslint.config.js#L219)

- e2e: rows equal the member page at 1280 and 390, sort, retry, member refused.
  [`my-leave.spec.ts:278`](../../e2e/tests/leave/my-leave.spec.ts#L278)

- e2e: the member keeps their tiles and is refused.
  [`my-leave.spec.ts:410`](../../e2e/tests/leave/my-leave.spec.ts#L410)
