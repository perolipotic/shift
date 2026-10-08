import { beforeAll, describe, expect, it } from 'vitest';

import { initLocalization } from '@/lib/i18n';
import { DAYS_CELL, LEVEL_CELL, NAME_CELL, TEXT_CELL } from '@/features/members/services/list';
import { cellUnit } from '@/features/members/utils/cell-content';

/**
 * Story 7.6's unit beside a member's leave allowance on the phone's stacked
 * row, executed (AD-15): Croatian's three plural forms, and nothing for a
 * cell that is not a figure.
 */

beforeAll(async () => {
  await initLocalization();
});

describe('cellUnit', () => {
  it('says the allowance in the count plural: 1 dan, 2 dana, 21 dan', () => {
    expect(cellUnit({ kind: DAYS_CELL, days: 1 })).toBe('dan god.');
    expect(cellUnit({ kind: DAYS_CELL, days: 2 })).toBe('dana god.');
    expect(cellUnit({ kind: DAYS_CELL, days: 5 })).toBe('dana god.');
    expect(cellUnit({ kind: DAYS_CELL, days: 21 })).toBe('dan god.');
  });

  it('gives no unit for a cell that is not a figure', () => {
    expect(cellUnit({ kind: TEXT_CELL, text: 'ana@example.org' })).toBeNull();
    expect(cellUnit({ kind: NAME_CELL, text: 'Ana', initials: 'A' })).toBeNull();
    expect(cellUnit({ kind: LEVEL_CELL, level: 'admin' })).toBeNull();
  });
});
