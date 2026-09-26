---
title: 'Story 3.3b: Filtering the calendar to one person'
type: 'feature'
created: '2026-09-26'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'c7bce92c4a97454b4a856110ee345075c757a7ad'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-3-3a-calendar-team-filter.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** *Sve smjene* can be narrowed to a team (3.3a) but not to a person (CAP-13). A member-role session reads only its own `members` row (since `0011`), so the calendar cannot name colleagues.

**Approach:** Migration `0017` adds `calendar_people()`, a narrow read of the names of the caller's colleagues who are active today. The snapshot reads every member's team membership versions, which RLS already allows. The existing filter Select gains a second group, *Osobe*. Choosing a person shows that person's day list, the same one *Moj raspored* draws, headed with their name. The user chose this shape: one Select, a day list, and only members active today.

## Boundaries & Constraints

**Always:**
- **Migration `0017_calendar_people.sql`:** `public.calendar_people()` returns `(id uuid, name text)` for every member of the caller's organization who is active on the organization's today (`member_active_on`, `organization_today`). It returns zero rows unless the caller is active. The claim and helper pins are copied from `team_roster`. It is `language sql stable security definer set search_path = ''`. Execute is revoked from `public`, `anon` and `service_role` and granted to `authenticated`. No other column leaves it, no policy changes, and 0011 is not edited.
- **Snapshot:**
  - `CALENDAR_COLUMNS` gains the organization-level embed `team_membership_versions(organization_id,member_id,team_id,effective_from)`.
  - `readCalendar` also calls `rpc('calendar_people')`, under the same `CALENDAR_KEY`, still one query. A call that is rejected, returns an error, returns data that is not an array, contains a malformed row or a duplicate id, or has a version naming another tenant, an unknown team or a repeated date for one member is `CALENDAR_UNAVAILABLE`.
  - `CalendarSnapshot.people` is `{ id, name, memberships }[]`, sorted by `compareText(name)` and then by id.
- **Search:**
  - `osoba=<member id>`: `calendarSearchOf` keeps any non-empty string.
  - `calendarSearchTo` keeps `osoba` on month and mode changes.
  - The filter change is `{ smjena: string | null; osoba: string | null }`, with both keys always present, so choosing one filter drops the other.
  - `calendarFilterChangeOf` maps the Select value. A person's option value is `osoba:<id>`, a team's option value stays the bare id, and `''` means every team.
- **Model (`month.ts`, pure):**
  - The chosen person is `osoba` only when it names one of `snapshot.people`. Otherwise it counts as no person.
  - A valid person takes precedence over `smjena`, and the team filter then reads `chosen: null`.
  - `CalendarFilter` gains `people` and `person` (an id or `null`).
  - `CalendarMonth.person` is `{ id, name, days: CalendarDayListOutcome } | null`, built by generalising `calendarDayListOf` over a memberships list. The viewer's `days` is unchanged.
  - With a person chosen, `columns` and `rows` are not narrowed. The screen draws the person instead of the grid.
- **Screen (`kalendar.tsx`):**
  - The label `kalendar.filter.label` becomes "Smjena ili osoba".
  - After the *Smjene* optgroup comes `<optgroup label={t('kalendar.filter.people')}>` ("Osobe"), rendered only when `people` is non-empty.
  - The filter row renders when there is at least one team or one person.
  - The reset shows while a team or a person is chosen and navigates `{ smjena: null, osoba: null }`.
  - With a person chosen in *Sve smjene*:
    - a heading with the person's name (data);
    - the legend and the `<ol>` day list, reusing `renderDay`;
    - when that person has no team all month, `kalendar.person.noTeam` = "{name} ovaj mjesec nije član nijedne smjene.";
    - the person's day-list failure shows the alert locally.
  - *Moj raspored* ignores `osoba` and keeps it in the URL.
  - The grid tab-stop key also includes the person.
- **Text:** the new keys go in `hr.json` and are registered in every inventory. `osoba` joins `SEARCH_PARAMETERS`.

**Ask First:** any policy change on `members` or version tables; showing rank or position; any change to *Moj raspored* or the grid's own layout.

**Never:** rank, position or inactive members as options; showing roster overrides (3.6 extends this); `localStorage`/`sessionStorage`; a second query key; new dependencies, render tests, or a custom listbox; any column beyond id and name from the function.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Person chosen | `osoba=<P>`, P active | P's day list headed "P"; Select reads P | N/A |
| Mid-month move | P moves team on the 15th | days 1–14 old team's type, 15+ new team's | N/A |
| No team this month | P has no version ≤ month end | `kalendar.person.noTeam` with the name | N/A |
| Unknown / inactive id | `osoba=<x>` | as if absent (grid, or the `smjena` team) | silently ignored |
| Both params | `smjena=<A>&osoba=<P>` | P's day list; team `chosen: null` | N/A |
| Choose team after person | Select → team A | `{smjena: A}`, `osoba` dropped | N/A |
| Month / mode change | `osoba=<P>` | `osoba` kept | N/A |
| Reset | `osoba=<P>` | neither `osoba` nor `smjena`, other params kept | N/A |
| DB: inactive caller / other org / anon | — | zero rows / zero rows / 401 `42501` | N/A |
| DB: deactivated colleague | status inactive today | not returned | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0011_team_roster.sql:83-122`: the template for the function body, its pins and its grants. `0008_member_status.sql:138,169` holds `organization_today` and `member_active_on`, which default to active when a member has no status version.
- `apps/web/src/calendar/snapshot.ts`:
  - `CALENDAR_COLUMNS` :62; `CalendarTable` :124; `CalendarSnapshot`; `readCalendar` :193-308; `viewerOf`, whose version checks you reuse per member.
  - `calendarQueryOptions` :362 gains an rpc dependency.
  - Update the header comment at :48 ("select AND NOTHING ELSE").
- `apps/web/src/teams/roster.ts:89-147`: the `TeamRosterRpc` stub shape and its field-by-field validation; `compareMembers` :103.
- `apps/web/src/i18n/format.ts:406`: `compareText`.
- `apps/web/src/calendar/month.ts`:
  - `TEAM_SEARCH_PARAM` :61, `ALL_TEAMS_FILTER` :69;
  - `CalendarSearch` :129, `CalendarSearchChange` :136, `calendarSearchTo` :167, `calendarFilterChangeOf` :184, `calendarSearchOf` :233;
  - `CalendarFilter` :394, `CalendarMonth` :416;
  - `calendarDayListOf` :551, `dayListOutcomeOf` :584, `chosenTeamOf` :599, `calendarMonthOf` :613.
- `apps/web/src/routes/kalendar.tsx`:
  - query :122, the search at :126-134, the tab-stop key :145, `filter()` :167;
  - `renderFilter` :366-407, `renderDay`/`renderDays` :409-456, the mode split :590-591.
- `apps/web/src/rotation/rotation.fixture.ts:164-221`:
  - `calendarTableOf` and `calendarOrganizationRow` need an rpc answer and an org-level versions embed;
  - `answeringInTurn` in `snapshot.test.ts:312` needs them too.
- Tests to update:
  - `snapshot.test.ts:84-131`: the `seen` calls and the `team_membership_versions` first-match regex;
  - `month.test.ts:59-88` (`snapshotOf`), with the 3.3a filter tests at :718-862.
- DB inventories:
  - `test/rls-isolation.test.ts:1113-1163`: the `proname` list and `toEqual`; add `calendar_people` first;
  - `test/provisioning.test.ts:1495-1502` (`ACCESS_CONTROL_FUNCTIONS`) and `:1532-1569` (grantees `['authenticated']`);
  - `test/supabase-scaffold.test.ts:897-918`: the source-text template.
- Behaviour tests: follow `rls-isolation.test.ts:9111-9560` (team_roster), using the helpers `addThrowawayMember`, `tokenFor`, `rest`, `CROSS_TENANT` and `organizationDay`.
- i18n:
  - `hr.json:27-60`;
  - `test/resource-hygiene.test.ts:885-913`;
  - `prijava.test.ts`: controls 7 :431 (unchanged unless you add a control) and strings 18 :1754 (+ new keys);
  - `test/localization-applied.test.ts`: add `Osobe` to `AUTHORED_VOCABULARY` :514 if it is flagged, and `SEARCH_PARAMETERS` :1071.
- E2E:
  - `e2e/calendar.spec.ts:611-721`, with the helpers `teamFilterOf` :566 and `searchParamPattern` :576;
  - the fixture's `fixture.member` ("Lana Članica", on `fixture.team`) and `fixture.spare` ("Toni Bezsmjene", no team), in `e2e/support/fixture.ts:150-152`.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0017_calendar_people.sql`: the function and its grants, with a header comment on why it is a definer function and what it discloses.
- [x] `test/rls-isolation.test.ts`, `test/provisioning.test.ts`, `test/supabase-scaffold.test.ts`:
  - the inventories;
  - behaviour for member and admin (active colleagues, id and name only), a deactivated colleague excluded, an inactive caller, cross-tenant, and a PostgREST 401 for anon;
  - a source-text test that no forbidden column appears.
- [x] `apps/web/src/calendar/snapshot.ts`, `rotation.fixture.ts`, `snapshot.test.ts`: the embed, the rpc, `people`, and a refusal test for each validation.
- [x] `apps/web/src/calendar/month.ts`, `month.test.ts`: `osoba`, the combined filter change, `filter.people`/`person`, and `CalendarMonth.person`. Test every matrix row that is not a DB row.
- [x] `apps/web/src/routes/kalendar.tsx`: the optgroup, the label, the reset, the person view, and the tab-stop key. Wire the rpc into `calendarQueryOptions`.
- [x] `hr.json` and the inventories: `filter.label` (new text), `filter.people`, `person.noTeam`, with counts commented "story 3.3b".
- [x] `e2e/calendar.spec.ts`, as an admin at 1280 px:
  - the *Osobe* group lists Lana Članica;
  - choosing her shows the day list headed with her name, and no grid;
  - next month keeps `osoba`;
  - choosing a team drops `osoba`;
  - reset returns the grid;
  - choosing Toni Bezsmjene shows the no-team text.
  - As a member-role account, the *Osobe* group lists the colleagues.
- [x] `_bmad-output/implementation-artifacts/sprint-status.yaml`: `3-3-…` is done, with a comment that 3.3b landed. Mark the deferred-work 3.3b entry resolved.

**Acceptance Criteria:**
- Given a member-role session, when the calendar loads, then the Select lists every colleague active today, and no request returns an email, username, role or allowance.
- Given `apps/web/src/calendar` and `kalendar.tsx`, when they are swept, then there is one query key, no writes, and no web storage.

## Design Notes

**Why a function, not a policy change.** Widening `members` select would expose every column to member-role sessions. `team_roster` set the precedent: a definer function whose own `WHERE` clause is its scope, and id and name its only output. Memberships need nothing new, because `team_membership_versions` is already readable by any active member.

**Why the person wins over the team.** The UI can only produce one filter at a time. A hand-edited URL carrying both resolves to the narrower filter.

## Verification

**Commands:**
- `pnpm build && pnpm lint && pnpm typecheck && pnpm test`: exit 0, no skips, counts above the baseline. Apply 0017 to the shared stack first (`supabase migration up`); do not reset it without asking.
- `pnpm test:e2e`: green. Stop Vite on 5173 first.
- `git diff --stat package.json pnpm-lock.yaml`: empty.

**Manual checks:**
- Demo org at 390 and 1280 px: choose a person, move to the next month, choose a team, then reset.

## Suggested Review Order

**The narrow read**

- Entry point: id and name of today's active colleagues, scoped by the function's own WHERE.
  [`0017_calendar_people.sql:37`](../../supabase/migrations/0017_calendar_people.sql#L37)

- Deactivated colleagues drop out through the existing `member_active_on`.
  [`0017_calendar_people.sql:56`](../../supabase/migrations/0017_calendar_people.sql#L56)

- Only a signed-in session may call it; anon, public and service_role revoked.
  [`0017_calendar_people.sql:66`](../../supabase/migrations/0017_calendar_people.sql#L66)

**The snapshot**

- Every member's versions come from an embed RLS already allowed, not the function.
  [`snapshot.ts:76`](../../apps/web/src/calendar/snapshot.ts#L76)

- Select and rpc run together under the one `CALENDAR_KEY`.
  [`snapshot.ts:249`](../../apps/web/src/calendar/snapshot.ts#L249)

- Versions grouped per member, each checked as the viewer's are.
  [`snapshot.ts:398`](../../apps/web/src/calendar/snapshot.ts#L398)

- People validated field by field, blank names refused, sorted by `compareText`.
  [`snapshot.ts:436`](../../apps/web/src/calendar/snapshot.ts#L436)

**The filter model**

- One Select value space: `''`, a bare team id, or `osoba:<id>`.
  [`month.ts:218`](../../apps/web/src/calendar/month.ts#L218)

- Both keys always in the change, so one filter drops the other.
  [`month.ts:196`](../../apps/web/src/calendar/month.ts#L196)

- A person counts only when offered; unknown or inactive ids are ignored.
  [`month.ts:689`](../../apps/web/src/calendar/month.ts#L689)

- The day list now takes any memberships, serving viewer and person alike.
  [`month.ts:624`](../../apps/web/src/calendar/month.ts#L624)

- A valid person wins over the team; the grid itself is not narrowed.
  [`month.ts:750`](../../apps/web/src/calendar/month.ts#L750)

**The screen**

- *Osobe* follows *Smjene*; an empty group never renders.
  [`kalendar.tsx:414`](../../apps/web/src/routes/kalendar.tsx#L414)

- One reset clears team and person alike.
  [`kalendar.tsx:439`](../../apps/web/src/routes/kalendar.tsx#L439)

- Person heading and day list replace the grid; list labelled by person then month.
  [`kalendar.tsx:498`](../../apps/web/src/routes/kalendar.tsx#L498)

- Tab stop forgotten when month, team or person changes.
  [`kalendar.tsx:166`](../../apps/web/src/routes/kalendar.tsx#L166)

**Peripherals**

- DB behaviour: active colleagues, deactivated excluded, inactive caller, cross-tenant, anon 401.
  [`rls-isolation.test.ts:9570`](../../test/rls-isolation.test.ts#L9570)

- Source-text shape, pins, grants and forbidden columns.
  [`supabase-scaffold.test.ts:923`](../../test/supabase-scaffold.test.ts#L923)

- The two recorded calls, and one refusal per validation.
  [`snapshot.test.ts:106`](../../apps/web/src/calendar/snapshot.test.ts#L106)

- Unit tests: every non-DB matrix row.
  [`month.test.ts:886`](../../apps/web/src/calendar/month.test.ts#L886)

- E2E: admin round trip and tab stop, Moj raspored, member-role choosing colleagues.
  [`calendar.spec.ts:721`](../../e2e/calendar.spec.ts#L721)

- Copy: `filter.people`, `person.noTeam`, the new label.
  [`hr.json:48`](../../apps/web/src/i18n/locales/hr.json#L48)
