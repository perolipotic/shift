# Sprint Change Proposal: v2 scope, four items from PRD §7.2

- **Date:** 2026-11-20
- **Author:** Developer (correct-course, headless), for Perolipotic
- **Mode:** Batch, unattended. The founder asked for no questions, so each product choice below is recorded as a decision with its rationale. The security-sensitive ones are listed in §6 for the founder to ratify, each with a recommended default.
- **Scope classification:** Major. It adds four epics (16–19), 22 FRs (FR-80 to FR-101), amends PRD §5.1, §5.2, §5.4, §5.9, §5.16, §6, §7 and §11, and amends AD-1 (scope note), AD-2, AD-7, AD-9, AD-10, AD-12, AD-14, AD-16, AD-17 and AD-18.
- **Status:** Scope approved by the founder on 2026-11-20. The PRD changes in §5.2 are applied in this branch. The §6 founder decisions are **pending ratification**. Until they are ratified, the recommended default stands for planning but no story in Epic 16, 17 or 19 that depends on one starts. Epic 18 depends on none of them.
- **Pilot:** the pilot goes live on v1 in parallel. Nothing here blocks it. Nothing here changes a shipped behaviour until its story ships, and the one production-configuration change (opening the signup door, Epic 19) is a separate founder decision (D-S5).

---

## 1. Issue Summary

**Trigger:** a founder decision on 2026-11-20, after Epics 1–15 (v1) were done and merged (`sprint-status.yaml`: epic-1 … epic-15 `done`; last merge #320). The founder approved a v2 scope expansion of four items that PRD §7.2 lists as "Out of Scope for MVP":

| # | Item | Where it was out of scope |
|---|---|---|
| 1 | **Shifts in the phone's calendar.** A Member subscribes to their own schedule through a personal iCal (ICS) feed URL in Google or Apple Calendar. A print view of the monthly schedule is added too | PRD §5.9 out-of-scope line ("print layout; iCal or calendar-subscription feeds"), §7.2, SPEC non-goal "No calendar surfaces beyond the monthly view" |
| 2 | **Shift reminders.** Push or email before a shift (the day before, or a few hours before), extending FR-62–FR-65. The Member controls them in the notification settings | PRD FR-62 consequence "Shift reminders that need a projection outside the browser are out of v1", §7.2 "Notifications beyond FR-62's events", spine AD-18 and Deferred "Shift reminders" |
| 3 | **Temporary loan of a Member to another Team**, as a first-class concept in place of repeated Roster Overrides | PRD FR-18 out-of-scope line, §7.2 "Deferred because the workflow is a feature in itself", §11.2 Q7 |
| 4 | **Self-service organization signup**: create an account, then an organization, then teams, shift types and a rotation, then invite members. No billing | PRD FR-2 ("No user-facing surface allows creating an Organization"), §5.1, §7.2 "go-to-market", SPEC non-goal "No self-service commerce", addendum §9 "SaaS direction", spine Deferred "Claim-code identity" |

**Category:** a new requirement from the stakeholder. It is a strategic scope change, not a defect. Nothing shipped is wrong.

**Evidence and context.**

- PRD §11.2 Q7 already named the loan gap: a loan "is currently expressible only as repeated Roster Overrides (FR-31)".
- Addendum §9 already sketched the onboarding path (create account, then organization, type, teams, shift types, rotation, invite members, start scheduling).
- The spine's Deferred list already names the architectural cost of reminders: "it would need the schedule projected on the server, which AD-1 and AD-18 keep in the browser."

Items 1 and 2 share one root cause. Both need the schedule projected **outside the browser**: a calendar app fetches a feed with no browser session, and a reminder fires when nobody has the app open. That is the one architectural change this proposal turns on (§3.3).

### Hard constraints, stated for every story in Epics 16–19

1. **No new paid service and no new third-party provider.** Only what the stack already has: Supabase (Auth, Postgres, pg_cron, Edge Functions, Vault), the existing `notify` pipeline with Resend for email, and VAPID Web Push. Where something would truly need a paid service, it is a founder decision (§6) with a designed fallback that works without it.
2. **Security-sensitive points are founder decisions.** The feed URL is a bearer secret. Signup invites abuse. A self-provisioned organization must be as isolated as an operator-provisioned one. No surface may become an enumeration oracle. Each is listed in §6 with a recommended default.
3. **PRD §6 non-goals hold.**
   - **DI-8:** nothing pilot-specific or fire-specific is added anywhere.
   - **SM-C3:** the onboarding wizard pre-fills nothing pilot-shaped. No four teams, no four-slot pattern, no 12-hour day/night shifts, no `Dan`/`Noć` bands, no templates by Organization Type.
   - **Not a communication tool:** a reminder concerns only the receiving Member's own schedule.
4. **One canonical implementation (NFR-19, AD-7).** Server-side projection runs the same `@shift/domain` package as the browser. It is never a second implementation in SQL or in a function.

### Decisions taken in this session (2026-11-20, headless; product choices, ratifiable at review)

- **D1, feed scope.** The feed carries only the subscribing Member's own working shifts: those where they are at work (their Shift Roster after Overrides and Loans, minus dates they are absent). It carries no leave, no Absence Type, no other Member, no hours, no reason and no Organization address. *Rationale:* the URL ends up stored at Google or Apple. Anything in it leaves the product's control, and an Absence Type can be health data (NFR-5).
- **D2, feed window.** It covers the past 31 days and the next 182 days, recomputed on every fetch. *Rationale:* that is enough for "what did I work last month" and the next half year, and it keeps the response small. Nothing is persisted (AD-1).
- **D3, print.** Print is the browser's own print of a dedicated print layout of the Calendar month, under the current filter and the viewer's own visibility. No PDF library and no server. *Rationale:* zero new dependencies. The Calendar's glyphs already carry no-colour signals (NFR-25), so a black-and-white print reads.
- **D4, reminder model.** Reminders are opt-in and off by default. A Member picks at most two lead times from a fixed list: 1 h, 2 h, 3 h, 6 h, 12 h before the shift starts, or "the evening before at 20:00" in the Organization timezone. They are delivered on the Member's existing channels (FR-65). Push is the recommended channel, and email reminders need their own switch (D-S6). *Rationale:* a fixed list avoids a free-form scheduler. The evening-before option answers "the day before" without a 03:00 reminder for a 07:00 shift. Off by default keeps the "not a communication tool" posture.
- **D5, reminder freshness.** A reminder is computed from the schedule as it stands at most 15 minutes before it is due. One already sent is never retracted. A shift changed after its reminder is covered by the existing FR-62 change notification. *Rationale:* generating reminders close to send time keeps them correct without a cancel path.
- **D6, loan semantics.** A Loan lends one Member to one other Team for an inclusive date range. On those dates the Member's effective Team is the loan Team: they leave the home Team's Shift Rosters and join the loan Team's, and Roster Overrides still apply on top. The home Team (FR-18) is unchanged, and the Member returns automatically after the range. A Loan is an Exception: stored, attributable, removable, and it never touches a Rotation (DI-2). Loans of one Member never overlap. *Rationale:* this is exactly the repeated-Roster-Override pattern of Q7 made first-class. It needs no new derivation paradigm, only a per-date effective-team input to roster derivation.
- **D7, loans are Admin-only.** A Member cannot request a loan. *Rationale:* "Members propose; admins decide" is about the Member's own leave and shifts, and a loan is staffing. Keep the surface small and revisit if the pilot asks.
- **D8, the founding Admin signs in with a verified email.** A self-signed-up founding Admin's credential is their verified email address and password, and they can reset their own password by email. Every account an Admin creates afterwards keeps the existing username identity (AD-12). *Rationale:* without this, a single founding Admin who forgets their password has nobody to reset it except the operator, which defeats self-service. Supabase Auth's built-in email confirmation and recovery do it with no new provider.
- **D9, the wizard is a guided path over existing surfaces.** Each step embeds the shipped write path (Organization settings, Hour Bands, Leave Year, Teams, Shift Types, Rotation, Members), so there is no second implementation. Every step after "create the organization" can be skipped and resumed. Nothing is pre-filled: no Teams, Shift Types, Pattern or Hour Bands, and no Leave Year start selected. The only things a new Organization gets are what the shipped product gives every Organization (the annual-leave Absence Type of FR-74). *Rationale:* SM-C3 and DI-8. The wizard's speed comes from guidance and the live coverage preview, not from defaults.
- **D10, Organization Type in signup.** The founder enters it as the same descriptive label the operator sets today. It drives no template, default or branch (FR-7). Templates by Organization Type, mentioned in addendum §9, stay out (§6 non-goal). *Rationale:* SM-C3 and SM-C4.
- **D11, timezone and locale in signup.** The timezone is proposed from the browser's own zone, shown, and confirmed by the user. That is the user's data, not a product default. The locale is the one complete shipped locale (NFR-8), shown read-only. Both are then fixed in the application as today (FR-8). *Rationale:* FR-8's "operator action to change" stays true, and nothing is defaulted from the pilot.

## 2. Checklist Record

| Item | Status | Finding |
|---|---|---|
| 1.1 Triggering story | [N/A] | Not a story. It is a scope decision after Epic 15 |
| 1.2 Core problem | [x] | New stakeholder requirement: a v2 scope expansion of four §7.2 items |
| 1.3 Evidence | [x] | The founder's approval (2026-11-20), PRD §11.2 Q7, addendum §9, and the spine's Deferred entries for reminders and claim-code identity |
| 2.1 Current epic | [N/A] | Epics 1–15 are done. Open retro items (Epic 14 A2, A7, A10; Epic 15 A1, A2) are unaffected |
| 2.2 Epic-level changes | [x] | Four new epics, 16–19 |
| 2.3 Remaining epics | [x] | None were planned. Epics 16–19 build on shipped surfaces (Calendar, *Obavijesti*, *Što se mijenja*, the `notify` outbox, provisioning) |
| 2.4 Invalidated or new epics | [x] | Nothing is invalidated. Loans change roster derivation, so every surface that reads rosters (hours, conflicts, staffing, swaps, export, history) inherits them through `@shift/domain` |
| 2.5 Order | [x] | 16 → 17 → 18 → 19 (§4.2). 17 reuses 16's server-side projection. 19 is independent of 16–18 but carries the most security risk, so it goes last |
| 3.1 PRD | [!] | §5.1 description, FR-2, FR-5, FR-8, FR-18 out-of-scope, §5.9 out-of-scope, FR-62, FR-65, new §5.21–§5.24 with FR-80 to FR-101, glossary, §6, §7.1, §7.2, NFR-27 to NFR-30, §11.2 Q7 and Q8 and new Q12–Q14, §12. **Applied in this branch** |
| 3.2 Architecture | [!] | Server-side projection (AD-1 scope note, AD-7, AD-14, AD-18). Feed token (AD-9, AD-10). Loans (AD-2, AD-5). Signup (AD-10, AD-12, AD-16, AD-17). Deferred list (§5.4). **Architect pass before 16.2 and before 19.1** |
| 3.3 UX | [!] | New surfaces: calendar subscription, print layout, reminder settings, loan dialog, signup, verification, create-organization, wizard. UX-DR54 to UX-DR61 (§5.5) |
| 3.4 Other artifacts | [!] | SPEC package (new CAP-25 to CAP-28, non-goals, Q26 to Q30, engine rules R11 and R12), `epics.md`, `sprint-status.yaml`, `hr.json`, DEPLOY.md (signup config, Auth SMTP, two new functions, cron jobs), `supabase/config.toml`, e2e |
| 4.1 Direct adjustment | Viable | It adds epics and touches no shipped epic's correctness |
| 4.2 Rollback | Not viable | Nothing to roll back |
| 4.3 MVP review | [x] | v1 is unchanged and goes live. This is v2, built after or alongside the pilot |
| 4.4 Path | [x] | Direct adjustment, as a post-v1 expansion (§4) |
| 5.x Proposal components | [x] | This document |
| 6.x Approval and handoff | [!] | Scope approved. §6 founder decisions pending ratification |

## 3. Impact Analysis

### 3.1 Epic impact

- **Epics 1–15** stay done, and no acceptance criterion is reverted.
- Story **18.1** changes roster derivation in `@shift/domain`, so hours (FR-40), Conflicts (FR-47), Short-staffed Shifts (FR-71), swaps (FR-66) and the export (FR-42a) follow a Loan through the same canonical functions. Existing tests stay green, because a Member with no Loan derives exactly as before. That property is asserted in 18.1.
- Story **19.1** changes `supabase/config.toml` `[auth] enable_signup` and turns on email confirmations. The config comment at lines 44–57 ("There is no open signup anywhere in this system") is rewritten with it, and `test/supabase-scaffold.test.ts` assertions change in the same PR.
- **New:** Epics 16–19 (§5.6).

### 3.2 Artifact conflicts

| Artifact | Conflict |
|---|---|
| SPEC (`specs/spec-shift/`) | Canonical for `epics.md`, so it is edited first, after ratification. Non-goals change: "No calendar surfaces beyond the monthly view" (print and feed allowed), "Not a communication tool" (adds own-shift reminders), "No self-service commerce" (signup allowed, commerce still out), and "No multi-membership" (a Loan is not membership). Open question "temporary loan" is answered. New CAP-25 to CAP-28, Q26 to Q30, engine rules R11 (loans) and R12 (at-work selection for feed and reminders) |
| PRD | See §5.2. Applied in this branch |
| Architecture | See §5.4. The weighty amendments: the domain package runs in an Edge Function (AD-7, AD-14), two new functions (AD-14, AD-17), reminders as the one notification no request asserts (AD-18), and a second identity kind (AD-12) |
| UX | See §5.5. Eight new or extended surfaces. No change to the visual system (Epic 15 glass) beyond a print stylesheet |
| i18n | New `hr.json` namespaces: `feed`, `print`, `reminders`, `loans`, `signup`, `onboarding`. Supabase Auth email templates (confirm, recovery) in Croatian, from the locale resource (L4) |
| Tests / e2e | A self-provisioned fixture organization joins `test/rls-isolation.test.ts`. A Deno parity suite for the domain package. ICS golden files across both DST transitions |
| Ops | DEPLOY.md gains: Auth SMTP via the existing Resend domain, signup and confirmation settings per environment, hosted Auth rate limits, two new functions and their secrets, two cron jobs (reminders, account housekeeping), and an operator suspend script |

### 3.3 Technical impact (summary)

**The one paradigm question: projection outside the browser.** AD-1 forbids persisting anything derived. It does not forbid deriving on the server. The spine has kept projection in the browser because nothing needed it elsewhere. Items 1 and 2 now do.

The answer that keeps AD-1, AD-7 and NFR-19 intact is to run `@shift/domain`, which is pure, has no runtime dependency and is plain ESM TypeScript, inside an Edge Function under Deno. The function feeds it the same asserted facts the browser reads. Nothing derived is stored. A parity test asserts that the Deno build and the browser build return identical results for both fixtures.

**The read-set risk.** The browser assembles its domain inputs through several PostgREST reads. A second assembly on the server would be a second implementation of the read layer. Story 16.2 resolves it with one `SECURITY DEFINER` SQL function, `member_schedule_inputs(member, from, to)`. It returns the asserted rows a member's projection needs and nothing derived. The server uses it, and a test proves that it and the browser's reads yield equal projections.

**New tables**, all organization-scoped, with RLS, `organization_id` first, and audit triggers (AD-3, story 14.1 pattern):

- `calendar_feed_tokens`: member, token **hash**, created, revoked, last fetched. At most one live token per member.
- `reminder_settings`: member-owned, holding up to two lead codes.
- `team_loans`: an Exception row with member, loan team, from, to, AD-11 attribution, and an exclusion constraint against overlap per member.
- No new table for organizations: signup writes the existing `organizations` and `members` rows through one RPC.

**New functions:**

- **Edge Function `calendar-feed`:** public (`verify_jwt = false`). It holds the **publishable key only**, reads through one anon-callable token RPC, and returns `text/calendar`.
- **Edge Function `remind`:** cron-invoked with an invoke secret. It holds the secret key and writes only `notification_outbox` rows through a `service_role`-only RPC, keyed for at-most-once.
- **SQL `create_organization(...)`:** `SECURITY DEFINER`. It acts only on `auth.uid()`, requires a confirmed email and no existing membership, and creates the Organization and its founding Admin in one transaction under the existing zero-admins trigger.

**Configuration:**

- Supabase Auth signup opens with confirmations on, Auth email goes over SMTP through the existing Resend domain, and the hosted rate limits are set explicitly.
- Two pg_cron jobs are added: `remind` every 5 minutes, and housekeeping daily.

**Client:**

- the print route and stylesheet;
- the subscription surface;
- reminder settings;
- the loan dialog and marks;
- the signup routes and the wizard shell.

No new npm runtime dependency is expected. If 16.4 wants an ICS serializer, it writes the small RFC 5545 subset by hand under golden-file tests rather than adding a package.

## 4. Recommended Approach

**Direct adjustment, as a post-v1 expansion.** Add Epics 16–19 after Epic 15. Update the SPEC, epics and architecture first, after the §6 ratification, so every story starts from a written requirement. Nothing is rolled back.

- **Rationale:** each item sits on the engine's separation of rule, projection and exceptions.
  - A feed and a reminder are reads of the projection, delivered elsewhere.
  - A Loan is an exception that changes who is on a roster for a range, the first-class form of what Roster Overrides already do.
  - Signup is the operator's provisioning transaction, made callable by a verified stranger under the same constraints.
  - Only the first two need an architectural move, and it is a placement move (where the pure package runs), not a paradigm change.
- **Effort:** about 22 stories, roughly Epics 9 and 10 together.
- **Risk:**
  - **High, Epic 19:** public signup is the product's first unauthenticated write path and its first exposure to strangers. Abuse, enumeration and isolation all live here. It needs an Architect pass and a security review before production.
  - **Medium, Epic 16:** the domain package in Deno, and a bearer-secret URL. ICS behaviour differs across Google and Apple: Google refreshes a subscription only every several hours to a day, and the product cannot change that.
  - **Medium, Epic 17:** a server job that writes notifications nobody asserted (the AD-18 exception), plus email volume against the Resend plan.
  - **Medium, Epic 18:** roster derivation changes under every figure. It is mitigated by "no loan ⇒ identical output" over both fixtures.
- **Timeline:** independent of pilot go-live. Each epic ships on its own. 16.1 (print) needs no Architect pass and can ship first.

### 4.1 Why not the alternatives

- **A downloadable `.ics` file instead of a feed.** It needs no server projection, but it goes stale the moment the rota changes. The founder asked for a subscription. It is rejected as the primary path, though story 16.5 keeps "download this month as .ics" as a by-product of the same serializer.
- **Persisting a materialized schedule for the feed and reminders.** It violates AD-1, and the spine's "Materialization for scale" deferral is about performance, not this. Rejected.
- **Generating reminders inside `notify`.** It would turn the sender into a place that computes domain answers, which AD-18 exists to prevent. A separate `remind` function keeps `notify` a dumb sender. Rejected.
- **Claim-code identity for signup** (the spine's Deferred alternative). It solves member onboarding, not organization creation, and does not address the founding Admin's recovery. Not adopted. It stays deferred.

### 4.2 Recommended order

1. **Epic 16, calendar feed and print.** It is the highest member value with no pilot risk. 16.1 (print) ships first and needs no architecture pass. 16.2 establishes server-side projection, which 17 reuses.
2. **Epic 17, reminders.** Small once 16.2 exists, and a natural extension of the shipped `notify` pipeline.
3. **Epic 18, loans.** It answers the pilot's Q7, is domain-heavy with low external risk, and the feed and reminders inherit it automatically through `@shift/domain`.
4. **Epic 19, self-service signup.** Highest security risk and no pilot value. Last, after its Architect pass and security review. Production opening is the separate decision D-S5.

The order 18 → 16 → 17 → 19 is equally valid if the pilot presses for loans first. Epic 18 depends on no §6 decision and needs no Architect pass beyond the AD-2/AD-5 rows that story 18.2 applies.

---

## 5. Detailed Change Proposals

### 5.1 SPEC package (`specs/spec-shift/`), applied after ratification

**SPEC.md, Non-goals.**

- **OLD:** "**No calendar surfaces beyond the monthly view.** No weekly or daily views, drag-and-drop editing, print layout, or iCal feeds. Re-confirmed out of v1 on 2026-10-10."
- **NEW:** "**No calendar surfaces beyond the monthly view, its print layout and a member's own read-only feed.** No weekly or daily views, drag-and-drop editing, two-way calendar sync, or import from external calendars (CAP-25)."
- **OLD:** "**Not a communication tool.** Notifications tell a member about their own schedule and their own requests, and tell an admin what waits for a decision (CAP-20). No messaging, chat, broadcast, announcements, or SMS."
- **NEW:** "**Not a communication tool.** Notifications tell a member about their own schedule and their own requests, remind them of their own upcoming shifts if they ask (CAP-26), and tell an admin what waits for a decision (CAP-20). No messaging, chat, broadcast, announcements, or SMS."
- **OLD:** "**No self-service commerce.** Organizations are operator-provisioned. No signup wizard, billing, subscriptions, or payment processing."
- **NEW:** "**Signup without commerce.** An organization may be created by a verified stranger through signup (CAP-28) or by the operator. No billing, plans, trials, payment processing, or onboarding templates. Onboarding pre-fills nothing."
- **OLD:** "**No multi-membership.** One member in at most one team; one user in exactly one organization. No multi-site or sub-organization hierarchy."
- **NEW:** append "A Loan (CAP-27) moves a member's effective team for a date range; it is an exception, not a second membership."

**SPEC.md, Capabilities: add.**

- **CAP-25 — My shifts in my phone's calendar, and the month on paper.**
  - **intent:** A member subscribes their phone's calendar to their own shifts, and anyone prints the month they see.
  - **success:**
    - A member creates a personal feed URL, adds it to Google or Apple Calendar, and their at-work shifts appear with correct times in the organization's timezone across DST.
    - The feed holds only their own working shifts: no leave, absence type, other member or hours.
    - The URL is a revocable secret, stored only as a hash. A revoked or unknown token answers exactly as a never-issued one.
    - The month prints legibly in black and white under the current filter and visibility.
- **CAP-26 — Shift reminders.**
  - **intent:** A member who asks for it is reminded of their own upcoming shift.
  - **success:**
    - Opt-in, with at most two lead times from a fixed list.
    - Delivered on the member's existing channels.
    - Computed by the canonical projection at most 15 minutes before due, sent at most once per shift, lead and channel.
    - Never about anyone else.
- **CAP-27 — Temporary loan to another team.**
  - **intent:** An admin lends a member to another team for a date range, and the schedule, hours and warnings follow without repeated roster overrides.
  - **success:**
    - On loan dates the member is on the loan team's rosters and off the home team's.
    - Overrides still apply.
    - The rotation is untouched.
    - Loans never overlap per member, are attributable and removable, and show before saving their double booking, rest gap, short-staffed and override consequences (warn, never block).
    - With no loan, every derivation is byte-identical to before.
- **CAP-28 — Self-service organization signup.**
  - **intent:** A stranger creates an account, verifies their email, creates an organization, and is guided through setting it up.
  - **success:**
    - Email verification precedes any organization.
    - One account founds at most one organization.
    - The new organization is isolated exactly as an operator-provisioned one, and the wizard pre-fills nothing.
    - Signup, verification and recovery answer identically whether or not an address is known.
    - Signup is rate-limited and has a global circuit breaker.

**quality-requirements.md: add.**

- **Q26.** A bearer-secret URL is stored only as a hash, revocable by its member and by an admin, revoked on deactivation, never logged in full, and indistinguishable when invalid.
- **Q27.** Server-side projection runs the canonical domain package. A parity test proves it equals the browser's for both fixtures.
- **Q28.** No signup, verification, recovery or organization-creation response reveals whether an address, account or organization exists.
- **Q29.** A self-provisioned organization passes the same isolation suite as an operator-provisioned one. An authenticated account with no organization reads and writes nothing.
- **Q30.** Signup is rate-limited per address and per network, and the number of organizations created per day has a configured ceiling.

**engine-rules.md: add.**

- **§11, Loans.**
  - R11.1: effective team(member, date) = loan team if a Loan covers the date, else the home team.
  - R11.2: the base Shift Roster of team T on date d = active members whose effective team on d is T. Roster Overrides then apply as R-existing.
  - R11.3: Loans of one member never overlap. A Loan to the member's own home team is refused.
  - R11.4: with no Loan, R11.2 equals the existing roster rule exactly.
  - R11.5: a Loan never changes a Rotation Assignment or a team membership.
  - R11.6: worked example on the pilot fixture. Member of Team A lent to Team C for 10.–12.: A's rosters on those dates lose them, C's gain them, their hours follow C's Shift Types, and the 13th is A again.
- **§12, At-work selection.**
  - R12.1: a member's at-work shifts on d = working Scheduled Shifts whose roster includes them, minus the date if they hold a full-day Leave Record of any type.
  - R12.2: a Half-day Record keeps the shift with the worked half's interval.
  - R12.3: the feed and reminders read R12 only.

**glossary.md: add** Loan, Calendar Feed, Feed Token, Shift Reminder, Founding Admin. Mirror the PRD glossary entries in §5.2.

### 5.2 PRD (`prds/prd-shift-2026-09-01/prd.md`), **applied in this branch**

Every change is marked "(added 2026-11-20, sprint-change-proposal-2026-11-20-v2-scope)" or "(changed 2026-11-20, …)".

| Where | Change |
|---|---|
| Front matter | `updated: 2026-11-20` |
| §2.2 Non-Users | "Users belonging to more than one organization" stays. A Loan is not membership, which is noted |
| §3 Glossary | Add **Loan**, **Calendar Feed**, **Feed Token**, **Shift Reminder**, **Founding Admin**. Amend **Shift Roster** and **Team** for the Loan |
| §5.1 Description | Organizations are operator-provisioned **or** created through self-service signup (§5.24) |
| FR-2 | The "No user-facing surface allows creating an Organization" consequence becomes "Outside signup (§5.24), …". The out-of-scope line keeps billing, plans and trials and drops "self-service organization signup" |
| FR-5 | Member-owned writes add their own Feed Token and their own reminder settings |
| FR-8 | Timezone and locale are set at provisioning **or at signup**, then fixed in the application as before |
| FR-18 | The out-of-scope line keeps "simultaneous membership of multiple Teams". The temporary loan moves to §5.23 |
| §5.9 | The out-of-scope line drops "print layout; iCal or calendar-subscription feeds" (now §5.21) and keeps weekly/daily views and drag-and-drop |
| FR-62 | Adds "when they are lent to another Team, or a Loan of theirs changes". The "Shift reminders … out of v1" consequence is replaced by a pointer to §5.22 |
| FR-65 | Adds the reminder settings pointer (FR-85) |
| **New §5.21** Calendar Feed and Print | FR-80 personal feed URL · FR-81 feed contents are own-only and minimal · FR-82 revoke and regenerate · FR-83 the feed is correct in time · FR-84 print the month |
| **New §5.22** Shift Reminders | FR-85 reminder settings · FR-86 reminder delivery · FR-87 reminders are only about the member's own shifts |
| **New §5.23** Team Loans | FR-88 lend a Member · FR-89 a Loan derives rosters, hours, conflicts and staffing · FR-90 consequences before saving · FR-91 amend, end early or remove · FR-92 Loans are visible |
| **New §5.24** Self-service Signup and Onboarding | FR-93 create an account · FR-94 create an Organization · FR-95 Founding Admin sign-in and recovery · FR-96 onboarding wizard · FR-97 nothing is pre-filled · FR-98 signup abuse limits · FR-99 nothing is enumerable · FR-100 self-provisioned isolation · FR-101 operator controls |
| §6 | Communication bullet adds own-shift reminders. New bullets: "not a calendar platform" (read-only own feed, no sync or import), "not a self-serve commerce product" (no billing, plans, trials or templates; onboarding pre-fills nothing) and "a Loan does not become multi-membership" (never across Organizations). The permission-system bullet notes that a Founding Admin is an ordinary Admin |
| §7.1 | Adds a "v2 (added 2026-11-20)" paragraph |
| §7.2 | Removes the four items. Keeps weekly/daily views, drag-and-drop, billing, onboarding templates, multiple Teams per Member, two-way sync, SMS, native apps and the other re-confirmed items |
| §8 | NFR-27 bearer secrets · NFR-28 server-side projection parity · NFR-29 signup abuse and anti-enumeration · NFR-30 self-provisioned isolation |
| §11.2 | Q7 answered (§5.23). Q8 notes that signup keeps one account per Organization. New Q12 (housekeeping retention), Q13 (Google refresh lag acceptable?), Q14 (who may loan across Organizations: never) |
| §12 | New assumptions for the reminder lead list (D4) and the feed window (D2) |

### 5.3 Epics (`epics.md`), applied after ratification

- **Requirements Inventory:** add CAP-25 to CAP-28, Q26 to Q30, UX-DR54 to UX-DR61. Extend the FR Coverage Map so each new CAP maps to exactly one epic (CAP-25 → 16, CAP-26 → 17, CAP-27 → 18, CAP-28 → 19).
- **Epic List:** add Epics 16–19 (§5.6). Overview line: "Epics 16–19 were added on 2026-11-20 by `sprint-change-proposal-2026-11-20-v2-scope.md` (v2 scope)."
- **Story bodies:** written in full in the established format (As a / I want / So that, Depends on, Given/When/Then) when the epic is planned. Every story that changes a surface updates DESIGN.md, EXPERIENCE.md and the UX-DR lines in the same PR.
- **`sprint-status.yaml`:** add `epic-16` … `epic-19` and each story key in §5.6 as `backlog`, plus `epic-N-retrospective: optional`, each with a comment naming this proposal.

### 5.4 Architecture (`ARCHITECTURE-SPINE.md`), applied by the Architect pass or the first story that needs each row

| AD | Amendment | Applied with |
|---|---|---|
| AD-1 | Add a scope note: "Derivation may run on the server, in an Edge Function, using the same domain package; it is still never persisted (AD-7, Q27)." The rule itself is unchanged | Architect pass, before 16.2 |
| AD-7 | The domain package is consumed by the SPA **and** by Edge Functions under Deno. It stays dependency-free. A Deno build or import map is part of the package's contract, and a parity test runs both fixtures through both runtimes | 16.2 |
| AD-14 | Exactly **four** Edge Functions: `admin-auth` (AD-16), `notify` (AD-18), `calendar-feed` (public; publishable key only; reads through one anon token RPC; projects with the domain package; writes only `last_fetched_at`), and `remind` (cron-invoked with an invoke secret; projects due shifts; writes only outbox rows through a `service_role`-only RPC). A fifth amends this AD again | 16.4, 17.2 |
| AD-17 | The secret key lives in `admin-auth`, `notify` and `remind`. `calendar-feed` must never hold it, and a key-hygiene test asserts that | 16.4, 17.2 |
| AD-18 | Add the one exception: "A **shift reminder** is the only notification no request asserts. `remind` writes it from the canonical projection, as codes and operands, keyed `(code, subject, recipient, channel)` where subject is a deterministic UUID of (member, date, team, lead), so it is at most once." The Deferred entry "Shift reminders" is resolved | 17.2 |
| AD-9 / AD-10 | New `SECURITY DEFINER` RPCs, each named here: `calendar_feed_inputs(token)` (anon; hashes the token, resolves one member, returns only R12 inputs), `member_schedule_inputs` (definer; used by both functions), `create_organization(...)` (authenticated; acts only on `auth.uid()`). A member-owned row pattern covers `reminder_settings` and the token's create and revoke. An account with no `members` row has no organization claim and reads zero rows: already true (config note on the hook), and now asserted for every table and RPC (Q29) | 16.3, 17.1, 19.1, 19.3 |
| AD-2 | New rows: **Loan**, an exception (date-ranged, like a Leave Record, never versioned). **Reminder settings** and the **Feed Token**, current-state member-owned settings that feed no derivation | 18.2, 17.1, 16.3 |
| AD-5 | A Loan's save, amend or removal runs the erasure diff. Roster Overrides on covered dates whose target member is no longer on that roster are surfaced for review, as a rotation change does | 18.3 |
| AD-12 | A **second identity kind**: a Founding Admin created by signup signs in with their verified email. Every account an Admin creates keeps the synthesized-address identity. The sign-in form accepts an email address in place of organization and username. Email recovery is available only to email identities (Supabase Auth recovery, identical response either way). `admin-auth`'s `updateUserById`/`resetPassword` must not rewrite an email identity's address to a synthesized one | 19.3 |
| AD-16 | Unchanged in shape. `create_organization` lives in SQL, not in `admin-auth`, because it needs no secret key and is expressible as one definer transaction. A review confirms `clearMustSetPassword` stays harmless for an account with no organization | 19.1 |
| Deferred | Resolve "Shift reminders". Keep "Claim-code identity" and "Multi-organization membership". Add "Onboarding templates by Organization Type (SM-C3; revisit only with a second-industry customer and an explicit SM-C3 review)", "Captcha on signup (D-S3)" and "Two-way calendar sync" | Architect pass |
| Stack | No new runtime dependency. The ICS subset is hand-written. If the Architect pass prefers a library, it is pinned per the stack rule (at least two weeks old) | 16.4 |

**Architect pass** (`bmad-architecture`, update intent): one before 16.2, covering AD-1, AD-7, AD-14, AD-17 and AD-18, and one before 19.1, covering AD-10, AD-12, AD-16 and the signup door, plus a security review (`security-review`) of 19.1–19.5 before production opening. This proposal supplies their wording.

### 5.5 UX (`ux-shift-2026-09-02/EXPERIENCE.md`, `DESIGN.md`), applied by each story

Croatian vocabulary is proposed here, and each story finalizes it in `hr.json`.

- **UX-DR54, calendar subscription** (*Više → Kalendar na mobitelu*).
  - **No feed yet:** one *Izradi poveznicu* button and one sentence on what it does.
  - **With a feed:**
    - the URL, masked by default, with *Kopiraj*;
    - *Dodaj u Google kalendar* and *Dodaj u Apple kalendar* (a `webcal://` link);
    - the last time a calendar fetched it (`zadnje preuzimanje {datum vrijeme}`, or `još nije preuzeto`);
    - *Izradi novu poveznicu*, with a warning that the old one stops working;
    - *Isključi*.
  - A fixed note reads: `Google kalendar osvježava pretplate rjeđe — promjene se mogu pojaviti i do dan kasnije. Shift je uvijek točan.`
  - A note on what the feed does not contain (leave, others) answers the privacy question before it is asked.
- **UX-DR55, admin view of feeds.**
  - The member detail shows `Kalendar na mobitelu: uključen / isključen` and *Isključi poveznicu*.
  - It never shows the URL.
- **UX-DR56, print** (*Kalendar → Ispiši*).
  - A print layout of the current month and filter:
    - A4 landscape;
    - header: Organization name, month, filter, `ispisano {datum vrijeme}`;
    - the legend.
  - Glyphs are used, not colour alone.
  - Each Member Role account sees only what their screen shows.
  - No navigation chrome.
- **UX-DR57, reminders** (*Više → Obavijesti → Podsjetnici*).
  - Off by default.
  - Up to two choices from `1 h prije`, `2 h prije`, `3 h prije`, `6 h prije`, `12 h prije` and `večer prije u 20:00`.
  - The channel each reminder will use, from the existing channel switches. With no channel available, it says so in words (FR-65).
  - The email-reminder switch is separate (D-S6).
  - **Reminder text:** `Sutra radiš: {smjena} {od}–{do}, {tim}` or `Za 2 h radiš: …`, linking to the day.
- **UX-DR58, loan dialog** (member detail → *Posudi drugom timu*).
  - Fields: team, date from, date to.
  - Then *Što se mijenja*, listing:
    - shifts gained and lost per date;
    - double booking on the boundary days;
    - the rest gap (as FR-26's figure);
    - Short-staffed Shifts in both Teams;
    - Overrides needing review.
  - One *Spremi*.
  - Amend, end early and remove use the same dialog.
- **UX-DR59, loan marks.**
  - **Calendar day detail and Team filter:** a loaned Member appears under the loan Team with `posuđen iz {tim}`, a glyph plus words (not colour alone).
  - **The Member's own schedule and Danas:** `u timu {tim} do {datum}`.
  - **The directory:** the home Team, plus `trenutno u timu {tim}` during a Loan.
  - **The hours explanation (FR-42b):** source `posudba`.
- **UX-DR60, signup.**
  - `/registracija`: email, password, an explanation that this creates a new organization (not joining one), and a link back to *Prijava*.
  - After submitting, one neutral screen: `Ako adresa može primiti poruku, poslali smo poveznicu za potvrdu.` The text is identical whether the address is new or known.
  - A resend control is rate-limited.
  - *Prijava* gains `Nova organizacija? Registriraj se` and accepts an email address in place of organization and username (D8).
- **UX-DR61, create organization and wizard** (`/postavljanje`).
  - **Step 1, organization:**
    - name;
    - slug (proposed from the name, editable);
    - Organization Type (free label, inert);
    - timezone (browser zone proposed and confirmed);
    - locale (read-only);
    - Leave Year start (required, nothing selected);
    - the Founding Admin's name and Leave Allowance (required, empty).
  - **Steps 2–7** each embed the shipped surface: Hour Bands, Teams, Shift Types, Rotation with the coverage preview, Members (credentials or invitation), done.
  - **Every step:**
    - a progress rail `korak 3 od 7`;
    - *Preskoči za sada*;
    - resumable from *Danas* through a card `Postavljanje: još 3 koraka` until finished or dismissed.
  - **Empty states** explain each concept with organization-neutral examples. Copy never mentions fire departments, `Dan`/`Noć`, four teams or 12 hours (DI-8, SM-C3). A test sweeps the onboarding namespace for those literals.
- **UX-DR31/32 (navigation):**
  - Member *Više* gains *Kalendar na mobitelu*.
  - *Obavijesti* gains *Podsjetnici*.
  - *Kalendar* gains *Ispiši*.
  - The admin member detail gains *Posudi drugom timu*.
- **UX-DR33:** new surfaces are subscription, print layout, reminders, loan dialog, signup, verification result, create organization, and the wizard shell. The count goes from 23 to 31.

### 5.6 New epics and stories

Ids follow `N.M` and split into `a`/`b` at spec time where a story is too large for one PR.

#### Epic 16: My shifts are in my phone's calendar, and the month prints

Luka adds one link to Google Calendar once, and his shifts are there next to his day job's meetings. When the rota changes, his calendar follows within the day. Damir prints October for the station noticeboard.

**Capabilities:** CAP-25 · **Governed by:** AD-1 (note), AD-7, AD-9/10, AD-14, AD-17 · **Proves:** Q26, Q27 · **Architect pass before 16.2** · **Decisions:** D-S1, D-S2

| Id | Story | Depends on |
|---|---|---|
| 16.1 | **The month prints.** A print layout of the Calendar month under the current filter and the viewer's visibility (UX-DR56). Browser print with no new dependency. Legible in black and white | — |
| 16.2 | **The domain package runs on the server.** `@shift/domain` imports under Deno in an Edge Function. `member_schedule_inputs` returns a member's asserted inputs. A parity suite proves Deno and browser projections, hours and R12 are equal for both fixtures. AD-7 and AD-1 notes applied | Architect pass |
| 16.3 | **Feed tokens.** `calendar_feed_tokens` holds a hash only, with at most one live token per member. A member creates, regenerates and revokes their own. An admin revokes any member's in their organization. Deactivation revokes. Audit rows hold no token material | 16.2 |
| 16.4 | **The `calendar-feed` function.** `GET /calendar-feed/{token}.ics` hashes the token and runs `calendar_feed_inputs`, then projects R12 for D2's window and emits an RFC 5545 calendar with VTIMEZONE. Stable UIDs per (member, date, team). SUMMARY is the Shift Type name and Team name, with nothing more. Unknown, revoked and deactivated tokens all get an identical 404 with identical timing class. `Cache-Control: private, max-age=900`. The token is never logged. Golden files cover both DST transitions and a midnight-crossing shift (DI-5) | 16.3 |
| 16.5 | ***Kalendar na mobitelu* in *Više*** (UX-DR54) and the admin's revoke (UX-DR55). Includes the Google and Apple steps, the refresh-lag note, and a "download this month as .ics" by-product | 16.4 |

#### Epic 17: A member who asks is reminded before their shift

**Capabilities:** CAP-26 · **Governed by:** AD-14, AD-17, AD-18 (amended) · **Proves:** Q25, Q27 · **Decisions:** D-S6

| Id | Story | Depends on |
|---|---|---|
| 17.1 | **Reminder settings.** A member-owned `reminder_settings` row holding up to two lead codes (D4), off by default, in *Obavijesti → Podsjetnici* (UX-DR57), with the email-reminder switch (D-S6). Not recorded in the change history, as with notification preferences (FR-78 amendment of 2026-11-16) | 16.2 |
| 17.2 | **The `remind` job.** pg_cron every 5 minutes invokes `remind`. It projects R12 for members with reminders on, over shifts whose reminder falls due in the next 15 minutes (D5), and writes outbox rows via a `service_role`-only RPC under the unique key. DST and midnight-crossing tests. Inactive and unassigned members get nothing. AD-14, AD-17 and AD-18 amended | 17.1 |
| 17.3 | **Delivery.** `notify` templates for the reminder codes (email and push) from the locale resource, linking to the day. Channel rules from FR-65 and D-S6. An e2e test with a fake clock | 17.2 |

#### Epic 18: A member is lent to another team for a while

Damir lends Ana from Team A to Team C for the week of the 10th. Her calendar, her hours and the staffing warnings of both Teams follow, and on the 17th she is back on A with nothing to undo.

**Capabilities:** CAP-27 · **Governed by:** AD-2, AD-3, AD-5, AD-11 · **Proves:** Q2, Q9, Q11

| Id | Story | Depends on |
|---|---|---|
| 18.1 | **The loan rule in the domain.** R11 in `domain/roster`: effective team per date. Hours, collisions, staffing and swap validity follow. "No loan ⇒ identical output" is asserted over both fixtures. R11.6 worked example | — |
| 18.2 | **`team_loans`.** An Exception row with attribution (AD-11), an exclusion constraint against overlap per member, refusal of a loan to the home team or an archived team, admin write and member read-own under RLS, and an audit trigger. AD-2 row applied | 18.1 |
| 18.3 | **An admin lends a member** (UX-DR58), with *Što se mijenja*: gained and lost shifts, double booking, rest gap, Short-staffed Shifts in both Teams (FR-72), and the AD-5 override review. The member is notified (FR-62) | 18.2, 11.2 |
| 18.4 | **Amend, end early, remove** a Loan through the same preview. Each is attributable and notified | 18.3 |
| 18.5 | **Loans are visible** (UX-DR59): calendar day detail and Team filter, the member's schedule and Danas, the directory, the hours explanation source, the export (follows rosters with no column change), and change-history wording | 18.3 |

#### Epic 19: An organization signs itself up

A security company finds Shift, signs up, verifies the email, names the company, and is walked through hour bands, teams, shift types and a rotation, seeing its coverage preview before inviting the first guard. Nobody at Shift was involved, and nothing was pre-filled.

**Capabilities:** CAP-28 · **Governed by:** AD-9, AD-10, AD-12 (amended), AD-16, AD-17 · **Proves:** Q28, Q29, Q30, SM-5 (a second-industry tenant without the operator) · **Architect pass and security review** · **Decisions:** D-S3, D-S4, D-S5, D-S7, D-S8

| Id | Story | Depends on |
|---|---|---|
| 19.1 | **The signup door opens safely** (staging only). <ul><li>`enable_signup` on, with confirmations required.</li><li>Auth email over SMTP through the existing Resend domain (D-S4), with Croatian templates.</li><li>Hosted rate limits set explicitly (D-S3).</li><li>A suite proves an authenticated, confirmed account with no organization reads and writes nothing in every table, every RPC, storage and all four functions.</li><li>`config.toml` comment and scaffold tests rewritten</li></ul> | Architect pass |
| 19.2 | **Create an account** (UX-DR60). `/registracija` with one neutral response for new and known addresses (Q28) and a throttled resend. Sign-in accepts an email (AD-12 amendment). Email recovery is for email identities only, with an identical response | 19.1 |
| 19.3 | **Create the organization.** `create_organization` RPC: confirmed email required, no existing membership, the Founding Admin as `admin` with the verified email as `members.email`, the slug rule from 0002 with neutral collision handling (D-S8), the global daily ceiling (D-S3), and the existing zero-admins trigger. The session refreshes so the hook stamps the claim. A self-provisioned fixture joins `rls-isolation.test.ts` (Q29) | 19.2 |
| 19.4 | **The onboarding wizard** (UX-DR61). Steps embed shipped surfaces. Skippable, resumable, with a progress rail and a Danas card. Tests: a fresh organization holds no Team, Shift Type, Pattern or Hour Band, nothing beyond FR-74's annual-leave type, and the onboarding namespace contains no pilot literal (SM-C3, DI-8) | 19.3 |
| 19.5 | **Housekeeping and operator controls.** A daily job deletes unconfirmed accounts after 7 days and confirmed accounts that never founded an organization after 30 days (D-S7). The operator gets suspend and unsuspend scripts (a suspended Organization's claim reads nothing) and an abuse query. DEPLOY.md runbook. The production opening checklist for D-S5 | 19.3 |

## 6. Founder decisions to ratify

Each has a recommended default (**bold**). Planning proceeds on the default. A story that depends on one does not start until it is ratified.

| Id | Decision | Recommended default | Why, and the fallback |
|---|---|---|---|
| **D-S1** | **The feed URL is a bearer secret.** What protects it? | **A 256-bit random token in the URL path, stored only as a SHA-256 hash.** <ul><li>At most one live token per member.</li><li>The member can regenerate it (the old one dies at once) or turn it off.</li><li>An admin can turn off any member's but never sees it.</li><li>Deactivation revokes it.</li><li>The token is never logged in full.</li><li>Served only over HTTPS.</li></ul> | A calendar app cannot send a session, so the URL itself must authorize. Hash-only storage means a database leak yields no working feeds. No expiry by default, because an expiring feed silently stops updating in the member's calendar. The alternative is a 365-day expiry with a renewal prompt |
| **D-S2** | **Feed contents.** | **Minimal: own at-work shifts only** (D1). Shift Type name, Team name, start and end in the Organization timezone. No leave, Absence Type, other Members, hours, Organization address or notes. Window: past 31 days, next 182 (D2) | Whatever is in the feed is copied to Google or Apple outside the product's control. Leave and Absence Type are excluded because a type can be health data (NFR-5). Alternative: add own leave as all-day events with the neutral word *odsutan*. Not recommended |
| **D-S3** | **Signup abuse controls.** | <ul><li>**Email verification before any organization exists.**</li><li>**Supabase Auth's built-in rate limits** (sign-ups and emails per hour per IP and per address), set explicitly in hosted config.</li><li>**One organization per account.**</li><li>**A global ceiling on organizations created per day** (default 20, an operator setting) that refuses with a neutral "try later".</li><li>**Daily housekeeping** (D-S7).</li><li>**No captcha at launch.**</li></ul> | Everything listed is built into Supabase or the database. A captcha needs a third-party provider. Supabase supports Cloudflare Turnstile and hCaptcha, both with free tiers, but each is a new third party, so it is not enabled. **Fallback, if abuse appears:** enable Turnstile's free tier (a config switch plus one widget), which would then need this decision revisited |
| **D-S4** | **Auth email delivery.** Supabase's built-in mailer is for development only and heavily rate-limited | **Use the existing Resend account and verified domain as Supabase Auth's custom SMTP.** No new provider | Verification and recovery emails count toward the Resend plan alongside notifications. **Cost risk:** if volume passes the current plan's included sends, that is a paid upgrade, which is a founder decision at that point. **Fallback without it:** signup stays staging-only, or volume is held under the ceiling of D-S3 |
| **D-S5** | **When public signup opens in production.** | **Not with the story.** Epic 19 ships to staging. Production opens only after a security review of 19.1–19.5, the D-S3 limits are verified on hosted config, and the founder says go | The pilot is live on the same production project. Opening the door is a production configuration change with abuse exposure, so it is its own decision |
| **D-S6** | **Reminder channels and volume.** | **Push for reminders by default.** Email reminders need a separate switch the member turns on. Reminders are off until the member opts in | At about 15 shifts a month with two leads, a 40-member organization could send 1,200 reminders a month. As email, that alone approaches typical free-tier limits. Push has no per-message cost. Members without push (no install, older iOS) can still opt into email |
| **D-S7** | **Deleting abandoned signups.** It is a deletion of data | **Delete unconfirmed accounts after 7 days, and confirmed accounts with no organization after 30 days.** Never touch an account that has a `members` row | These accounts hold an email and a password hash and nothing else. Keeping them forever is a liability with no use. Alternative: keep them and report them to the operator |
| **D-S8** | **Anti-enumeration.** | <ul><li>**Signup, resend, recovery and the email sign-in answer identically** whether an address is known or not (Supabase returns an obfuscated user on repeat signup with confirmations on, which 19.2 asserts).</li><li>**An unknown, revoked or deactivated feed token gives one identical 404.**</li><li>**`create_organization` is callable only after verification and rate-limited.** On a slug collision it proposes a suffixed slug without saying another organization holds the base.</li><li>**Slugs are not secret** (they are in sign-in links), but no surface lists them or answers "does it exist" to an anonymous caller</li></ul> | Prevents harvesting customer lists and member addresses |
| **D-S9** | **Tenant isolation for self-provisioned organizations.** | **No new isolation mechanism.** The organization claim comes only from the hook reading `members`. An account with no `members` row has no claim and reads zero rows. `create_organization` derives everything from `auth.uid()` and accepts no organization id. A self-provisioned fixture runs the full isolation suite. A suspended organization's claim reads nothing | Reusing the one proven mechanism (AD-10, NFR-1) is safer than a parallel path. The new risk is the org-less authenticated account, which 19.1 tests exhaustively |
| **D-S10** | **The Founding Admin's identity** (D8). | **A verified email with self-service email recovery.** Other accounts keep the username identity | Avoids an operator dependency for a lone Admin's lockout. The alternative keeps one identity kind, with the operator handling recovery |

## 7. Implementation Handoff

- **Scope:** Major.
- **Founder (now):** ratify §6 D-S1 to D-S10, or amend them. Ratification can be one line ("D-S defaults approved"), as on 2026-10-10.
- **PM / Product Owner (on ratification):**
  - apply §5.1 (SPEC) and §5.3 (`epics.md` with full story bodies, and `sprint-status.yaml`);
  - update the project memory note.
  - The PRD (§5.2) is already applied in this branch.
- **Architect** (`bmad-architecture`, update intent):
  - **pass 1 before 16.2:** AD-1 note, AD-7, AD-14, AD-17, AD-18;
  - **pass 2 before 19.1:** AD-10, AD-12, AD-16 and the signup door.
  - Both start from §5.4's wording. The AD-2 and AD-5 rows are applied by stories 18.2 and 18.3 without a pass.
- **UX:** UX-DR54 to UX-DR61 are drafted in §5.5. Each story finalizes its own in EXPERIENCE.md and DESIGN.md in the same PR. 19.4 (wizard) gets a UX review with mockups before its spec freezes, because it is the first surface strangers see.
- **Security:** a `security-review` of Epic 19's diff, and of 16.3–16.4, before each reaches production.
- **Developer** (`bmad-build`), per story: implement it, update the docs, and apply the §5.4 row the story names.
- **Ops:** DEPLOY.md sections for the two functions, two cron jobs, Auth SMTP, signup config, and the suspend script. Secrets go per environment, as in §8.2 today.

**Success criteria:**

- every new capability has a CAP and an FR before its first story starts;
- a member's Google Calendar shows their next shifts at the correct local times across a DST change, and shows nothing else;
- a revoked feed URL answers exactly like a made-up one;
- with reminders off, nobody receives one;
- with one lead on, exactly one reminder arrives per shift and channel;
- a Loan moves rosters, hours and staffing for its range, and with no Loan every figure is byte-identical to before (both fixtures);
- a stranger creates a verified organization that passes the isolation suite, and its fresh database holds no pre-filled configuration;
- no signup, recovery or feed response reveals whether an account, address or organization exists;
- `calendar-feed` holds no secret key.

## 8. Open risks

1. **Google Calendar refresh lag.** Google polls subscribed ICS feeds on its own schedule, typically every several hours and up to a day, and no server setting changes that. A member may see a stale shift in Google after a late change. Mitigations: the FR-62 change notification, the in-app note (UX-DR54), and the product as the source of truth. Apple Calendar allows a shorter refresh interval set by the user. (PRD §11.2 Q13.)
2. **Domain package under Deno.** `@shift/domain` is pure and has no dependencies, but it has only ever been built by `tsc` 7 for the browser. Module-resolution differences under Deno (extensions, `exports`) may need a small build adjustment. The parity suite (16.2) is the guard. Not yet verified, so 16.2 starts with a spike.
3. **Read-set drift.** `member_schedule_inputs` must stay equal to what the browser reads. A parity test covers today's inputs. A future rule kind (like Loans) must be added to both, and 18.2 is the first test of that.
4. **Email volume and cost.** Auth emails plus reminders through one Resend plan (D-S4, D-S6). Not measurable until signup is open. The D-S3 ceiling bounds it.
5. **Signup on the pilot's production project.** Opening signup changes hosted Auth config on the project the pilot uses. D-S5 keeps it a separate decision, and 19.1 asserts that existing username sign-in is unaffected.
6. **AD-12's second identity kind** touches `admin-auth`'s username-change and reset paths (the `USERNAME_NOT_RESTORED` runbook in DEPLOY.md). If an Admin edits a Founding Admin's username, the email identity must not be rewritten. That is an explicit 19.2/19.3 test.
7. **Resolved Q7 changes a domain function under every figure** (18.1). The "no loan ⇒ identical" property is the guard, and it needs to be asserted against both fixtures and the e2e month snapshots.

## 9. Planning status (added 2026-11-20, after scope approval)

The founder approved the scope and asked planning to continue without questions. §5.3 is therefore applied **ahead of** the §6 ratification: Epics 16–19 are written in full in `epics.md` (with CAP-25 to CAP-28, Q26 to Q30 and UX-DR54 to UX-DR61 in its inventory, taken from this proposal and the PRD until the SPEC is updated per §5.1), and every story is in `sprint-status.yaml` as `backlog`. The recommended defaults of §6 stand for planning only. Each story names its gates in `epics.md` (**Blocked on:**) and in `sprint-status.yaml` (`waits:`). No story with an open gate starts.

| Story | Waits for an Architect pass | Waits for D-S ratification | State |
|---|---|---|---|
| 16.1 The month prints | — | — | **Ready** |
| 16.2 The domain package runs on the server | Pass 1 (Deno/domain: AD-1 note, AD-7, AD-14, AD-17, AD-18) | — | Blocked |
| 16.3 A member's feed token is a revocable secret | Pass 1 (via 16.2) | D-S1 | Blocked |
| 16.4 The calendar feed serves a member's own shifts | Pass 1 | D-S1, D-S2, D-S8 | Blocked |
| 16.5 A member subscribes from *Kalendar na mobitelu* | Pass 1 | D-S1, D-S2 | Blocked |
| 17.1 A member chooses their reminders | Pass 1 (via 16.2) | D-S6 | Blocked |
| 17.2 The `remind` job writes reminders that fall due | Pass 1 | D-S6 | Blocked |
| 17.3 Reminders reach the member by push or email | Pass 1 | D-S6 | Blocked |
| 18.1 The loan rule in the domain | — | — | **Ready** |
| 18.2 A loan is a recorded exception | — | — | Ready after 18.1 |
| 18.3 An admin lends a member to another team | — | — | Ready after 18.2 (11.2 done) |
| 18.4 An admin amends, ends early or removes a loan | — | — | Ready after 18.3 |
| 18.5 Loans are visible wherever rosters are read | — | — | Ready after 18.3 |
| 19.1 The signup door opens safely on staging | Pass 2 (signup: AD-10, AD-12, AD-16, the door) | D-S3, D-S4, D-S9 | Blocked |
| 19.2 A stranger creates an account | Pass 2 | D-S3, D-S8, D-S10 | Blocked |
| 19.3 A verified account creates its organization | Pass 2 | D-S3, D-S8, D-S9, D-S10 | Blocked |
| 19.4 The onboarding wizard guides setup and pre-fills nothing | Pass 2 (via 19.1–19.3), plus a UX review with mockups | D-S9 | Blocked |
| 19.5 Abandoned signups are cleaned up and the operator keeps control | Pass 2 | D-S5, D-S7 | Blocked |

A `security-review` of 16.3–16.4 and of 19.1–19.5 precedes production in every case. Production opening of signup stays D-S5.


## Ratification (2026-11-21)

The founder accepted D-S1 to D-S10 at the recommended defaults ("D-S defaulti prihvaćeni"). D-S1 sub-choices from architect pass 1 are taken at their defaults: the feed token is stored as a plain SHA-256 hash that no role can read; Kong logs at `crit` so no token path is logged; a member with no team of their own may hold a live feed (they can be lent). D-S5 stands as written: signup ships to staging only, and production opens only on the founder's separate go after the security review.
