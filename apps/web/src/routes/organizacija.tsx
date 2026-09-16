import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { t } from '@/i18n';
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
 * `Organizacija` — the organization settings surface (story 1.4a).
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
 *   - LOGO AND ACCENT. Part B, recorded in `deferred-work.md`: they need a
 *     storage bucket and two columns that do not exist.
 *   - `destructive`. UX-DR4 reserves that token exclusively for an unresolved
 *     conflict, and a refused save is not one — the refusal is a bordered
 *     `role="alert"`, the same shape `/prijava/$slug` uses.
 *
 * The session guard is NOT here. It is registered once on the pathless `_app`
 * layout this route nests under.
 *
 * Sizing: `h-11` is 44 px, the tap-target floor UX-DR40 sets, on all five fields
 * and both buttons — the inherited shadcn primitives are `h-9`.
 */
export function OrganizacijaScreen() {
  const queryClient = useQueryClient();
  const nameField = useRef<HTMLInputElement>(null);
  const typeField = useRef<HTMLInputElement>(null);
  const timezoneField = useRef<HTMLInputElement>(null);
  const monthField = useRef<HTMLInputElement>(null);
  const dayField = useRef<HTMLInputElement>(null);
  // A REF as well as state, and the two are not redundant: state drives the
  // disabled buttons, and state is stale inside a handler already called once
  // this tick. The ref is written synchronously, so it is what the guard reads.
  const saving = useRef(false);
  const [failure, setFailure] = useState<OrganizationFailure | null>(null);
  const [pending, setPending] = useState(false);

  const snapshot = useQuery({
    queryKey: ORGANIZATION_SNAPSHOT_KEY,
    queryFn: () => readOrganization(supabaseClient().from(ORGANIZATION_TABLE)),
  });

  const answered = snapshot.data;
  const organization = answered !== undefined && answered.ok ? answered.snapshot : null;
  // The save's refusal wins over the read's: if a save has just been refused,
  // that is the thing the person is waiting to hear about.
  const refusal: OrganizationFailure | null =
    failure ?? (answered !== undefined && !answered.ok ? answered.code : null);

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
      saving.current
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
          <Button className="h-11 w-full" type="submit" disabled={pending}>
            {t('organization.save')}
          </Button>
          {/* `type="reset"`, which on an uncontrolled form is exactly what
              cancelling means: every field goes back to the `defaultValue`
              the snapshot gave it. Nothing to write, nothing to navigate
              away from, and no confirmation step — it discards an edit
              that was never saved. */}
          <Button className="h-11 w-full" type="reset" variant="outline" disabled={pending}>
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
