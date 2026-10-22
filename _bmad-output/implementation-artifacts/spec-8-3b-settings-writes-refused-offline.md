---
title: '8.3b Settings writes are refused offline'
type: 'feature'
created: '2026-10-22'
status: 'done'
baseline_commit: 'a44d84694cb6e013984432843166e5343415e654'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-8-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-8-3a-offline-writes-refused-and-sign-out-clears.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Offline, the settings surfaces' write controls still try to write and fail through a generic write error. On the rotation's erasure-checked flows they first show *Ne mogu provjeriti…* with a retry that cannot succeed. These surfaces are Organizacija, Satni pojasi, Postavke rotacije (shift types, rotation builder, override review) and Ljudi/smjene.

**Approach:** Apply 8.3a's gate unchanged to every remaining write control. The parts are `useWriteGate`, `OfflineWriteNote` (*Za ovo je potrebna veza.*), `aria-disabled` plus `aria-describedby`, a handler guard, a write-function guard, `ErasureDialog`'s `gate`, and the dropped-connection mapping of `CHECK_UNAVAILABLE`. After this change every write control in the app is gated, and story 8.3's AC1 is met in full.

## Boundaries & Constraints

**Always:**
- 8.3a's rules hold:
  - one online source (`writesOnline()`);
  - `aria-disabled`, never `disabled`, for the offline gate;
  - the note renders once per form, dialog footer or card action row, only while offline;
  - nothing is queued or sent;
  - dialogs still open offline, and local controls are never gated;
  - the one wiring pattern: `gate.disabled || …`, `gate.describedBy(...)`, `if (!gate.online) return`.
- **Controls in scope:**
  - Organizacija: the name, leave-year, logo upload, accent and fire-ranks dialog submits.
  - Satni pojasi: add, edit, and the remove confirm.
  - Postavke rotacije:
    - shift types: add, rename, times, cancel scheduled times, and the archive confirm;
    - the rotation builder: *Spremi rotaciju*, and the cancel-scheduled confirm (with their unchecked retries);
    - the override review: *Potvrdi*, the *Promijeni* save, and the *Odbaci* confirm.
  - Ljudi/smjene: add, rename, and the archive confirm.
- **Erasure.** The rotation and override-review `ErasureDialog` callers pass the gate instead of `null`. In those hooks, a `CHECK_UNAVAILABLE` caused by a dropped connection maps to the gate, as in 8.3a.
- **Rotation builder.** 8.2d already makes it non-writable while its cached snapshot shows. Its offline save is now stated through the note, not through the existing `ROTATION_WRITE_UNAVAILABLE` alert.

**Ask First:**
- Any write path outside this list.

**Never:**
- New i18n strings.
- Changing which controls open dialogs.
- Changing the logo *Odaberi sliku* local pick. Only the upload submit is gated.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Offline settings save | Any in-scope dialog open offline, then a press | Nothing is sent. The note is shown and the control is `aria-disabled` | — |
| Offline rotation save | The builder's *Spremi rotaciju* offline | The note shows. No erasure check starts and no request is sent | — |
| Connection drops mid-check | Rotation save or cancel, or the override confirm | Only the note shows: no *Ne mogu provjeriti…* and no retry | — |
| Reconnect | Back online with the dialog open | The gate lifts and nothing is sent by itself | — |

## Epic AC Deviations

None. With 8.3a, this story meets 8.3's AC1 ("any write control … states that it needs a connection") in full.

</frozen-after-approval>

## Code Map

- 8.3a machinery: `lib/offline/use-write-gate.ts` (`writeGateOf`, `useWriteGate`, `writesOnline`; 8.3b adds `droppedOffline`), `components/offline-write-note.tsx` (8.3b adds an optional `className`), `features/conflicts/components/erasure-dialog.tsx` (`gate: WriteGate`, never `null` since 8.3b; 8.3b adds an optional `saveButton` ref). The roster hook's `CHECK_UNAVAILABLE` mapping (`features/calendar/hooks/use-roster-form.ts` ~:440) is the model.
- Organizacija:
  - `features/organization/components/organization-dialog.tsx` `OrganizationDialogForm`: the ONE form all five dialogs submit through, gated once (`aria-disabled` offline and while there is nothing to send; native `disabled` only while the write is out);
  - `organization-logo-dialog.tsx:69` (upload `onSubmit`; the :107 pick stays local);
  - `organization-accent-dialog.tsx:74`;
  - `organization-time-card.tsx:71` (the leave-year dialog);
  - `organization-fire-ranks-card.tsx:98`;
  - hook: `use-organization-settings.ts` (`updateOrganization`, `replaceOrganizationLogo`).
- Satni pojasi: `features/hour-bands/components/hour-band-add-dialog.tsx:143`, `hour-band-edit-body.tsx:131`, `hour-band-remove.tsx:88`. Hooks: `use-hour-band-list` / `-edit`.
- Shift types: `features/shift-types/components/shift-type-add-dialog.tsx:164`, `shift-type-edit-body.tsx:78`, `shift-type-times.tsx:112,153`, `shift-type-archive.tsx:101`.
- Rotation:
  - builder: `features/rotation/components/rotation-section.tsx` (the save's one gate, shared by the save bar and the unchecked save's retry), `rotation-save-bar.tsx` (Spremi; Odbaci promjene stays local), `rotation-notices.tsx` (cancel-scheduled confirm and unchecked retries; the two `ErasureDialog` callers, each passing its gate), `use-rotation-builder.ts`, `use-erasure-check.ts`;
  - override review: `override-review.tsx` (its `ErasureDialog` caller passes its gate), `use-override-review.ts`.
- Ljudi/smjene: `features/teams/components/team-add-dialog.tsx:88`, `team-edit-body.tsx:87`, `team-archive.tsx:83`.
- Registration: no new strings and no new component. Re-run `source-guards`, `key-sweep`, and the `structural-pins-*` touching these files (settings: `structural-pins-settings.test.ts`; rotation: `structural-pins-controls.test.ts`).
- e2e: extend `e2e/tests/offline/offline-write.spec.ts` (its spy and `expectGated`/`press` helpers).

## Tasks & Acceptance

**Execution:**
- [x] Organizacija dialogs and hook -- gate them.
- [x] Satni pojasi add, edit and remove -- gate them.
- [x] Shift types: add, rename, times and archive -- gate them.
- [x] Rotation builder save and cancel, and the override review -- gate them, pass the gate to `ErasureDialog`, and map `CHECK_UNAVAILABLE` when offline.
- [x] Ljudi/smjene add, rename and archive -- gate them.
- [x] e2e: as admin, offline:
  - Organizacija name save;
  - the hour band add;
  - the shift type add;
  - *Spremi rotaciju*, with no erasure check;
  - the override review *Potvrdi*, if a pending override can be seeded (otherwise say so);
  - the team rename.

  Each is `aria-disabled`, shows the note and sends nothing. Reconnect sends nothing.
- [x] Docs:
  - UX-DR45, EXPERIENCE.md Offline and CAP-18: every write control is gated (8.3a + 8.3b);
  - `deferred-work.md`: close the 8.3b entry.

**Acceptance Criteria:**
- Given offline, when any write control in the app is shown, then it is `aria-disabled` with *Za ovo je potrebna veza.* and pressing it sends nothing.
- Given `pnpm test`, `lint` and `typecheck`, and the e2e suites for offline, organization, hour-bands, rotation and teams, when they run, then all pass.

## Spec Change Log

- 2026-10-22 (implementation): no frozen intent changed. Choices within it: Organizacija's five dialogs share one form (`OrganizationDialogForm`), gated once. The override review draws ONE note above its list (while any row offers *Potvrdi*), which every row's confirm names, rather than one per row; the amend and discard dialogs and its erasure dialog each have their own. A rotation cancel whose check the connection drops under keeps its confirmation open under the gate, with no unchecked refusal. `ErasureDialog`'s `gate` is now `WriteGate` (no `null`), since every caller passes one. The amend's *Promijeni* (which may read before opening) and the discard's *Odbaci* stay ungated openers.

- 2026-10-22, review loop 1 (no frozen intent changed; all patches applied):
  - **Mid-check drops.** Every `if (!writesOnline())` after `CHECK_UNAVAILABLE` (rotation save, its erasure confirm, the cancel and its erasure confirm; the review's confirm, amend and erasure confirm) returns inside the `try`, so its `finally` releases the latch and `pending`. It now also puts focus back on the control that was pressed (`focusLater`, waiting until the control is enabled): the save, the cancel confirm, the row's *Potvrdi*, the amend's type field, or the erasure dialog's save (`ErasureDialog` gains an optional `saveButton` ref). A rotation cancel keeps its confirmation open. The same focus fix is applied to 8.3a's roster, override, team and status hooks; their state was already released by their `finally`.
  - **Write in flight when the connection drops.** `droppedOffline(code, unavailable)` (`use-write-gate.ts`) is true for the transport-failure code while writes are offline. When it is true, the rotation `write()`, the review's `writeDisposition`, the organization `write()`, and the hour band, shift type and team writes say nothing but the note: no refusal, state released, and the dialog or confirmation stays open with focus on the pressed control. The same holds for a throw caught while offline. A rotation save that fails AFTER its pattern was written is still said, because part of it landed. The rotation cancel's catches follow the same rule.
  - **Organizacija.** Spremi is natively `disabled` only while the write is out (the 8.3a convention). Offline, or with nothing to send (`!canSave`), it is `aria-disabled` and the submit guard returns. The logo upload runs only inside `write()`, behind its `writesOnline()` guard.
  - **Notes.** The shift type edit dialog draws one note at its foot, outside the block the archive confirmation hides, and every gated control there names it. On the rotation page, the save's gate is created in `RotationSection` and shared by the save bar and the unchecked save's retry, so there is one note in the bar. The review's unchecked-confirm retry names the review's list note, so the page has at most one note per card. `OfflineWriteNote` takes an optional `className`, which replaces the save bar's wrapper and the review's `CardContent` grid change, so the online layout is unchanged.
  - **Docs and comments.** The `discard()` doc is fixed. EXPERIENCE.md disambiguates *Odbaci*. The lie-fi race is added to the deferred lie-fi entry. The Code Map is updated. Import order is fixed.
  - **e2e.** `offlineWriteNoteNamedBy` splits `aria-describedby`, picks the note-prefixed id, and escapes it as a CSS string. New tests cover: the save's unavailable alert is absent; rotation save and rotation cancel with the connection dropped mid-check (held API requests, then aborted); the cancel-scheduled confirm; the shift type times save; the team archive confirm; the review's amend save and discard confirm. The note text is asserted, and a Space press is added to the review test.

## Verification

**Commands:**
- `pnpm --filter @shift/web build && pnpm test && pnpm lint && pnpm typecheck` -- expected: green.
- `pnpm test:e2e e2e/tests/offline e2e/tests/organization e2e/tests/hour-bands e2e/tests/rotation e2e/tests/teams` -- expected: green.

## Suggested Review Order

**The settings writes**

- Entry point: the five Organizacija dialogs share one gated form.
  [`organization-dialog.tsx:97`](../../apps/web/src/features/organization/components/organization-dialog.tsx#L97)

- A write whose request fails offline shows the note, not the generic write error.
  [`use-write-gate.ts:75`](../../apps/web/src/lib/offline/use-write-gate.ts#L75)

- Rotation save: gated before any check. A drop mid-check returns focus to *Spremi*.
  [`use-rotation-builder.ts:447`](../../apps/web/src/features/rotation/hooks/use-rotation-builder.ts#L447)

- The shift type dialog has one note, which every gated control in it names.
  [`shift-type-edit-body.tsx:106`](../../apps/web/src/features/shift-types/components/shift-type-edit-body.tsx#L106)

**Tests**

- Offline e2e:
  - Organizacija, hour band, shift type add and times;
  - rotation save and cancel, including drops mid-check;
  - override confirm, amend and discard;
  - team rename and archive.
  [`offline-write.spec.ts:1`](../../e2e/tests/offline/offline-write.spec.ts#L1)
