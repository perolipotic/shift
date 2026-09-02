---
title: Implementation Readiness — shift
verdict: PASS (re-assessed)
assessed: 2026-09-02
assessed_by: bmad-sprint-planning readiness gate
scope: 6 epics, 30 stories (epics.md)
---

# Implementation Readiness — shift

> **Re-assessed 2026-09-02 — now PASS.** Findings 1 and 3 were resolved by a `bmad-architecture` update that added `AD-16` (one privileged auth boundary, holding two clients so RLS and attribution survive) and `AD-17` (secret key confined to that function's environment). Findings 2 and 4 remain open as standing concerns; neither forces a developer to invent a decision, so neither blocks. `sprint-status.yaml` was generated after this re-assessment.

## Original verdict, retained for the record

**Verdict: FAIL.** The plan is not implementable as recorded. One finding is blocking and lands in Epic 1. Findings 2–4 would have been CONCERNS on their own.

## What passed

Artifact inventory is complete: brief, PRD + adopted addendum, SPEC + 5 companions, both UX spines, the architecture spine, and epics.md. Traceability is clean in both directions — all 17 capabilities, 23 quality requirements, 43 UX design requirements and 15 architecture decisions reach acceptance criteria, and no story is an orphan. Epics deliver user value, carry no forward dependencies, and create schema just-in-time.

---

## Finding 1 — CRITICAL — Privileged auth operations have no home

**Blocks:** Story 1.2, Story 1.5, Story 1.6.

`AD-9` states there is no server tier and clients write directly under RLS. `AD-14` states no SSR, no application server and no Edge Function in MVP. Four operations required by Epic 1 need the Supabase service role, which a browser client cannot hold:

| Operation | Story | Requires |
| --- | --- | --- |
| Provision an organization together with its first admin | 1.2 | `auth.admin.createUser` |
| An admin creates a member with admin-issued credentials | 1.5 | `auth.admin.createUser` |
| Admin-issued password reset | 1.5 | `auth.admin.updateUserById` |
| Deactivation "blocks authentication" | 1.6 | user ban / update |

Verified 2026-09-02: `admin.createUser()` requires the service role, must never be initialized client-side, and the documented alternative is an Edge Function calling it.

**Why it was missed.** The architecture run's adversarial lens hunted for two units diverging, and the reviewer checked ADs against one another. Neither asked whether a capability had *any* implementation path. `AD-12` and `CAP-1` were treated as settled inputs, and `AD-9` was decided later on the reasoning that the derived-conflict decision had removed the need for a write tier — true for domain writes, silently untrue for auth writes.

**Shape of the fix.** The privileged set is exactly four operations, so the amendment is narrow: admit one scoped privileged-auth function holding the secret, and state explicitly that it may perform no domain calculation, so `AD-7` and `Q8` remain intact.

**Alternative worth weighing for the deactivation row.** RLS with the fresh active-status helper (`AD-10`) already denies an inactive member every read, so they could authenticate and see nothing. That may be stronger in effect than blocking sign-in, but it is not what `CAP-4` and Story 1.6 say — adopting it is a spec reword, not a free pass.

**Fixed by:** `bmad-architecture` (update intent); then `bmad-spec` if `CAP-4`'s wording changes.

## Finding 2 — MEDIUM — Leave-day counting is contested, not missing

**Affects:** Epic 5. Epics 1–4 unaffected.

The spec records a definite rule — a Leave Day is a date on which the member had a working scheduled shift — so Story 5.1 is implementable as written. The user has stated a leaning toward calendar-day counting and explicitly deferred the decision. Under the pilot's rotation a member works two dates in four, so the two rules differ by roughly a factor of two in what a 30-day allowance is worth.

Because leave-day counting is a pure function in `packages/domain` with no stored figure depending on it (`AD-1`, `AD-7`), settling it later costs one function and no migration. The risk is building Story 5.1 against the wrong rule, not structural rework.

**Fixed by:** the decision itself, then `bmad-spec`.

## Finding 3 — LOW — Supabase API key model has changed

Legacy `service_role` keys are deprecated at the end of 2026 in favour of publishable and secret keys. The spine pins library versions but records nothing about key handling, while Story 1.1 stands up local, staging and production. This should be settled alongside Finding 1, since that is what introduces a secret-holding component.

**Fixed by:** `bmad-architecture`, in the same update.

## Finding 4 — LOW — `EXPERIENCE.md` still claims two save refusals

`EXPERIENCE.md` § State Patterns states that exactly two validations refuse a save "and only two". The spec, the spine and the epics all carry three: an hour-band gap or overlap, an offset outside the cycle, and an empty pattern. Already recorded as an open item in the spec memlog; `bmad-spec` cannot edit an adopted companion. A developer following `EXPERIENCE.md` alone would build one refusal fewer.

**Fixed by:** `bmad-ux`.

---

## Recommended order

1. ~~`bmad-architecture` — update intent: Findings 1 and 3.~~ **Done** — `AD-16`, `AD-17`; `AD-9` and `AD-14` amended in place; Stories 1.1, 1.2, 1.5 and 1.6 reconciled.
2. ~~`bmad-spec` — only if `CAP-4`'s wording changes.~~ **Not needed** — the chosen option keeps CAP-1 and CAP-4 literally true.
3. ~~`bmad-sprint-planning` — re-run the gate.~~ **Done** — PASS; tracking generated.
4. `bmad-ux` — Finding 4, any time before Epic 2 is built. **Still open.**
5. The leave-counting decision, then `bmad-spec` — before Epic 5. **Still open.**
