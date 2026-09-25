/**
 * The working-shift ramp: which of the six colour slots a working shift type
 * takes (story 2.2b, UX-DR3, UX-DR6).
 *
 * DERIVED, NEVER STORED. A working type's slot is `(i mod 6) + 1`, where `i`
 * is its index among the organization's WORKING types — archived ones
 * included, so archiving one never moves the slots of the types after it —
 * in creation order. The ordering itself is `@/shift-types/list`'s; this
 * module only turns an index into a slot and a slot into its token.
 *
 * Beyond six working types a slot repeats. The chip always shows the type's
 * NAME as text, so colour never carries the distinction alone.
 *
 * KEEP THIS MODULE IMPORT-FREE. `test/theme-contrast.test.ts` imports it from
 * the root project, which resolves no `@/` alias, to pin that every slot this
 * function can return has a measured pair in both themes.
 */

/** How many working slots the theme defines (`--shift-slot-1..6`). */
export const RAMP_SLOT_COUNT = 6;

export type RampSlot = 1 | 2 | 3 | 4 | 5 | 6;

/** The token a non-working type is drawn in. */
export const NONWORKING_TOKEN = 'shift-nonworking';

/**
 * The slot the working type at `index` takes: `(index mod 6) + 1`.
 *
 * @throws RangeError when `index` is not a non-negative integer.
 */
export function rampSlotOf(index: number): RampSlot {
  if (!Number.isInteger(index) || index < 0) {
    throw new RangeError(`RAMP_INDEX_INVALID:${String(index)}`);
  }

  return ((index % RAMP_SLOT_COUNT) + 1) as RampSlot;
}

/** The theme token a slot names — `shift-slot-3` — or the non-working one. */
export function rampTokenOf(slot: RampSlot | null): string {
  return slot === null ? NONWORKING_TOKEN : `shift-slot-${String(slot)}`;
}
