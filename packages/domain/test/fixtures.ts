import type { HourBand } from '../src/index.js';

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

export { at };
