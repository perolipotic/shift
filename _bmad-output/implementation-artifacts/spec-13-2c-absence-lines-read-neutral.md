---
title: 'Story 13.2c: Absence lines read neutral'
type: 'feature'
created: '2026-11-10'
status: 'done'
baseline_commit: '3d5aca36b1e81c90a3944695e444094f1e627dda'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-13-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-13-2b-the-type-is-chosen-when-absence-is-recorded.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Since 13.2b a record can be any absence type, but narrative lines still say *godišnji*: admin *Danas*, the day detail, erasure rows, *Za odluku*, the member page's leave card, the request form, and the leave emails. For sick leave they state something false, and the resolution strip's "1 dan godišnjeg" states an annual-leave charge that never happens.

**Approach:** Copy only, no migration. Every line that narrates a record or request says *odsutnost*, in noun forms, and never names the type. Lines about the allowance, the leave year, the balance and the *Godišnji* destination stay. Baseline: origin/main `3d5aca36` (13.2b #288); `hr.json` is hot, so this follows 13.2b.

## Boundaries & Constraints

**Always:**
- The wording is the Design Notes table, exactly. A key not in the table keeps its value.
- Noun forms only: *odsutnost* and its cases, never *odsutan/odsutna/odsutni* (the app stores no gender; PO 2026-11-09).
- No type name in any narrative line, email or push (Q6, Q7). The type stays as a fact where 13.2b shows it: record rows, the dialog, the decision screen.
- `supabase/functions/notify/messages.ts` is the copy of `obavijesti`; it changes with `hr.json` and stays deep-equal (`test/notify-boundary.test.ts`).
- Every changed line is grepped in `e2e/`, the unit tests and the root tests, and each pin is updated in the same change.
- **Working rules:** this worktree only; never commit, push, amend, force-push or `git stash`; Node via `PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH"`; no migration, no harness patch, no DB-connecting root test locally, read-only `psql` only.

**Ask First:** changing a key's name or its placeholders; making any line depend on the type's drawing flag; touching a kept line.

**Never:** stored override reasons, including "(godišnji)" (Q9); the *Godišnji* nav, page titles, `shell.description.*`; allowance, leave-year and balance lines (`godisnji.allowance`, `costInYear`, `exceeds`, `balanceUnchanged`, `danas.today.leaveCost`, `danas.tiles.leaveKicker`, `zaOdluku.resolution.balanceLabel`, `ljudi.allowance.*`, `organization.*`); the seeded type name *Godišnji odmor*; the *Sati* column names.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Admin *Danas* | a member on sick leave in a shift today | "Ana ima upisanu odsutnost, a u sastavu je smjene · čeka odluku" | N/A |
| Resolution strip | a non-drawing day, cards 1–2 | "1 dan odsutnosti"; balance term unchanged (*bez promjene*) | N/A |
| Member email | a record is changed | subject "Izmijenjena ti je odsutnost, sada 02.03.2046–06.03.2046" | N/A |
| Admin email | a member requests | "Novi zahtjev za odsutnost: Ana Kovač" | N/A |
| Member form | opens the request form | heading "Zatraži odsutnost"; list "Moji zahtjevi za odsutnost" | N/A |
| Stored reason | an old "Zamjena za Ana (godišnji)" | shown as stored | N/A |

## Epic AC Deviations

- AC 3 (another member's absence reads *odsutan*, never the type): met, REINTERPRETED in its word, as in 13.2b. The PO chose the noun *odsutnost* (2026-11-09): the app stores no gender. This story extends the neutral word to admin and self narrative lines (PO Q6, Q7), which the AC does not require.
- AC 5 (DESIGN.md / EXPERIENCE.md / UX-DR lines): the EXPERIENCE.md and UX-DR lines that quote a changed line are updated.
- ACs 1, 2, 4: shipped in 13.2 / 13.2b, unchanged.

</frozen-after-approval>

## Code Map

- `apps/web/src/lib/i18n/locales/hr.json` -- every change (the table below); no key added or removed
- `supabase/functions/notify/messages.ts:18-86` -- the `obavijesti` copy; `test/notify-boundary.test.ts:265-360,443,552,837,1701` pin the rendered texts
- `apps/web/src/features/conflicts/services/resolution-screen.ts:1053` `leaveDaysMessageKey` -- doc comment quotes `1 dan godišnjeg`; `resolution-screen.test.ts:440,671,763` pin it
- Unit tests that pin changed values (grep each old value): `features/today/services/admin-today.test.ts`, `today.test.ts`; `conflicts/services/{conflicts-queue,resolved-conflicts,override-erasures,resolution-screen}.test.ts`; `calendar/services/roster-erasures.test.ts`, `calendar/utils/replacement-candidates.test.ts`; `leave/services/{leave-overview,leave-request-review,leave-section,my-leave}.test.ts`; `members/services/{deactivation-requests,member-erasures}.test.ts`; `rotation/services/{erasures,override-review-erasures}.test.ts`; `test/resource-hygiene.test.ts` (comments quote old lines)
- `test/localization-applied.test.ts:1315` -- the word list keeps `godišnjeg`/`odmora`; kept lines still contain both
- e2e: reads go through `e2e/utils/i18n.ts` keys, so values follow `hr.json`. Literal Croatian found: `absence-types.spec.ts:88` (seeded name), `calendar-roster-erasures.spec.ts:46` (a stored reason), `utils/i18n.ts:21` (the *Sati* column) -- all three stay. Re-grep after the edit for any regex built from an old value.
- Docs: `_bmad-output/planning-artifacts/ux-designs/ux-shift-2026-09-02/EXPERIENCE.md:40,64,114` (quote *Zatraži godišnji*, "Izmijeni godišnji odmor"); `epics.md` UX-DR lines quoting changed copy

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/lib/i18n/locales/hr.json` -- apply the table -- the copy
- [x] `supabase/functions/notify/messages.ts`, `test/notify-boundary.test.ts` -- copy `obavijesti`; update the pinned texts
- [x] unit tests in the Code Map, `resolution-screen.ts` comment -- update every pin of a changed value
- [x] `e2e/` -- grep each old value; update any literal assertion
- [x] EXPERIENCE.md, `epics.md` -- the quoted lines
- [x] `deferred-work.md` -- prefix the 13.2c entry (:1426) and the "1 dan godišnjeg" entry (:1435) `RESOLVED by 13.2c (date) — `; `sprint-status.yaml` -- 13.2b `done  # #288` (done at planning)

**Acceptance Criteria:**
- Given `hr.json` after the change, when every value is scanned for `godišnj`, then only kept lines match: those named in Never, the leave card's `heading*` and `unavailable`, `auth.brand.subline`, `ljudi.lede`/`leave`, `godisnji.unavailable`/`unscheduled`/`overview.caption`/`request.back`, and the two values the table itself sets with *Godišnji*: `danas.admin.absent.link` and `godisnji.overview.lede`.
- Given any changed line, when it is read, then it contains no *odsutan/odsutna/odsutni/odsutne*; the one adjective left in `hr.json` is the shipped label `zaOdluku.resolution.absentLabel` *Odsutni član*, which agrees with *član*.

## Design Notes

New values (`#` and placeholders as today; `S/F` = subject/body):

| Key | New value |
|---|---|
| `danas.admin.status.leave` | Danas imaš upisanu odsutnost (no full stop, like its subtitle siblings; review 2026-11-10) |
| `danas.admin.needsYou.calm` | Svaka upisana odsutnost usklađena je s rasporedom. |
| `danas.admin.coverage.absentUnresolved` / `Accepted` / `Resolved` | {name} ima upisanu odsutnost, a u sastavu je smjene · čeka odluku / … · prihvaćeno bez zamjene / … · odlučeno (the last two without "a u sastavu…") |
| `danas.admin.absent.line*` | `godišnji` → `odsutnost` (4 keys) |
| `danas.admin.absent.heading` | Odsutnost danas (was *Odsutni danas*) |
| `danas.admin.absent.none` / `link` | Danas nitko nema upisanu odsutnost. / Otvori Godišnji |
| `kalendar.detail.conflict.line` / `lineUndated` | {name}: odsutnost {from}–{to}, a u sastavu je ove smjene. / {name}: odsutnost, a … |
| every erasure row (9: `kalendar.detail.*`, `ljudi.erasures.rowWithout`, `rotation.builder.*`) | `{member} na godišnjem ·` → `{member} (odsutnost) ·` |
| `godisnji.overview.lede` | Godišnji odmori svih osoba aktivnih danas. Odsutnosti se upisuju na stranici osobe. |
| `godisnji.overview.summary` | records: one {upisana # odsutnost} few {upisane # odsutnosti} other {upisano # odsutnosti} |
| `godisnji.overview.state.*` / `stateValue.*` | Odsutnost danas · S upisanom odsutnošću · Bez upisane odsutnosti (lower-case for `stateValue`) |
| `godisnji.request.action` / `heading` | Zatraži odsutnost |
| `godisnji.request.listHeading` / `empty` / `listUnavailable` / `denied` / `tooLong` | `zahtjev(i/a) za godišnji` → `… za odsutnost` |
| `godisnji.request.sent` / `withdrawn` | Zahtjev za odsutnost {from}–{to} je poslan i čeka odluku. / … je povučen. |
| `godisnji.request.overlapNote` / `overlapsLeave` | … s tvojom upisanom odsutnošću. |
| `godisnji.request.inPast` / `inPastReason` | (Zahtjev nije poslan: o / O)dsutnost možeš zatražiti od danas nadalje. Prošlu odsutnost upisuje administrator. |
| `godisnji.request.recordAmended` / `recordRemoved` | Odsutnost je naknadno izmijenjena. / … uklonjena. |
| `zaOdluku.kind.request`, `request.heading` | Zahtjev za odsutnost |
| `zaOdluku.resolved.amend_leave`, `resolution.amendTitle` | Izmijenjena odsutnost / Izmijeni odsutnost |
| `zaOdluku.detail` / `detailTimed`, `request.range` | `Godišnji odmor {from}–{to}` → `Odsutnost {from}–{to}` |
| `zaOdluku.request.absent`, `ljudi.leaveRecord.unscheduled` | `trošak godišnjeg odmora` → `trošak odsutnosti` |
| `zaOdluku.request.approvalStale` | U međuvremenu je upisana odsutnost koja se preklapa s ovim zahtjevom. … |
| `zaOdluku.swap.onLeave` | {name} ima upisanu odsutnost {day}, a zamjena tu osobu stavlja na smjenu. |
| `zaOdluku.resolution.leave` | odsutnost {from}–{to} · {days…} |
| `resolution.acceptBody` / `replaceBody` | {team} taj dan radi bez osobe s upisanom odsutnošću. Nitko je ne zamjenjuje. / Netko drugi odrađuje smjenu, a odsutnost ostaje upisana. |
| `resolution.amendBody*` / `amendDrops` / `hint*` | `godišnji` → `odsutnost`, `godišnjeg` → `odsutnosti`, "ovaj godišnji se briše" → "ova odsutnost se briše" |
| `resolution.candidates.onLeave` / `daysAsLeave` | odsutnost taj dan / # dan(a) odsutnosti |
| `resolution.missing`, `error.gone` | … ili odsutnost više ne pokriva taj datum. |
| `ljudi.status.deactivateRequests` | `zahtjev(a) za godišnji` → `za odsutnost` |
| `ljudi.leaveRecord.*` except `heading*`, `unavailable`, `balanceUnchanged` | `godišnji odmor` → `odsutnost`, feminine agreement: Upiši odsutnost · Spremi odsutnost · Odsutnost je spremljena. Trošak: # dan. · Upisane odsutnosti · Za osobu nije upisana nijedna odsutnost. · Ukloniti odsutnost {from}–{to}? Njezin trošak je {cost}. · Taj zapis odsutnosti više ne postoji … |
| `obavijesti.leaveRequestApproved/Rejected` S/F | Zahtjev za odsutnost {s}–{e} je odobren / {org}: tvoj zahtjev za odsutnost {s}–{e} je odobren. … |
| `obavijesti.leaveRecorded` S/F | Upisana ti je odsutnost {s}–{e} / {org}: upisana ti je odsutnost {s}–{e}. Pogledaj je u aplikaciji: {link} |
| `obavijesti.leaveRecordChanged` S/F | Izmijenjena ti je odsutnost, sada {s}–{e} / {org}: tvoja odsutnost izmijenjena je na {s}–{e}. Pogledaj je … |
| `obavijesti.leaveRecordRemoved` S/F | Uklonjena ti je odsutnost {s}–{e} / {org}: uklonjena ti je odsutnost {s}–{e}. … |
| `obavijesti.leaveRequestCreated` S/F | Novi zahtjev za odsutnost: {memberName} / {org}: {memberName} traži odsutnost {s}–{e}. … |
| `postavkeObavijesti.ledeMember` / `ledeAdmin` | … zahtjevima za odsutnost, odsutnost koja ti je upisana, izmijenjena ili uklonjena, … / … svaki novi zahtjev za odsutnost koji čeka odluku, odsutnost koja ti je upisana, … |

The member-page leave card's heading (`ljudi.leaveRecord.heading*`, "Godišnji odmor 2026.") and its `unavailable` line stay: the card heads the allowance, used and balance figures of a leave year. `daysAsLeave` is neutral rather than flag-driven: a non-drawing day is still a day of absence, and the balance term beside it already says whether it draws.

## Verification

**Commands:**
- `PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH" pnpm lint && … pnpm typecheck` -- pass
- `… pnpm --filter ./apps/web exec vitest run` -- pass
- `… pnpm --filter ./packages/domain exec vitest run` -- pass
- `SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:1/postgres … pnpm exec vitest run test/notify-boundary.test.ts test/resource-hygiene.test.ts test/localization-applied.test.ts test/supabase-scaffold.test.ts` -- pass (no DB)
- `jq -r '..|strings' apps/web/src/lib/i18n/locales/hr.json | grep -i 'godišnj'` -- only kept lines; `grep -n -i 'odsutan\|odsutna\|odsutni\|odsutne' apps/web/src/lib/i18n/locales/hr.json` -- only `absentLabel`
- e2e runs in CI.

## Suggested Review Order

**The copy itself (`hr.json`)**

- Entry point: admin *Danas* narrates any absence with one noun phrase, no type.
  [`hr.json:151`](../../apps/web/src/lib/i18n/locales/hr.json#L151)

- The strip's day reads as absence for every type; the balance term says whether it draws.
  [`hr.json:759`](../../apps/web/src/lib/i18n/locales/hr.json#L759)

- Resolution card bodies: noun constructions instead of *osoba na godišnjem*.
  [`hr.json:737`](../../apps/web/src/lib/i18n/locales/hr.json#L737)

- Admin's own subtitle status, without a full stop like its siblings.
  [`hr.json:120`](../../apps/web/src/lib/i18n/locales/hr.json#L120)

- Overview summary: feminine plural forms of *odsutnost*.
  [`hr.json:544`](../../apps/web/src/lib/i18n/locales/hr.json#L544)

- The member's request list and form headings.
  [`hr.json:596`](../../apps/web/src/lib/i18n/locales/hr.json#L596)

- Member page records heading; the card's own heading stays (PO Q1).
  [`hr.json:1077`](../../apps/web/src/lib/i18n/locales/hr.json#L1077)

- Erasure rows: `{member} (odsutnost) ·`, mirroring the replacement reason.
  [`hr.json:1550`](../../apps/web/src/lib/i18n/locales/hr.json#L1550)

**Notifications**

- Email and push texts, neutral and feminine agreement (*Pogledaj je*).
  [`hr.json:1828`](../../apps/web/src/lib/i18n/locales/hr.json#L1828)

- The function's copy, kept deep-equal to `obavijesti`.
  [`messages.ts:31`](../../supabase/functions/notify/messages.ts#L31)

**Peripherals**

- Rendered notification pins.
  [`notify-boundary.test.ts:345`](../../test/notify-boundary.test.ts#L345)

- Strip pin now reads "1 dan odsutnosti".
  [`resolution-screen.test.ts:433`](../../apps/web/src/features/conflicts/services/resolution-screen.test.ts#L433)

- Plural pin for the overview summary.
  [`leave-overview.test.ts:496`](../../apps/web/src/features/leave/services/leave-overview.test.ts#L496)

- DESIGN.md and EXPERIENCE.md quotes of the changed lines.
  [`DESIGN.md:366`](../planning-artifacts/ux-designs/ux-shift-2026-09-02/DESIGN.md#L366)
  [`EXPERIENCE.md:40`](../planning-artifacts/ux-designs/ux-shift-2026-09-02/EXPERIENCE.md#L40)
