import type { ReactNode } from 'react';

import { HourBandTable } from '@/features/hour-bands/components/hour-band-table';
import { HourBandTimeline } from '@/features/hour-bands/components/hour-band-timeline';
import type { HourBandListScreen } from '@/features/hour-bands/hooks/use-hour-band-list';

const SKELETON_ROWS = [0, 1, 2];

/**
 * The list's body below the page's notices: the skeleton while the one read
 * is pending, then the table of bands and the 24-hour bar, both drawn from
 * that one answer and neither shown until it has arrived.
 */
export function HourBandListSection({ screen }: { readonly screen: HourBandListScreen }): ReactNode {
  const { loading, rows, bar } = screen;

  return (
    <>
      {loading ? (
        <div className="grid gap-2">
          {SKELETON_ROWS.map((row) => (
            <div key={row} className="h-11 w-full animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      ) : null}
      {rows === null || bar === null ? null : (
        <>
          <HourBandTable rows={rows} />
          <HourBandTimeline rows={rows} bar={bar} />
        </>
      )}
    </>
  );
}
