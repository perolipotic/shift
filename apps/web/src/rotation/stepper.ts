/**
 * The rotation builder's phone stepper (story 2.4, UX-DR16): below `sm`
 * (640 px) the four numbered sections are shown one at a time — 1 Tipovi,
 * 2 Uzorak, 3 Pomaci, 4 Pregled — with a step bar above them and Natrag /
 * Dalje below. From `sm` up there is no stepper at all.
 *
 * ONE DOM TREE, CSS ONLY. Every section is always rendered; one that is not
 * the current step is hidden below `sm` by {@link stepSectionClassOf}'s
 * `max-sm:hidden`. No width is read in script, so the draft, the validations
 * and the order are the same at every width by construction, and Dalje never
 * remounts a section.
 *
 * "REACHED", NOT "VALIDATED". A step is completed once it has been passed with
 * Dalje. Nothing here looks at the draft: Dalje and Natrag are never disabled
 * for a draft reason, and the save's own refusals stay the only validations,
 * at every width.
 *
 * Pure: the section only renders what these rules return.
 */

/** The four steps, in order. */
export const STEPPER_STEPS = [1, 2, 3, 4] as const;

export type StepperStep = (typeof STEPPER_STEPS)[number];

/** A step Dalje can lead to: every step but the first. */
export type ForwardStep = Exclude<StepperStep, 1>;

/** Where the stepper stands, and the furthest step Dalje has reached. */
export interface StepperState {
  readonly current: StepperStep;
  readonly reached: StepperStep;
}

/** A fresh tab: step 1, nothing passed yet. */
export const STEPPER_START: StepperState = { current: 1, reached: 1 };

/**
 * The state the sections are laid out by. While the builder has a draft it is
 * the stored one; while it has none (loading, or a refused read) only section
 * 1 exists, so it is laid out as step 1 — the stored step is left as it was,
 * and returns with the draft — and the section hides the bar and Natrag /
 * Dalje, which would otherwise lead to empty steps.
 */
export function shownStepperOf(state: StepperState, hasDraft: boolean): StepperState {
  return hasDraft ? state : STEPPER_START;
}

/** How one step reads in the bar. */
export const STEP_CURRENT = 'current';
export const STEP_REACHED = 'reached';
export const STEP_UNREACHED = 'unreached';

export type StepStatus = typeof STEP_CURRENT | typeof STEP_REACHED | typeof STEP_UNREACHED;

/** A number or a string as one of the four steps, or `null` for anything else. */
export function stepperStepOf(value: number | string): StepperStep | null {
  const step = typeof value === 'number' ? value : /^\d$/.test(value) ? Number(value) : 0;

  return STEPPER_STEPS.find((candidate) => candidate === step) ?? null;
}

/** The step after this one, or `null` on the last. */
export function nextStepOf(step: StepperStep): ForwardStep | null {
  if (step === 1) return 2;
  if (step === 2) return 3;
  if (step === 3) return 4;

  return null;
}

/** The step before this one, or `null` on the first. */
export function previousStepOf(step: StepperStep): StepperStep | null {
  if (step === 4) return 3;
  if (step === 3) return 2;
  if (step === 2) return 1;

  return null;
}

/** Dalje: one step on, raising `reached`. On the last step, nothing changes. */
export function stepperNext(state: StepperState): StepperState {
  const next = nextStepOf(state.current);

  if (next === null) return state;

  return { current: next, reached: next > state.reached ? next : state.reached };
}

/** Natrag: one step back; `reached` stays. On the first step, nothing changes. */
export function stepperBack(state: StepperState): StepperState {
  const previous = previousStepOf(state.current);

  return previous === null ? state : { current: previous, reached: state.reached };
}

/**
 * Whether a step in the bar opens: a completed step, backward always and
 * forward only up to what Dalje already reached.
 */
export function stepOpenable(state: StepperState, step: StepperStep): boolean {
  return step <= state.reached;
}

/** A tap in the bar: the step, when it opens; otherwise nothing changes. */
export function stepperOpen(state: StepperState, step: StepperStep): StepperState {
  if (!stepOpenable(state, step) || step === state.current) return state;

  return { current: step, reached: state.reached };
}

/**
 * How a step reads in the bar: the current one; one already reached (a check
 * and "završeno" beside its name, never colour alone); or not yet reached,
 * which is disabled.
 */
export function stepStatusOf(state: StepperState, step: StepperStep): StepStatus {
  if (step === state.current) return STEP_CURRENT;

  return stepOpenable(state, step) ? STEP_REACHED : STEP_UNREACHED;
}

/** A section's wrapper: a grid item either way, hidden below `sm` unless it is the current step. */
const SECTION_SHOWN_CLASS = 'min-w-0';
const SECTION_HIDDEN_CLASS = 'min-w-0 max-sm:hidden';

/** The class of the wrapper around a step's section. From `sm` up, every section shows. */
export function stepSectionClassOf(state: StepperState, step: StepperStep): string {
  return step === state.current ? SECTION_SHOWN_CLASS : SECTION_HIDDEN_CLASS;
}

/**
 * The class of the wrapper around a GROUP of sections — the grid holding
 * sections 1 and 2 — hidden below `sm` when none of its steps is current, so
 * an empty grid leaves no gap of its own on steps 3 and 4.
 */
export function stepGroupClassOf(state: StepperState, steps: readonly StepperStep[]): string {
  return steps.includes(state.current) ? SECTION_SHOWN_CLASS : SECTION_HIDDEN_CLASS;
}

/** A step's name in the bar. */
export function stepMessageKey(
  step: StepperStep,
):
  | 'rotation.builder.stepper.step.types'
  | 'rotation.builder.stepper.step.pattern'
  | 'rotation.builder.stepper.step.offsets'
  | 'rotation.builder.stepper.step.preview' {
  switch (step) {
    case 1:
      return 'rotation.builder.stepper.step.types';
    case 2:
      return 'rotation.builder.stepper.step.pattern';
    case 3:
      return 'rotation.builder.stepper.step.offsets';
    case 4:
      return 'rotation.builder.stepper.step.preview';
  }
}

/** Dalje's label, naming the step it leads to (`Dalje — pregled`). */
export function nextMessageKey(
  step: ForwardStep,
):
  | 'rotation.builder.stepper.next.pattern'
  | 'rotation.builder.stepper.next.offsets'
  | 'rotation.builder.stepper.next.preview' {
  switch (step) {
    case 2:
      return 'rotation.builder.stepper.next.pattern';
    case 3:
      return 'rotation.builder.stepper.next.offsets';
    case 4:
      return 'rotation.builder.stepper.next.preview';
  }
}
