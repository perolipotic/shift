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
