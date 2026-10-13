import { describe, expect, it } from 'vitest';

import { NO_TEXT, shownDate } from '@/utils/text';

describe('the shared text', () => {
  it('names the empty string', () => {
    expect(NO_TEXT).toBe('');
  });

  it('shows an ISO date in the binding shape, and a malformed one unchanged', () => {
    expect(shownDate('2026-09-23')).toBe('23.09.2026');
    expect(shownDate('nonsense')).toBe('nonsense');
    expect(shownDate('2026-02-31')).toBe('2026-02-31');
  });
});
