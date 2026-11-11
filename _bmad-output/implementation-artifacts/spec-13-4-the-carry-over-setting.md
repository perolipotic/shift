---
title: 'Story 13.4: The carry-over setting'
type: 'feature'
created: '2026-11-11'
status: 'done'
baseline_commit: '278dd2a72da56eaea984771c6a2da59f5cfc2a06'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-13-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** R4.13–R4.15 derive carried-over leave from an organization's cap and expiry date, and nothing stores either today.

**Approach:** The setting half of 13.4 (PO split, 2026-11-11; the derivation and its surfaces are 13.4b). Migration `0057` adds the cap, the expiry day and month, and the first leave year carried into. The admin sets them in one dialog on *Organizacija*. Nothing is derived from them yet.

Baseline is 278dd2a7 (13.3b merged). `hr.json` and the structural pins are hot files, so no hot-file story runs in parallel.

## Boundaries & Constraints

**Always:**
- **Columns on `organizations`, nullable, no default (DI-8):**
  - `carry_over_max_days smallint`, check `>= 1`.
  - `carry_over_expiry_month smallint` (1–12) and `carry_over_expiry_day smallint` (1 to the month's last day, February 28). 30.06. must fit.
  - `carry_over_first_leave_year smallint` (1–9999), the first leave year carried INTO (PO, 2026-11-11). Nothing carries into an earlier year.
  - A named check: all four null (no carry-over) or all four set.
  - `grant update` on the four columns to `authenticated`. The update policy is unchanged.
- **AD-2:** the setting is current-state, like minimum members. A change re-derives every balance (R4.15). `ARCHITECTURE-SPINE.md` gets the row with `Amended 2026-11-11 (story 13.4)`.
- **Dialog *Prijenos godišnjeg*,** its own card after *Vrijeme i godina*:
  - Fields: *Najviše dana* (text, numeric, empty = no carry-over); *Istječe* (day and month selects, like the leave-year start); *Od godine godišnjeg* (text, numeric).
  - Empty *Najviše dana*, or `0` (R4.13, PO 2026-11-11), saves all four as null, whatever the other fields hold. The column check stays `>= 1`.
  - Otherwise each field is refused before sending, named and marked.
  - The card's fact is "Najviše {count} dana. Preneseni dani istječu {dayMonth}, od godine godišnjeg {year}." (the count plural; the verb tied to *preneseni dani*, PO 2026-11-11) or "Bez prijenosa." The saved notice takes the same shape.
  - The save notice, the offline gate and the focus return follow minimum members.
- The parser tolerates a snapshot cached before 0057: the missing columns read as no carry-over.

**Ask First:** a fifth column or any versioning of the setting; a default value; a derived figure anywhere; copy beyond the dialog's.

**Never:** derive carry-over or touch a balance (13.4b); change the members list select; set the setting in `seed.sql` or the demo; apply 0057 locally, patch `test/database.ts`/`e2e/utils/*` to apply it, run DB-connecting root tests locally; commit.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Set | 5, 30.06., 2027 | four columns set; fact "Najviše 5 dana. Preneseni dani istječu 30.06., od godine godišnjeg 2027." | N/A |
| Clear | *Najviše dana* empty or `0` | four nulls; "Bez prijenosa." | N/A |
| Bad cap | `-1`, `2.5`, > smallint | refused, field marked | ORGANIZATION_CARRY_OVER_INVALID |
| Bad year | empty, `0`, `10000` with a cap | refused, year field marked | same code |
| Impossible date | 31.06., 29.02. | refused by the parser; the DB check refuses it too | same code |
| Old cache | row without the columns | reads as no carry-over | N/A |
| Partial row by SQL | cap set, year null | refused by the all-or-none check | 23514 |

## Epic AC Deviations

- AC 1 ("carried-over days are derived from the previous year's unused balance, capped …, and expire on the date"): NARROWED. 13.4 stores the setting only. The derivation is 13.4b (`deferred-work.md`, "Story 13.4b"). ADDED (PO, 2026-11-11): the first leave year carried into, so years before the app was used carry nothing.
- AC 2 ("carried days are consumed before the current allowance") and AC 3 ("tiles and the leave overview show carried days and their expiry"): DEFERRED to 13.4b, same entry.
- AC 4 (docs in the same change): met for what 13.4 changes.

</frozen-after-approval>

## Code Map

- `supabase/migrations/0048_minimum_members.sql:27-34` -- precedent: nullable column, named check, column grant, header (DI-8, AD-2)
- `supabase/migrations/0004_organization_settings.sql:58-77,126-134` -- the organizations update policy and column-grant model
- `apps/web/src/features/organization/services/snapshot.ts` -- `ORGANIZATION_COLUMNS` :121, `OrganizationSnapshot` :173, `minimumMembersOf` :180 (lenient read), edit shapes :197-370 (each lists the others as `?: never`), union :382, guards :434, codes :478, fields :498, `ORGANIZATION_CONSTRAINT_FIELDS` :595, `organizationSnapshotOf` :632, `organizationEditColumns` :708 (exhaustive `never`), `updateOrganization` :968
- `apps/web/src/features/organization/components/organization-minimum-members-card.tsx` -- card, fact, opener, notice, `OrganizationChangeDialog` to copy
- `apps/web/src/features/organization/components/organization-time-card.tsx:108-176` -- the day/month select layout; `utils/leave-start.ts` `LEAVE_START_MONTHS`, `formatIsoDayMonth`
- `apps/web/src/features/organization/utils/minimum-members.ts:23-39` -- parser precedent
- `apps/web/src/features/organization/hooks/use-organization-settings.ts` -- `saveMinimumMembers` :469 (dependents `[]` here), field-to-element map :84
- `apps/web/src/features/organization/utils/dialogs.ts`, `utils/element-ids.ts`, `components/organization-settings-card.tsx:88-94` (card order), `settings-screen.fixture.ts:34`
- `apps/web/src/lib/i18n/locales/hr.json:1143-1220` -- `organization.*`
- Tests: `test/supabase-scaffold.test.ts:897-950` (grant union) and a 0057 block after :3385; `test/rls-isolation.test.ts:~2300-2352` (live grant set), `:23382-23470` (0048 cases to copy); `apps/web/src/pages/structural-pins-settings.test.ts:87-89,226-258,291,608-615`; `features/organization/services/snapshot.test.ts:136,264-277`
- E2E: `e2e/tests/organization/minimum-members.spec.ts`, `e2e/pages/organization.page.ts:41-80`
- Docs: `EXPERIENCE.md:47,112,135`; `ARCHITECTURE-SPINE.md:65,68,72-73,396`

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0057_carry_over_setting.sql` -- the four columns, checks, the all-or-none check, the grant; header naming 13.4, DI-8, AD-2
- [x] `ARCHITECTURE-SPINE.md` -- AD-2 row *Carry-over setting · Current-state*, amended 2026-11-11 (13.4); the CAP row like :396
- [x] `organization/services/snapshot.ts` (+test) -- columns, lenient read, `OrganizationCarryOverEdit`, code, field map, constraint names, write branch
- [x] `organization/utils/carry-over.ts` (+test) -- the entry parser and the valid days per month
- [x] `organization/components/organization-carry-over-card.tsx`, `organization-settings-card.tsx`, `hooks/use-organization-settings.ts`, `utils/dialogs.ts`, `utils/element-ids.ts`, `settings-screen.fixture.ts` -- card, dialog, save
- [x] `hr.json` -- `organization.carryOver*` and `organization.error.carryOver`
- [x] `structural-pins-settings.test.ts` -- counts, dialog list, opener, dependents
- [x] `test/supabase-scaffold.test.ts`, `test/rls-isolation.test.ts` -- grant set, a 0057 block, the check cases and a REST PATCH (CI)
- [x] `e2e/pages/organization.page.ts`, `e2e/tests/organization/carry-over.spec.ts` -- set, refuse one bad value, clear, restore
- [x] `EXPERIENCE.md` -- the card in :47 and :112; the stale dialog count at :135
- [x] `sprint-status.yaml` -- add `13-4b-carry-over-is-derived-and-shown: backlog`

**Acceptance Criteria:**
- Given an admin, when they save 5, 30.06. and 2027, then one PATCH sends the four columns, the card reads the new fact from the returned row, and nothing else re-reads.
- Given a member-role session, when it PATCHes any carry-over column, then RLS refuses it.

## Design Notes

**Expiry in year Y (for 13.4b):** the first date on or after Y's first day with the stored day and month. A start of 01.01. with expiry 30.06. gives 30.06.Y. A start of 01.07. with 30.06. gives 30.06.(Y+1), the year's last day. Carried days are usable THROUGH the expiry date (R4.14: consumed by Leave Days dated on or before it) and lapse after it, so an expiry equal to the start day leaves them one day. Moving the leave-year start moves the expiry with it; 13.4b derives both from the current settings (AD-2 current-state).

## Verification

**Commands:**
- `PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH" pnpm lint && … pnpm typecheck` -- pass
- `… pnpm --filter ./apps/web exec vitest run` -- pass
- `SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:1/postgres … pnpm exec vitest run test/supabase-scaffold.test.ts test/resource-hygiene.test.ts` -- pass. DB tests and e2e run in CI; 0057 is not applied locally.

## Suggested Review Order

**The setting's shape**

- Entry point: four nullable columns, all four or none, no default.
  [`0057_carry_over_setting.sql:60`](../../supabase/migrations/0057_carry_over_setting.sql#L60)

- The expiry day against its month, February at 28; 30.06. fits.
  [`0057_carry_over_setting.sql:49`](../../supabase/migrations/0057_carry_over_setting.sql#L49)

- One column grant joins the union; the update policy is untouched.
  [`0057_carry_over_setting.sql:79`](../../supabase/migrations/0057_carry_over_setting.sql#L79)

- AD-2 classifies it current-state, like minimum members.
  [`ARCHITECTURE-SPINE.md:70`](../planning-artifacts/architecture/architecture-shift-2026-09-02/ARCHITECTURE-SPINE.md#L70)

**Reading and writing it**

- The lenient read: an old cache, a partial set or an impossible date is none.
  [`snapshot.ts:226`](../../apps/web/src/features/organization/services/snapshot.ts#L226)

- The write always sends all four columns, or four nulls to clear.
  [`snapshot.ts:902`](../../apps/web/src/features/organization/services/snapshot.ts#L902)

- The entry parser: empty or 0 clears; otherwise each field refused by name.
  [`carry-over.ts:74`](../../apps/web/src/features/organization/utils/carry-over.ts#L74)

**The dialog on Organizacija**

- The form seeds from the same lenient read as the card's fact.
  [`organization-carry-over-card.tsx:128`](../../apps/web/src/features/organization/components/organization-carry-over-card.tsx#L128)

- The save follows minimum members and re-reads nothing else.
  [`use-organization-settings.ts:517`](../../apps/web/src/features/organization/hooks/use-organization-settings.ts#L517)

**Peripherals**

- Parser cases, incl. the fact for 1, 21 and 5 days.
  [`carry-over.test.ts:40`](../../apps/web/src/features/organization/utils/carry-over.test.ts#L40)

- Check and REST refusals, member-role PATCH refused (CI).
  [`rls-isolation.test.ts:23487`](../../test/rls-isolation.test.ts#L23487)

- The 0057 source pins.
  [`supabase-scaffold.test.ts:3394`](../../test/supabase-scaffold.test.ts#L3394)

- E2E: set in one PATCH, refuse 31.06. unsent, clear.
  [`carry-over.spec.ts:34`](../../e2e/tests/organization/carry-over.spec.ts#L34)
