import type {
  AuditEvent,
  HistoryAction,
  HistoryAuthor,
  HistoryEntry,
  HistoryEnumField,
  HistoryField,
  HistoryFilterOption,
  HistoryOperand,
  HistoryRecord,
} from '@shift/domain';
import {
  HISTORY_PERIOD_CHOICES,
  MINUTES_PER_DAY,
  historyKindOfCode,
  historyReachesBeginning,
  type HistoryBeginning,
  type HistoryDayChoice,
  type HistoryPeriod,
} from '@shift/domain';

import { isPositionCode, positionMessageKey } from '@/features/members/utils/position';
import { t } from '@/lib/i18n';
import {
  compareText,
  organizationIsoDate,
  formatDate,
  formatIsoDate,
  formatIsoMonthName,
  formatList,
  formatMinuteOfDay,
  formatNumber,
  formatTime,
} from '@/lib/i18n/format';

/** A `time` of `24:00:00`, as the clock writes it (a figure, not prose). */
const END_OF_DAY = '24:00';

/**
 * *Povijest promjena*'s rows in words (story 14.2): each domain entry's codes
 * and operands put into Croatian through STATIC code → key records, so every
 * word comes from `hr.json` and no key is ever built from a template.
 *
 * {@link HistoryRow} is the one value the table and the stacked rows draw, in
 * order — and the one story 14.3's export prints: no second read, no second
 * wording.
 *
 * NAMES come from the current lists first, then from the rows the events
 * hold, so a deleted member's or team's name (a DELETE keeps its old row)
 * stays readable (AD-11 Deletes).
 */

/** One field's *bilo → sada* in words: `null` where the side has no value (an addition, a deletion). */
export interface HistoryRowChange {
  /** The domain's column: the change's identity, never a word. */
  readonly column: string;
  readonly field: string;
  readonly before: string | null;
  readonly after: string | null;
}

/** One drawn line of the history. */
export interface HistoryRow {
  readonly id: string;
  /** `16. 11. 2026. 10:42`, in the organization's zone. */
  readonly time: string;
  readonly author: string;
  /** `Odsutnost · uklonjeno`. */
  readonly kind: string;
  readonly subject: string;
  /** Backfilled: marked reconstructed. */
  readonly reconstructed: boolean;
  /** The `HISTORY_BEGINS` marker: a row of its own. */
  readonly marker: boolean;
  readonly changes: readonly HistoryRowChange[];
}

/** Names by id, for the subjects, the authors and the operands. */
export interface HistoryNames {
  readonly members: ReadonlyMap<string, string>;
  readonly teams: ReadonlyMap<string, string>;
  readonly shiftTypes: ReadonlyMap<string, string>;
  readonly absenceTypes: ReadonlyMap<string, string>;
}

/** The current lists, each `{ id, name }`. */
export interface HistoryNameLists {
  readonly members: readonly { readonly id: string; readonly name: string }[];
  readonly teams: readonly { readonly id: string; readonly name: string }[];
  readonly shiftTypes: readonly { readonly id: string; readonly name: string }[];
  readonly absenceTypes: readonly { readonly id: string; readonly name: string }[];
}

const NAMED_TABLES = {
  members: 'members',
  teams: 'teams',
  shiftTypes: 'shift_types',
  absenceTypes: 'absence_types',
} as const;

function namesFrom(
  table: string,
  events: readonly Pick<AuditEvent, 'tableName' | 'oldRow' | 'newRow'>[],
  current: readonly { readonly id: string; readonly name: string }[],
): ReadonlyMap<string, string> {
  const names = new Map<string, string>();

  // Oldest first, so a later name wins; the current list wins over all.
  for (const event of [...events].reverse()) {
    if (event.tableName !== table) continue;

    for (const row of [event.oldRow, event.newRow]) {
      const id = row?.['id'];
      const name = row?.['name'];

      if (typeof id === 'string' && typeof name === 'string' && name !== '') names.set(id, name);
    }
  }

  for (const { id, name } of current) names.set(id, name);

  return names;
}

/** Every name the rows may need: the current lists, then the rows the events hold. */
export function historyNamesOf(
  events: readonly Pick<AuditEvent, 'tableName' | 'oldRow' | 'newRow'>[],
  lists: HistoryNameLists,
): HistoryNames {
  return {
    members: namesFrom(NAMED_TABLES.members, events, lists.members),
    teams: namesFrom(NAMED_TABLES.teams, events, lists.teams),
    shiftTypes: namesFrom(NAMED_TABLES.shiftTypes, events, lists.shiftTypes),
    absenceTypes: namesFrom(NAMED_TABLES.absenceTypes, events, lists.absenceTypes),
  };
}

/**
 * Each event read with its organization day: the date of its instant in
 * `zone`, so the period is whole days there. The raw `occurredAt` is kept
 * exactly as read — the cursor and the order are its, never a `Date`'s.
 */
export function historyEventsInZone<E extends Pick<AuditEvent, 'occurredAt'>>(
  events: readonly E[],
  zone: string,
): readonly (E & { readonly day: string })[] {
  return events.map((event) => ({ ...event, day: organizationIsoDate(new Date(event.occurredAt), zone) }));
}

/**
 * Where history begins, in words' operands: the page states it when the
 * period reaches the marker or the organization's own INSERT, and says it by
 * which of the two it is.
 */
export interface HistoryBeginsView {
  readonly source: 'marker' | 'organization';
  readonly date: string;
  readonly time: string;
}

/**
 * The begins statement's operands, or `null` when the page states nothing:
 * the period does not reach the beginning, or the beginning is only the
 * earliest entry read — nothing true to claim then.
 */
export function historyBeginsViewOf(
  beginning: HistoryBeginning | null,
  period: HistoryPeriod,
  zone: string,
): HistoryBeginsView | null {
  if (beginning === null || beginning.source === 'earliest' || !historyReachesBeginning(period, beginning)) {
    return null;
  }

  const instant = new Date(beginning.occurredAt);

  return { source: beginning.source, date: formatDate(instant, zone), time: formatTime(instant, zone) };
}

/** The begins statement by its source: the marker's says what was lost; the organization's, that nothing was. */
export function historyBeginsMessageKey(
  source: HistoryBeginsView['source'],
): 'history.begins' | 'history.beginsOrganization' {
  return source === 'marker' ? 'history.begins' : 'history.beginsOrganization';
}

/** How many of `entries` are changes: the start-of-history row is none. */
export function historyChangeCount(entries: readonly Pick<HistoryEntry, 'kind'>[]): number {
  return entries.filter((entry) => entry.kind.action !== 'history-begins').length;
}

// ---------------------------------------------------------------- the words

const RECORD_KEYS: Readonly<Record<HistoryRecord, ReturnType<typeof historyRecordMessageKey>>> = {
  organization: 'history.record.organization',
  member: 'history.record.member',
  'member-status': 'history.record.memberStatus',
  'team-membership': 'history.record.teamMembership',
  team: 'history.record.team',
  'hour-band': 'history.record.hourBand',
  'shift-type': 'history.record.shiftType',
  'shift-type-version': 'history.record.shiftTypeVersion',
  'rotation-pattern': 'history.record.rotationPattern',
  'rotation-step': 'history.record.rotationStep',
  'rotation-assignment': 'history.record.rotationAssignment',
  'shift-type-override': 'history.record.shiftTypeOverride',
  'roster-override': 'history.record.rosterOverride',
  'leave-record': 'history.record.leaveRecord',
  'conflict-resolution': 'history.record.conflictResolution',
  'leave-request': 'history.record.leaveRequest',
  'leave-request-decision': 'history.record.leaveRequestDecision',
  'swap-request': 'history.record.swapRequest',
  'swap-request-decision': 'history.record.swapRequestDecision',
  'absence-type': 'history.record.absenceType',
  'leave-allowance': 'history.record.leaveAllowance',
  other: 'history.record.other',
};

/** A record's word. Exhaustive by type. */
export function historyRecordMessageKey(
  record: HistoryRecord,
):
  | 'history.record.organization'
  | 'history.record.member'
  | 'history.record.memberStatus'
  | 'history.record.teamMembership'
  | 'history.record.team'
  | 'history.record.hourBand'
  | 'history.record.shiftType'
  | 'history.record.shiftTypeVersion'
  | 'history.record.rotationPattern'
  | 'history.record.rotationStep'
  | 'history.record.rotationAssignment'
  | 'history.record.shiftTypeOverride'
  | 'history.record.rosterOverride'
  | 'history.record.leaveRecord'
  | 'history.record.conflictResolution'
  | 'history.record.leaveRequest'
  | 'history.record.leaveRequestDecision'
  | 'history.record.swapRequest'
  | 'history.record.swapRequestDecision'
  | 'history.record.absenceType'
  | 'history.record.leaveAllowance'
  | 'history.record.other' {
  return RECORD_KEYS[record];
}

const ACTION_KEYS: Readonly<Record<HistoryAction, ReturnType<typeof historyActionMessageKey>>> = {
  added: 'history.action.added',
  changed: 'history.action.changed',
  deleted: 'history.action.deleted',
  removed: 'history.action.removed',
  confirmed: 'history.action.confirmed',
  answered: 'history.action.answered',
  closed: 'history.action.closed',
  archived: 'history.action.archived',
  restored: 'history.action.restored',
  amended: 'history.action.amended',
  decided: 'history.action.decided',
  'history-begins': 'history.action.historyBegins',
};

/** An action's word. Exhaustive by type. */
export function historyActionMessageKey(
  action: HistoryAction,
):
  | 'history.action.added'
  | 'history.action.changed'
  | 'history.action.deleted'
  | 'history.action.removed'
  | 'history.action.confirmed'
  | 'history.action.answered'
  | 'history.action.closed'
  | 'history.action.archived'
  | 'history.action.restored'
  | 'history.action.amended'
  | 'history.action.decided'
  | 'history.action.historyBegins' {
  return ACTION_KEYS[action];
}

const FIELD_KEYS: Readonly<Record<HistoryField, ReturnType<typeof historyFieldMessageKey>>> = {
  name: 'history.field.name',
  shortName: 'history.field.shortName',
  slug: 'history.field.slug',
  description: 'history.field.description',
  address: 'history.field.address',
  contactEmail: 'history.field.contactEmail',
  organizationType: 'history.field.organizationType',
  timezone: 'history.field.timezone',
  locale: 'history.field.locale',
  leaveYearStartMonth: 'history.field.leaveYearStartMonth',
  leaveYearStartDay: 'history.field.leaveYearStartDay',
  brandAccent: 'history.field.brandAccent',
  logoPath: 'history.field.logoPath',
  usesFireRanks: 'history.field.usesFireRanks',
  emailNotifications: 'history.field.emailNotifications',
  minimumMembers: 'history.field.minimumMembers',
  carryOverMaxDays: 'history.field.carryOverMaxDays',
  carryOverExpiryMonth: 'history.field.carryOverExpiryMonth',
  carryOverExpiryDay: 'history.field.carryOverExpiryDay',
  carryOverFirstLeaveYear: 'history.field.carryOverFirstLeaveYear',
  username: 'history.field.username',
  email: 'history.field.email',
  role: 'history.field.role',
  fireRank: 'history.field.fireRank',
  leaveAllowanceDays: 'history.field.leaveAllowanceDays',
  member: 'history.field.member',
  memberOut: 'history.field.memberOut',
  memberIn: 'history.field.memberIn',
  proposer: 'history.field.proposer',
  addressee: 'history.field.addressee',
  team: 'history.field.team',
  returnTeam: 'history.field.returnTeam',
  active: 'history.field.active',
  position: 'history.field.position',
  archived: 'history.field.archived',
  isWorking: 'history.field.isWorking',
  shiftType: 'history.field.shiftType',
  startTime: 'history.field.startTime',
  endTime: 'history.field.endTime',
  effectiveFrom: 'history.field.effectiveFrom',
  anchorDate: 'history.field.anchorDate',
  date: 'history.field.date',
  returnDate: 'history.field.returnDate',
  during: 'history.field.during',
  half: 'history.field.half',
  absenceType: 'history.field.absenceType',
  drawsAllowance: 'history.field.drawsAllowance',
  kind: 'history.field.kind',
  reason: 'history.field.reason',
  answer: 'history.field.answer',
  outcome: 'history.field.outcome',
  leaveYear: 'history.field.leaveYear',
  days: 'history.field.days',
};

/** A field's label. Exhaustive by type. */
export function historyFieldMessageKey(
  field: HistoryField,
):
  | 'history.field.name'
  | 'history.field.shortName'
  | 'history.field.slug'
  | 'history.field.description'
  | 'history.field.address'
  | 'history.field.contactEmail'
  | 'history.field.organizationType'
  | 'history.field.timezone'
  | 'history.field.locale'
  | 'history.field.leaveYearStartMonth'
  | 'history.field.leaveYearStartDay'
  | 'history.field.brandAccent'
  | 'history.field.logoPath'
  | 'history.field.usesFireRanks'
  | 'history.field.emailNotifications'
  | 'history.field.minimumMembers'
  | 'history.field.carryOverMaxDays'
  | 'history.field.carryOverExpiryMonth'
  | 'history.field.carryOverExpiryDay'
  | 'history.field.carryOverFirstLeaveYear'
  | 'history.field.username'
  | 'history.field.email'
  | 'history.field.role'
  | 'history.field.fireRank'
  | 'history.field.leaveAllowanceDays'
  | 'history.field.member'
  | 'history.field.memberOut'
  | 'history.field.memberIn'
  | 'history.field.proposer'
  | 'history.field.addressee'
  | 'history.field.team'
  | 'history.field.returnTeam'
  | 'history.field.active'
  | 'history.field.position'
  | 'history.field.archived'
  | 'history.field.isWorking'
  | 'history.field.shiftType'
  | 'history.field.startTime'
  | 'history.field.endTime'
  | 'history.field.effectiveFrom'
  | 'history.field.anchorDate'
  | 'history.field.date'
  | 'history.field.returnDate'
  | 'history.field.during'
  | 'history.field.half'
  | 'history.field.absenceType'
  | 'history.field.drawsAllowance'
  | 'history.field.kind'
  | 'history.field.reason'
  | 'history.field.answer'
  | 'history.field.outcome'
  | 'history.field.leaveYear'
  | 'history.field.days' {
  return FIELD_KEYS[field];
}

const ENUM_KEYS: Readonly<Record<HistoryEnumField, Readonly<Record<string, ReturnType<typeof historyEnumMessageKey>>>>> = {
  role: { admin: 'history.enum.roleAdmin', member_role: 'history.enum.roleMember' },
  outcome: {
    approved: 'history.enum.outcomeApproved',
    rejected: 'history.enum.outcomeRejected',
    deactivated: 'history.enum.outcomeDeactivated',
  },
  answer: { accepted: 'history.enum.answerAccepted', declined: 'history.enum.answerDeclined' },
  kind: {
    accept_uncovered: 'history.enum.kindAcceptUncovered',
    replace_member: 'history.enum.kindReplaceMember',
    amend_leave: 'history.enum.kindAmendLeave',
  },
  half: { FIRST: 'history.enum.halfFirst', SECOND: 'history.enum.halfSecond' },
};

/** A stored enum value's word, or `null` for a value this build does not know (drawn as stored). */
export function historyEnumMessageKey(
  field: HistoryEnumField,
  value: string,
):
  | 'history.enum.roleAdmin'
  | 'history.enum.roleMember'
  | 'history.enum.outcomeApproved'
  | 'history.enum.outcomeRejected'
  | 'history.enum.outcomeDeactivated'
  | 'history.enum.answerAccepted'
  | 'history.enum.answerDeclined'
  | 'history.enum.kindAcceptUncovered'
  | 'history.enum.kindReplaceMember'
  | 'history.enum.kindAmendLeave'
  | 'history.enum.halfFirst'
  | 'history.enum.halfSecond'
  | null {
  const values = ENUM_KEYS[field];

  return Object.hasOwn(values, value) ? (values[value] ?? null) : null;
}

/** An author who is not a member named by the lists. Exhaustive. */
export function historyAuthorMessageKey(
  author: Exclude<HistoryAuthor['kind'], 'member'>,
): 'history.author.departed' | 'history.author.service' | 'history.author.system' {
  switch (author) {
    case 'departed':
      return 'history.author.departed';
    case 'service':
      return 'history.author.service';
    case 'system':
      return 'history.author.system';
  }
}

/** A day-count period choice's words. Exhaustive over the day choices. */
export function historyPeriodMessageKey(
  choice: HistoryDayChoice,
): 'history.period.days7' | 'history.period.days30' | 'history.period.days90' | 'history.period.days365' {
  switch (choice) {
    case '7-dana':
      return 'history.period.days7';
    case '30-dana':
      return 'history.period.days30';
    case '90-dana':
      return 'history.period.days90';
    case '365-dana':
      return 'history.period.days365';
  }
}

/** A period choice as the chip and its picker say it: `zadnjih 30 dana`, `studeni 2026.`. */
export function historyPeriodText(choice: string): string {
  const days = HISTORY_PERIOD_CHOICES.find((candidate) => candidate === choice);

  if (days !== undefined) return t(historyPeriodMessageKey(days));

  const month = formatIsoMonthName(`${choice}-01`);

  return month === null ? choice : t('history.period.month', { month, year: choice.slice(0, 4) });
}

// ---------------------------------------------------------------- operands

function named(names: ReadonlyMap<string, string>, id: string, unknown: string): string {
  return names.get(id) ?? unknown;
}

function numberText(value: number): string {
  return formatNumber(value, Number.isInteger(value) ? 0 : 2);
}

/** One operand in words; `null` for none. */
export function historyOperandText(operand: HistoryOperand, names: HistoryNames): string | null {
  switch (operand.type) {
    case 'none':
      return null;
    case 'text':
      return operand.value;
    case 'number':
      return numberText(operand.value);
    case 'boolean':
      return operand.value ? t('history.value.yes') : t('history.value.no');
    case 'date':
      return formatIsoDate(operand.value) ?? operand.value;
    case 'range': {
      const from = formatIsoDate(operand.from) ?? operand.from;
      const to = formatIsoDate(operand.to) ?? operand.to;

      return operand.from === operand.to ? from : t('history.value.range', { from, to });
    }
    case 'time':
      // PostgreSQL's `24:00:00` (the domain's minute 1440) is the end of the
      // day; the formatter holds 0–1439 and would throw while the rows draw.
      return operand.minute >= MINUTES_PER_DAY ? END_OF_DAY : formatMinuteOfDay(operand.minute);
    case 'member':
      return named(names.members, operand.id, t('history.value.unknownMember'));
    case 'team':
      return named(names.teams, operand.id, t('history.value.unknownTeam'));
    case 'shift-type':
      return named(names.shiftTypes, operand.id, t('history.value.unknownShiftType'));
    case 'absence-type':
      return named(names.absenceTypes, operand.id, t('history.value.unknownAbsenceType'));
    case 'enum': {
      const key = historyEnumMessageKey(operand.field, operand.value);

      return key === null ? operand.value : t(key);
    }
    case 'raw':
      return operand.json;
  }
}

// ---------------------------------------------------------------- rows

/** A change's operand: a team position's code in its own words (0015), every other as {@link historyOperandText}. */
function changeOperandText(field: HistoryField | null, operand: HistoryOperand, names: HistoryNames): string | null {
  if (field === 'position' && operand.type === 'text' && isPositionCode(operand.value)) {
    return t(positionMessageKey(operand.value));
  }

  return historyOperandText(operand, names);
}

function authorText(author: HistoryAuthor, names: HistoryNames): string {
  return author.kind === 'member'
    ? named(names.members, author.memberId, t('history.author.departed'))
    : t(historyAuthorMessageKey(author.kind));
}

function subjectText(entry: HistoryEntry, names: HistoryNames): string {
  const parts = [
    ...entry.subjects.members.map((id) => named(names.members, id, t('history.value.unknownMember'))),
    ...entry.subjects.teams.map((id) => named(names.teams, id, t('history.value.unknownTeam'))),
  ];

  if (parts.length > 0) return formatList(parts);

  const label = entry.subjects.label === null ? null : historyOperandText(entry.subjects.label, names);

  return label ?? t(historyRecordMessageKey(entry.kind.record));
}

/** A kind code as its words, `Odsutnost · uklonjeno`; the code itself for none. */
export function historyKindText(code: string): string {
  const kind = historyKindOfCode(code);

  return kind === null
    ? code
    : t('history.kindLine', {
        record: t(historyRecordMessageKey(kind.record)),
        action: t(historyActionMessageKey(kind.action)),
      });
}

/**
 * The rows the screen draws and 14.3 prints, one per entry, in the entries'
 * order: every word from `hr.json`, every name from `names`, every instant in
 * the organization's `zone`.
 */
export function historyRowsOf(entries: readonly HistoryEntry[], names: HistoryNames, zone: string): readonly HistoryRow[] {
  return entries.map((entry) => {
    const instant = new Date(entry.occurredAt);

    return {
      id: entry.id,
      time: t('history.time', { date: formatDate(instant, zone), time: formatTime(instant, zone) }),
      author: authorText(entry.author, names),
      kind: t('history.kindLine', {
        record: t(historyRecordMessageKey(entry.kind.record)),
        action: t(historyActionMessageKey(entry.kind.action)),
      }),
      subject: entry.kind.action === 'history-begins' ? t('history.markerSubject') : subjectText(entry, names),
      reconstructed: entry.reconstructed,
      marker: entry.kind.action === 'history-begins',
      changes: entry.changes.map((change) => ({
        column: change.column,
        field: change.field === null ? change.column : t(historyFieldMessageKey(change.field)),
        before: changeOperandText(change.field, change.before, names),
        after: changeOperandText(change.field, change.after, names),
      })),
    };
  });
}

/** One chip option in words: its id, its label and how many entries it leaves. */
export interface HistoryOptionView {
  readonly id: string;
  readonly label: string;
  readonly count: number;
}

/** The member options, by name. */
export function historyMemberOptionsOf(
  options: readonly HistoryFilterOption[],
  names: HistoryNames,
): readonly HistoryOptionView[] {
  return options
    .map((option) => ({ ...option, label: named(names.members, option.id, t('history.value.unknownMember')) }))
    .sort((first, second) => compareText(first.label, second.label));
}

/** The team options, by name. */
export function historyTeamOptionsOf(
  options: readonly HistoryFilterOption[],
  names: HistoryNames,
): readonly HistoryOptionView[] {
  return options
    .map((option) => ({ ...option, label: named(names.teams, option.id, t('history.value.unknownTeam')) }))
    .sort((first, second) => compareText(first.label, second.label));
}

/** The kind options, in the domain's order. */
export function historyKindOptionsOf(options: readonly HistoryFilterOption[]): readonly HistoryOptionView[] {
  return options.map((option) => ({ ...option, label: historyKindText(option.id) }));
}
