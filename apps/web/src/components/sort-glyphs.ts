import { ArrowDown, ArrowUp } from 'lucide-react';

import type { SortControlDirection } from '@/utils/sort-control';

/**
 * THE GLYPH EACH SORT DIRECTION DRAWS, written once for every sorted heading
 * (`./sortable-head`, *Ljudi*'s table) and the phone's sort control
 * (`./sort-control`).
 *
 * A RECORD KEYED BY THE DIRECTION'S OWN NAMES, never a ternary: which way the
 * arrow points is each screen's sort module's decision — `hoursSortArrowOf`,
 * `leaveOverviewSortArrowOf`, `sortIndicatorOf` — pinned by execution beside
 * its `aria-sort`, and what is left here is only the pairing of a direction
 * to an icon. `pages/structural-pins-members.test.ts` pins THAT at source
 * level, because a rendered
 * icon is the one thing no node test can see — and an arrow pointing the
 * wrong way is worse than none, since it contradicts a correct `aria-sort` on
 * the same element.
 */
export const SORT_DIRECTION_GLYPHS: Record<SortControlDirection, typeof ArrowUp> = {
  up: ArrowUp,
  down: ArrowDown,
};
