# Epic 16 Context: My shifts are in my phone's calendar, and the month prints

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

A member subscribes their phone's calendar (Google or Apple) to their own at-work shifts through a personal, revocable feed link, so the rota sits next to the rest of their life and follows changes within the day. Anyone who reads the schedule can print the month they are looking at, for a noticeboard or a folder. Print (16.1) runs on the shipped calendar alone and is ready now. The feed (16.2–16.5) needs the canonical domain package running on the server, and waits for Architect pass 1 and for founder ratification of decisions D-S1, D-S2 and D-S8.

## Stories

- Story 16.1: The month prints
- Story 16.2: The domain package runs on the server
- Story 16.3: A member's feed token is a revocable secret
- Story 16.4: The calendar feed serves a member's own shifts
- Story 16.5: A member subscribes from *Kalendar na mobitelu*

## Requirements & Constraints

**Print (16.1, ready, no gate):**
- *Kalendar* gains *Ispiši*, in both modes (*Moj raspored* and *Sve smjene*) and under any filter. It opens the browser's own print dialog on a dedicated print layout of the current month.
- The layout is A4 landscape and fits the page. It has no navigation chrome (no tabs, sidebar, toolbar or filter bar).
- The header holds the organization name, the month, the current filter in words, and `ispisano {datum vrijeme}` (organization timezone, through the shared formatting layer). The persistent legend is printed too.
- The print holds exactly what the viewer's screen shows under their own visibility. A member-role account prints no conflict (`⚠`) or uncovered (`◌`) marks and no other member's leave. In *Sve smjene* it prints no leave at all, its own included. The short-staffed mark is admin-only, as on screen. The legend lists only the marks that can appear for that viewer.
- It must read on a black-and-white printer: every state keeps its glyph and label (shift-type label, `⚠`, `✎`, `◷`, `◌`, the short-staffed glyph) and never relies on colour alone.
- A midnight-crossing shift prints once, on its start date, with both clock times.
- Loans (Epic 18) print correctly because the print uses the same snapshot as the screen. On loan dates a lent member is on the loan team's roster and off the home team's. Any loan wording the screen shows uses the glyph plus words (`ArrowRight`, UX-DR59), never colour alone. The planning docs add no print-specific loan mark.
- No PDF library, no server call and no new dependency. This is print CSS plus a print layout, not the pdfmake path the exports use.
- All copy lives in the `print` namespace of `hr.json`, with no literal strings in components (L1). Use correct Croatian plurals (L7) and the organization timezone (L8).
- The same change updates the DESIGN.md / EXPERIENCE.md / UX-DR lines it touches: UX-DR31/32 (*Kalendar* gains *Ispiši*), UX-DR33 (the print layout becomes a surface in the inventory) and UX-DR56.

**Feed (16.2–16.5, gated):**
- Each feed shows one member's own at-work shifts and nothing else: no leave, no absence type, no other member, no hours, no address and no note. SUMMARY is the shift type name plus the team name. Times are correct in the organization timezone across DST. The window is the past 31 days and the next 182.
- The token is at least 256 random bits, returned once and stored only as a SHA-256 hash, with at most one live token per member. The member can regenerate it or turn it off, and the old token dies at once. An admin can revoke a token but never sees it. Deactivating a member revokes their token in the same transaction. The full token is never logged.
- An unknown, revoked, replaced or deactivated token gets one identical 404: same status, body, headers and timing class.
- The server projection must equal the browser's projection (parity suite over both fixtures).
- A `security-review` of 16.3–16.4 comes before production.

## Technical Decisions

- **One snapshot per surface (AD-13):** the print is built from the calendar's already-rendered snapshot. It never makes a second read, so it cannot drift from the screen. The calendar snapshot already carries loans (its fourth RPC, `calendar_team_loans()`), and rosters follow them through the domain's `effectiveTeamOn`.
- **Nothing derived is stored (AD-1).** The domain returns codes and operands, never prose (AD-8). The UI turns them into copy through i18n.
- **Print mechanism (decision D3):** `window.print()` plus a print stylesheet or route. Epic 15's glass layer gets nothing beyond a print stylesheet. Under print, glass and colour fills must not carry meaning on their own.
- **Feed architecture:**
  - `@shift/domain` loads under Deno with no runtime dependency and no second implementation (AD-7). It starts with a spike on Deno module resolution.
  - `member_schedule_inputs` and `calendar_feed_inputs(token)` are `SECURITY DEFINER` and return only asserted rows. Only the latter is anon-callable.
  - The `calendar-feed` function runs with `verify_jwt = false` and the publishable key only, never a secret key (AD-17). It writes nothing but `last_fetched_at`.
  - The ICS output is hand-written RFC 5545: a VTIMEZONE, and one VEVENT per shift with a stable UID per (member, date, team). It is checked against golden files.
  - `calendar_feed_tokens` is organization-scoped with `organization_id` first, protected by RLS and audited without token or hash material.

## UX & Interaction Patterns

- Terminology: `Smjena` means a team and `Tip smjene` a shift type. Follow the surrounding screen's wording: *Sve smjene (N)*, and team names exactly as stored. The filter in words should match the calendar's summary line, e.g. `Prikazano: Smjena B · 4 osobe od 17` or `Prikazano: Luka Knežević · Smjena A`. In *Moj raspored* it should match that mode's own sentence, `Tvoj raspored · Smjena A`.
- The legend is persistent wherever glyphs render, never a tooltip. The five-mark vocabulary: `⚠` *čeka odluku*, `✎` overridden, `◷` *Odsutnost*, `◌` uncovered, and the short-staffed glyph *Premalo ljudi*.
- Shift cells always show their label. They show the time range when width allows, and drop it rather than abbreviate it.
- Subscription screen (16.5, UX-DR54): *Više → Kalendar na mobitelu*. With no feed it shows *Izradi poveznicu* and one sentence. With a feed it shows:
  - the URL, masked by default, with *Kopiraj*;
  - *Dodaj u Google kalendar* and *Dodaj u Apple kalendar* (`webcal://`);
  - `zadnje preuzimanje {datum vrijeme}` or `još nije preuzeto`;
  - *Izradi novu poveznicu*, with a warning that the old link stops working;
  - *Isključi*;
  - a note on Google's refresh lag and a note on what the feed leaves out.

  A month can be downloaded as `.ics` from the same serializer. The copy goes in the `feed` namespace.
- Admin view (UX-DR55): the member detail shows `Kalendar na mobitelu: uključen / isključen` and *Isključi poveznicu*, never the URL.

## Cross-Story Dependencies

- 16.1 depends on nothing. It builds on the shipped *Kalendar* (both modes, the filter chips, the legend) and on Epic 18's loan-aware calendar snapshot (stories 18.2 and 18.5).
- 16.2 → 16.3 → 16.4 → 16.5 in sequence. All of them wait for Architect pass 1 (the AD-1 scope note, AD-7, AD-14, AD-17, AD-18). 16.3–16.5 also wait for ratification of D-S1 (token), D-S2 (feed contents) and D-S8 (identical 404).
- Epic 17 (reminders) reuses 16.2's server-side projection and its parity suite.
