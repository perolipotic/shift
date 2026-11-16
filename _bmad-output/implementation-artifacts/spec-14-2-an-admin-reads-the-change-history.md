---
title: 'Story 14.2: An admin reads the change history'
type: 'feature'
created: '2026-11-16'
status: 'done'
baseline_revision: '90f1052fc2d4c1665dd34d32e7de324e9d3268fd'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-14-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-14-1-every-change-is-recorded-in-the-change-history.md'
  - '{project-root}/apps/web/src/components/README.md'
  - '{project-root}/apps/web/src/pages/README.md'
warnings: [oversized]
deferred:
  - summary: >-
      A departed member (auth-user cascade) is named only from `members` events inside the read period; outside it the author or subject reads "Nepoznata osoba".
    evidence: |-
      Blind review. `memberIdentitiesOf`/`namesFrom` scan the period's events and the current members list; no read of older `members` DELETE events. Rare at pilot scale (no session deletes a member, 0036).
    location: >-
      packages/domain/src/history.ts
    severity: low
  - summary: >-
      Amend pairing is a key heuristic: any transaction that soft-removes and inserts a leave record, roster override or shift-type override under the same key reads as one amended entry, whichever RPC wrote it.
    evidence: |-
      Blind and edge-case review. No test proves that no other writer (swap approval, conflict resolution) removes and inserts under one key in one transaction; nothing links the pair in the schema (14.1's decision).
    location: >-
      packages/domain/src/history.ts (amendPairsOf)
    severity: low
  - summary: >-
      A long period re-reads every page on focus/reconnect and renders every row with no cap or windowing.
    evidence: |-
      Blind and edge-case review. By design each load reads the whole period afresh (deferred-work 14.1 answer); cost grows with a busy 365-day period. Pilot volume is small.
    location: >-
      apps/web/src/features/history/services/history-read.ts
    severity: low
---

<intent-contract>

## Intent

**Problem:** Story 14.1 records every write to the 21 audited tables in `audit_events` (0061), but nobody can read it: there is no surface, and no module gives an event its meaning (kind, subject, *bilo → sada*).

**Approach:** Apply the spine's AD-11 "Reading it (14.2)" clause exactly. One pure `packages/domain` module (`history.ts`) gives each event its meaning as codes and operands and filters entries. A new admin-only destination *Povijest promjena* (`/povijest-promjena`, *Pregled* group, after *Ljudi*) reads one period from `audit_events` by direct PostgREST select under RLS, in keyset pages, and draws a table (stacked rows below 640 px) with chips for period, member, team and kind. The history is never kept on the device and is unavailable offline. The filtered rows are one value, ready for 14.3's export (not built here).

## Boundaries & Constraints

**Always:**
- Baseline: story 14.1's commit on this branch (`90f1052`). Hot files (`index.css`, `components/ui/*`, `chrome.tsx`, `hr.json`, `test/theme-contrast.test.ts`, structural pins) are touched by this story alone, sequentially.
- The binding design is the spine's AD-11 "Reading it (14.2)" bullet, its "Attribution" and "Backfill" bullets (author codes; "where history begins"), AD-7/AD-8 (domain returns codes and operands, no prose, no I/O), AD-13 (one snapshot key for the period), D4 (admin only).
- The read is a direct `supabaseClient().from('audit_events').select(...)`: no RPC, no view, no new migration, no new grant.
- Keyset cursor = the raw `occurred_at` string and the `id` exactly as PostgREST returned them, never passed through `Date`. Page size 1000 (`max_rows`); the read stops at the first short page.
- The period is whole days in the organization's time zone, required, at most 366 days.
- Member, team and kind filtering happen in the browser over the one period snapshot; a subject is matched by the ids the row (or, for a decision, its request) names, never by a membership derived for the event's date.
- Every on-screen word comes from `hr.json` through a static code → key record (key-hygiene and resource-hygiene pin keys; no template-built keys).
- Origin `backfill` entries are marked reconstructed on screen; the `HISTORY_BEGINS` marker is a row of its own; when the period reaches back to where history begins, the screen states it and that earlier hard deletes and current-state edits were never recorded and are unrecoverable.
- Obey the bmad-build customization facts: e2e grep for changed surfaces, `## Epic AC Deviations`, resolved deferrals marked in the same change, DB-free root tests run locally, STRICT DATABASE RULE.

**Block If:**
- Reading the history would need a schema change, a new privilege, an RPC/view, or a paid service.

**Never:**
- No PDF export, no `pdfmake`, no `Izvezi u PDF` button (14.3).
- No persistence of history data: its query key root is not in `PERSISTED_KEY_ROOTS` / `PERSISTED_PARAMETERISED_KEY_ROOTS`, the route is not in `OFFLINE_READABLE_PATHS`, no `DEVICE_SNAPSHOT_SHAPE` bump, no service-worker runtime caching.
- No write to `audit_events` or any table; no change to 0061 or any migration; no local Supabase stack, DB-connecting test run or e2e run.
- No membership-by-date derivation for subjects; no second read per row (no N+1).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Admin opens | `/povijest-promjena`, online, active admin | Period defaults to the last 30 days ending the organization's today; rows newest first by `(occurred_at, id)` | — |
| Member/inactive | member-role session types the URL | `requireAdmin` forwards to the first destination; no nav row is shown | — |
| Offline | `navigator.onLine === false`, or the read fails while offline | A `Notice` says the history is not available offline; no rows, no as-of note; nothing cached is drawn | Retry when online |
| Read fails online | PostgREST error | Unavailable notice with retry (`keepFocusOnAlert` pattern) | rethrow code; `retry: 1` |
| > 1000 events | period with 2500 events | 3 pages read by keyset; all 2500 in the snapshot | — |
| Amend | live `amend_leave_record`: removal UPDATE + INSERT, same `transaction_id`, same `member_id` | One entry, kind `leave-record` / `amended`, diff from the removed row's old values to the new row's | Several pairs in one transaction: paired by key, then by `id` order |
| Pre-0061 amend | backfilled removal UPDATE and INSERT, both origin `backfill`, same table, same key, same `occurred_at` | One `amended` entry, marked reconstructed | — |
| Decision | `leave_request_decisions` INSERT | Subject = the member of the request event with the same `transaction_id`, else (backfill) of a request event in the period with `row_id` = this `row_id`, preferring equal `occurred_at` | Not found: subject empty, entry still shown |
| Actor | `actor` maps to a member via `auth_user_id` (current members, or a `members` row in any event read) | Author is that member's name | No member: `departed`; null actor + `session_role = 'service_role'`: `service`; null actor otherwise: `system` |
| Straggler | a `trigger` event dated before the `HISTORY_BEGINS` marker | Drawn as an ordinary live entry in time order, not reconstructed | — |
| Late commit | an event commits during a multi-page read behind the cursor | Absent from this snapshot, present on the next read (refetch on focus/reconnect/retry/period change) | — |
| No events | period empty | Empty state "no changes in this period"; chips still offer the period | Filters leaving none: "Odabrani filtri ne prikazuju nijednu promjenu." + reset |
| Bad URL | `?razdoblje=abc`, unknown `?osoba=` / `?smjena=` / `?vrsta=` | Falls back to the default and is replaced out of the URL (no extra history entry) | — |

</intent-contract>

## Code Map

- `supabase/migrations/0061_audit_events.sql` -- read-only. Columns: `organization_id, id bigint, table_name, operation (INSERT|UPDATE|DELETE|HISTORY_BEGINS), row_id text, old_row jsonb, new_row jsonb, actor uuid, session_role text, origin (trigger|backfill), transaction_id xid8 (string over PostgREST; null on backfill), occurred_at timestamptz`. Index `(organization_id, occurred_at desc, id desc)`. RLS: active admin of the claim's organization only.
- Audited tables' columns (for kinds, fields, subjects): `organizations` (`id, slug, name, short_name, description, address, contact_email, organization_type, timezone, locale, leave_year_start_month, leave_year_start_day, created_at, brand_accent, logo_path, uses_fire_ranks, email_notifications, minimum_members, carry_over_max_days, carry_over_expiry_month, carry_over_expiry_day, carry_over_first_leave_year`); `members` (`id, auth_user_id, name, email, role, leave_allowance_days, created_at, username, fire_rank`); `member_status_versions` (`member_id, active, effective_from`); `team_membership_versions` (`member_id, team_id, effective_from, position`); `teams` (`name, archived`); `hour_bands` (`name, start_time`); `shift_types` (`name, is_working, archived`); `shift_type_versions` (`shift_type_id, start_time, end_time, effective_from`); `rotation_patterns` (—); `rotation_steps` (`pattern_id, position, shift_type_id`); `rotation_assignments` (`team_id, pattern_id, offset_step_id, anchor_date, effective_from`); `shift_type_overrides` (`team_id, date, shift_type_id, reason, removed_*, confirmed_*`); `roster_overrides` (`team_id, date, member_out_id, member_in_id, reason, removed_*, confirmed_*`); `leave_records` (`member_id, during daterange, absence_type_id, half, removed_*`); `conflict_resolutions` (`member_id, date, team_id, kind, shift_type_id, roster_override_id, removed_*`); `leave_requests` (`member_id, during, absence_type_id, half, closed_*`); `leave_request_decisions` (`request_id, outcome, leave_record_id, decided_*`); `swap_requests` (`proposer_id, addressee_id, team_id, date, return_team_id, return_date, answer, answered_*, closed_*`); `swap_request_decisions` (`request_id, outcome, roster_override_id, return_roster_override_id, decided_*`); `absence_types` (`id, name, draws_allowance`); `leave_allowances` (`id bigint, member_id, leave_year, days`). Enum values: `members.role` `admin|member_role`; decisions' `outcome` `approved|rejected|deactivated` (0041/0049); `swap_requests.answer` `accepted|declined`; `conflict_resolutions.kind` `accept_uncovered|replace_member|amend_leave`; `half` `FIRST|SECOND`; `members.fire_rank` is free text drawn as text.
- `packages/domain/src/index.ts` -- export the new module. House style: `calendar.ts` (`checkDate`, `civilDayNumber`, `dateOfCivilDay`) for date arithmetic; codes not prose (AD-8); zero dependencies.
- `apps/web/src/features/navigation/utils/destinations.ts` -- `DESTINATIONS` (binding order, `group`); add `nav.povijestPromjena` → `/povijest-promjena`, `ADMIN_ONLY`, `overview`, after `nav.ljudi`. `destinations.test.ts` pins sequences/counts (admin 8 → 9).
- `apps/web/src/features/navigation/utils/destination-copy.ts` (`DESCRIPTIONS` + return-type union), `utils/icons.ts` (`DESTINATION_ICONS`; use `ClockCounterClockwise` from `@/components/ui/icon`), and their tests -- one entry each.
- `apps/web/src/features/navigation/components/chrome.tsx` -- consumes the table; expect no code change (verify the *Više* sheet and sidebar render the new row under *Pregled*).
- `apps/web/src/features/navigation/services/admin-guard.ts` -- `requireAdmin`, registered as `beforeLoad` (see `pages/organizacija.tsx:84`).
- `apps/web/src/router.ts` -- register the route under `appLayoutRoute`; `router.test.ts` derives admin-only destinations from the table and pins guards by identity (`:~1674` `OFFLINE_READABLE_PATHS` list stays unchanged; add an assertion that `/povijest-promjena` does not read offline).
- `apps/web/src/lib/offline/readable-paths.ts`, `lib/offline/persistence.ts` (+ `persistence.test.ts`) -- left unchanged; add a test that the history key root is not persisted.
- `apps/web/vite.config.ts:74-115` -- workbox precaches the app shell only, no runtime caching: history data can never be precached. Left; `pnpm build` confirms.
- Pattern to follow for an admin filtered table surface: `pages/godisnji.tsx` + `features/leave/hooks/use-leave-overview.ts` + `features/leave/components/leave-overview-filters.tsx` (`OptionFilterBar`, chips in the URL, `stateKey`, reset) and `features/leave/services/leave-overview.ts` (pure search parsing/rewrite, chip choice/removal). Stacked rows: `components/ui/stacked-list.tsx` + `usePhone()` (`hooks/viewport.ts`); table: `components/ui/table.tsx`; `components/README.md` page skeleton.
- Name sources (shared keys, AD-13): `features/members/services/list.ts` (`MEMBERS_LIST_KEY`, `membersQueryOptions`, rows carry `auth_user_id` → author), `features/teams/services/list.ts` (`TEAMS_LIST_KEY`), `features/shift-types/services/list.ts` (`SHIFT_TYPES_LIST_KEY`), `features/absence-types/services/list.ts` (`ABSENCE_TYPES_LIST_KEY`, public), `features/hour-bands/services/list.ts`. Cross-feature imports must be allowed by `FEATURE_PUBLIC` in `eslint.config.js:124+` (add the new `history` consumer comments / entries as needed). Paging precedent: `features/conflicts/services/resolved-conflicts.ts:188-215` (`readActingAdminRows`, 1000-row pages, structural table type for stubbing).
- `apps/web/src/lib/i18n/format.ts` -- `organizationIsoDate(instant, zone)`, `formatDate`, `formatTime`, `formatIsoDate`, `formatList`, `formatNumber`, `formatMinuteOfDay`, `isRenderableTimeZone`. Organization time zone/today: `hooks/organization-today.ts`, `features/organization/services/snapshot.ts`.
- `apps/web/src/lib/i18n/locales/hr.json` -- `nav.*`, `shell.description.*`, `filter.*` (shared chip words), new `history.*` namespace. Existing wording to reuse: `Nepoznata osoba` (`unknownAuthor` entries).
- `test/key-hygiene.test.ts`, `test/resource-hygiene.test.ts`, `apps/web/src/pages/*sweep*.test.ts`, `structural-pins-*.test.ts`, `key-sources.fixture.ts` -- may need the new page/feature registered; run them.
- `e2e/utils/i18n.ts:25` (`ADMIN_DESTINATIONS`), `e2e/tests/layout/phone-navigation.spec.ts:~213-226` (sidebar *Pregled* list; also the admin *Više* sheet assertions in the same file), `e2e/tests/auth/sign-in.spec.ts` -- old navigation lists to update. Page objects: `e2e/pages/base.page.ts`, `e2e/pages/leave.page.ts` style; fixtures `e2e/utils/custom-fixtures.ts`.
- `_bmad-output/planning-artifacts/epics.md:157,158,185` (UX-DR32, 33, 51), `ux-designs/ux-shift-2026-09-02/EXPERIENCE.md` §Information Architecture (admin list, *Više* sheet text, surface inventory table, stacked-rows list at `:198`), `DESIGN.md` if it lists surfaces -- doc updates.
- `_bmad-output/implementation-artifacts/deferred-work.md:504,655,1532,1535` -- inputs addressed to 14.2 (see Design Notes).

## Tasks & Acceptance

**Execution:**
- `packages/domain/src/history.ts` (+ `history.test.ts`, export from `index.ts`) -- create the one meaning module (shapes in Design Notes): `AuditEvent` input type; `historyPeriodOf(choice, today)` and `HISTORY_PERIOD_CHOICES`; `historyReadWindowOf(period)` (padded UTC bounds); `historyEntriesOf(events, context)` (kind, author code, subjects, field changes, amend pairing, decision → request subject, reconstructed flag); `historyFilterOptionsOf(entries)`; `filteredHistoryEntries(entries, filters)`; `historyBeginsOf(markerEvents, entries)`; the exhaustive `HISTORY_RECORDS`, `HISTORY_ACTIONS`, `HISTORY_FIELDS` lists. Tests cover every I/O-matrix row the domain owns (kinds per table, each UPDATE action, amend live + backfill + multiple pairs, decision subject live + backfill + missing, author codes, filters AND-combined, period bounds incl. 366 cap and month choices, unknown column → raw operand, every key shape a migration wrote).
- `apps/web/src/features/history/services/history-read.ts` (+ test) -- `HISTORY_KEY_ROOT = 'change-history'`; `historyQueryOptions(table, period)` with key `[root, from, to]`, `retry: 1`, rejects with a code on failure; `readHistoryEvents` (keyset loop: `.gte/.lt` on padded window, `.order('occurred_at',{ascending:false}).order('id',{ascending:false})`, next page `.or('occurred_at.lt."<raw>",and(occurred_at.eq."<raw>",id.lt.<id>)')`, `.limit(1000)`, stop at the first short page); one marker read (`table_name = 'organizations'`, operation `HISTORY_BEGINS` or `INSERT`, ordered by `id`, small limit); row parser to `AuditEvent` (malformed row → unavailable). Tests with a stubbed structural table: cursor is the raw string (microseconds kept), 3-page read, stop on short page, failure → code.
- `apps/web/src/features/history/services/history-search.ts` (+ test) -- URL search `?razdoblje=&osoba=&smjena=&vrsta=` parse, defaults, rewrite-out of bad values, chip pick/removal/clear, in the `leave-overview.ts` style.
- `apps/web/src/features/history/services/history-rows.ts` (+ test) -- `historyRowsOf(entries, names, zone)` → `readonly HistoryRow[]`: each with id, time text, author text, kind text, subject text, `reconstructed`, and `changes: readonly { field, before, after }[]` as display strings, plus the filter-chip views; names resolved from the current lists and from rows held in the events (DELETE old rows keep departed names). This value is what 14.3 will export: the table renders exactly it, in order. All words through static code → key records.
- `apps/web/src/features/history/hooks/use-change-history.ts` -- wiring: organization zone/today, period from search, the history query (disabled offline: `navigator.onLine` / existing online hook), the name lists, states (loading, offline, unavailable+retry, empty, ready), chips; exposes `rows` (filtered, ordered).
- `apps/web/src/features/history/components/*` -- `history-filters.tsx` (`OptionFilterBar` with four chips: period always drawn, member, team, kind, options with counts), `history-table.tsx` (`Table`: Vrijeme, Autor, Vrsta, Predmet, Bilo → sada; reconstructed `Badge`), `history-rows.tsx` (phone `StackedList`), `history-begins.tsx` (the begins statement), skeleton, empty and notices.
- `apps/web/src/pages/povijest-promjena.tsx` -- route under `appLayoutRoute`, `beforeLoad: requireAdmin` (plus bad-search rewrite), page skeleton with `PageHeader`/`PageDescription`; `router.ts` registers it.
- Navigation: `destinations.ts`, `destination-copy.ts`, `icons.ts` and their tests; `router.test.ts` additions; `persistence.test.ts` assertion; `eslint.config.js` `FEATURE_PUBLIC` entries as the imports require.
- `apps/web/src/lib/i18n/locales/hr.json` -- `nav.povijestPromjena: "Povijest promjena"`, `shell.description.povijestPromjena`, `history.*` (title, lede, columns, chips, period choices, record and action words, field labels, value words, author codes, reconstructed badge, begins statement, notices).
- `e2e/pages/history.page.ts`, `e2e/tests/history/history.spec.ts` -- admin: opens *Povijest promjena* from the navigation, makes a change through the app or `database-helper` in its own spec (e.g. renames a throwaway team), sees its row (time, author, kind, subject, *bilo → sada*), narrows by the team chip and the kind chip, sees the begins statement on a long period; a phone viewport shows stacked rows. Member: no navigation row, `/povijest-promjena` forwards to *Danas*. Update `e2e/utils/i18n.ts` `ADMIN_DESTINATIONS`, `phone-navigation.spec.ts` sidebar and *Više* lists, and any other e2e that lists admin destinations (grep `hr.nav.`).
- Docs: `epics.md` UX-DR32 (rewrite the planned sentence as shipped), UX-DR33 (inventory 22 → 23, describe the surface), UX-DR51 (as shipped, 14.3's export still planned); `EXPERIENCE.md` §IA (admin list, *Više* *Pregled* for an admin, inventory row, stacked-rows list).
- `ARCHITECTURE-SPINE.md` -- add `Applied 2026-11-16 (story 14.2)` under AD-11's amendment recording the read's refinements (padded UTC window + zone-day filter in the browser; marker read; amend pairing keys; author codes; no index, no migration).
- `deferred-work.md` -- mark `:1532` and `:1535` RESOLVED by story 14.2, and `:504`/`:655`'s 14.2 parts (pairing keys) answered (prefix `RESOLVED in part … by story 14.2` text appended); add entries for any new deferral.
- `sprint-status.yaml` -- `14-2-an-admin-reads-the-change-history` through the workflow's sync.

**Acceptance Criteria:**
- Given an active admin, when they open *Povijest promjena* from *Pregled* (sidebar, or *Više* on a phone), then a table shows Vrijeme, Autor, Vrsta, Predmet and *Bilo → sada* in Croatian words built from domain codes, newest first, with chips Razdoblje, Osoba, Smjena and Vrsta; below 640 px the same rows are stacked, never a sideways scroll.
- Given a member-role session, when it looks for or types the history, then no navigation row is shown and the URL forwards to the first destination (and RLS returns nothing anyway).
- Given the device is offline, when the admin opens the page, then it says the history is unavailable offline and draws no rows; and no history data is ever written to the device snapshot.
- Given a period whose events exceed one page, when it loads, then every event of the period is read by keyset on the raw `(occurred_at, id)` and drawn once.
- Given backfilled events and the `HISTORY_BEGINS` marker in the period, when drawn, then backfilled rows are marked reconstructed, the marker is its own row, and the page states where history begins and that earlier deletions are unrecoverable.
- Given filters, when the admin narrows by member, team or kind, then only entries naming that member/team id (directly or through their request) or of that kind remain, and the shown rows are one value (`rows`) in the order rendered.
- Given `pnpm typecheck`, `pnpm lint`, `pnpm -r test`, `pnpm build` and the DB-free root tests, when run, then they pass (known Node-22 `format.test.ts` cases aside).

## Spec Change Log

## Review Triage Log

### 2026-11-16 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 11 (high 0, medium 3, low 8)
- defer: 3 (low 3)
- reject: 12 (low 12)
- addressed_findings:
  - `[medium]` `[patch]` An unknown `table_name` made the whole read unavailable; it is now a generic *Zapis* entry with raw fields (malformed rows still fail).
  - `[medium]` `[patch]` The "earliest entry read" fallback always showed the begins statement dated at the oldest row; no statement for that source now, and the wording depends on the source (marker: unrecoverable; organization INSERT: recorded from creation, no loss claimed).
  - `[medium]` `[patch]` Verification gaps: zone-day mapping is a pure tested function (`historyEventsInZone`); read tests for a failing middle page, a failing marker read and a shared-instant page boundary; live-vs-backfill pairing test; e2e picks the team through the *Filtri* picker, rewrites an unknown `?osoba=`, and shows the offline notice.
  - `[low]` `[patch]` Marker row drawn distinctly (*Početak povijesti*) and left out of the counts; tested.
  - `[low]` `[patch]` Change lines keyed by column, not translated label.
  - `[low]` `[patch]` `timeOf` returns raw for out-of-range parts (24:00:00 kept, as Postgres accepts it).
  - `[low]` `[patch]` Period codes non-numeric (`7-dana` … `365-dana`) so the router no longer quotes them.
  - `[low]` `[patch]` Period chip active only off the default; its ✕ resets.
  - `[low]` `[patch]` Decision → request and amend pairing indexed once (no quadratic scan).
  - `[low]` `[patch]` DESIGN.md stacked-rows lists include the change history.
  - `[low]` `[patch]` Epic AC Deviations lists the raw fallback for unknown columns/values.
- rejected: `max_rows` below 1000 (config pins 1000; spine: read done at the first short page); decision request via current requests (every decision closes its request in the same transaction, so the request event shares its instant and period); silent drop of an unoffered deep-link filter (the existing surfaces' pattern); two URL rewrites in one render; epic-context summary detail; ledger wording; status mid-run; reconstructed badge tooltip; DST display; never-member actor wording; null period skeleton (default period is never null); hook/component unit tests (the repo has no hook tests; e2e covers the surface in CI).

## Design Notes

**Domain shapes (AD-8: codes and operands only).**
```ts
type HistoryRecord = 'organization' | 'member' | 'member-status' | 'team-membership' | 'team' | 'hour-band'
  | 'shift-type' | 'shift-type-version' | 'rotation-pattern' | 'rotation-step' | 'rotation-assignment'
  | 'shift-type-override' | 'roster-override' | 'leave-record' | 'conflict-resolution' | 'leave-request'
  | 'leave-request-decision' | 'swap-request' | 'swap-request-decision' | 'absence-type' | 'leave-allowance';
type HistoryAction = 'added' | 'changed' | 'deleted' | 'removed' | 'confirmed' | 'answered' | 'closed'
  | 'archived' | 'restored' | 'amended' | 'decided' | 'history-begins';
interface HistoryKind { record: HistoryRecord; action: HistoryAction }   // filter code: `${record}:${action}`
type HistoryAuthor = { kind: 'member'; memberId: string } | { kind: 'departed' } | { kind: 'service' } | { kind: 'system' };
type HistoryOperand = { type: 'none' } | { type: 'text'; value: string } | { type: 'number'; value: number }
  | { type: 'boolean'; value: boolean } | { type: 'date'; value: string } | { type: 'range'; from: string; to: string } // inclusive last day
  | { type: 'time'; minute: number } | { type: 'member' | 'team' | 'shift-type' | 'absence-type'; id: string }
  | { type: 'enum'; field: string; value: string } | { type: 'raw'; json: string };
```
Action from an UPDATE, first match: `removed_at` null → set = `removed`; `confirmed_at` = `confirmed`; `answered_at` = `answered` (a decline closes in the same write); `closed_at` = `closed`; `archived` false → true = `archived`, true → false = `restored`; else `changed`. INSERT = `added` (decisions: `decided`); DELETE = `deleted`; `HISTORY_BEGINS` = `organization:history-begins`. Changes: UPDATE → the changed visible fields; INSERT → the visible fields of the new row (before `none`); DELETE → those of the old row (after `none`); amend → old values of the removed row vs the new row. Hidden fields: `organization_id, id, created_by, created_at, removed_by, removed_at, confirmed_by, confirmed_at, closed_by, closed_at, answered_by, answered_at, decided_by, decided_at, request_id, auth_user_id, leave_record_id, roster_override_id, return_roster_override_id, pattern_id, offset_step_id`. A column not in the field map becomes `raw` (the domain reads every key shape a migration wrote, AD-11 Deletes).

Subjects: member ids from `member_id, member_out_id, member_in_id, proposer_id, addressee_id` and a `members` row's `id`; team ids from `team_id, return_team_id` and a `teams` row's `id`; a decision takes its request's. The Predmet text is the members' and teams' names; with neither, the record's own `name` (shift type, hour band, absence type, organization), else the record word.

Amend pairing (answers deferred-work 504/655): a `removed` UPDATE and an `added` INSERT of the same table (`leave_records`, `roster_overrides`, `shift_type_overrides`) pair when they share `transaction_id` (live) or both are `backfill` with equal `occurred_at`, and share the pairing key — `leave_records`: `member_id`; `roster_overrides`: `team_id, date`; `shift_type_overrides`: `team_id, date`. Several candidates under one key pair in ascending `id` order; an unpaired one stays its own entry.

Period: `?razdoblje=` is `7-dana`, `30-dana` (default), `90-dana`, `365-dana` (days ending the organization's today, inclusive; non-numeric so the router keeps them strings) or `YYYY-MM`, one of the 12 months ending with the current one. Read window: `[from − 1 day]T00:00:00Z` ≤ `occurred_at` < `[to + 2 days]T00:00:00Z` (any zone offset fits within ±14 h); each event's zone day is `organizationIsoDate(new Date(occurred_at), zone)` (a day, so the dropped microseconds do not matter), and entries outside `[from, to]` are dropped. Order stays the read's `(occurred_at, id)` desc.

**Deferred inputs and answers.**
- `:1535` (a) `occurred_at` is the transaction start. Answer: the marker is a row placed by `(occurred_at, id)` like any other; a `trigger` event dated before it is drawn as an ordinary live entry (reconstructed means `origin = 'backfill'` only); the begins statement names the marker's time ("bilježi se od") and never claims nothing precedes it. A newest-first keyset read can miss an event that commits behind the cursor during the read: every load reads the whole period afresh (no incremental cache), so it appears on the next read (focus, reconnect, retry or period change). RESOLVED by story 14.2.
- `:1532` (b) index by `transaction_id` / `(table_name, row_id)`. Answer: not needed — amend pairing and decision subjects are joins in the browser over the period already read, and 14.2 has no per-record read; the marker read is one small query inside the organization's rows (RLS + the existing index's prefix). No migration. RESOLVED by story 14.2.
- `:504`, `:655` (pairing of several remove-and-insert pairs in one transaction, and pre-0061 amends). Answered by the pairing rule above; their 14.2 parts RESOLVED by story 14.2.
- Closed entries that leave something to "Epic 14's change history" (`:378`, `:570`, `:577`, `:703`, `:757`, `:913`, `:916`): satisfied by the surface reading every attributed write; no change.

**Where history begins:** the marker's `occurred_at`, else the organization's own `INSERT` event, else the earliest event read. The statement shows when the period's first day is on or before that day.

## Epic AC Deviations

- "chips for period, member, team and kind": the period chip offers fixed choices (last 7/30/90/365 days, or one of the last 12 months), not a free date range. Narrowed: a free range is not needed to answer "what happened", and the shared option-chip bar picks one value. Reinterpreted.
- "kind … in words from codes": the kind is drawn as the record word and the action word (`Odsutnost · uklonjeno`), from two code lists, rather than one sentence per kind. Reinterpreted.
- "*bilo → sada*": an addition shows only *sada* values and a deletion only *bilo*; the amended pair shows the removed values as *bilo*. Reinterpreted.
- "in words from codes": a column or enum value this build does not know (a column added later, an old key shape, or a table audited after this build, drawn as the record *Zapis*) is shown by its raw column name and stored value rather than in words from codes. Reinterpreted, on AD-11's "the domain reads every key shape a migration ever wrote".

## Verification

**Commands:**
- `export PATH=/root/.local/bin:$PATH` first.
- `pnpm typecheck` -- expected: exit 0.
- `pnpm lint` -- expected: exit 0.
- `pnpm -r test` -- expected: pass except the 4 known Node-22 `ERR_NO_TYPESCRIPT` cases in `apps/web/src/lib/i18n/format.test.ts` (a `leave-overview` property test may time out under load: rerun).
- `pnpm build` -- expected: exit 0; the PWA precache stays the app shell (no runtime caching).
- `pnpm exec vitest run test/resource-hygiene.test.ts test/supabase-scaffold.test.ts test/import-cycles.test.ts test/feature-boundaries.test.ts test/key-hygiene.test.ts test/theme-contrast.test.ts` -- expected: all pass.

**Manual checks (if no CLI):**
- No local Supabase stack: the read against real PostgREST (the `or` keyset filter with a quoted timestamp, RLS) and the e2e specs are verified only in CI.

## Auto Run Result

Status: done (review complete; e2e and the real PostgREST read are unrun locally, CI is the gate).

**Summary:** *Povijest promjena* (`/povijest-promjena`), an admin-only destination under *Pregled* after *Ljudi*, reads one period (7/30/90/365 days or one of the last 12 months, in the organization's zone) of `audit_events` by direct PostgREST select under RLS, in 1000-row keyset pages on the raw `(occurred_at, id)`, plus the begins marker. `packages/domain/src/history.ts` gives each event its meaning as codes and operands (record + action kind, author code, subjects including a decision's request, *bilo → sada* operands, amend pairing, filters, where history begins). The page draws a table (stacked rows below 640 px) with chips Razdoblje, Osoba, Smjena, Vrsta; reconstructed rows and the marker are marked; the begins statement depends on its source. History is never persisted and shows an offline notice offline. `historyRowsOf` yields the filtered, ordered rows as one value for 14.3. No migration.

**Files changed (key):**
- `packages/domain/src/history.ts` (+ `test/history.test.ts`, `index.ts`): the meaning module.
- `apps/web/src/features/history/` (services `history-read`, `history-search`, `history-rows`, `history-states`; hook `use-change-history`; components body, filters, table, stacked rows, changes, begins) and `apps/web/src/pages/povijest-promjena.tsx`, `router.ts`.
- Navigation tables, copy, icons and their tests; `router.test.ts`, `persistence.test.ts`, sweep and pin fixtures; `eslint.config.js` `FEATURE_PUBLIC`.
- `hr.json` (`nav.povijestPromjena`, `shell.description.povijestPromjena`, `history.*`); `test/resource-hygiene`, `test/localization-applied`, `test/supabase-scaffold` updates.
- e2e: `e2e/pages/history.page.ts`, `e2e/tests/history/history.spec.ts`, `e2e/utils/database-helper.ts` (`renameTeamInSql`), `e2e/utils/i18n.ts`, `e2e/tests/layout/phone-navigation.spec.ts`.
- Docs: `epics.md` UX-DR32/33/51, `EXPERIENCE.md` §IA, `DESIGN.md` stacked-rows lists, spine AD-11 "Applied (story 14.2)", `deferred-work.md` (1532, 1535 RESOLVED; 504/655 14.2 parts), `pages/README.md`, `epic-14-context.md` (recompiled).

**Review:** 11 patches (medium 3, low 8), 3 deferred (low), 12 rejected.

**Follow-up review:** recommended (patched medium 3, low 8; score 3×3+8 = 17).

**Verification:** `pnpm typecheck` 0; `pnpm lint` 0; `pnpm build` 0 (precache 13 app-shell entries, no runtime caching); `pnpm -r test`: domain 734/734, web 6414 pass, 4 fail (the known Node-22 `format.test.ts` cases; `leave-overview` property tests pass when not under load); 7 DB-free root tests (resource-hygiene, supabase-scaffold, import-cycles, feature-boundaries, key-hygiene, theme-contrast, localization-applied) 2892/2892.

**Residual risks:** the PostgREST keyset `or` filter with a quoted microsecond timestamp, RLS on the live read and every e2e spec (history, phone-navigation, sign-in) run only in CI; the e2e's SQL rename is credited to *Sustav*, so a member-named author is proven only by unit tests. Deploy: the SPA ships after `0061` (DEPLOY.md / spine).
