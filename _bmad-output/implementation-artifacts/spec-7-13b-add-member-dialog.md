---
title: 'Dodaj osobu opens a dialog on Ljudi that ends with the password shown once (7.13b)'
type: 'feature'
created: '2026-10-08'
status: 'done'
baseline_commit: 'cdec898b5fb4108d11c618388fba5148c2fcc6f7'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-7-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Adding a person leaves Ljudi for the `/ljudi/novi` page, with two form sections and a side card. When the account is created, the page offers no next step except a link back to the list.

**Approach:** Follow `mockups/people-1.html` §2. *Dodaj osobu* opens a short dialog on Ljudi, and `?dodaj=1` on `/ljudi` is the open state. Step 1 asks for name, username (suggested from the name), e-mail, level, rank (only where the organization uses ranks) and leave days. Step 2 happens in the same dialog: `Račun je izrađen: {name} · {username}`, the password once in `CredentialLine` with `Kopiraj`, the once-only line, and then *Dodaj još jednu* and *Otvori stranicu osobe*. `/ljudi/novi` keeps its role guard and becomes a redirect to `/ljudi?dodaj=1`.

## Boundaries & Constraints

**Always:**
- **Decisions of 2026-10-08:**
  - no team field at creation; the team is set on the member page;
  - the e-mail field stays and is optional.
- **The open state lives in the URL.** `/ljudi?dodaj=1` opens the dialog. Opening pushes a history entry, so Back closes the dialog. Closing replaces the entry.
  - Ljudi's `validateSearch` keeps `dodaj` beside the filter search, and an unknown `dodaj` value is dropped.
  - Every filter write keeps the current `dodaj`. This includes the stale-team replace, which would otherwise close the dialog.
- **The suggested username comes from one pure rule in `services/write.ts`, tested in node.** The rule takes the trimmed name and:
  - lowercases it;
  - strips diacritics (`č ć š ž` → `c c s z`, `đ` → `d`);
  - joins the words with `.`;
  - drops any character the `0007` check refuses.

  `Petra Jurić` gives `petra.juric`. The username field follows the name until the admin edits it, and from then on it is the admin's.
- **The credential stays in component state only**, as in 1.5b. It is never in the URL, the query cache, storage or a log.
  - Reloading `?dodaj=1` shows an empty step 1.
  - Closing the dialog drops the credential.
- **`createMember` returns `memberId` with the credential.** If `memberId` is blank, the credential is still shown, but *Otvori stranicu osobe* is left out.
- **Dialog behaviour follows the 7.11 pattern.**
  - It cannot be dismissed while the create is in flight.
  - On a refusal, the entered values stay and `Notice role="alert"` shows inside the dialog. A leave value that is not a whole number marks its field.
  - On close, focus returns to *Dodaj osobu*. After a deep link it goes to the page heading.
- **What each step-2 action does:**
  - *Dodaj još jednu* returns to an empty step 1 with focus in the name field.
  - *Otvori stranicu osobe* is a link to `/ljudi/$memberId`.
  - After a create, the list is invalidated, not patched.
- **Copy and docs:**
  - All copy goes in `hr.json`. Data names stand in apposition and are never declined.
  - Delete the keys that are no longer used.
  - Docs go in the same PR: EXPERIENCE.md §IA and §Component Patterns (the Ljudi bullet and the one-time credential at L202), and DESIGN.md §Components where the dialog is listed.

**Ask First:**
- a migration;
- any Edge Function or RPC change (none is needed, because the function already returns `memberId`);
- any change to `packages/domain`;
- a new dependency.

**Never:**
- a team selector in the dialog;
- deactivation numbers, or deactivation offered from Ljudi (7.13c);
- the password outside component state;
- a toast;
- a second create path;
- removing the `/ljudi/novi` guard.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Open | admin clicks *Dodaj osobu* on `/ljudi?status=svi` | URL `/ljudi?status=svi&dodaj=1`, focus in name | N/A |
| Suggest | types `Petra Jurić` | username `petra.juric`; after the admin edits it, further name edits leave it | N/A |
| Created | valid submit | step 2 with username, password, `Kopiraj`; list refetched | N/A |
| Another | *Dodaj još jednu* | empty step 1, credential gone, focus in name | N/A |
| Open page | *Otvori stranicu osobe* | `/ljudi/{memberId}` | button absent when `memberId` blank |
| Refused | username taken | dialog stays, values kept, `usernameTaken` alert | N/A |
| Back / Escape | dialog open, idle | closed, `dodaj` gone, focus to *Dodaj osobu* | blocked while pending |
| Legacy link | admin opens `/ljudi/novi` | redirected (replace) to `/ljudi?dodaj=1` | a member still goes to the first destination |
| Bad param | `/ljudi?dodaj=x` | no dialog, `dodaj` dropped | no throw |

## Epic AC Deviations

- AC1 shipped in 7.13a.
- AC2 is delivered by this spec. One human decision changes the deferred entry: `/ljudi/novi` becomes a guarded redirect instead of being removed, so an old link still opens the dialog. The AC names the trigger `Novi član`. Its label stays *Dodaj osobu*, as in `mockups/people-1.html` §2 and the shipped copy since 1.5b (human decision 2026-10-09).
- AC3 (deactivation numbers) remains **DEFERRED** to 7.13c and is already in `deferred-work.md`.
- AC4 is narrowed to the docs this part changes.

</frozen-after-approval>

## Code Map

- `apps/web/src/pages/ljudi.novi.tsx` -- `LjudiNoviScreen` is deleted. `ljudiNoviRoute` keeps the verbatim guard and, after it passes, `throw redirect({to:'/ljudi', search:{dodaj:1}, replace:true})`. It has no component.
- `apps/web/src/pages/ljudi.tsx` -- the *Dodaj osobu* `Link` (:90) becomes a button that opens the dialog (pushes `dodaj`). `validateSearch` (:114) adds `dodaj`. `write` (:55) carries `dodaj` through. The dialog is mounted here.
- `apps/web/src/features/members/services/list.ts` -- `membersSearchOf` :1837 drops unknown keys by design (pinned by `list.test.ts:2570-2629`). Keep it. Parse `dodaj` beside it in a small pure helper in the same module and export it from there.
- `apps/web/src/features/members/services/write.ts` -- `createMember` :642, success branch :678-695: add `memberId` (blank allowed, mapped to `null`). Add `suggestedUsername(name)`. `normalizedUsername` (`supabase/functions/admin-auth/operations.ts:221`) is the server's rule; read it, do not change it.
- `apps/web/src/features/members/hooks/use-member-create.ts` -- keeps submit/credential. Add open/close (focus via `utils/focus-later.ts:40`, as in `use-member-edit.ts:510-536`), username-follows-name state, and `again()`.
- `apps/web/src/features/members/components/member-create-card.tsx` -- becomes `member-add-dialog.tsx`, which uses `components/ui/dialog.tsx` (native `<dialog>`, `dismissible`, hidden-not-unmounted :19-21) and `team-add-dialog.tsx` as the drawing model. `renderForm`/`renderCredential` shapes stay (`prijava.test.ts:8806-8825` reads them). Delete `member-create-about.tsx`.
- `apps/web/src/lib/i18n/locales/hr.json` -- `ljudi.form` :643. Drop `newAboutTitle`, `newAboutBody`, `sectionBasics`, `sectionSettings` and `back`. Add `again`, `openPage`, `usernameHint`, `createdFor`, `noTeam`. The unused-key sweep is `prijava.test.ts:6612-6660`.
- `apps/web/src/router.ts` :9, :51-67 -- registration and comments. `router.test.ts`: :29 import; :219-260 `LEVEL_GUARDED_ROUTES` (the novi entry stays guarded but has no component); :1810 count; :1966-1977 resolve-by-component row (novi asserts the redirect instead); :333-345, :601, :1952-1958 comments.
- `apps/web/src/pages/prijava.test.ts` -- `MEMBER_CREATE` :206-224 (swap the page/about files for the dialog); `SCREENS` :766; :3497-3525 ownership sweep (the new util/hook goes in a set); the key count at :3060; pattern sweeps at :8582-9315.
- e2e `e2e/pages/people.page.ts`:
  - `addLink` :45 becomes a button;
  - `gotoNew` :163 goes to `/ljudi?dodaj=1`;
  - locators :166-200 are scoped to the dialog;
  - `backLink` becomes a close action;
  - `createMember` :317.

  Callers: people.spec (13), first-sign-in (3), teams (2), team-position (1), fire-ranks :67-71. people.spec :22-38 is rewritten (URL `dodaj=1`, step 2, both actions). responsive.spec :78-82 uses the `?dodaj=1` path. authorization.spec :18 is unchanged.
- Docs: EXPERIENCE.md :66 (IA), :97-99 (Ljudi bullet), :202 (one-time credential). DESIGN.md §Components dialog list.

## Tasks & Acceptance

**Execution:**
- [x] `services/write.ts` + `write.test.ts` -- `memberId` in the outcome (blank → `null`); `suggestedUsername` covering diacritics, `đ`, extra spaces, `@`, empty input, and agreement with the server rule -- rules executed by node
- [x] `services/list.ts` + `list.test.ts` -- `dodaj` parse helper; the filter search unchanged -- URL rule
- [x] `hooks/use-member-create.ts`, `components/member-add-dialog.tsx`; delete `member-create-card.tsx`, `member-create-about.tsx` -- the two-step dialog -- surface
- [x] `pages/ljudi.tsx`, `pages/ljudi.novi.tsx`, `router.ts` -- open/close through the URL; `dodaj` kept through filter writes; redirect route -- wiring
- [x] `hr.json`, `router.test.ts`, `prijava.test.ts` -- keys and sweeps -- i18n and route pins
- [x] e2e page object and specs -- the dialog flow, the legacy redirect and 390 px -- churn
- [x] EXPERIENCE.md, DESIGN.md; `deferred-work.md` (close the 7.13b entry and the 7.8 inline-display entry); `epic-7-context.md` (route kept as a redirect); sprint-status (7.13 stays `in-progress` for 7.13c; 7.14, 7.16 and 7.18 → `done`) -- docs

**Acceptance Criteria:**
- Given an admin on Ljudi, when *Dodaj osobu* is chosen, then the dialog opens without leaving the list and no `/ljudi/novi` screen remains.
- Given 390 px, when the dialog is open on either step, then there is no horizontal scroll and every control is at least 44 px.
- Lint (including feature boundaries), typecheck, and unit and e2e tests pass at 1280 and 390.

## Design Notes

Mockup §2 differs in two places, and both come from human decisions:
- it has an optional team field, which is dropped;
- it has no e-mail field, which is kept.

The mockup's step-2 lines decline the name ("predaj je Petri"). The copy keeps the shipped `credentialOnce` and adds a neutral `noTeam` line: "Osoba je bez smjene. Smjenu joj dodjeljuješ na njezinoj stranici."

## Verification

**Commands:**
- `pnpm lint && pnpm typecheck` -- expected: clean
- `pnpm --filter ./apps/web test` -- expected: all green
- `pnpm e2e` (people, first-sign-in, teams, team-position, fire-ranks, responsive, authorization) -- expected: green at 1280 and 390

## Suggested Review Order

**The open state in the URL**

- Entry point: every filter write carries `dodaj`, so a stale-team replace cannot close the dialog.
  [`ljudi.tsx:67`](../../apps/web/src/pages/ljudi.tsx#L67)

- Opening pushes, closing replaces; the restore after Back passes `replace`.
  [`ljudi.tsx:77`](../../apps/web/src/pages/ljudi.tsx#L77)

- `validateSearch` keeps the filter search and adds `dodaj` beside it.
  [`ljudi.tsx:139`](../../apps/web/src/pages/ljudi.tsx#L139)

- Only `1` / `'1'` opens; anything else is dropped.
  [`list.ts:1861`](../../apps/web/src/features/members/services/list.ts#L1861)

- The legacy route: the same guard, then a redirect to the dialog.
  [`ljudi.novi.tsx:52`](../../apps/web/src/pages/ljudi.novi.tsx#L52)

**The dialog's state**

- One hook owns open/close, focus, the credential and the username suggestion.
  [`use-member-create.ts:69`](../../apps/web/src/features/members/hooks/use-member-create.ts#L69)

- Back during a create: restore only while mounted, and by replace.
  [`use-member-create.ts:286`](../../apps/web/src/features/members/hooks/use-member-create.ts#L286)

- Step 2 takes focus on the created line, falling back to the title.
  [`use-member-create.ts:254`](../../apps/web/src/features/members/hooks/use-member-create.ts#L254)

- `clear()` drops the credential and restarts the suggestion on every close or *Dodaj još jednu*.
  [`use-member-create.ts:294`](../../apps/web/src/features/members/hooks/use-member-create.ts#L294)

**Rules**

- The username suggestion: diacritics stripped, only `[a-z0-9._-]`, dots tidied.
  [`write.ts:376`](../../apps/web/src/features/members/services/write.ts#L376)

- `memberId` from the reply, trimmed; blank becomes `null`, and the password is still shown.
  [`write.ts:735`](../../apps/web/src/features/members/services/write.ts#L735)

**Surface**

- The two-step dialog; not dismissible while pending.
  [`member-add-dialog.tsx:65`](../../apps/web/src/features/members/components/member-add-dialog.tsx#L65)

- Step 2: created line, password once, both next actions; the page link replaces history.
  [`member-add-dialog.tsx:96`](../../apps/web/src/features/members/components/member-add-dialog.tsx#L96)

**Peripherals**

- e2e: the create flow, suggestion rules, focus and *Dodaj još jednu*.
  [`people.spec.ts:22`](../../e2e/tests/people/people.spec.ts#L22)

- e2e: in-flight create blocks Escape, close and Back.
  [`people.spec.ts:163`](../../e2e/tests/people/people.spec.ts#L163)

- Unit: suggestion cases and agreement with the server rule.
  [`write.test.ts:2596`](../../apps/web/src/features/members/services/write.test.ts#L2596)

- Router: the legacy route stays guarded and redirects an admin.
  [`router.test.ts:1862`](../../apps/web/src/router.test.ts#L1862)

- EXPERIENCE.md: the *Add a member* bullet.
  [`EXPERIENCE.md:98`](../planning-artifacts/ux-designs/ux-shift-2026-09-02/EXPERIENCE.md#L98)
