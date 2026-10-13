# Sprint Change Proposal: seven former v2 items ship in v1, before pilot go-live

- **Date:** 2026-10-10
- **Author:** Developer (correct-course), for Perolipotic
- **Mode:** Batch
- **Scope classification:** Major. It adds seven epics, rewrites four SPEC non-goals and PRD §6/§7, and amends AD-2, AD-3, AD-11, AD-13, AD-14 and AD-17.
- **Status:** Approved by the human on 2026-10-10 ("ajde po preporukama"): every recommended option in §6 open decisions is adopted as the default for its story spec

---

## 1. Issue Summary

**Trigger:** a human decision on 2026-10-10, made after Epics 1–7 were done (`sprint-status.yaml`: epic-1 … epic-7 `done`). The pilot is not live yet, and a presentation to the pilot comes first. The human's reasoning: the items "the pilot will ask for first" must be in v1, because asking a volunteer fire department to adopt a tool and then wait for its obvious next step costs the adoption (SM-1).

**Category:** a new requirement from the stakeholder, which is a strategic scope change and not a defect. Nothing shipped is wrong.

**What changes.** The following are now in v1, in this priority order and built after the presentation:

| # | Item | Was out of scope in |
|---|---|---|
| 8 | **PWA:** installable, with an offline schedule that shows an "as of" note | PRD NFR-12 / SPEC Q13 (silent), §7.2 "native apps" |
| 9 | **Leave requests:** a member requests leave and an admin approves it. A pending request creates no conflicts | PRD §5.11, §7.2 ("most likely thing the pilot asks for"), SPEC non-goal "no member-initiated workflows" |
| 10 | **Notifications:** email first, then push. Members without an email address depend on PWA push | PRD §6 "not a communication tool", §7.2, SPEC non-goal |
| 11 | **Minimum members per shift:** an organization setting (pilot value 3). It warns and never blocks, and the warning is very visible. It shows at save, on the calendar day, on admin Danas and in the consequence strip | PRD FR-26 out-of-scope, §7.2, SPEC non-goal "no minimum-staffing rules" |
| 12 | **Shift swaps** between members | PRD §5.12 out-of-scope, §7.2, SPEC non-goal |
| 13 | **Absence types, carry-over, part-day leave** | PRD FR-46 out-of-scope, §7.2, SPEC non-goal, SPEC Q5 |
| 14 | **Change history (audit) screen** with PDF export, admin only | PRD §7.2 / NFR-21, SPEC Q12 and non-goal, AD-11 |

**Rename.** The sidebar's *Raspored* (the conflicts queue) becomes **Za odluku**, and its tabs become **Čeka odluku** / **Odlučeno**. The word "konflikt" leaves the UI, because going on leave is not a conflict. "Conflict" stays the domain term in code and in the docs (glossary, DI-4, AD-4).

**Explicitly dropped, and staying out of v1:** weekly and daily calendar views, print, iCal feeds, and CSV and payroll exports.

**Decisions taken in this session (2026-10-10):**

- **D1, absence types.** Absence types are Organization data: a name, and whether the type draws down the Leave Allowance. No absence record has a reason or diagnosis field. A member sees only their own types; another member's absence is visible only to an admin, and only by type name. Q5 is amended accordingly (§4.3).
- **D2, swaps.** A member proposes a swap, the colleague accepts it, and an admin approves it in *Za odluku*. Only the admin's approval writes anything to the schedule: two Roster Overrides.
- **D3, part-day leave.** The unit is a half day. A half-day record costs 0.5 days.
- **D4, audit visibility.** Admin only. This was the proposal in the human's note, and it is adopted here; the human can reverse it at review.

## 2. Checklist Record

| Item | Status | Finding |
|---|---|---|
| 1.1 Triggering story | [N/A] | Not a story. It is a scope decision after Epic 7 |
| 1.2 Core problem | [x] | New stakeholder requirement: v1 = pilot go-live scope |
| 1.3 Evidence | [x] | The human's decision note (2026-10-10). PRD §7.2's own note: leave requests are "the most likely thing the pilot asks for within weeks of go-live" |
| 2.1 Current epic | [N/A] | Epics 1–7 are done. Only open retro items remain (items 8, 11–15) |
| 2.2 Epic-level changes | [x] | Seven new epics, 8–14 |
| 2.3 Remaining epics | [x] | None were planned. Epic 7's shipped surfaces get the rename (story 9.1) |
| 2.4 Invalidated or new epics | [x] | Nothing is invalidated. Every new epic builds on the shipped engine |
| 2.5 Order | [x] | Priority order 8 → 14 holds. 10's push needs 8's service worker, and 12 reuses 9's *Za odluku* item model |
| 3.1 PRD | [!] | §6 (two non-goals), §5.9/5.10/5.11/5.12 out-of-scope lines, §7.1, §7.2, §11.2 Q5/Q11, NFR-5, NFR-12, NFR-21, and new FR-54 to FR-79 |
| 3.2 Architecture | [!] | AD-2 (new rule kinds; allowance per leave year), AD-3 (an audit trigger class), AD-11 (no audit UI → audit UI), AD-13 (offline snapshot), AD-14 + AD-17 (a second Edge Function and its secrets), Deferred list |
| 3.3 UX | [!] | EXPERIENCE.md IA (rename, new surfaces), UX-DR4 (warning token), UX-DR8/12 (a fifth glyph), UX-DR23 (a standing staffing state), UX-DR25/31/32/33 |
| 3.4 Other artifacts | [!] | SPEC package (canonical for epics), `hr.json` (71 "konflikt" strings), e2e selectors, `sprint-status.yaml`, the demo seed, DEPLOY.md (email provider and VAPID secrets) |
| 4.1 Direct adjustment | Viable | Adds epics and touches no shipped epic's correctness |
| 4.2 Rollback | Not viable | Nothing to roll back |
| 4.3 MVP review | [x] | The MVP expands rather than shrinks. Go-live moves later by the size of epics 8–14 |
| 4.4 Path | [x] | Direct adjustment plus an MVP expansion (§3) |
| 5.x Proposal components | [x] | This document |
| 6.x Approval and handoff | [ ] | Pending |

## 3. Impact Analysis

### 3.1 Epic impact

- **Epics 1–7:** they stay done. No acceptance criterion is reverted.
  - Story **9.1** renames the shipped surfaces of 5.3b, 5.4, 6.3 and 7.16 (*Raspored* → *Za odluku*, no "konflikt").
  - Epic 13 changes the leave surfaces of 5.1/5.2/7.12/7.15 through new stories, and their original criteria stay in history, as Epic 7 did.
- **New:** Epics 8–14 (§4.6). The open Epic 7 retro items (8, 11–15) are unaffected. Item 14 (AD-13 wording) should land before Epic 8, because 8.3 amends AD-13.

### 3.2 Artifact conflicts

| Artifact | Conflict |
|---|---|
| SPEC (`specs/spec-shift/`) | It is the canonical requirements basis for `epics.md`, so it is edited first. Non-goals "not a communication tool", "no member-initiated workflows", "no absence types beyond annual leave", "no export beyond the hours view" and "no audit-log interface" all reverse. The "no minimum-staffing rules" part of "not a workforce-optimization tool" narrows. Q5 and Q12 change, and new CAP-18 to CAP-24 are added. **Drift found:** SPEC CAP-16, glossary "Leave Hours" and engine R4.10 still say "leave hours", while the 2026-10-10 decision reports leave in days. Fix it in the same pass |
| PRD | §6 communication non-goal; §7.1 and §7.2; the out-of-scope lines in §5.9, 5.10, 5.11 and 5.12; NFR-5, NFR-12 and NFR-21; §11.2 Q5 (answered by Epic 11) and Q11 (answered by D1) |
| Architecture | See §4.4. The two weighty amendments are a second Edge Function (notifications) and audit triggers (history). Both are cases the spine's own text names as "revisit this AD", not cases to work around |
| UX | *Za odluku* holds three item kinds (collision, leave request, swap). New surfaces: request leave, request swap, notification settings, change history, install. Short-staffed is a new standing state on the calendar and on Danas, so UX-DR23's "never persist as standing banners" gets a named exception, as conflicts already have |
| i18n | 71 "konflikt" strings in `hr.json` are rewritten under the vocabulary of §4.5 |
| Tests / e2e | Page objects and specs that match "Raspored", "konflikt", "Neriješeni" and "Riješeni" |
| Ops | Email provider account, a sending domain (SPF/DKIM), VAPID keys and a scheduled job. They go in DEPLOY.md and in each environment's secrets |

### 3.3 Technical impact (summary)

- **New tables** (all organization-scoped, with RLS, AD-11 attribution, and none derived):
  - `leave_requests` and `leave_request_decisions`;
  - `swap_requests` and `swap_request_decisions`;
  - `absence_types`;
  - `leave_allowances`, versioned per leave year;
  - `notification_outbox` and `push_subscriptions`;
  - `audit_events`;
  - organization columns: `min_members_per_shift` and the carry-over settings.
- **First member-role domain writes.** A member inserts their own request, withdraws it, and accepts or declines a swap addressed to them. Q2 stays as written, because those writes are not administrative. The RLS pattern of AD-10 gains a "self-owned row" policy.
- **New domain modules:** `domain/staffing` (short-staffed), `domain/requests` (preview of what an approval would do), and `domain/leave` extended for types, half days and carry-over.
- **Server runtime:** one `notify` Edge Function, driven by a scheduled job over the outbox, that sends email and Web Push.
- **Client:** a service worker, a manifest, a persisted query cache (IndexedDB) for offline reads, and a lazily loaded PDF writer.

## 4. Recommended Approach

**Direct adjustment, plus an MVP expansion.** Add Epics 8–14 after Epic 7 and update the SPEC, PRD and architecture first, so every story starts from a written requirement. Nothing is rolled back.

- **Rationale:** the engine's separation of rule, projection and exceptions already carries each item.
  - A leave request is a not-yet-asserted Leave Record.
  - A swap is two Roster Overrides.
  - Short-staffed is a derived signal next to collisions.
  - History is the attribution the data already carries, made visible.
  - None of them needs a new derivation paradigm.
- **Effort:** about 40 stories, roughly the size of Epics 5–7 together.
- **Risk:**
  - **High, Epic 10:** a new server runtime, email deliverability, and Web Push on iOS works only for an installed PWA on 16.4+.
  - **High, Epic 13:** carry-over and half days ripple through leave cost, balance, collisions and hours.
  - **Medium, Epic 14:** the trigger exception, and history that starts on the migration date.
  - **Low:** 8, 9, 11 and 12.
- **Timeline:** go-live moves after Epic 14. Each epic is shippable on its own, so the human may go live earlier with a prefix (for example 8–11) by revising this order, without replanning.

---

## 5. Detailed Change Proposals

### 5.1 SPEC package (`specs/spec-shift/`), applied on approval

**SPEC.md, Non-goals.**

- **OLD:** "**Not a communication tool.** No notifications, reminders, messaging, push, SMS, or email beyond authentication and invitation."
- **NEW:** "**Not a communication tool.** Notifications tell a member about their own schedule and their own requests, and tell an admin what waits for a decision (CAP-20). No messaging, chat, broadcast, announcements or SMS."
- **OLD:** "**No member-initiated workflows in MVP.** Members do not request leave, propose swaps, trade shifts, or resolve conflicts. Leave is admin-entered only."
- **NEW:** "**Members propose; admins decide.** A member may request leave (CAP-19) and propose a swap (CAP-22). Nothing a member does changes the Schedule until an admin approves it. Members never resolve conflicts."
- **OLD:** "**No absence types beyond annual leave.** No sick, personal, training, parental, or unpaid leave; no carry-over, part-day leave, public-holiday calendars, or accrual."
- **NEW:** "**Absence is typed by the organization, not by the product.** Absence types are organization data (CAP-23). No reason or diagnosis is recorded. No public-holiday calendars, no accrual over time, no per-group leave policies."
- **OLD:** "**Not a workforce-optimization tool.** No demand forecasting, auto-assignment, minimum-staffing rules, qualification constraints, or statutory rest-period enforcement."
- **NEW:** "**Not a workforce-optimization tool.** No demand forecasting, auto-assignment, qualification constraints, or statutory rest-period enforcement. One minimum-members number per organization warns and never blocks (CAP-21)."
- **OLD:** "**No export or reporting beyond the hours view.** No CSV, Excel, PDF, analytics, or team statistics."
- **NEW:** "**No export beyond the hours Excel file and the change-history PDF.** No CSV, payroll formats, analytics, or team statistics."
- **OLD:** "**No audit-log interface.** The data model supports auditability; no screen exposes it."
- **NEW:** delete it; CAP-24 replaces it.
- **Unchanged:** "No calendar surfaces beyond the monthly view." It is re-confirmed on 2026-10-10.

**SPEC.md, Capabilities: add.**

- **CAP-18 — An installable app that reads offline.**
  - **intent:** A member installs Shift to their home screen, and opens their schedule with no connection.
  - **success:** The app installs on Android and iOS. Offline, every surface already read shows its last snapshot with "as of {date time}" and refuses every write with a stated reason. It never shows a cached figure beside a fresh one. Signing out removes every cached snapshot from the device.
- **CAP-19 — Leave requests.**
  - **intent:** A member requests a leave range, and an admin approves or rejects it.
  - **success:**
    - The member sees the cost before sending.
    - A pending request creates no Conflict, charges no balance and alters no shift.
    - The admin sees, before deciding, what approval would create: its cost, the balance after it, its conflicts and any short-staffed shift.
    - Approval creates a Leave Record attributed to the approving admin.
    - Rejection creates nothing.
    - A member can withdraw a pending request.
    - Each decision is attributable.
- **CAP-20 — Notifications.**
  - **intent:** A member learns about a decision on their request, or a change to their own shifts, without opening the app. An admin learns that something waits in *Za odluku*.
  - **success:**
    - Email reaches a member with an email address.
    - Push reaches a member who installed the app and allowed it.
    - A member without either is told so in their settings.
    - A notification names facts and links to the surface.
    - Each member can turn each channel off.
    - Nothing is sent about another member's leave or absence type to a member-role account.
- **CAP-21 — Minimum members per shift.**
  - **intent:** An organization sets how many people a working shift needs, and the app says plainly where a shift falls short.
  - **success:**
    - A working Scheduled Shift whose people at work number fewer than the setting is short-staffed. People at work are the roster after overrides, minus everyone absent that date, plus replacements.
    - A shift that becomes short-staffed is shown before every save that would cause it: leave, request approval, roster change, swap approval, conflict resolution, deactivation and rotation.
    - Short-staffed shifts are marked on the calendar day and counted on admin Danas.
    - Nothing is blocked.
    - With the setting empty, nothing is reported.
- **CAP-22 — Shift swaps.**
  - **intent:** A member proposes to exchange a shift with a colleague, the colleague accepts, and an admin approves.
  - **success:**
    - A swap names A's shift and, optionally, B's shift in return.
    - Until the admin approves, the Schedule is unchanged.
    - Approval writes Roster Overrides attributed to the admin: replace A with B, and replace B with A when there is a return shift.
    - Before approval, the admin sees each member's hour delta, any leave or double booking, and any short-staffed result. These warn and never block.
    - Either member can withdraw before the decision.
- **CAP-23 — Absence types, carry-over and part-day absence.**
  - **intent:** An organization records absence other than annual leave, carries unused leave into the next leave year, and records half days.
  - **success:**
    - An Absence Type has a name and says whether it draws down the allowance.
    - Every type raises a Conflict against a rostered working shift.
    - Only drawing types change the balance.
    - Carried-over days are derived from the previous leave year's unused balance, capped by the organization's setting, and expire on its date.
    - A half-day record costs 0.5.
    - No record carries a reason.
- **CAP-24 — Change history.**
  - **intent:** An admin reads who changed what, when, and can export it as a PDF.
  - **success:**
    - Every write to a rule, an exception, a decision, a request, a member or a setting appears with its author, time, and before/after values.
    - Deletions included.
    - Filterable by date range, member, team and kind.
    - The PDF holds exactly the filtered rows.
    - Member-role accounts reach none of it.
    - History begins at the migration that introduces it; earlier entries are reconstructed from existing attribution columns where they exist.

**SPEC.md, CAP-16:** change "the resulting hours land as leave hours rather than worked hours" to "the shift drops out of the absent member's worked hours and counts as its Leave Day" (drift fix, 2026-10-10 decision).

**SPEC.md, Assumptions / Open Questions:**

- Remove "On-screen hour reporting is sufficient; no export is needed in MVP" (stale since FR-42a).
- Remove the deactivation open question. It is answered by CAP-21: a vacated shift shows as short-staffed when the setting is on.
- Replace "Does the pilot need an absence reason recorded?" with: "No reason is ever recorded (D1). Open: does the pilot record sick leave at all? If it does, the admin-only visibility of D1 is its legal basis's minimum (GDPR Art. 9(2)(b)); confirm with the pilot."

**quality-requirements.md:**

- **Q5 OLD:** "Personal data is limited to what scheduling requires: name, optional email, team, hours, leave. No health data, and no absence-reason field that invites it."
- **Q5 NEW:** "Personal data is limited to what scheduling requires: name, optional email, team, hours, absence by type. No absence record has a reason, diagnosis or free-text field. An absence type's name is visible only to admins and to the member themselves; to anyone else it reads as absent. Where an organization names a type for sick leave, that fact is health data, held under that visibility rule and no wider."
- **Q12 NEW:** "Every write to an organization's records is reconstructable — author, time, before and after — and readable by admins on the change-history surface (CAP-24)."
- **Q13 add:** "The application is installable as a PWA and reads offline (CAP-18)."
- **Q24 (new):** "A cached snapshot is never shown without its as-of time, never beside a fresh one, and never survives sign-out."
- **Q25 (new):** "A notification is derived from a recorded fact, never a calculation the notifier makes on its own. It is sent at most once per recipient and channel."

**glossary.md:**

- **Add:**
  - Absence Type;
  - Leave Request;
  - Swap Request;
  - Short-staffed Shift;
  - Minimum Members;
  - Carried-over Days;
  - Half-day Record;
  - Notification;
  - Change History.
- **Redefine:**
  - **Leave Record:** "a date range of absence of one Absence Type for one Member, entered by an Admin or created by approving a Leave Request. A one-date record may be a Half-day Record."
  - **Leave Day:** add "a Half-day Record counts 0.5".
  - **Leave Balance:** "Leave Allowance plus Carried-over Days not yet expired, minus Leave Days of drawing types consumed in the Leave Year".
- **Delete** "Leave Hours" (drift fix).
- **Note on UI vocabulary:** "Conflict" is rendered in Croatian UI as an item *za odluku* (§5.5), never "konflikt".

**engine-rules.md:**

- **R4.10:** rewrite to the days rule (drift fix).
- **R4.11 – R4.15 (new):**
  - absence types, and which of them draw;
  - half-day cost;
  - carry-over derivation, cap and expiry;
  - allowance per leave year (AD-2 amendment);
  - a carried day is consumed before the current year's allowance.
- **§9, Requests (new):**
  - R9.1: a pending request derives nothing;
  - R9.2: approval = an attributed Leave Record or Roster Overrides;
  - R9.3: an approval preview runs the same collision and staffing rules as a direct write;
  - R9.4: a request overlapping the member's existing leave or another pending request of theirs is refused.
- **§10, Staffing (new):**
  - R10.1: people at work = roster after overrides, minus absence;
  - R10.2: short-staffed ⟺ working shift ∧ people at work < minimum;
  - R10.3: derived on read (AD-1), never stored;
  - R10.4: never blocks;
  - R10.5: the worked example — pilot teams of 4, minimum 3, one member on leave → 3 at work, not short; two on leave → short.
- **R7.4:** close the open item by reference to R10.

### 5.2 PRD (`prds/prd-shift-2026-09-01/prd.md`), applied on approval

- **§6:** the "communication tool" bullet as in the SPEC. Add: "**This does not become a staffing optimizer.** One minimum-members number warns; it never assigns, never blocks and never reads Fire Rank or Team Position (FR-18a stays inert)."
- **§5.9 out-of-scope:** keep it, and note "re-confirmed out of v1, 2026-10-10".
- **§5.10 out-of-scope:** replace "export as CSV or PDF" with "export as CSV or payroll formats (re-confirmed 2026-10-10)".
- **§5.11 Description and out-of-scope:** members may request leave (§5.15); types, carry-over and half days are §5.19. What stays out: public-holiday calendars, accrual, and per-group policies.
- **§5.12 out-of-scope:** remove "two-member shift swaps" (now §5.17). Keep "Member-initiated resolution" and "bulk resolution". Replace "notification of any resolution" with "notification beyond FR-62".
- **New feature sections and FRs**, each with testable consequences mirroring CAP-18 to CAP-24:

| Section | FRs |
|---|---|
| §5.14 Installable and offline (CAP-18) | FR-54 install · FR-55 offline read with as-of note · FR-56 offline writes refused · FR-57 sign-out clears the device |
| §5.15 Leave requests (CAP-19) | FR-58 member requests with cost preview · FR-59 withdraw · FR-60 admin decides with approval preview · FR-61 the member sees status |
| §5.16 Notifications (CAP-20) | FR-62 events and recipients · FR-63 email · FR-64 push · FR-65 per-member channel settings |
| §5.17 Shift swaps (CAP-22) | FR-66 propose · FR-67 colleague accepts or declines · FR-68 admin decides with preview · FR-69 withdraw |
| §5.18 Minimum members (CAP-21) | FR-70 setting · FR-71 short-staffed derived · FR-72 shown at every causing save · FR-73 calendar mark and Danas count |
| §5.19 Absence types, carry-over, half days (CAP-23) | FR-74 types · FR-75 half-day record · FR-76 carry-over setting and derivation · FR-77 balance per drawing type |
| §5.20 Change history (CAP-24) | FR-78 history surface · FR-79 PDF export |

- **FR-48 / FR-53:** "unresolved Conflict count" becomes "count of items waiting in *Za odluku*" (collisions, leave requests, swap requests), shown even at zero and equal to the queue.
- **FR-48a:** "not an audit-log interface" stays true for *Odlučeno*, which now also lists decided requests. The history surface is FR-78.
- **§7.1:** add the seven capabilities. **§7.2:** remove the moved items and keep what is re-confirmed out:
  - weekly/daily views, print, iCal;
  - CSV/payroll;
  - temporary loan;
  - public holidays, accrual;
  - English;
  - native apps.
- **NFR-5 = Q5 NEW.** **NFR-12:** add "installable PWA". **NFR-21 = Q12 NEW.**
- **§11.2:**
  - Q5 is answered (FR-71);
  - Q11 is answered (D1), with the sick-leave confirmation carried over;
  - Q9 retention now also governs `audit_events`.

### 5.3 Epics (`epics.md`), applied on approval

- **Requirements Inventory:**
  - add CAP-18 to CAP-24 and Q24 and Q25;
  - update CAP-14/CAP-16 drift, Q5 and Q12;
  - add UX-DR45 to UX-DR52 (§5.5);
  - extend the FR Coverage Map so each new CAP maps to exactly one epic.
- **Epic List:** add Epics 8–14 (§5.6). Overview text: "Fourteen epics. Epics 8–14 were added on 2026-10-10 by `sprint-change-proposal-2026-10-10-v1-scope-expansion.md`, in priority order."
- **Story bodies:** written in full in `epics.md` in the established format (As a / I want / So that, Depends on, Given/When/Then). Every story that changes a surface updates DESIGN.md, EXPERIENCE.md and the UX-DR lines in the same PR, as in Epic 7.

### 5.4 Architecture (`ARCHITECTURE-SPINE.md`), applied by the first story that needs each one

| AD | Amendment | Applied with |
|---|---|---|
| AD-13 | A surface may render its persisted snapshot only while offline, whole, labelled with its as-of time. Online, a persisted snapshot is never shown. Q19 still holds, because one snapshot is still one read | 8.2 |
| AD-2 | New rows in the table: absence type (current-state, like shift type name), leave allowance (**versioned per leave year**, since carry-over must read the previous year's allowance as it was), minimum members (current-state, so moving it changes the warnings for past dates too, like hour bands) | 11.1, 13.1 |
| AD-4 | *Za odluku* is a union: derived collisions without a resolution, plus pending leave requests, plus pending swap requests. Requests are stored, and only their decision clears them | 9.2 |
| AD-10 | A member may insert, and withdraw, rows they own (requests), and answer a swap addressed to them. These are the first member-role domain writes. The policy reads `member_id = current member` from the helper, never from the request | 9.2 |
| AD-14 | Exactly **two** Edge Functions: `admin-auth` (AD-16, unchanged) and `notify`. `notify` reads `notification_outbox` on a schedule, sends email and Web Push, and marks rows sent. It may read organization data with the secret key to address and localize a message. It writes nothing but the outbox's delivery columns and expired push subscriptions. Its text comes from the shared locale resource by code (L4, AD-8). A third function amends this AD again | 10.1 |
| AD-17 | The email provider key and the VAPID private key live only in `notify`'s environment | 10.1 |
| (new) AD-18 | A notification is written to the outbox by the same request that asserts the fact it reports (an approval, a decision, a roster change), as codes and operands. `notify` computes no domain answer. A reminder that needs projection is out of v1 | 10.1 |
| AD-3 | A second permitted trigger class: **append-only audit triggers** that copy `OLD`/`NEW` of an organization table into `audit_events`, with `auth.uid()` and `now()`. They compute nothing and refuse nothing. The Q6 trigger stays the only refusing trigger | 14.1 |
| AD-11 | Replace "No audit-log interface exists" with "The change history (CAP-24) reads `audit_events`. Attribution columns stay the source of truth for the rows they sit on" | 14.1 |
| Deferred | "Conflict-resolution history" is resolved by `audit_events`. Add "Shift reminders (needs projection outside the browser)" and "Organization-specific PWA manifest" | 10.1, 14.1 |
| Stack | A PDF writer, lazy-loaded in `apps/web` only, and a PWA plugin. Versions are pinned and verified when the story starts | 8.1, 14.3 |

Because AD-14, AD-3 and AD-18 are spine-level, an **Architect pass** (`bmad-architecture`, update intent) reviews them before Epic 10 and before Epic 14 starts. This proposal supplies their wording.

### 5.5 UX and the *Za odluku* vocabulary

**Rename (story 9.1).** The Croatian UI never says "konflikt". Proposed vocabulary, which story 9.1 finalizes in `hr.json`:

| Where | Today | New |
|---|---|---|
| Sidebar / tab | Raspored | **Za odluku** |
| Tabs | Neriješeni · Riješeni | **Čeka odluku** · **Odlučeno** |
| Count | `3 neriješena konflikta` | `3 čekaju odluku` (one `# čeka odluku`, few `# čekaju odluku`, other `# čeka odluku`) |
| A collision item | Konflikt | **Odsutnost u smjeni**: `{ime} je na godišnjem, a raspoređen je` |
| Button | Riješi konflikt | **Odluči** |
| Calendar legend | ⚠ neriješen konflikt | ⚠ **čeka odluku** |
| Erasure dialog | Promjena briše 2 konflikta | **Promjena uklanja 2 stavke koje čekaju odluku** |
| Back link | Natrag na konflikte | **Natrag na Za odluku** |
| Accent rule | rezervirana za konflikte | rezervirana za **ono što čeka odluku** |

**New and amended UX-DRs:**

- **UX-DR45, install and offline.** The install prompt sits in *Više* and is never a modal on first visit. Offline, a `Notice` reads `Bez veze · stanje od 10.10.2026. 14:32` above the surface, and a write control states that it needs a connection.
- **UX-DR46, *Za odluku* items.** Three kinds: absence in a shift, a leave request, a swap request. Each kind has its own decision screen. The queue is sorted soonest-first across all kinds, and each item names its kind in words.
- **UX-DR47, request forms.**
  - A member's request leave: range, type (Epic 13), half day, then the cost and the balance after it, and one *Pošalji*.
  - Request swap: my shift, colleague, optional return shift, the colleague's own consequence, one *Pošalji*.
- **UX-DR48, short-staffed.** This is a fifth state glyph with a legend entry, its own `warning` token (light and dark, contrast-verified, never `destructive`, never accent) and a non-colour signal.
  - It is a standing derived state, the second named exception to UX-DR23 after conflicts.
  - At save it is a block in the *Što se mijenja* summary, not a quiet line: `Smjena B, 14.10. Dan: rade 2 od najmanje 3`.
  - On admin Danas it is a card next to *Za odluku*, shown even at zero.
  - In the consequence strip it lives in the coverage term.
- **UX-DR49, notification settings.** In *Više*: email on/off (with the address, or `Nemaš upisan e-mail`), and push on/off (or `Instaliraj aplikaciju za obavijesti` on iOS).
- **UX-DR50, absence type.** It is a radio card group in the leave dialog. A member sees others' absence as *odsutan*, never the type. The calendar ◷ legend reads *odsutnost*.
- **UX-DR51, change history.**
  - A table (stacked rows below 640 px) of time, author, kind, subject, and *bilo → sada*.
  - Filter chips: period, member, team, kind.
  - One `Izvezi u PDF`, which exports exactly the filtered rows.
- **UX-DR52, decided requests.** *Odlučeno* lists them beside decided collisions, with the decision, the admin and the time.
- **UX-DR4:** add "`warning` is reserved for short-staffed".
- **UX-DR8/12:** "four-mark" becomes "five-mark".
- **UX-DR23:** add the short-staffed exception.
- **UX-DR25:** applies the tab rename.
- **UX-DR31/32:**
  - *Za odluku* replaces *Raspored* in the binding order.
  - The member's *Više* gains *Obavijesti* and *Instaliraj*.
  - The member's *Godišnji* gains *Zatraži godišnji*.
  - The member's day detail gains *Predloži zamjenu*.
  - The admin's *Više* gains *Povijest promjena* under *Pregled*.
- **UX-DR33:** five new surfaces (request leave, request swap, notification settings, change history, request decision screen). The surface count goes from 18 to 23.

### 5.6 New epics and stories

Each epic stands alone and enables the next. Ids follow the established `N.M` and split into `a`/`b` at spec time where a story is too large for one PR.

#### Epic 8: The app installs, and the schedule reads without a connection

A member adds Shift to their phone's home screen and opens it on a truck with no signal: the last schedule they saw is there, with the time it is from, and nothing pretends to save.

**Capabilities:** CAP-18 · **Governed by:** AD-13 (amended), AD-14 · **Proves:** Q13, Q19, Q24

| Id | Story | Depends on |
|---|---|---|
| 8.1 | The app is installable: a manifest, icons, a service worker that caches the app shell, and an update prompt when a new version ships. Decide the installed name (the PRD's "Shift" is a working title) | — |
| 8.2 | Surfaces read offline: the query cache persists to IndexedDB. Offline, a visited surface renders its last snapshot with the as-of note, and a member's current and next month are prefetched on Danas (AD-13 amendment) | 8.1 |
| 8.3 | Offline writes are refused with a stated reason, and signing out clears every persisted snapshot | 8.2 |
| 8.4 | Install from *Više*, with instructions for iOS Safari | 8.1 |

#### Epic 9: A member asks for leave, and an admin decides

Luka asks for 10.–16.11. from his phone and sees it would cost 3 days. Damir sees the request in *Za odluku* with the conflicts it would raise, approves it, and the leave exists. Until then, nothing in the schedule moved.

**Capabilities:** CAP-19 · **Governed by:** AD-4, AD-10, AD-11 (amended) · **Proves:** Q2, Q11

| Id | Story | Depends on |
|---|---|---|
| 9.1 | *Raspored* becomes *Za odluku*, tabs *Čeka odluku* · *Odlučeno*, and no screen says "konflikt" (§5.5). The URL keeps a redirect | — |
| 9.2 | The request record: `leave_requests` + decisions, member-owned insert and withdraw under RLS, overlap refusals, and pending derives nothing (R9.1, R9.4) | 9.1 |
| 9.3 | A member requests leave from *Godišnji* and sees its cost and balance after it, then their pending, approved and rejected requests | 9.2 |
| 9.4 | An admin decides a request on its own screen, with the approval preview (cost, balance after, conflicts it creates, and short-staffed once Epic 11 lands). Approve creates the attributed Leave Record; reject records the decision | 9.2 |
| 9.5 | *Za odluku* lists requests beside collisions. The Danas count and FR-48/53 equality span both, and *Odlučeno* lists decided requests | 9.4 |

#### Epic 10: People hear about what concerns them

**Capabilities:** CAP-20 · **Governed by:** AD-14, AD-17, AD-18 (new) · **Proves:** Q25 · **Architect pass before 10.1**

| Id | Story | Depends on |
|---|---|---|
| 10.1 | The outbox and the `notify` function: the table, the schedule, at-most-once delivery, localized templates from the locale resource, and secrets per environment (DEPLOY.md) | Architect pass |
| 10.2 | Email. Events:<ul><li>to the member: their leave request decided; their shifts changed by a roster or shift-type override, a swap, or a rotation change effective within the next 30 days; leave recorded for them by an admin;</li><li>to all admins: a new item in *Za odluku*.</li></ul>Each event is written by the request that asserts it | 10.1, 9.4 |
| 10.3 | Notification settings in *Više*: per-channel on/off, and the state when there is no email | 10.2 |
| 10.4 | Web Push: subscriptions, VAPID, the same events as email, the iOS installed-only path, and dead subscriptions removed | 10.3, 8.1 |

#### Epic 11: A shift short of people is impossible to miss

**Capabilities:** CAP-21 · **Governed by:** AD-1, AD-2 (amended), AD-8 · **Proves:** Q9, Q21

| Id | Story | Depends on |
|---|---|---|
| 11.1 | `domain/staffing` and the setting: R10.1–R10.5 against both fixtures, and *Najmanje ljudi u smjeni* in Organizacija (empty = off; the demo seed sets 3) | — |
| 11.2 | Every save that can cause it shows it in *Što se mijenja*: the leave dialog, a request approval, the roster and type dialogs, conflict resolutions (coverage term), deactivation and rotation save | 11.1 |
| 11.3 | The calendar day carries the fifth glyph and the legend entry, and day detail states `rade 2 od najmanje 3` | 11.1 |
| 11.4 | Admin Danas shows a short-staffed card next to *Za odluku*: a count that links to the dates, shown at zero | 11.3 |

#### Epic 12: Members swap shifts, and an admin signs it off

**Capabilities:** CAP-22 · **Governed by:** AD-4, AD-10, AD-11 · **Proves:** Q2, Q11

| Id | Story | Depends on |
|---|---|---|
| 12.1 | The swap record: `swap_requests` + decisions, with states proposed → accepted/declined → approved/rejected, withdrawn. Proposer and addressee RLS | 9.2 |
| 12.2 | A member proposes from the day detail: my shift, a colleague, an optional return shift, and the consequence for both | 12.1 |
| 12.3 | The colleague accepts or declines from their *Danas* | 12.2 |
| 12.4 | The admin decides in *Za odluku* with a preview (hour deltas, leave, double booking, short-staffed). Approval writes the Roster Overrides with reason `swap`, attributed to the admin, through the AD-5 erasure check | 12.3, 11.1 |

#### Epic 13: Absence has a type, unused leave carries over, and a half day exists

**Capabilities:** CAP-23 · **Governed by:** AD-2 (amended), AD-3, AD-8 · **Proves:** Q5 (amended), Q9, Q19

| Id | Story | Depends on |
|---|---|---|
| 13.1 | Absence types as organization data (name, draws allowance). Annual leave is seeded per organization as a drawing type. Existing records become annual leave | — |
| 13.2 | The leave dialog and the request form choose a type. Members see others only as *odsutan*. Sati and the Excel file show a days column per drawing type and one for the rest, with columns named by organization data | 13.1 |
| 13.3 | Allowance becomes per leave year (AD-2 amendment), with a migration from the current single value | — |
| 13.4 | Carry-over: an organization setting (maximum days, expiry date). Derivation R4.13–R4.15. Balance, the leave overview and the member's tiles show carried days and their expiry | 13.3 |
| 13.5 | Half-day records: the one-date record has a first-half or second-half choice and costs 0.5. Its collision and the hours of the worked half are fixed by the story spec (default: one collision; the worked half's interval counts in Band Hours) | 13.2 |

#### Epic 14: Every change can be read back, and printed

**Capabilities:** CAP-24 · **Governed by:** AD-3, AD-11 (amended) · **Proves:** Q11, Q12 (amended) · **Architect pass before 14.1**

| Id | Story | Depends on |
|---|---|---|
| 14.1 | `audit_events` and append-only triggers on every organization table. Admin-only read under RLS, and backfill from existing attribution columns | Architect pass |
| 14.2 | *Povijest promjena* for admins: the table, filters, and *bilo → sada* in words from codes | 14.1 |
| 14.3 | PDF export of exactly the filtered rows, with organization name, period and generation time, through a lazily loaded writer | 14.2 |

### 5.7 `sprint-status.yaml`, applied on approval

Add `epic-8` … `epic-14` and each story key above as `backlog`, plus `epic-N-retrospective: optional`. Each epic gets a comment naming this proposal.

## 6. Implementation Handoff

- **Scope:** Major.
- **PM / Product Owner (now, on approval; done in this session):**
  - apply §5.1 (SPEC), §5.2 (PRD) and §5.3 + §5.6 (epics.md, with full story bodies);
  - apply §5.7 (sprint-status);
  - update the memory note for the scope expansion.
- **Architect (before Epic 10 and Epic 14):** a `bmad-architecture` update pass over AD-14, AD-17, AD-18 and AD-3, AD-11, starting from §5.4's wording. AD-13 and AD-2 are applied by stories 8.2 and 13.3 without a separate pass.
- **Developer (`bmad-build`), per story:**
  - implement each story;
  - update DESIGN.md, EXPERIENCE.md and UX-DR lines in the same PR;
  - apply the §5.4 row the story names.
- **Order:** 8.1 → … → 14.3, in the order above. Optionally, go live after any finished epic.
- **Open decisions, each settled at its story's spec:**
  - the installed app name (8.1);
  - whether a swap's return shift is optional, i.e. whether one-way cover is allowed (12.1; proposed: optional);
  - whether the pilot records sick leave at all (13.1; ask at the presentation);
  - half-day collision and hours semantics (13.5);
  - carry-over defaults (13.4; Croatian practice is expiry on 30.06.);
  - audit visibility, admin only per D4 (14.1).

**Success criteria:**

- every new capability has a CAP and an FR before its first story starts;
- no screen says "konflikt";
- a pending request and an unapproved swap change no figure anywhere;
- short-staffed is visible in all four places with the setting on, and absent with it off;
- offline Danas shows its as-of time on a phone with no connection;
- a member without an email gets push after installing;
- the change history PDF matches the filtered table row for row;
- both fixtures pass every new engine rule (AD-15).
