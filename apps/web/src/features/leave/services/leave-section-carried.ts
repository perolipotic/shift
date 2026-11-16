import type { LeaveBalance, LeavePreview } from '@shift/domain';

import { formatIsoDayMonth } from '@/lib/i18n/format';

/**
 * The carried line and the over-balance warning (story 13.4b), as every
 * balance surface states them. Split out of `leave-section.ts` (epic 13 retro
 * A8), which re-exports its public names; it imports nothing from there.
 */

// ------------------------------------------------------- carried days (13.4b)

/** Carried days not yet expired: every one counts, none lapsed. */
export const CARRIED_PENDING = 'pending';
/** Past the expiry, some carried days lapsed unconsumed. */
export const CARRIED_LAPSED = 'lapsed';
/** Past the expiry, every carried day consumed in time. */
export const CARRIED_KEPT = 'kept';

export type LeaveCarriedKind = typeof CARRIED_PENDING | typeof CARRIED_LAPSED | typeof CARRIED_KEPT;

/**
 * The carried line (story 13.4b, PO 2026-11-12) as every balance surface
 * states it: its shape, the carried days the balance counts, the lapsed days
 * and the expiry as `30.06.`. *Preneseno 5 dana (istječu 30.06.)* before the
 * expiry, *Preneseno 3 dana (2 istekla 30.06.)* after it with days lapsed,
 * *Preneseno 5 dana* after it with none.
 */
export interface LeaveCarriedLine {
  readonly kind: LeaveCarriedKind;
  /** The balance's own `carriedDays`. */
  readonly count: number;
  /** The balance's own `lapsedDays`. */
  readonly lapsed: number;
  /** `30.06.` */
  readonly date: string;
}

/**
 * The carried line of a balance computed at `today` (the balance input's
 * own), or `null` when nothing was carried into the leave year: no line. Every
 * figure is the domain's; only the shape is chosen here, by whether `today`
 * is past the expiry.
 */
export function leaveCarriedLineOf(balance: LeaveBalance, today: string): LeaveCarriedLine | null {
  const expiry = balance.carryOverExpiry;

  if (expiry === null) return null;

  const kind = today <= expiry ? CARRIED_PENDING : balance.lapsedDays > 0 ? CARRIED_LAPSED : CARRIED_KEPT;

  return { kind, count: balance.carriedDays, lapsed: balance.lapsedDays, date: formatIsoDayMonth(expiry) ?? expiry };
}

/**
 * The over-balance warning a preview states (story 13.4b, PO 2026-11-12), or
 * `null` when it states none. When the warning is the expiry's — the balance
 * after the range is still zero or more today, because carried days count
 * until they lapse — it names the expiry and the year's balance after it
 * (`Preneseni dani istječu 30.06.; nakon toga preostaje −2 dana.`); otherwise
 * it is the balance after the range, as before.
 */
export type LeaveExceeds =
  | { readonly kind: typeof EXCEEDS_BALANCE; readonly count: number }
  | { readonly kind: typeof EXCEEDS_AFTER_EXPIRY; readonly count: number; readonly dayMonth: string };

/** Over the balance today. */
export const EXCEEDS_BALANCE = 'balance';
/** Over the balance once the carried days lapse. */
export const EXCEEDS_AFTER_EXPIRY = 'afterExpiry';

export function leaveExceedsOf(
  preview: Pick<
    LeavePreview,
    'exceedsBalance' | 'exceedsAfterExpiry' | 'balanceAfterDays' | 'endBalanceAfterDays' | 'carryOverExpiry'
  >,
): LeaveExceeds | null {
  if (!preview.exceedsBalance) return null;

  const expiry = preview.carryOverExpiry;

  if (preview.exceedsAfterExpiry && expiry !== null) {
    return { kind: EXCEEDS_AFTER_EXPIRY, count: preview.endBalanceAfterDays, dayMonth: formatIsoDayMonth(expiry) ?? expiry };
  }

  return { kind: EXCEEDS_BALANCE, count: preview.balanceAfterDays };
}
