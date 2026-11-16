# Epic 14 Context: Every change can be read back, and printed

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

An admin can read back who changed what and when in their organization: the before and after values, deletions included. They can filter that history and export exactly what they filtered as a PDF. Attribution columns already exist on every asserted row. This epic records every write to an organization table in an append-only `audit_events` table, makes it readable on one admin-only surface, and prints it. Member-role accounts reach none of it (decision D4). The Architect pass on 2026-11-16 amended AD-3 and AD-11 and resolved the deferred "conflict-resolution history". Story 14.1 applies those amendments. The epic proves Q11 and the amended Q12: every write to an organization's records can be reconstructed with its author, time, before and after.

## Stories

- Story 14.1: Every change is recorded in the change history
- Story 14.2: An admin reads the change history
- Story 14.3: The change history exports to PDF

## Requirements & Constraints

- History records every write to a rule, an exception, a decision, a request, a member or a setting, with its author, time and before/after values, deletions included. It filters by period, member, team and kind. The PDF holds exactly the filtered rows.
- **Admin only.** A member-role account, an inactive admin, `anon` and `service_role` read nothing, through the UI or a direct API call (Q2, D4).
- **History begins at 14.1's migration.** Earlier entries are reconstructed from the existing attribution columns. Hard deletes and current-state edits made before the migration (a rename, an archive flag, a member's details) were never recorded. They are unrecoverable and must be stated as such.
- **Online only.** History is never persisted on the device and is unavailable offline. It holds departed members' details, and the offline role guard trusts a cached role. The PDF export is online only too.
- No server and no paid service. Retention is unbounded, and only the owner, as an operator task, prunes or redacts events.
- 14.2 updates DESIGN.md, EXPERIENCE.md §IA and UX-DR32, 33 and 51 in the same change. The surface inventory goes from 22 to 23.

## Technical Decisions

**`audit_events` table (AD-11, amended):**
- Columns: `organization_id uuid not null` (first); `id bigint generated always as identity` PK (write order); `table_name text`; `operation text` (`INSERT`/`UPDATE`/`DELETE`/`HISTORY_BEGINS`); `row_id text` (the audited row's key); `old_row jsonb` and `new_row jsonb` (whole rows, null where not applicable); `actor uuid` (nullable `auth.uid()`); `session_role text` (raw `current_setting('role')`); `origin text` (`trigger`/`backfill`); `transaction_id xid8` (null on backfill); `occurred_at timestamptz default now()`, a permitted timestamptz.
- Whole rows are stored, never a diff. The diff, kind and subject are derived on read (AD-1, AD-7).
- **No foreign key.** History outlives what it records, and a foreign key would abort the operator's organization delete.
- One index: `(organization_id, occurred_at desc, id desc)`.

**Trigger (AD-3, amended, a second permitted trigger class):**
- One function, `private.record_audit_event()`: SECURITY DEFINER, owned by the migration owner, `search_path = ''`, every name qualified. Execute is revoked from `public`, `anon`, `authenticated` and `service_role`.
- Each audited table gets two AFTER ROW triggers: `<table>_audit` (INSERT OR DELETE) and `<table>_audit_update` (UPDATE `WHEN (old.* IS DISTINCT FROM new.*)`, so a no-op update records nothing).
- The two `tg_argv` values are the organization column and the key column: `organizations` → `id, id`; `leave_request_decisions` and `swap_request_decisions` → `organization_id, request_id`; every other table → `organization_id, id`.
- Each write inserts one row of `to_jsonb(OLD)`/`to_jsonb(NEW)`, `auth.uid()`, `current_setting('role')`, `pg_current_xact_id()` and `now()`.
- The function reads no other table, computes nothing and refuses nothing. It is never gated on `pg_trigger_depth()`, so writes made by definer RPCs and nested triggers (0041/0049 deactivation closes) are recorded too.
- It adds no refusing trigger. An event commits or rolls back with its write.

**Attribution:**
- `actor` is an event's only author.
- Live, `actor` is the request's JWT user, including writes made inside definer RPCs (`decide_swap_request`, `amend_leave_record`), nested definer triggers, and `admin-auth`'s caller-client `members` write.
- Some writes have no JWT user: owner writes (migrations, the seed, operator tasks), GoTrue cascades, and `service_role` writes. Their `actor` is null, and the surface names them by one code from `session_role`: `service_role`, or a system write for any other role. It never names them from an attribution column.
- An actor who is no longer a member is named from history's `members` DELETE old row, else with *Odlučeno*'s departed-admin wording.
- Writes to `auth.users` are not recorded.

**Append-only by privilege:**
- RLS is enabled.
- REVOKE ALL (TRUNCATE included) on `audit_events` from `public`, `anon`, `authenticated` and `service_role`, then GRANT SELECT to `authenticated` only. There is no insert, update or delete policy.
- Also revoke TRUNCATE on the 21 audited tables from `anon`, `authenticated` and `service_role`.
- No refusing trigger guards `audit_events`.
- Select policy `audit_events_select_by_own_active_admin`: `organization_id` equals the JWT claim and the organization of `current_member_access()`, where `is_active` and `member_role = 'admin'` (AD-10).
- `test/provisioning.test.ts` pins the table's privileges and lists `record_audit_event` among the definers.

**Audited tables (21):**
- `organizations`, `members`, `member_status_versions`, `team_membership_versions`, `teams`, `hour_bands`
- `shift_types`, `shift_type_versions`, `rotation_patterns`, `rotation_steps`, `rotation_assignments`
- `shift_type_overrides`, `roster_overrides`, `leave_records`, `conflict_resolutions`
- `leave_requests`, `leave_request_decisions`, `swap_requests`, `swap_request_decisions`
- `absence_types`, `leave_allowances`

**Excluded tables:**
- `audit_events` itself.
- `notification_outbox`: delivery state, every row a consequence of an audited fact.
- `push_subscriptions`: holds credentials.
- `notification_settings`: a member's own preference. The organization's `email_notifications` is audited.

**Rules for the table lists:**
- No column is pruned. A secret column added to an audited table amends AD-11.
- New convention: every new organization-scoped table attaches both triggers in the migration that creates it, or is named excluded in AD-11. `test/supabase-scaffold.test.ts` fails a table that does neither.
- Nothing writes `audit_events` except the trigger and 14.1's backfill.

**Deletes:**
- A DELETE event keeps the old row, so deleted names stay readable.
- An auth-user delete cascades, and each cascaded delete is recorded. It still aborts on non-cascading references.
- An organization delete is an operator act.
- Events are never rewritten by a later migration. The domain reads every key shape a migration ever wrote.

**Backfill (14.1, one transaction):**
1. Create the table and attach the triggers. Each `CREATE TRIGGER` holds its table's lock, so no write falls in the gap.
2. Backfill with `origin = 'backfill'`, null `transaction_id`, and `actor` set from the source attribution column.
3. For each row of the 15 tables with `created_by`/`created_at`, write one `INSERT` at `created_at` by `created_by`. Its `new_row` is the row as it stands now, with every later attribution pair nulled.
4. Then, per row, the non-null later pairs in time order: `removed_*`, `confirmed_*`, `closed_*`, and `answered_*` with `answer`. Pairs that share a timestamp merge into one event. Each becomes an `UPDATE` by that pair's author. Its `old_row` is the row with this pair and every later pair null. Its `new_row` is the same row with this pair set.
5. For the two decision tables, write one `INSERT` at `decided_at` by `decided_by`, with `row_id` = the request id.
6. `organizations`, `members`, `hour_bands` and `absence_types` get no backfilled events.
7. Last, one `HISTORY_BEGINS` event per existing organization: `table_name 'organizations'`, `row_id` the organization's id, null rows, null actor, `occurred_at` the migration's `now()`.

A backfilled event carries the row's other values as they were at the migration, not as first written. The surface marks backfilled entries as reconstructed and says where history begins: at the marker, else at the organization's own `INSERT` event, else at the earliest event read.

**Reading (14.2):**
- A direct PostgREST select under RLS (AD-9), with no RPC and no view.
- One required period of whole days in the organization's zone, at most 366 days, newest first.
- Keyset paging on `(occurred_at, id)`. The cursor is the raw `occurred_at` string plus `id`, never passed through a JS `Date`, which drops microseconds. Pages hold at most 1000 rows, and the read stops at the first short page.
- The read also fetches the organization's `HISTORY_BEGINS` and `organizations` `INSERT` events.
- The whole period is one snapshot key (AD-13). The member, team and kind chips filter in the browser.
- One `packages/domain` module owns the meaning: the kind code (from table, operation and changed columns), the field-level *bilo → sada*, the subject ids, and the filter. It returns codes and operands, never prose (AD-8).
- A decision names its subject through its request: the request's event in the same `transaction_id`, or, when backfilled, the request with that `row_id`. Subjects are matched by the ids a row names, never by derived membership.
- Code lives in `features/history`.

**PDF (14.3):**
- Follows the hours export's pattern. `features/history/services/history-export.ts` builds the PDF from exactly the rendered filtered rows, in order, with no second read (AD-13).
- One module alone knows `pdfmake` and loads it by dynamic `import()`. It registers the fonts itself (`addVirtualFileSystem`, the 0.3 API).
- Bundled Roboto draws č/ć/đ but has no `→`, so *bilo* and *sada* get separate columns. A test asserts that every drawn character is in the font.
- The writer's chunks (~1.7 MB) are excluded from the service worker's precache (`globIgnores`).
- 14.3 pins an exact `pdfmake` 0.3.x version at least two weeks old (0.3.13 before 2026-11-22) in the spine's Stack table.

**Cost and tests:**
- Each audited write adds one row insert in the same transaction.
- The seed, the demo script and the e2e helpers now leave owner-attributed events, so no test may assume `audit_events` is empty.

**Deploy order:**
- The 14.1 migration is `db push` only, outside the pilot's working hours, because attaching the triggers briefly locks each table. No SPA or function change.
- 14.2's SPA ships after the migration.
- `notify` and `admin-auth` are unchanged.

**Known gap, not fixed here:** the refusing "ordinary triggers" shipped in 0023, 0031, 0035, 0036 and 0039 are not named in AD-3. The gap is recorded for later reconciliation and is not ratified.

## UX & Interaction Patterns

- *Povijest promjena* sits under *Pregled* in the admin's *Više*. It is a table of time, author, kind, subject and *bilo → sada*, in words from codes, with stacked rows below 640 px.
- Filter chips: period, member, team, kind. One `Izvezi u PDF` button.
- The PDF names the organization, the period and the generation time.
- Backfilled entries are marked as reconstructed, and the surface says where history begins.
- *Odlučeno* stays a read of stored decisions and is not the history surface.

## Cross-Story Dependencies

- 14.1 needs the Architect pass, which is done. 14.2 depends on 14.1 being deployed. 14.3 depends on 14.2's rendered snapshot.
- Any future migration that adds an organization-scoped table must attach the audit triggers or amend AD-11's exclusion list.
- The backfill reads attribution columns from Epics 3, 5, 9, 12 and 13 (overrides, leave, resolutions, requests, decisions, swaps, allowances). The history surface needs read paths (and decoders) for every column shape those tables have ever had.
