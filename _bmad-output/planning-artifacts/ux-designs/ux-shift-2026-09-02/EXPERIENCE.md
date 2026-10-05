---
name: Shift
description: Information architecture, behaviour, states, interactions and flows for the Shift management platform. Peer to DESIGN.md, which owns the visual identity. Croatian-first, mobile-first for members.
status: final
updated: 2026-09-02
design: ./DESIGN.md
sources:
  - ../../../specs/spec-shift/SPEC.md
---

> **Peer contract.** This file owns *how it works*; `DESIGN.md` owns *how it looks*. Visual tokens are referenced here by name as `{colors.token}` and are defined there, never duplicated. Both spines win on conflict with any mock, wireframe, or import. Product requirements live in `SPEC.md` and its companions and are referenced, not restated.

## Foundation

**Form factor.** Responsive web application. Mobile, tablet, and desktop; no native application. Members are assumed to be primarily on phones — a volunteer between other tasks, in a vehicle, mid-shift, before bed. Admins are primarily on desktop or tablet, with every administrative task also completable on mobile, degraded in comfort but never in capability.

**UI system.** shadcn/ui on React + TypeScript + Vite + Tailwind. Both spines inherit from it. `DESIGN.md` specifies only the brand-layer visual delta; this file specifies only the behavioural delta. Where shadcn defines a behaviour — focus trapping in Dialog, dismissal in Sheet, filtering in Command — that behaviour is inherited and not respecified here.

**Themes.** Light and dark both ship, driven entirely by `prefers-color-scheme`. There is **no in-app theme toggle and no theme setting**, so no surface exists for it and no preference is persisted. Consequence for every screen: state must be legible in both themes, and no state may rely on one theme's contrast.

**Localization.** Croatian is the only complete locale. Every string resolves through a translation key; none is hard-coded. See the spec's `localization.md` for the full contract — it is binding here, particularly the three-form plural rule, which affects every count this document specifies.

**Motion.** Minimal. Component transitions inherited from shadcn; the product adds none. No motion tokens exist.

## Information Architecture

*Rendered reference: [mockups/rotation-config-1.html](mockups/rotation-config-1.html) — Hour Bands and rotation configuration, desktop panel and phone stepper.*

**Navigation shape.** Bottom tabs on mobile, sidebar on desktop. Two layouts, one architecture.

**Member Role — four destinations.** No configuration surface is reachable at all.

| Tab | Surface | Answers |
|---|---|---|
| Danas | Member dashboard | Am I on? When next? |
| Kalendar | Calendar | What does the month look like? |
| Sati | My hours | How much have I worked? |
| Godišnji | My leave | How much is left? |

**Admin — the four above plus configuration**, grouped in the sidebar:

- *Raspored* — Calendar, Conflicts
- *Ljudi* — Members, Teams
- *Postavke rotacije* — Shift Types, Rotation Patterns and Assignments
- *Organizacija* — Organization settings (identity, Leave Year, branding; the timezone shown read-only; Hour Bands reached from it). Type, timezone and locale are set at provisioning. The Leave Year's start is chosen as a day (1–28) and a month, never a date picker: it recurs yearly, and `0002` admits no day a February lacks.
- *Sati* — Organization hours

**Surface inventory and the journey that reaches each.** IA closes when every capability has a surface and every surface has a journey landing on it.

| Surface | Capability | Reached by |
|---|---|---|
| Sign in · password reset | CAP-1 | UJ-1, UJ-2 entry |
| Member dashboard | CAP-17 | UJ-2 |
| Admin dashboard | CAP-17 | UJ-1, UJ-4 |
| Calendar — *Moj raspored* mode | CAP-11, CAP-13 | UJ-2 |
| Calendar — *Sve smjene* mode | CAP-13 | UJ-1, UJ-3 |
| Day detail | CAP-11, CAP-12 | UJ-3 |
| My hours | CAP-14 | UJ-2 |
| Organization hours | CAP-14 | UJ-4 |
| My leave | CAP-15 | UJ-2 |
| Leave management | CAP-15 | UJ-3 |
| Conflicts queue | CAP-16 | UJ-3, UJ-4 |
| Conflict resolution | CAP-16 | UJ-3 |
| Members list · member detail | CAP-4 | UJ-1 |
| Team detail *(includes team roster)* | CAP-5, CAP-6 | UJ-2 |
| Shift Types | CAP-7 | UJ-1, UJ-5 |
| Rotation configuration | CAP-8, CAP-9, CAP-10 | UJ-1, UJ-5 |
| Organization settings | CAP-2, CAP-3 | UJ-1, UJ-5 |

**The member roster is not a top-level destination.** Its purpose is "see who is on my team", so it lives inside Team detail, reached from the member's own dashboard or schedule. `[NOTE FOR UX: this narrows spec CAP-5, which reads as an organization-wide directory. SPEC.md needs a bmad-spec update run to match.]`

## Voice and Tone

Microcopy rules. Brand voice lives in `DESIGN.md` § Brand & Style.

- **State the fact, never the absence.** `Danas ne radiš` — never an empty area the member must interpret. Every empty state says what is true, not that nothing was found.
- **Numbers, not adjectives.** A warning states its consequence numerically: `24 h bez pauze`, `2 od 3 člana`. Never "significant", never "warning: check this".
- **No exclamation marks. No encouragement. No personality where a fact will do.** The member is not being congratulated for working nights.
- **Second person singular, informal** (`ne radiš`, not `ne radite`). A volunteer fire brigade is not a corporation. Consistent everywhere.
- **Times are ranges, dates are Croatian-formatted.** `19:00–07:00`, `12.09.2026`. En dash for ranges, never a hyphen.
- **Counts respect three plural forms** — one / few / other. `1 dan`, `2 dana`, `5 dana`; `1 konflikt`, `2 konflikta`, `5 konflikata`. A `count === 1` check is a defect.
- **Never say "shift" for a team.** `Smjena` is the team; `Tip smjene` is the shift type. Because `Sve smjene` reads ambiguously as an all-teams filter, that control shows a count — `Sve smjene (4)` — and groups its options under a labelled heading.
- **Rank and position** (sprint change 2026-09-25). The member's rank is `Vatrogasni čin`; the team role is `Položaj`, never *pozicija*; the setting is `Vatrogasni činovi i položaji`. The roster line is `Ime · čin · položaj`, labels lowercase beside the name. Neither is ever colour-coded, and neither is a filter in MVP.

## Component Patterns

*Rendered references: [mobile-calendar-1.html](mockups/mobile-calendar-1.html) (shift-cell, mode switch, duty-block) · [conflict-resolution-1.html](mockups/conflict-resolution-1.html) (resolution-option, consequence-strip, legend).*

Behavioural specs. Visual specs are in `DESIGN.md` § Components.

- **shift-cell.** Label always visible; time range appears when width allows and is dropped, never abbreviated, when it does not. Tapping opens Day detail. Modifiers compose — a cell may be both overridden and in conflict, and shows both glyphs.
- **Calendar mode switch.** A segmented control, two modes: *Moj raspored* (default on mobile for a Member Role) and *Sve smjene*. Mode persists across month navigation within a session.
- **Team / member filter.** A Select populated from live records, never hard-coded options. Shows a count in its label. Resets to all-teams in one action, and that reset is reachable without leaving the calendar.
- **duty-block.** Groups consecutive working shifts that have no non-working interval between them into one duty. Headline is the end time; the span and total hours are metadata; one leg per constituent shift, marked done or in progress. **Presentation only** — the data remains two Scheduled Shifts on two dates.
- **resolution-option.** Radio-selection card. Exactly one selected at a time. No option is primary-styled, none is labelled recommended, and the order is fixed so muscle memory is possible. Nothing is preselected: `Spremi odluku` stays disabled until a card is chosen, and the line beside it says why ("Odaberi jednu od tri odluke."), then what saving records ("Odluka se bilježi s tvojim imenom i vremenom."). Story 5.4b ships the first card, "Prihvati kao nepokriveno"; 5.4c and 5.4d add theirs at positions 2 and 3. The three cards are one arrow-key group.
- **Amend leave (story 5.4d).** "Izmijeni godišnji odmor" at position 3 states a computed range that would clear this conflict, never a recommendation: with the conflict date `d` inside a record `from`–`to`, a `d` before the end moves the start to `d + 1` ("Mirela radi 02.10., a godišnji počinje 03.10. Otvara izmjenu godišnjeg s tim datumom."), the record's last day moves the end to `d − 1` ("… a godišnji završava 08.10. …"), and a one-day record is removed ("… a ovaj godišnji se briše. Otvara brisanje godišnjeg."). Chosen, `Spremi odluku` is ready at once and the line says "Spremi otvara izmjenu godišnjeg s datumom 03.10." (or "Spremi otvara brisanje ovog godišnjeg."). Saving writes nothing — no resolution row — and opens the member page, where the *Godišnji* card opens once: amend mode for that record with the range filled in and focus in the od field, or the record's removal confirmation. A record already gone opens nothing. The router state carries the hand-off, never the URL. While the page was reached from a conflict, "Natrag na konflikte" sits beside the way back to the list. A cancelled amend leaves the conflict in the queue; a saved one clears it by derivation.
- **Replacement guard (story 5.4e).** On the member page's *Godišnji* card, an amend preview or a removal confirmation that uncovers a date on which someone replaced the member names that replacement, who stays rostered: one line each, "Dino Grgić ostaje na smjeni Smjena C · 02.10. kao zamjena. Ukloni zamjenu u kalendaru ako više ne treba.", ordered by date, then team. Only the dates the change uncovers count (a removal: the whole record; an amend: the old range less the new), and only a replacement still applied on the roster; one whose override was removed or is inert says nothing. The lines are notes, never `destructive`: nothing is disabled, gated or confirmed by them. In the amend form they sit inside the preview's polite live region. After the write lands, its status line repeats the lines captured just before it. If the resolutions cannot be read, one line says "Ne mogu provjeriti zamjene za ove datume." and the save still goes. The member's own *Godišnji* is untouched.
- **Replacement candidates (story 5.4c).** Choosing "Zamijeni osobu" opens "Tko odrađuje smjenu" after the cards — a sibling, because each card is a button and the cards are one arrow-key group — as its own arrow-key radio group with nobody picked. The candidates are the members active that date, less everyone on that team's roster and anyone already put on it, in three groups, each by name: `slobodan`, `radi taj dan · 24 h bez pauze` (a working shift on any team that date), and `na godišnjem taj dan` (which wins over the other two). Each line reads `Ime · čin · položaj`, as the roster form's, and wraps rather than truncates. The groups only inform: every candidate is selectable, none is disabled or recommended. With the card chosen and nobody picked, `Spremi odluku` stays disabled and the line says "Odaberi tko odrađuje smjenu."; pressing it moves focus to the first candidate. With nobody to pick at all, the line says "Nitko ne može preuzeti ovu smjenu. Odaberi drugu odluku." and pressing it returns focus to the card. Moving to another card drops the pick, so coming back starts with nobody. A candidate put on the shift meanwhile is refused by name ("… je već na ovoj smjeni. Odaberi nekoga drugoga."), the list is read again without them, and focus moves to it. The reason is clipped to 0026's 200 characters. The override is written with the reason "Zamjena za {ime} (godišnji)"; there is no reason field.
- **Resolution screen navigation.** ‹ › outline icon buttons beside the heading move to the adjacent unresolved conflict in the queue's order, without saving (decision 20, the navigation half). Each is disabled at its end, its label names the target's date, and both show at every width. The heading's line says the place in the queue ("2 od 7"), and the way back above it carries the count.
- **consequence-strip.** Three terms, always the same three, always in this order: coverage, the absent member's hours, the leave balance. Present on every resolution option so outcomes are compared rather than guessed. Three columns at every width, a phone's included, across the card under a divider. As shipped for "Prihvati kao nepokriveno" (story 5.4b): "3 od 4 člana" with lucide `CircleDashed` and "Nepokriveno"; "12 h kao godišnji" (`—` for a shift with no times); "16 dana preostalo" over "bez promjene", the balance of the leave year that holds the conflict's date. For "Zamijeni osobu" (story 5.4c): the coverage one higher ("4 od 4 člana"), then "· {ime}" once someone is picked, never "Nepokriveno"; the hours and the balance as the first card's, because the absent member stays rostered on leave. For "Izmijeni godišnji odmor" (story 5.4d): "4 od 4 člana · {ime} radi"; "12 h rada" (`—` untimed); "17 dana preostalo" over "+1 dan" — the balance once the dropped days are given back, and what that gives back, in the conflict date's leave year.
- **Legend.** Persistent wherever modifier glyphs render. Not a tooltip, not behind an info icon — four glyphs is a vocabulary, and a vocabulary needs to be on screen.
- **Configuration stepper (mobile).** Rotation configuration on a phone is a four-step sequence — shift types, pattern, offsets, preview — with completed steps navigable backwards. On tablet and desktop the same content is one scrolling panel with no stepper. Same data, same validations, same order.
- **Hour Band editor.** Bands are entered as a **name and a start time only**; the window, duration, and midnight-crossing flag are derived and shown read-only. A 24-hour bar renders the partition, with any gap hatched and flagged. Entering start times rather than ranges is what makes a gap or overlap unrepresentable instead of validated after the fact.
- **Pattern builder.** An ordered, reorderable list of shift-type steps of arbitrary length; the same shift type may appear more than once. Derived facts — cycle length, working steps, hours per cycle — update live beneath it.
- **Cycle preview.** Renders the next full cycle from pattern, offsets, and anchor date before saving, so the configuration is judged by its output rather than its inputs.
- **Hours table.** Tabular numerals; sortable and filterable by team and member; scrolls inside its own container.
- **Hours export.** One secondary action on Organization hours, `Izvezi u Excel`, admin-only. It exports the current period, filter and sort, and nothing else. While the file is being built the action shows progress and is disabled. There is no format picker in MVP.

## State Patterns

- **Empty.** States what is true. Conflicts empty: *"Nema konflikata između godišnjih odmora i rasporeda."* Member with no team: an explanation, never a blank schedule. A count that is zero is still shown — `0 neriješenih konflikata` — because hiding it is indistinguishable from not having loaded.
- **Loading.** Skeletons matching final layout for the calendar grid and tables; no spinners on primary surfaces. A month already visited and a month never visited must feel the same.
- **Error.** States what failed and what to do. A refused save keeps the entered values.
- **Saved decision.** A status line, not a toast (decision 21). After a conflict decision lands the screen returns to the queue, and a `Notice role="status"` above the count names what was saved: the shift, the date and the member, and the outcome — for a replacement, who replaces them ("…, zamjena: Dino Grgić."). It travels in router state only — never the URL, never storage — so it is gone on navigation (the Raspored tab included) and on a reload, and nothing times it out. It stands above the queue whatever state the queue is in, and takes focus so it is announced.
- **Refusal, blocking.** Two validations refuse a save outright, and only two: Hour Bands that leave a gap or an overlap, and a Rotation Offset outside the cycle. Both are refused because the resulting state is not merely unwise but unrepresentable — an hour belonging to no band has nowhere to be counted. The refusal names the specific gap in hours and keeps every entered value.
- **Warning, non-blocking.** Coverage warnings, rest-gap warnings, replacement-member clashes, and a replacement a leave amend or removal would leave rostered (story 5.4e, named in the preview or the confirmation before the save) appear at save time with the consequence in numbers, and never block. They do not persist as standing banners — the pilot's own rotation legitimately triggers a rest-gap warning every time it is saved, so a persistent treatment would train admins to ignore it.
- **Erasure, confirmed.** The one thing a configuration save waits on (AD-5, story 5.5a). When "Spremi rotaciju" would remove the cause of an unresolved conflict — the member no longer works a date they are on leave — a confirmation dialog opens before anything is written: "Promjena briše {count} konflikt(a)", then one row per conflict by date and team ("{smjena} · {dan dd.mm.} · {tip}", "{ime} na godišnjem · nova rotacija: {smjena} taj dan slobodna", or "… taj dan bez {ime}" when the team still works). Each row has two `aria-pressed` toggles, "Potvrdi brisanje" and "Zadrži", with nothing preselected and focus starting on the first row's confirm. "Spremi rotaciju" stays `aria-disabled` until every row is confirmed; a kept row says "Zadržan konflikt: promijeni rotaciju ili se vrati na uređivanje.", and "Natrag na uređivanje" returns to the draft untouched. The draft's warnings show in the same dialog and never block. The list is derived again before the write; when it changed, it shows again undecided under "Popis konflikata se promijenio. Odluči ponovno za svaki." The save's notice then counts what went ("Uklonjena 2 konflikta."). Nothing is recorded: the conflict goes because its cause does. A save whose erasures cannot be checked saves nothing and says "Ne mogu provjeriti konflikte koje bi promjena izbrisala." with "Pokušaj ponovno". The same dialog guards the calendar's roster changes (story 5.5b): saving a change in the day detail's roster form, and removing one. It opens as its own dialog beside the day detail, in the calendar's words — the second line always reads "{ime} na godišnjem · nakon promjene: {smjena} taj dan bez {ime}" (a roster change never makes the team free), a kept row says "Zadržan konflikt: vrati se na uređivanje.", and its own save is "Spremi promjenu". For a removal the lede ends "Prije uklanjanja odluči za svaki.", a kept row says "Zadržan konflikt: odustani od uklanjanja ili se vrati na dan.", and the save is "Ukloni". A change that erases nothing still saves in one click. A removal goes through its own neutral confirmation first; when its "Ukloni" finds erasures, that confirmation closes and the erasure dialog follows. "Natrag na uređivanje" returns to the roster form with its inputs kept, or to the day detail for a removal, and focus goes back to the control that opened it. A change whose erasures cannot be checked writes nothing and says so in the form, or in the removal's confirmation, with "Pokušaj ponovno". The member page guards its team and status cards the same way (story 5.5e): a move to another team or to no team, withdrawing a scheduled move, a deactivation, and withdrawing a scheduled reactivation. The card's own confirmation comes first; when its confirm finds erasures, it closes and the erasure dialog follows, in the member page's words — the second line reads "{ime} na godišnjem · nakon promjene: {smjena} taj dan bez {ime}", naming the team the conflict was on (a move to another working team still erases the old team's), a kept row says "Zadržan konflikt: odustani od promjene ili se vrati na uređivanje.", and its save is the confirmation's own ("Potvrdi deaktivaciju osobe {ime}"). Its rows scroll inside the dialog, since a deactivation can erase many, with no page or sideways scroll at 390 px. "Natrag na uređivanje" returns to the card with the team, position and date kept, and focus on the card's offer. A reactivation, withdrawing a scheduled deactivation and a position-only change only add and run no check; a change that erases nothing writes as before. A change whose erasures cannot be checked writes nothing and says so inside the card's confirmation, with "Pokušaj ponovno"; the saved line counts what went. Shift-type overrides (5.5f) and cancelling a scheduled rotation (5.5g) are not guarded yet.
- **Conflict.** Persisted product state, not a UI state. Visible on the calendar without opening a detail view, counted on the admin dashboard, and queued soonest-first. It never expires, never auto-clears, and is never hidden.
- **Overridden.** Identifiable on the calendar and in a schedule list without opening detail. Detail names author, timestamp, reason, and the projected value the override replaced.
- **Past-but-unresolved.** A conflict on a date already gone stays in the queue and is visually distinguished from upcoming ones. It is history that still needs a decision, not a task to hide.

## Interaction Primitives

- **Tap targets** 44 px minimum on touch, including calendar cells — which sets the real floor for grid density.
- **One destructive confirmation step**, never a colour-only signal, since `{colors.destructive}` is reserved for conflicts.
- **Confirmations are modal** (design refresh C). Removing, archiving, deactivating or reissuing a credential asks one question naming the subject, in a dialog, with the cancel and then the confirm at its bottom right. Inside an edit dialog the question replaces the form in the same dialog, and a cancel returns to the form with what was typed. While the write is in flight, the dialog cannot be dismissed.
- **Add and edit in a dialog where the record is small** (design refresh C). An hour band, a shift type and a team are added in a dialog opened from their list, and edited in a dialog over that list. The route still names the record, so a link opens it and Back closes it. The dialog's close is the way back, so no "back" button sits beside it. A remove or archive offer sits beside Save, at the right, in neutral styling with its icon, as a short word whose accessible name names the subject. A member, with its password, status and team history, stays a page, and its way back sits above its title.
- **A computed value is shown, not entered** (design refresh C). An hour band's end is the next band's start (AD-3), so the dialog shows it beside the start as the start is typed, never as a field.
- **A scheduled change stands out.** A team or status change dated after today is set apart on the member's page, and the member list marks it in the team cell ("Od {date}: {team}"), so it is seen before it takes effect.
- **No bulk conflict resolution anywhere.** Each conflict is decided on its own screen with its own consequences shown. Amending a leave record still clears every conflict it caused — that is removing the cause, not batching decisions — but no affordance resolves a list of conflicts at once.
- **Optimistic updates are not used** for hours, leave balance, or conflict state. Those are the numbers the product is trusted for; a figure that flickers and corrects itself costs more trust than a brief wait.
- **Filter and mode state survives** month navigation within a session and is not persisted across sessions.
- **Month navigation** is symmetric and unbounded in both directions; no month is unreachable and none is slower.

## Accessibility Floor

Behavioural. Visual contrast requirements are in `DESIGN.md`.

- **No information by colour alone**, anywhere. Every shift state carries a glyph or a fill treatment alongside its colour. This is verified in the compressed grid, in status pips, and in badges — the compact surfaces where the rule is most often broken.
- **Keyboard navigable**: calendar grid, both dashboards, the conflict queue, and the resolution screen. The resolution screen's options are a radio group, arrow-navigable.
- **Assistive technology** gets meaningful labels on every calendar cell: date, team, shift type, times, and any modifier — not a colour swatch and not a bare letter.
- **Both themes verified**, since there is no toggle and a member may be in either without having chosen.
- **No horizontal page scroll** at any width; wide content scrolls within its own container.
- Target is WCAG 2.1 AA without formal audit in MVP. `[ASSUMPTION — carried from SPEC.]`

## Inspiration & Anti-patterns

**Register to reach for:** operational dashboards that a shift worker trusts without training. Quiet competence. A document rather than an application.

**Anti-patterns, named upstream and binding here:**

- **Dense enterprise grids with no hierarchy.** The failure mode this product must avoid most, because a rota genuinely is a dense grid — density is the requirement, illegibility is the failure.
- **A colour-coded spreadsheet ported to the web.** The thing being replaced. Reproducing it in HTML replaces nothing.
- **Consumer-app playfulness.** People plan childcare around this schedule.
- **Automatic helpfulness.** Anything that resolves, suggests, or defaults its way through a conflict defeats the product's central stance.

## Responsive & Platform

*Rendered reference: [mockups/mobile-calendar-1.html](mockups/mobile-calendar-1.html) — the three calendar approaches and two duty treatments, at true 390 px.*

| Width | Calendar | Navigation | Notes |
|---|---|---|---|
| Phone (< 640) | *Moj raspored* day list by default; *Sve smjene* compressed grid one tap away, teams as one-letter columns | Bottom tabs | Priority order: today's shift, next shift, calendar, hours, leave |
| Tablet (640–1024) | Full grid with team names | Sidebar, collapsible | Admin configuration fully usable |
| Desktop (> 1024) | Full grid, times visible in cells | Sidebar | Admin default working width |

- The compressed grid is the same component as the full grid with a narrower column treatment, not a separate mobile calendar.
- Every administrative task completes on a phone. Rotation configuration is the hardest case and the one to test first.

## Key Flows

Protagonist names and UJ ids mirror the PRD verbatim.

- **UJ-1 — Damir configures the rotation once and retires the spreadsheet.** Fresh Admin account, empty Organization. Sets identity and Hour Bands (timezone and locale came with provisioning); defines three Shift Types; builds a four-slot Rotation Pattern; creates four Teams and gives each an Offset against a shared Anchor Date. Save reports coverage — one team on each working type every day — and a rest-gap warning stating 24 continuous hours, which Damir reads and accepts. **Climax:** the calendar shows three months already correct, without a date having been typed. Adds Members, hands out credentials.
- **UJ-2 — Luka checks whether they are working, from the truck.** Authenticated from a previous session, opens on *Danas*. If mid-duty, a duty-block headlines the end time with a progress bar. If not working, the screen says `Danas ne radiš` and shows the next working shift with both times. Hours and leave sit below; the next seven days follow as a list. **Climax:** answered before anything was tapped.
- **UJ-3 — Damir records Ana's leave and finds the collisions before they bite.** Opens Ana's record — 30 allocated, 12 used, 18 remaining — enters 10.09–16.09, and sees the cost in Leave Days before saving, counting only dates Ana was rostered to work. On save, each affected working shift becomes a visible conflict; shifts stay on the calendar and the rotation is untouched. **Climax:** four conflicts queued, soonest first, none of them silent. Damir resolves each on its own screen — two by replacing Ana with a colleague, two accepted as uncovered — comparing coverage, hours, and balance on every one.
- **UJ-4 — Damir closes the month.** Opens Organization hours, picks September, sees every Member with shift counts, hours per band, total, and leave hours separately. One total is low; drilling in shows two shifts reassigned during week two's conflicts. **Climax:** the number explains itself without reconstruction. Damir exports the month with `Izvezi u Excel` and sends it onward. The file matches the screen.
- **UJ-5 — a second Organization proves the engine.** A security company with three Teams on a five-slot pattern and 8-hour shifts is configured as a second tenant, its Shift Types taking ramp slots 1–3 and its Hour Bands set to its own boundaries. **Climax:** no code change, no migration, no branch. A product acceptance test rather than an end-user flow.
