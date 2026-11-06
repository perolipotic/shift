import type { ReactNode, RefObject } from 'react';

import { Notice } from '@/components/ui/notice';
import type { SwapProposedLine } from '@/features/swaps/services/swap-proposal';
import { t } from '@/lib/i18n';

/** The status line *Kalendar* shows after a landed proposal, naming the shift taken in return where there was one: polite, focused once drawn. */
export function SwapProposedLine({
  proposed,
  lineField,
}: {
  readonly proposed: SwapProposedLine | null;
  readonly lineField: RefObject<HTMLParagraphElement | null>;
}): ReactNode {
  if (proposed === null) return null;

  return (
    <Notice ref={lineField} role="status" tabIndex={-1}>
      {proposed.withReturn
        ? t(proposed.key, proposed.values)
        : t(proposed.key, proposed.values)}
    </Notice>
  );
}
