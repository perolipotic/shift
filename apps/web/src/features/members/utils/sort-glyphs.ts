import { ArrowDown, ArrowUp } from 'lucide-react';

import { ARROW_DOWN, ARROW_UP, type SortIndicator } from '@/features/members/services/list';

/**
 * The glyph each sort direction draws on the member list.
 *
 * A RECORD KEYED BY THE MODULE'S OWN NAMES, never a ternary: which way the arrow
 * points is `sortIndicatorOf`'s decision and is pinned by execution, and what is
 * left here is only the pairing of a direction to an icon. `prijava.test.ts`
 * pins THAT at source level, because a rendered icon is the one thing no node
 * test can see — and an arrow pointing the wrong way is worse than none, since
 * it contradicts a correct `aria-sort` on the same element.
 */
export const SORT_GLYPHS: Record<SortIndicator, typeof ArrowUp> = {
  [ARROW_UP]: ArrowUp,
  [ARROW_DOWN]: ArrowDown,
};
