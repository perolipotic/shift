import { Check, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { IconTile } from '@/components/ui/icon-tile';
import { StatTile, StatTileLabel, StatTileValue } from '@/components/ui/stat-tile';
import {
  Timeline,
  TimelineLegend,
  TimelineLegendItem,
  TimelineBoundaries,
  TimelineGap,
  TimelineScale,
  TimelineSegment,
  TimelineTrack,
} from '@/components/ui/timeline';
import {
  DAY_SCALE,
  durationMessageKey,
  durationValuesOf,
  type HourBandDisplayRow,
  type PartitionBar,
} from '@/features/hour-bands/services/list';
import { t } from '@/lib/i18n';

/**
 * The 24-hour bar, its legend and its text equivalent.
 *
 * THE BAR IS `aria-hidden`. Its text equivalent is the list above it and the
 * coverage sentence beside it, which state every figure it draws in words.
 * Nothing on it is colour alone: each covered stretch carries its band's name,
 * and the uncovered one is hatched AND flagged.
 */
export function HourBandTimeline({
  rows,
  bar,
}: {
  readonly rows: readonly HourBandDisplayRow[];
  readonly bar: PartitionBar;
}): ReactNode {
  /** The 24-hour bar. Hidden from assistive technology: see the comment above. */
  function renderBar(partition: PartitionBar): ReactNode {
    return (
      <Timeline aria-hidden={true}>
        <TimelineScale marks={DAY_SCALE} />
        <TimelineTrack>
          {partition.segments.map((segment) =>
            segment.name === null || segment.tone === null ? (
              <TimelineGap key={segment.key} widthPercent={segment.widthPercent}>
                {/* THE FLAG, on a solid chip over an opaque backing, so the text
                    never sits on the stripes: the chip over the page background
                    is the pair `theme-contrast.test.ts` measures. */}
                <span className="flex min-w-0 rounded-sm bg-background">
                  <span className="truncate rounded-sm bg-modifier-uncovered px-1 text-xs font-medium text-modifier-uncovered-foreground">
                    {t('organization.hourBands.uncovered')}
                  </span>
                </span>
              </TimelineGap>
            ) : (
              <TimelineSegment key={segment.key} tone={segment.tone} widthPercent={segment.widthPercent}>
                <span className="truncate">{segment.name}</span>
              </TimelineSegment>
            ),
          )}
        </TimelineTrack>
        <TimelineBoundaries marks={partition.boundaries} />
      </Timeline>
    );
  }

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle asChild>
          <h2>{t('organization.hourBands.timelineHeading')}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-5">
        {renderBar(bar)}
        <TimelineLegend aria-hidden={true}>
          {rows.map((row) => (
            <TimelineLegendItem key={row.band.id} tone={row.tone}>
              {row.band.name}
            </TimelineLegendItem>
          ))}
        </TimelineLegend>
        {/* THE BAR'S TEXT EQUIVALENT: every figure it draws, in words. */}
        <div className="grid gap-3 sm:grid-cols-2">
          <StatTile>
            <IconTile variant="primary">
              <Check />
            </IconTile>
            <div className="min-w-0">
              <StatTileLabel>{t('organization.hourBands.covered')}</StatTileLabel>
              <StatTileValue>
                {t('organization.hourBands.coveredValue', {
                  covered: t(durationMessageKey(bar.coveredMinutes), durationValuesOf(bar.coveredMinutes)),
                })}
              </StatTileValue>
            </div>
          </StatTile>
          <StatTile>
            <IconTile>
              <TriangleAlert />
            </IconTile>
            <div className="min-w-0">
              <StatTileLabel>{t('organization.hourBands.uncovered')}</StatTileLabel>
              <StatTileValue>
                {t(durationMessageKey(bar.uncoveredMinutes), durationValuesOf(bar.uncoveredMinutes))}
              </StatTileValue>
            </div>
          </StatTile>
        </div>
      </CardContent>
    </Card>
  );
}
