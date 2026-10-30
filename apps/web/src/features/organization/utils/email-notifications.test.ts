import { describe, expect, it } from 'vitest';

import {
  EMAIL_NOTIFICATIONS_OFF,
  EMAIL_NOTIFICATIONS_ON,
  EMAIL_NOTIFICATIONS_OPTIONS,
  emailNotificationsMessageKey,
  emailNotificationsOf,
  emailNotificationsStatusMessageKey,
  emailNotificationsValue,
} from '@/features/organization/utils/email-notifications';
import hr from '@/lib/i18n/locales/hr.json';

describe("the organization's email-notifications switch (story 10.3)", () => {
  it('offers on first, the default, then off', () => {
    expect(EMAIL_NOTIFICATIONS_OPTIONS).toEqual([true, false]);
  });

  it('round-trips the radio value, and keeps the stored setting for anything else', () => {
    for (const on of [true, false]) {
      expect(emailNotificationsOf(emailNotificationsValue(on), !on)).toBe(on);
    }
    expect(emailNotificationsValue(true)).toBe(EMAIL_NOTIFICATIONS_ON);
    expect(emailNotificationsValue(false)).toBe(EMAIL_NOTIFICATIONS_OFF);
    expect(emailNotificationsValue(true)).not.toBe(emailNotificationsValue(false));
    expect(emailNotificationsOf('maybe', true)).toBe(true);
    expect(emailNotificationsOf('', false)).toBe(false);
  });

  it('names each option and each landed save in words that exist, and differently', () => {
    const declared = hr.organization as Record<string, unknown>;
    for (const on of [true, false]) {
      expect(declared[emailNotificationsMessageKey(on).replace('organization.', '')]).toBeTruthy();
      expect(declared[emailNotificationsStatusMessageKey(on).replace('organization.', '')]).toBeTruthy();
    }
    expect(emailNotificationsMessageKey(true)).not.toBe(emailNotificationsMessageKey(false));
    expect(emailNotificationsStatusMessageKey(true)).not.toBe(emailNotificationsStatusMessageKey(false));
  });
});
