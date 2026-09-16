import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import { useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { t } from '@/i18n';
import {
  LOGO_UNAVAILABLE,
  LOGO_URL_STALE_MS,
  NO_FILE_CHOSEN,
  ORGANIZATION_LOGO_ACCEPT,
  ORGANIZATION_LOGO_BUCKET,
  organizationLogoKey,
  organizationLogoMark,
  readOrganizationLogoUrl,
  replaceOrganizationLogo,
  type LogoFailure,
  type LogoUrlOutcome,
} from '@/organization/logo';
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
 *   - THE ACCENT. Part C, recorded in `deferred-work.md`: UX-DR5 scopes the
 *     tint to the application shell and the logo lockup, and neither exists.
 *     The LOGO is here now, as of story 1.4b.
 *   - `destructive`. UX-DR4 reserves that token exclusively for an unresolved
 *     conflict, and a refused save is not one — the refusal is a bordered
 *     `role="alert"`, the same shape `/prijava/$slug` uses.
 *
 * The session guard is NOT here. It is registered once on the pathless `_app`
 * layout this route nests under.
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
  const typeField = useRef<HTMLInputElement>(null);
  const timezoneField = useRef<HTMLInputElement>(null);
  const monthField = useRef<HTMLInputElement>(null);
  const dayField = useRef<HTMLInputElement>(null);
  const logoField = useRef<HTMLInputElement>(null);
  // A REF as well as state, and the two are not redundant: state drives the
  // disabled buttons, and state is stale inside a handler already called once
  // this tick. The ref is written synchronously, so it is what the guard reads.
  const saving = useRef(false);
  const uploading = useRef(false);
  // ONE FAILURE SLOT for both vocabularies, because there is one message region:
  // a second `role="alert"` would be a second thing competing to be announced,
  // and the five fields would have to choose which of the two to describe
  // themselves by. `@/organization/messages` maps both code sets for the same
  // reason.
  const [failure, setFailure] = useState<OrganizationFailure | LogoFailure | null>(null);
  const [pending, setPending] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  // WHICH URL failed to load, not merely THAT one did. A boolean would stay
  // true across the next signed URL and hide a logo that renders perfectly;
  // holding the URL means the fallback clears itself the moment a different one
  // arrives, which is what a refetch after an expiry produces.
  const [unrenderable, setUnrenderable] = useState<string | null>(null);

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
  const logoPath = organization === null ? null : organization.logoPath;

  // DERIVED, never independent (AD-13). The key is the snapshot's own with the
  // path appended, the fetch is skipped entirely when there is no logo, and a
  // failure here surfaces as the neutral fallback rather than as a message: a
  // reference that resolves to nothing is the same thing to look at as no
  // reference, and `@/organization/logo` explains why the two cannot be told
  // apart anyway.
  const logo = useQuery({
    queryKey: organizationLogoKey(logoPath),
    queryFn: () => renderableLogo(logoPath),
    enabled: logoPath !== null,
    // NO RETRIES. A refused cross-tenant read is settled, not slow: retrying it
    // costs three storage calls per mount and answers the same 404 each time,
    // and it leaves a persistently failing read indistinguishable from an
    // organization that simply has no logo for as long as the backoff lasts.
    retry: false,
    // BELOW THE EXPIRY the signed URL carries, so a tab left open across the
    // hour refetches instead of rendering a dead capability.
    staleTime: LOGO_URL_STALE_MS,
  });

  const signed = logo.data ?? null;
  const readable = signed !== null && signed.ok ? signed.url : null;
  const logoUrl = readable === unrenderable ? null : readable;

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const name = nameField.current;
    const type = typeField.current;
    const timezone = timezoneField.current;
    const month = monthField.current;
    const day = dayField.current;

    if (
      organization === null ||
      name === null ||
      type === null ||
      timezone === null ||
      month === null ||
      day === null ||
      saving.current ||
      uploading.current
    ) {
      return;
    }

    saving.current = true;
    setFailure(null);
    setPending(true);

    try {
      const outcome = await updateOrganization(
        supabaseClient().from(ORGANIZATION_TABLE),
        organization.id,
        {
          name: name.value,
          organizationType: type.value,
          timezone: timezone.value,
          leaveYearStartMonth: Number(month.value),
          leaveYearStartDay: Number(day.value),
        },
      );

      if (!outcome.ok) {
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
      console.error(ORGANIZATION_UNAVAILABLE, cause);
      setFailure(ORGANIZATION_UNAVAILABLE);
    } finally {
      // On EVERY path, including the successful one: clearing it only on failure
      // is how a button ends up disabled forever with nothing on screen saying
      // why.
      saving.current = false;
      setPending(false);
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
   * A signed URL for the logo the snapshot points at, or nothing to point at.
   *
   * The READ's failure never reaches the message region: a reference that
   * resolves to nothing and no reference at all are the same thing to look at,
   * and `@/organization/logo` explains why the service cannot tell them apart
   * anyway. It is logged instead, for the reason every other stable code in this
   * application is — a persistently unreadable logo is a fault somebody should
   * be able to diagnose, and silence is how it stays undiagnosed.
   */
  async function renderableLogo(path: string | null): Promise<LogoUrlOutcome | null> {
    if (path === null) return null;

    const outcome = await readOrganizationLogoUrl(
      supabaseClient().storage.from(ORGANIZATION_LOGO_BUCKET),
      path,
    );

    if (!outcome.ok) console.error(outcome.code, path);

    return outcome;
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
    if (organization === null || uploading.current || saving.current) {
      return;
    }

    uploading.current = true;
    setFailure(null);
    setUploadingLogo(true);

    try {
      const outcome = await replaceOrganizationLogo(
        supabaseClient().storage.from(ORGANIZATION_LOGO_BUCKET),
        supabaseClient().from(ORGANIZATION_TABLE),
        organization,
        file,
      );

      if (!outcome.ok) {
        setFailure(outcome.code);

        return;
      }

      // A NEW URL IS COMING, so whatever failed to render before is no longer
      // the reason to fall back.
      setUnrenderable(null);

      // ONE INVALIDATION for both figures. The derived URL is keyed under this
      // key, so refetching the row refetches the preview with it.
      await queryClient.invalidateQueries({ queryKey: ORGANIZATION_SNAPSHOT_KEY });
    } catch (cause) {
      console.error(LOGO_UNAVAILABLE, cause);
      setFailure(LOGO_UNAVAILABLE);
    } finally {
      uploading.current = false;
      setUploadingLogo(false);
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

  /** A signed URL the browser could not load. Falls back rather than showing a
   *  broken image — the second line of defence behind {@link LOGO_URL_STALE_MS},
   *  because a URL can stop working for reasons no timer predicts. */
  function markLogoUnrenderable(): void {
    setUnrenderable(logoUrl);
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
      // A SKELETON THE SIZE OF THE MARK, for the reason `renderSettings` draws
      // one: without it the card has no logo block at all until the row
      // arrives and then grows one, which moves every control below it under
      // whatever the pointer was already heading for.
      return snapshot.isPending ? (
        <div className="h-16 w-16 animate-pulse rounded-md bg-muted" />
      ) : null;
    }

    // `null` only for a name that is blank or whitespace only, which `0002:72`
    // makes unreachable from the database — but an empty accessible name on a
    // `role="img"` is an element a screen reader announces as nothing at all,
    // so the generic destination label stands in rather than nothing.
    const mark = organizationLogoMark(organization.name);
    const busy = pending || uploadingLogo;

    return (
      <div className="grid gap-2">
        <p className="text-sm font-medium leading-none">{t('organization.logo')}</p>
        <div className="flex items-center gap-4">
          {logoUrl === null ? (
            <span
              role="img"
              aria-label={mark === null ? t('nav.organizacija') : organization.name}
              className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md border border-input bg-muted text-lg font-semibold uppercase"
            >
              {mark}
            </span>
          ) : (
            <img
              src={logoUrl}
              alt={organization.name}
              onError={markLogoUnrenderable}
              className="h-16 w-16 shrink-0 rounded-md border border-input object-contain"
            />
          )}
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
            variant="outline"
            disabled={busy}
            aria-busy={uploadingLogo}
            aria-describedby={refusal === null ? undefined : 'organization-error'}
            onClick={openLogoPicker}
          >
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
        </div>
        <div className="grid gap-2">
          <Label htmlFor="organization-type">{t('organization.type')}</Label>
          {/* Free text, and inert by contract (`0002:87`): two
              organizations differing only in type produce byte-identical
              output, so nothing branches on this value and no enumeration
              of the types we happened to think of today belongs here. */}
          <Input
            ref={typeField}
            id="organization-type"
            name="organizationType"
            type="text"
            required
            defaultValue={organization.organizationType}
            aria-describedby={refusal === null ? undefined : 'organization-error'}
            className="h-11"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="organization-timezone">{t('organization.timezone')}</Label>
          {/* The organization is the frame (L8): this value, and never the
              device's, is what every date and time in the application
              renders in. An IANA name, unchecked against
              `pg_timezone_names` for the reason `0002:93` records. */}
          <Input
            ref={timezoneField}
            id="organization-timezone"
            name="timezone"
            type="text"
            autoCapitalize="none"
            autoCorrect="off"
            required
            defaultValue={organization.timezone}
            aria-describedby={refusal === null ? undefined : 'organization-error'}
            className="h-11"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="organization-leave-month">
            {t('organization.leaveYearStartMonth')}
          </Label>
          <Input
            ref={monthField}
            id="organization-leave-month"
            name="leaveYearStartMonth"
            type="number"
            min={1}
            max={12}
            step={1}
            required
            defaultValue={organization.leaveYearStartMonth}
            aria-describedby={refusal === null ? undefined : 'organization-error'}
            className="h-11"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="organization-leave-day">
            {t('organization.leaveYearStartDay')}
          </Label>
          {/* 28, not 31, and the control is where that stops being
              expressible: `0002:106` admits 1-28 by SHAPE rather than by
              validation, because a leave year starting on the 30th has no
              boundary in February. A control that could express 30 would
              turn a shape into a refusal the person has to read. */}
          <Input
            ref={dayField}
            id="organization-leave-day"
            name="leaveYearStartDay"
            type="number"
            min={1}
            max={28}
            step={1}
            required
            defaultValue={organization.leaveYearStartDay}
            aria-describedby={refusal === null ? undefined : 'organization-error'}
            className="h-11"
          />
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {/* Disabled on EITHER flag. The two handlers share one message
              region, so a save started while an upload is in flight would take
              the region from a refusal nobody has read yet. */}
          <Button
            className="h-11 w-full"
            type="submit"
            disabled={pending || uploadingLogo}
            aria-busy={pending}
          >
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
            disabled={pending || uploadingLogo}
          >
            {t('organization.cancel')}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <main className="flex flex-1 justify-center p-6">
      <Card className="w-full max-w-lg">
        <CardHeader>
          {/* An `<h1>`, not `CardTitle`: that primitive renders a `div`, and
              this screen's name is the document's only heading. It is the
              DESTINATION's own key — the screen is what `Organizacija` names,
              so a second heading string would be the same word authored twice
              and one of the two would be a string nobody renders. */}
          <h1 className="text-xl font-semibold leading-none tracking-tight">
            {t('nav.organizacija')}
          </h1>
        </CardHeader>
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
            <p
              id="organization-error"
              role="alert"
              className="rounded-md border border-input px-3 py-2 text-sm font-medium"
            >
              {t(organizationMessageKey(refusal))}
            </p>
          )}
          {renderLogo()}
          {renderSettings()}
        </CardContent>
      </Card>
    </main>
  );
}

export const organizacijaRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/organizacija',
  component: OrganizacijaScreen,
});
