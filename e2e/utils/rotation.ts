import { hr } from './i18n.ts';

/**
 * The rotation screen's phone stepper, as data: its four steps' names and
 * headings and Dalje's labels, for the page object and the specs alike. The
 * locators and actions are `RotationPage`'s (`e2e/pages/rotation.page.ts`).
 */

const builder = hr.rotation.builder;
const stepper = builder.stepper;

/** The phone stepper's four step names, in order. */
export const STEP_NAMES = [
  stepper.step.types,
  stepper.step.pattern,
  stepper.step.offsets,
  stepper.step.preview,
] as const;

/** Dalje's label on steps 1–3, naming the step it leads to. */
export const NEXT_LABELS = [stepper.next.pattern, stepper.next.offsets, stepper.next.preview] as const;

/** The heading each step's section carries, in order. */
export const STEP_HEADINGS = [
  hr.rotation.shiftTypes.heading,
  builder.patternHeading,
  builder.offsetsHeading,
  builder.previewHeading,
] as const;

/** What a seeded rotation's schedule needs to count leave days: its anchor and each step's type and times. */
interface SeededSchedule {
  /** The version's anchor, `YYYY-MM-DD`, at the pattern's first step. */
  readonly start: string;
  /** Each step's shift type name, as the calendar names it. */
  readonly steps: readonly string[];
  /** Each step's times, `null` for a non-working step. */
  readonly ranges: readonly (string | null)[];
}

const DAY_MS = 86_400_000;

/** A charged leave date and the shift type the seeded pattern puts on it. */
export interface ChargedLeaveDate {
  readonly date: string;
  readonly shiftType: string;
}

/**
 * The dates a record `from`–`to` charges in `month` (`YYYY-MM`), in order, to
 * an active member of a team on `seed`'s rotation, derived from the seeded
 * schedule as *Godišnji* charges them (R4.2): each date of the record inside
 * the month on which the pattern's step is a working one. No date before the
 * anchor is scheduled.
 *
 * THE SIMPLIFICATIONS the scenarios rely on, which the app's rule does not
 * make: the member stays active throughout (no status change), the team has
 * one rotation version from the anchor (no later version), and no shift-type
 * or roster override touches the member's dates. A replacement's override
 * only adds the replacement (human, 2026-10-02), so the absent member keeps
 * their shift and its date stays charged; an accepted-uncovered shift stays
 * scheduled too. A scenario that breaks any of these cannot use this count.
 */
export function chargedLeaveDates(seed: SeededSchedule, from: string, to: string, month: string): readonly ChargedLeaveDate[] {
  if (seed.ranges.length === 0 || seed.ranges.length !== seed.steps.length) {
    throw new Error('E2E: a seeded rotation with no steps, or steps and times that disagree, schedules nothing to count');
  }

  const anchor = Date.parse(`${seed.start}T12:00:00Z`);
  const dates: ChargedLeaveDate[] = [];

  for (let day = Date.parse(`${from}T12:00:00Z`); day <= Date.parse(`${to}T12:00:00Z`); day += DAY_MS) {
    const date = new Date(day).toISOString().slice(0, 10);
    const offset = Math.round((day - anchor) / DAY_MS);

    if (!date.startsWith(`${month}-`) || offset < 0) continue;

    const step = offset % seed.ranges.length;

    if (seed.ranges[step] !== null) dates.push({ date, shiftType: seed.steps[step]! });
  }

  return dates;
}

/** How many leave days {@link chargedLeaveDates} counts: the leave figure *Sati* shows. */
export function chargedLeaveDays(seed: SeededSchedule, from: string, to: string, month: string): number {
  return chargedLeaveDates(seed, from, to, month).length;
}
