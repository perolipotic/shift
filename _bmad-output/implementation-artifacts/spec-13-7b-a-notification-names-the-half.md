---
title: '13.7b: A notification names the half'
type: 'feature'
created: '2026-11-16'
status: 'done'
review_loop_iteration: 0
baseline_commit: '8d47a4123629653152c49e42f8f86a6d3edbcf25'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The six leave notifications name a half day as a whole-day range: `leaveRequestCreated`, `leaveRequestApproved`/`Rejected`, `leaveRecorded`, `leaveRecordChanged` and `leaveRecordRemoved`. SQL writes only `{startDate, endDate}`, so an amend that changes only the half sends the same text as before it (epic 13 retro B5, split from 13.7).

**Approach:**
- Migration `0060` adds a `half` operand (`FIRST` / `SECOND`) to every leave operand set whose row carries a half. A whole day gets no `half` key at all.
- `notify` picks a half variant of the message when the operand is set, the way `RETURN_VARIANT_OF` picks a two-way swap's.
- Each variant is the same text with `(prvi dio smjene)` / `(drugi dio smjene)` after the range, matching the app's surfaces (13.7).

## Boundaries & Constraints

**Always:**
- Whole-day operands stay byte-identical (`{startDate, endDate}`, plus `requestId`/`memberName` for a new request). Whole-day text is unchanged.
- The `half` operand is written from the row itself:
  - `new.half` in `private.notify_leave_record()` (insert and removal) and in `private.notify_leave_request()`;
  - `requested_half` in `decide_leave_request`.
- An amend's `LEAVE_RECORD_CHANGED` carries the replacement's half, so a half-only amend reads differently from its predecessor.
- Functions are replaced in place (`create or replace`, same signatures), in 0059's style: a header, `-- 0060:` notes, and restated grants. The triggers stay bound.
- `notify`:
  - A `HALF_VARIANT_OF` map, key → `{FIRST, SECOND}`, covers the six keys.
  - A `half` operand that is neither value is `OPERANDS_INVALID`.
  - The variant keys get `linkPathOf` cases (same paths as their base key).
  - The copy goes into `hr.json` first, then `messages.ts`, deep-equal.
- No new placeholder: the half is fixed wording inside each variant.
- No-reason rule: these six codes reach only the subject member or admins, and no operand carries a type.

**Ask First:** Naming the old half in a changed notification ("sada…" with the previous half). That needs `remember_amended` to carry it.

**Never:**
- New notification codes, any SPA surface change, or a type in an operand.
- Applying migrations locally, running DB-connecting root tests, or patching `test/database.ts` / `e2e/utils/*`.

## I/O & Edge-Case Matrix

| Scenario | Operands | Rendered |
|----------|----------|----------|
| Half recorded | `{startDate:'2026-10-01', endDate:'2026-10-01', half:'FIRST'}`, LEAVE_RECORDED | `… odsutnost 01.10.2026–01.10.2026 (prvi dio smjene) …` |
| Half-only amend | FIRST → SECOND, same date | LEAVE_RECORD_CHANGED, `half:'SECOND'`, text names *drugi dio smjene* |
| Half → whole day | amend with `p_half` null | CHANGED with no `half` key; whole-day text |
| Half request created / approved / rejected | request `half='SECOND'` | each text names *drugi dio smjene* |
| Half removed | remove a FIRST record | REMOVED names *prvi dio smjene* |
| Whole day, any code | no `half` key | text identical to today |
| Bad half | `half:'THIRD'` | `OPERANDS_INVALID` |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0060_half_day_notifications.sql` (new). Replaces:
  - `private.notify_leave_record()` (only in `0043:189-242`; operands L199-202; insert and removal branches L207-238);
  - `private.notify_leave_request()` (`0043:490-523`; operands L514-519);
  - `public.decide_leave_request(uuid, text)` (latest `0059:52-154`; `requested_half` L98-99; operands L136-139; grants L151-154).
  - Add the half with `operands || case when x.half is null then '{}' else jsonb_build_object('half', x.half) end`. Model the private trigger-function revoke on 0043:533-544.
- `amend_leave_record` (`0058:61-143`) needs no change: its replacement insert fires the trigger with the new half.
- `supabase/functions/notify/messages.ts`:
  - `OBAVIJESTI` L18-132 (12 new entries);
  - `MESSAGE_OF_CODE` L152-176 (unchanged);
  - `RETURN_VARIANT_OF` L187-193 is the model for `HALF_VARIANT_OF`;
  - `linkPathOf` L202-242;
  - `compose` variant choice L384-385.
- `apps/web/src/lib/i18n/locales/hr.json`: the `obavijesti` namespace (~L1870). Add the 12 variant keys (`leaveRecordedHalfFirst`, …).
- `test/notify-boundary.test.ts`:
  - variant checks L228-240 (`toHaveLength(5)` at L231 changes);
  - per-code exact renders L333-519;
  - the placeholder whitelist L522-541 stays as is.
  - Add the matrix rows as `compose` tests.
- `apps/web/src/router.test.ts:183-203`: every key, variants included, has a link path.
- `test/resource-hygiene.test.ts`:
  - the obavijesti section of `SANCTIONED_SCREEN_KEYS` (~L2303-2369);
  - `HALF_DAY_KEYS` (L2822-2840 and the count comment), since the variants say "smjene".
- `test/rls-isolation.test.ts` (DB-connecting, updated **unrun**, verified in CI):
  - add outbox assertions in the half-day blocks L26146 (13.5: recorded, half-only amend, removed) and L26258 (13.5b: created, approved, rejected);
  - existing whole-day assertions L21684, L21694, L22000-22009, L22171, L22273 stay green because no `half` key is written;
  - `amendLeaveRecord` (L17866) is 3-argument, so add a half-passing call in the new test, not by changing the helper's other callers.
- `DEPLOY.md:792-834`: extend the "Epic 13, migrations 0053–0059" block with 0060. Order: `db push`, then `functions deploy notify`. An old `notify` ignores the unknown operand and sends whole-day text, so 0060 first is safe.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0060_half_day_notifications.sql`: replace the three functions with the half operand.
- [x] `hr.json`, then `notify/messages.ts`: the 12 variants, `HALF_VARIANT_OF`, the `compose` choice and validation, and `linkPathOf`.
- [x] `test/notify-boundary.test.ts`, `router.test.ts`, `resource-hygiene.test.ts`: the matrix rows and the pins.
- [x] `test/rls-isolation.test.ts`: the half-day outbox assertions (unrun).
- [x] `DEPLOY.md`: the 0060 item. `EXPERIENCE.md`: the notification line names the half, if one describes leave notification text. Checked: no EXPERIENCE.md / DESIGN.md / UX-DR line describes leave notification text; nothing to change.
- [x] `sprint-status.yaml`: `13-7-…: done`, `13-7b-…` per the workflow. `deferred-work.md`: mark the 13.7b entry RESOLVED, and the notifications part of the 13.5b entry.

**Acceptance Criteria:**
- Given a half-day record amended to the other half, when the member's email and push arrive, then they name the new half.
- Given a whole-day record or request, when any of the six notifications is sent, then its operands and text are exactly as before 0060.

## Verification

**Commands:**
- `pnpm exec vitest run test/resource-hygiene.test.ts test/supabase-scaffold.test.ts`: expected pass. These open no DB.
- `test/notify-boundary.test.ts` imports `./database.js` (rolled-back transactions), so it is DB-connecting. It is updated but not run locally, and is verified in CI together with `rls-isolation`.
- `pnpm --filter ./apps/web exec vitest run`: expected all pass.
- `pnpm --filter ./apps/web typecheck && pnpm lint`: expected clean.
- `rls-isolation` is verified only in CI. The migration is unapplied locally, by rule.

## Suggested Review Order

**The half reaches the outbox**

- Entry point: the record trigger adds `half` only when the row has one; whole days unchanged.
  [`0060_half_day_notifications.sql:33`](../../supabase/migrations/0060_half_day_notifications.sql#L33)

- A new request carries its half to the admins.
  [`0060_half_day_notifications.sql:94`](../../supabase/migrations/0060_half_day_notifications.sql#L94)

- The decision copies the requested half into its operands; 0059's body otherwise.
  [`0060_half_day_notifications.sql:139`](../../supabase/migrations/0060_half_day_notifications.sql#L139)

**notify names it**

- Six keys map to a first- and second-half variant; never overlapping the return variants.
  [`messages.ts:253`](../../supabase/functions/notify/messages.ts#L253)

- `compose` refuses a bad half, or any half on a code with no variant, then picks the variant.
  [`messages.ts:471`](../../supabase/functions/notify/messages.ts#L471)

**Deploy, tests**

- 0060 first, then `notify`; an old `notify` ignores the operand and sends whole-day text.
  [`DEPLOY.md:792`](../../DEPLOY.md#L792)

- The variant pins and the matrix renders (CI only: DB-connecting file).
  [`notify-boundary.test.ts:238`](../../test/notify-boundary.test.ts#L238)

- Outbox operands for each half-day event, run in CI.
  [`rls-isolation.test.ts:26147`](../../test/rls-isolation.test.ts#L26147)
