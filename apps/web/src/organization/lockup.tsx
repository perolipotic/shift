import { t } from '@/i18n';
import { brandAccentAppearance, LOCKUP_COMPACT, LOCKUP_FULL } from '@/organization/accent';
import { organizationLogoMark } from '@/organization/logo';
import type { OrganizationSnapshot } from '@/organization/snapshot';

/**
 * The organization's lockup: its logo, or the neutral mark that stands in for
 * one (story 1.4c, UX-DR5).
 *
 * ONE COMPONENT, TWO SURFACES. Story 1.4b drew this logic on the settings
 * screen — the only place in the application an organization's own logo
 * appeared was the screen where you upload it — and this story puts it in the
 * navigation chrome, on every signed-in screen at every width. Written twice it
 * would be two answers to "what does an organization with no logo look like",
 * and they would drift: the fallback, the accessible name, the broken-image
 * path and the accent are four decisions each, and eight decisions in two
 * places is eight opportunities for one copy to be fixed.
 *
 * NEVER A BROKEN IMAGE, which is the acceptance criterion and takes three
 * separate defences because a signed URL is a capability with a deadline rather
 * than an address. `@/organization/logo-url` bounds the cache below the expiry,
 * hands over `null` for a URL that could not be signed at all, and takes
 * `onUnrenderable` when the browser fails to load one that looked fine — the
 * case no timer predicts. All three land on the same neutral mark, which is a
 * thing to look at rather than a report of an absence.
 *
 * NEVER A SILENT IMAGE EITHER. `alt` is the organization's name, and the name
 * can be blank — `0002:72` makes that unreachable from the database, but an
 * `alt=""` is how HTML says "this image is decorative", so a screen reader
 * would announce the organization's own logo as nothing at all. Both branches
 * fall back to the same generic label, so the two can never disagree about what
 * a nameless organization sounds like.
 *
 * THE ACCENT LANDS HERE AND ON THE CHROME'S EDGES, and nowhere else. UX-DR5
 * scopes the tint to the application shell and the logo lockup; every shift
 * fill, every modifier signal, `primary` and `destructive` are untouched, and
 * `@/organization/accent` is where that scope is written down as three named
 * slots rather than as a rule somebody has to remember.
 * `apps/web/src/organization/accent.test.ts` asserts the class literals name no
 * ramp or modifier token at all.
 *
 * AN UNKNOWN ACCENT PAINTS NEUTRAL rather than throwing. `0006`'s check
 * constraint makes an unrenderable key unrepresentable today, but a row written
 * by a build that knew a fifth accent and read by one that does not is what a
 * forward-only migration stream plus a static SPA on a CDN produces during a
 * deploy. The untinted shell is the honest answer; a thrown render would be a
 * blank application for everybody in that organization.
 *
 * NOTHING HERE IS A CONTROL. The lockup is not pressable, carries no handler a
 * person can reach, and is therefore outside UX-DR40's 44 px floor — which is
 * why it may be 32 px in the phone bar, where nine real targets already compete
 * for the width. Its type scale travels with its box for the same reason the
 * box is a constant: a mark is the first code point of an admin-entered name,
 * and one fixed scale for both sizes clips a wide glyph at the small one.
 */

export interface OrganizationLockupProps {
  /** The one snapshot, or `null` while the read has not settled. */
  readonly organization: OrganizationSnapshot | null;
  /** A signed URL the browser may render, or `null` for the neutral mark. */
  readonly logoUrl: string | null;
  /** Called when the browser cannot load a URL that was signed successfully. */
  readonly onUnrenderable: () => void;
  /** Whether the organization read is still in flight, so a skeleton is honest. */
  readonly pending: boolean;
  /** The chrome's size rather than the settings surface's. */
  readonly compact: boolean;
}

export function OrganizationLockup({
  organization,
  logoUrl,
  onUnrenderable,
  pending,
  compact,
}: OrganizationLockupProps) {
  const scale = compact ? LOCKUP_COMPACT : LOCKUP_FULL;

  if (organization === null) {
    // A SKELETON THE SIZE OF THE LOCKUP, never a spinner (UX-DR40), and gated
    // on the read being PENDING rather than on there being no snapshot: gated
    // the other way a settled failure pulses forever and is indistinguishable
    // from a slow network. Without it the chrome and the card have no lockup at
    // all until the row arrives and then grow one, moving everything beside it
    // under whatever the pointer was already heading for.
    return pending ? (
      <div className={`${scale.box} shrink-0 animate-pulse rounded-md bg-muted`} />
    ) : null;
  }

  const appearance = brandAccentAppearance(organization.brandAccent);
  // `null` only for a name that is blank or whitespace only, which `0002:72`
  // makes unreachable from the database — but an empty accessible name on a
  // `role="img"`, and an empty `alt` on an `<img>`, are both announced as
  // nothing at all. One fallback for both branches.
  const mark = organizationLogoMark(organization.name);
  const named = mark === null ? t('organization.lockup') : organization.name;

  if (logoUrl === null) {
    return (
      <span
        role="img"
        aria-label={named}
        className={`${scale.box} ${scale.type} ${appearance.mark} ${appearance.frame} flex shrink-0 items-center justify-center overflow-hidden rounded-md border font-semibold uppercase`}
      >
        {mark}
      </span>
    );
  }

  return (
    <img
      src={logoUrl}
      alt={named}
      onError={onUnrenderable}
      className={`${scale.box} ${appearance.frame} shrink-0 rounded-md border object-contain`}
    />
  );
}
