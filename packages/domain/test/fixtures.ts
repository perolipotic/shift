import type { HourBand, ShiftType, ShiftTypeVersion } from '../src/index.js';

/**
 * Both fixtures, as the domain sees them (Q10), and the ONE source of truth
 * for their hour bands. `test/rls-isolation.test.ts` imports these two arrays,
 * converts each start to `HH:MM:SS`, and asserts that each fixture reads back
 * exactly those names and starts from `supabase/seed.sql` after a
 * `supabase db reset` — so a seed that drifted from these values, or these
 * from the seed, fails that suite.
 *
 * Ids are opaque labels here — the domain never reads meaning into one, nor
 * into a name.
 */

const at = (hours: number, minutes = 0): number => hours * 60 + minutes;

/** The pilot: two bands, Dan@07:00 and Noć@19:00. */
export const PILOT_HOUR_BANDS: readonly HourBand[] = [
  { id: 'pilot-dan', name: 'Dan', startMinute: at(7) },
  { id: 'pilot-noc', name: 'Noć', startMinute: at(19) },
];

/**
 * UJ-5: three bands, Jutro@05:00, Popodne@13:00 and Noć@21:00. Its 8-hour
 * shifts start at 06:00, 14:00 and 22:00, so every shift straddles a band edge.
 */
export const UJ5_HOUR_BANDS: readonly HourBand[] = [
  { id: 'uj5-jutro', name: 'Jutro', startMinute: at(5) },
  { id: 'uj5-popodne', name: 'Popodne', startMinute: at(13) },
  { id: 'uj5-noc', name: 'Noć', startMinute: at(21) },
];

/**
 * STORY 2.2a. Both fixtures' shift types, in CREATION ORDER (2.2b takes a ramp
 * slot from it, and `supabase/seed.sql` writes ascending `created_at` in this
 * order), and each working type's one version. `test/rls-isolation.test.ts`
 * reads these back from the seed, as it does the bands.
 *
 * Every seeded version is effective from {@link SEEDED_EFFECTIVE_FROM}, so a
 * projection may read any past date. A non-working type has no version.
 */
export const SEEDED_EFFECTIVE_FROM = '2020-01-01';

/** The pilot: Dan 07:00–19:00, Noć 19:00–07:00 (crossing), Slobodno. */
export const PILOT_SHIFT_TYPES: readonly ShiftType[] = [
  { id: 'pilot-dan', name: 'Dan', isWorking: true },
  { id: 'pilot-noc', name: 'Noć', isWorking: true },
  { id: 'pilot-slobodno', name: 'Slobodno', isWorking: false },
];

export const PILOT_SHIFT_TYPE_VERSIONS: readonly ShiftTypeVersion[] = [
  { shiftTypeId: 'pilot-dan', effectiveFrom: SEEDED_EFFECTIVE_FROM, startMinute: at(7), endMinute: at(19) },
  { shiftTypeId: 'pilot-noc', effectiveFrom: SEEDED_EFFECTIVE_FROM, startMinute: at(19), endMinute: at(7) },
];

/**
 * UJ-5: three 8-hour types, Jutarnja 06:00–14:00, Popodnevna 14:00–22:00 and
 * Noćna 22:00–06:00 (crossing), and Slobodno. Each straddles a band edge.
 */
export const UJ5_SHIFT_TYPES: readonly ShiftType[] = [
  { id: 'uj5-jutarnja', name: 'Jutarnja', isWorking: true },
  { id: 'uj5-popodnevna', name: 'Popodnevna', isWorking: true },
  { id: 'uj5-nocna', name: 'Noćna', isWorking: true },
  { id: 'uj5-slobodno', name: 'Slobodno', isWorking: false },
];

export const UJ5_SHIFT_TYPE_VERSIONS: readonly ShiftTypeVersion[] = [
  { shiftTypeId: 'uj5-jutarnja', effectiveFrom: SEEDED_EFFECTIVE_FROM, startMinute: at(6), endMinute: at(14) },
  { shiftTypeId: 'uj5-popodnevna', effectiveFrom: SEEDED_EFFECTIVE_FROM, startMinute: at(14), endMinute: at(22) },
  { shiftTypeId: 'uj5-nocna', effectiveFrom: SEEDED_EFFECTIVE_FROM, startMinute: at(22), endMinute: at(6) },
];

export { at };
