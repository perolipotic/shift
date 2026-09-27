import { Building2, CalendarDays, Flame, Palette, Save } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { InputGroup, InputGroupIcon } from '@/components/ui/input-group';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { Select } from '@/components/ui/select';
import { t } from '@/lib/i18n';
import {
  fireRanksControlKey,
  fireRanksMessageKey,
  fireRanksStatusMessageKey,
  fireRanksValue,
  FIRE_RANKS_OPTIONS,
} from '@/features/members/utils/rank';
import { OrganizationLogoCard } from '@/features/organization/components/organization-logo-card';
import type { OrganizationSettings } from '@/features/organization/hooks/use-organization-settings';
import {
  accentMessageKey,
  brandAccentOf,
  brandAccentValue,
  BRAND_ACCENT_OPTIONS,
  NO_BRAND_ACCENT,
} from '@/features/organization/utils/accent';
import { storedAccentLabel } from '@/features/organization/utils/accent-label';
import { LEAVE_START_DAYS, LEAVE_START_MONTHS } from '@/features/organization/utils/leave-start';
import { ORGANIZATION_ERROR_ID, organizationMessageKey } from '@/features/organization/utils/messages';

/**
 * The settings screen's main card (stories 1.4a-1.4c and member rank): the
 * one message region, the logo block, and the form.
 *
 * WHAT IS DELIBERATELY NOT HERE:
 *
 *   - THE SLUG. AD-12 builds every member's sign-in address as
 *     `username@slug.shift.invalid`, and `0002:61-69` stores it rather than
 *     deriving it precisely because transliterating a name is not reproducible.
 *     Editing it would silently refuse every existing credential in the
 *     organization.
 *   - THE LOCALE. `LOCALE` is a hard-coded constant (`lib/i18n/format.ts:43`) and
 *     the resource tree is typed as `typeof hr`, so the application is
 *     single-locale by construction. A control whose value changes nothing on
 *     screen is the dead affordance the voice rules exist to prevent.
 *   - NOTHING ABOUT THE ACCENT BEYOND WHICH ONE. The control offers four
 *     curated keys and "no accent" and no way to express anything else: no hex
 *     field, no colour picker, no free-form value. Every colour in this
 *     application has its contrast measured at BUILD time, and an
 *     admin-entered colour would move that guarantee to runtime for the sake of
 *     an exact brand match. `0006` and `@/features/organization/utils/accent`
 *     carry the argument; what belongs here is that the control cannot express
 *     the thing the rule forbids.
 *   - `destructive`. UX-DR4 reserves that token exclusively for an unresolved
 *     conflict, and a refused save is not one — the refusal is a bordered
 *     `role="alert"`, the same shape `/prijava/$slug` uses.
 *
 * WHICH ACCENT, NEVER WHAT COLOUR. The accent `<select>` carries keys —
 * `blue`, `green`, `amber`, `violet` and the empty string for none — and the
 * colours live in `index.css` beside the other tokens, measured by
 * `test/theme-contrast.test.ts` in both themes. A key outside the set is
 * refused by `0006`'s check constraint rather than by this screen, which is
 * the same division every other refusal on this surface follows.
 *
 * THE ACCENT AND THE FIRE-RANK SETTING ARE WRITES OF THEIR OWN, NOT FIELDS. They
 * sit INSIDE the form and each travels on its own update the instant the
 * choice is made, through `chooseAccent` and `chooseFireRanks`. Why on change
 * rather than on submit, and why the separation is a type:
 * `useOrganizationSettings`.
 *
 * Sizing: `h-11` is 44 px, the tap-target floor UX-DR40 sets, on every field
 * and every button — the inherited shadcn primitives are `h-9`.
 */
export function OrganizationSettingsCard({
  settings,
}: {
  readonly settings: OrganizationSettings;
}): ReactNode {
  const {
    snapshot,
    organization,
    refusal,
    nameField,
    monthField,
    dayField,
    pending,
    submit,
    savingAccent,
    savingFireRanks,
    fireRanksRevision,
    chooseAccent,
    chooseFireRanks,
    busy,
    writingElsewhere,
    writingBesideFireRanks,
  } = settings;

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
              aria-describedby={refusal === null ? undefined : ORGANIZATION_ERROR_ID}
              className="h-11"
            />
          </InputGroup>
        </div>
        {/* THE LEAVE YEAR'S START, a day and a month under one legend. Not a
            date picker: the setting recurs yearly, so a year would mean
            nothing, and `0002:106` admits days 1-28 by SHAPE, which two closed
            lists express and a calendar cannot. See `@/features/organization/utils/leave-start`. */}
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
                aria-describedby={refusal === null ? undefined : ORGANIZATION_ERROR_ID}
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
                  aria-describedby={refusal === null ? undefined : ORGANIZATION_ERROR_ID}
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
              aria-describedby={refusal === null ? undefined : ORGANIZATION_ERROR_ID}
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
              aria-describedby={refusal === null ? undefined : ORGANIZATION_ERROR_ID}
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
          {/* Disabled on EVERY flag. The four writes share one message
              region, so a save started while an upload, an accent write or a
              fire-rank write is in flight would take the region from a refusal
              nobody has read yet. */}
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
          <Notice id={ORGANIZATION_ERROR_ID} role="alert">
            {t(organizationMessageKey(refusal))}
          </Notice>
        )}
        <OrganizationLogoCard settings={settings} />
        {renderSettings()}
      </CardContent>
    </Card>
  );
}
