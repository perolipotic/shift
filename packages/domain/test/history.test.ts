import { describe, expect, it } from 'vitest';

import {
  DEFAULT_HISTORY_PERIOD,
  HISTORY_ACTIONS,
  HISTORY_FIELDS,
  HISTORY_HIDDEN_COLUMNS,
  HISTORY_RECORDS,
  HISTORY_STATUS_COLUMN,
  MAX_HISTORY_PERIOD_DAYS,
  filteredHistoryEntries,
  historyBeginsOf,
  historyChangesOf,
  historyEntriesOf,
  historyFilterOptionsOf,
  historyKindCodeOf,
  historyKindOf,
  historyKindOfCode,
  historyMonthChoicesOf,
  historyOperandOf,
  historyPeriodChoicesOf,
  historyPeriodOf,
  historyReachesBeginning,
  historyReadWindowOf,
  historyRecordOf,
  historyStatusOf,
  historyUnmatchedRequestIdsOf,
  historyUnnamedMembersOf,
  type AuditEvent,
  type AuditRow,
  type HistoryContext,
  type HistoryEntry,
} from '../src/index.js';

const ORG = 'org-1';
const ANA = 'member-ana';
const ANA_AUTH = 'auth-ana';
const IVO = 'member-ivo';
const IVO_AUTH = 'auth-ivo';
const TEAM_A = 'team-a';
const TEAM_B = 'team-b';

const PERIOD = { from: '2026-11-01', to: '2026-11-30' };
const CONTEXT: HistoryContext = { period: PERIOD, members: [{ id: ANA, authUserId: ANA_AUTH }] };

let nextId = 1000;

/** One event; newest-first order is the caller's, as the read returns it. */
function event(overrides: Partial<AuditEvent> & Pick<AuditEvent, 'tableName' | 'operation'>): AuditEvent {
  nextId += 1;

  return {
    id: nextId,
    rowId: `row-${nextId}`,
    oldRow: null,
    newRow: null,
    actor: ANA_AUTH,
    sessionRole: 'authenticated',
    origin: 'trigger',
    transactionId: `${nextId}`,
    occurredAt: '2026-11-10T08:00:00.123456+00:00',
    day: '2026-11-10',
    ...overrides,
  };
}

function only(events: readonly AuditEvent[], context: HistoryContext = CONTEXT): HistoryEntry {
  const entries = historyEntriesOf(events, context);

  expect(entries).toHaveLength(1);

  return entries[0] as HistoryEntry;
}

describe('the kind of an event', () => {
  const TABLES: readonly [string, string][] = [
    ['organizations', 'organization'],
    ['members', 'member'],
    ['member_status_versions', 'member-status'],
    ['team_membership_versions', 'team-membership'],
    ['teams', 'team'],
    ['hour_bands', 'hour-band'],
    ['shift_types', 'shift-type'],
    ['shift_type_versions', 'shift-type-version'],
    ['rotation_patterns', 'rotation-pattern'],
    ['rotation_steps', 'rotation-step'],
    ['rotation_assignments', 'rotation-assignment'],
    ['shift_type_overrides', 'shift-type-override'],
    ['roster_overrides', 'roster-override'],
    ['leave_records', 'leave-record'],
    ['conflict_resolutions', 'conflict-resolution'],
    ['leave_requests', 'leave-request'],
    ['leave_request_decisions', 'leave-request-decision'],
    ['swap_requests', 'swap-request'],
    ['swap_request_decisions', 'swap-request-decision'],
    ['absence_types', 'absence-type'],
    ['leave_allowances', 'leave-allowance'],
  ];

  it('names one record per audited table, all 21, and nothing else', () => {
    expect(TABLES.map(([table]) => historyRecordOf(table))).toEqual(TABLES.map(([, record]) => record));
    expect(new Set([...TABLES.map(([, record]) => record), 'other'])).toEqual(new Set(HISTORY_RECORDS));
    expect(historyRecordOf('audit_events')).toBeNull();
    expect(historyRecordOf('notification_outbox')).toBeNull();
    expect(historyRecordOf('toString')).toBeNull();
  });

  it.each(TABLES)('reads an insert into %s as added, a delete as deleted', (table, record) => {
    const decision = table.endsWith('_decisions');

    expect(historyKindOf(event({ tableName: table, operation: 'INSERT', newRow: {} }))).toEqual({
      record,
      action: decision ? 'decided' : 'added',
    });
    expect(historyKindOf(event({ tableName: table, operation: 'DELETE', oldRow: {} }))).toEqual({
      record,
      action: 'deleted',
    });
  });

  it.each([
    ['removed', 'leave_records', { removed_at: null }, { removed_at: '2026-11-10T08:00:00+00:00' }],
    ['confirmed', 'roster_overrides', { confirmed_at: null }, { confirmed_at: '2026-11-10T08:00:00+00:00' }],
    [
      'answered',
      'swap_requests',
      { answer: null, answered_at: null, closed_at: null },
      { answer: 'declined', answered_at: '2026-11-10T08:00:00+00:00', closed_at: '2026-11-10T08:00:00+00:00' },
    ],
    ['closed', 'leave_requests', { closed_at: null }, { closed_at: '2026-11-10T08:00:00+00:00' }],
    ['archived', 'teams', { archived: false }, { archived: true }],
    ['restored', 'shift_types', { archived: true }, { archived: false }],
    ['changed', 'teams', { name: 'A' }, { name: 'B' }],
  ])('reads an update as %s', (action, table, oldRow, newRow) => {
    expect(historyKindOf(event({ tableName: table, operation: 'UPDATE', oldRow, newRow }))?.action).toBe(action);
  });

  it('reads a table this build does not know as an other record, its fields raw, never a failed read', () => {
    const later = event({
      tableName: 'audited_later',
      operation: 'UPDATE',
      oldRow: { id: 'x', colour: 'red' },
      newRow: { id: 'x', colour: 'blue' },
    });
    const added = event({ tableName: 'audited_later', operation: 'INSERT', newRow: { id: 'y', colour: 'red' } });
    const removed = event({ tableName: 'audited_later', operation: 'DELETE', oldRow: { id: 'y', colour: 'red' } });
    const entries = historyEntriesOf([removed, added, later], CONTEXT);

    expect(entries.map((entry) => entry.kind)).toEqual([
      { record: 'other', action: 'deleted' },
      { record: 'other', action: 'added' },
      { record: 'other', action: 'changed' },
    ]);
    expect(entries[2]?.changes).toEqual([
      { field: null, column: 'colour', before: { type: 'raw', json: '"red"' }, after: { type: 'raw', json: '"blue"' } },
    ]);
  });

  it('reads the marker as the organization history-begins', () => {
    expect(historyKindOf(event({ tableName: 'organizations', operation: 'HISTORY_BEGINS', origin: 'backfill' }))).toEqual({
      record: 'organization',
      action: 'history-begins',
    });
  });

  it('round-trips every kind code, and refuses anything else', () => {
    for (const record of HISTORY_RECORDS) {
      for (const action of HISTORY_ACTIONS) {
        expect(historyKindOfCode(historyKindCodeOf({ record, action }))).toEqual({ record, action });
      }
    }

    for (const code of ['', 'team', 'team:', ':added', 'team:eaten', 'house:added', 'team:added:x']) {
      expect(historyKindOfCode(code)).toBeNull();
    }
  });
});

describe('the field-level bilo → sada', () => {
  it('lists the changed visible fields of an update, in the field order', () => {
    expect(
      historyChangesOf(
        { id: 't', organization_id: ORG, name: 'A', archived: false, created_at: 'x' },
        { id: 't', organization_id: ORG, name: 'B', archived: true, created_at: 'y' },
      ),
    ).toEqual([
      { field: 'name', column: 'name', before: { type: 'text', value: 'A' }, after: { type: 'text', value: 'B' } },
      {
        field: 'archived',
        column: 'archived',
        before: { type: 'boolean', value: false },
        after: { type: 'boolean', value: true },
      },
    ]);
  });

  it('shows an insert as after values only and a delete as before values only, nulls left out', () => {
    const row = { id: 'l', member_id: ANA, during: '[2026-11-02,2026-11-05)', half: null, removed_at: null };

    expect(historyChangesOf(null, row)).toEqual([
      { field: 'member', column: 'member_id', before: { type: 'none' }, after: { type: 'member', id: ANA } },
      {
        field: 'during',
        column: 'during',
        before: { type: 'none' },
        after: { type: 'range', from: '2026-11-02', to: '2026-11-04' },
      },
    ]);
    expect(historyChangesOf(row, null).map((change) => change.after)).toEqual([{ type: 'none' }, { type: 'none' }]);
  });

  it('reads every key shape a migration wrote, an unknown column as a raw operand', () => {
    expect(historyOperandOf('start_time', '07:30:00')).toEqual({ type: 'time', minute: 450 });
    expect(historyOperandOf('end_time', '24:00:00')).toEqual({ type: 'time', minute: 1440 });
    expect(historyOperandOf('start_time', '23:59:59')).toEqual({ type: 'time', minute: 1439 });
    for (const bad of ['24:00:01', '25:00:00', '07:60:00', '07:30:60', '99:99']) {
      expect(historyOperandOf('start_time', bad)).toEqual({ type: 'raw', json: JSON.stringify(bad) });
    }
    expect(historyOperandOf('date', '2026-02-29')).toEqual({ type: 'raw', json: '"2026-02-29"' });
    expect(historyOperandOf('effective_from', '2026-11-01')).toEqual({ type: 'date', value: '2026-11-01' });
    expect(historyOperandOf('during', '[2026-11-02,2026-11-03)')).toEqual({
      type: 'range',
      from: '2026-11-02',
      to: '2026-11-02',
    });
    expect(historyOperandOf('during', 'empty')).toEqual({ type: 'raw', json: '"empty"' });
    expect(historyOperandOf('role', 'admin')).toEqual({ type: 'enum', field: 'role', value: 'admin' });
    expect(historyOperandOf('half', 'FIRST')).toEqual({ type: 'enum', field: 'half', value: 'FIRST' });
    expect(historyOperandOf('outcome', 'deactivated')).toEqual({ type: 'enum', field: 'outcome', value: 'deactivated' });
    expect(historyOperandOf('kind', 'accept_uncovered')).toEqual({
      type: 'enum',
      field: 'kind',
      value: 'accept_uncovered',
    });
    expect(historyOperandOf('position', 'leader')).toEqual({ type: 'text', value: 'leader' });
    expect(historyOperandOf('position', 3)).toEqual({ type: 'number', value: 3 });
    expect(historyOperandOf('absence_type_id', 'a1')).toEqual({ type: 'absence-type', id: 'a1' });
    expect(historyOperandOf('shift_type_id', 's1')).toEqual({ type: 'shift-type', id: 's1' });
    expect(historyOperandOf('return_team_id', TEAM_B)).toEqual({ type: 'team', id: TEAM_B });
    expect(historyOperandOf('days', '20')).toEqual({ type: 'raw', json: '"20"' });
    expect(historyOperandOf('fire_rank', 'vatrogasac')).toEqual({ type: 'text', value: 'vatrogasac' });
    expect(historyOperandOf('a_column_from_later', { x: 1 })).toEqual({ type: 'raw', json: '{"x":1}' });
    expect(historyOperandOf('name', null)).toEqual({ type: 'none' });
    expect(historyChangesOf({ renamed_col: 1 }, { renamed_col: 2 })).toEqual([
      { field: null, column: 'renamed_col', before: { type: 'raw', json: '1' }, after: { type: 'raw', json: '2' } },
    ]);
  });

  it('declares every field once', () => {
    expect(new Set(HISTORY_FIELDS).size).toBe(HISTORY_FIELDS.length);
  });
});

describe('the author', () => {
  it('names a current member by their auth user', () => {
    expect(only([event({ tableName: 'teams', operation: 'INSERT', newRow: { name: 'A' } })]).author).toEqual({
      kind: 'member',
      memberId: ANA,
    });
  });

  it('names a member who left through a members row the events hold', () => {
    const deleted = event({
      tableName: 'members',
      operation: 'DELETE',
      oldRow: { id: IVO, auth_user_id: IVO_AUTH, name: 'Ivo' },
      actor: null,
      sessionRole: 'postgres',
    });
    const written = event({ tableName: 'teams', operation: 'INSERT', newRow: { name: 'A' }, actor: IVO_AUTH });

    expect(historyEntriesOf([written, deleted], CONTEXT)[0]?.author).toEqual({ kind: 'member', memberId: IVO });
  });

  it('says departed for an actor nobody names, service and system for none', () => {
    const departed = event({ tableName: 'teams', operation: 'INSERT', newRow: {}, actor: 'auth-gone' });
    const service = event({ tableName: 'teams', operation: 'INSERT', newRow: {}, actor: null, sessionRole: 'service_role' });
    const system = event({ tableName: 'teams', operation: 'INSERT', newRow: {}, actor: null, sessionRole: 'postgres' });

    expect(historyEntriesOf([departed, service, system], CONTEXT).map((entry) => entry.author)).toEqual([
      { kind: 'departed' },
      { kind: 'service' },
      { kind: 'system' },
    ]);
  });
});

describe('the subject', () => {
  it('names the members and teams a row names, a members or teams row by its own id', () => {
    const roster = event({
      tableName: 'roster_overrides',
      operation: 'INSERT',
      newRow: { team_id: TEAM_A, member_out_id: ANA, member_in_id: IVO, date: '2026-11-12' },
    });
    const member = event({ tableName: 'members', operation: 'UPDATE', oldRow: { id: IVO, name: 'I' }, newRow: { id: IVO, name: 'Ivo' } });
    const team = event({ tableName: 'teams', operation: 'INSERT', newRow: { id: TEAM_B, name: 'B' } });
    const swap = event({
      tableName: 'swap_requests',
      operation: 'INSERT',
      newRow: { proposer_id: ANA, addressee_id: IVO, team_id: TEAM_A, return_team_id: TEAM_B },
    });

    const [first, second, third, fourth] = historyEntriesOf([roster, member, team, swap], CONTEXT);

    expect(first?.subjects).toEqual({ members: [ANA, IVO], teams: [TEAM_A], label: null });
    expect(second?.subjects.members).toEqual([IVO]);
    expect(third?.subjects).toEqual({ members: [], teams: [TEAM_B], label: { type: 'text', value: 'B' } });
    expect(fourth?.subjects).toEqual({ members: [ANA, IVO], teams: [TEAM_A, TEAM_B], label: null });
  });

  it('labels a shift type version by its shift type, a band by its name', () => {
    const version = event({ tableName: 'shift_type_versions', operation: 'INSERT', newRow: { shift_type_id: 's1' } });
    const band = event({ tableName: 'hour_bands', operation: 'INSERT', newRow: { name: 'Noć' } });

    expect(historyEntriesOf([version, band], CONTEXT).map((entry) => entry.subjects.label)).toEqual([
      { type: 'shift-type', id: 's1' },
      { type: 'text', value: 'Noć' },
    ]);
  });

  it('names a live decision through the request event of its transaction', () => {
    const request = event({
      tableName: 'leave_requests',
      operation: 'UPDATE',
      rowId: 'req-1',
      transactionId: '77',
      oldRow: { member_id: IVO, closed_at: null },
      newRow: { member_id: IVO, closed_at: 'x' },
    });
    const other = event({ tableName: 'leave_requests', operation: 'INSERT', rowId: 'req-1', transactionId: '70', newRow: { member_id: ANA } });
    const decision = event({
      tableName: 'leave_request_decisions',
      operation: 'INSERT',
      rowId: 'req-1',
      transactionId: '77',
      newRow: { request_id: 'req-1', outcome: 'approved' },
    });

    const entry = historyEntriesOf([decision, request, other], CONTEXT)[0];

    expect(entry?.kind).toEqual({ record: 'leave-request-decision', action: 'decided' });
    expect(entry?.subjects.members).toEqual([IVO]);
    expect(entry?.changes).toEqual([
      {
        field: 'outcome',
        column: 'outcome',
        before: { type: 'none' },
        after: { type: 'enum', field: 'outcome', value: 'approved' },
      },
    ]);
  });

  it('names a backfilled decision through a request event with its row id, the same instant first', () => {
    const earlier = event({
      tableName: 'swap_requests',
      operation: 'INSERT',
      rowId: 'swap-1',
      origin: 'backfill',
      transactionId: null,
      occurredAt: '2026-11-09T08:00:00+00:00',
      newRow: { proposer_id: ANA, addressee_id: IVO, team_id: TEAM_A },
    });
    const closed = event({
      tableName: 'swap_requests',
      operation: 'UPDATE',
      rowId: 'swap-1',
      origin: 'backfill',
      transactionId: null,
      occurredAt: '2026-11-10T08:00:00+00:00',
      oldRow: { proposer_id: ANA, addressee_id: IVO, team_id: TEAM_B, closed_at: null },
      newRow: { proposer_id: ANA, addressee_id: IVO, team_id: TEAM_B, closed_at: 'x' },
    });
    const decision = event({
      tableName: 'swap_request_decisions',
      operation: 'INSERT',
      rowId: 'swap-1',
      origin: 'backfill',
      transactionId: null,
      occurredAt: '2026-11-10T08:00:00+00:00',
      newRow: { request_id: 'swap-1', outcome: 'approved' },
    });

    const entry = historyEntriesOf([decision, closed, earlier], CONTEXT)[0];

    expect(entry?.subjects).toEqual({ members: [ANA, IVO], teams: [TEAM_B], label: null });
    expect(entry?.reconstructed).toBe(true);
  });

  it('leaves a decision whose request is not read without a subject, and still shows it', () => {
    const decision = event({
      tableName: 'leave_request_decisions',
      operation: 'INSERT',
      rowId: 'req-missing',
      newRow: { request_id: 'req-missing', outcome: 'rejected' },
    });

    expect(only([decision]).subjects).toEqual({ members: [], teams: [], label: null });
  });
});

describe('an amend is one entry', () => {
  const OLD_LEAVE = { id: 'l1', member_id: ANA, during: '[2026-11-02,2026-11-05)', absence_type_id: 'a1', half: null, removed_at: null };
  const NEW_LEAVE = { id: 'l2', member_id: ANA, during: '[2026-11-02,2026-11-07)', absence_type_id: 'a1', half: null, removed_at: null };

  it('pairs a live removal and insert of one transaction and member', () => {
    const removal = event({
      tableName: 'leave_records',
      operation: 'UPDATE',
      transactionId: '501',
      oldRow: OLD_LEAVE,
      newRow: { ...OLD_LEAVE, removed_at: 'x', removed_by: ANA_AUTH },
    });
    const insert = event({ tableName: 'leave_records', operation: 'INSERT', transactionId: '501', newRow: NEW_LEAVE });
    const entry = only([insert, removal]);

    expect(entry.kind).toEqual({ record: 'leave-record', action: 'amended' });
    expect(entry.eventIds).toEqual([removal.id, insert.id]);
    expect(entry.id).toBe(String(insert.id));
    expect(entry.reconstructed).toBe(false);
    expect(entry.changes).toEqual([
      {
        field: 'during',
        column: 'during',
        before: { type: 'range', from: '2026-11-02', to: '2026-11-04' },
        after: { type: 'range', from: '2026-11-02', to: '2026-11-06' },
      },
    ]);
  });

  it('pairs a pre-0061 amend: both backfilled, one table, one key, one instant — marked reconstructed', () => {
    const at = '2026-11-05T10:00:00.5+00:00';
    const removal = event({
      tableName: 'roster_overrides',
      operation: 'UPDATE',
      origin: 'backfill',
      transactionId: null,
      occurredAt: at,
      oldRow: { team_id: TEAM_A, date: '2026-11-12', member_in_id: IVO, removed_at: null },
      newRow: { team_id: TEAM_A, date: '2026-11-12', member_in_id: IVO, removed_at: at },
    });
    const insert = event({
      tableName: 'roster_overrides',
      operation: 'INSERT',
      origin: 'backfill',
      transactionId: null,
      occurredAt: at,
      newRow: { team_id: TEAM_A, date: '2026-11-12', member_in_id: ANA, removed_at: null },
    });
    const entry = only([insert, removal]);

    expect(entry.kind.action).toBe('amended');
    expect(entry.reconstructed).toBe(true);
    expect(entry.subjects.members).toEqual([IVO, ANA]);
  });

  it('pairs a loan amend (story 18.4) on the member, though its team and dates change; its record stays 18.5\'s', () => {
    const loan = { id: 'n1', member_id: ANA, team_id: TEAM_A, during: '[2026-11-10,2026-11-13)', reason: 'r', removed_at: null };
    const removal = event({
      tableName: 'team_loans',
      operation: 'UPDATE',
      transactionId: '777',
      oldRow: loan,
      newRow: { ...loan, removed_at: 'x', removed_by: ANA_AUTH },
    });
    const insert = event({
      tableName: 'team_loans',
      operation: 'INSERT',
      transactionId: '777',
      newRow: { ...loan, id: 'n2', team_id: TEAM_B, during: '[2026-11-10,2026-11-15)' },
    });
    const other = event({
      tableName: 'team_loans',
      operation: 'INSERT',
      transactionId: '777',
      newRow: { ...loan, id: 'n3', member_id: IVO },
    });
    const entries = historyEntriesOf([other, insert, removal], CONTEXT);
    const amended = entries.filter((entry) => entry.kind.action === 'amended');

    expect(amended.map((entry) => entry.eventIds)).toEqual([[removal.id, insert.id]]);
    expect(entries.map((entry) => entry.kind.action).sort()).toEqual(['added', 'amended']);
  });

  it('pairs several under one key in id order, and leaves an unmatched one its own entry', () => {
    const removals = [1, 2].map(() =>
      event({
        tableName: 'shift_type_overrides',
        operation: 'UPDATE',
        transactionId: '900',
        oldRow: { team_id: TEAM_A, date: '2026-11-12', shift_type_id: 's1', removed_at: null },
        newRow: { team_id: TEAM_A, date: '2026-11-12', shift_type_id: 's1', removed_at: 'x' },
      }),
    );
    const inserts = [1, 2, 3].map((index) =>
      event({
        tableName: 'shift_type_overrides',
        operation: 'INSERT',
        transactionId: '900',
        newRow: { team_id: TEAM_A, date: '2026-11-12', shift_type_id: `s${index + 1}`, removed_at: null },
      }),
    );
    const entries = historyEntriesOf(
      [...inserts, ...removals].sort((first, second) => second.id - first.id),
      CONTEXT,
    );

    expect(entries.map((entry) => entry.kind.action)).toEqual(['added', 'amended', 'amended']);
    expect(entries.filter((entry) => entry.kind.action === 'amended').map((entry) => entry.eventIds)).toEqual([
      [removals[1]?.id, inserts[1]?.id],
      [removals[0]?.id, inserts[0]?.id],
    ]);
  });

  it('never pairs across transactions, keys or a live and a backfilled event', () => {
    const removal = event({
      tableName: 'leave_records',
      operation: 'UPDATE',
      transactionId: '1',
      oldRow: OLD_LEAVE,
      newRow: { ...OLD_LEAVE, removed_at: 'x' },
    });
    const otherTransaction = event({ tableName: 'leave_records', operation: 'INSERT', transactionId: '2', newRow: NEW_LEAVE });
    const otherMember = event({ tableName: 'leave_records', operation: 'INSERT', transactionId: '1', newRow: { ...NEW_LEAVE, member_id: IVO } });

    expect(historyEntriesOf([otherMember, otherTransaction, removal], CONTEXT).map((entry) => entry.kind.action)).toEqual([
      'added',
      'added',
      'removed',
    ]);
  });

  it('never pairs a live removal with a backfilled insert of the same key and instant', () => {
    const at = '2026-11-05T10:00:00+00:00';
    const live = event({
      tableName: 'leave_records',
      operation: 'UPDATE',
      transactionId: '77',
      occurredAt: at,
      oldRow: OLD_LEAVE,
      newRow: { ...OLD_LEAVE, removed_at: at },
    });
    const backfilled = event({
      tableName: 'leave_records',
      operation: 'INSERT',
      origin: 'backfill',
      transactionId: null,
      occurredAt: at,
      newRow: NEW_LEAVE,
    });

    expect(historyEntriesOf([backfilled, live], CONTEXT).map((entry) => [entry.kind.action, entry.reconstructed])).toEqual([
      ['added', true],
      ['removed', false],
    ]);
  });
});

describe('the period', () => {
  it('ends the day choices on today, inclusive', () => {
    expect(historyPeriodOf('7-dana', '2026-11-16')).toEqual({ from: '2026-11-10', to: '2026-11-16' });
    expect(DEFAULT_HISTORY_PERIOD).toBe('30-dana');
    expect(historyPeriodOf(DEFAULT_HISTORY_PERIOD, '2026-03-01')).toEqual({ from: '2026-01-31', to: '2026-03-01' });
    expect(historyPeriodOf('90-dana', '2026-11-16')).toEqual({ from: '2026-08-19', to: '2026-11-16' });
    expect(historyPeriodOf('365-dana', '2026-11-16')).toEqual({ from: '2025-11-17', to: '2026-11-16' });
  });

  it('offers the twelve months ending with the current one, each whole', () => {
    const months = historyMonthChoicesOf('2026-02-10');

    expect(months).toHaveLength(12);
    expect(months[0]).toBe('2026-02');
    expect(months[11]).toBe('2025-03');
    expect(historyPeriodOf('2026-02', '2026-02-10')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(historyPeriodOf('2024-02', '2024-05-01')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
    expect(historyPeriodOf('2025-12', '2026-02-10')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(historyPeriodChoicesOf('2026-02-10')).toEqual(['7-dana', '30-dana', '90-dana', '365-dana', ...months]);
  });

  it('refuses any other choice, a month outside the twelve included', () => {
    for (const choice of ['', '7', '30', '14-dana', 'abc', '2025-02', '2026-03', '2026-13', '366']) {
      expect(historyPeriodOf(choice, '2026-02-10')).toBeNull();
    }
  });

  it('never exceeds 366 days', () => {
    for (const choice of historyPeriodChoicesOf('2028-12-31')) {
      const period = historyPeriodOf(choice, '2028-12-31');
      const days = period === null ? 0 : (Date.parse(period.to) - Date.parse(period.from)) / 86400000 + 1;

      expect(days).toBeGreaterThan(0);
      expect(days).toBeLessThanOrEqual(MAX_HISTORY_PERIOD_DAYS);
    }
  });

  it('pads the read window by a day before and two after, in UTC', () => {
    expect(historyReadWindowOf({ from: '2026-11-01', to: '2026-11-30' })).toEqual({
      from: '2026-10-31T00:00:00Z',
      to: '2026-12-02T00:00:00Z',
    });
  });

  it('drops the entries whose zone day falls outside the period', () => {
    const before = event({ tableName: 'teams', operation: 'INSERT', newRow: {}, day: '2026-10-31' });
    const inside = event({ tableName: 'teams', operation: 'INSERT', newRow: {}, day: '2026-11-30' });
    const after = event({ tableName: 'teams', operation: 'INSERT', newRow: {}, day: '2026-12-01' });

    expect(historyEntriesOf([after, inside, before], CONTEXT).map((entry) => entry.id)).toEqual([String(inside.id)]);
  });
});

describe('the filter', () => {
  const leave = event({ tableName: 'leave_records', operation: 'INSERT', newRow: { member_id: ANA } });
  const roster = event({
    tableName: 'roster_overrides',
    operation: 'INSERT',
    newRow: { team_id: TEAM_A, member_out_id: ANA, member_in_id: IVO },
  });
  const team = event({ tableName: 'teams', operation: 'UPDATE', oldRow: { id: TEAM_B, name: 'B' }, newRow: { id: TEAM_B, name: 'C' } });
  const entries = historyEntriesOf([team, roster, leave], CONTEXT);

  it('counts every member, team and kind the entries name', () => {
    expect(historyFilterOptionsOf(entries)).toEqual({
      members: [
        { id: ANA, count: 2 },
        { id: IVO, count: 1 },
      ],
      teams: [
        { id: TEAM_B, count: 1 },
        { id: TEAM_A, count: 1 },
      ],
      kinds: [
        { id: 'team:changed', count: 1 },
        { id: 'roster-override:added', count: 1 },
        { id: 'leave-record:added', count: 1 },
      ],
    });
  });

  it('keeps what every set chip keeps, in order', () => {
    const ids = (filters: Parameters<typeof filteredHistoryEntries>[1]) =>
      filteredHistoryEntries(entries, filters).map((entry) => entry.id);

    expect(ids({ member: null, team: null, kind: null })).toEqual(entries.map((entry) => entry.id));
    expect(ids({ member: ANA, team: null, kind: null })).toEqual([String(roster.id), String(leave.id)]);
    expect(ids({ member: ANA, team: TEAM_A, kind: null })).toEqual([String(roster.id)]);
    expect(ids({ member: ANA, team: null, kind: 'leave-record:added' })).toEqual([String(leave.id)]);
    expect(ids({ member: IVO, team: TEAM_B, kind: null })).toEqual([]);
  });
});

describe('where history begins', () => {
  const marker = event({
    tableName: 'organizations',
    operation: 'HISTORY_BEGINS',
    origin: 'backfill',
    transactionId: null,
    actor: null,
    sessionRole: 'postgres',
    occurredAt: '2026-11-16T03:00:00+00:00',
    day: '2026-11-16',
  });

  it('is the marker, a row of its own and never reconstructed', () => {
    const entry = only([marker], { ...CONTEXT, period: { from: '2026-11-01', to: '2026-11-30' } });

    expect(entry.kind).toEqual({ record: 'organization', action: 'history-begins' });
    expect(entry.reconstructed).toBe(false);
    expect(entry.author).toEqual({ kind: 'system' });
    expect(historyBeginsOf([marker], [])).toEqual({ occurredAt: marker.occurredAt, day: '2026-11-16', source: 'marker' });
  });

  it('else the organization insert, else the earliest entry read, else nowhere', () => {
    const created = event({ tableName: 'organizations', operation: 'INSERT', newRow: { id: ORG }, day: '2026-11-03' });
    const later = event({ tableName: 'teams', operation: 'INSERT', newRow: {}, day: '2026-11-09' });
    const earliest = event({ tableName: 'teams', operation: 'INSERT', newRow: {}, day: '2026-11-04' });
    const entries = historyEntriesOf([later, earliest], CONTEXT);

    expect(historyBeginsOf([created], entries)?.source).toBe('organization');
    expect(historyBeginsOf([], entries)).toEqual({ occurredAt: earliest.occurredAt, day: '2026-11-04', source: 'earliest' });
    expect(historyBeginsOf([], [])).toBeNull();
  });

  it('is stated when the period starts on or before its day', () => {
    const beginning = historyBeginsOf([marker], []);

    expect(historyReachesBeginning({ from: '2026-11-16', to: '2026-11-20' }, beginning)).toBe(true);
    expect(historyReachesBeginning({ from: '2026-11-17', to: '2026-11-20' }, beginning)).toBe(false);
    expect(historyReachesBeginning(PERIOD, null)).toBe(false);
  });

  it('is stated from the organization insert too, but never from the earliest entry read', () => {
    const created = event({ tableName: 'organizations', operation: 'INSERT', newRow: { id: ORG }, day: '2026-11-03' });
    const fromInsert = historyBeginsOf([created], []);
    const earliest = event({ tableName: 'teams', operation: 'INSERT', newRow: {}, day: '2026-11-04' });
    const fromEarliest = historyBeginsOf([], historyEntriesOf([earliest], CONTEXT));

    expect(historyReachesBeginning({ from: '2026-11-03', to: '2026-11-30' }, fromInsert)).toBe(true);
    expect(historyReachesBeginning({ from: '2026-11-04', to: '2026-11-30' }, fromInsert)).toBe(false);
    expect(fromEarliest?.source).toBe('earliest');
    expect(historyReachesBeginning({ from: '2026-01-01', to: '2026-11-30' }, fromEarliest)).toBe(false);
  });

  it('draws a live straggler dated before the marker as an ordinary entry', () => {
    const straggler = event({ tableName: 'teams', operation: 'INSERT', newRow: {}, occurredAt: '2026-11-16T02:59:59+00:00', day: '2026-11-16' });
    const entries = historyEntriesOf([marker, straggler], CONTEXT);

    expect(entries.map((entry) => [entry.kind.action, entry.reconstructed])).toEqual([
      ['history-begins', false],
      ['added', false],
    ]);
  });
});

describe('a decision whose request has no event read names it through the request as it stands (retro A3)', () => {
  function decision(rowId: string, tableName = 'leave_request_decisions'): AuditEvent {
    return event({ tableName, operation: 'INSERT', rowId, newRow: { request_id: rowId, outcome: 'rejected' } });
  }

  it('names the members and teams of the current request row', () => {
    const leave = decision('req-old');
    const swap = decision('swap-old', 'swap_request_decisions');
    const context: HistoryContext = {
      ...CONTEXT,
      requests: [
        { tableName: 'leave_requests', id: 'req-old', row: { id: 'req-old', member_id: ANA } },
        {
          tableName: 'swap_requests',
          id: 'swap-old',
          row: { id: 'swap-old', proposer_id: ANA, addressee_id: IVO, team_id: TEAM_A, return_team_id: null },
        },
      ],
    };
    const [first, second] = historyEntriesOf([leave, swap], context);

    expect(first?.subjects).toEqual({ members: [ANA], teams: [], label: null });
    expect(second?.subjects).toEqual({ members: [ANA, IVO], teams: [TEAM_A], label: null });
    expect(filteredHistoryEntries(historyEntriesOf([leave], context), { member: ANA, team: null, kind: null })).toHaveLength(1);
  });

  it('leaves it without a subject when the request row is gone, and still shows it', () => {
    expect(only([decision('req-gone')], { ...CONTEXT, requests: [] }).subjects).toEqual({
      members: [],
      teams: [],
      label: null,
    });
  });

  it('prefers a request event read over the current row', () => {
    const request = event({
      tableName: 'leave_requests',
      operation: 'UPDATE',
      rowId: 'req-1',
      transactionId: '91',
      oldRow: { member_id: IVO, closed_at: null },
      newRow: { member_id: IVO, closed_at: 'x' },
    });
    const live = event({
      tableName: 'leave_request_decisions',
      operation: 'INSERT',
      rowId: 'req-1',
      transactionId: '91',
      newRow: { request_id: 'req-1', outcome: 'approved' },
    });
    const context: HistoryContext = {
      ...CONTEXT,
      requests: [{ tableName: 'leave_requests', id: 'req-1', row: { id: 'req-1', member_id: ANA } }],
    };

    expect(historyEntriesOf([live, request], context)[0]?.subjects.members).toEqual([IVO]);
  });

  it('never takes a table named like a prototype key for a decision table', () => {
    const odd = event({ tableName: 'constructor', operation: 'INSERT', rowId: 'req-1', newRow: { member_id: ANA } });
    const context: HistoryContext = {
      ...CONTEXT,
      requests: [{ tableName: 'leave_requests', id: 'req-1', row: { id: 'req-1', member_id: IVO } }],
    };

    expect(historyUnmatchedRequestIdsOf([odd, event({ tableName: 'toString', operation: 'INSERT', rowId: 'x', newRow: {} })])).toEqual({
      leave_requests: [],
      swap_requests: [],
    });
    expect(only([odd], context)).toMatchObject({ kind: { record: 'other', action: 'added' }, subjects: { members: [ANA] } });
  });

  it('never reads a request from the other request table', () => {
    const context: HistoryContext = {
      ...CONTEXT,
      requests: [{ tableName: 'swap_requests', id: 'req-x', row: { id: 'req-x', proposer_id: ANA } }],
    };

    expect(only([decision('req-x')], context).subjects.members).toEqual([]);
  });

  it('names the unmatched request ids by table, deduped, and none when every decision is matched', () => {
    const request = event({ tableName: 'leave_requests', operation: 'INSERT', rowId: 'req-1', newRow: { member_id: ANA } });

    expect(
      historyUnmatchedRequestIdsOf([
        decision('req-1'),
        request,
        decision('req-2'),
        decision('req-2'),
        decision('swap-9', 'swap_request_decisions'),
        event({ tableName: 'teams', operation: 'INSERT', rowId: 'req-3', newRow: {} }),
      ]),
    ).toEqual({ leave_requests: ['req-2'], swap_requests: ['swap-9'] });
    expect(historyUnmatchedRequestIdsOf([decision('req-1'), request])).toEqual({ leave_requests: [], swap_requests: [] });
    expect(historyUnmatchedRequestIdsOf([])).toEqual({ leave_requests: [], swap_requests: [] });
  });
});

describe('every real change names a field (retro A4)', () => {
  const NOW = '2026-11-10T08:00:00+00:00';

  it('reads a row\'s lifecycle state from its lifecycle columns', () => {
    expect(historyStatusOf({ removed_at: null })).toBe('current');
    expect(historyStatusOf({ name: 'A' })).toBe('current');
    expect(historyStatusOf({ removed_at: NOW })).toBe('removed');
    expect(historyStatusOf({ confirmed_at: NOW, removed_at: null })).toBe('confirmed');
    expect(historyStatusOf({ closed_at: null })).toBe('open');
    expect(historyStatusOf({ closed_at: NOW })).toBe('closed');
    expect(historyStatusOf({ answered_at: NOW, closed_at: null })).toBe('answered');
    expect(historyStatusOf({ answered_at: NOW, closed_at: NOW })).toBe('closed');
  });

  it('draws a status-only update as a status line, first', () => {
    const removal = historyChangesOf(
      { member_id: ANA, removed_at: null, removed_by: null },
      { member_id: ANA, removed_at: NOW, removed_by: ANA_AUTH },
      'leave_records',
    );

    expect(removal).toEqual([
      {
        field: 'status',
        column: '$status',
        before: { type: 'enum', field: 'status', value: 'current' },
        after: { type: 'enum', field: 'status', value: 'removed' },
      },
    ]);

    const closed = historyChangesOf({ member_id: ANA, closed_at: null }, { member_id: ANA, closed_at: NOW });

    expect(closed.map((change) => [change.column, change.before, change.after])).toEqual([
      ['$status', { type: 'enum', field: 'status', value: 'open' }, { type: 'enum', field: 'status', value: 'closed' }],
    ]);

    const answered = historyChangesOf(
      { answer: null, answered_at: null, closed_at: null },
      { answer: 'accepted', answered_at: NOW, closed_at: null },
    );

    expect(answered.map((change) => change.column)).toEqual(['$status', 'answer']);
  });

  it('keys the derived status line apart from a real status column', () => {
    const changes = historyChangesOf(
      { status: 'draft', removed_at: null },
      { status: 'final', removed_at: NOW },
    );

    expect(changes.map((change) => [change.column, change.field])).toEqual([
      [HISTORY_STATUS_COLUMN, 'status'],
      ['status', null],
    ]);
    expect(new Set(changes.map((change) => change.column)).size).toBe(changes.length);
  });

  it('adds no status line to an insert, a delete or an amend pair', () => {
    const live = { member_id: ANA, removed_at: null };

    expect(historyChangesOf(null, live).some((change) => change.field === 'status')).toBe(false);
    expect(historyChangesOf(live, null).some((change) => change.field === 'status')).toBe(false);
    expect(historyChangesOf(live, { ...live, member_id: IVO }).some((change) => change.field === 'status')).toBe(false);
  });

  it('names a rotation assignment\'s pattern and step, and a resolution\'s and decision\'s overrides, by typed operand', () => {
    const insert = historyChangesOf(null, {
      id: 'ra1',
      team_id: TEAM_A,
      pattern_id: 'p1',
      offset_step_id: 's2',
      anchor_date: '2026-11-01',
      effective_from: '2026-11-01',
    });

    expect(insert.map((change) => [change.field, change.after])).toEqual([
      ['team', { type: 'team', id: TEAM_A }],
      ['rotationPattern', { type: 'rotation-pattern', id: 'p1' }],
      ['offsetStep', { type: 'rotation-step', id: 's2' }],
      ['effectiveFrom', { type: 'date', value: '2026-11-01' }],
      ['anchorDate', { type: 'date', value: '2026-11-01' }],
    ]);

    expect(
      historyChangesOf({ kind: 'replace_member', roster_override_id: 'o1' }, { kind: 'replace_member', roster_override_id: 'o2' }),
    ).toEqual([
      {
        field: 'rosterOverride',
        column: 'roster_override_id',
        before: { type: 'roster-override', id: 'o1' },
        after: { type: 'roster-override', id: 'o2' },
      },
    ]);
    expect(historyOperandOf('return_roster_override_id', 'o3')).toEqual({ type: 'roster-override', id: 'o3' });
  });

  it('draws a pattern insert as one pattern line from its own id', () => {
    const row = { organization_id: ORG, id: 'p1', created_by: ANA_AUTH, created_at: NOW };

    expect(historyChangesOf(null, row, 'rotation_patterns')).toEqual([
      { field: 'rotationPattern', column: 'id', before: { type: 'none' }, after: { type: 'rotation-pattern', id: 'p1' } },
    ]);
    expect(historyChangesOf(null, row, 'teams')).toEqual([]);
    expect(only([event({ tableName: 'rotation_patterns', operation: 'INSERT', newRow: row })]).changes).toHaveLength(1);
  });

  it('hides exactly the bookkeeping columns', () => {
    expect(new Set(HISTORY_HIDDEN_COLUMNS)).toEqual(
      new Set([
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
      ]),
    );
  });

  /** Every column of the 21 audited tables as 0002–0059 leave them, with a value of its type. */
  const AT = '2026-11-10T08:00:00+00:00';
  const BOOKKEEPING = { organization_id: ORG, created_by: ANA_AUTH, created_at: AT };
  const LIVE = { removed_by: null, removed_at: null };
  const AUDITED: Readonly<Record<string, AuditRow>> = {
    organizations: {
      id: ORG,
      slug: 'dvd',
      name: 'DVD',
      short_name: 'D',
      description: 'opis',
      address: 'adresa',
      contact_email: 'a@b.hr',
      organization_type: 'dvd',
      timezone: 'Europe/Zagreb',
      locale: 'hr',
      leave_year_start_month: 1,
      leave_year_start_day: 1,
      created_at: AT,
      brand_accent: 'blue',
      logo_path: 'logo.png',
      uses_fire_ranks: false,
      email_notifications: true,
      minimum_members: 2,
      carry_over_max_days: 5,
      carry_over_expiry_month: 6,
      carry_over_expiry_day: 30,
      carry_over_first_leave_year: 2026,
    },
    members: {
      organization_id: ORG,
      id: ANA,
      auth_user_id: ANA_AUTH,
      name: 'Ana',
      email: 'ana@b.hr',
      role: 'admin',
      leave_allowance_days: 20,
      created_at: AT,
      username: 'ana',
      fire_rank: 'vatrogasac',
    },
    member_status_versions: { ...BOOKKEEPING, id: 'v', member_id: ANA, active: true, effective_from: '2026-11-01' },
    team_membership_versions: {
      ...BOOKKEEPING,
      id: 'v',
      member_id: ANA,
      team_id: TEAM_A,
      effective_from: '2026-11-01',
      position: 'leader',
    },
    teams: { ...BOOKKEEPING, id: TEAM_A, name: 'A', archived: false },
    hour_bands: { organization_id: ORG, id: 'b', name: 'Noć', start_time: '22:00:00', created_at: AT },
    shift_types: { ...BOOKKEEPING, id: 's', name: 'Dan', is_working: true, archived: false },
    shift_type_versions: {
      ...BOOKKEEPING,
      id: 'v',
      shift_type_id: 's',
      start_time: '07:00:00',
      end_time: '19:00:00',
      effective_from: '2026-11-01',
    },
    rotation_patterns: { ...BOOKKEEPING, id: 'p' },
    rotation_steps: { ...BOOKKEEPING, id: 'st', pattern_id: 'p', position: 0, shift_type_id: 's' },
    rotation_assignments: {
      ...BOOKKEEPING,
      id: 'ra',
      team_id: TEAM_A,
      pattern_id: 'p',
      offset_step_id: 'st',
      anchor_date: '2026-11-01',
      effective_from: '2026-11-01',
    },
    shift_type_overrides: {
      ...BOOKKEEPING,
      ...LIVE,
      id: 'so',
      team_id: TEAM_A,
      date: '2026-11-12',
      shift_type_id: 's',
      reason: 'r',
      confirmed_by: null,
      confirmed_at: null,
    },
    roster_overrides: {
      ...BOOKKEEPING,
      ...LIVE,
      id: 'ro',
      team_id: TEAM_A,
      date: '2026-11-12',
      member_out_id: ANA,
      member_in_id: IVO,
      reason: 'r',
      confirmed_by: null,
      confirmed_at: null,
    },
    leave_records: {
      ...BOOKKEEPING,
      ...LIVE,
      id: 'l',
      member_id: ANA,
      during: '[2026-11-02,2026-11-05)',
      absence_type_id: 'a',
      half: null,
    },
    conflict_resolutions: {
      ...BOOKKEEPING,
      ...LIVE,
      id: 'c',
      member_id: ANA,
      date: '2026-11-12',
      team_id: TEAM_A,
      kind: 'replace_member',
      shift_type_id: null,
      roster_override_id: 'ro',
    },
    leave_requests: {
      ...BOOKKEEPING,
      id: 'r',
      member_id: ANA,
      during: '[2026-11-02,2026-11-05)',
      absence_type_id: 'a',
      half: null,
      closed_by: null,
      closed_at: null,
    },
    leave_request_decisions: {
      organization_id: ORG,
      request_id: 'r',
      outcome: 'approved',
      leave_record_id: 'l',
      decided_by: ANA_AUTH,
      decided_at: AT,
    },
    swap_requests: {
      ...BOOKKEEPING,
      id: 'sw',
      proposer_id: ANA,
      addressee_id: IVO,
      team_id: TEAM_A,
      date: '2026-11-12',
      return_team_id: TEAM_B,
      return_date: '2026-11-14',
      answer: null,
      answered_by: null,
      answered_at: null,
      closed_by: null,
      closed_at: null,
    },
    swap_request_decisions: {
      organization_id: ORG,
      request_id: 'sw',
      outcome: 'approved',
      roster_override_id: 'ro1',
      return_roster_override_id: 'ro2',
      decided_by: ANA_AUTH,
      decided_at: AT,
    },
    absence_types: { organization_id: ORG, id: 'a', name: 'Godišnji', draws_allowance: true, created_at: AT },
    leave_allowances: { ...BOOKKEEPING, id: 7, member_id: ANA, leave_year: 2026, days: 20 },
  };

  /** A different value of the same type. */
  function changed(value: unknown): unknown {
    if (value === null) return AT;
    if (typeof value === 'boolean') return !value;
    if (typeof value === 'number') return value + 1;
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return '2026-11-20';
    if (typeof value === 'string' && /^\d{2}:\d{2}:\d{2}$/.test(value)) return '08:30:00';
    if (typeof value === 'string' && value.startsWith('[')) return '[2026-11-03,2026-11-09)';

    return `${String(value)}-2`;
  }

  const LIFECYCLE_AT = new Set(['removed_at', 'confirmed_at', 'closed_at', 'answered_at']);

  it('covers the 21 audited tables', () => {
    expect(Object.keys(AUDITED).map((table) => historyRecordOf(table))).not.toContain(null);
    expect(new Set(Object.keys(AUDITED).map((table) => historyRecordOf(table)))).toEqual(
      new Set(HISTORY_RECORDS.filter((record) => record !== 'other')),
    );
  });

  const CASES = Object.entries(AUDITED).flatMap(([table, row]) =>
    Object.keys(row)
      .filter(
        (column) =>
          !HISTORY_HIDDEN_COLUMNS.has(column) ||
          LIFECYCLE_AT.has(column) ||
          (table === 'rotation_patterns' && column === 'id'),
      )
      .map((column) => [table, column] as const),
  );

  it.each(CASES)('draws an update of %s changing only %s as at least one change, no value a bare id', (table, column) => {
    const before = AUDITED[table] as AuditRow;
    const after = { ...before, [column]: changed(before[column]) };
    const entry = only([event({ tableName: table, operation: 'UPDATE', oldRow: before, newRow: after })]);

    expect(entry.changes.length).toBeGreaterThan(0);
    for (const change of entry.changes) {
      expect(change.field).not.toBeNull();
      for (const operand of [change.before, change.after]) expect(operand.type).not.toBe('raw');
    }
  });
});

describe('a departed member is named from their DELETE event read beside the period (retro A9)', () => {
  const GONE = 'member-gone';
  const GONE_AUTH = 'auth-gone';
  const goneDeleted = {
    tableName: 'members',
    oldRow: { id: GONE, auth_user_id: GONE_AUTH, name: 'Goran' },
    newRow: null,
  } as const;

  it('asks for the member ids and actors no members row of the read carries, once each', () => {
    const roster = event({
      tableName: 'roster_overrides',
      operation: 'INSERT',
      newRow: { team_id: TEAM_A, member_out_id: GONE, member_in_id: IVO, date: '2026-11-12' },
      actor: GONE_AUTH,
    });
    const swap = event({
      tableName: 'swap_requests',
      operation: 'UPDATE',
      oldRow: { proposer_id: GONE, addressee_id: ANA },
      newRow: { proposer_id: GONE, addressee_id: ANA },
      actor: ANA_AUTH,
    });
    const ivo = event({
      tableName: 'members',
      operation: 'UPDATE',
      oldRow: { id: IVO, auth_user_id: IVO_AUTH, name: 'I' },
      newRow: { id: IVO, auth_user_id: IVO_AUTH, name: 'Ivo' },
      actor: IVO_AUTH,
    });
    const system = event({ tableName: 'teams', operation: 'INSERT', newRow: {}, actor: null, sessionRole: 'postgres' });

    expect(historyUnnamedMembersOf([roster, swap, ivo, system])).toEqual({
      memberIds: [GONE, ANA],
      authUserIds: [GONE_AUTH, ANA_AUTH],
    });
  });

  it('asks for nobody when every name is in the read', () => {
    const ana = event({
      tableName: 'members',
      operation: 'INSERT',
      newRow: { id: ANA, auth_user_id: ANA_AUTH, name: 'Ana' },
    });
    const leave = event({ tableName: 'leave_records', operation: 'INSERT', newRow: { member_id: ANA } });

    expect(historyUnnamedMembersOf([leave, ana])).toEqual({ memberIds: [], authUserIds: [] });
  });

  it('names the author from the departed rows, not as departed', () => {
    const written = event({ tableName: 'teams', operation: 'INSERT', newRow: { name: 'A' }, actor: GONE_AUTH });

    expect(historyEntriesOf([written], CONTEXT)[0]?.author).toEqual({ kind: 'departed' });
    expect(historyEntriesOf([written], { ...CONTEXT, departed: [goneDeleted] })[0]?.author).toEqual({
      kind: 'member',
      memberId: GONE,
    });
  });

  it('never draws a departed row as an entry of its own', () => {
    const written = event({ tableName: 'teams', operation: 'INSERT', newRow: { name: 'A' }, actor: GONE_AUTH });

    expect(historyEntriesOf([written], { ...CONTEXT, departed: [goneDeleted] })).toHaveLength(1);
  });

  it('keeps the current list over a departed row for the same auth user', () => {
    const written = event({ tableName: 'teams', operation: 'INSERT', newRow: { name: 'A' }, actor: ANA_AUTH });
    const stale = { tableName: 'members', oldRow: { id: 'member-old', auth_user_id: ANA_AUTH, name: 'Old' }, newRow: null };

    expect(historyEntriesOf([written], { ...CONTEXT, departed: [stale] })[0]?.author).toEqual({
      kind: 'member',
      memberId: ANA,
    });
  });

  it("ranks a departed row below the read's own members rows, and the newest DELETE first among departed rows", () => {
    const rejoined = 'member-rejoined';
    const written = event({ tableName: 'teams', operation: 'INSERT', newRow: { name: 'A' }, actor: GONE_AUTH });
    // A rejoined auth user: the read holds their newer membership, the departed read an older one's DELETE.
    const joined = event({
      tableName: 'members',
      operation: 'INSERT',
      newRow: { id: rejoined, auth_user_id: GONE_AUTH, name: 'Goran novi' },
    });
    const older = { tableName: 'members', oldRow: { id: 'member-first', auth_user_id: GONE_AUTH, name: 'G' }, newRow: null };

    expect(historyEntriesOf([written, joined], { ...CONTEXT, departed: [goneDeleted] })[0]?.author).toEqual({
      kind: 'member',
      memberId: rejoined,
    });
    // Oldest first, as `readHistoryDeparted` returns them: the newest DELETE names the author.
    expect(historyEntriesOf([written], { ...CONTEXT, departed: [older, goneDeleted] })[0]?.author).toEqual({
      kind: 'member',
      memberId: GONE,
    });
  });
});
