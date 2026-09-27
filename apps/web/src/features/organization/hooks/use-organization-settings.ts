import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { flushSync } from 'react-dom';

import {
  fireRanksClearsFailure,
  fireRanksFollowUpOf,
  fireRanksOf,
  fireRanksStepOf,
  FIRE_RANKS_QUEUE,
} from '@/features/members/utils/rank';
import { brandAccentOf, type BrandAccentKey } from '@/features/organization/utils/accent';
import {
  LOGO_UNAVAILABLE,
  NO_FILE_CHOSEN,
  ORGANIZATION_LOGO_BUCKET,
  replaceOrganizationLogo,
  type LogoFailure,
} from '@/features/organization/services/logo';
import { useRenderableLogo } from '@/features/organization/hooks/logo-url';
import {
  ORGANIZATION_SNAPSHOT_KEY,
  ORGANIZATION_TABLE,
  ORGANIZATION_UNAVAILABLE,
  readFailureOf,
  readOrganization,
  updateOrganization,
  type OrganizationFailure,
  type OrganizationField,
} from '@/features/organization/services/snapshot';
import { offersReadRetry } from '@/features/organization/utils/messages';
import { supabaseClient } from '@/lib/supabase/client';

/**
 * `/organizacija`'s state, its one read and its four writes (stories 1.4a,
 * 1.4b, 1.4c and member rank). The page composes the header and two cards,
 * and each card is a component in `@/features/organization/components` that
 * reads this hook's result. What the cards call is the returned API — `submit`,
 * `openLogoPicker`, `chooseLogo`, `chooseAccent` and `chooseFireRanks`; the
 * writes behind the last three (`uploadLogo`, `applyAccent`, `applyFireRanks`)
 * stay inside the hook.
 *
 * ONE SNAPSHOT, ONE QUERY KEY (AD-13). Every value the screen draws comes from
 * the single `useQuery` below under `ORGANIZATION_SNAPSHOT_KEY`; there is no
 * second read on this screen and there must not be one, because independent
 * keys are precisely what put a stale figure beside a fresh one.
 *
 * UNCONTROLLED, through refs, exactly as `/prijava/$slug` is. UX-DR34 says a
 * refused save keeps every entered value, and uncontrolled inputs keep what was
 * typed because nothing re-renders them away — so the state this hook holds is
 * the FAILURE and the in-flight flags, never the field values.
 *
 * FOUR DISJOINT WRITES, each with its own in-flight ref: the identity form
 * (`submit`), the logo (`uploadLogo`), the accent (`applyAccent`) and the
 * fire-rank setting (`applyFireRanks`).
 *
 * THE SEPARATION IS A TYPE, NOT A CONVENTION. `@/features/organization/services/snapshot`
 * types the form's five fields, `{ logoPath }`, `{ brandAccent }` and
 * `{ usesFireRanks }` as disjoint shapes, so no write can carry another's
 * value and the compiler is what says so. The logo is the case that made it
 * matter (story 1.4b): a save of the identity fields that carried `logo_path`
 * would put a stale reference over a logo uploaded while somebody was typing,
 * and an upload that carried the fields would push a half-typed name. The two
 * are seconds apart in practice, which is exactly why a convention was not
 * enough.
 *
 * THE ACCENT IS A THIRD WRITE AND NOT A SIXTH FIELD (story 1.4c), and it sits
 * INSIDE the form where the logo sits beside it — which makes the disjoint
 * shape matter more rather than less. It is applied on CHANGE rather than on
 * submit: its effect is the whole shell tinting itself, which should be
 * visible the moment it is chosen, and waiting for the form's submit would
 * make the accent the one field on the screen whose save is somebody else's
 * button. The fire-rank setting follows the accent's shape for the accent's
 * reasons.
 *
 * A REFUSED VALUE IS ATTRIBUTED when the database says which: a check
 * violation's constraint maps to one control
 * (`refusedOrganizationFieldOf` in `@/features/organization/services/snapshot`),
 * which the card marks `aria-invalid` and a refused save focuses. An unmapped
 * refusal keeps the general message and marks nothing.
 *
 * A FAILED WRITE IS THE WRITE'S, NEVER THE REFETCH'S. On every one of the four
 * handlers the invalidation that follows a landed write sits in a `try` of its
 * own, so a refetch that rejects is logged and never reported as a refusal of
 * a value the row already holds.
 *
 * PRESENCE IS A COLUMN, NOT A PROBE. Whether there is a logo at all is
 * `snapshot.logoPath`, which the one read already carries; nothing here asks
 * storage. The signed URL that renders it is keyed UNDER the snapshot's key
 * (`organizationLogoKey`) and never runs when there is no logo, so one
 * invalidation after a write refreshes both.
 */
export function useOrganizationSettings() {
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
  // themselves by. `@/features/organization/utils/messages` maps both code sets for the same
  // reason.
  const [failure, setFailure] = useState<OrganizationFailure | LogoFailure | null>(null);
  // WHICH CONTROL the last refusal is about, when the database named one, and
  // `null` otherwise. Set beside every `setFailure` of a write outcome, cleared
  // when a handler starts, and returned only while that failure is still on
  // screen (below), so it can never outlive the refusal it explains.
  const [refusedField, setRefusedField] = useState<OrganizationField | null>(null);
  // How many times the read has been retried: the key the alert is mounted
  // under, so a retry that fails again is announced again (`retryRead`).
  const [readAttempts, setReadAttempts] = useState(0);
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

  // NOT `organizationSnapshotQueryOptions()`, and on purpose. This screen keeps
  // TanStack Query's defaults — no stale bound, so opening it re-reads the row
  // the admin is about to edit — and the factory's five-minute bound would
  // change when that happens. The member screens only read a setting off it.
  const snapshot = useQuery({
    queryKey: ORGANIZATION_SNAPSHOT_KEY,
    queryFn: () => readOrganization(supabaseClient().from(ORGANIZATION_TABLE)),
  });

  const answered = snapshot.data;
  const organization = answered !== undefined && answered.ok ? answered.snapshot : null;
  // The save's refusal wins over the read's: if a save has just been refused,
  // that is the thing the person is waiting to hear about.
  //
  // A READ THAT THREW is a failed read too (`readFailureOf`): the query
  // function builds the client before `readOrganization` can catch anything,
  // so `SUPABASE_ENVIRONMENT_MISSING` arrives as a query error with no data,
  // and it used to leave the card blank — no message and no retry.
  const readFailure = readFailureOf(snapshot);
  const refusal: OrganizationFailure | LogoFailure | null = failure ?? readFailure;
  // THE READ'S OWN RETRY. A failed read renders no form and so no button, and
  // the message tells the person to try again: this is the control that can.
  // Offered only while there is no row and no save refusal on screen, and
  // only for a code whose message says to try again.
  const readRetry =
    organization === null &&
    failure === null &&
    readFailure !== null &&
    offersReadRetry(readFailure);
  // DERIVED, never independent (AD-13), and SHARED with the navigation chrome
  // since story 1.4c. The key is the snapshot's own with the path appended, the
  // fetch is skipped entirely when there is no logo, and a failure surfaces as
  // the neutral fallback rather than as a message: a reference that resolves to
  // nothing is the same thing to look at as no reference, and
  // `@/features/organization/services/logo` explains why the two cannot be told apart anyway. Two
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
    setRefusedField(null);
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
        setRefusedField(outcome.field ?? null);
        // FOCUS GOES TO THE CONTROL THE REFUSAL NAMES, in this handler: the
        // alert can describe a field scrolled out of view on a five-field form.
        // The accent is not on this write, so it has no control here.
        const controls: Partial<Record<OrganizationField, HTMLElement>> = {
          name,
          leaveYearStartDay: day,
          leaveYearStartMonth: month,
        };

        if (outcome.field !== undefined) controls[outcome.field]?.focus();

        return;
      }

      // REFETCHED rather than patched into the cache, so what is on screen after
      // a save is what the database holds — including anything a shape on the
      // table normalized on the way in.
      //
      // ITS FAILURE IS NOT THE WRITE'S, as on the accent path: the row has
      // already changed, so a refetch that rejects is logged and the save is
      // not reported as refused.
      try {
        await queryClient.invalidateQueries({ queryKey: ORGANIZATION_SNAPSHOT_KEY });
      } catch (cause) {
        console.error(ORGANIZATION_UNAVAILABLE, cause);
      }
    } catch (cause) {
      // Everything `updateOrganization` does not already map: the client
      // throwing `SUPABASE_ENVIRONMENT_MISSING` on a build with no environment.
      // Logged as well as surfaced, because a misconfiguration reading as an
      // outage is only the smaller cost while the cause reaches the console
      // (`lib/supabase/client.ts`).
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
   * GUARDED ON ALL FOUR IN-FLIGHT REFS, like `submit`: `uploading`, `saving`,
   * `tinting` and `ranking`. The four writes share one message region and one
   * alert, so whichever finished last used to own it — and `setFailure(null)`
   * below would erase a refusal the person had not read yet.
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
    setRefusedField(null);
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
      // key, so refetching the row refetches the preview with it. Its failure
      // is not the upload's: the object and the row have both landed.
      try {
        await queryClient.invalidateQueries({ queryKey: ORGANIZATION_SNAPSHOT_KEY });
      } catch (cause) {
        console.error(LOGO_UNAVAILABLE, cause);
      }
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
   * shape `@/features/organization/services/snapshot` types as disjoint from the five identity
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
    setRefusedField(null);
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
        // The accent control is the one just changed, so focus is already on
        // it; the mark is what says the refusal is about it.
        setRefusedField(outcome.field ?? null);

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
   * `@/features/members/utils/rank`:
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
        setRefusedField(outcome.field ?? null);

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
      setRefusedField(null);
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
   * Reads the row again after a failed read — the retry the read's message
   * asks for. A second press while the read is in flight does nothing, rather
   * than cancelling that read and starting another.
   *
   * WHAT HAPPENS TO FOCUS AND TO THE ALERT, in this handler rather than an
   * effect. `flushSync` commits the answer before either is decided: the
   * attempt counter keys the alert, so a retry that fails again REMOUNTS it
   * and `role="alert"` announces it again with the same words; and a retry
   * that succeeds unmounts this very button, so focus would drop to `<body>`
   * — it goes to the form's first control, the name field, instead.
   *
   * It never rejects — `refetch` settles an error into the query's state
   * rather than throwing — so it is handed to `onClick` as it is.
   */
  async function retryRead(): Promise<void> {
    if (snapshot.isFetching) return;

    const retried = await snapshot.refetch();

    flushSync(() => {
      setReadAttempts((attempts) => attempts + 1);
    });
    if (retried.data?.ok === true) nameField.current?.focus();
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

  return {
    snapshot,
    organization,
    refusal,
    refusedField: failure === null ? null : refusedField,
    readRetry,
    readAttempts,
    retryRead,
    logo,
    // The identity form.
    nameField,
    monthField,
    dayField,
    pending,
    submit,
    // The logo.
    logoField,
    uploadingLogo,
    openLogoPicker,
    chooseLogo,
    // The accent and the fire-rank setting.
    savingAccent,
    savingFireRanks,
    fireRanksRevision,
    chooseAccent,
    chooseFireRanks,
    // Who is locked by whom.
    busy,
    writingElsewhere,
    writingBesideFireRanks,
  };
}

/** Everything the settings screen's cards read, as the hook returns it. */
export type OrganizationSettings = ReturnType<typeof useOrganizationSettings>;
