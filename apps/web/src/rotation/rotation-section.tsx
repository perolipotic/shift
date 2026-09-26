import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type ScreenReaderInstructions,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BriefcaseBusiness,
  CalendarRange,
  Check,
  ChevronLeft,
  Clock3,
  Coffee,
  GripVertical,
  Info,
  Plus,
  Rows3,
  Save,
  X,
} from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type ReactNode,
} from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout, CalloutBody, CalloutDescription, CalloutTitle } from '@/components/ui/callout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { IconTile } from '@/components/ui/icon-tile';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { PageActions, PageHeader } from '@/components/ui/page-header';
import { SectionNumber } from '@/components/ui/section-number';
import { Select } from '@/components/ui/select';
import { StatTile, StatTileLabel, StatTileValue } from '@/components/ui/stat-tile';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { t } from '@/i18n';
import {
  FOCUS_ADD,
  PREVIEW_CYCLE_CHOICES,
  STEP_CONTROL_HANDLE,
  STEP_CONTROL_REMOVE,
  addableTypesOf,
  draftStepRowsOf,
  draftTeamRowsOf,
  dropOf,
  figuresOf,
  focusAfterDropOf,
  focusAfterRemoveOf,
  previewGridOf,
  spreadOfferedOf,
  stepControlIdOf,
  stepIndexOf,
  stepPositionOf,
  withAnchor,
  withOffsetsSpread,
  withStepAdded,
  withStepMovedTo,
  withStepRemoved,
  withTeamStep,
  type DraftStepRow,
  type RotationDraft,
  type ShiftTypeChip,
  type StepControl,
  type StepFocus,
} from '@/rotation/draft';
import {
  rotationDraftStore,
  rotationPreviewCyclesStore,
  rotationStepperStore,
  shownDraftOf,
} from '@/rotation/draft-store';
import {
  ROTATION_ASSIGNMENTS_TABLE,
  ROTATION_KEY,
  ROTATION_PATTERNS_TABLE,
  ROTATION_READ_TABLE,
  ROTATION_STEPS_TABLE,
  reopensAfterSaveOf,
  rotationMessageKey,
  rotationQueryOptions,
  rotationSurfaceStateOf,
  rotationTeamsOf,
  rotationTodayOf,
  writableRotationOf,
} from '@/rotation/list';
import {
  ROTATION_SAVED_MESSAGE_KEY,
  ROTATION_WRITE_REFUSED,
  ROTATION_WRITE_UNAVAILABLE,
  claimedOrganizationOf,
  rotationPartialMessageKey,
  rotationWriteMessageKey,
  saveRotation,
  type RotationInsertTable,
} from '@/rotation/write';
import {
  STEPPER_STEPS,
  STEP_CURRENT,
  STEP_REACHED,
  STEP_UNREACHED,
  nextMessageKey,
  nextStepOf,
  previousStepOf,
  shownStepperOf,
  stepGroupClassOf,
  stepMessageKey,
  stepSectionClassOf,
  stepStatusOf,
} from '@/rotation/stepper';
import {
  shownSaveOutcomeOf,
  warningTextOf,
  warningsSummaryOf,
  type ShownSaveOutcome,
  type WarningTranslate,
} from '@/rotation/warnings';
import { durationValuesOf, shiftTypeDurationMessageKey } from '@/shift-types/list';
import { supabaseClient } from '@/supabase/client';

/**
 * The rotation builder (story 2.3b, UX-DR14, UX-DR15), rendered on
 * `/postavke-rotacije` below `Tipovi smjena`, in the same scrolling panel:
 * the pattern with its live figures, the shared anchor date and each active
 * team's step, one cycle's preview from today, and the save.
 *
 * A FILE OF ITS OWN because it reads its own snapshot under `ROTATION_KEY`
 * (AD-13), and the shift type screens are pinned to exactly one query.
 *
 * THE DRAFT IS STATE, THE RULES ARE NOT. It opens as the rotation in force
 * today (`prefillOf`), lives in `@/rotation/draft-store` — outside this
 * component, so the shift type dialog's remount keeps it — and is only ever
 * changed through `@/rotation/draft`'s operations. A drag-and-drop reorder
 * (`@dnd-kit`, by the handle only: mouse, touch or keyboard) ends in
 * `withStepMovedTo`, and every word it announces comes from `hr.json`; the figures, the preview, the refusals and the save are all in
 * `@/rotation/*.ts`, which the node suite executes. Nothing here projects,
 * counts a cycle or takes a modulo.
 *
 * A FAILED REFETCH KEEPS THE DRAFT AND THE ROWS, with the message beside them;
 * the save is then refused as unavailable rather than built from rows that may
 * be stale.
 *
 * BELOW `sm`, A STEPPER (story 2.4, UX-DR16), IN CSS ONLY. Every section is
 * always rendered; the one that is not the current step is hidden below `sm`
 * (`stepSectionClassOf`), and the step bar and Natrag / Dalje are `sm:hidden`.
 * One tree at every width: the data, the validations and the order cannot
 * differ, and a step change remounts nothing. The header, its save, the save's
 * note and outcome and the read refusal stay outside every step.
 */

export function RotationSection({
  heading,
  shiftTypes,
}: {
  /** The page's title and lede, which the screen owns. */
  readonly heading: ReactNode;
  /** Section 1, the shift types, which the screen owns and this lays out beside section 2. */
  readonly shiftTypes: ReactNode;
}) {
  const queryClient = useQueryClient();
  const saving = useRef(false);
  const addField = useRef<HTMLSelectElement>(null);
  const stored = useSyncExternalStore(rotationDraftStore.subscribe, rotationDraftStore.get);
  const cycles = useSyncExternalStore(rotationPreviewCyclesStore.subscribe, rotationPreviewCyclesStore.get);
  const stepper = useSyncExternalStore(rotationStepperStore.subscribe, rotationStepperStore.get);
  const progress = useRef<HTMLParagraphElement>(null);
  const stepMoved = useRef(false);
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<ShownSaveOutcome | null>(null);
  const [focus, setFocus] = useState<StepFocus | null>(null);
  const controls = useRef(new Map<string, HTMLButtonElement>());

  // WHERE FOCUS GOES after a move or a removal is `@/rotation/draft`'s rule;
  // here it is only applied, once the rows have re-rendered.
  useEffect(() => {
    if (focus === null) return;

    if (focus.kind === FOCUS_ADD) addField.current?.focus();
    else controls.current.get(stepControlIdOf(focus.key, focus.control))?.focus();

    setFocus(null);
  }, [focus]);

  // A STEP CHANGE MOVES FOCUS to the progress line, and scrolls it into view,
  // so a screen reader hears "Korak N od 4" and a finger starts at the top of
  // the new step. Only after a step change made here — never on a mount.
  useEffect(() => {
    if (!stepMoved.current) return;

    stepMoved.current = false;
    progress.current?.focus({ preventScroll: true });
    progress.current?.scrollIntoView();
  }, [stepper.current]);

  const answer = useQuery(rotationQueryOptions(() => supabaseClient().from(ROTATION_READ_TABLE)));
  const state = rotationSurfaceStateOf(answer);
  const { snapshot, refusal } = state;
  const today = snapshot === null ? null : rotationTodayOf(snapshot, new Date());
  const draft = snapshot === null || today === null ? null : shownDraftOf(stored, snapshot, today);
  // With no draft only section 1 exists: laid out as step 1, and no stepper.
  const shown = shownStepperOf(stepper, draft !== null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /** Every change goes through a draft operation, into the store; a message describes the last save only. */
  function change(next: RotationDraft): void {
    setOutcome(null);
    if (snapshot !== null) rotationDraftStore.set(snapshot.organizationId, next);
  }

  /**
   * Registers one step control, so focus can be put back on it by key. A
   * removed step's entry is simply left: its key is never reused, so nothing
   * ever asks for it again.
   */
  function registerControl(key: string, control: StepControl) {
    return (element: HTMLButtonElement | null): void => {
      if (element !== null) controls.current.set(stepControlIdOf(key, control), element);
    };
  }

  /** A drop: the move is `withStepMovedTo`'s, focus lands where `focusAfterDropOf` says. */
  function drop(current: RotationDraft, event: DragEndEvent): void {
    const moved = dropOf(current, String(event.active.id), event.over === null ? null : String(event.over.id));

    if (moved === null) return;

    const next = withStepMovedTo(current, moved.from, moved.to);

    change(next);
    setFocus(focusAfterDropOf(next, moved.to));
  }

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

  function remove(current: RotationDraft, index: number): void {
    const next = withStepRemoved(current, index);

    change(next);
    setFocus(focusAfterRemoveOf(next, index));
  }

  async function save(): Promise<void> {
    const writable = writableRotationOf(state);

    if (draft === null || saving.current) return;

    saving.current = true;
    setOutcome(null);
    setPending(true);

    try {
      if (writable === null) {
        setOutcome({ ok: false, code: ROTATION_WRITE_UNAVAILABLE, afterPattern: false });

        return;
      }

      // TODAY AT THE MOMENT OF SAVING, not when the screen last rendered: a
      // tab left open past the organization's midnight dates the versions,
      // and runs the checks, on the day the save is actually made.
      const savedOn = rotationTodayOf(writable, new Date());

      const client = supabaseClient();
      const { data } = await client.auth.getSession();
      const organization = claimedOrganizationOf(data.session?.access_token);

      if (organization === null) {
        setOutcome({ ok: false, code: ROTATION_WRITE_REFUSED, afterPattern: false });

        return;
      }

      const saved = await saveRotation(
        {
          patterns: client.from(ROTATION_PATTERNS_TABLE) as unknown as RotationInsertTable,
          steps: client.from(ROTATION_STEPS_TABLE) as unknown as RotationInsertTable,
          assignments: client.from(ROTATION_ASSIGNMENTS_TABLE) as unknown as RotationInsertTable,
        },
        organization,
        writable,
        draft,
        savedOn,
      );

      // A REFUSED SAVE KEEPS THE DRAFT: nothing below touches it on that path.
      // A LANDED ONE CARRIES ITS WARNINGS (story 2.5), from the draft just
      // saved and the date the save used — before the draft re-opens below.
      // They never block: the rows are already written.
      setOutcome(shownSaveOutcomeOf(saved, writable, draft, savedOn));

      if (!saved.ok) return;

      try {
        await queryClient.invalidateQueries({ queryKey: ROTATION_KEY });
      } catch (cause) {
        console.error(ROTATION_WRITE_UNAVAILABLE, cause);
      }

      // The draft re-opens as what is now in force — but only from a fresh
      // read; over a failed one it stays as it was saved.
      if (reopensAfterSaveOf(queryClient.getQueryState(ROTATION_KEY)?.status)) rotationDraftStore.reset();
    } catch (cause) {
      console.error(ROTATION_WRITE_UNAVAILABLE, cause);
      setOutcome({ ok: false, code: ROTATION_WRITE_UNAVAILABLE, afterPattern: false });
    } finally {
      saving.current = false;
      setPending(false);
    }
  }

  /** A team's step `<select>`: the value is read as a step of the draft, or ignored. */
  function chooseTeamStep(current: RotationDraft, teamId: string) {
    return (event: ChangeEvent<HTMLSelectElement>): void => {
      const index = stepIndexOf(current, event.target.value);

      if (index !== null) change(withTeamStep(current, teamId, index));
    };
  }

  /** The preview's cycles: validated by the store to one of the choices. */
  function chooseCycles(event: ChangeEvent<HTMLSelectElement>): void {
    rotationPreviewCyclesStore.set(event.target.value);
  }

  /** The shared anchor: only a calendar date moves it. */
  function chooseAnchor(current: RotationDraft) {
    return (event: ChangeEvent<HTMLInputElement>): void => {
      change(withAnchor(current, event.target.value));
    };
  }

  function renderChip(chip: ShiftTypeChip): ReactNode {
    return (
      <span className={chip.chipClass}>
        <span className="truncate">{chip.name}</span>
      </span>
    );
  }

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

    const figures = figuresOf(snapshot, current, today);

    // FOUR TILES, each a label and a value; the icons are decoration.
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2">
        <StatTile className="p-3">
          <IconTile>
            <CalendarRange />
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
            <BriefcaseBusiness />
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
            <Clock3 />
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

  function renderOffsets(current: RotationDraft): ReactNode {
    if (snapshot === null) return null;

    const rows = draftTeamRowsOf(snapshot, current);
    const teams = rotationTeamsOf(snapshot);
    const steps = draftStepRowsOf(snapshot, current);

    return (
      <Card className="min-w-0">
        <CardHeader className="flex-row items-start gap-3">
          <SectionNumber value={3} />
          <div className="grid min-w-0 gap-1.5">
            <CardTitle asChild>
              <h2>{t('rotation.builder.offsetsHeading')}</h2>
            </CardTitle>
            <CardDescription>{t('rotation.builder.anchorNote')}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 pt-4">
          <Callout>
            <CalloutBody>
              <IconTile variant="primary">
                <Info />
              </IconTile>
              <div className="min-w-0">
                <CalloutTitle>{t('rotation.builder.howTitle')}</CalloutTitle>
                <CalloutDescription>{t('rotation.builder.howBody')}</CalloutDescription>
              </div>
            </CalloutBody>
          </Callout>
          {/* THE ANCHOR AND THE SPREAD ON ONE ROW, wrapping on a phone. */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid w-full gap-2 sm:w-64">
              <Label htmlFor="rotation-anchor">{t('rotation.builder.anchor')}</Label>
              <Input
                id="rotation-anchor"
                name="anchor"
                type="date"
                required
                value={current.anchorDate}
                disabled={pending}
                onChange={chooseAnchor(current)}
                className="h-11 w-full"
              />
            </div>
            {/* OFFERED ONLY WITH A STEP TO SPREAD ONTO; without one the note
                says why. It only fills the draft — nothing is saved. */}
            {spreadOfferedOf(current, teams) ? (
              <Button
                className="h-11"
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  change(withOffsetsSpread(current, teams));
                }}
              >
                <Rows3 aria-hidden />
                {t('rotation.builder.spread')}
              </Button>
            ) : null}
          </div>
          {spreadOfferedOf(current, teams) ? null : (
            <p className="text-sm text-muted-foreground">{t('rotation.builder.offsetsEmpty')}</p>
          )}
        </CardContent>
        {steps.length === 0 ? null : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('rotation.builder.columnTeam')}</TableHead>
                <TableHead>{t('rotation.builder.columnOffset')}</TableHead>
                <TableHead>{t('rotation.builder.columnOnAnchor')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.team.id}>
                  <TableCell className="font-semibold">{row.team.name}</TableCell>
                  <TableCell>
                    <Label htmlFor={`rotation-offset-${row.team.id}`} className="sr-only">
                      {t('rotation.builder.offsetOf', { name: row.team.name })}
                    </Label>
                    <Select
                      id={`rotation-offset-${row.team.id}`}
                      name="offset"
                      value={String(row.index)}
                      disabled={pending}
                      onChange={chooseTeamStep(current, row.team.id)}
                      className="h-11 min-w-32"
                    >
                      {steps.map((step) => (
                        <option key={step.index} value={String(step.index)}>
                          {t('rotation.builder.stepOption', { position: step.position, name: step.chip.name })}
                        </option>
                      ))}
                    </Select>
                  </TableCell>
                  <TableCell>{row.onAnchor === null ? null : renderChip(row.onAnchor)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    );
  }

  function renderPreview(current: RotationDraft): ReactNode {
    if (snapshot === null || today === null) return null;

    const grid = previewGridOf(snapshot, current, today, cycles);
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

  /**
   * Every step change goes through the stepper store, and then moves focus —
   * only when the store actually changed. A tap on the current step (still
   * enabled, `aria-current`) is a no-op the store ignores, and must not leave
   * a flag behind for a later, unrelated change to steal focus with.
   */
  function moveStep(move: () => void): void {
    const before = rotationStepperStore.get();

    // Raised BEFORE the move, in case the store's render commits inside it,
    // and lowered again when nothing moved.
    stepMoved.current = true;
    move();
    if (rotationStepperStore.get() === before) stepMoved.current = false;
  }

  function renderStepBar(): ReactNode {
    return (
      <div className="grid gap-3 sm:hidden">
        <p
          ref={progress}
          tabIndex={-1}
          className="scroll-mt-4 text-sm font-semibold text-muted-foreground focus-visible:outline-none"
        >
          {t('rotation.builder.stepper.progress', { current: stepper.current, total: STEPPER_STEPS.length })}
        </p>
        <nav aria-label={t('rotation.builder.stepper.label')}>
          <ol className="grid grid-cols-4 gap-1">
            {STEPPER_STEPS.map((step) => {
              const status = stepStatusOf(stepper, step);

              return (
                <li key={step} className="min-w-0">
                  {/* THE STEP'S STATE IN WORDS AND A GLYPH, not colour alone:
                      the current one is `aria-current`, a reached one carries a
                      check and "završeno", an unreached one is disabled. */}
                  <Button
                    type="button"
                    variant={status === STEP_CURRENT ? 'default' : 'outline'}
                    className="h-11 w-full flex-col gap-0 px-1 py-0 text-xs leading-tight"
                    aria-current={status === STEP_CURRENT ? 'step' : undefined}
                    disabled={status === STEP_UNREACHED}
                    onClick={() => {
                      moveStep(() => {
                        rotationStepperStore.set(step);
                      });
                    }}
                  >
                    <span className="flex items-center gap-0.5 tabular-nums">
                      {status === STEP_REACHED ? <Check aria-hidden /> : null}
                      {step}
                    </span>
                    <span className="max-w-full truncate leading-normal">{t(stepMessageKey(step))}</span>
                    {status === STEP_REACHED ? (
                      <span className="sr-only">{t('rotation.builder.stepper.done')}</span>
                    ) : null}
                  </Button>
                </li>
              );
            })}
          </ol>
        </nav>
      </div>
    );
  }

  function renderStepActions(): ReactNode {
    const previous = previousStepOf(stepper.current);
    const next = nextStepOf(stepper.current);

    return (
      <div className="flex flex-wrap gap-3 sm:hidden">
        {previous === null ? null : (
          <Button
            className="h-11 grow"
            type="button"
            variant="outline"
            onClick={() => {
              moveStep(() => {
                rotationStepperStore.back();
              });
            }}
          >
            <ChevronLeft aria-hidden />
            {t('rotation.builder.stepper.back')}
          </Button>
        )}
        {next === null ? null : (
          <Button
            className="h-11 grow"
            type="button"
            onClick={() => {
              moveStep(() => {
                rotationStepperStore.next();
              });
            }}
          >
            {t(nextMessageKey(next))}
          </Button>
        )}
      </div>
    );
  }

  const partial = outcome === null ? null : rotationPartialMessageKey(outcome);
  /** A warning's words, every one from `hr.json`, resolved by `@/rotation/warnings`. */
  const translate: WarningTranslate = (key, values) => t(key, values);

  return (
    <>
      <PageHeader>
        {heading}
        <PageActions>
          {/* THE SAVE, in the page's own actions (owner layout). */}
          <Button
            className="h-11"
            type="button"
            disabled={pending || draft === null}
            aria-busy={pending}
            onClick={() => {
              void save();
            }}
          >
            <Save aria-hidden />
            {t('rotation.builder.save')}
          </Button>
        </PageActions>
      </PageHeader>
      {/* THE SAVE'S NOTE AND OUTCOME, right under the header its button sits in. */}
      <p className="-mt-3 text-sm text-muted-foreground">{t('rotation.builder.saveNote')}</p>
      {outcome === null || outcome.ok ? null : (
        <Notice role="alert">
          {t(rotationWriteMessageKey(outcome.code))}
          {partial === null ? null : <> {t(partial)}</>}
        </Notice>
      )}
      {outcome?.ok === true ? (
        <Notice role="status">
          {/* The confirmation on its own line, and its own element, whether
              or not warnings follow it. */}
          <span className="block">{t(ROTATION_SAVED_MESSAGE_KEY)}</span>
          {outcome.warnings.length === 0 ? null : (
            <>
              <span className="mt-2 block">{warningTextOf(warningsSummaryOf(outcome.warnings), translate)}</span>
              {/* SPANS WITH LIST ROLES, because the Notice is a `<p>` and a `<ul>`
                  may not sit in one. */}
              <span role="list" className="mt-1 grid gap-1">
                {outcome.warnings.map((line, index) => (
                  <span role="listitem" key={index} className="block">
                    {warningTextOf(line.text, translate)}
                    {line.details.length === 0 ? null : (
                      <span role="list" className="mt-0.5 grid gap-0.5 pl-4 font-normal">
                        {line.details.map((detail, detailIndex) => (
                          <span role="listitem" key={detailIndex} className="block">
                            {warningTextOf(detail, translate)}
                          </span>
                        ))}
                      </span>
                    )}
                  </span>
                ))}
              </span>
            </>
          )}
        </Notice>
      ) : null}
      {refusal === null ? null : <Notice role="alert">{t(rotationMessageKey(refusal))}</Notice>}
      {draft === null ? null : renderStepBar()}
      {/* SECTIONS 1 AND 2 side by side from `lg` up, stacked below it. The
          shift types' table gets the wider share, so it does not scroll; the
          step rows stay one line in the narrower one. Each section sits in a
          wrapper that stays the grid item (`min-w-0`) and is hidden below
          `sm` unless it is the current step; the grid's own wrapper too on
          steps 3 and 4, so an empty grid leaves no gap. */}
      <div className={stepGroupClassOf(shown, [1, 2])}>
        <div className="grid min-w-0 gap-6 lg:grid-cols-[3fr_2fr] lg:items-start" aria-busy={state.loading}>
          <div className={stepSectionClassOf(shown, 1)}>{shiftTypes}</div>
          {draft === null ? null : (
            <div className={stepSectionClassOf(shown, 2)}>
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
                  {renderSteps(draft)}
                  {renderAdd(draft)}
                  {renderFigures(draft)}
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>
      {draft === null ? null : <div className={stepSectionClassOf(shown, 3)}>{renderOffsets(draft)}</div>}
      {draft === null ? null : <div className={stepSectionClassOf(shown, 4)}>{renderPreview(draft)}</div>}
      {draft === null ? null : renderStepActions()}
    </>
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
        <GripVertical aria-hidden />
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
