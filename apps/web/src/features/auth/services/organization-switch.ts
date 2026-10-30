import { organizationDestination, organizationOfAddress } from '@/features/auth/services/address';
import { SIGN_OUT_FAILED, type SignOutOutcome, type SignOutFailure } from '@/features/auth/services/sign-out';

/**
 * A sign-in link for another organization than the session's (retro 10 A5).
 *
 * `/prijava/$slug` sent every signed-in visitor where `povratak` pointed, in
 * the organization they were signed in to, whatever the slug said. A member of
 * two organizations who tapped organization B's email or push while signed in
 * to A landed on B's path inside A. Now such a link OFFERS B: sign out of A
 * first, then B's form keeping the return path; or stay in A.
 *
 * Pure, so the node suite executes every case (AD-15); `prijava.tsx`'s
 * `beforeLoad` asks it and the offer screen draws its answer.
 */
export interface OrganizationSwitch {
  /** The organization the session is signed in to (its slug). */
  readonly current: string;
  /** The organization the link names (its slug, normalized). */
  readonly target: string;
}

/**
 * The offer, or `null` to follow the link as before.
 *
 * `null` when the link's slug and the session's agree (both normalized), and
 * when either cannot be read: a session address that does not parse as AD-12's
 * (`organizationOfAddress`) keeps today's redirect rather than guessing.
 */
export function organizationSwitchOf(
  sessionEmail: string | null | undefined,
  linkSlug: string,
): OrganizationSwitch | null {
  const target = organizationDestination(linkSlug);
  const current = organizationOfAddress(sessionEmail);

  if (target === null || current === null || target === current) return null;

  return { current, target };
}

/**
 * The switch's steps, injected so the sequence runs in the node suite with
 * stubs (AD-15); `use-organization-switch.ts` binds them to the session end,
 * the router and the console.
 */
export interface OrganizationSwitchSteps {
  /** The full session end (`useEndSession`). May throw. */
  readonly endSession: () => Promise<SignOutOutcome>;
  /** Opens B's form in the app (navigate, then re-run its guard). May throw. */
  readonly openTarget: () => Promise<void>;
  /** Opens B's form as a whole-document load. May throw. */
  readonly reloadTarget: () => Promise<void>;
  readonly log: (cause: unknown) => void;
}

export type OrganizationSwitchOutcome =
  /** Signed out, and B's form opened in the app. */
  | { readonly kind: 'switched' }
  /** Signed out, the in-app navigation failed, and B's form was loaded as a document. */
  | { readonly kind: 'reloaded' }
  /** The session SURVIVED (refused, or the end threw before it ended): A is untouched; say so. */
  | { readonly kind: 'refused'; readonly code: SignOutFailure };

/**
 * The switch, in order: end A's session; only once it ended, open B's form.
 * A refused or throwing session end is `refused` and nothing navigates. Past
 * the end, the person IS signed out, so a failed navigation never reads as a
 * failed sign-out: B's form is loaded as a document instead, and a failure of
 * that too is only logged.
 */
export async function runOrganizationSwitch(steps: OrganizationSwitchSteps): Promise<OrganizationSwitchOutcome> {
  let outcome: SignOutOutcome;

  try {
    outcome = await steps.endSession();
  } catch (cause) {
    steps.log(cause);

    return { kind: 'refused', code: SIGN_OUT_FAILED };
  }

  if (!outcome.ok) return { kind: 'refused', code: outcome.code };

  try {
    await steps.openTarget();

    return { kind: 'switched' };
  } catch (cause) {
    steps.log(cause);
  }

  try {
    await steps.reloadTarget();
  } catch (cause) {
    steps.log(cause);
  }

  return { kind: 'reloaded' };
}

/** The code to put on screen for a switch, or `null` when nothing failed that the person must hear about. */
export function failureOfSwitch(outcome: OrganizationSwitchOutcome): SignOutFailure | null {
  return outcome.kind === 'refused' ? outcome.code : null;
}

/** Logged when staying in A could not navigate; the person is still signed in and may press again. */
export const ORGANIZATION_SWITCH_STAY_FAILED = 'ORGANIZATION_SWITCH_STAY_FAILED';
