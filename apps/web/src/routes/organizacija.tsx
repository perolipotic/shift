import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createRoute } from '@tanstack/react-router';
import {
  Building2,
  CalendarDays,
  Clock3,
  Flame,
  Palette,
  Save,
  Upload,
} from 'lucide-react';
import { useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card';
import { IconTile } from '@/components/ui/icon-tile';
import { InputGroup, InputGroupIcon } from '@/components/ui/input-group';
import { PageActions, PageDescription, PageHeader, PageTitle } from '@/components/ui/page-header';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { Select } from '@/components/ui/select';
import { t } from '@/i18n';
import {
  fireRanksClearsFailure,
  fireRanksControlKey,
  fireRanksFollowUpOf,
  fireRanksMessageKey,
  fireRanksOf,
  fireRanksStatusMessageKey,
  fireRanksStepOf,
  fireRanksValue,
  FIRE_RANKS_OPTIONS,
  FIRE_RANKS_QUEUE,
} from '@/members/rank';
import {
  accentMessageKey,
  brandAccentOf,
  brandAccentValue,
  BRAND_ACCENT_OPTIONS,
  NO_BRAND_ACCENT,
  type BrandAccentKey,
} from '@/organization/accent';
import { LEAVE_START_DAYS, LEAVE_START_MONTHS } from '@/organization/leave-start';
import { OrganizationLockup } from '@/organization/lockup';
import {
  LOGO_UNAVAILABLE,
  NO_FILE_CHOSEN,
  ORGANIZATION_LOGO_ACCEPT,
  ORGANIZATION_LOGO_BUCKET,
  replaceOrganizationLogo,
  type LogoFailure,
} from '@/organization/logo';
import { useRenderableLogo } from '@/organization/logo-url';
import { organizationMessageKey } from '@/organization/messages';
import {
  ORGANIZATION_SNAPSHOT_KEY,
  ORGANIZATION_TABLE,
  ORGANIZATION_UNAVAILABLE,
  readOrganization,
  updateOrganization,
  type OrganizationFailure,
} from '@/organization/snapshot';
import { appLayoutRoute } from '@/routes/_app';
import { supabaseClient } from '@/supabase/client';

/**
 * `Organizacija` — the organization settings surface (stories 1.4a and 1.4b).
 *
 * ADMIN ONLY (UX-DR32), and that is enforced by the DATABASE rather than here.
 * `organizations_update_by_own_active_admin` (`0004`) is the whole of it: a
 * member-role session, an admin naming another tenant and a deactivated admin
 * are all refused identically through this form and through a direct API call,
 * because AD-9 leaves no server tier and both are the same call. What this file
 * owes is that the refusal is visible and that nothing typed is lost — not a
 * second gate that would be the softer of the two and could disagree with the
 * first.
 *
 * ONE SNAPSHOT, ONE QUERY KEY (AD-13). Every value below comes from the single
 * `useQuery` under `ORGANIZATION_SNAPSHOT_KEY`; there is no second read on this
 * screen and there must not be one, because independent keys are precisely what
 * put a stale figure beside a fresh one.
 *
 * UNCONTROLLED, through refs, exactly as `/prijava/$slug` is. UX-DR34 says a
 * refused save keeps every entered value, and uncontrolled inputs keep what was
 * typed because nothing re-renders them away — so the state this screen holds is
 * the FAILURE and the in-flight flag, never the field values. A settings form
 * has five fields rather than two, so it has more to lose from getting that
 * wrong, not less.
 *
 * WHAT IS DELIBERATELY NOT HERE:
 *
 *   - THE SLUG. AD-12 builds every member's sign-in address as
 *     `username@slug.shift.invalid`, and `0002:61-69` stores it rather than
 *     deriving it precisely because transliterating a name is not reproducible.
 *     Editing it would silently refuse every existing credential in the
 *     organization.
 *   - THE LOCALE. `LOCALE` is a hard-coded constant (`i18n/format.ts:43`) and
 *     the resource tree is typed as `typeof hr`, so the application is
 *     single-locale by construction. A control whose value changes nothing on
 *     screen is the dead affordance the voice rules exist to prevent.
 *   - NOTHING ABOUT THE ACCENT BEYOND WHICH ONE. The control offers four
 *     curated keys and "no accent" and no way to express anything else: no hex
 *     field, no colour picker, no free-form value. Every colour in this
 *     application has its contrast measured at BUILD time, and an
 *     admin-entered colour would move that guarantee to runtime for the sake of
 *     an exact brand match. `0006` and `@/organization/accent` carry the
 *     argument; what belongs here is that the control cannot express the thing
 *     the rule forbids.
 *   - `destructive`. UX-DR4 reserves that token exclusively for an unresolved
 *     conflict, and a refused save is not one — the refusal is a bordered
 *     `role="alert"`, the same shape `/prijava/$slug` uses.
 *
 * The session guard is NOT here. It is registered once on the pathless `_app`
 * layout this route nests under.
 *
 * THE ACCENT IS A THIRD WRITE AND NOT A SIXTH FIELD (story 1.4c), and it sits
 * INSIDE the form where the logo sits beside it — which makes the disjoint
 * shape matter more rather than less. `{ brandAccent }` travels on its own
 * update the instant the choice is made, so a save of the five identity fields
 * cannot carry an accent chosen while somebody was typing, and choosing an
 * accent cannot push a half-typed name to the database. The write is applied on
 * CHANGE rather than on submit for exactly that reason: a control whose effect
 * is the whole shell tinting itself is one whose effect should be visible
 * immediately, and waiting for the form's submit would make the accent the one
 * field on the screen whose save is somebody else's button.
 *
 * WHICH ACCENT, NEVER WHAT COLOUR. The `<select>` carries keys — `blue`,
 * `green`, `amber`, `violet` and the empty string for none — and the colours
 * live in `index.css` beside the other fifty-one, measured by
 * `test/theme-contrast.test.ts` in both themes. A key outside the set is
 * refused by `0006`'s check constraint rather than by this screen, which is the
 * same division every other refusal on this surface follows.
 *
 * THE LOGO IS A SECOND WRITE AND NOT A SIXTH FIELD (story 1.4b). It travels on
 * its own update — `{ logoPath }`, which `@/organization/snapshot` types as a
 * shape disjoint from the form's five fields — so a save of the identity fields
 * cannot carry a stale `logo_path` over a logo uploaded while somebody was
 * typing, and an upload cannot carry a half-typed name. The two are seconds
 * apart in practice, which is exactly why the separation is a type rather than
 * a convention.
 *
 * PRESENCE IS A COLUMN, NOT A PROBE. Whether there is a logo at all is
 * `snapshot.logoPath`, which the one read already carries; nothing here asks
 * storage the question. The signed URL that renders it IS a second query, and it
 * is not a second snapshot: it is keyed UNDER the snapshot's key
 * (`organizationLogoKey`), derived from a value that read returned, and it never
 * runs at all when there is no logo. One invalidation after a write therefore
 * refreshes both.
 *
 * NOTHING ANNOUNCES AN ABSENCE. With no logo the screen draws a neutral mark
 * carrying the organization's name as its accessible name — never a sentence
 * saying there is none, which is both the voice rule (state the fact) and a
 * `hr.json` sweep: `Nema` is banned from every built chunk by
 * `test/localization-applied.test.ts`.
 *
 * Sizing: `h-11` is 44 px, the tap-target floor UX-DR40 sets, on all five fields
 * and all three buttons — the inherited shadcn primitives are `h-9`. The file
 * input itself is `sr-only` rather than hidden: it keeps its accessible name and
 * stays reachable by keyboard, while the control a pointer meets is a `<Button>`
 * that reads in Croatian. A native file input renders its own chrome in the
 * BROWSER's language, which is the one string on this screen that could never
 * come from `hr.json`.
 */
export function OrganizacijaScreen() {
  const queryClient = useQueryClient();
  const nameField = useRef<HTMLInputElement>(null);
  const monthField = useRef<HTMLSelectElement>(null);
  const dayField = useRef<HTMLSelectElement>(null);
  const logoField = useRef<HTMLInputElement>(null);
  // A REF as well as state, and the two are not redundant: state drives the
  // disabled buttons, and state is stale inside a handler already called once
  // this tick. The ref is written synchronously, so it is what the guard reads.
  const saving = useRef(false);
  const uploading = useRef(false);
  const tinting = useRef(false);
  // The fire-rank setting's own in-flight flag and queue, on the accent's
  // terms: it also writes on change, alone, beside the form.
  const ranking = useRef(false);
  const queuedFireRanks = useRef<boolean | undefined>(undefined);
  // THE ACCENT CHOSEN WHILE THE LAST ONE WAS STILL IN FLIGHT, or `undefined` for
  // none — and `undefined` rather than `null` because `null` is itself a choice
  // somebody can make. Dropping it on the floor is what this replaces: the
  // control is a `<select>`, an arrow key is a change event in several browsers,
  // and a person who lands on the accent they wanted two keys past the one they
  // passed through would have had the SECOND write silently discarded while the
  // first painted the shell. Latest wins, and the last thing chosen is what the
  // row ends up holding.
  const queuedAccent = useRef<BrandAccentKey | null | undefined>(undefined);
  // ONE FAILURE SLOT for both vocabularies, because there is one message region:
  // a second `role="alert"` would be a second thing competing to be announced,
  // and the five fields would have to choose which of the two to describe
  // themselves by. `@/organization/messages` maps both code sets for the same
  // reason.
  const [failure, setFailure] = useState<OrganizationFailure | LogoFailure | null>(null);
  const [pending, setPending] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [savingAccent, setSavingAccent] = useState(false);
  const [savingFireRanks, setSavingFireRanks] = useState(false);
  // Moves on every refused setting write, so the setting control remounts to
  // what the row holds instead of showing the refused choice.
  const [fireRanksRevision, setFireRanksRevision] = useState(0);
  // ONE FLAG FOR FOUR HANDLERS, because there is one message region and one
  // row: a save started while an upload, an accent write or a setting write is
  // in flight would take the region from a refusal nobody has read yet. Named
  // once rather than spelled out on each control, so a fifth handler cannot be
  // added to some of them and forgotten on the rest.
  const busy = pending || uploadingLogo || savingAccent || savingFireRanks;
  // WHAT THE ACCENT CONTROL IS DISABLED BY, and it deliberately excludes its
  // OWN write. `disabled` on an element that currently has focus moves focus to
  // `<body>`, so a control that disables itself from inside its own `onChange`
  // ejects every keyboard user from it on every choice — and then re-enables
  // itself somewhere they are no longer standing. The other three handlers
  // still lock it, because all four share one row and one message region; its
  // own write is serialised by `queuedAccent` instead.
  const writingElsewhere = pending || uploadingLogo || savingFireRanks;
  // The same rule for the fire-rank setting: locked by the other writes, never
  // by its own.
  const writingBesideFireRanks = pending || uploadingLogo || savingAccent;

  const snapshot = useQuery({
    queryKey: ORGANIZATION_SNAPSHOT_KEY,
    queryFn: () => readOrganization(supabaseClient().from(ORGANIZATION_TABLE)),
  });

  const answered = snapshot.data;
  const organization = answered !== undefined && answered.ok ? answered.snapshot : null;
  // The save's refusal wins over the read's: if a save has just been refused,
  // that is the thing the person is waiting to hear about.
  const refusal: OrganizationFailure | LogoFailure | null =
    failure ?? (answered !== undefined && !answered.ok ? answered.code : null);
  // DERIVED, never independent (AD-13), and SHARED with the navigation chrome
  // since story 1.4c. The key is the snapshot's own with the path appended, the
  // fetch is skipped entirely when there is no logo, and a failure surfaces as
  // the neutral fallback rather than as a message: a reference that resolves to
  // nothing is the same thing to look at as no reference, and
  // `@/organization/logo` explains why the two cannot be told apart anyway. Two
  // copies of it were two `queryFn`s registered for one key.
  const logo = useRenderableLogo(organization === null ? null : organization.logoPath);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const name = nameField.current;
    const month = monthField.current;
    const day = dayField.current;

    if (
      organization === null ||
      name === null ||
      month === null ||
      day === null ||
      saving.current ||
      uploading.current ||
      tinting.current ||
      ranking.current
    ) {
      return;
    }

    saving.current = true;
    setFailure(null);
    setPending(true);
    let refused = false;

    try {
      const outcome = await updateOrganization(
        supabaseClient().from(ORGANIZATION_TABLE),
        organization.id,
        {
          name: name.value,
          // NOT ON THIS FORM (design refresh C): inert by contract
          // (`0002:87`), nothing reads it, so it is written back unchanged.
          organizationType: organization.organizationType,
          // NOT ON THIS FORM (design refresh C): the zone is shown beside it
          // and written back unchanged, so a save never moves it.
          timezone: organization.timezone,
          leaveYearStartMonth: Number(month.value),
          leaveYearStartDay: Number(day.value),
        },
      );

      if (!outcome.ok) {
        refused = true;
        setFailure(outcome.code);

        return;
      }

      // REFETCHED rather than patched into the cache, so what is on screen after
      // a save is what the database holds — including anything a shape on the
      // table normalized on the way in.
      await queryClient.invalidateQueries({ queryKey: ORGANIZATION_SNAPSHOT_KEY });
    } catch (cause) {
      // Everything `updateOrganization` does not already map: the client
      // throwing `SUPABASE_ENVIRONMENT_MISSING` on a build with no environment,
      // and a refetch that rejects. Logged as well as surfaced, because a
      // misconfiguration reading as an outage is only the smaller cost while the
      // cause reaches the console (`supabase/client.ts`).
      refused = true;
      console.error(ORGANIZATION_UNAVAILABLE, cause);
      setFailure(ORGANIZATION_UNAVAILABLE);
    } finally {
      // On EVERY path, including the successful one: clearing it only on failure
      // is how a button ends up disabled forever with nothing on screen saying
      // why.
      saving.current = false;
      setPending(false);
      drainFireRanks(refused);
    }
  }

  /**
   * Opens the file picker the visible action stands in for.
   *
   * `.click()` on a `sr-only` input rather than a styled `<label>`, because the
   * control that has to clear UX-DR40's 44 px floor is the one a pointer meets,
   * and that is the `<Button>`.
   */
  function openLogoPicker(): void {
    logoField.current?.click();
  }

  /**
   * Hands the chosen file to the one module that knows what uploading means.
   *
   * THE SEQUENCE IS NOT HERE. `replaceOrganizationLogo` points the row at the
   * key and then writes the object, in that order and against the SNAPSHOT
   * rather than an id — which is what removes the mutation a screen-side
   * sequence permits: passing the slug instead of the id typechecks, lints and
   * leaves every assertion green while every upload is refused by policy.
   * `logo.test.ts` executes the ordering and the path; nothing here could.
   *
   * GUARDED ON BOTH FLAGS, like `submit`. The two handlers share one message
   * region and one alert, so whichever finished last used to own it — and
   * `setFailure(null)` below would erase a refusal the person had not read yet.
   */
  async function uploadLogo(file: Blob): Promise<void> {
    if (
      organization === null ||
      uploading.current ||
      saving.current ||
      tinting.current ||
      ranking.current
    ) {
      return;
    }

    uploading.current = true;
    setFailure(null);
    setUploadingLogo(true);
    let refused = false;

    try {
      const outcome = await replaceOrganizationLogo(
        supabaseClient().storage.from(ORGANIZATION_LOGO_BUCKET),
        supabaseClient().from(ORGANIZATION_TABLE),
        organization,
        file,
      );

      if (!outcome.ok) {
        refused = true;
        setFailure(outcome.code);

        return;
      }

      // ONE INVALIDATION for both figures. The derived URL is keyed under this
      // key, so refetching the row refetches the preview with it.
      await queryClient.invalidateQueries({ queryKey: ORGANIZATION_SNAPSHOT_KEY });
    } catch (cause) {
      refused = true;
      console.error(LOGO_UNAVAILABLE, cause);
      setFailure(LOGO_UNAVAILABLE);
    } finally {
      uploading.current = false;
      setUploadingLogo(false);
      drainFireRanks(refused);
    }
  }

  /**
   * What the file picker hands back.
   *
   * The input is RESET afterwards, and that is a real defect otherwise: a file
   * input fires no `change` event when the same file is chosen twice running,
   * so "the upload was refused, try that file again" would do nothing at all —
   * the retry a person is most likely to attempt.
   */
  function chooseLogo(event: ChangeEvent<HTMLInputElement>): void {
    const chosen = event.target.files?.[0];

    event.target.value = NO_FILE_CHOSEN;

    if (chosen !== undefined) void uploadLogo(chosen);
  }

  /**
   * Writes the chosen accent, on its own and on its own key.
   *
   * ITS OWN WRITE, not a sixth field on the submit. `{ brandAccent }` is a
   * shape `@/organization/snapshot` types as disjoint from the five identity
   * fields and from the logo reference, so none of the three can carry another
   * — and the compiler is what says so rather than a convention somebody has to
   * remember.
   *
   * GUARDED ON THE OTHER THREE HANDLERS, and QUEUED against itself. All four
   * share one row and one message region, so a save, an upload or a setting
   * write in flight has
   * to lock this out — `setFailure(null)` below would otherwise erase a refusal
   * nobody had read yet. Its own second press is a different case: dropping it
   * would leave the row holding an accent the person passed through on the way
   * to the one they wanted, so the latest choice is remembered and applied when
   * the first settles.
   *
   * A REFUSAL KEEPS THE CHOICE ON SCREEN. The control is uncontrolled, like
   * every other field here, so a refused write leaves the `<select>` showing
   * what was chosen rather than snapping back to the stored value — UX-DR34,
   * and the same reason the five inputs are refs. What is NOT left to the
   * control is the claim about the row: the status line beside it reads the
   * accent out of the SNAPSHOT, so a refused write is visible as a control and
   * a row that disagree rather than as nothing at all.
   */
  async function applyAccent(accent: BrandAccentKey | null): Promise<void> {
    if (organization === null || saving.current || uploading.current || ranking.current) return;

    // LATEST WINS rather than first wins. The write in flight cannot be
    // recalled, so the choice made over the top of it is held and applied in
    // the `finally` below.
    if (tinting.current) {
      queuedAccent.current = accent;

      return;
    }

    tinting.current = true;
    setFailure(null);
    setSavingAccent(true);
    let refused = false;

    try {
      const outcome = await updateOrganization(
        supabaseClient().from(ORGANIZATION_TABLE),
        organization.id,
        { brandAccent: accent },
      );

      if (!outcome.ok) {
        refused = true;
        setFailure(outcome.code);

        return;
      }

      // ONE INVALIDATION, and it refreshes the chrome as well as this card: the
      // navigation reads the organization under this very key, so the shell
      // tints itself from the same refetch rather than from a second read.
      //
      // ITS FAILURE IS NOT THE WRITE'S. The row has already changed by the time
      // this runs, so a refetch that rejects — an aborted navigation, a
      // transport fault — must not be reported as a refused save: that would
      // tell somebody their accent was rejected while the database holds it and
      // the next reload shows it. Logged where a fault can be diagnosed, and
      // the stale figure it leaves behind is the ordinary consequence of a read
      // that did not land.
      try {
        await queryClient.invalidateQueries({ queryKey: ORGANIZATION_SNAPSHOT_KEY });
      } catch (cause) {
        console.error(ORGANIZATION_UNAVAILABLE, cause);
      }
    } catch (cause) {
      refused = true;
      console.error(ORGANIZATION_UNAVAILABLE, cause);
      setFailure(ORGANIZATION_UNAVAILABLE);
    } finally {
      tinting.current = false;
      setSavingAccent(false);

      const next = queuedAccent.current;

      queuedAccent.current = undefined;
      if (next !== undefined) void applyAccent(next);
      else drainFireRanks(refused);
    }
  }

  /**
   * Writes the fire-rank setting, on its own, the moment it changes.
   *
   * THE ACCENT'S SHAPE, for the accent's reasons — a fourth disjoint write
   * (`OrganizationFireRanksEdit`) and a failed refetch kept out of the write's
   * own outcome — with three rules of its own, each executed in
   * `@/members/rank`:
   *
   *   - QUEUED, NEVER DROPPED, while ANY write is in flight (`fireRanksStepOf`):
   *     the latest choice is held and applied when that write settles.
   *   - A QUEUED FOLLOW-UP DOES NOT CLEAR THE MESSAGE REGION
   *     (`fireRanksClearsFailure`), which may hold the outcome of the write it
   *     waited for — `uploadLogo`'s guidance about an unread refusal.
   *   - AFTER A REFUSAL THE QUEUE IS DROPPED (`fireRanksFollowUpOf`), and a
   *     refused setting write remounts the control to what the row holds.
   *
   * Switching it off hides ranks everywhere and deletes none.
   */
  async function applyFireRanks(uses: boolean, fromQueue = false): Promise<void> {
    if (organization === null) return;

    const writingElsewhereNow = saving.current || uploading.current || tinting.current;

    if (fireRanksStepOf(writingElsewhereNow, ranking.current) === FIRE_RANKS_QUEUE) {
      queuedFireRanks.current = uses;

      return;
    }

    ranking.current = true;
    if (fireRanksClearsFailure(fromQueue)) setFailure(null);
    setSavingFireRanks(true);
    let refused = false;

    try {
      const outcome = await updateOrganization(
        supabaseClient().from(ORGANIZATION_TABLE),
        organization.id,
        { usesFireRanks: uses },
      );

      if (!outcome.ok) {
        refused = true;
        setFailure(outcome.code);

        return;
      }

      try {
        await queryClient.invalidateQueries({ queryKey: ORGANIZATION_SNAPSHOT_KEY });
      } catch (cause) {
        console.error(ORGANIZATION_UNAVAILABLE, cause);
      }
    } catch (cause) {
      refused = true;
      console.error(ORGANIZATION_UNAVAILABLE, cause);
      setFailure(ORGANIZATION_UNAVAILABLE);
    } finally {
      ranking.current = false;
      setSavingFireRanks(false);
      // A REFUSAL REMOUNTS THE CONTROL, so it shows what the row holds rather
      // than the choice the database just refused.
      if (refused) setFireRanksRevision((revision) => revision + 1);
      drainFireRanks(refused);
    }
  }

  /**
   * Applies a setting choice held while another write was in flight — or
   * drops it, when that write was refused. Called from every handler's
   * `finally`, so a queued choice is never stranded.
   */
  function drainFireRanks(refused: boolean): void {
    const next = fireRanksFollowUpOf(queuedFireRanks.current, refused);

    queuedFireRanks.current = undefined;
    if (next !== undefined) void applyFireRanks(next, true);
  }

  function chooseFireRanks(event: ChangeEvent<HTMLSelectElement>): void {
    void applyFireRanks(
      fireRanksOf(event.target.value, organization?.usesFireRanks ?? false),
    );
  }

  /**
   * What the row holds, named the way the control names it.
   *
   * THE SAME ANSWER THE SELECTED OPTION GIVES, including for an accent this
   * build does not know: `accentMessageKey` folds an unrecognised key to
   * `Neutralna` — which is right for the class it resolves, and would be a lie
   * here, where the whole job is to say what the DATABASE holds. So an
   * unrenderable accent reads as its stored value, exactly as its option does.
   * Data, never a key: this build has no name for it.
   */
  function storedAccentLabel(accent: string | null): ReactNode {
    return brandAccentOf(accent) === null && accent !== null
      ? accent
      : t(accentMessageKey(accent));
  }

  /**
   * What the accent control hands back: a curated key, or `null` for no accent.
   *
   * `brandAccentOf` is what makes the crossing safe in the one direction that
   * matters: the control's value is a string, the column admits four words and
   * null, and anything else — including the raw value of an accent a newer
   * build stored, which this screen renders as its own option — resolves to the
   * `null` that returns the organization to the untinted shell.
   */
  function chooseAccent(event: ChangeEvent<HTMLSelectElement>): void {
    void applyAccent(brandAccentOf(event.target.value));
  }

  /**
   * The logo as it stands, or a neutral mark carrying the organization's name.
   *
   * A FUNCTION for the reason `renderSettings` is one, and gated on the same
   * snapshot: there is nothing to draw a mark for until the row has been read,
   * and the mark's accessible name IS the organization's name.
   *
   * The fallback says nothing. It is a mark, not a sentence — the voice rule is
   * to state the fact rather than the absence, and there is no fact here beyond
   * whose organization this is.
   */
  function renderLogo(): ReactNode {
    if (organization === null) {
      // A SKELETON THE SIZE OF THE LOCKUP, for the reason `renderSettings`
      // draws one: without it the card has no logo block at all until the row
      // arrives and then grows one, which moves every control below it under
      // whatever the pointer was already heading for. Drawn by the lockup
      // itself, so the size is one fact rather than two that can disagree.
      return snapshot.isPending ? (
        <OrganizationLockup
          organization={organization}
          logoUrl={logo.url}
          onUnrenderable={logo.onUnrenderable}
          pending={snapshot.isPending}
          compact={false}
        />
      ) : null;
    }

    return (
      <div className="grid gap-3">
        <div>
          <p className="text-sm font-semibold leading-none">{t('organization.logo')}</p>
          <p className="mt-1.5 text-xs text-muted-foreground">{t('organization.logoHint')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          {/* THE LOCKUP, shared with the navigation chrome rather than drawn
              twice. The logo-or-mark decision, the accessible name, the
              broken-image fallback and the accent are four decisions, and two
              copies of them are two places for one copy to be fixed. */}
          <OrganizationLockup
            organization={organization}
            logoUrl={logo.url}
            onUnrenderable={logo.onUnrenderable}
            pending={snapshot.isPending}
            compact={false}
          />
          {/* `disabled` on the INPUT as well as on the button: only the button
              carried it, so a keyboard user reaching the control directly could
              choose a second file mid-upload and get silence. */}
          <input
            ref={logoField}
            id="organization-logo"
            name="logo"
            type="file"
            accept={ORGANIZATION_LOGO_ACCEPT}
            onChange={chooseLogo}
            disabled={busy}
            aria-label={t('organization.logoChoose')}
            aria-describedby={refusal === null ? undefined : 'organization-error'}
            className="sr-only"
          />
          <Button
            className="h-11"
            type="button"
            variant="dashed"
            disabled={busy}
            aria-busy={uploadingLogo}
            aria-describedby={refusal === null ? undefined : 'organization-error'}
            onClick={openLogoPicker}
          >
            <Upload aria-hidden />
            {t('organization.logoChoose')}
          </Button>
        </div>
      </div>
    );
  }

  /**
   * The form, or a skeleton until there is a row to seed it from.
   *
   * A FUNCTION rather than a conditional inside the returned JSX, and the reason
   * is mechanical rather than stylistic: `eslint.config.js`'s L2 block refuses a
   * string literal inside a branch NESTED in a branch that is an element's own
   * child, which is exactly what a conditional `aria-describedby` inside a
   * conditionally-rendered form is. The rule is right about the shape it was
   * written for — a hand-rolled plural — and wrong here, and moving the outer
   * branch out of the JSX is the honest fix rather than an `eslint-disable`.
   *
   * A SKELETON, never a spinner (UX-DR40), and never an empty form: the fields
   * would have no defaults to carry, and a form that saves over a row nobody has
   * read yet is worse than no form at all.
   */
  function renderSettings(): ReactNode {
    if (organization === null) {
      // PENDING, never merely "no snapshot". Gated on `organization === null`
      // this returned a skeleton for a read that had already FAILED, so an
      // indefinitely pulsing bar was what a refused or unavailable read looked
      // like — identical to a slow one, with the message that explains it
      // rendered by nothing. The alert lives outside this function now, so a
      // settled failure renders the message and no skeleton.
      return snapshot.isPending ? (
        <div className="h-11 w-full animate-pulse rounded-md bg-muted" />
      ) : null;
    }

    return (
      <form
        method="post"
        onSubmit={(event) => {
          void submit(event);
        }}
        className="grid gap-6"
      >
        <div className="grid gap-2">
          <Label htmlFor="organization-name">{t('organization.name')}</Label>
          <InputGroup>
            <InputGroupIcon>
              <Building2 />
            </InputGroupIcon>
            <Input
              ref={nameField}
              id="organization-name"
              name="name"
              type="text"
              required
              defaultValue={organization.name}
              aria-describedby={refusal === null ? undefined : 'organization-error'}
              className="h-11"
            />
          </InputGroup>
        </div>
        {/* THE LEAVE YEAR'S START, a day and a month under one legend. Not a
            date picker: the setting recurs yearly, so a year would mean
            nothing, and `0002:106` admits days 1-28 by SHAPE, which two closed
            lists express and a calendar cannot. See `@/organization/leave-start`. */}
        <fieldset className="grid min-w-0 gap-2">
          <legend className="mb-2 text-sm font-semibold leading-none">
            {t('organization.leaveYearStart')}
          </legend>
          <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3">
            <div className="grid min-w-0">
              <Label htmlFor="organization-leave-day" className="sr-only">
                {t('organization.leaveYearStartDay')}
              </Label>
              <Select
                ref={dayField}
                id="organization-leave-day"
                name="leaveYearStartDay"
                required
                defaultValue={organization.leaveYearStartDay}
                aria-describedby={refusal === null ? undefined : 'organization-error'}
                className="h-11"
              >
                {LEAVE_START_DAYS.map((day) => (
                  <option key={day} value={day}>
                    {day}
                  </option>
                ))}
              </Select>
            </div>
            <div className="grid min-w-0">
              <Label htmlFor="organization-leave-month" className="sr-only">
                {t('organization.leaveYearStartMonth')}
              </Label>
              <InputGroup>
                <InputGroupIcon>
                  <CalendarDays />
                </InputGroupIcon>
                <Select
                  ref={monthField}
                  id="organization-leave-month"
                  name="leaveYearStartMonth"
                  required
                  defaultValue={organization.leaveYearStartMonth}
                  aria-describedby={refusal === null ? undefined : 'organization-error'}
                  className="h-11"
                >
                  {LEAVE_START_MONTHS.map((month) => (
                    <option key={month.value} value={month.value}>
                      {month.label}
                    </option>
                  ))}
                </Select>
              </InputGroup>
            </div>
          </div>
        </fieldset>
        <div className="grid gap-2">
          <Label htmlFor="organization-accent">{t('organization.accent')}</Label>
          {/* A CLOSED SET AND NOTHING ELSE. Five options — four curated accents
              and no accent — because every colour in this application has its
              contrast measured at build time, and a hex field or a colour
              picker would move that guarantee to runtime. The values are KEYS;
              `0006`'s check constraint is what refuses one outside the set, so
              a direct API call fails at the database rather than here.

              The `Select` primitive, a NATIVE `<select>` rather than a styled
              listbox: the native element already carries keyboard behaviour,
              an accessible name through its `<Label>`, and a phone's own
              picker sheet. Its options read in Croatian from `hr.json` —
              unlike a file input's chrome, which is the browser's.

              WRITTEN ON CHANGE, on its own disjoint update. The effect is the
              whole shell tinting itself, so it should be visible when it is
              chosen rather than when somebody presses a button four fields
              away — and travelling alone is what stops it clobbering a
              half-typed name. */}
          <InputGroup>
            <InputGroupIcon>
              <Palette />
            </InputGroupIcon>
            <Select
              /* REMOUNTED WHEN THE ROW CHANGES, and that is what `key` is doing
                 here rather than a list identity. A `<select>`'s `defaultValue`
                 sets `defaultSelected` at MOUNT and never again, so after a
                 successful write the element's reset state still named the
                 accent the row held when the screen opened — and `Cancel`, which
                 is `type="reset"`, would snap the control back to an accent the
                 database no longer holds. Keying on the stored value remounts the
                 element exactly when that state has to move, so reset always
                 restores what the row actually says. */
              key={organization.brandAccent ?? NO_BRAND_ACCENT}
              id="organization-accent"
              name="brandAccent"
              defaultValue={organization.brandAccent ?? NO_BRAND_ACCENT}
              onChange={chooseAccent}
              disabled={writingElsewhere}
              aria-busy={savingAccent}
              aria-describedby={refusal === null ? undefined : 'organization-error'}
              className="h-11"
            >
                {/* THE ACCENT THIS BUILD DOES NOT KNOW, rendered as its own option
                  rather than collapsed into `Neutralna`. A forward-only migration
                  stream and a static SPA are not promoted at the same instant, so
                  a row carrying an accent a newer build wrote is an ordinary
                  state — and folding it into the first option made the control
                  claim the organization had no accent AND made every other option
                  unreachable by keyboard, because selecting the one already shown
                  fires no change event. Shown, the row is described honestly and
                  every other option is one change away.

                  Its label is the stored VALUE and not a key: it is data this
                  build has no name for, and data is never a key. */}
              {brandAccentOf(organization.brandAccent) === null &&
              organization.brandAccent !== null ? (
                <option value={organization.brandAccent}>{organization.brandAccent}</option>
              ) : null}
              {BRAND_ACCENT_OPTIONS.map((option) => (
                <option key={brandAccentValue(option)} value={brandAccentValue(option)}>
                  {t(accentMessageKey(option))}
                </option>
              ))}
            </Select>
          </InputGroup>
          {/* WHAT THE ROW HOLDS, beside the control that changes it.
              `role="status"` and not `role="alert"`: the alert region is the
              refusal's, and a second assertive region would be a second thing
              competing to be announced. This is polite, it is the only
              confirmation this write — one of the two on this screen with no
              Save button — gets, and it is read out of the SNAPSHOT rather than out of the
              control — so after a refusal the control shows what was chosen and
              this still shows what the database holds, which is the difference
              somebody needs to see. */}
          <p role="status" className="text-sm text-muted-foreground">
            {storedAccentLabel(organization.brandAccent)}
          </p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="organization-fire-ranks">{t('organization.fireRanks')}</Label>
          {/* MEMBER RANK. Whether the member forms offer a rank and the roster
              shows one. It gates display and entry ONLY: off, stored ranks are
              hidden and survive. Written on change, alone, like the accent,
              and remounted when the row changes for the accent's reason — and
              ALSO on a refused write, unlike the accent, so the control never
              shows a setting the database refused. */}
          <InputGroup>
            <InputGroupIcon>
              <Flame />
            </InputGroupIcon>
            <Select
              key={fireRanksControlKey(organization.usesFireRanks, fireRanksRevision)}
              id="organization-fire-ranks"
              name="usesFireRanks"
              defaultValue={fireRanksValue(organization.usesFireRanks)}
              onChange={chooseFireRanks}
              disabled={writingBesideFireRanks}
              aria-busy={savingFireRanks}
              aria-describedby={refusal === null ? undefined : 'organization-error'}
              className="h-11"
            >
              {FIRE_RANKS_OPTIONS.map((option) => (
                <option key={fireRanksValue(option)} value={fireRanksValue(option)}>
                  {t(fireRanksMessageKey(option))}
                </option>
              ))}
            </Select>
          </InputGroup>
          {/* WHAT THE ROW HOLDS, read out of the snapshot: the confirmation a
              write with no Save button gets. */}
          <p role="status" className="text-sm text-muted-foreground">
            {t(fireRanksStatusMessageKey(organization.usesFireRanks))}
          </p>
        </div>
        <div className="grid gap-2 border-t pt-6 sm:grid-cols-2">
          {/* Disabled on EVERY flag. The four handlers share one message
              region, so a save started while an upload or an accent write is in
              flight would take the region from a refusal nobody has read yet. */}
          <Button
            className="h-11 w-full"
            type="submit"
            disabled={busy}
            aria-busy={pending}
          >
            <Save aria-hidden />
            {t('organization.save')}
          </Button>
          {/* `type="reset"`, which on an uncontrolled form is exactly what
              cancelling means: every field goes back to the `defaultValue`
              the snapshot gave it. Nothing to write, nothing to navigate
              away from, and no confirmation step — it discards an edit
              that was never saved. */}
          <Button
            className="h-11 w-full"
            type="reset"
            variant="outline"
            disabled={busy}
          >
            {t('organization.cancel')}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <main className="mx-auto flex w-full min-w-0 max-w-5xl flex-1 flex-col gap-6 p-6">
      <PageHeader>
        {/* The screen's own `<h1>`, styled by `PageTitle asChild` (visual
            refresh B): this screen's name is the document's only heading. It is the
            DESTINATION's own key — the screen is what `Organizacija` names,
            so a second heading string would be the same word authored twice
            and one of the two would be a string nobody renders. */}
        <div className="min-w-0">
          <PageTitle asChild>
            <h1>
              {t('nav.organizacija')}
            </h1>
          </PageTitle>
          <PageDescription>{t('organization.lede')}</PageDescription>
        </div>
        {/* STORY 2.1b: the hour band editor, reached from here rather than
            from the navigation, so the destinations stay eight. A link in the
            header's actions, as `/ljudi`'s way to the teams is. */}
        <PageActions>
          <Button asChild variant="outline" className="h-11">
            <Link to="/organizacija/satni-pojasi">
              <Clock3 aria-hidden />
              {t('organization.hourBands.heading')}
            </Link>
          </Button>
        </PageActions>
      </PageHeader>
      <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card className="w-full min-w-0 max-w-2xl">
          {/* OUTSIDE the snapshot-gated branch, which is where it used to be and
              where it could not be seen: a read that never produced a row never
              rendered the form, so the one element that explains why was itself
              behind the row existing. `role="alert"` announces it on insertion;
              nothing in the tab order passes through it, and every field points
              at it so it is also reachable by moving between them. Conditional on
              both sides, because a reference to an absent id is ignored in
              silence rather than reported. */}
          <CardContent className="grid gap-6">
            {refusal === null ? null : (
              <Notice id="organization-error" role="alert">
                {t(organizationMessageKey(refusal))}
              </Notice>
            )}
            {renderLogo()}
            {renderSettings()}
          </CardContent>
        </Card>
        {/* WHAT THESE SETTINGS DO, beside them. Explains; announces nothing. */}
        <Card className="min-w-0">
          <CardContent className="grid gap-3">
            <IconTile variant="primary">
              <Building2 />
            </IconTile>
            <CardTitle asChild>
              <h2>{t('organization.aboutTitle')}</h2>
            </CardTitle>
            <CardDescription>{t('organization.aboutBody')}</CardDescription>
            {organization === null ? null : (
              <dl className="grid gap-1 border-t pt-3 text-sm">
                <dt className="text-muted-foreground">{t('organization.timezone')}</dt>
                <dd className="font-semibold">{organization.timezone}</dd>
              </dl>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

export const organizacijaRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/organizacija',
  component: OrganizacijaScreen,
});
