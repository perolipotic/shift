import type { Session } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import {
  EMAIL_OFF,
  EMAIL_ON,
  emailOf,
  emailStatusMessageKey,
  emailValue,
  ledeMessageKey,
  NOTIFICATION_SETTINGS_REFUSED,
  NOTIFICATION_SETTINGS_UNAVAILABLE,
  NOTIFICATIONS_CONTROL,
  NOTIFICATIONS_LOADING,
  NOTIFICATIONS_NO_ADDRESS,
  NOTIFICATIONS_ORGANIZATION_OFF,
  NOTIFICATIONS_UNAVAILABLE,
  notificationSettingsOf,
  notificationsViewOf,
  readNotificationSettings,
  writeEmailSetting,
  type NotificationSettings,
  type NotificationTables,
  type OneKeyTable,
  type SettingsTable,
} from '@/features/notifications/services/settings';
import hr from '@/lib/i18n/locales/hr.json';

const MEMBER = { id: 'member-1', organization_id: 'organization-1', email: 'ana@example.org', role: 'member_role' };
const SETTINGS: NotificationSettings = {
  memberId: 'member-1',
  organizationId: 'organization-1',
  address: 'ana@example.org',
  email: true,
  organizationEmail: true,
  admin: false,
};

interface Answer {
  data: unknown;
  error: { code?: string; message?: string } | null;
}

const rows = (...data: unknown[]): Answer => ({ data, error: null });
const failure = (code: string): Answer => ({ data: null, error: { code, message: code } });

/** A one-key table answering `answer`, recording the filters it was given. */
function oneKey(answer: Answer, filters: unknown[][] = []): OneKeyTable {
  return {
    select: () => ({
      eq: (column, value) => {
        filters.push([column, value]);
        return { limit: () => Promise.resolve(answer) };
      },
    }),
  };
}

/** A settings table: one answer for the read, a queue of answers for update and insert. */
function settingsTable(
  read: Answer,
  writes: { update?: Answer[]; insert?: Answer[] } = {},
  log: { updated: unknown[]; inserted: unknown[] } = { updated: [], inserted: [] },
): SettingsTable {
  const updates = [...(writes.update ?? [])];
  const inserts = [...(writes.insert ?? [])];
  return {
    select: () => ({ eq: () => ({ eq: () => ({ limit: () => Promise.resolve(read) }) }) }),
    update: (values) => {
      log.updated.push(values);
      return { eq: () => ({ eq: () => ({ select: () => Promise.resolve(updates.shift() ?? rows()) }) }) };
    },
    insert: (values) => {
      log.inserted.push(values);
      return { select: () => Promise.resolve(inserts.shift() ?? rows()) };
    },
  };
}

function tablesOf(member: Answer, setting: Answer, organization: Answer): NotificationTables {
  return {
    members: () => oneKey(member),
    settings: () => settingsTable(setting),
    organizations: () => oneKey(organization),
  };
}

const session = () => Promise.resolve({ user: { id: 'auth-1' } } as Session);

describe('the screen reads the member, their own setting and the organization switch', () => {
  it('reads no row as on', async () => {
    const outcome = await readNotificationSettings(
      tablesOf(rows(MEMBER), rows(), rows({ email_notifications: true })),
      session,
    );

    expect(outcome).toEqual({ ok: true, settings: SETTINGS });
  });

  it("reads the member's stored off and the organization's off", async () => {
    const outcome = await readNotificationSettings(
      tablesOf(rows(MEMBER), rows({ email: false }), rows({ email_notifications: false })),
      session,
    );

    expect(outcome).toEqual({ ok: true, settings: { ...SETTINGS, email: false, organizationEmail: false } });
  });

  it('finds the member by the session, never by anything else', async () => {
    const filters: unknown[][] = [];
    const tables: NotificationTables = {
      members: () => oneKey(rows(MEMBER), filters),
      settings: () => settingsTable(rows()),
      organizations: () => oneKey(rows({ email_notifications: true })),
    };

    await readNotificationSettings(tables, session);

    expect(filters).toEqual([['auth_user_id', 'auth-1']]);
  });

  it('is unavailable with no session, no member row, an error or a malformed row', async () => {
    const good = tablesOf(rows(MEMBER), rows(), rows({ email_notifications: true }));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    for (const [tables, reader] of [
      [good, () => Promise.resolve(null)],
      [good, () => Promise.reject(new Error('locked'))],
      [tablesOf(rows(), rows(), rows({ email_notifications: true })), session],
      [tablesOf(failure('PGRST000'), rows(), rows({ email_notifications: true })), session],
      [tablesOf(rows(MEMBER), failure('42501'), rows({ email_notifications: true })), session],
      [tablesOf(rows(MEMBER), rows({ email: 'yes' }), rows({ email_notifications: true })), session],
      [tablesOf(rows(MEMBER), rows(), rows()), session],
      [tablesOf(rows(MEMBER), rows(), rows({ email_notifications: null })), session],
      [tablesOf(rows({ ...MEMBER, role: 'owner' }), rows(), rows({ email_notifications: true })), session],
    ] as const) {
      expect(await readNotificationSettings(tables, reader)).toEqual({
        ok: false,
        code: NOTIFICATION_SETTINGS_UNAVAILABLE,
      });
    }
  });

  it('reads the viewer as an admin from their own row', () => {
    expect(notificationSettingsOf({ ...MEMBER, role: 'admin' }, null, { email_notifications: true })?.admin).toBe(true);
    expect(notificationSettingsOf(MEMBER, null, { email_notifications: true })?.admin).toBe(false);
  });

  it('reads a blank or missing address as none', () => {
    for (const email of [null, '', '   ', undefined, 42]) {
      expect(notificationSettingsOf({ ...MEMBER, email }, null, { email_notifications: true })?.address).toBeNull();
    }
    expect(notificationSettingsOf({ ...MEMBER, email: ' ana@example.org ' }, null, { email_notifications: true })?.address).toBe(
      'ana@example.org',
    );
  });
});

describe('the screen writes only its own email switch', () => {
  const own = { organizationId: 'organization-1', memberId: 'member-1' };

  it('updates the email column alone when a row exists', async () => {
    const log = { updated: [] as unknown[], inserted: [] as unknown[] };
    const tables = { ...tablesOf(rows(), rows(), rows()), settings: () => settingsTable(rows(), { update: [rows({ email: false })] }, log) };

    expect(await writeEmailSetting(tables, own, false)).toEqual({ ok: true, email: false });
    expect(log).toEqual({ updated: [{ email: false }], inserted: [] });
  });

  it('inserts its own row when the update matched none', async () => {
    const log = { updated: [] as unknown[], inserted: [] as unknown[] };
    const tables = {
      ...tablesOf(rows(), rows(), rows()),
      settings: () => settingsTable(rows(), { update: [rows()], insert: [rows({ email: false })] }, log),
    };

    expect(await writeEmailSetting(tables, own, false)).toEqual({ ok: true, email: false });
    expect(log.inserted).toEqual([{ organization_id: 'organization-1', member_id: 'member-1', email: false }]);
  });

  it('updates again when another tab inserted first', async () => {
    // ONE table across the calls, so its queued answers are consumed in order.
    const settings = settingsTable(rows(), { update: [rows(), rows({ email: true })], insert: [failure('23505')] });
    const tables = { ...tablesOf(rows(), rows(), rows()), settings: () => settings };

    expect(await writeEmailSetting(tables, own, true)).toEqual({ ok: true, email: true });
  });

  it('is REFUSED for a refusal on any path, and UNAVAILABLE for any other fault', async () => {
    const REFUSED = { ok: false, code: NOTIFICATION_SETTINGS_REFUSED };
    const UNAVAILABLE = { ok: false, code: NOTIFICATION_SETTINGS_UNAVAILABLE };
    const cases: [{ update?: Answer[]; insert?: Answer[] }, unknown][] = [
      // The update refused outright.
      [{ update: [failure('42501')] }, REFUSED],
      // No row, and the insert refused by the policy.
      [{ update: [rows()], insert: [failure('42501')] }, REFUSED],
      // A lost insert race whose retry matches no row: the policy's silent refusal.
      [{ update: [rows(), rows()], insert: [failure('23505')] }, REFUSED],
      // A lost insert race whose retry is refused outright.
      [{ update: [rows(), failure('42501')], insert: [failure('23505')] }, REFUSED],
      // Transport and malformed answers, on each path.
      [{ update: [failure('PGRST000')] }, UNAVAILABLE],
      [{ update: [rows({ email: 'yes' })] }, UNAVAILABLE],
      [{ update: [rows()], insert: [failure('PGRST000')] }, UNAVAILABLE],
      [{ update: [rows(), failure('PGRST000')], insert: [failure('23505')] }, UNAVAILABLE],
    ];

    for (const [writes, expected] of cases) {
      const settings = settingsTable(rows(), writes);
      const tables = { ...tablesOf(rows(), rows(), rows()), settings: () => settings };
      expect(await writeEmailSetting(tables, own, false), JSON.stringify(writes)).toEqual(expected);
    }
  });
});

describe("the screen's states", () => {
  it('is loading until the read answers, and unavailable when it failed', () => {
    expect(notificationsViewOf(undefined)).toEqual({ kind: NOTIFICATIONS_LOADING });
    expect(notificationsViewOf({ ok: false, code: NOTIFICATION_SETTINGS_UNAVAILABLE })).toEqual({
      kind: NOTIFICATIONS_UNAVAILABLE,
    });
  });

  it('shows no control with no address, and says the organization is off too when it is', () => {
    for (const organizationEmail of [true, false]) {
      for (const admin of [true, false]) {
        expect(notificationsViewOf({ ok: true, settings: { ...SETTINGS, address: null, organizationEmail, admin } })).toEqual({
          kind: NOTIFICATIONS_NO_ADDRESS,
          organizationOff: !organizationEmail,
          admin,
        });
      }
    }
  });

  it('shows the address and no control while the organization sends no email, and whether the viewer may turn it on', () => {
    for (const admin of [true, false]) {
      expect(notificationsViewOf({ ok: true, settings: { ...SETTINGS, organizationEmail: false, admin } })).toEqual({
        kind: NOTIFICATIONS_ORGANIZATION_OFF,
        address: 'ana@example.org',
        admin,
      });
    }
  });

  it("shows the address and the member's own on/off otherwise", () => {
    for (const email of [true, false]) {
      expect(notificationsViewOf({ ok: true, settings: { ...SETTINGS, email } })).toEqual({
        kind: NOTIFICATIONS_CONTROL,
        address: 'ana@example.org',
        email,
        admin: false,
      });
    }
  });

  it('states what each role is sent, an admin the new leave requests as well', () => {
    const declared = hr.postavkeObavijesti as Record<string, string>;
    const member = declared[ledeMessageKey(false).replace('postavkeObavijesti.', '')] ?? '';
    const admin = declared[ledeMessageKey(true).replace('postavkeObavijesti.', '')] ?? '';

    expect(member).toBeTruthy();
    expect(admin).toContain('novi zahtjev');
    expect(member).not.toContain('novi zahtjev');
  });

  it('round-trips the control value, and keeps the stored one for anything else', () => {
    for (const on of [true, false]) {
      expect(emailOf(emailValue(on), !on)).toBe(on);
    }
    expect(emailValue(true)).toBe(EMAIL_ON);
    expect(emailValue(false)).toBe(EMAIL_OFF);
    expect(emailOf('maybe', true)).toBe(true);
    expect(emailOf('', false)).toBe(false);
  });

  it('says a landed save in words that exist', () => {
    const declared = hr.postavkeObavijesti as Record<string, string>;
    for (const on of [true, false]) {
      expect(declared[emailStatusMessageKey(on).replace('postavkeObavijesti.', '')]).toBeTruthy();
    }
    expect(declared['noAddress']).toBe('Nemaš upisan e-mail');
  });
});
