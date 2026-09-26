import {
  projectedShiftType,
  projectedStepId,
  shiftDurationOn,
  shiftTypeVersionOn,
  type RotationAssignment,
  type RotationStep,
} from '@shift/domain';

import { formatIsoDate, formatIsoDayMonth, isIsoDate, nextIsoDate } from '@/i18n/format';
import {
  assignmentInForceOf,
  patternStepsOf,
  rotationChangedTodayOf,
  rotationScheduledOf,
  rotationTeamsOf,
  type RotationSnapshot,
} from '@/rotation/list';
import {
  NO_TIMES_SHOWN,
  chipClassOf,
  rampSlotsOf,
  shiftTimesShownOf,
  slotColourClassOf,
  type ShiftTypeRow,
} from '@/shift-types/list';
import type { TeamRow } from '@/teams/list';

/**
 * The rotation builder's draft: the pattern being built, the shared anchor
 * date and each active team's step, and everything the builder shows about it
 * before it is saved (story 2.3b, UX-DR14, UX-DR15).
 *
 * THE DRAFT IS PROJECTED BY `@shift/domain` AND NOWHERE ELSE (AD-7). An
 * unsaved pattern has no stored ids, so it is given SYNTHETIC ones — one step
 * per position, one assignment per team at the shared anchor — and handed to
 * `projectedStepId` and `projectedShiftType` exactly as a stored rotation is.
 * Nothing here takes a modulo or walks a cycle by hand; dates advance with
 * `nextIsoDate`, and durations are `shiftDurationOn`'s.
 *
 * A TEAM'S OFFSET IS A STEP, held as the step's index in the draft. The step
 * operations keep every team on the step it stands on: moving a step moves its
 * teams with it, removing a step shifts the teams after it back by one, and a
 * team whose own step is removed falls to step 1 (index 0).
 *
 * "TODAY" IS THE ORGANIZATION'S, from the snapshot's zone, never the device's.
 *
 * THE CHANGE APPLIES FROM THE DRAFT'S EFFECTIVE DATE (story 2.6), never before
 * today: the preview, the figures and the checks start on it, and every date
 * before it keeps the version already in force.
 */

/** A draft: what the builder holds between the prefill and the save. */
export interface RotationDraft {
  /** The pattern: shift type ids, in order. A type may repeat. */
  readonly steps: readonly string[];
  /** The one anchor every team's assignment is saved with — a UI convention (2.3a). */
  readonly anchorDate: string;
  /**
   * The date the change applies from (story 2.6, `Vrijedi od`): every version
   * is saved from it, and the preview, the figures and the checks start on it.
   * SEPARATE FROM THE ANCHOR: the anchor fixes the phase, this fixes when the
   * phase applies. Never before the organization's today.
   */
  readonly effectiveFrom: string;
  /** Each active team's step, by team id, as an index into {@link steps}. */
  readonly offsets: Readonly<Record<string, number>>;
  /**
   * A stable CLIENT key per step, parallel to {@link steps}: it moves with its
   * step, so a list row keeps its identity (and its focus) across a move or a
   * removal. Never sent to the database.
   */
  readonly keys: readonly string[];
  /** The number the next added step's key is made from. */
  readonly nextKey: number;
}

/** The client key made from `serial`. */
export function stepKeyOf(serial: number): string {
  return `step-${String(serial)}`;
}

function freshKeys(count: number): readonly string[] {
  return Array.from({ length: count }, (_, serial) => stepKeyOf(serial));
}

/** The pattern id the synthetic steps belong to; it names no stored row. */
export const DRAFT_PATTERN_ID = 'draft';

/** The id of the draft's synthetic step at `index`. */
export function draftStepId(index: number): string {
  return `${DRAFT_PATTERN_ID}-step-${String(index)}`;
}

/** The draft's steps as the domain reads steps: one per position. */
export function draftStepsOf(draft: RotationDraft): readonly RotationStep[] {
  return draft.steps.map((shiftTypeId, index) => ({
    id: draftStepId(index),
    patternId: DRAFT_PATTERN_ID,
    position: index,
    shiftTypeId,
  }));
}

/** One team's draft assignment, at the shared anchor, on its step. */
export function draftAssignmentOf(draft: RotationDraft, teamId: string): RotationAssignment {
  return {
    teamId,
    patternId: DRAFT_PATTERN_ID,
    offsetStepId: draftStepId(draft.offsets[teamId] ?? 0),
    anchorDate: draft.anchorDate,
    effectiveFrom: draft.anchorDate,
  };
}

/** A draft with no steps, the anchor and the effective date on `today`, every team on step 1. */
export function emptyDraftOf(teams: readonly TeamRow[], today: string): RotationDraft {
  return {
    steps: [],
    anchorDate: today,
    effectiveFrom: today,
    offsets: Object.fromEntries(teams.map((team) => [team.id, 0])),
    keys: [],
    nextKey: 0,
  };
}

/**
 * The draft for exactly `teams`: each keeps its step while that step exists,
 * a team the draft does not know yet (added since the draft began) starts on
 * step 1, and a team no longer active is dropped. Keys that do not match the
 * steps one to one are made afresh.
 */
export function normalizedDraftOf(draft: RotationDraft, teams: readonly TeamRow[]): RotationDraft {
  const offsets = Object.fromEntries(
    teams.map((team) => {
      const index = draft.offsets[team.id];

      return [team.id, index !== undefined && index >= 0 && index < draft.steps.length ? index : 0];
    }),
  );

  const keysFit =
    draft.keys.length === draft.steps.length && new Set(draft.keys).size === draft.keys.length;

  return keysFit
    ? { ...draft, offsets }
    : {
        ...draft,
        offsets,
        keys: freshKeys(draft.steps.length),
        nextKey: Math.max(draft.nextKey, draft.steps.length),
      };
}

// ---------------------------------------------------------------- prefill

/**
 * The draft the builder opens with: the rotation in force today, when EVERY
 * active team's assignment in force today uses ONE pattern.
 *
 * The draft takes that pattern's steps, and the organization's TODAY as the
 * shared anchor (owner decision, 2026-09-25). Every team's step is
 * RE-EXPRESSED onto today through the projection — the step it works today —
 * so every projected date is unchanged, and each team's step reads as what it
 * works now rather than where it stood on a stored anchor years ago.
 *
 * In any other case — no active team, a team with no rotation in force, or
 * teams on two patterns — the draft is empty, anchored on today.
 *
 * Either way the change applies from TODAY (story 2.6) until the admin moves
 * `Vrijedi od`; the anchor stays today however that date moves.
 */
export function prefillOf(snapshot: RotationSnapshot, today: string): RotationDraft {
  const teams = rotationTeamsOf(snapshot);
  const empty = emptyDraftOf(teams, today);
  const inForce = teams.map((team) => assignmentInForceOf(snapshot, team.id, today));
  const first = inForce[0];

  if (first === undefined || first === null) return empty;
  if (inForce.some((assignment) => assignment === null || assignment.patternId !== first.patternId)) {
    return empty;
  }

  const steps = patternStepsOf(snapshot, first.patternId);

  if (steps.length === 0) return empty;

  const offsets: Record<string, number> = {};

  for (const assignment of inForce) {
    if (assignment === null) return empty;

    const onAnchor = projectedStepId(steps, assignment, today);

    offsets[assignment.teamId] = steps.findIndex((step) => step.id === onAnchor);
  }

  return {
    steps: steps.map((step) => step.shiftTypeId),
    anchorDate: today,
    effectiveFrom: today,
    offsets,
    keys: freshKeys(steps.length),
    nextKey: steps.length,
  };
}

// ------------------------------------------------------ the step operations

/** The draft with a step of `shiftTypeId` appended. Every team keeps its step. */
export function withStepAdded(draft: RotationDraft, shiftTypeId: string): RotationDraft {
  return {
    ...draft,
    steps: [...draft.steps, shiftTypeId],
    keys: [...draft.keys, stepKeyOf(draft.nextKey)],
    nextKey: draft.nextKey + 1,
  };
}

/** Up or down by one. */
export const STEP_UP = -1;
export const STEP_DOWN = 1;

export type StepDirection = typeof STEP_UP | typeof STEP_DOWN;

/**
 * The draft with the step at `index` swapped with its neighbour in
 * `direction`. The teams on either step MOVE WITH IT, so every team stands on
 * the step it stood on. Past either end, the draft is unchanged.
 */
export function withStepMoved(draft: RotationDraft, index: number, direction: StepDirection): RotationDraft {
  return withStepMovedTo(draft, index, index + direction);
}

/**
 * The draft with the step at `from` taken out and put back at `to` — what a
 * drop of the dragged step does (story 2.3b, as renegotiated). Every step in
 * between shifts one place toward `from`. EVERY TEAM FOLLOWS ITS STEP, and
 * every key moves with its step. An index outside the pattern, or `from ===
 * to`, leaves the draft as it was (the same object).
 */
export function withStepMovedTo(draft: RotationDraft, from: number, to: number): RotationDraft {
  const length = draft.steps.length;

  if (!Number.isInteger(from) || !Number.isInteger(to)) return draft;
  if (from < 0 || from >= length || to < 0 || to >= length || from === to) return draft;

  // The old index of the step that ends up at each new index.
  const order = Array.from({ length }, (_, at) => at);
  const [moved] = order.splice(from, 1);

  if (moved === undefined) return draft;

  order.splice(to, 0, moved);

  const newIndexOf = new Map(order.map((old, at) => [old, at]));
  const steps = order.map((old) => draft.steps[old] as string);
  const keys =
    draft.keys.length === length ? order.map((old) => draft.keys[old] as string) : draft.keys;
  const offsets = Object.fromEntries(
    Object.entries(draft.offsets).map(([teamId, at]) => [teamId, newIndexOf.get(at) ?? at]),
  );

  return { ...draft, steps, offsets, keys };
}

/**
 * Where a drop of the step keyed `activeKey` over the step keyed `overKey`
 * moves it, as indices, or `null` when there is nothing to move (no target,
 * an unknown key, or dropped where it started).
 */
export function dropOf(
  draft: RotationDraft,
  activeKey: string,
  overKey: string | null,
): { readonly from: number; readonly to: number } | null {
  if (overKey === null) return null;

  const from = draft.keys.indexOf(activeKey);
  const to = draft.keys.indexOf(overKey);

  return from < 0 || to < 0 || from === to ? null : { from, to };
}

/** The 1-based position of the step keyed `key`, as announcements name it, or `null`. */
export function stepPositionOf(draft: RotationDraft, key: string): number | null {
  const index = draft.keys.indexOf(key);

  return index < 0 ? null : index + 1;
}

/**
 * The draft without the step at `index`. A team after it keeps its step (its
 * index drops by one); a team ON it falls to step 1.
 */
export function withStepRemoved(draft: RotationDraft, index: number): RotationDraft {
  if (draft.steps[index] === undefined) return draft;

  const steps = draft.steps.filter((_, at) => at !== index);
  const keys = draft.keys.filter((_, at) => at !== index);
  const offsets = Object.fromEntries(
    Object.entries(draft.offsets).map(([teamId, at]) => [
      teamId,
      at === index ? 0 : at > index ? at - 1 : at,
    ]),
  );

  return { ...draft, steps, offsets, keys };
}

/** The draft with one team on the step at `index`; an index outside the pattern changes nothing. */
export function withTeamStep(draft: RotationDraft, teamId: string, index: number): RotationDraft {
  if (draft.steps[index] === undefined || draft.offsets[teamId] === undefined) return draft;

  return { ...draft, offsets: { ...draft.offsets, [teamId]: index } };
}

/**
 * The draft with every team's step spread evenly over the cycle —
 * `Rasporedi ravnomjerno` (story 2.3b, owner addition). `teams` in the team
 * list's order (`splitTeams`), team `i` of `n` over `len` steps:
 *
 *   n <= len   step index floor(i * len / n)   (4 on 4: 1–4; 2 on 4: 1 and 3)
 *   n >  len   step index i wrapped by len     (5 on 4: 1, 2, 3, 4, 1)
 *
 * The wrap is `i - floor(i / len) * len`: `i` is never negative, so this is
 * the modulo, written without the operator the rotation modules keep out.
 * It only fills the draft: steps, keys and the anchor are untouched, and
 * nothing is saved. With no step there is nothing to spread onto, and the
 * draft is returned as it was.
 */
export function withOffsetsSpread(draft: RotationDraft, teams: readonly TeamRow[]): RotationDraft {
  const length = draft.steps.length;
  const count = teams.length;

  if (length === 0 || count === 0) return draft;

  const offsets = Object.fromEntries(
    teams.map((team, index) => [
      team.id,
      count <= length
        ? Math.floor((index * length) / count)
        : index - Math.floor(index / length) * length,
    ]),
  );

  return { ...draft, offsets: { ...draft.offsets, ...offsets } };
}

/** Whether `Rasporedi ravnomjerno` is offered: only while the pattern has a step and a team to spread. */
export function spreadOfferedOf(draft: RotationDraft, teams: readonly TeamRow[]): boolean {
  return draft.steps.length > 0 && teams.length > 0;
}

/**
 * The draft with `value` as the shared anchor — only a calendar date; a
 * cleared or partial date input leaves the anchor as it was.
 */
export function withAnchor(draft: RotationDraft, value: string): RotationDraft {
  const date = value.trim();

  return isIsoDate(date) ? { ...draft, anchorDate: date } : draft;
}

/**
 * The draft with `value` as the date the change applies from — only a
 * calendar date; a cleared or partial date input leaves it as it was. A date
 * before today is KEPT here, and refused at the save (`ROTATION_EFFECTIVE_PAST`).
 */
export function withEffectiveFrom(draft: RotationDraft, value: string): RotationDraft {
  const date = value.trim();

  return isIsoDate(date) ? { ...draft, effectiveFrom: date } : draft;
}

/** A `<select>`'s value as a step index of `draft`, or `null`. */
export function stepIndexOf(draft: RotationDraft, value: string): number | null {
  // Digits only: `''`, `' '`, `'1.5'`, `'1e0'` and `'+1'` name no step.
  if (!/^\d+$/.test(value)) return null;

  const index = Number(value);

  return draft.steps[index] !== undefined ? index : null;
}

// ------------------------------------------------------ where focus goes

/** The two controls of a step row: its drag handle and its remove. */
export const STEP_CONTROL_HANDLE = 'handle';
export const STEP_CONTROL_REMOVE = 'remove';

export type StepControl = typeof STEP_CONTROL_HANDLE | typeof STEP_CONTROL_REMOVE;

/** Focus on one control of one step, or on the add select. */
export const FOCUS_STEP = 'step';
export const FOCUS_ADD = 'add';

/** Where focus goes after a step operation: one control of one step, or the add select. */
export type StepFocus =
  | { readonly kind: typeof FOCUS_STEP; readonly key: string; readonly control: StepControl }
  | { readonly kind: typeof FOCUS_ADD };

/**
 * After a drop moved a step to `to` (`after` is the moved draft): focus stays
 * on the MOVED step's drag handle, wherever it landed, so a keyboard user can
 * lift it again at once. `null` when `to` names no step.
 */
export function focusAfterDropOf(after: RotationDraft, to: number): StepFocus | null {
  const key = after.keys[to];

  return key === undefined ? null : { kind: FOCUS_STEP, key, control: STEP_CONTROL_HANDLE };
}

/**
 * After the step at `index` was removed (`after` is the draft without it):
 * focus goes to the remove button of the step now at that place — the next
 * one — or, when none follows, to the add select.
 */
export function focusAfterRemoveOf(after: RotationDraft, index: number): StepFocus {
  const key = after.keys[index];

  return key === undefined ? { kind: FOCUS_ADD } : { kind: FOCUS_STEP, key, control: STEP_CONTROL_REMOVE };
}

/** The id one step control is registered under for focusing. */
export function stepControlIdOf(key: string, control: StepControl): string {
  return `${key}:${control}`;
}

// ------------------------------------------------------------ projection

/** The index of the draft step `teamId` stands on on `date`, through `projectedStepId`. */
export function draftStepIndexOn(draft: RotationDraft, teamId: string, date: string): number {
  const stepId = projectedStepId(draftStepsOf(draft), draftAssignmentOf(draft, teamId), date);

  return draftStepsOf(draft).findIndex((step) => step.id === stepId);
}

/** The shift type id `teamId` works on `date` under the draft, through `projectedShiftType`. */
export function draftShiftTypeOn(draft: RotationDraft, teamId: string, date: string): string {
  return projectedShiftType(draftStepsOf(draft), draftAssignmentOf(draft, teamId), date);
}

/**
 * `count` consecutive dates from `from`, advanced with `nextIsoDate`. Shorter
 * only at the end of the calendar (9999-12-31 has no next day).
 */
export function datesFrom(from: string, count: number): readonly string[] {
  const dates: string[] = [];
  let date: string | null = from;

  while (date !== null && dates.length < count) {
    dates.push(date);
    date = nextIsoDate(date);
  }

  return dates;
}

// --------------------------------------------------------------- display

/** How one shift type is drawn: its ramp-slot chip, always with its name. */
export interface ShiftTypeChip {
  readonly shiftTypeId: string;
  readonly name: string;
  readonly chipClass: string;
  /** The same slot colour as a block — the preview's tile — as static class strings. */
  readonly tileClass: string;
  readonly archived: boolean;
}

/** The preview tile's shape; the colour is the type's slot, as the chip's. */
export const TILE_SHAPE_CLASS =
  'flex min-h-14 min-w-24 flex-col items-center justify-center gap-0.5 rounded-md px-2 py-2 text-center text-xs font-semibold';

/** What a tile says where a type has no clock range (non-working, or no times yet). */
export const NO_CLOCK_RANGE = NO_TIMES_SHOWN;

function chipsOf(types: readonly ShiftTypeRow[]): ReadonlyMap<string, ShiftTypeChip> {
  const slots = rampSlotsOf(types);

  return new Map(
    types.map((type) => [
      type.id,
      {
        shiftTypeId: type.id,
        name: type.name,
        chipClass: chipClassOf(type.isWorking ? (slots.get(type.id) ?? null) : null),
        tileClass: `${TILE_SHAPE_CLASS} ${slotColourClassOf(type.isWorking ? (slots.get(type.id) ?? null) : null)}`,
        archived: type.archived,
      },
    ]),
  );
}

function chipOf(chips: ReadonlyMap<string, ShiftTypeChip>, shiftTypeId: string): ShiftTypeChip {
  return (
    chips.get(shiftTypeId) ?? {
      shiftTypeId,
      name: shiftTypeId,
      chipClass: chipClassOf(null),
      tileClass: `${TILE_SHAPE_CLASS} ${slotColourClassOf(null)}`,
      archived: true,
    }
  );
}

/** The types a step may be added with: those in use, in creation order. */
export function addableTypesOf(snapshot: RotationSnapshot): readonly ShiftTypeChip[] {
  const chips = chipsOf(snapshot.types);

  return snapshot.types.filter((type) => !type.archived).map((type) => chipOf(chips, type.id));
}

/** One step as the builder lists it. */
export interface DraftStepRow {
  /** The step's stable client key: what the list row is keyed by. */
  readonly key: string;
  readonly index: number;
  /** 1-based, as the labels name it. */
  readonly position: number;
  readonly chip: ShiftTypeChip;
  readonly first: boolean;
  readonly last: boolean;
}

export function draftStepRowsOf(snapshot: RotationSnapshot, draft: RotationDraft): readonly DraftStepRow[] {
  const chips = chipsOf(snapshot.types);

  return draft.steps.map((shiftTypeId, index) => ({
    key: draft.keys[index] ?? stepKeyOf(index),
    index,
    position: index + 1,
    chip: chipOf(chips, shiftTypeId),
    first: index === 0,
    last: index === draft.steps.length - 1,
  }));
}

/** One active team as the offsets block lists it: its step, and what it works on the anchor. */
export interface DraftTeamRow {
  readonly team: TeamRow;
  readonly index: number;
  /** The type the team works on the anchor date, or `null` while the pattern is empty. */
  readonly onAnchor: ShiftTypeChip | null;
}

export function draftTeamRowsOf(snapshot: RotationSnapshot, draft: RotationDraft): readonly DraftTeamRow[] {
  const chips = chipsOf(snapshot.types);

  return rotationTeamsOf(snapshot).map((team) => ({
    team,
    index: draft.offsets[team.id] ?? 0,
    onAnchor:
      draft.steps.length === 0
        ? null
        : chipOf(chips, draftShiftTypeOn(draft, team.id, draft.anchorDate)),
  }));
}

/** One row of the cycle preview: a date, and one cell per active team. */
export interface PreviewRow {
  readonly date: string;
  /** `26.09.2026`, through the format layer. */
  readonly label: string;
  readonly cells: readonly { readonly teamId: string; readonly chip: ShiftTypeChip }[];
}

/**
 * One cycle of the unsaved draft, from `from` — the draft's effective date
 * (story 2.6): one row per date for the cycle length, one cell per active team
 * — every cell projected by `@shift/domain`. No rows while the pattern is empty.
 */
export function previewOf(
  snapshot: RotationSnapshot,
  draft: RotationDraft,
  from: string,
  cycles: number = 1,
): readonly PreviewRow[] {
  if (draft.steps.length === 0) return [];

  const chips = chipsOf(snapshot.types);
  const teams = rotationTeamsOf(snapshot);

  return datesFrom(from, draft.steps.length * previewCyclesOf(cycles)).map((date) => ({
    date,
    label: formatIsoDate(date) ?? date,
    cells: teams.map((team) => ({
      teamId: team.id,
      chip: chipOf(chips, draftShiftTypeOn(draft, team.id, date)),
    })),
  }));
}

/**
 * How many cycles the preview may show, from today (owner request): a view
 * choice only — never saved, and no part of what "unchanged" compares.
 */
export const PREVIEW_CYCLE_CHOICES = [1, 2, 3, 4, 5] as const;

export type PreviewCycles = (typeof PREVIEW_CYCLE_CHOICES)[number];

/** A preview column's classes; one that opens a cycle after the first carries a rule. */
const DAY_HEAD_CLASS = 'whitespace-nowrap text-center';
const CYCLE_START_HEAD_CLASS = 'whitespace-nowrap border-l-2 border-border text-center';
const DAY_CELL_CLASS = 'px-1.5';
const CYCLE_START_CELL_CLASS = 'border-l-2 border-border px-1.5';

/** A choice of cycles — a number or a `<select>`'s value — as one of the choices; anything else is 1. */
export function previewCyclesOf(value: number | string): PreviewCycles {
  const cycles = typeof value === 'number' ? value : /^\d+$/.test(value) ? Number(value) : 0;

  return PREVIEW_CYCLE_CHOICES.find((choice) => choice === cycles) ?? 1;
}

/** One date of the transposed preview: its column. */
export interface PreviewDay {
  readonly date: string;
  /** 1-based day WITHIN its cycle: it restarts at 1 with every cycle. */
  readonly dayNumber: number;
  /** 1-based cycle the date falls in, from today. */
  readonly cycleNumber: number;
  /** The first day of a cycle after the first: where the preview draws the boundary. */
  readonly startsCycle: boolean;
  /** The column's head and cell classes: a rule before a cycle's first day, as static strings. */
  readonly headClass: string;
  readonly cellClass: string;
  /** `26.09.`, through the format layer. */
  readonly label: string;
}

/** One team's cell on one date: the tile, and the type's clock range that day or `—`. */
export interface PreviewCell {
  readonly date: string;
  readonly chip: ShiftTypeChip;
  /** `19:00–07:00` from the version in effect on the date, or {@link NO_CLOCK_RANGE}. */
  readonly range: string;
}

/** The cycle preview, transposed (owner layout): one row per active team, one column per date. */
export interface PreviewGrid {
  readonly days: readonly PreviewDay[];
  readonly rows: readonly { readonly team: TeamRow; readonly cells: readonly PreviewCell[] }[];
}

/**
 * {@link previewOf} with teams as rows and dates as columns — every cell the
 * same projection by `@shift/domain`. A cell's clock range is the one its
 * type's version in effect ON THAT DATE gives (`shiftTypeVersionOn`), shaped
 * by `shiftTimesShownOf`; a non-working type, or a working one with no times
 * then, shows {@link NO_CLOCK_RANGE}.
 */
export function previewGridOf(
  snapshot: RotationSnapshot,
  draft: RotationDraft,
  from: string,
  cycles: number = 1,
): PreviewGrid {
  const byDate = previewOf(snapshot, draft, from, cycles);
  const length = draft.steps.length;
  // Day and cycle numbers by counting, not by division: day d of cycle c.
  const numbers: { readonly dayNumber: number; readonly cycleNumber: number }[] = [];

  for (let cycle = 1; numbers.length < byDate.length; cycle += 1) {
    for (let day = 1; day <= length && numbers.length < byDate.length; day += 1) {
      numbers.push({ dayNumber: day, cycleNumber: cycle });
    }
  }
  const types = new Map(snapshot.types.map((type) => [type.id, type]));
  const rangeOf = (shiftTypeId: string, date: string): string => {
    const type = types.get(shiftTypeId);
    const version = type === undefined || !type.isWorking ? null : shiftTypeVersionOn(type.versions, date);

    return version === null ? NO_CLOCK_RANGE : shiftTimesShownOf(version).range;
  };

  return {
    days: byDate.map((row, index) => {
      const { dayNumber, cycleNumber } = numbers[index] ?? { dayNumber: index + 1, cycleNumber: 1 };

      const startsCycle = dayNumber === 1 && cycleNumber > 1;

      return {
        date: row.date,
        dayNumber,
        cycleNumber,
        startsCycle,
        headClass: startsCycle ? CYCLE_START_HEAD_CLASS : DAY_HEAD_CLASS,
        cellClass: startsCycle ? CYCLE_START_CELL_CLASS : DAY_CELL_CLASS,
        label: formatIsoDayMonth(row.date) ?? row.date,
      };
    }),
    rows: rotationTeamsOf(snapshot).map((team, column) => ({
      team,
      cells: byDate.map((row) => {
        const chip = (row.cells[column] as { readonly chip: ShiftTypeChip }).chip;

        return { date: row.date, chip, range: rangeOf(chip.shiftTypeId, row.date) };
      }),
    })),
  };
}

// ---------------------------------------------------------------- figures

/** The figures under the steps, updated live. */
export interface DraftFigures {
  /** Days in one cycle: the number of steps. */
  readonly cycleLength: number;
  /** Steps whose type is working. */
  readonly workingSteps: number;
  /** Steps whose type is non-working (a day off). A type the snapshot lacks is neither. */
  readonly nonWorkingSteps: number;
  /**
   * Minutes worked over one cycle: the sum of each step's duration on the
   * date given — the draft's effective date (story 2.6) — from
   * `shiftDurationOn`. `null` — UNKNOWN, never a guessed 0 — when a working
   * step's type has no times in effect then.
   */
  readonly cycleMinutes: number | null;
}

export function figuresOf(snapshot: RotationSnapshot, draft: RotationDraft, on: string): DraftFigures {
  const byId = new Map(snapshot.types.map((type) => [type.id, type]));
  let workingSteps = 0;
  let nonWorkingSteps = 0;
  let cycleMinutes: number | null = 0;

  for (const shiftTypeId of draft.steps) {
    const type = byId.get(shiftTypeId);
    const minutes = type === undefined ? null : shiftDurationOn(type, type.versions, on);

    if (type?.isWorking === true) workingSteps += 1;
    if (type?.isWorking === false) nonWorkingSteps += 1;
    cycleMinutes = cycleMinutes === null || minutes === null ? null : cycleMinutes + minutes;
  }

  return { cycleLength: draft.steps.length, workingSteps, nonWorkingSteps, cycleMinutes };
}

// ------------------------------------------------------ refused before send

/** The pattern has no step. */
export const ROTATION_EMPTY = 'ROTATION_EMPTY';
/** The organization has no active team to bind. */
export const ROTATION_NO_TEAMS = 'ROTATION_NO_TEAMS';
/** A team's rotation already has a version scheduled after today (2.6 cancels it). */
export const ROTATION_SCHEDULED = 'ROTATION_SCHEDULED';
/** The effective date is before the organization's today: past schedules are never rewritten (2.6). */
export const ROTATION_EFFECTIVE_PAST = 'ROTATION_EFFECTIVE_PAST';
/** A step names an archived type: `0016` refuses a step on one. */
export const ROTATION_TYPE_ARCHIVED = 'ROTATION_TYPE_ARCHIVED';
/** The draft is the rotation in force: the same steps and the same projection over a cycle. */
export const ROTATION_UNCHANGED = 'ROTATION_UNCHANGED';
/** A team's latest version is already dated the effective date; the save dates every version on it. */
export const ROTATION_CHANGED_TODAY = 'ROTATION_CHANGED_TODAY';

export type DraftRefusal =
  | typeof ROTATION_EMPTY
  | typeof ROTATION_NO_TEAMS
  | typeof ROTATION_SCHEDULED
  | typeof ROTATION_EFFECTIVE_PAST
  | typeof ROTATION_TYPE_ARCHIVED
  | typeof ROTATION_UNCHANGED
  | typeof ROTATION_CHANGED_TODAY;

function sameSequence(one: readonly string[], other: readonly string[]): boolean {
  return one.length === other.length && one.every((id, index) => id === other[index]);
}

/**
 * Whether saving `draft` from `from` — its effective date (story 2.6) — would
 * change nothing: every active team has a rotation in force ON THAT DATE whose
 * pattern is the draft's sequence of type ids, and on every date of one cycle
 * from it the team stands on the same step index under both. A new pattern id
 * alone would pass the database's "changes the value" rule and write a
 * redundant version, so this is judged by projection, not by ids.
 */
export function draftUnchangedOf(snapshot: RotationSnapshot, draft: RotationDraft, from: string): boolean {
  const teams = rotationTeamsOf(snapshot);
  const cycle = datesFrom(from, draft.steps.length);

  return (
    teams.length > 0 &&
    teams.every((team) => {
      const assignment = assignmentInForceOf(snapshot, team.id, from);

      if (assignment === null) return false;

      const steps = patternStepsOf(snapshot, assignment.patternId);

      if (!sameSequence(steps.map((step) => step.shiftTypeId), draft.steps)) return false;

      return cycle.every((date) => {
        const stored = projectedStepId(steps, assignment, date);

        return steps.findIndex((step) => step.id === stored) === draftStepIndexOn(draft, team.id, date);
      });
    })
  );
}

/**
 * Why `draft` is refused before anything is sent, or `null`. Every entered
 * value is kept either way; each reason has its own message.
 *
 * `today` is the organization's: the effective date may be no earlier, and a
 * change scheduled after it refuses the save. Everything the save changes is
 * judged FROM THE DRAFT'S EFFECTIVE DATE (story 2.6).
 *
 * A SCHEDULED CHANGE IS CHECKED FIRST: its refusal is where the cancel is
 * offered, so no other refusal — an empty pattern, no team, an effective date
 * that became yesterday at midnight — may hide it.
 */
export function draftRefusalOf(
  snapshot: RotationSnapshot,
  draft: RotationDraft,
  today: string,
): DraftRefusal | null {
  if (rotationScheduledOf(snapshot, today)) return ROTATION_SCHEDULED;
  if (draft.steps.length === 0) return ROTATION_EMPTY;
  if (rotationTeamsOf(snapshot).length === 0) return ROTATION_NO_TEAMS;
  // ISO dates order as strings: this is the insert policy's own comparison.
  if (!isIsoDate(draft.effectiveFrom) || draft.effectiveFrom < today) return ROTATION_EFFECTIVE_PAST;

  const inUse = new Set(snapshot.types.filter((type) => !type.archived).map((type) => type.id));

  if (draft.steps.some((shiftTypeId) => !inUse.has(shiftTypeId))) return ROTATION_TYPE_ARCHIVED;
  if (draftUnchangedOf(snapshot, draft, draft.effectiveFrom)) return ROTATION_UNCHANGED;
  if (rotationChangedTodayOf(snapshot, draft.effectiveFrom)) return ROTATION_CHANGED_TODAY;

  return null;
}
