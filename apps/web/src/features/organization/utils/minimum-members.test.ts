import { describe, expect, it } from 'vitest';

import { enteredMinimumMembers, MINIMUM_MEMBERS_MAX } from '@/features/organization/utils/minimum-members';
import hr from '@/lib/i18n/locales/hr.json';

describe('enteredMinimumMembers (story 11.1)', () => {
  it('reads an empty field as not set', () => {
    expect(enteredMinimumMembers('')).toEqual({ ok: true, value: null });
    expect(enteredMinimumMembers('   ')).toEqual({ ok: true, value: null });
  });

  it('reads a whole number from 1 to the column maximum as itself', () => {
    expect(enteredMinimumMembers('3')).toEqual({ ok: true, value: 3 });
    expect(enteredMinimumMembers(' 1 ')).toEqual({ ok: true, value: 1 });
    expect(enteredMinimumMembers('007')).toEqual({ ok: true, value: 7 });
    expect(enteredMinimumMembers(String(MINIMUM_MEMBERS_MAX))).toEqual({ ok: true, value: MINIMUM_MEMBERS_MAX });
  });

  it.each(['0', '-1', '2.5', '2,5', 'abc', '1e1', '+3', '0x10', String(MINIMUM_MEMBERS_MAX + 1), '40000'])('refuses %j', (value) => {
    expect(enteredMinimumMembers(value)).toEqual({ ok: false });
  });

  it('reads no entry as empty, and a file as no number', () => {
    expect(enteredMinimumMembers(null)).toEqual({ ok: true, value: null });
    expect(enteredMinimumMembers(new File(['3'], 'three.txt'))).toEqual({ ok: false });
  });

  it('has its refusal and its facts in the resource file', () => {
    const organization = hr.organization as Record<string, unknown> & { error: Record<string, unknown> };
    for (const key of ['minimumMembers', 'minimumMembersNotSet', 'minimumMembersHint', 'minimumMembersStatusSet', 'minimumMembersStatusNotSet', 'editMinimumMembers']) {
      expect(organization[key], key).toBeTruthy();
    }
    expect(organization.error['minimumMembers']).toBeTruthy();
  });
});
