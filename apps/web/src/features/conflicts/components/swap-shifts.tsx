import type { ReactNode } from 'react';

import type { SwapShiftNamed } from '@/features/swaps/services/organization-swaps';
import { t } from '@/lib/i18n';

/** A swap's shift: `13.09.2026 · Smjena B`. */
function shiftShown(shift: SwapShiftNamed): string {
  return t('zaOdluku.swap.shift', { date: shift.dateShown, team: shift.teamName });
}

/**
 * A swap's shifts as every row names them (story 12.4) — *Za odluku*'s, an
 * *Odlučeno* entry's and *Treba tebe*'s: the given shift, and with a return
 * shift `{given} · zauzvrat {back}`. Written once, so the three never drift.
 */
export function SwapShifts({
  given,
  returnShift,
}: {
  readonly given: SwapShiftNamed;
  readonly returnShift: SwapShiftNamed | null;
}): ReactNode {
  return returnShift === null
    ? shiftShown(given)
    : t('zaOdluku.swap.shifts', { given: shiftShown(given), back: shiftShown(returnShift) });
}
