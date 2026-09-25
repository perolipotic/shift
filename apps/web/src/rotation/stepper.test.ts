import { describe, expect, it } from 'vitest';

import {
  STEPPER_START,
  STEPPER_STEPS,
  STEP_CURRENT,
  STEP_REACHED,
  STEP_UNREACHED,
  nextMessageKey,
  nextStepOf,
  previousStepOf,
  stepMessageKey,
  stepOpenable,
  stepGroupClassOf,
  shownStepperOf,
  stepSectionClassOf,
  stepStatusOf,
  stepperBack,
  stepperNext,
  stepperOpen,
  stepperStepOf,
  type StepperState,
} from '@/rotation/stepper';

/**
 * The phone stepper's rules (story 2.4): four steps, Dalje raises `reached`,
 * Natrag goes back, and the bar opens only a step already reached. Nothing
 * here reads the draft.
 */

describe('the steps', () => {
  it('are four, in order, and a fresh tab opens on step 1 with nothing passed', () => {
    expect(STEPPER_STEPS).toEqual([1, 2, 3, 4]);
    expect(STEPPER_START).toEqual({ current: 1, reached: 1 });
  });

  it('reads a number or a one-digit string as a step, and anything else as none', () => {
    expect(stepperStepOf(3)).toBe(3);
    expect(stepperStepOf('2')).toBe(2);
    expect(stepperStepOf(7)).toBeNull();
    expect(stepperStepOf(0)).toBeNull();
    expect(stepperStepOf(2.5)).toBeNull();
    expect(stepperStepOf('x')).toBeNull();
    expect(stepperStepOf('')).toBeNull();
    expect(stepperStepOf('12')).toBeNull();
    expect(stepperStepOf(' 1')).toBeNull();
  });

  it('knows the step after and before each one, with none past either end', () => {
    expect(STEPPER_STEPS.map(nextStepOf)).toEqual([2, 3, 4, null]);
    expect(STEPPER_STEPS.map(previousStepOf)).toEqual([null, 1, 2, 3]);
  });
});

describe('Dalje and Natrag', () => {
  it('Dalje twice from step 1 lands on step 3, with 1 and 2 done, 3 current and 4 disabled', () => {
    const state = stepperNext(stepperNext(STEPPER_START));

    expect(state).toEqual({ current: 3, reached: 3 });
    expect(STEPPER_STEPS.map((step) => stepStatusOf(state, step))).toEqual([
      STEP_REACHED,
      STEP_REACHED,
      STEP_CURRENT,
      STEP_UNREACHED,
    ]);
  });

  it('Dalje on the last step changes nothing', () => {
    const last: StepperState = { current: 4, reached: 4 };

    expect(stepperNext(last)).toBe(last);
  });

  it('Dalje from a step behind the furthest one keeps what was reached', () => {
    expect(stepperNext({ current: 1, reached: 3 })).toEqual({ current: 2, reached: 3 });
  });

  it('Natrag goes back one step and keeps what was reached; on step 1 it changes nothing', () => {
    expect(stepperBack({ current: 3, reached: 3 })).toEqual({ current: 2, reached: 3 });
    expect(stepperBack(STEPPER_START)).toBe(STEPPER_START);
  });

  it('never looks at the draft: every step goes on, an empty pattern included', () => {
    // The signatures take the stepper state alone — nothing else can gate them.
    expect(stepperNext.length).toBe(1);
    expect(stepperBack.length).toBe(1);
    expect(stepperNext({ current: 2, reached: 2 })).toEqual({ current: 3, reached: 3 });
  });
});

describe('the step bar', () => {
  it('on a fresh tab opens only Tipovi', () => {
    expect(STEPPER_STEPS.map((step) => stepOpenable(STEPPER_START, step))).toEqual([true, false, false, false]);
    expect(STEPPER_STEPS.map((step) => stepStatusOf(STEPPER_START, step))).toEqual([
      STEP_CURRENT,
      STEP_UNREACHED,
      STEP_UNREACHED,
      STEP_UNREACHED,
    ]);
  });

  it('goes back to Uzorak from step 3, and Pomaci stays openable', () => {
    const back = stepperOpen({ current: 3, reached: 3 }, 2);

    expect(back).toEqual({ current: 2, reached: 3 });
    expect(stepOpenable(back, 3)).toBe(true);
    expect(stepStatusOf(back, 3)).toBe(STEP_REACHED);
    expect(stepperOpen(back, 3)).toEqual({ current: 3, reached: 3 });
  });

  it('refuses a forward jump past what was reached', () => {
    const state: StepperState = { current: 2, reached: 2 };

    expect(stepperOpen(state, 4)).toBe(state);
    expect(stepperOpen(state, 3)).toBe(state);
  });

  it('changes nothing when the current step is tapped', () => {
    const state: StepperState = { current: 2, reached: 3 };

    expect(stepperOpen(state, 2)).toBe(state);
  });
});

describe('the sections', () => {
  it('hides every section but the current one below sm, and keeps each a min-w-0 grid item', () => {
    const state: StepperState = { current: 2, reached: 3 };

    expect(STEPPER_STEPS.map((step) => stepSectionClassOf(state, step))).toEqual([
      'min-w-0 max-sm:hidden',
      'min-w-0',
      'min-w-0 max-sm:hidden',
      'min-w-0 max-sm:hidden',
    ]);
  });

  it('never hides anything from sm up: the only hiding class is max-sm:', () => {
    for (const current of STEPPER_STEPS) {
      for (const step of STEPPER_STEPS) {
        const classes = stepSectionClassOf({ current, reached: 4 }, step).split(' ');

        expect(classes.filter((name) => name.includes('hidden'))).toEqual(
          step === current ? [] : ['max-sm:hidden'],
        );
      }
    }
  });
});

describe('the stepper with no draft', () => {
  it('lays the sections out as step 1 while there is no draft, and as stored once there is', () => {
    const stored: StepperState = { current: 3, reached: 4 };

    expect(shownStepperOf(stored, false)).toEqual({ current: 1, reached: 1 });
    expect(stepSectionClassOf(shownStepperOf(stored, false), 1)).toBe('min-w-0');
    expect(stepGroupClassOf(shownStepperOf(stored, false), [1, 2])).toBe('min-w-0');
    expect(shownStepperOf(stored, true)).toBe(stored);
  });
});

describe('the group of sections 1 and 2', () => {
  it('hides below sm only when neither of its steps is current', () => {
    expect(STEPPER_STEPS.map((current) => stepGroupClassOf({ current, reached: 4 }, [1, 2]))).toEqual([
      'min-w-0',
      'min-w-0',
      'min-w-0 max-sm:hidden',
      'min-w-0 max-sm:hidden',
    ]);
  });
});

describe('the words', () => {
  it('names each step', () => {
    expect(STEPPER_STEPS.map(stepMessageKey)).toEqual([
      'rotation.builder.stepper.step.types',
      'rotation.builder.stepper.step.pattern',
      'rotation.builder.stepper.step.offsets',
      'rotation.builder.stepper.step.preview',
    ]);
  });

  it('names the step Dalje leads to', () => {
    expect(([2, 3, 4] as const).map(nextMessageKey)).toEqual([
      'rotation.builder.stepper.next.pattern',
      'rotation.builder.stepper.next.offsets',
      'rotation.builder.stepper.next.preview',
    ]);
  });
});
