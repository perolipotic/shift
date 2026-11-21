# Epic 19 UX review: signup and onboarding (2026-11-21)

**Status: pending founder acceptance.**

AD-24 requires a UX review with mockups before story 19.4's spec freezes. Architect pass 2 (#338) planned what it covers:

- `/registracija`, `/potvrda` and `/zaboravljena-lozinka`;
- `/postavljanje` steps 1–7, at phone and desktop width;
- the *Danas* onboarding card;
- the empty states.

The review ran as a headless `bmad-ux` update. It adds **UX-DR62–70** to `../../epics.md`. It also updates `../ux-shift-2026-09-02/EXPERIENCE.md` (four inventory rows, the self-service UJ-5 flow, the empty-state rule and a *Signup and onboarding (epic 19)* section) and `../ux-shift-2026-09-02/DESIGN.md` (*setup-rail*, *concept explainer*, *Postavljanje card*, and the signup "Don't"). Those spines win over these mockups, and each rule binds from the story that ships it.

Inputs:

- epic 19 in `epics.md`;
- PRD FR-93–FR-101;
- spine AD-12, AD-21–AD-25 and the AP2 amendments;
- the shipped `hr.json` strings of the embedded surfaces;
- the direction G register.

Constraints held: SM-C3 and DI-8 (nothing pre-filled, nothing pilot- or fire-specific), the wizard reuses the shipped screens (D9), anti-enumeration (FR-99, AD-22), Croatian copy, and a team is a *Smjena*.

## Mockups

Start at `mockups/index.html`. Each file is self-contained HTML in the format of `../ux-shift-2026-10-01-redesign/mockups/`:

- inline CSS, with Google Fonts (Outfit) as the only external resource;
- phone frames at 390 px and desktop frames at 1080 px;
- light and dark themes that follow the system, with a *Sustav / Svijetla / Tamna* switch and `?theme=` for renders.

The sample data is invented and organization-neutral: *Tvrtka Primjer*, `tvrtka-primjer`, `ivana.horvat@example.com`.

| Mockup | Covers |
|---|---|
| `mockups/signup-1.html` | *Prijava* with email (UX-DR62); `/registracija`, the one *Provjeri e-poštu* answer, the throttled resend, the 429 answer, an unconfirmed sign-in and `/potvrda` (UX-DR63); recovery in place, `/zaboravljena-lozinka` and `/potvrda?type=recovery` (UX-DR64) |
| `mockups/onboarding-1.html` | Step 1 *Nova organizacija*, including the slug proposal (UX-DR66); the setup frame and rail (UX-DR65); steps 2–6 empty, filled and with a missing prerequisite (UX-DR67); step 7 with steps left and with none left (UX-DR68); the phone's *Svi koraci* sheet |
| `mockups/danas-and-empty-states-1.html` | The *Postavljanje* card on admin *Danas* and its *Sakrij* confirmation (UX-DR69); *Pokrivenost danas*, *Kalendar*, *Ljudi*, *Postavke rotacije* and *Sati* in a fresh organization (UX-DR70) |

The steps 2–6 mockups sketch where the shipped sections sit, under one explainer. The sections themselves are the shipped components, unchanged.

## Key decisions

1. **One entry field on *Prijava*, nothing moves.** *Korisničko ime ili e-mail* takes either kind of entry (AD-12). While the entry holds an `@`, the Organizacija field stays in place but is dimmed and unsent, so nothing above the cursor jumps. Each kind has one failure message for every cause.
2. **Signup is offered only on `/prijava` without a slug.** A member who follows their organization's link is never invited to found another organization.
3. **One neutral screen for signup, resend and recovery.** It shows the typed address, which is the user's own fact, with *Ispravi adresu*. The resend is throttled on the page for 60 s. The only other answer is the per-IP 429, and it is about the network.
4. **One password field on `/registracija`, with show/hide and the live floor.** There is no repeat field, because an email identity can recover by email.
5. **`/potvrda` acts only on a press** (*Potvrdi*, *Spremi novu lozinku*). A dead link names no address. Confirming goes straight to step 1, on any device.
6. **Step 1 proposes only what the user gave.** The slug comes from the typed name, and the timezone comes from the device and must be confirmed, because it is locked afterwards. Everything else starts empty and unselected. A taken slug answers with a proposal and no reason.
7. **A setup frame, not the app shell.** It has a lockup, *Izađi iz postavljanja*, a rail (`Korak {n} od 7`, each step *postavljeno* / *nije postavljeno*, derived) and one forward control. That control reads *Preskoči za sada* until the step's fact exists, then *Dalje: {step}*. Steps open in any order, and a missing prerequisite is said on the step that needs it.
8. **Explain, never suggest.** Each unfinished step has one Callout with organization-neutral examples. Nothing is pre-selected in any add dialog.
9. **The *Danas* card comes first**, above *Treba tebe*, while fact steps remain. *Sakrij* is one neutral question and hides the card for every admin (one column). No new entry point is added after dismissal.
10. **Empty states name the setup as the reason.** For example, `Još nema nijedne smjene.`, not `Danas nijedna smjena ne radi.`. The literal sweep matches `Dan` / `Noć` / `Slobodno` as shift names, so the shipped `Dan od 24 sata` is not a false hit.

## Open items for the founder

- **O1. The pilot literal on *Prijava*.** `auth.organization.placeholder` reads `npr. dvd-kastel-novi`, and every stranger meets it after confirming. Recommended: `npr. naziv-organizacije`, which changes what the pilot sees too. This is outside 19.4's `signup`/`onboarding` sweep, so 19.2 should take it.
- **O2. Terms and privacy on `/registracija`.** The review adds no checkbox and no link, because none exists in the product. Whether self-service signup needs a privacy notice or terms link before production (D-S5) is a founder and legal decision.
- **O3. Defaults in shipped dialogs.** FR-97 says no onboarding step pre-selects a count, duration, boundary or name. 19.4's spec must check the shipped add dialogs embedded in steps 2–6 for anything selected by default and clear it: the shift type's kind and times, the rotation's *Vrijedi od*, and the new member's level. Because the dialogs are shared (D9), that changes them everywhere.
- **Recorded, not open:**
  - The resend countdown (60 s) and the 429 copy (`za sat vremena`) follow AD-21's configured limits. The copy changes if the limits change.
  - Founder decisions F1 (mail timing) and F2 (the meaning of "or invitation") are unchanged. The design assumes F2's default, admin-issued credentials.

## Rendering

The mockups were rendered with Playwright's bundled headless Chromium (`chromium_headless_shell-1243`, run with `LD_LIBRARY_PATH` set to locally extracted libraries, as for story 16.1), in light and dark, as full pages and per section. The images were then looked at. The PNGs are not committed.
