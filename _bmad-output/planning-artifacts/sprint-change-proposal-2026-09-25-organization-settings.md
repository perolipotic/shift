# Sprint Change Proposal — Organization type, timezone and locale are set at provisioning

- **Date:** 2026-09-25
- **Author:** Developer (correct-course workflow), for Perolipotic
- **Mode:** Batch
- **Status:** Approved 2026-09-25 (option a, batch) — applied on `feat/design-refresh`

## 1. Issue Summary

**What happened.** Design refresh C (branch `feat/design-refresh`) redesigned the Organization settings screen (`apps/web/src/routes/organizacija.tsx`). At the human's request it removed two fields from the admin's form:

- **Organization Type** (`Tip organizacije`). The human noted the field does nothing in the product.
- **Timezone** (`Vremenska zona`). It is now shown read-only in the screen's aside.

A save now writes both columns back unchanged, from the snapshot the form was seeded with. Nothing is lost, and nothing else changed in the write path.

**Conflict with the PRD.** FR-7 says "An Admin can set an Organization Type", and FR-8 says "An Admin can set the Organization's timezone and locale". The admin can now set neither in the application.

**A related gap that already existed.** The settings screen has never offered a locale control, since story 1.4a. FR-8's "an Admin can set the … locale" was therefore already unmet. It is folded into this correction, because the resolution is the same.

**How it was discovered.** While reviewing design refresh C for documentation follow-ups, before merge.

**Category.** A product decision taken during implementation, recorded retroactively. It is the same shape as #46 (fire rank and team position).

**Human decision (2026-09-25, option a).** Keep the change. The operator sets Organization Type, timezone and locale when the organization is provisioned. The admin sees the timezone read-only. Organization Type stays inert.

**Evidence.**
- `supabase/operator/provision-organization.sql` already takes `shift.organization_type`, `shift.organization_timezone` and the locale at provisioning (lines 43–44, 69–74). The operator path this decision relies on exists today.
- `organizacija.tsx` `submit()` passes `organization.organizationType` and `organization.timezone`, the stored values.
- `prijava.test.ts` pins the settings screen at one `<Input>` and four `<select>`s, with no type or timezone control.

## 2. Impact Analysis

### 2.1 Epic Impact

- **Epic 1 (done):** the goal text and Story 1.4 say that the admin configures timezone, locale and type. Both are amended. The epic stays done, and no story is reopened: the delivered behaviour is the amended behaviour.
- **Epics 2–6:** no impact. Every consumer reads the organization's timezone, never who set it. L8 ("every date and time in the organization timezone") is unchanged.
- **No epic becomes obsolete, no new epic or story is needed, and the order does not change.**

### 2.2 Story Impact

- **Current:** none. 2.3 is next and does not touch organization settings.
- **Future:** none. A future change of timezone or locale after provisioning is an operator action (see §3, risk).

### 2.3 Artifact Conflicts

**PRD.**
- FR-7 and FR-8 are reworded: the operator sets type, timezone and locale at provisioning, and the admin does not change them in the application.
- Their testable consequences gain one line each: a settings save never changes them.
- UJ-1's opening and the §5.2 description are aligned.
- DI-8 is unaffected. Type, timezone and locale are still Organization data, not code.

**Epics.**
- CAP-2 gains one clause.
- The Epic 1 goal (stated twice) is reworded.
- Story 1.4's "I want" line is reworded, and it gains one acceptance criterion.

**Architecture.** N/A. The spine never assigns the editing of these fields to the admin. AD-10 and AD-12 are untouched.

**UX (EXPERIENCE.md).** The `Organizacija` IA entry and UJ-1 are aligned.

**Implementation artifacts.**
- `sprint-status.yaml`: one note on the 1-4 entry.
- `deferred-work.md`: one entry, for the missing operator path to change these after provisioning.

### 2.4 Technical Impact

None. The code is already the amended behaviour. There are no migrations and no API changes.

## 3. Recommended Approach

**Direct Adjustment:** a documentation backfill, mirroring #46.

- **Rationale.**
  - The pilot is one Croatian organization, and its timezone and locale are fixed facts about it.
  - Organization Type is inert by FR-7, so an admin control for it offers nothing.
  - A timezone changed by mistake would silently move every date in the application (L8). Setting it once, at provisioning, removes that failure mode.
- **Effort:** low (documents only).
- **Risk:** low.
  - The one real gap: after provisioning, a timezone or locale correction needs an operator to run SQL by hand.
  - It is recorded in `deferred-work.md` as an operator script to add when a second organization, or a correction, needs it.
- **Timeline impact:** none.

## 4. Detailed Change Proposals

### 4.1 PRD (`prds/prd-shift-2026-09-01/prd.md`)

**UJ-1, sentence 3**

OLD:
> They set the organization's name, logo, timezone, and locale; define three Shift Types

NEW:
> They set the organization's name and logo — its timezone and locale were set when it was provisioned — define three Shift Types

**§5.2 Description, append**

NEW (appended):
> Organization Type, timezone and locale are set when the Organization is provisioned; an Admin sees the timezone but does not change any of the three in the application (human decision 2026-09-25, `sprint-change-proposal-2026-09-25-organization-settings.md`).

**FR-7**

OLD:
> An Admin can set an Organization Type, and it changes no scheduling behavior.

NEW:
> An Organization has an Organization Type, set when the Organization is provisioned, and it changes no scheduling behavior.

Consequence added:
> - Saving the Organization settings never changes the Organization Type; the Admin's settings surface offers no control for it.

**FR-8**

OLD:
> #### FR-8: Timezone and locale
> An Admin can set the Organization's timezone and locale.

NEW:
> #### FR-8: Timezone and locale
> An Organization's timezone and locale are set when the Organization is provisioned. An Admin sees the timezone on the settings surface and cannot change either in the application.

Consequence added:
> - Saving the Organization settings never changes the timezone or the locale; changing either after provisioning is an operator action.

The existing consequences (organization timezone everywhere, and locale switching with no deployment) stay as they are.

### 4.2 Epics (`epics.md`)

**CAP-2 (line 31)**

OLD:
> Identity, timezone, locale, leave year, logo.

NEW:
> Identity, timezone, locale, leave year, logo. Type, timezone and locale are set at provisioning; the admin configures identity, leave year and logo.

**Epic 1 goal (lines 201 and 252, identical text)**

OLD:
> An operator provisions an organization; an admin configures its identity, timezone, locale, leave year and branding, creates teams,

NEW:
> An operator provisions an organization with its type, timezone and locale; an admin configures its identity, leave year and branding, creates teams,

**Story 1.4, the user story**

OLD:
> I want to set my organization's name, type, timezone, locale, leave year and logo,

NEW:
> I want to set my organization's name, leave year and logo, and see the timezone it was provisioned with,

**Story 1.4, a new acceptance criterion (after the timezone one)**

> **Given** the organization settings surface
> **When** an admin saves it
> **Then** the Organization Type, timezone and locale are unchanged — they are set at provisioning — and the timezone is shown read-only beside the form (CAP-2)

### 4.3 UX (`ux-designs/ux-shift-2026-09-02/EXPERIENCE.md`)

**IA, line 45**

OLD:
> - *Organizacija* — Organization settings (identity, timezone, locale, Hour Bands, Leave Year, branding)

NEW:
> - *Organizacija* — Organization settings (identity, Leave Year, branding; the timezone shown read-only; Hour Bands reached from it). Type, timezone and locale are set at provisioning.

**UJ-1, line 163**

OLD:
> Sets identity, timezone, locale, and Hour Bands;

NEW:
> Sets identity and Hour Bands (timezone and locale came with provisioning);

### 4.4 Implementation artifacts

**`sprint-status.yaml`: a note above `1-4-an-admin-configures-the-organization-s-identity-localization: done`**

> # Amended 2026-09-25 by sprint change
> # (sprint-change-proposal-2026-09-25-organization-settings.md): Organization
> # Type, timezone and locale are set at provisioning; the settings screen
> # shows the timezone read-only (design refresh C). Status unchanged.

**`deferred-work.md`: a new entry**

> **Operator path to change an organization's timezone or locale after provisioning.**
> - Since 2026-09-25, the admin cannot change either in the application.
> - `provision-organization.sql` only creates.
> - A correction today is hand-written SQL.
> - Add an operator script, guarded like the demo seed, when a second organization or a correction needs it.

## 5. Implementation Handoff

- **Scope: Minor.** Direct implementation by the Developer agent, documents only, on `feat/design-refresh` together with design refresh C.
- **Success criteria:**
  - FR-7, FR-8, UJ-1, CAP-2, the Epic 1 goal, Story 1.4 and EXPERIENCE.md no longer say that the admin sets type, timezone or locale.
  - The sprint-status note and the deferred-work entry are present.
  - No code change.
