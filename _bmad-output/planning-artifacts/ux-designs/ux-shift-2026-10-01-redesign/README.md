# Shift redesign mockups (2026-10-01)

These mockups redesign the whole app.
Round 1 answered the top five findings of `../../ux-review-2026-10-01/`.
Round 2 covers every screen and modal, because the user asked for an app that is modern, minimal and simple to use.

The mockups build on `../ux-shift-2026-09-02/DESIGN.md` and `EXPERIENCE.md` and use the shiftapp-v2 look.
Each one is a self-contained HTML file with inline CSS. The only external resource is Google Fonts (DM Sans and Syne).

Each file shows:
- desktop at 1440 px and phone at 390 px
- light and dark themes, following `prefers-color-scheme`, switchable with Sustav / Svijetla / Tamna, plus forced dark samples
- Croatian UI copy

Start at `mockups/index.html`. It lists the screens by area, in the order a person meets them.

The sample data is the pilot:
- DVD Kaštel Novi, October 2026, Smjena A–D
- shifts Dan 07:00–19:00 and Noć 19:00–07:00
- the real ranks and positions from dvd-demo

Leave for Ivana Vuković (28.09–04.10), Mirela Kovačević (02.10–09.10) and Nikola Barišić (03.10) is invented so the mockups can show conflicts.
This gives 7 unresolved conflicts (6 upcoming, 1 past), and every file uses the same 7.

## Screens

| Mockup | Area | What changed and why |
|---|---|---|
| `mockups/sign-in-1.html` | Entry | Sign-in is a single step: one form with Organizacija, Korisničko ime and Lozinka, and one "Prijava" button. When the URL carries the organization (`/prijava/dvd-demo`), the organization is prefilled and shown as compact read-only text with its logo, name and a "Promijeni" link. That URL is how the DVD website's "Raspored za članove" link arrives. Without that URL, the field is prefilled with the last organization used on this device. The password field has a show/hide toggle. One generic error message covers a wrong organization, user or password. "Zaboravljena lozinka?" opens in place and says that the admin sets the password. New: at first sign-in the member sets their own password. The admin's new-password dialog shows the password once, with Kopiraj. |
| `mockups/danas-1.html` | Danas | The member gets the answer in words: on shift, free, 24 h duty (one duty-block) or on leave. A skeleton covers loading. The admin gets a "Treba tebe" card. It always shows the unresolved-conflict count, including `0 neriješenih konflikata`. Below it are today's coverage and the week. |
| `mockups/calendar-1.html` | Kalendar | The calendar uses the shared toolbar. The marks render as they ship: ⚠ as text with an inset `destructive` ring, ✎, lucide Clock (leave) and CircleDashed (uncovered). The legend is always visible. Day detail is one readable dialog: the facts, the conflict with a "Riješi konflikt" button, the roster as "Ime · čin · položaj", and the changes. "Promijeni sastav" and "Promijeni tip smjene" each open their own small dialog with one Save. Each dialog shows a computed "Što se mijenja", and candidates are grouped by availability. The page also covers Moj raspored as a list, the person view and the phone sheet. |
| `mockups/filters-and-month-nav-1.html` | Kalendar + Sati | One toolbar serves both screens. The month control is ‹ month ▾ › with a month-grid popover and PgUp/PgDn. The view mode is a segmented control. Filters are chips with ✕, a summary line and one "Poništi filtre". The page shows three directions (A/B/C) and recommends A. On the phone, the header is sticky, filters open in a sheet, active chips stay visible, and swipe or the arrows change the month. States shown: no filter, team, person, empty result and loading. |
| `mockups/hours-1.html` | Sati | Moji sati puts the total first, then labelled band bars, then the list of shifts as proof. Organization hours is a sortable table. Every row has an ⓘ that opens an explanation drawer: rotation, changes and leave, as an equation with dates. The Excel export shows its progress in words and keeps a status line about the downloaded file. A month with no schedule says why. |
| `mockups/leave-1.html` | Godišnji | For the member, the balance is the headline, the meter has a text legend, and each record lists the days it counts. For the admin, leave is recorded in a dialog on the member page. Before saving, the dialog shows the cost in leave days, the remaining balance and the conflicts the record will create. Amend shows "bilo / sada" and which conflicts clear. Remove asks one neutral question. New: an admin Godišnji overview of every person. |
| `mockups/conflicts-1.html` | Raspored | The queue always shows the count, including 0. Upcoming conflicts come first, soonest first. Past conflicts that are still unresolved follow in their own section, newest first. There is no bulk action. The 5.4 resolution screen shows the facts and three radio cards in a fixed order: accept as uncovered, replace the member, amend the leave. Nothing is preselected and no option is styled as primary. Each card has a consequence strip: coverage, the member's hours and the leave balance. The page also shows the queue after a decision on the phone. |
| `mockups/people-1.html` | Ljudi | The table has search, filter chips, sort and a status column that marks scheduled changes. A new member is a short dialog that ends by showing the password once. Deactivate asks one neutral question with a date and the consequence in numbers. The page also covers the Smjene list with its dialog, and a read-only directory for members, grouped by team. |
| `mockups/member-page-1.html` | Ljudi | The member page is a page of facts headed by the person's name. Each change opens its own dialog with one Save. A new team starts empty. |
| `mockups/setup-1.html` | Postavke | Rotation settings are one page with four numbered parts: types, pattern, offsets and preview. A sticky save bar repeats "Vrijedi od". When saving produces warnings, a confirmation opens but does not block. If the change would erase conflicts, saving blocks until each one is decided (5.5). The shift-type dialog computes the duration and "prelazi ponoć". On the phone, the same content is a 4-step stepper. Hour bands take a name and a start only, show a 24 h bar and compute the end. Organization settings are a page of facts with dialogs. The accent picker uses named radio cards. The timezone is locked and the page says why. |
| `mockups/mobile-navigation-1.html` | Foundations | The phone bar has 4 fixed tabs plus Više. The Više sheet holds the admin groups, the theme and Odjava. |
| `mockups/dark-tokens-1.html` | Foundations | Re-tuned dark slot tokens, with measured contrast. |
| `mockups/mobile-tables-1.html` | Foundations | Phones get stacked rows. Numbers use DM Sans tabular figures. |

## Rule changes that need human approval

> **Approved 2026-10-02 by the human: all 27 decisions below, as proposed.** New capabilities (12b first-password sign-in, 17 hours explanation drawer, 18 admin leave overview, 20 resolved-conflicts history, 23 member directory by team) become their own backlog stories. Binding docs (DESIGN.md, EXPERIENCE.md, UX-DR) change when those stories land, via `bmad-correct-course`.

Each item changes a rule in DESIGN.md, EXPERIENCE.md, epics.md (UX-DR or stories) or the IA.
Treat them as recommendations, and implement none until a person approves it.

### Round 1 (kept as recommendations)

1. **Admin phone tabs:** the admin bar becomes Danas, Kalendar, Raspored and Ljudi. Sati and Godišnji move into Više. This changes the phone priority in EXPERIENCE.md § Responsive. The theme control moves into Više and the desktop user menu. UX-DR2 keeps its three options.
2. **Admin Danas order:** the conflict card comes before coverage. Story 6.3 lists coverage first.
3. **Who was replaced:** a member's duty leg shows the name of the person they replaced.
4. **Dark slot tokens:** six dark values in DESIGN.md change, and a new token `shift-nonworking-border` is added. The brand delta grows from 23 to 24 names, which affects UX-DR1 and `theme-fidelity.test.ts`. Trade-off: Dan and Noć now have similar luminance, so hue and the label tell them apart.
5. **Member editing in dialogs:** this extends the "add and edit in a dialog where the record is small" rule to the sections of the member page. *Dani godišnjeg* moves to the leave section.
6. **Numerals in DM Sans** (used everywhere in round 2): DESIGN.md § Typography and the StatCard and StatTile components set large numerals in Syne. In these mockups Syne is kept for headings and words only.
7. **Stacked rows on phones:** they replace scrolling inside the container, which changes DESIGN.md § Layout. UX-DR17 still applies at 640 px and wider.

### Filters and month navigation

8. Sati's `?tim=` becomes `?smjena=`. Old URLs redirect to the new one.
9. Kalendar shows two chips (Smjena, Osoba) instead of one "Smjena ili osoba" select. The 3.3b rule stays: in Kalendar, picking a person replaces the team. In Sati the two filters still combine, so the same toolbar behaves two ways.
10. On the current month, "Ovaj mjesec" becomes a label instead of a disabled button. This changes story 4.1b. PgUp/PgDn change the month, and the month popover is a new primitive.
11. New empty-state copy for Sati, for example "Luka Knežević nije u Smjeni B u listopadu 2026.". Today the copy is "Nijedna osoba ne odgovara odabranom filtru.".

### Round 2

12. **Single-step sign-in** (`sign-in-1`).
    One form has three fields (organization, username, password). Today sign-in has two steps.
    The organization comes from the URL when present and is shown read-only, with "Promijeni".
    Otherwise the field is prefilled with the last organization used on this device. The value is stored in localStorage, and the field is empty when storage is unavailable.
    An organization in the URL that does not exist shows no name. The field stays editable and fails like any other wrong value.
12a. **Generic sign-in error, as a security choice** (`sign-in-1`).
    A wrong organization, a wrong username and a wrong password all produce the same message: "Organizacija, korisničko ime ili lozinka nisu točni." The message does not say which field was wrong.
    This way the form does not reveal which organizations or usernames exist.
    It replaces "Korisničko ime ili lozinka nisu točni." The trade-off is a little less help for someone who mistyped the organization. The hint under the field and the URL-prefilled variant mitigate that.
12b. **First sign-in sets your own password** (`sign-in-1`).
    This is a new capability (CAP-1) and needs a story. The initial password uses a four-word format.
13. **Day detail without inline forms** (`calendar-1`). Roster and type changes move into their own dialogs.
14. **Members see no conflict marks** in Moj raspored, only their own leave (`calendar-1`). EXPERIENCE.md § State Patterns says a conflict is "visible on the calendar".
15. **Replacement candidates grouped by availability** (`calendar-1`): "slobodan" or "radi taj dan · 24 h bez pauze". The groups only inform and never block (FR-18a).
16. **"Što se mijenja" computed in dialogs** for type, roster and leave changes. These are new computed facts.
17. **Explanation drawer for an hours figure** (`hours-1`). This is a new capability. It comes with a footer total, an export status line and "Moji sati" as the member page title.
18. **Admin Godišnji overview** (`leave-1`). This is a new screen.
19. **Conflicts a leave record will create**, shown before saving in neutral text (`leave-1`).
20. **Neriješeni / Riješeni tabs and ‹ › between conflicts** (`conflicts-1`). The history of resolved conflicts is new.
21. **Status line after a decision**, as `Notice role=status` (`conflicts-1`). It disappears on navigation. Confirm that this is not a toast under EXPERIENCE.md.
22. **The amend-leave option suggests a start date** (03.10) (`conflicts-1`). This is a computation, not a recommendation, but confirm it does not break "no automatic helpfulness".
23. **Member directory by team** in Više (`people-1`). This changes UX-DR33: the roster becomes one page instead of staying inside Team detail.
24. **Status as a filter and column in Ljudi, and a new member in a dialog** instead of a page (`people-1`).
25. **Sticky save bar with "Odbaci promjene"** on rotation settings (`setup-1`).
26. **Save confirmation dialog for rotation warnings** (`setup-1`). The warnings still do not block (UX-DR23).
27. **Organization as a page of facts with dialogs** (`setup-1`), and "Povijest rotacije" behind a header button.

## What every mockup keeps

- Croatian copy with three plural forms.
- No toasts and no persistent banners.
- `destructive` only for unresolved conflicts.
- No state shown by colour alone.
- Skeletons, not spinners.
- Empty states that say what is true.
- Keyboard and screen-reader behaviour noted on each page.
- Filters in the URL.
- Only the two blocking validations from EXPERIENCE.md, plus the 5.5 erasure rule.
