import type { Session } from '@supabase/supabase-js';

/**
 * `/obavijesti` (story 10.3): the signed-in member's own notification
 * settings. One read answers the screen — the member's own row (its id, its
 * organization and its recorded `email`), their own `notification_settings`
 * row, and the organization's `email_notifications` switch — and one write
 * stores their own email on/off.
 *
 * NO ROW MEANS ON (`0044`). The member reads and writes only their own row:
 * an insert names `organization_id, member_id, email`, an update `email`
 * alone, which is why the write is an update first and an insert only when
 * no row was there, never a PostgREST upsert (an upsert's `do update` names
 * every column it sends, and update is granted on `email` only).
 *
 * The address is shown, never edited here (Ask First). Push is its own
 * section (story 10.4, `./push`).
 */

export const NOTIFICATION_SETTINGS_KEY = ['notification-settings'] as const;

export const MEMBERS_TABLE = 'members';
export const NOTIFICATION_SETTINGS_TABLE = 'notification_settings';
export const ORGANIZATIONS_TABLE = 'organizations';

export const OWN_MEMBER_COLUMNS = 'id,organization_id,email,role';
export const OWN_SETTING_COLUMNS = 'email';
export const ORGANIZATION_SWITCH_COLUMNS = 'email_notifications';

/** The read or the write could not be answered: transport, refusal or a malformed row. */
export const NOTIFICATION_SETTINGS_UNAVAILABLE = 'NOTIFICATION_SETTINGS_UNAVAILABLE';
/** The write matched no row and its insert was refused: RLS, or not this member's row. */
export const NOTIFICATION_SETTINGS_REFUSED = 'NOTIFICATION_SETTINGS_REFUSED';

export type NotificationSettingsFailure =
  | typeof NOTIFICATION_SETTINGS_UNAVAILABLE
  | typeof NOTIFICATION_SETTINGS_REFUSED;

/** What the screen draws from. */
export interface NotificationSettings {
  readonly memberId: string;
  readonly organizationId: string;
  /** The member's own recorded address, or `null` when none is (null or blank). */
  readonly address: string | null;
  /** The member's own email switch: `true` when no row is stored. */
  readonly email: boolean;
  /** The organization's switch: off, nothing is sent to anybody in it. */
  readonly organizationEmail: boolean;
  /** Whether the viewer is an admin: what they are told about, and who may turn the switch back on. */
  readonly admin: boolean;
}

export type NotificationSettingsOutcome =
  | { readonly ok: true; readonly settings: NotificationSettings }
  | { readonly ok: false; readonly code: NotificationSettingsFailure };

export type NotificationWriteOutcome =
  | { readonly ok: true; readonly email: boolean }
  | { readonly ok: false; readonly code: NotificationSettingsFailure };

/** The PostgREST answer this module reads: rows or an error. */
interface Answer {
  readonly data: unknown;
  // `| undefined` spelled out, as `PostgrestFailure` in the organization
  // snapshot does: `exactOptionalPropertyTypes` is on.
  readonly error: { readonly code?: string | undefined; readonly message?: string | undefined } | null;
}

interface Limited {
  limit(count: number): PromiseLike<Answer>;
}

/** `select(…).eq(…).limit(…)`: the member's own row, the organization's switch. */
export interface OneKeyTable {
  select(columns: string): { eq(column: string, value: string): Limited };
}

/** The settings row: read by its two keys, updated by them, inserted whole. */
export interface SettingsTable {
  select(columns: string): { eq(column: string, value: string): { eq(column: string, value: string): Limited } };
  update(values: Readonly<Record<string, unknown>>): {
    eq(column: string, value: string): {
      eq(column: string, value: string): { select(columns: string): PromiseLike<Answer> };
    };
  };
  insert(values: Readonly<Record<string, unknown>>): { select(columns: string): PromiseLike<Answer> };
}

/** The three tables, as `supabaseClient().from` gives them, named structurally so they can be stubbed. */
export interface NotificationTables {
  members(): OneKeyTable;
  settings(): SettingsTable;
  organizations(): OneKeyTable;
}

function firstRow(answer: Answer): Record<string, unknown> | null | undefined {
  if (answer.error !== null) return undefined;
  if (!Array.isArray(answer.data)) return undefined;
  const row: unknown = answer.data[0];
  if (row === undefined) return null;
  return typeof row === 'object' && row !== null ? (row as Record<string, unknown>) : undefined;
}

/** A recorded address worth showing: a non-blank string, trimmed. */
export function addressOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/**
 * The settings from the three rows, or `null` when any is malformed. No
 * settings row is on; a row's `email` must be a boolean.
 */
export function notificationSettingsOf(
  member: Record<string, unknown> | null,
  setting: Record<string, unknown> | null,
  organization: Record<string, unknown> | null,
): NotificationSettings | null {
  if (member === null || organization === null) return null;

  const memberId = member['id'];
  const organizationId = member['organization_id'];
  const organizationEmail = organization['email_notifications'];
  const stored = setting === null ? true : setting['email'];
  const role = member['role'];

  if (
    (role !== 'admin' && role !== 'member_role') ||
    typeof memberId !== 'string' ||
    typeof organizationId !== 'string' ||
    typeof organizationEmail !== 'boolean' ||
    typeof stored !== 'boolean'
  ) {
    return null;
  }

  return {
    memberId,
    organizationId,
    address: addressOf(member['email']),
    email: stored,
    organizationEmail,
    admin: role === 'admin',
  };
}

const UNAVAILABLE = { ok: false, code: NOTIFICATION_SETTINGS_UNAVAILABLE } as const;

/** The screen's one read. Never throws: every failure is the unavailable outcome. */
export async function readNotificationSettings(
  tables: NotificationTables,
  session: () => Promise<Session | null>,
): Promise<NotificationSettingsOutcome> {
  try {
    const current = await session();
    if (current === null) return UNAVAILABLE;

    const member = firstRow(
      await tables.members().select(OWN_MEMBER_COLUMNS).eq('auth_user_id', current.user.id).limit(1),
    );
    if (member === undefined || member === null) return UNAVAILABLE;

    const memberId = member['id'];
    const organizationId = member['organization_id'];
    if (typeof memberId !== 'string' || typeof organizationId !== 'string') return UNAVAILABLE;

    const [setting, organization] = await Promise.all([
      tables
        .settings()
        .select(OWN_SETTING_COLUMNS)
        .eq('organization_id', organizationId)
        .eq('member_id', memberId)
        .limit(1),
      tables.organizations().select(ORGANIZATION_SWITCH_COLUMNS).eq('id', organizationId).limit(1),
    ]);
    const settingRow = firstRow(setting);
    const organizationRow = firstRow(organization);
    if (settingRow === undefined || organizationRow === undefined) return UNAVAILABLE;

    const settings = notificationSettingsOf(member, settingRow, organizationRow);

    return settings === null ? UNAVAILABLE : { ok: true, settings };
  } catch (cause) {
    console.error(NOTIFICATION_SETTINGS_UNAVAILABLE, cause);
    return UNAVAILABLE;
  }
}

const UNIQUE_VIOLATION = '23505';
const INSUFFICIENT_PRIVILEGE = '42501';

const REFUSED = { ok: false, code: NOTIFICATION_SETTINGS_REFUSED } as const;

/**
 * A write's answer: the switch its row now holds, `null` when it matched no
 * row, or the failure. A refusal (42501, on any path) is REFUSED; any other
 * error or a malformed row is UNAVAILABLE.
 */
function storedEmail(answer: Answer): boolean | null | NotificationWriteOutcome {
  if (answer.error?.code === INSUFFICIENT_PRIVILEGE) return REFUSED;
  const row = firstRow(answer);
  if (row === undefined) return UNAVAILABLE;
  if (row === null) return null;
  return typeof row['email'] === 'boolean' ? row['email'] : UNAVAILABLE;
}

/**
 * Stores the member's own email switch: an update of `email` on their own
 * row, or, when no row exists, an insert of it. An insert that loses a race
 * to another tab's (23505) updates instead. Never throws.
 */
export async function writeEmailSetting(
  tables: NotificationTables,
  own: { readonly organizationId: string; readonly memberId: string },
  email: boolean,
): Promise<NotificationWriteOutcome> {
  const update = () =>
    tables
      .settings()
      .update({ email })
      .eq('organization_id', own.organizationId)
      .eq('member_id', own.memberId)
      .select(OWN_SETTING_COLUMNS);

  // A row matched by neither the update nor the retry after a lost insert
  // race is a row this session may not reach: the policy's silent refusal.
  const outcomeOf = (stored: boolean | null | NotificationWriteOutcome): NotificationWriteOutcome => {
    if (stored === null) return REFUSED;
    return typeof stored === 'boolean' ? { ok: true, email: stored } : stored;
  };

  try {
    const updated = storedEmail(await update());
    if (updated !== null) return outcomeOf(updated);

    const insertAnswer = await tables
      .settings()
      .insert({ organization_id: own.organizationId, member_id: own.memberId, email })
      .select(OWN_SETTING_COLUMNS);

    // Another tab inserted first: the row is there now, so update it.
    if (insertAnswer.error?.code === UNIQUE_VIOLATION) return outcomeOf(storedEmail(await update()));

    return outcomeOf(storedEmail(insertAnswer));
  } catch (cause) {
    console.error(NOTIFICATION_SETTINGS_UNAVAILABLE, cause);
    return UNAVAILABLE;
  }
}

// ------------------------------------------------------------------ the view

export const NOTIFICATIONS_LOADING = 'loading';
export const NOTIFICATIONS_UNAVAILABLE = 'unavailable';
export const NOTIFICATIONS_NO_ADDRESS = 'noAddress';
export const NOTIFICATIONS_ORGANIZATION_OFF = 'organizationOff';
export const NOTIFICATIONS_CONTROL = 'control';

/** What the screen draws, decided from the read's answer alone. */
export type NotificationsView =
  | { readonly kind: typeof NOTIFICATIONS_LOADING }
  | { readonly kind: typeof NOTIFICATIONS_UNAVAILABLE }
  | { readonly kind: typeof NOTIFICATIONS_NO_ADDRESS; readonly organizationOff: boolean; readonly admin: boolean }
  | { readonly kind: typeof NOTIFICATIONS_ORGANIZATION_OFF; readonly address: string; readonly admin: boolean }
  | {
      readonly kind: typeof NOTIFICATIONS_CONTROL;
      readonly address: string;
      readonly email: boolean;
      readonly admin: boolean;
    };

/**
 * The screen's state. No address: `Nemaš upisan e-mail`, no control, and,
 * when the organization's switch is off too, that it sends no email. The
 * switch off: the address, and that the organization sends no email, no
 * control. Otherwise the address and the member's on/off. `admin` says
 * whether the viewer can turn the switch back on (a way to *Organizacija*)
 * and which lede states what they are sent.
 */
export function notificationsViewOf(outcome: NotificationSettingsOutcome | undefined): NotificationsView {
  if (outcome === undefined) return { kind: NOTIFICATIONS_LOADING };
  if (!outcome.ok) return { kind: NOTIFICATIONS_UNAVAILABLE };

  const { address, email, organizationEmail, admin } = outcome.settings;

  if (address === null) return { kind: NOTIFICATIONS_NO_ADDRESS, organizationOff: !organizationEmail, admin };
  if (!organizationEmail) return { kind: NOTIFICATIONS_ORGANIZATION_OFF, address, admin };

  return { kind: NOTIFICATIONS_CONTROL, address, email, admin };
}

/**
 * What the control state says the person is sent (UX-DR34: the fact). A
 * member hears of their leave and their schedule; an admin of those and of
 * every new leave request that waits for a decision.
 */
export function ledeMessageKey(admin: boolean): 'postavkeObavijesti.ledeAdmin' | 'postavkeObavijesti.ledeMember' {
  return admin ? 'postavkeObavijesti.ledeAdmin' : 'postavkeObavijesti.ledeMember';
}

/** The control's two radio values. Strings because a radio group speaks them. */
export const EMAIL_ON = 'on';
export const EMAIL_OFF = 'off';

export function emailValue(on: boolean): string {
  return on ? EMAIL_ON : EMAIL_OFF;
}

/** What the radio group hands back; anything else keeps the stored value. */
export function emailOf(value: string, stored: boolean): boolean {
  if (value === EMAIL_ON) return true;
  if (value === EMAIL_OFF) return false;
  return stored;
}

/** A landed save's status line. */
export function emailStatusMessageKey(on: boolean): 'postavkeObavijesti.statusOn' | 'postavkeObavijesti.statusOff' {
  return on ? 'postavkeObavijesti.statusOn' : 'postavkeObavijesti.statusOff';
}
