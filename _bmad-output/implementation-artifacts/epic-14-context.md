# Epic 14 Context: Every change can be read back, and printed

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

An admin can read back who changed what in their organization, and when. Each entry shows the before and after values, and deletions are included. The admin can filter that history and hand exactly the filtered rows on as a PDF. Attribution columns stay the source of truth only for the rows they sit on. The full record is an append-only `audit_events` table, written by triggers on every audited organization table. Story 14.1 shipped the table and the triggers in migration `0061`, with a backfill. Story 14.2 made the history readable on one admin-only surface, *Povijest promjena*. Story 14.3 prints it. Member-role accounts reach none of it (decision D4). The epic proves that every write to an organization's records can be reconstructed with its author, time, before and after, and that admins can read it.

## Stories

- Story 14.1: Every change is recorded in the change history (done)
- Story 14.2: An admin reads the change history (done)
- Story 14.3: The change history exports to PDF

## Requirements & Constraints

- **What history shows.** Every write to a rule, an exception, a decision, a request, a member or an organization setting (amended 2026-11-16, epic 14 retro A6, founder decision: a member's own notification preference is not recorded), with its author, time and before/after values. Deletions are included. No surface edits or removes an entry.
- **Filters.** The history filters by period, member, team and kind.
- **What the PDF holds.** Exactly the rows the surface shows for the current filter, in the same order, built from the data the surface rendered. It names the organization, the period, the filter and the time it was generated, in the organization's locale and timezone.
- **Admin only.** A member-role account, an inactive admin, `anon` and `service_role` read nothing, through the UI or a direct API call.
- **Where history begins.** History starts at `0061`. Earlier entries were reconstructed from attribution columns. Hard deletes and current-state edits made before then (a rename, an archive flag, a member's details) are unrecoverable, and the surface says so.
- **Online only.** History is never kept on the device and is unavailable offline. It holds departed members' details, and the offline role guard trusts a cached role, so a demoted admin's device could otherwise keep the data for 30 days. The PDF export is online only too.
- **Cost and retention.** No server and no paid service. Retention is unbounded. Pruning and redaction are deferred, and only the owner may do them, as an operator task.
- **Docs in the same change.** A story updates the DESIGN.md, EXPERIENCE.md and UX-DR lines it changes in the same change. For 14.3, that means turning the "*Planned:* `Izvezi u PDF`" note in UX-DR51, and EXPERIENCE.md's "*Izvezi u PDF* is story 14.3's" note, into what shipped.

## Technical Decisions

**What 14.1 shipped: the record (AD-3 and AD-11 amendments, applied)**
- **The table.** `audit_events` holds whole rows (`old_row`/`new_row`, jsonb), never a diff. Its other columns:
  - `organization_id`;
  - `id`, an identity column, so ids follow write order;
  - `table_name`, `operation` (INSERT, UPDATE, DELETE or HISTORY_BEGINS) and `row_id` (text);
  - `actor`, which is nullable;
  - `session_role`;
  - `origin` (`trigger` or `backfill`);
  - `transaction_id`;
  - `occurred_at`.
- **Read rules.** The table has no foreign key. Old events are never rewritten, so the domain must read every key shape a migration ever wrote.
- **Writers.** Nothing writes the table except `private.record_audit_event()` and the 14.1 backfill. `record_audit_event()` is a definer trigger function that computes nothing and refuses nothing, and it is attached as two triggers on each of the 21 audited tables.
- **Readers.** Only an active admin of the organization may select, under RLS.
- **Excluded tables.** `notification_outbox`, `push_subscriptions` (it holds credentials) and `notification_settings` are not audited.
- **Convention for new tables.** An organization-scoped table attaches both audit triggers in the migration that creates it, or AD-11 names it as excluded. `test/supabase-scaffold.test.ts` enforces this.
- **Authors.**
  - `actor` is an event's only author. Never fall back to an attribution column.
  - A null actor is named by a code chosen from `session_role`: `service` for `service_role`, and `system` for any other role.
  - A departed actor is named from a `members` row that history holds, else with the departed-admin wording *Odlučeno* already uses.
- **Tests.** The seed, the demo and the e2e helpers leave owner-attributed events, so no test may assume `audit_events` is empty.

**What 14.2 shipped: the read**
- **The query.** A direct PostgREST select under RLS, with no RPC, view or migration.
- **The period** is a fixed choice:
  - the last 7, 30 (the default), 90 or 365 days, as `?razdoblje=7-dana` and so on;
  - or one of the last twelve months, as `YYYY-MM`;
  - never more than 366 days.
- **Reading the period.** PostgREST is asked for a padded UTC window. The browser then keeps the events whose day in the organization's zone falls in the period.
- **Paging.** Keyset paging on `(occurred_at, id)`, newest first. The cursor uses the raw string, never a JS `Date`. Pages hold 1000 rows.
- **Cache.** The query key is `['change-history', from, to]`. It is not persisted and is disabled offline.
- **The marker read.** A second, small read fetches the HISTORY_BEGINS marker and the `organizations` INSERT events. They give where history begins: the marker, else the INSERT, else the earliest entry read. The marker is a row of its own and does not count as a change.
- **The domain module.** `packages/domain/src/history.ts` returns codes and operands, never prose (AD-8). It defines:
  - record codes for the 21 audited tables, plus `other` for a table the build does not know;
  - action codes;
  - field codes with typed operands, with `raw` for an unknown column;
  - subject ids;
  - *amended* pairing;
  - decision subjects, matched by the same `transaction_id`;
  - author codes;
  - the filter.
- **Reconstructed entries.** *Rekonstruirano* means `origin = 'backfill'` and nothing else.
- **The filtered rows.** The member, team and kind chips filter the whole period snapshot in the browser. The filtered rows are one value, in the order they are drawn. That value is the export's only input.
- **Where the code lives.** `features/history`.

**Story 14.3: the PDF**
- **Same pattern as the hours export.** `features/history/services/history-export.ts` builds the document from exactly the filtered rows the table rendered, in order, with no second read (AD-13).
- **One module owns the writer.** Only one module imports the writer, by dynamic `import()`, and it registers the fonts itself with `addVirtualFileSystem` (the pdfmake 0.3 API).
- **The writer is `pdfmake`.** It is client-side and MIT-licensed, and it lives in `apps/web` only. It draws declarative tables whose header row repeats on each page.
- **Fonts.** The bundled Roboto draws č, ć and đ, but it has no `→`. So *bilo* and *sada* get separate PDF columns, and a test asserts that every drawn character is in the font.
- **Precache.** The writer's chunks (about 1.7 MB) stay out of the service worker's precache through `globIgnores`, so no install downloads them.
- **Version pin.** The spine's Stack table row reads "0.3.x: latest 0.3.14 of 2026-11-08, 0.3.13 of 2026-10-25". Pin an exact version that is at least two weeks old: 0.3.13 if the work lands before 2026-11-22. Then record the pinned version in that Stack row, in the same change.
- **Words come from codes.** The document's text comes from the i18n layer (AD-8), with times in the organization's zone.

## UX & Interaction Patterns

- **Where it lives.** *Povijest promjena* is at `/povijest-promjena` and is admin-only. In the sidebar it sits after *Ljudi*. On a phone it is in *Više*, beside *Sati* and *Godišnji*.
- **The table** has the columns *Vrijeme*, *Autor*, *Vrsta*, *Predmet* and *Bilo → sada*. An addition shows only the new values, and a deletion only the old ones.
- **Below 640 px** the table becomes stacked rows. Each row's title is the kind, with the *Rekonstruirano* badge where it applies.
- **Chips.** *Razdoblje*, *Osoba*, *Smjena* and *Vrsta*. Offline, the surface shows one notice and no rows.
- **`Izvezi u PDF` behaves like the hours export's `Izvezi u Excel`:**
  - It is one secondary action.
  - While the file is being built, the action shows progress and is disabled.
  - After the download, a `Notice role="status"` names the file and how many rows it holds. It is never a toast.
  - The notice belongs to the view it was built from. A new period, filter or export removes it.
- **Not the history surface.** *Odlučeno* stays a read of stored decisions.

## Cross-Story Dependencies

- 14.3 depends on 14.2's rendered, filtered snapshot. It needs no migration, and `notify` and `admin-auth` are unchanged.
- History must decode the row shapes of every audited table from Epics 1–13.
- A future organization-scoped table must attach the audit triggers in its creating migration, or amend AD-11's exclusion list.
- Known gap: the refusing triggers from 0023, 0031, 0035, 0036 and 0039 are not named in AD-3. The gap is recorded and not ratified, so it is not precedent.
