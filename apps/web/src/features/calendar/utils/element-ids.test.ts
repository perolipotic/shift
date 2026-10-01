import { describe, expect, it } from 'vitest';

import { ROSTER_OVERLAP_ID, ROSTER_SET_ERROR_ID, describedByOf } from '@/features/calendar/utils/element-ids';

describe('an aria-describedby of the ids given (Epic 4 retro C2)', () => {
  it('ties the overlap hint to the "Dolazi" select beside a refusal, and leaves the attribute off for none', () => {
    expect(describedByOf(ROSTER_SET_ERROR_ID, ROSTER_OVERLAP_ID)).toBe('kalendar-roster-set-error kalendar-roster-overlap');
    expect(describedByOf(null, ROSTER_OVERLAP_ID)).toBe('kalendar-roster-overlap');
    expect(describedByOf(ROSTER_SET_ERROR_ID, null)).toBe('kalendar-roster-set-error');
    expect(describedByOf(null, null)).toBeUndefined();
  });
});
