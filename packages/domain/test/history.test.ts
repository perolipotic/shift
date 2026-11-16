import { describe, expect, it } from 'vitest';

import {
  DEFAULT_HISTORY_PERIOD,
  HISTORY_ACTIONS,
  HISTORY_FIELDS,
  HISTORY_RECORDS,
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
  type AuditEvent,
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
