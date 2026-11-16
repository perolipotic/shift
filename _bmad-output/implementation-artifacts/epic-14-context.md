# Epic 14 Context: Every change can be read back, and printed

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

An admin can read back who changed what, and when, in their organization. They see before and after values, deletions included. They can filter that history and export exactly the filtered rows as a PDF. Attribution columns record only the author of the row they sit on. This epic adds an append-only `audit_events` table, written by a trigger on every audited organization table. Story 14.1 shipped it as migration `0061`, with a backfill. Story 14.2 makes it readable on one admin-only surface, and story 14.3 prints it. Member-role accounts reach none of it (decision D4). The epic proves that every write to an organization's records can be reconstructed with its author, time, before and after, and read by admins.

## Stories

- Story 14.1: Every change is recorded in the change history
- Story 14.2: An admin reads the change history
- Story 14.3: The change history exports to PDF

## Requirements & Constraints

- **What history shows.** Every write to a rule, an exception, a decision, a request, a member or a setting, with its author, time and before/after values. Deletions are included. It filters by period, member, team and kind, and the PDF holds exactly the filtered rows.
- **Admin only.** A member-role account, an inactive admin, `anon` and `service_role` read nothing, through the UI or a direct API call.
- **Where history begins.** It begins at `0061`. Earlier entries were reconstructed from attribution columns. Hard deletes and current-state edits made before then (a rename, an archive flag, a member's details) are unrecoverable, and the surface must say so.
- **Online only.** History is never persisted on the device and is unavailable offline. It holds departed members' details, and the offline role guard trusts a cached role, so a demoted admin's device could otherwise keep the data for 30 days. The PDF export is online only too.
- **Cost and retention.** No server and no paid service. Retention is unbounded. Only the owner, as an operator task, prunes or redacts events (this is deferred).
- **Docs in the same change.** 14.2 updates DESIGN.md, EXPERIENCE.md §IA, UX-DR32, UX-DR33 (inventory 22 → 23) and UX-DR51 in the change that ships it, rewriting the "Planned" notes.

## Technical Decisions

**`audit_events` (shipped in 14.1):**
- **Columns:**
  - `organization_id` comes first.
  - `id` is an identity column, so ids follow write order.
  - `table_name`, `operation` and `row_id` (text).
  - `old_row` and `new_row` (jsonb).
  - `actor` (nullable `auth.uid()`).
  - `session_role`, the raw `current_setting('role')`.
  - `origin` (`trigger` or `backfill`).
  - `transaction_id` (xid8, null when backfilled).
  - `occurred_at`, a permitted timestamptz.
- **Whole rows, never a diff.** The diff, the kind and the subject are derived on read.
- **No foreign key.** History outlives what it records.
- **Index:** `audit_events_organization_occurred_idx` on `(organization_id, occurred_at desc, id desc)`.
- **Shape checks:**
  - `operation` is one of INSERT, UPDATE, DELETE and HISTORY_BEGINS.
  - `origin` is `trigger` or `backfill`.
  - `transaction_id` is set exactly when `origin = 'trigger'`.
  - INSERT has a new row only, UPDATE has both rows, DELETE has an old row only, and HISTORY_BEGINS has neither and is always a backfill.
- **Append-only by privilege.** RLS is on. Only `authenticated` holds SELECT, and nothing holds insert, update, delete or truncate, on the table or its sequence. TRUNCATE is also revoked on the 21 audited tables.
- **Read policy:** `audit_events_select_by_own_active_admin`. The organization must match the JWT claim and `current_member_access()`, and that member must be an active admin.

**Trigger class (AD-3 amendment, applied):**
- `private.record_audit_event()` is a plpgsql SECURITY DEFINER function with `search_path = ''`. Its body is one insert plus `return null`, and execute is revoked from every client role.
- It is attached as 42 triggers, two per table:
  - `<table>_audit`: AFTER INSERT OR DELETE.
  - `<table>_audit_update`: AFTER UPDATE `WHEN (old.* IS DISTINCT FROM new.*)`, so a no-op update records nothing.
- It computes nothing, refuses nothing and is never gated on trigger depth. Writes made by definer RPCs and nested deactivation triggers are therefore recorded.
- An event commits or rolls back with its write, so history holds only committed writes.
- `row_id` is the table's `id`, except on the two decision tables, where it is `request_id`.

**Audited and excluded tables:**
- **Audited (21):**
  - `organizations`, `members`, `member_status_versions`, `team_membership_versions`, `teams`, `hour_bands`
  - `shift_types`, `shift_type_versions`, `rotation_patterns`, `rotation_steps`, `rotation_assignments`
  - `shift_type_overrides`, `roster_overrides`, `leave_records`, `conflict_resolutions`
  - `leave_requests`, `leave_request_decisions`, `swap_requests`, `swap_request_decisions`
  - `absence_types`, `leave_allowances`
- **Excluded:** `audit_events`, `notification_outbox`, `push_subscriptions` (it holds credentials) and `notification_settings`.
- **Convention for new tables:** a new organization-scoped table attaches both triggers in the migration that creates it, or is named as excluded in AD-11. The scaffold test enforces this.
- **Who writes:** nothing writes `audit_events` except the trigger and the 14.1 backfill.
- **Old events stay as written.** No later migration rewrites them, so the domain must read every key shape a migration ever wrote.

**Attribution:**
- `actor` is an event's only author.
- **Null actor.** Owner writes (migrations, the seed, operator tasks), GoTrue cascades and `service_role` writes all have a null `actor`. Each gets one code from `session_role`: `service_role`, or a system write for any other role. Never fall back to an attribution column.
- **Departed actor.** Name them from the `members` DELETE event's old row, else use *Odlučeno*'s departed-admin wording.
- **Backfilled events:**
  - Their `session_role` is the migration's role, so it is always a system role.
  - Their `actor` comes from the source attribution pair. Where pairs share an instant, the confirmed pair is credited before the removed pair, and the answered pair before the closed pair.
  - Their rows are `to_jsonb(r)`, so the keys match live events.
  - Each organization has one HISTORY_BEGINS marker, with null rows and null actor.
- **Reconstructed entries.** A backfilled event carries the row's other values as they were at the migration. The surface marks it as reconstructed. It says history begins at the marker, else at the organization's own INSERT event, else at the earliest event read.

**Reading (14.2):**
- A direct PostgREST select under RLS, with no RPC and no view.
- The period is required: whole days in the organization's zone, at most 366, newest first.
- **Keyset paging on `(occurred_at, id)`:**
  - The cursor is the raw `occurred_at` string plus `id`, never passed through a JS `Date`, which loses microseconds.
  - Pages hold at most 1000 rows, and the read stops at the first short page.
  - It also fetches the organization's HISTORY_BEGINS and `organizations` INSERT events.
- The whole period is one snapshot key. The member, team and kind chips filter in the browser.
- **The domain module.** One `packages/domain` module owns the meaning and returns codes and operands, never prose. It derives:
  - the kind code, from the table, the operation and the changed columns;
  - the field-level *bilo → sada*;
  - the subject ids;
  - the filter.
- **Decision subjects.** A decision names its subject through its request. For a live decision, that is the request's event in the same `transaction_id`. For a backfilled one, it is the request with that `row_id`, read from the period or from current requests.
- **Subject matching.** Subjects are matched by the ids a row names, never by membership derived for the event's date.
- Code lives in `features/history`.

**PDF (14.3):**
- It follows the hours export's pattern. `features/history/services/history-export.ts` builds the PDF from exactly the rendered filtered rows, in order, with no second read.
- **The writer is `pdfmake`:**
  - It lives in `apps/web` only.
  - One module alone imports it, by dynamic `import()`.
  - That module registers the fonts with `addVirtualFileSystem` (the 0.3 API).
- **Fonts.** The bundled Roboto draws č, ć and đ but has no `→`. So *bilo* and *sada* get separate columns, and a test asserts that every drawn character is in the font.
- **Precache.** The writer's chunks (about 1.7 MB) are excluded from the service worker's precache through `globIgnores`.
- **Version pin.** The spine's Stack table lists `pdfmake` 0.3.x: 0.3.14 (2026-11-08) is the latest and 0.3.13 is from 2026-10-25. 14.3 must pin an exact version at least two weeks old (0.3.13 if before 2026-11-22) and record it in that row.

**Cost and tests:**
- Each audited write adds one insert. For example, a swap approval writes 4 events.
- The seed, the demo and e2e helpers leave owner-attributed events, so no test may assume `audit_events` is empty.
- `test/rls-isolation.test.ts` re-runs the backfill block in a rolled-back transaction.

**Known gap:** the refusing triggers from 0023, 0031, 0035, 0036 and 0039 are not named in AD-3. The gap is recorded and not ratified, so do not treat it as precedent.

## UX & Interaction Patterns

- *Povijest promjena* is an admin-only surface. On a phone it sits under *Pregled* in *Više*, beside *Sati* and *Godišnji*.
- It shows a table of time, author, kind, subject and *bilo → sada*, in words built from codes. Below 640 px the rows stack.
- Filter chips: period, member, team, kind. One `Izvezi u PDF` button.
- The PDF names the organization, the period and the generation time.
- Backfilled entries are marked as reconstructed, and the surface says where history begins.
- *Odlučeno* stays a read of stored decisions and is not the history surface.

## Cross-Story Dependencies

- 14.1 is done (`0061`, migration only). 14.2's SPA must ship after the migration is deployed. 14.3 depends on 14.2's rendered, filtered snapshot.
- `notify` and `admin-auth` are unchanged by this epic.
- The history surface must decode every audited table's row shapes from Epics 1–13. That includes requests, decisions, swaps, leave with absence types, and allowances.
- Any future organization-scoped table must attach the audit triggers in its creating migration, or amend AD-11's exclusion list.
