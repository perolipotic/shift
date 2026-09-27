import { beforeAll, describe, expect, it } from 'vitest';

import { initLocalization, t } from '@/lib/i18n';
import { storedAccentLabel } from '@/features/organization/utils/accent-label';

beforeAll(async () => {
  await initLocalization();
});

describe('the stored accent label says what the row holds', () => {
  it('names a curated accent the way its option does', () => {
    expect(storedAccentLabel('blue')).toBe(t('organization.accentBlue'));
    expect(storedAccentLabel('blue')).toBe('Plava');
  });

  it('shows an accent this build cannot render as its stored value, never as Neutralna', () => {
    // A newer build may store a key this one does not know. Folded to the
    // neutral name, the status line would claim the organization has no accent.
    expect(storedAccentLabel('teal')).toBe('teal');
    expect(storedAccentLabel('teal')).not.toBe(t('organization.accentNone'));
  });

  it('names no accent as the neutral option', () => {
    expect(storedAccentLabel(null)).toBe(t('organization.accentNone'));
    expect(storedAccentLabel(null)).toBe('Neutralna');
  });
});
