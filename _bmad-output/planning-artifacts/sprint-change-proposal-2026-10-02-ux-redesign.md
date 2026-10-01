# Sprint Change Proposal: the approved UX redesign becomes backlog work

- **Date:** 2026-10-02
- **Author:** Developer (correct-course), for Perolipotic
- **Mode:** Batch
- **Scope classification:** Moderate (backlog reorganization, plus targeted PRD, architecture and UX-doc edits)
- **Status:** Approved by the human on 2026-10-02

---

## 1. Issue Summary

**Trigger:** a UX review of the shipped app (Epics 1–4 and 5.1–5.3) on 2026-10-01. It produced 69 current-state screenshots (`ux-review-2026-10-01/screenshots/`) and 13 redesign mockups with 27 rule-change decisions (`ux-designs/ux-shift-2026-10-01-redesign/`). The human approved all 27 on 2026-10-02.

**Problem:** the app works, but it does not feel calm or modern, and several flows are broken on phones. Evidence from the review:

- **Phone tab bar.** The bar overflows sideways. An admin's bar fits 978 px of content into 282 px, so only Danas, Kalendar and Sati are visible. On *Godišnji* the active tab is off-screen.
- **Dark theme.** *Noć* (`#171F29`) and non-working (`#161D24`) measure 1.02:1, so a night shift reads as a free day.
- **Member page.** It stacks five forms with five Save buttons. Its team change preselects a different team, so a hurried click moves the person.
- **Tables on phones.** Ljudi, Sati and the rotation's shift-type table scroll sideways.
- **Numerals.** Syne heavy numerals are misread ("17" reads as "ı7").
- **Kalendar and Sati.** Their filters and month switcher look thrown together. This is the human's main concern.

**Category:** a new requirement from the stakeholder (product polish and flow), backed by measured defects.

## 2. Impact Analysis

### Epic impact

- **Epic 5** can be completed as planned.
  - **5.4** absorbs decisions 15, 21, 22 and the ‹ › half of 20.
  - **5.5** absorbs 25 and 26. 5.5 needs a confirmation surface anyway, so the old 7.18 merges into it.
- **Epic 6** stays. Its ACs take the Danas mockup: 6.1 takes the stated cases, 6.2 takes decision 3, and 6.3 takes decision 2 and the "Treba tebe" card. It must be built on the new foundations, which are tokens, numerals and phone navigation.
- **New Epic 7, "The app is calm on every screen".** It has 18 stories. Four are foundations (7.1–7.4), which ship before Epic 6.
- No epic is invalidated. No completed story is rolled back. Epic 7 rewrites the surfaces of stories 1.3/1.3b, 1.4, 1.8, 2.4, 3.3–3.6, 4.1b, 4.2 and 5.1/5.2 through new stories. Their original ACs stay in history.

### Artifact conflicts

- **PRD.** It needs these edits:
  - new FRs for 12b (first sign-in sets the password), 17 (explaining an hours figure), 18 (an admin leave overview) and 20 (resolved-conflicts history);
  - a carve-out in §7.2, because 20 is the first audit-like UI;
  - a CAP-5 edit (23, member directory by team);
  - a role qualifier on CAP-13/FR-38 (14, members see no conflict marks);
  - new NFR-15 wording (7, stacked rows on phones).
- **Architecture.**
  - **AD-16:** the admin-auth function gains a `must_set_password` flag in `app_metadata`. It sets the flag on `createUser`/`resetPassword` and gains one operation that clears the flag for the calling user after they set a password (human decision 2026-10-02).
  - **Deferred note:** the "claim-code identity" note, which rejected member-chosen passwords, is partly reversed and must say so.
  - **URL convention:** `?tim=` → `?smjena=` on Sati, with a redirect.
  - **NFR-4 and 1.3b stand.** Single-step sign-in shows the organization only as the slug from the URL or device. There is no anonymous name or logo lookup (human decision 2026-10-02). The mockup's logo row is narrowed to the slug.
- **UX docs.** `DESIGN.md` (colors, typography, components, layout), `EXPERIENCE.md` (IA, responsive, component and state patterns, interaction primitives, key flows) and the UX-DR list in `epics.md` change as the decision map in §4.3 says. These docs are updated **when each story lands**, not up front, so binding docs never describe unbuilt UI.
- **Tests and CI.** No pipeline change. Some stories bring heavy test churn:
  - `theme-fidelity` and `theme-contrast` (7.1);
  - `pages/prijava.test.ts`, the biggest diff (7.7);
  - e2e page objects for login, base, calendar, hours, people, leave, rotation and organization.

### Technical impact

- **New derivations:**
  - an explanation of an hours figure in `domain/hours`, as codes and operands (AD-8);
  - a collision preview for a draft leave in `domain/collisions`, the same function family as 5.5's diff, so they are built together;
  - an org-wide leave and balance read (18);
  - a `conflict_resolutions` list (20).
- **One migration may be needed** (none for the flag, which lives in `app_metadata`). Check the main checkout for untracked migrations before numbering.

## 3. Recommended Approach

**Hybrid, "foundations now, the rest with the plan"** (human decision 2026-10-02):

1. **5.4**, with decisions 15, 21, 22 and ‹ › in its ACs. It is self-contained and closes the conflict loop.
2. **5.5**, with 25 and 26 in its ACs.
3. **Epic 7 foundations: 7.1 dark tokens, 7.2 numerals, 7.3 phone navigation, 7.4 month toolbar.** Danas and every later screen build on them.
4. **Epic 6 (6.1–6.3)** with the redesign in its ACs.
5. **Epic 7 remainder (7.5 onward)**, ordered by dependency. 7.7 and 7.8 follow the PRD and AD-16 edits.

**Rationale:** this avoids building 6.x on the old navigation and numerals and then rebuilding it, and it keeps Epic 5's close-out unblocked. The two alternatives:
- **Epic 7 after the MVP:** about five screens get built twice.
- **Epic 7 first:** conflicts stay undecidable for weeks.

**Effort:** Epic 7 is about 18 one-PR stories, similar in size to Epic 4. **Risk:** medium. It is mostly test churn, plus the AD-16 change in 7.8. **Timeline:** the MVP close (end of Epic 6) moves out by the four foundation stories.

## 4. Detailed Change Proposals

### 4.1 Stories: edits to planned ACs (`epics.md`)

**Story 5.4: An admin decides each conflict on its own screen**

- Section: Acceptance Criteria, replace-member candidates.
- **OLD:** "Where the organization uses fire ranks, candidates may be shown with rank and position — information only."
- **NEW:** keep the old line, and add: "**And** candidates are grouped `slobodan` / `radi taj dan · 24 h bez pauze`, informing only and never blocking (FR-50, FR-18a)."
- Rationale: decision 15. Build one candidate-grouping helper here, for reuse by 7.9.

Also add these ACs:

- **Given** a decision is recorded, **when** the screen returns, **then** a `Notice role="status"` line confirms it and is gone on navigation. It is not a toast and persists nowhere (decision 21, UX-DR29).
- **Given** the amend-leave option, **when** it is shown, **then** it carries the computed start date that would clear this conflict. That date is unselected and is not labelled recommended (decision 22, UX-DR10).
- **Given** the resolution screen, **when** the admin presses ‹ or ›, **then** it moves to the adjacent unresolved conflict in queue order (decision 20, navigation half).

**Story 5.5: A configuration change cannot quietly erase a pending decision**

- Section: Acceptance Criteria, surfacing erased collisions.
- **OLD:** "every collision the change would erase is surfaced for explicit confirm, amend or discard"
- **NEW:** "every collision the change would erase is surfaced **in the rotation save confirmation dialog** for explicit confirm, amend or discard; rotation warnings in the same dialog still do not block (UX-DR23)."
- Add: "**And** rotation settings keep a sticky save bar with `Spremi` and `Odbaci promjene` while there are unsaved changes (decision 25)."

**Story 6.1: A member opens the app and already has their answer**

- Add: "**And** Danas states each case in words: on shift today (type and times), free today (`Danas ne radiš`), on a 24 h duty (as one duty, per 6.2) and on leave today."
- Add: "**And** while loading it shows a skeleton, never a spinner (UX-DR21)."

**Story 6.2: A 24-hour duty reads as one duty, not two unrelated shifts**

- **OLD:** "one leg per constituent shift marked done or in progress"
- **NEW:** "one leg per constituent shift marked done or in progress, **and, where the leg is a replacement, the name of the member replaced**" (decision 3)

**Story 6.3: An admin opens the app and sees what needs them**

- **OLD:** "Then it shows today's coverage across all of them"
- **NEW:** "Then the unresolved-conflict card (*Treba tebe*) renders first, showing `0 neriješenih konflikata` at zero and equal to the queue; today's coverage and the week follow" (decision 2)

### 4.2 Stories: the new Epic 7, "The app is calm on every screen"

**Goal:** every screen reads calm, minimal and simple on a phone and a desktop, in both themes. A pilot user finds each answer in one glance and each change behind one Save.

Foundations, which ship before Epic 6:

| Id | Story | Covers | Depends on |
|---|---|---|---|
| 7.1 | Dark slot tokens are re-tuned and *Noć* never reads as a free day. Six dark values plus `shift-nonworking-border`, with contrast re-measured | 4 | — |
| 7.2 | Every number is set in DM Sans tabular figures. Syne stays for words | 6 | — |
| 7.3 | The phone bar has four tabs plus *Više*. Theme and Odjava move into *Više* and the desktop user menu | 1 | — |
| 7.4 | One month toolbar (‹ month ▾ ›), with a month popover, PgUp/PgDn and an `Ovaj mjesec` label, shared by Kalendar and Sati | 10 | — |

The rest, after Epic 6 and ordered by dependency:

| Id | Story | Covers | Depends on |
|---|---|---|---|
| 7.5 | Filter chips (Smjena, Osoba) with an active summary, `Poništi filtre` and a phone filter sheet. Sati moves `?tim=` to `?smjena=` with a redirect, and empty copy states what is true | 8, 9, 11 | 7.4 |
| 7.6 | Tables become stacked rows below 640 px (Sati, Ljudi, shift types) | 7 | 7.2 |
| 7.7 | Sign-in is one form: organization slug, username, password, with a generic error | 12, 12a | PRD edit |
| 7.8 | A member's first sign-in makes them set their own password. The initial password is four words | 12b | 7.7, new FR, AD-16 |
| 7.9 | Day detail becomes dialogs: roster and type changes each open their own dialog, showing *Što se mijenja* | 13, 16 | 7.5, 5.4 helper |
| 7.10 | A member's Moj raspored shows their own leave and no conflict marks | 14 | CAP-13 edit |
| 7.11 | The member page shows facts under the person's name, and each change opens a dialog with one Save | 5 | — |
| 7.12 | The leave dialog shows cost, balance and the conflicts a record will create before saving, with *bilo / sada* on amend | 19, 16 | 7.11 |
| 7.13 | Ljudi gets a status filter and column, and a new member is added in a dialog | 24 | 7.6, 7.11 |
| 7.14 | An hours figure explains itself in a drawer. It adds a footer total, an export status line and *Moji sati* as the title | 17 | 7.6, new FR |
| 7.15 | An admin sees everyone's leave in one overview | 18 | 7.6, new FR |
| 7.16 | Resolved conflicts stay readable in a *Riješeni* tab | 20 | 5.4, §7.2 carve-out |
| 7.17 | Members find the directory by team in *Više* | 23 | 7.3, CAP-5 edit |
| 7.18 | Organization settings show facts with dialogs, and *Povijest rotacije* sits behind a header button | 27 | — |

Every Epic 7 story updates the DESIGN.md, EXPERIENCE.md and UX-DR lines it changes, in the same PR.

### 4.3 UX docs: decision → section (applied by the story that ships it)

| Decision | DESIGN.md | EXPERIENCE.md | UX-DR / other |
|---|---|---|---|
| 1 | — | §Responsive & Platform, §IA | UX-DR31/32 wording, story 1.8 AC |
| 2, 3 | — | §Key Flows (Danas) | via 6.2/6.3 |
| 4 | §Colors | — | UX-DR1 (23 → 24 names) |
| 5, 13, 24, 27 | §Components | §Component Patterns, §IA | — |
| 6 | §Typography, §Components | — | UX-DR40 |
| 7 | §Layout | §Responsive | UX-DR17, NFR-15 |
| 8–11 | — | §Interaction Primitives | UX-DR19, 20, 30, 34, 36 |
| 12, 12a, 12b | — | §Key Flows (sign-in) | FR-1, FR-3, FR-4 |
| 14 | — | §State Patterns | CAP-13 |
| 15, 16, 19, 22 | — | §Component Patterns | UX-DR10, 23 |
| 17, 18, 20, 23 | — | §IA (surface inventory) | UX-DR25, 33, CAP-5 |
| 21 | — | §State Patterns (a status line is not a toast) | UX-DR29 |
| 25, 26 | — | §Component Patterns | UX-DR16, 23 |

### 4.4 PRD (`prds/prd-shift-2026-09-01/prd.md`)

These edits are applied now, as part of this proposal:

- **New FR-3a: First sign-in sets the password.** A member whose password was issued or reset by an admin must set their own before any surface opens. The admin-issued password is four words. The rule appears in the FR-1 refusal list.
- **New FR-42b: An hours figure explains itself.** Any figure on *Sati* opens the shifts and bands that compose it. The equation is computed by the domain as codes and operands.
- **New FR-45a: Admin leave overview.** An admin sees every member's allowance, days used and balance for the leave year on one surface.
- **New FR-48a: Resolved conflicts stay readable.** Resolved conflicts are listed with their decision and attribution. **§7.2** gets a carve-out: this is not an audit-log UI, only a read of `conflict_resolutions`.
- **CAP-5:** the member directory becomes reachable by team from *Više* (decision 23).
- **CAP-13 / FR-38:** "conflicts visible without opening detail" applies **to an admin**. A member sees their own leave only (decision 14, as shipped in 5.3c).
- **NFR-15:** "a table scrolls within its own container" changes to "a table becomes stacked rows below 640 px, and the calendar grid still scrolls within its own container" (decision 7).

### 4.5 Architecture (`ARCHITECTURE-SPINE.md`)

This edit is applied when 7.8 starts:

- **AD-16:** the admin-auth function sets `app_metadata.must_set_password` on `createUser` and `resetPassword`. It also exposes one more operation, available only to the authenticated caller for themselves, that clears the flag after `auth.updateUser({ password })`. A route guard keeps every surface closed while the flag is set.
- **Deferred note:** "claim-code identity" is partly reversed. Members now choose their own password after a first admin-issued one.

## 5. Implementation Handoff

- **Scope:** Moderate.
- **Product Owner / Developer (now, on approval):**
  - apply §4.1 and §4.2 to `epics.md`;
  - apply §4.4 to the PRD;
  - add Epic 7 and its stories to `sprint-status.yaml` as `backlog`;
  - keep 5.4 next.
- **Developer (`bmad-build`), per story:**
  - implement each story;
  - update the DESIGN.md, EXPERIENCE.md and UX-DR lines from §4.3 in the same PR;
  - apply the AD-16 edit (§4.5) with 7.8.
- **Order:** 5.4 → 5.5 → 7.1–7.4 → 6.1–6.3 → 7.5–7.18.

**Success criteria:**

- the review's phone tab bar, dark-theme and member-page defects are gone, verified by e2e at 390 px and by the contrast sweep;
- Kalendar and Sati share one toolbar;
- every new capability has an FR before its story starts;
- no binding UX doc describes UI that has not shipped.
