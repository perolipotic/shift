/**
 * The four-step pattern `seedTeamRotation` writes — `[Dan, Noć, Slobodno,
 * Slobodno]` — and what a date reads on it, DB-free so a root unit test can
 * check the choice of offset (spec-e2e-midnight-guard-gap).
 */

/** One step: a working one with its `HH:MM` start and end, or a non-working one. */
export type SeededStep = { readonly working: true; readonly start: string; readonly end: string } | { readonly working: false };

/** The seeded pattern, in order: Dan 07:00–19:00, Noć 19:00–07:00, Slobodno, Slobodno. */
export const SEEDED_STEPS: readonly [SeededStep, SeededStep, SeededStep, SeededStep] = [
  { working: true, start: '07:00', end: '19:00' },
  { working: true, start: '19:00', end: '07:00' },
  { working: false },
  { working: false },
];

/** The step a date `days` days after the version's start falls on (negative: before it). */
export function seededStepAt(days: number): number {
  const length = SEEDED_STEPS.length;

  return ((days % length) + length) % length;
}

/** A working step that ends on the next date (its end is not after its start). */
function overnight(step: SeededStep): boolean {
  return step.working && step.end <= step.start;
}

/**
 * Whether *Danas* reads "Danas ne radiš" at EVERY hour of today, for a rotation
 * started `daysBefore` days before today: today's step is non-working AND
 * yesterday's step does not run past midnight. A Slobodno right after the Noć
 * (`daysBefore` 2) reads "Danas radiš … od jučer" from 00:00 to 07:00 — the
 * lone-Noć carry-over (spec-fix-danas-overnight-carry-over) — so a free-day
 * test seeded that way fails whenever CI reaches it before 07:00 Zagreb.
 */
export function freeAllDay(daysBefore: number): boolean {
  const today = SEEDED_STEPS[seededStepAt(daysBefore)];
  const yesterday = SEEDED_STEPS[seededStepAt(daysBefore - 1)];
  if (today === undefined || yesterday === undefined) throw new Error('E2E: a step outside the seeded pattern');

  return !today.working && !overnight(yesterday);
}

/**
 * The offset a free-day test seeds with: today the second Slobodno, yesterday
 * the first, so no shift is running at any hour and the Dan is tomorrow.
 */
export const FREE_ALL_DAY_DAYS_BEFORE = 3;
