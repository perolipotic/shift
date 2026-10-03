---
title: 'Amending or removing leave never silently leaves a replacement behind (5.4e)'
type: 'feature'
created: '2026-10-03'
status: 'done'
baseline_commit: '1e3c314b6257c9fbff3b2f1dce4f82616b816eaf'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** An amend or a removal of a leave record soft-removes every resolution on a date it uncovers (0031). A `replace_member` resolution goes too, but its linked roster override stays (0032). The replacement is still rostered next to the member, who now works that day, and nothing says so.

**Approach:** On the admin's Godišnji card, before the amend or the removal is saved, list every replacement that would stay behind. Use one line per replacement, as a note that never blocks. Repeat the same lines in the notice after the write lands. No migration.

## Boundaries & Constraints

**Always:**
- **Non-blocking (human, 2026-10-03).** The lines inform and never disable, gate or ask for a confirmation. They are notes, not `destructive`.
- **Scope (human, 2026-10-03).**
  - Only dates the change uncovers. A removal uncovers every date of the record. An amend uncovers the dates in the old range but not in the new one, as 0031 computes them.
  - Only the page member's live `replace_member` resolutions, across all teams.
- **Surfaces (human, 2026-10-03).** Only the admin's Godišnji card: the amend preview and the removal confirmation, plus their success notices. The member's own leave view is untouched.
- **Finding the replacement.**
  - Join `conflict_resolutions.roster_override_id` to the calendar snapshot's live `rosterOverrides[].id`. Never match on (team, date).
  - Warn only while the override is actually applied on that date (`rosterOn(...).applied`). An override that was removed or is inert gives no line.
  - Lines are ordered by date, then by team name.
- **Line text.** "{name} ostaje na smjeni {team} · {date} kao zamjena. Ukloni zamjenu u kalendaru ako više ne treba." `{date}` uses `dayMonthOf`.
- **Unknown state.** If the resolutions read is pending or failed while the amend range or the removal is being shown, show "Ne mogu provjeriti zamjene za ove datume." instead of nothing. It still never blocks.
- **Freshness.**
  - Opening an amend (by button or by 5.4d's hand-off) or a removal confirmation re-reads the organization's resolutions.
  - The success notice uses the lines captured just before the write, because the write removes those resolutions.
- Every string goes through `t()`. In the same PR, update the UX docs and the epic-5 constraint line.

**Ask First:**
- Any migration, or any change to 0029, 0031 or 0032.
- Offering to remove the override as part of the leave write.

**Never:**
- No blocking, no checkbox, no change to what the leave writes do.
- No change to the shape of `ConflictResolution` that the member path, the queue or *Sati* consume.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Amend uncovers | Mirela 02.–09.10., Dino replaces 02.10. Smjena C; amend to 03.–09.10. | preview: "Dino Grgić ostaje na smjeni Smjena C · 02.10. kao zamjena. …"; after save, the notice repeats it | N/A |
| Amend keeps | same; amend to 02.–08.10. | no line | N/A |
| Removal | remove the record | confirmation lists every replacement in the range | N/A |
| Several | two replacements on two dates | two lines, by date | N/A |
| Override removed | resolution live, override soft-removed | no line | N/A |
| Inert override | replacement deactivated | no line | N/A |
| Accept only | `accept_uncovered` on the date | no line | N/A |
| Read failed | resolutions read error | the "Ne mogu provjeriti" line; save still allowed | N/A |

## Epic AC Deviations

None.

</frozen-after-approval>

## Code Map

Paths are under `apps/web/src` unless they say otherwise.

- **The link column.** `supabase/migrations/0031_conflict_resolutions.sql:145-190` lets an admin select every column. The link is `0032_replace_conflict_member.sql:80`. The leave writes and the dates they uncover are at `0031:303-411`.
- **The resolutions read.** `features/conflicts/services/resolutions.ts`: `CONFLICT_RESOLUTIONS_COLUMNS` :45 (pinned at `resolutions.test.ts:122`), the query options :198, and `conflictResolutionsOf` :243 (shared; leave it unchanged).
  - Add `roster_override_id` to the columns.
  - Add a separate pure `replacementLinksOf(rows)` for `replace_member` rows only.
- **The snapshot.** `features/calendar/services/snapshot.ts` has `rosterOverrides` :314 (live only, with `id`, `teamId`, `date` and `memberInId`), plus `members` and `teams`. Use `rosterOn` (`packages/domain/src/roster.ts:294`) to tell whether an override is applied. `dayMonthOf` is at `features/calendar/utils/month.ts:936`.
- **The hook.** `features/leave/hooks/use-member-leave.ts`:
  - reads :158-176 (it already has the calendar snapshot; add `organizationConflictResolutionsQueryOptions` as in `use-conflict-resolution.ts:171`);
  - `retry` :347, `startAmend` :246, `openRemove` :268 and the hand-off opening;
  - the `sent`/`target` capture at :467 and :537.
  - `LEAVE_WRITE_DEPENDENTS` (`features/teams/services/dependents.ts:98`) already invalidates the resolutions.
- **The pure rule.** Add it to `features/leave/services/leave-section.ts`, next to `leavePreviewStateOf` :325: the uncovered dates, plus the warning lines from the links, the snapshot and the member. `LeaveSaved` is at :393.
- **The UI.**
  - `components/member-leave-card.tsx`: `renderPreview` :132 (after the notes at :161-166) and the amended notice at :184.
  - `components/member-leave-records.tsx`: the confirmation at :148 (after the prompt at :157) and the removed notice at :121.
- **Registries.**
  - `lib/i18n/locales/hr.json` `ljudi.leaveRecord` :386;
  - `test/resource-hygiene.test.ts`, block :1140;
  - `pages/prijava.test.ts`: member-edit strings :2496, and `KEY_SOURCES` :2764 if a new key source is added;
  - `features/leave/leave-screen.fixture.ts` :23.
- **e2e.**
  - `e2e/tests/people/leave.spec.ts`: amend :276 and removal :345.
  - `e2e/utils/database-helper.ts`: `seedConflictResolution(…, 'replace_member', replacementId)` :368 (the override and the resolution), `removeRosterOverridesInSql` :1027, and `seedLeaveRecord` :322.
  - `e2e/pages/people.page.ts` :150-290.
- **Docs.**
  - `ux-shift-2026-09-02/EXPERIENCE.md`: a bullet after :96-97, and the non-blocking warnings at :115.
  - `epic-5-context.md:25`.

## Tasks & Acceptance

**Execution:**
- [x] `features/conflicts/services/resolutions.ts` and its test -- the column and `replacementLinksOf`.
- [x] `features/leave/services/leave-section.ts` and its test -- the uncovered dates and the warning lines. Cover every matrix row except Read failed.
- [x] `features/leave/hooks/use-member-leave.ts` -- the resolutions read, the re-read on open, the unknown state, and the lines captured before the write.
- [x] `features/leave/components/` -- the lines in the preview, the confirmation and both notices.
- [x] `hr.json` and the registries.
- [x] `e2e/` -- seed a `replace_member` with its override. Cover: amend uncovers (the preview line and the notice line), removal, amend keeps (no line), and override removed (no line).
- [x] Docs -- the UX bullet. In `deferred-work.md`, mark the 5.4e entry and the 5.2a "never silently reverts" entry resolved. `sprint-status.yaml`: 5-4e.

**Acceptance Criteria:**
- Given a warning line, when a screen reader is in the amend form, then the line is inside the preview's polite live region.
- Given 390 px, when two lines show, then they wrap and there is no horizontal scroll.

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint` -- expected: exit 0
- `pnpm build && pnpm test` -- expected: all green (shared stack, no `db:reset`)
- `pnpm exec playwright test people conflicts` -- expected: green

## Suggested Review Order

**Finding the replacement**

- Entry point: join on the override id, warn only while the override is applied.
  [`leave-section.ts:463`](../../apps/web/src/features/leave/services/leave-section.ts#L463)

- Uncovered dates, as 0031 computes them.
  [`leave-section.ts:431`](../../apps/web/src/features/leave/services/leave-section.ts#L431)

- Known lines or unknown: pending, failed or untrusted reads never fall silent.
  [`leave-section.ts:563`](../../apps/web/src/features/leave/services/leave-section.ts#L563)

- The link column, parsed per member so another member's bad row is ignored.
  [`resolutions.ts:355`](../../apps/web/src/features/conflicts/services/resolutions.ts#L355)
  [`resolutions.ts:48`](../../apps/web/src/features/conflicts/services/resolutions.ts#L48)

**Freshness and capture**

- Opening an amend or removal re-reads the resolutions and the calendar.
  [`use-member-leave.ts:361`](../../apps/web/src/features/leave/hooks/use-member-leave.ts#L361)

- At submit, a read still in flight gives unknown; the notice keeps what was captured.
  [`use-member-leave.ts:275`](../../apps/web/src/features/leave/hooks/use-member-leave.ts#L275)
  [`use-member-leave.ts:254`](../../apps/web/src/features/leave/hooks/use-member-leave.ts#L254)

**The lines on screen**

- One renderer for the preview, the confirmation and both notices.
  [`member-leave-records.tsx:34`](../../apps/web/src/features/leave/components/member-leave-records.tsx#L34)

- Inside the amend preview's polite live region.
  [`member-leave-card.tsx:176`](../../apps/web/src/features/leave/components/member-leave-card.tsx#L176)

- The confirmation describes itself by the lines while any show.
  [`member-leave-records.tsx:219`](../../apps/web/src/features/leave/components/member-leave-records.tsx#L219)

**Tests**

- Unit: every matrix row, mismatched link, unknown reads.
  [`leave-section.test.ts:831`](../../apps/web/src/features/leave/services/leave-section.test.ts#L831)

- e2e: amend uncovers or keeps, removal at 390 px, failed read, re-read on open.
  [`leave.spec.ts:605`](../../e2e/tests/people/leave.spec.ts#L605)
  [`leave.spec.ts:692`](../../e2e/tests/people/leave.spec.ts#L692)
  [`leave.spec.ts:724`](../../e2e/tests/people/leave.spec.ts#L724)
