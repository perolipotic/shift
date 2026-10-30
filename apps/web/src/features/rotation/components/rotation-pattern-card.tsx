import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type ScreenReaderInstructions,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Briefcase, CalendarDots, Clock, Coffee, DotsSixVertical, Plus, X } from '@/components/ui/icon';
import { IconTile } from '@/components/ui/icon-tile';
import { Label } from '@/components/ui/label';
import { SectionNumber } from '@/components/ui/section-number';
import { Select } from '@/components/ui/select';
import { StatTile, StatTileLabel, StatTileValue } from '@/components/ui/stat-tile';
import type { RotationBuilder } from '@/features/rotation/hooks/use-rotation-builder';
import {
  STEP_CONTROL_HANDLE,
  STEP_CONTROL_REMOVE,
  addableTypesOf,
  draftStepRowsOf,
  figuresOf,
  stepPositionOf,
  withStepAdded,
  type DraftStepRow,
  type RotationDraft,
  type StepControl,
} from '@/features/rotation/utils/draft';
import { shiftTypeDurationMessageKey } from '@/features/shift-types/services/list';
import { t } from '@/lib/i18n';
import { durationValuesOf } from '@/utils/time';

/**
 * The builder's section 2, the pattern (stories 2.3b, 2.4; split out of
 * `RotationSection` by the epics 5–7 retro, A21): the steps, reordered by
 * `@dnd-kit` by the handle only, with mouse, touch and keyboard sensors and
 * every word announced from `hr.json`; the new step and its add; and the four
 * live figures. Every change is a draft operation the builder applies.
 */
export function RotationPatternCard({
  builder,
  current,
}: {
  readonly builder: RotationBuilder;
  readonly current: RotationDraft;
}) {
  const { snapshot, today, pending, addField, registerControl, drop, remove, change } = builder;
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /** What a screen reader hears while a step is dragged, every word from `hr.json`. */
  function announcementsOf(current: RotationDraft): Announcements {
    const at = (id: string | number) => stepPositionOf(current, String(id)) ?? 0;

    return {
      onDragStart: ({ active }) => t('rotation.builder.drag.lifted', { position: at(active.id) }),
      // Over its own place — the moment it is lifted — says nothing more than
      // the lift did.
      onDragOver: ({ active, over }) =>
        over === null || over.id === active.id
          ? undefined
          : t('rotation.builder.drag.over', { from: at(active.id), to: at(over.id) }),
      onDragEnd: ({ active, over }) =>
        over === null
          ? t('rotation.builder.drag.cancelled', { position: at(active.id) })
          : t('rotation.builder.drag.dropped', { from: at(active.id), to: at(over.id) }),
      onDragCancel: ({ active }) => t('rotation.builder.drag.cancelled', { position: at(active.id) }),
    };
  }

  const instructions: ScreenReaderInstructions = { draggable: t('rotation.builder.drag.instructions') };

  function renderSteps(current: RotationDraft): ReactNode {
    if (snapshot === null) return null;

    const rows = draftStepRowsOf(snapshot, current);

    if (rows.length === 0) {
      return <p className="text-sm text-muted-foreground">{t('rotation.builder.patternEmpty')}</p>;
    }

    return (
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        accessibility={{ announcements: announcementsOf(current), screenReaderInstructions: instructions }}
        onDragEnd={(event) => {
          drop(current, event);
        }}
      >
        <SortableContext items={[...current.keys]} strategy={verticalListSortingStrategy}>
          <ol className="grid gap-2" aria-label={t('rotation.builder.stepsCaption')}>
            {rows.map((row) => (
              <SortableStep
                key={row.key}
                row={row}
                pending={pending}
                register={registerControl}
                onRemove={() => {
                  remove(current, row.index);
                }}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
    );
  }

  function renderAdd(current: RotationDraft): ReactNode {
    if (snapshot === null) return null;

    const addable = addableTypesOf(snapshot);

    return (
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid min-w-0 flex-1 gap-2">
          <Label htmlFor="rotation-new-step">{t('rotation.builder.newStep')}</Label>
          {/* The native `Select`, as the shift type kind is. Only types in use
              are offered. */}
          <Select
            ref={addField}
            id="rotation-new-step"
            name="step"
            disabled={addable.length === 0 || pending}
            className="h-11"
          >
            {addable.map((type) => (
              <option key={type.shiftTypeId} value={type.shiftTypeId}>
                {type.name}
              </option>
            ))}
          </Select>
        </div>
        <Button
          className="h-11"
          type="button"
          variant="dashed"
          disabled={addable.length === 0 || pending}
          onClick={() => {
            const chosen = addField.current?.value;

            if (chosen !== undefined && addable.some((type) => type.shiftTypeId === chosen)) {
              change(withStepAdded(current, chosen));
            }
          }}
        >
          <Plus aria-hidden />
          {t('rotation.builder.addStep')}
        </Button>
      </div>
    );
  }

  function renderFigures(current: RotationDraft): ReactNode {
    if (snapshot === null || today === null) return null;

    const figures = figuresOf(snapshot, current, current.effectiveFrom);

    // FOUR TILES, each a label and a value; the icons are decoration.
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2">
        <StatTile className="p-3">
          <IconTile>
            <CalendarDots />
          </IconTile>
          <div className="min-w-0">
            <StatTileLabel>{t('rotation.builder.cycleLengthLabel')}</StatTileLabel>
            <StatTileValue className="text-base">
              {t('rotation.builder.cycleLength', { count: figures.cycleLength })}
            </StatTileValue>
          </div>
        </StatTile>
        <StatTile className="p-3">
          <IconTile>
            <Briefcase />
          </IconTile>
          <div className="min-w-0">
            <StatTileLabel>{t('rotation.builder.workingStepsLabel')}</StatTileLabel>
            <StatTileValue className="text-base">{figures.workingSteps}</StatTileValue>
          </div>
        </StatTile>
        <StatTile className="p-3">
          <IconTile>
            <Coffee />
          </IconTile>
          <div className="min-w-0">
            <StatTileLabel>{t('rotation.builder.nonWorkingStepsLabel')}</StatTileLabel>
            <StatTileValue className="text-base">{figures.nonWorkingSteps}</StatTileValue>
          </div>
        </StatTile>
        <StatTile className="p-3">
          <IconTile>
            <Clock />
          </IconTile>
          <div className="min-w-0">
            <StatTileLabel>{t('rotation.builder.cycleHoursLabel')}</StatTileLabel>
            <StatTileValue className="text-base">
              {figures.cycleMinutes === null
                ? t('rotation.builder.cycleHoursUnknown')
                : t(
                    shiftTypeDurationMessageKey(figures.cycleMinutes),
                    durationValuesOf(figures.cycleMinutes),
                  )}
            </StatTileValue>
          </div>
        </StatTile>
      </div>
    );
  }

  return (
    <Card className="min-w-0">
      <CardHeader className="flex-row items-start gap-3">
        <SectionNumber value={2} />
        <div className="grid min-w-0 gap-1.5">
          <CardTitle asChild>
            <h2>{t('rotation.builder.patternHeading')}</h2>
          </CardTitle>
          <CardDescription>{t('rotation.builder.patternLede')}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 pt-4">
        {renderSteps(current)}
        {renderAdd(current)}
        {renderFigures(current)}
      </CardContent>
    </Card>
  );
}

/**
 * One step as ONE ROW that never wraps: the drag handle, `Korak N`, the type's
 * chip (truncated, its name always there), and remove. The handle is the only
 * drag activator, so a press anywhere else on the row does nothing.
 */
function SortableStep({
  row,
  pending,
  register,
  onRemove,
}: {
  readonly row: DraftStepRow;
  readonly pending: boolean;
  readonly register: (key: string, control: StepControl) => (element: HTMLButtonElement | null) => void;
  readonly onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: row.key, disabled: pending });
  const registerHandle = register(row.key, STEP_CONTROL_HANDLE);

  function handleRef(element: HTMLButtonElement | null): void {
    setActivatorNodeRef(element);
    registerHandle(element);
  }

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      data-dragging={isDragging}
      className="flex min-w-0 flex-nowrap items-center gap-1 rounded-md border bg-card px-1 data-[dragging=true]:z-10 data-[dragging=true]:shadow-sh"
    >
      <Button
        type="button"
        variant="ghost"
        className="h-11 w-11 shrink-0 cursor-grab touch-none px-0"
        ref={handleRef}
        disabled={pending}
        {...attributes}
        {...listeners}
        aria-roledescription={t('rotation.builder.drag.roleDescription')}
      >
        <DotsSixVertical aria-hidden />
        <span className="sr-only">{t('rotation.builder.drag.handle', { position: row.position })}</span>
      </Button>
      {/* A FIXED LABEL COLUMN, so `Korak N` never touches the chip. */}
      <span className="w-16 shrink-0 pr-2 text-sm tabular-nums text-muted-foreground">
        {t('rotation.builder.stepPosition', { position: row.position })}
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
        {/* At 320 px a long name truncates; the whole name stays its title. */}
        <span className={row.chip.chipClass} title={row.chip.name}>
          <span className="truncate">{row.chip.name}</span>
        </span>
        {row.chip.archived ? (
          <Badge variant="outline" className="shrink-0">
            {t('rotation.builder.archivedStep')}
          </Badge>
        ) : null}
      </span>
      <Button
        type="button"
        variant="ghost"
        className="h-11 w-11 shrink-0 px-0"
        ref={register(row.key, STEP_CONTROL_REMOVE)}
        disabled={pending}
        onClick={onRemove}
      >
        <X aria-hidden />
        <span className="sr-only">{t('rotation.builder.remove', { position: row.position })}</span>
      </Button>
    </li>
  );
}
