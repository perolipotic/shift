/**
 * The change history's meaning (CAP-24; AD-11 "Reading it (14.2)"; AD-7,
 * AD-8): what one `audit_events` row says — its kind, its author, the ids it
 * names and its field-level *bilo → sada* — as codes and operands, never
 * prose, and the period, the filter and where history begins.
 *
 * NO I/O AND NO TIME ZONE. An event arrives with its `day`, the organization's
 * date of its `occurred_at`, worked out by the caller; this module only
 * compares civil dates (`calendar.ts`).
 *
 * WHOLE ROWS IN, DIFF OUT. `audit_events` stores whole `to_jsonb` rows; the
 * diff, the kind and the subject are derived here. A column this module does
 * not know becomes a `raw` operand, so every key shape a migration ever wrote
 * stays readable (AD-11 Deletes).
 */

import { checkDate, civilDayNumber, dateOfCivilDay } from './calendar.js';

// ---------------------------------------------------------------- the input

/** The four operations `audit_events_operation_known` admits. */
export type AuditOperation = 'INSERT' | 'UPDATE' | 'DELETE' | 'HISTORY_BEGINS';

/** `trigger` (live) or `backfill` (reconstructed by 0061). */
export type AuditOrigin = 'trigger' | 'backfill';

/** A whole row as `to_jsonb` wrote it. */
export type AuditRow = Readonly<Record<string, unknown>>;

/** One `audit_events` row, as read, with the organization's date of its instant. */
export interface AuditEvent {
  /** The identity column: write order. */
  readonly id: number;
  readonly tableName: string;
  readonly operation: AuditOperation;
  readonly rowId: string;
  readonly oldRow: AuditRow | null;
  readonly newRow: AuditRow | null;
  /** `auth.uid()` of the writing request, or `null` for a write with no JWT user. */
  readonly actor: string | null;
  /** The raw `current_setting('role')`. */
  readonly sessionRole: string;
  readonly origin: AuditOrigin;
  /** `pg_current_xact_id()` as text; `null` on a backfilled event. */
  readonly transactionId: string | null;
  /** The raw `occurred_at` string, as PostgREST sent it. */
  readonly occurredAt: string;
  /** The organization's civil date of `occurredAt`, `YYYY-MM-DD`. */
  readonly day: string;
}

// ---------------------------------------------------------------- the codes

/** What kind of record an event is about, one per audited table. */
export const HISTORY_RECORDS = [
  'organization',
  'member',
  'member-status',
  'team-membership',
  'team',
  'hour-band',
  'shift-type',
  'shift-type-version',
  'rotation-pattern',
  'rotation-step',
  'rotation-assignment',
  'shift-type-override',
  'roster-override',
  'leave-record',
  'conflict-resolution',
  'leave-request',
  'leave-request-decision',
  'swap-request',
  'swap-request-decision',
  'absence-type',
  'leave-allowance',
  // Story 18.5: a Loan (`team_loans`, 0062).
  'loan',
  // A table this build does not know yet (an audited table added after it):
  // drawn as a generic record, its fields as raw operands, never a failed read.
  'other',
] as const;

export type HistoryRecord = (typeof HISTORY_RECORDS)[number];

/** What happened to it. */
export const HISTORY_ACTIONS = [
  'added',
  'changed',
  'deleted',
  'removed',
  'confirmed',
  'answered',
  'closed',
  'archived',
  'restored',
  'amended',
  'decided',
  'history-begins',
] as const;

export type HistoryAction = (typeof HISTORY_ACTIONS)[number];

/** An entry's kind; its filter code is {@link historyKindCodeOf}. */
export interface HistoryKind {
  readonly record: HistoryRecord;
  readonly action: HistoryAction;
}

/** Who made the change, as a code: a member, a departed one, the service, or the system. */
export type HistoryAuthor =
  | { readonly kind: 'member'; readonly memberId: string }
  | { readonly kind: 'departed' }
  | { readonly kind: 'service' }
  | { readonly kind: 'system' };

/** One value of a field, before or after. */
export type HistoryOperand =
  | { readonly type: 'none' }
  | { readonly type: 'text'; readonly value: string }
  | { readonly type: 'number'; readonly value: number }
  | { readonly type: 'boolean'; readonly value: boolean }
  | { readonly type: 'date'; readonly value: string }
  /** A date range, `to` its inclusive last day. */
  | { readonly type: 'range'; readonly from: string; readonly to: string }
  | { readonly type: 'time'; readonly minute: number }
  | {
      readonly type:
        | 'member'
        | 'team'
        | 'shift-type'
        | 'absence-type'
        | 'rotation-pattern'
        | 'rotation-step'
        | 'roster-override';
      readonly id: string;
    }
  | { readonly type: 'enum'; readonly field: HistoryEnumField; readonly value: string }
  | { readonly type: 'raw'; readonly json: string };

/** The fields whose values are drawn from a fixed vocabulary. */
export type HistoryEnumField = 'role' | 'outcome' | 'answer' | 'kind' | 'half' | 'status';

/**
 * A row's lifecycle state, read from its lifecycle columns (epic 14 retro A4):
 * the first of `removed_at`, `closed_at`, `answered_at`, `confirmed_at` set;
 * else `open` for a request (its row holds `closed_at`), `current` otherwise.
 */
export const HISTORY_STATUSES = ['current', 'open', 'confirmed', 'answered', 'closed', 'removed'] as const;

export type HistoryStatus = (typeof HISTORY_STATUSES)[number];

/** Every field the history names, in the order an entry lists them. */
export const HISTORY_FIELDS = [
  // Derived from the lifecycle columns on an UPDATE, always first (retro A4).
  'status',
  'name',
  'shortName',
  'slug',
  'description',
  'address',
  'contactEmail',
  'organizationType',
  'timezone',
  'locale',
  'leaveYearStartMonth',
  'leaveYearStartDay',
  'brandAccent',
  'logoPath',
  'usesFireRanks',
  'emailNotifications',
  'minimumMembers',
  'carryOverMaxDays',
  'carryOverExpiryMonth',
  'carryOverExpiryDay',
  'carryOverFirstLeaveYear',
  'username',
  'email',
  'role',
  'fireRank',
  'leaveAllowanceDays',
  'member',
  'memberOut',
  'memberIn',
  'proposer',
  'addressee',
  'team',
  'returnTeam',
  'active',
  'position',
  'archived',
  'isWorking',
  'shiftType',
  'rotationPattern',
  'offsetStep',
  'startTime',
  'endTime',
  'effectiveFrom',
  'anchorDate',
  'date',
  'returnDate',
  'during',
  'half',
  'absenceType',
  'drawsAllowance',
  'kind',
  'rosterOverride',
  'returnRosterOverride',
  'reason',
  'answer',
  'outcome',
  'leaveYear',
  'days',
] as const;

export type HistoryField = (typeof HISTORY_FIELDS)[number];

/** One field's *bilo → sada*. `field` is `null` for a column this module does not know; `column` names it. */
export interface HistoryChange {
  readonly field: HistoryField | null;
  readonly column: string;
  readonly before: HistoryOperand;
  readonly after: HistoryOperand;
}

/** What an entry is about: the ids it names, and its own name or type where it has one. */
export interface HistorySubjects {
  readonly members: readonly string[];
  readonly teams: readonly string[];
  /** The record's own `name`, else the shift type it is a part of, else `null`. */
  readonly label: HistoryOperand | null;
}

/** One line of the history. */
export interface HistoryEntry {
  /** The (newest) event's id, as text: unique within a read. */
  readonly id: string;
  /** Every event the entry stands for: one, or an amended pair. */
  readonly eventIds: readonly number[];
  readonly occurredAt: string;
  readonly day: string;
  readonly kind: HistoryKind;
  readonly author: HistoryAuthor;
  readonly subjects: HistorySubjects;
  readonly changes: readonly HistoryChange[];
  /** Backfilled by 0061 from attribution columns, not recorded live. */
  readonly reconstructed: boolean;
}

// ---------------------------------------------------------------- tables

const RECORD_OF_TABLE: Readonly<Record<string, HistoryRecord>> = {
  organizations: 'organization',
  members: 'member',
  member_status_versions: 'member-status',
  team_membership_versions: 'team-membership',
  teams: 'team',
  hour_bands: 'hour-band',
  shift_types: 'shift-type',
  shift_type_versions: 'shift-type-version',
  rotation_patterns: 'rotation-pattern',
  rotation_steps: 'rotation-step',
  rotation_assignments: 'rotation-assignment',
  shift_type_overrides: 'shift-type-override',
  roster_overrides: 'roster-override',
  leave_records: 'leave-record',
  conflict_resolutions: 'conflict-resolution',
  leave_requests: 'leave-request',
  leave_request_decisions: 'leave-request-decision',
  swap_requests: 'swap-request',
  swap_request_decisions: 'swap-request-decision',
  absence_types: 'absence-type',
  leave_allowances: 'leave-allowance',
  team_loans: 'loan',
};

/** The record an audited table holds, or `null` for a table this build does not know. */
export function historyRecordOf(tableName: string): HistoryRecord | null {
  return Object.hasOwn(RECORD_OF_TABLE, tableName) ? (RECORD_OF_TABLE[tableName] ?? null) : null;
}

/** A request table: the table a decision's `row_id` (`request_id`) points into. */
export type HistoryRequestTableName = 'leave_requests' | 'swap_requests';

/** A decision table and the request table its `row_id` (`request_id`) points into. */
const REQUEST_TABLE_OF_DECISION: Readonly<Record<string, HistoryRequestTableName>> = {
  leave_request_decisions: 'leave_requests',
  swap_request_decisions: 'swap_requests',
};

/** The request table a decision table points into, or `null` for any other table (own keys only). */
function requestTableOf(tableName: string): HistoryRequestTableName | null {
  return Object.hasOwn(REQUEST_TABLE_OF_DECISION, tableName) ? (REQUEST_TABLE_OF_DECISION[tableName] ?? null) : null;
}

/**
 * The tables an amend writes as a removal and an insert in one transaction,
 * and the columns a pair shares (answers deferred-work 504/655).
 */
const AMEND_KEYS: Readonly<Record<string, readonly string[]>> = {
  leave_records: ['member_id'],
  roster_overrides: ['team_id', 'date'],
  shift_type_overrides: ['team_id', 'date'],
  // Story 18.4 (0064's `amend_team_loan`): the replacement keeps the member;
  // its team and dates may change. Story 18.5 names the record `loan`.
  team_loans: ['member_id'],
};

// ---------------------------------------------------------------- fields

/**
 * Columns no entry shows: keys, attribution, the lifecycle pairs (their state
 * is the derived `status` line) and links the subject or the kind already
 * names. Everything else an audited table holds is a field (epic 14 retro A4).
 */
export const HISTORY_HIDDEN_COLUMNS: ReadonlySet<string> = new Set([
  'organization_id',
  'id',
  'created_by',
  'created_at',
  'decided_by',
  'decided_at',
  'removed_by',
  'removed_at',
  'confirmed_by',
  'confirmed_at',
  'closed_by',
  'closed_at',
  'answered_by',
  'answered_at',
  'request_id',
  'auth_user_id',
  'leave_record_id',
]);

type FieldType =
  | 'text'
  | 'number'
  | 'boolean'
  | 'date'
  | 'range'
  | 'time'
  | 'member'
  | 'team'
  | 'shift-type'
  | 'absence-type'
  | 'rotation-pattern'
  | 'rotation-step'
  | 'roster-override'
  | 'enum'
  | 'auto';

const FIELD_OF_COLUMN: Readonly<Record<string, readonly [HistoryField, FieldType]>> = {
  name: ['name', 'text'],
  short_name: ['shortName', 'text'],
  slug: ['slug', 'text'],
  description: ['description', 'text'],
  address: ['address', 'text'],
  contact_email: ['contactEmail', 'text'],
  organization_type: ['organizationType', 'text'],
  timezone: ['timezone', 'text'],
  locale: ['locale', 'text'],
  leave_year_start_month: ['leaveYearStartMonth', 'number'],
  leave_year_start_day: ['leaveYearStartDay', 'number'],
  brand_accent: ['brandAccent', 'text'],
  logo_path: ['logoPath', 'text'],
  uses_fire_ranks: ['usesFireRanks', 'boolean'],
  email_notifications: ['emailNotifications', 'boolean'],
  minimum_members: ['minimumMembers', 'number'],
  carry_over_max_days: ['carryOverMaxDays', 'number'],
  carry_over_expiry_month: ['carryOverExpiryMonth', 'number'],
  carry_over_expiry_day: ['carryOverExpiryDay', 'number'],
  carry_over_first_leave_year: ['carryOverFirstLeaveYear', 'number'],
  username: ['username', 'text'],
  email: ['email', 'text'],
  role: ['role', 'enum'],
  fire_rank: ['fireRank', 'text'],
  leave_allowance_days: ['leaveAllowanceDays', 'number'],
  member_id: ['member', 'member'],
  member_out_id: ['memberOut', 'member'],
  member_in_id: ['memberIn', 'member'],
  proposer_id: ['proposer', 'member'],
  addressee_id: ['addressee', 'member'],
  team_id: ['team', 'team'],
  return_team_id: ['returnTeam', 'team'],
  active: ['active', 'boolean'],
  // Text on a team membership (0015), a number on a rotation step (0016).
  position: ['position', 'auto'],
  archived: ['archived', 'boolean'],
  is_working: ['isWorking', 'boolean'],
  shift_type_id: ['shiftType', 'shift-type'],
  pattern_id: ['rotationPattern', 'rotation-pattern'],
  offset_step_id: ['offsetStep', 'rotation-step'],
  roster_override_id: ['rosterOverride', 'roster-override'],
  return_roster_override_id: ['returnRosterOverride', 'roster-override'],
  start_time: ['startTime', 'time'],
  end_time: ['endTime', 'time'],
  effective_from: ['effectiveFrom', 'date'],
  anchor_date: ['anchorDate', 'date'],
  date: ['date', 'date'],
  return_date: ['returnDate', 'date'],
  during: ['during', 'range'],
  half: ['half', 'enum'],
  absence_type_id: ['absenceType', 'absence-type'],
  draws_allowance: ['drawsAllowance', 'boolean'],
  kind: ['kind', 'enum'],
  reason: ['reason', 'text'],
  answer: ['answer', 'enum'],
  outcome: ['outcome', 'enum'],
  leave_year: ['leaveYear', 'number'],
  days: ['days', 'number'],
};

const FIELD_ORDER: ReadonlyMap<string, number> = new Map(HISTORY_FIELDS.map((field, index) => [field, index]));

function fieldOf(column: string): readonly [HistoryField, FieldType] | null {
  return Object.hasOwn(FIELD_OF_COLUMN, column) ? (FIELD_OF_COLUMN[column] ?? null) : null;
}

/**
 * The named field a stored column is drawn as, or `null` for a column this
 * module does not know (drawn raw) — every column of an audited table is
 * either this or one of {@link HISTORY_HIDDEN_COLUMNS} (retro A4; a
 * migration-parsing test holds it).
 */
export function historyFieldOfColumn(column: string): HistoryField | null {
  return fieldOf(column)?.[0] ?? null;
}

const NONE: HistoryOperand = { type: 'none' };

function rawOf(value: unknown): HistoryOperand {
  return { type: 'raw', json: JSON.stringify(value) ?? 'null' };
}

const TIME_SHAPE = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;
const RANGE_SHAPE = /^([[(])(\d{4}-\d{2}-\d{2}),(\d{4}-\d{2}-\d{2})([\])])$/;

function isDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;

  try {
    checkDate('a history date', value);
    return true;
  } catch {
    return false;
  }
}

function shiftedDate(date: string, days: number): string | null {
  return dateOfCivilDay(civilDayNumber(date) + days);
}

function rangeOf(value: unknown): HistoryOperand {
  const match = typeof value === 'string' ? RANGE_SHAPE.exec(value) : null;
  const [, open, lower, upper, close] = match ?? [];

  if (!isDate(lower) || !isDate(upper)) return rawOf(value);

  const from = open === '(' ? shiftedDate(lower, 1) : lower;
  const to = close === ')' ? shiftedDate(upper, -1) : upper;

  if (from === null || to === null || from > to) return rawOf(value);

  return { type: 'range', from, to };
}

function timeOf(value: unknown): HistoryOperand {
  const match = typeof value === 'string' ? TIME_SHAPE.exec(value) : null;

  if (match === null) return rawOf(value);

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = match[3] === undefined ? 0 : Number(match[3]);
  // PostgreSQL's `time` admits 00:00:00–23:59:59, and 24:00:00 exactly.
  const endOfDay = hours === 24 && minutes === 0 && seconds === 0 && !/\.\d*[1-9]/.test(String(value));

  if ((hours > 23 && !endOfDay) || minutes > 59 || seconds > 59) return rawOf(value);

  return { type: 'time', minute: hours * 60 + minutes };
}

/** A column's value as an operand: `none` for null, `raw` for a shape its field does not hold. */
export function historyOperandOf(column: string, value: unknown): HistoryOperand {
  if (value === null || value === undefined) return NONE;

  const field = fieldOf(column);

  if (field === null) return rawOf(value);

  const [name, type] = field;

  switch (type) {
    case 'text':
      return typeof value === 'string' ? { type: 'text', value } : rawOf(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? { type: 'number', value } : rawOf(value);
    case 'boolean':
      return typeof value === 'boolean' ? { type: 'boolean', value } : rawOf(value);
    case 'date':
      return isDate(value) ? { type: 'date', value } : rawOf(value);
    case 'range':
      return rangeOf(value);
    case 'time':
      return timeOf(value);
    case 'member':
    case 'team':
    case 'shift-type':
    case 'absence-type':
    case 'rotation-pattern':
    case 'rotation-step':
    case 'roster-override':
      return typeof value === 'string' && value !== '' ? { type, id: value } : rawOf(value);
    case 'enum':
      return typeof value === 'string'
        ? { type: 'enum', field: name as HistoryEnumField, value }
        : rawOf(value);
    case 'auto':
      if (typeof value === 'string') return { type: 'text', value };
      if (typeof value === 'number' && Number.isFinite(value)) return { type: 'number', value };
      if (typeof value === 'boolean') return { type: 'boolean', value };
      return rawOf(value);
  }
}

function sameValue(first: unknown, second: unknown): boolean {
  return JSON.stringify(first ?? null) === JSON.stringify(second ?? null);
}

function compareColumns(first: string, second: string): number {
  const firstField = fieldOf(first);
  const secondField = fieldOf(second);
  const firstOrder = firstField === null ? HISTORY_FIELDS.length : (FIELD_ORDER.get(firstField[0]) ?? 0);
  const secondOrder = secondField === null ? HISTORY_FIELDS.length : (FIELD_ORDER.get(secondField[0]) ?? 0);

  if (firstOrder !== secondOrder) return firstOrder - secondOrder;

  return first < second ? -1 : first > second ? 1 : 0;
}

/**
 * The derived status line's column key: no SQL identifier starts with `$`
 * unquoted, and none of the audited tables does, so it never collides with a
 * real column (a later table's `status` included).
 */
export const HISTORY_STATUS_COLUMN = '$status';

const LIFECYCLE_COLUMNS = ['removed_at', 'closed_at', 'answered_at', 'confirmed_at'] as const;

function isSet(row: AuditRow, column: string): boolean {
  const value = row[column];

  return value !== null && value !== undefined;
}

/**
 * A row's lifecycle state: the first of `removed_at`, `closed_at`,
 * `answered_at`, `confirmed_at` set; else `open` for a row that can close (a
 * request) and `current` for any other.
 */
export function historyStatusOf(row: AuditRow): HistoryStatus {
  if (isSet(row, 'removed_at')) return 'removed';
  if (isSet(row, 'closed_at')) return 'closed';
  if (isSet(row, 'answered_at')) return 'answered';
  if (isSet(row, 'confirmed_at')) return 'confirmed';

  return Object.hasOwn(row, 'closed_at') ? 'open' : 'current';
}

/**
 * The `status` line of an UPDATE whose lifecycle state differs, or `null`:
 * only when both rows exist and one of them holds a lifecycle column, so an
 * insert, a delete and an amend pair (both sides live) add none.
 */
function statusChangeOf(before: AuditRow | null, after: AuditRow | null): HistoryChange | null {
  if (before === null || after === null) return null;
  if (!LIFECYCLE_COLUMNS.some((column) => Object.hasOwn(before, column) || Object.hasOwn(after, column))) return null;

  const old = historyStatusOf(before);
  const now = historyStatusOf(after);

  if (old === now) return null;

  return {
    field: 'status',
    column: HISTORY_STATUS_COLUMN,
    before: { type: 'enum', field: 'status', value: old },
    after: { type: 'enum', field: 'status', value: now },
  };
}

/** A `rotation_patterns` row holds nothing but its id: the id is the pattern (retro A4). */
const PATTERN_TABLE = 'rotation_patterns';

/**
 * The visible fields that differ between `before` and `after` (either may be
 * `null`, an insert or a delete), in {@link HISTORY_FIELDS} order with unknown
 * columns last, a derived `status` line first. A field null on both sides is
 * no change. `tableName` reads a `rotation_patterns` row's `id` as its pattern.
 */
export function historyChangesOf(
  before: AuditRow | null,
  after: AuditRow | null,
  tableName?: string,
): readonly HistoryChange[] {
  const columns = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const status = statusChangeOf(before, after);
  const changes: HistoryChange[] = status === null ? [] : [status];

  for (const column of [...columns].sort(compareColumns)) {
    const old = before === null ? null : before[column];
    const now = after === null ? null : after[column];

    if (tableName === PATTERN_TABLE && column === 'id') {
      if (!sameValue(old, now)) {
        changes.push({
          field: 'rotationPattern',
          column,
          before: historyOperandOf('pattern_id', old),
          after: historyOperandOf('pattern_id', now),
        });
      }
      continue;
    }

    if (HISTORY_HIDDEN_COLUMNS.has(column)) continue;
    if (sameValue(old, now)) continue;

    changes.push({
      field: fieldOf(column)?.[0] ?? null,
      column,
      before: historyOperandOf(column, old),
      after: historyOperandOf(column, now),
    });
  }

  return changes;
}

// ---------------------------------------------------------------- kind

function setNow(event: AuditEvent, column: string): boolean {
  const before = event.oldRow?.[column];
  const after = event.newRow?.[column];

  return (before === null || before === undefined) && after !== null && after !== undefined;
}

function actionOf(event: AuditEvent): HistoryAction {
  switch (event.operation) {
    case 'HISTORY_BEGINS':
      return 'history-begins';
    case 'INSERT':
      return Object.hasOwn(REQUEST_TABLE_OF_DECISION, event.tableName) ? 'decided' : 'added';
    case 'DELETE':
      return 'deleted';
    case 'UPDATE':
      if (setNow(event, 'removed_at')) return 'removed';
      if (setNow(event, 'confirmed_at')) return 'confirmed';
      // A decline closes in the same write: the answer names it.
      if (setNow(event, 'answered_at')) return 'answered';
      if (setNow(event, 'closed_at')) return 'closed';
      if (event.oldRow?.['archived'] === false && event.newRow?.['archived'] === true) return 'archived';
      if (event.oldRow?.['archived'] === true && event.newRow?.['archived'] === false) return 'restored';
      return 'changed';
  }
}

/**
 * An event's kind: its table's record (`other` for a table this build does
 * not know), and the action its operation and changed columns say.
 */
export function historyKindOf(event: AuditEvent): HistoryKind {
  const record = historyRecordOf(event.tableName) ?? 'other';

  return { record, action: event.operation === 'HISTORY_BEGINS' ? 'history-begins' : actionOf(event) };
}

/** A kind's filter code, `record:action`. */
export function historyKindCodeOf(kind: HistoryKind): string {
  return `${kind.record}:${kind.action}`;
}

/** The kind a filter code names, or `null` for none. */
export function historyKindOfCode(code: string): HistoryKind | null {
  const separator = code.lastIndexOf(':');
  const record = HISTORY_RECORDS.find((candidate) => candidate === code.slice(0, separator));
  const action = HISTORY_ACTIONS.find((candidate) => candidate === code.slice(separator + 1));

  return separator < 0 || record === undefined || action === undefined ? null : { record, action };
}

// ---------------------------------------------------------------- author

/** A member the caller knows: who an auth user is. */
export interface HistoryMemberIdentity {
  readonly id: string;
  readonly authUserId: string;
}

function authorOf(event: AuditEvent, members: ReadonlyMap<string, string>): HistoryAuthor {
  if (event.actor === null) return event.sessionRole === 'service_role' ? { kind: 'service' } : { kind: 'system' };

  const memberId = members.get(event.actor);

  return memberId === undefined ? { kind: 'departed' } : { kind: 'member', memberId };
}

/** A `members` event's rows, as far as naming reads them. */
export type HistoryMemberEvent = Pick<AuditEvent, 'tableName' | 'oldRow' | 'newRow'>;

/**
 * Auth user → member: the current members, then every `members` row the
 * events hold, then — below both — the departed members' DELETE rows read for
 * the actors and member ids the events could not name (epic 14 retro A9).
 */
function memberIdentitiesOf(
  events: readonly HistoryMemberEvent[],
  current: readonly HistoryMemberIdentity[],
  departed: readonly HistoryMemberEvent[],
): ReadonlyMap<string, string> {
  const byAuthUser = new Map<string, string>();

  // The departed rows first, oldest to newest, so the newest DELETE of an auth user wins among them;
  // then the read's own rows, which win over a departed row; the current list wins over all.
  for (const event of [...departed, ...events]) {
    if (event.tableName !== 'members') continue;

    for (const row of [event.oldRow, event.newRow]) {
      const authUserId = row?.['auth_user_id'];
      const id = row?.['id'];

      if (typeof authUserId === 'string' && typeof id === 'string') byAuthUser.set(authUserId, id);
    }
  }

  // The current list wins: it is the member as they stand.
  for (const member of current) byAuthUser.set(member.authUserId, member.id);

  return byAuthUser;
}

// ---------------------------------------------------------------- subjects

const MEMBER_COLUMNS = ['member_id', 'member_out_id', 'member_in_id', 'proposer_id', 'addressee_id'] as const;
const TEAM_COLUMNS = ['team_id', 'return_team_id'] as const;

function pushText(into: string[], value: unknown): void {
  if (typeof value === 'string' && value !== '' && !into.includes(value)) into.push(value);
}

function subjectsOfRows(tableName: string, rows: readonly (AuditRow | null)[]): HistorySubjects {
  const members: string[] = [];
  const teams: string[] = [];
  let label: HistoryOperand | null = null;

  for (const row of rows) {
    if (row === null) continue;
    if (tableName === 'members') pushText(members, row['id']);
    if (tableName === 'teams') pushText(teams, row['id']);
    for (const column of MEMBER_COLUMNS) pushText(members, row[column]);
    for (const column of TEAM_COLUMNS) pushText(teams, row[column]);

    if (label === null && typeof row['name'] === 'string' && row['name'] !== '') {
      label = { type: 'text', value: row['name'] };
    }
  }

  if (label === null) {
    for (const row of rows) {
      const shiftType = row?.['shift_type_id'];

      if (typeof shiftType === 'string' && shiftType !== '') {
        label = { type: 'shift-type', id: shiftType };
        break;
      }
    }
  }

  return { members, teams, label };
}

function mergedSubjects(first: HistorySubjects, second: HistorySubjects): HistorySubjects {
  return {
    members: [...new Set([...first.members, ...second.members])],
    teams: [...new Set([...first.teams, ...second.teams])],
    label: first.label ?? second.label,
  };
}

/**
 * The request event a decision names its subject through: the request's
 * event in the same transaction (live), else (backfill) a request event read
 * with that `row_id`, one at the same instant first.
 */
function requestEventOf(decision: AuditEvent, requests: RequestIndex): AuditEvent | null {
  const requestTable = requestTableOf(decision.tableName);

  if (requestTable === null) return null;

  const candidates = requests.get(requestKeyOf(requestTable, decision.rowId)) ?? [];

  if (decision.transactionId !== null) {
    const live = candidates.find((event) => event.transactionId === decision.transactionId);

    if (live !== undefined) return live;
  }

  return candidates.find((event) => event.occurredAt === decision.occurredAt) ?? candidates[0] ?? null;
}

/** The request events read, by `(table, row_id)` in read order: indexed once, so each decision looks up its own. */
type RequestIndex = ReadonlyMap<string, readonly AuditEvent[]>;

function requestKeyOf(tableName: string, rowId: string): string {
  return JSON.stringify([tableName, rowId]);
}

const REQUEST_TABLES: ReadonlySet<string> = new Set(Object.values(REQUEST_TABLE_OF_DECISION));

function pushTo(index: Map<string, AuditEvent[]>, key: string, event: AuditEvent): void {
  const list = index.get(key);

  if (list === undefined) index.set(key, [event]);
  else list.push(event);
}

function requestIndexOf(events: readonly AuditEvent[]): RequestIndex {
  const index = new Map<string, AuditEvent[]>();

  for (const event of events) {
    if (REQUEST_TABLES.has(event.tableName)) pushTo(index, requestKeyOf(event.tableName, event.rowId), event);
  }

  return index;
}

/**
 * The decisions' requests with no event in the read, by request table: the
 * ids whose current rows the caller reads so those decisions still name their
 * subject (epic 14 retro A3). Deduped, in read order; empty lists when every
 * decision found its request among the events.
 */
export function historyUnmatchedRequestIdsOf(
  events: readonly Pick<AuditEvent, 'tableName' | 'rowId'>[],
): Readonly<Record<HistoryRequestTableName, readonly string[]>> {
  const read = new Set(
    events.filter((event) => REQUEST_TABLES.has(event.tableName)).map((event) => requestKeyOf(event.tableName, event.rowId)),
  );
  const unmatched: Record<HistoryRequestTableName, string[]> = { leave_requests: [], swap_requests: [] };

  for (const event of events) {
    const requestTable = requestTableOf(event.tableName);

    if (requestTable === null) continue;
    if (read.has(requestKeyOf(requestTable, event.rowId))) continue;
    pushText(unmatched[requestTable], event.rowId);
  }

  return unmatched;
}

/** The member ids and auth users a read names but holds no `members` row for (epic 14 retro A9). */
export interface HistoryUnnamedMembers {
  /** Member ids an event's member column names. */
  readonly memberIds: readonly string[];
  /** The events' actors. */
  readonly authUserIds: readonly string[];
}

/**
 * Who the read names but cannot name from its own `members` rows: the member
 * ids in `member_id`, `member_out_id`, `member_in_id`, `proposer_id` and
 * `addressee_id` of every event, and every actor, less those a `members` row
 * in the events carries. Deduped, in read order. The caller reads the
 * organization's `members` DELETE events for them: a member still in the
 * organization is in the current list, so one named by neither was deleted,
 * and its DELETE row is its last. A current request row (retro A3) never names
 * a departed member: its member keys have no cascade (0040, 0049), so a member
 * a request still names cannot have been deleted.
 */
export function historyUnnamedMembersOf(
  events: readonly Pick<AuditEvent, 'tableName' | 'oldRow' | 'newRow' | 'actor'>[],
): HistoryUnnamedMembers {
  const namedMembers = new Set<string>();
  const namedAuthUsers = new Set<string>();

  for (const event of events) {
    if (event.tableName !== 'members') continue;

    for (const row of [event.oldRow, event.newRow]) {
      const id = row?.['id'];
      const authUserId = row?.['auth_user_id'];

      if (typeof id === 'string') namedMembers.add(id);
      if (typeof authUserId === 'string') namedAuthUsers.add(authUserId);
    }
  }

  const memberIds: string[] = [];
  const authUserIds: string[] = [];
  for (const row of events.flatMap((event) => [event.newRow, event.oldRow])) {
    if (row === null) continue;

    for (const column of MEMBER_COLUMNS) {
      const id = row[column];

      if (typeof id === 'string' && !namedMembers.has(id)) pushText(memberIds, id);
    }
  }

  for (const event of events) {
    if (event.actor !== null && !namedAuthUsers.has(event.actor)) pushText(authUserIds, event.actor);
  }

  return { memberIds, authUserIds };
}

/** A request's current row, read for a decision whose request has no event in the read (retro A3). */
export interface HistoryRequestRow {
  readonly tableName: HistoryRequestTableName;
  readonly id: string;
  /** The columns that name its subject: `member_id`; `proposer_id`, `addressee_id`, `team_id`, `return_team_id`. */
  readonly row: AuditRow;
}

/** The current request rows, by `(table, id)`. */
type CurrentRequests = ReadonlyMap<string, HistoryRequestRow>;

function currentRequestsOf(rows: readonly HistoryRequestRow[]): CurrentRequests {
  return new Map(rows.map((row) => [requestKeyOf(row.tableName, row.id), row]));
}

const NO_SUBJECTS: HistorySubjects = { members: [], teams: [], label: null };

function subjectsOf(event: AuditEvent, requests: RequestIndex, current: CurrentRequests): HistorySubjects {
  const requestTable = requestTableOf(event.tableName);

  if (requestTable === null) return subjectsOfRows(event.tableName, [event.newRow, event.oldRow]);

  const request = requestEventOf(event, requests);

  if (request !== null) {
    const fromRequest = subjectsOfRows(request.tableName, [request.newRow, request.oldRow]);

    return { ...fromRequest, label: null };
  }

  // No request event read: the request as it stands, if it still exists.
  const row = current.get(requestKeyOf(requestTable, event.rowId));

  return row === undefined ? NO_SUBJECTS : { ...subjectsOfRows(requestTable, [row.row]), label: null };
}

// ---------------------------------------------------------------- amend pairs

function pairKeyOf(event: AuditEvent, row: AuditRow | null): string | null {
  // Own keys only: a table named like a prototype key (`constructor`) has no amend key.
  const columns = Object.hasOwn(AMEND_KEYS, event.tableName) ? AMEND_KEYS[event.tableName] : undefined;

  if (columns === undefined || row === null) return null;

  const scope =
    event.transactionId !== null
      ? `t:${event.transactionId}`
      : event.origin === 'backfill'
        ? `b:${event.occurredAt}`
        : null;

  if (scope === null) return null;

  return JSON.stringify([event.tableName, scope, ...columns.map((column) => row[column] ?? null)]);
}

/**
 * Removal event id → insert event id for every amend: a `removed` UPDATE and
 * an INSERT of the same table in one transaction (live), or both backfilled
 * at one instant, sharing the pairing key. Several under one key pair in
 * ascending `id` order; one left over stays its own entry.
 */
function amendPairsOf(events: readonly AuditEvent[]): ReadonlyMap<number, number> {
  const removals = new Map<string, AuditEvent[]>();
  const inserts = new Map<string, AuditEvent[]>();

  for (const event of events) {
    if (event.operation === 'UPDATE' && setNow(event, 'removed_at')) {
      const key = pairKeyOf(event, event.oldRow);

      if (key !== null) pushTo(removals, key, event);
    } else if (event.operation === 'INSERT') {
      const key = pairKeyOf(event, event.newRow);

      if (key !== null) pushTo(inserts, key, event);
    }
  }

  const pairs = new Map<number, number>();
  const byId = (first: AuditEvent, second: AuditEvent): number => first.id - second.id;

  for (const [key, removed] of removals) {
    const added = (inserts.get(key) ?? []).sort(byId);
    const ordered = removed.sort(byId);

    ordered.forEach((removal, index) => {
      const insert = added[index];

      if (insert !== undefined && removal.origin === insert.origin) pairs.set(removal.id, insert.id);
    });
  }

  return pairs;
}

// ---------------------------------------------------------------- the period

/**
 * The day-count choices of the period chip, as the URL writes them; the
 * default is the last 30 days. NOT bare numbers: the router reads a bare
 * `?razdoblje=90` as JSON, a number, and would write it back quoted.
 */
export const HISTORY_PERIOD_CHOICES = ['7-dana', '30-dana', '90-dana', '365-dana'] as const;

export type HistoryDayChoice = (typeof HISTORY_PERIOD_CHOICES)[number];

export const DEFAULT_HISTORY_PERIOD: HistoryDayChoice = '30-dana';

const DAYS_OF_CHOICE: Readonly<Record<HistoryDayChoice, number>> = {
  '7-dana': 7,
  '30-dana': 30,
  '90-dana': 90,
  '365-dana': 365,
};

/** How many months, the current one included, the period chip offers. */
export const HISTORY_MONTH_CHOICES = 12;

/** The longest period read, in days. */
export const MAX_HISTORY_PERIOD_DAYS = 366;

/** Whole days in the organization's zone, both inclusive. */
export interface HistoryPeriod {
  readonly from: string;
  readonly to: string;
}

const MONTH_SHAPE = /^(\d{4})-(\d{2})$/;

function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function previousMonth(month: string): string {
  const year = Number(month.slice(0, 4));
  const number = Number(month.slice(5, 7));
  const [y, m] = number === 1 ? [year - 1, 12] : [year, number - 1];

  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`;
}

/** The months the period chip offers, `YYYY-MM`, the current one first. */
export function historyMonthChoicesOf(today: string): readonly string[] {
  checkDate('today', today);

  const months: string[] = [today.slice(0, 7)];

  while (months.length < HISTORY_MONTH_CHOICES) {
    const last = months[months.length - 1] ?? today.slice(0, 7);

    if (last.startsWith('0001-01')) break;
    months.push(previousMonth(last));
  }

  return months;
}

/** Every choice the period chip offers, in its order: the day counts, then the months. */
export function historyPeriodChoicesOf(today: string): readonly string[] {
  return [...HISTORY_PERIOD_CHOICES, ...historyMonthChoicesOf(today)];
}

/**
 * The period a choice names on `today`: the last N days ending today, or one
 * of the last twelve months, whole. `null` for any other choice.
 */
export function historyPeriodOf(choice: string, today: string): HistoryPeriod | null {
  checkDate('today', today);

  const days = HISTORY_PERIOD_CHOICES.find((candidate) => candidate === choice);

  if (days !== undefined) {
    const from = shiftedDate(today, 1 - DAYS_OF_CHOICE[days]);

    return from === null ? null : { from, to: today };
  }

  if (!MONTH_SHAPE.test(choice) || !historyMonthChoicesOf(today).includes(choice)) return null;

  const from = `${choice}-01`;
  const next = shiftedDate(from, 31);
  const to = next === null ? null : shiftedDate(monthStart(next), -1);

  if (to === null) return null;

  return civilDayNumber(to) - civilDayNumber(from) + 1 > MAX_HISTORY_PERIOD_DAYS ? null : { from, to };
}

/** The UTC instants a period's events lie within, whatever the zone (±14 h), as `occurred_at` bounds. */
export interface HistoryReadWindow {
  /** Inclusive: `occurred_at >= from`. */
  readonly from: string;
  /** Exclusive: `occurred_at < to`. */
  readonly to: string;
}

/**
 * The padded window read for `period`: from the midnight UTC a day before its
 * first day to the midnight UTC two days after its last. Every instant of the
 * period in any zone lies inside; the zone day of each event then drops the rest.
 */
export function historyReadWindowOf(period: HistoryPeriod): HistoryReadWindow {
  checkDate('period.from', period.from);
  checkDate('period.to', period.to);

  const from = shiftedDate(period.from, -1) ?? period.from;
  const to = shiftedDate(period.to, 2) ?? period.to;

  return { from: `${from}T00:00:00Z`, to: `${to}T00:00:00Z` };
}

function inPeriod(day: string, period: HistoryPeriod): boolean {
  return day >= period.from && day <= period.to;
}

// ---------------------------------------------------------------- entries

/** What {@link historyEntriesOf} reads beside the events. */
export interface HistoryContext {
  readonly period: HistoryPeriod;
  /** The current members: who each auth user is. */
  readonly members: readonly HistoryMemberIdentity[];
  /**
   * The current rows of the requests {@link historyUnmatchedRequestIdsOf}
   * named: a decision with no request event read names its subject through
   * one (retro A3). A request no longer there leaves it without a subject.
   */
  readonly requests?: readonly HistoryRequestRow[];
  /**
   * The `members` DELETE events read for {@link historyUnnamedMembersOf}'s
   * actors and member ids (epic 14 retro A9): they name departed authors,
   * never an entry of their own.
   */
  readonly departed?: readonly HistoryMemberEvent[];
}

/** What every entry of one read is resolved against. */
interface EntryScope {
  readonly requests: RequestIndex;
  readonly current: CurrentRequests;
  readonly members: ReadonlyMap<string, string>;
}

function entryOf(event: AuditEvent, scope: EntryScope): HistoryEntry {
  const kind = historyKindOf(event);
  const marker = event.operation === 'HISTORY_BEGINS';

  return {
    id: String(event.id),
    eventIds: [event.id],
    occurredAt: event.occurredAt,
    day: event.day,
    kind,
    author: authorOf(event, scope.members),
    subjects: marker ? NO_SUBJECTS : subjectsOf(event, scope.requests, scope.current),
    changes: marker ? [] : historyChangesOf(event.oldRow, event.newRow, event.tableName),
    reconstructed: event.origin === 'backfill' && !marker,
  };
}

function amendedEntryOf(removal: AuditEvent, insert: AuditEvent, scope: EntryScope): HistoryEntry {
  const record = historyRecordOf(insert.tableName) ?? 'other';
  const newer = insert.id > removal.id ? insert : removal;

  return {
    id: String(newer.id),
    eventIds: [removal.id, insert.id].sort((first, second) => first - second),
    occurredAt: newer.occurredAt,
    day: newer.day,
    kind: { record, action: 'amended' },
    author: authorOf(insert, scope.members),
    subjects: mergedSubjects(
      subjectsOf(removal, scope.requests, scope.current),
      subjectsOf(insert, scope.requests, scope.current),
    ),
    changes: historyChangesOf(removal.oldRow, insert.newRow, insert.tableName),
    reconstructed: removal.origin === 'backfill' && insert.origin === 'backfill',
  };
}

/**
 * The entries of `events` (as read: newest first by `(occurred_at, id)`)
 * whose day lies in the period, in that order. An amend's removal and insert
 * are one `amended` entry at the newer one's place; a decision names its
 * request's subject (its event read, else its current row in
 * `context.requests`); an event of a table this build does not know is an
 * `other` entry, its fields raw.
 */
export function historyEntriesOf(events: readonly AuditEvent[], context: HistoryContext): readonly HistoryEntry[] {
  const scope: EntryScope = {
    members: memberIdentitiesOf(events, context.members, context.departed ?? []),
    requests: requestIndexOf(events),
    current: currentRequestsOf(context.requests ?? []),
  };
  const pairs = amendPairsOf(events);
  const partnerOf = new Map<number, number>();

  for (const [removal, insert] of pairs) {
    partnerOf.set(removal, insert);
    partnerOf.set(insert, removal);
  }

  const byId = new Map(events.map((event) => [event.id, event]));
  const done = new Set<number>();
  const entries: HistoryEntry[] = [];

  for (const event of events) {
    if (done.has(event.id)) continue;
    done.add(event.id);

    const partnerId = partnerOf.get(event.id);
    const partner = partnerId === undefined ? undefined : byId.get(partnerId);
    let entry: HistoryEntry;

    if (partner === undefined) {
      entry = entryOf(event, scope);
    } else {
      done.add(partner.id);
      entry = pairs.has(event.id)
        ? amendedEntryOf(event, partner, scope)
        : amendedEntryOf(partner, event, scope);
    }

    if (inPeriod(entry.day, context.period)) entries.push(entry);
  }

  return entries;
}

// ---------------------------------------------------------------- filter

/** The chips' choices: `null` is "every". */
export interface HistoryFilters {
  readonly member: string | null;
  readonly team: string | null;
  /** A kind code, {@link historyKindCodeOf}. */
  readonly kind: string | null;
}

/** One option of a chip and how many entries it leaves. */
export interface HistoryFilterOption {
  readonly id: string;
  readonly count: number;
}

export interface HistoryFilterOptions {
  readonly members: readonly HistoryFilterOption[];
  readonly teams: readonly HistoryFilterOption[];
  /** In {@link HISTORY_RECORDS} then {@link HISTORY_ACTIONS} order. */
  readonly kinds: readonly HistoryFilterOption[];
}

function counted(ids: readonly string[]): HistoryFilterOption[] {
  const counts = new Map<string, number>();

  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);

  return [...counts].map(([id, count]) => ({ id, count }));
}

function kindOrder(code: string): number {
  const kind = historyKindOfCode(code);

  return kind === null
    ? Number.MAX_SAFE_INTEGER
    : HISTORY_RECORDS.indexOf(kind.record) * HISTORY_ACTIONS.length + HISTORY_ACTIONS.indexOf(kind.action);
}

/** Every member, team and kind the entries name, each with how many entries name it. */
export function historyFilterOptionsOf(entries: readonly HistoryEntry[]): HistoryFilterOptions {
  return {
    members: counted(entries.flatMap((entry) => entry.subjects.members)),
    teams: counted(entries.flatMap((entry) => entry.subjects.teams)),
    kinds: counted(entries.map((entry) => historyKindCodeOf(entry.kind))).sort(
      (first, second) => kindOrder(first.id) - kindOrder(second.id),
    ),
  };
}

/**
 * The entries every set filter keeps (AND): naming the member, naming the
 * team, of the kind. Matched by the ids a row names, never by a membership
 * derived for the event's date. Order kept.
 */
export function filteredHistoryEntries(
  entries: readonly HistoryEntry[],
  filters: HistoryFilters,
): readonly HistoryEntry[] {
  return entries.filter(
    (entry) =>
      (filters.member === null || entry.subjects.members.includes(filters.member)) &&
      (filters.team === null || entry.subjects.teams.includes(filters.team)) &&
      (filters.kind === null || historyKindCodeOf(entry.kind) === filters.kind),
  );
}

// ---------------------------------------------------------------- begins

/** Where history begins, and what says so. */
export interface HistoryBeginning {
  readonly occurredAt: string;
  readonly day: string;
  /** The 0061 marker, the organization's own INSERT, or the earliest entry read. */
  readonly source: 'marker' | 'organization' | 'earliest';
}

/**
 * Where history begins: the `HISTORY_BEGINS` marker, else the organization's
 * own INSERT event, else the earliest entry read. `null` with none of them.
 */
export function historyBeginsOf(
  markerEvents: readonly AuditEvent[],
  entries: readonly HistoryEntry[],
): HistoryBeginning | null {
  const byId = [...markerEvents].sort((first, second) => first.id - second.id);
  const marker = byId.find((event) => event.operation === 'HISTORY_BEGINS');

  if (marker !== undefined) return { occurredAt: marker.occurredAt, day: marker.day, source: 'marker' };

  const created = byId.find((event) => event.operation === 'INSERT' && event.tableName === 'organizations');

  if (created !== undefined) return { occurredAt: created.occurredAt, day: created.day, source: 'organization' };

  const earliest = entries[entries.length - 1];

  return earliest === undefined ? null : { occurredAt: earliest.occurredAt, day: earliest.day, source: 'earliest' };
}

/**
 * Whether the page states where history begins: the period reaches back to
 * the marker or the organization's own INSERT. Never for the earliest entry
 * read — with neither, there is nothing true to claim about a beginning.
 */
export function historyReachesBeginning(period: HistoryPeriod, beginning: HistoryBeginning | null): boolean {
  return beginning !== null && beginning.source !== 'earliest' && period.from <= beginning.day;
}
