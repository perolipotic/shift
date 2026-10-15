
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { SectionNumber } from '@/components/ui/section-number';
import { Select } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { RotationBuilder } from '@/features/rotation/hooks/use-rotation-builder';
import { PREVIEW_CYCLE_CHOICES, previewGridOf, type RotationDraft } from '@/features/rotation/utils/draft';
import { t } from '@/lib/i18n';

/**
 * The builder's section 4, the preview (stories 2.3b, 2.6; split out of
 * `RotationSection` by the epics 5–7 retro, A21): teams as rows and dates as
 * columns from `Vrijedi od`, over as many cycles as the admin chose to see,
 * every tile from `previewGridOf`.
 */
export function RotationPreviewCard({
  builder,
  current,
}: {
  readonly builder: RotationBuilder;
  readonly current: RotationDraft;
}) {
  const { snapshot, today, cycles, chooseCycles } = builder;

  if (snapshot === null || today === null) return null;

  const grid = previewGridOf(snapshot, current, current.effectiveFrom, cycles);
  const grouped = cycles !== 1;

  return (
    <Card className="min-w-0">
      <CardHeader className="flex-row flex-wrap items-start gap-3">
        <SectionNumber value={4} />
        <div className="grid min-w-0 flex-1 gap-1.5">
          <CardTitle asChild>
            <h2>{t('rotation.builder.previewHeading')}</h2>
          </CardTitle>
          <CardDescription>{t('rotation.builder.previewLede')}</CardDescription>
        </div>
        {/* HOW MANY CYCLES TO SHOW: a view choice, never saved. */}
        <div className="grid w-full gap-2 sm:w-40">
          <Label htmlFor="rotation-preview-cycles">{t('rotation.builder.previewCycles')}</Label>
          <Select
            id="rotation-preview-cycles"
            name="cycles"
            value={String(cycles)}
            onChange={chooseCycles}
            className="h-11"
          >
            {PREVIEW_CYCLE_CHOICES.map((choice) => (
              <option key={choice} value={String(choice)}>
                {t('rotation.builder.cycleCount', { count: choice })}
              </option>
            ))}
          </Select>
        </div>
      </CardHeader>
      {grid.days.length === 0 ? null : (
        // TEAMS AS ROWS, DATES AS COLUMNS (owner layout). The grid scrolls
        // sideways inside `Table`'s own container, never the page; the team
        // column stays in view.
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 z-10 bg-muted">{t('rotation.builder.columnTeam')}</TableHead>
              {grid.days.map((day) => (
                <TableHead
                  key={day.date}
                  className={day.headClass}
                >
                  {/* THE CYCLE BOUNDARY IN WORDS, not colour alone: each
                      cycle's first day names its cycle, behind a rule. */}
                  {grouped && day.dayNumber === 1 ? (
                    <span className="block">{t('rotation.builder.cycleLabel', { cycle: day.cycleNumber })}</span>
                  ) : null}
                  <span className="block">{t('rotation.builder.dayNumber', { day: day.dayNumber })}</span>
                  <span className="block font-normal normal-case tabular-nums">{day.label}</span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {grid.rows.map((row) => (
              <TableRow key={row.team.id}>
                <TableCell className="sticky left-0 z-10 whitespace-nowrap bg-card font-semibold">
                  {row.team.name}
                </TableCell>
                {row.cells.map((cell, index) => (
                  <TableCell
                    key={cell.date}
                    className={grid.days[index]?.cellClass}
                  >
                    {/* THE TILE: the slot's colour, ALWAYS the name as text. */}
                    <div className={cell.chip.tileClass}>
                      <span className="max-w-28 truncate">{cell.chip.name}</span>
                      <span className="font-normal tabular-nums">{cell.range}</span>
                    </div>
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
