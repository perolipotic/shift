import {
  HISTORY_ACTIONS,
  HISTORY_FIELDS,
  HISTORY_RECORDS,
  historyEntriesOf,
  type AuditEvent,
} from '@shift/domain';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  historyActionMessageKey,
  historyAuthorMessageKey,
  historyBeginsMessageKey,
  historyBeginsViewOf,
  historyEnumMessageKey,
  historyEventsInZone,
  historyFieldMessageKey,
  historyKindOptionsOf,
  historyMemberOptionsOf,
  historyNamesOf,
  historyPeriodText,
  historyRecordMessageKey,
  historyRowsOf,
} from '@/features/history/services/history-rows';
import { initLocalization, t } from '@/lib/i18n';

const ZONE = 'Europe/Zagreb';
const PERIOD = { from: '2026-11-01', to: '2026-11-30' };

function event(overrides: Partial<AuditEvent> & Pick<AuditEvent, 'id' | 'tableName' | 'operation'>): AuditEvent {
  return {
    rowId: 'r',
    oldRow: null,
    newRow: null,
    actor: 'auth-ana',
    sessionRole: 'authenticated',
    origin: 'trigger',
    transactionId: String(overrides.id),
    occurredAt: '2026-11-10T08:05:00.123456+00:00',
    day: '2026-11-10',
    ...overrides,
  };
}

const LISTS = {
  members: [{ id: 'ana', name: 'Ana Anić' }],
  teams: [{ id: 'a', name: 'Smjena A' }],
  shiftTypes: [{ id: 's1', name: 'Dnevna' }],
  absenceTypes: [{ id: 'g', name: 'Godišnji odmor' }],
};

beforeAll(async () => {
  await initLocalization();
});

describe('every code has its words', () => {
  it('maps every record, action and field to a distinct key the resource file holds', () => {
    const keys = [
      HISTORY_RECORDS.map(historyRecordMessageKey),
      HISTORY_ACTIONS.map(historyActionMessageKey),
      HISTORY_FIELDS.map(historyFieldMessageKey),
    ];

    expect(keys.map((list) => new Set(list).size)).toEqual([
      HISTORY_RECORDS.length,
      HISTORY_ACTIONS.length,
      HISTORY_FIELDS.length,
    ]);
    for (const key of keys.flat()) expect(t(key), key).not.toBe(key);
  });

  it('words every enum value a migration allows, and leaves an unknown one to be drawn as stored', () => {
    expect(historyEnumMessageKey('role', 'member_role')).toBe('history.enum.roleMember');
    expect(historyEnumMessageKey('outcome', 'deactivated')).toBe('history.enum.outcomeDeactivated');
    expect(historyEnumMessageKey('half', 'SECOND')).toBe('history.enum.halfSecond');
    expect(historyEnumMessageKey('kind', 'amend_leave')).toBe('history.enum.kindAmendLeave');
    expect(historyEnumMessageKey('answer', 'maybe')).toBeNull();
    expect(historyEnumMessageKey('role', 'toString')).toBeNull();
    expect(historyAuthorMessageKey('service')).toBe('history.author.service');
  });

  it('says the period choices', () => {
    expect(historyPeriodText('30-dana')).toBe('zadnjih 30 dana');
    expect(historyPeriodText('7-dana')).toBe('zadnjih 7 dana');
    expect(historyPeriodText('2026-11')).toMatch(/2026\.$/);
  });
});

describe('each event is read on its organization day', () => {
  it('dates an instant by the zone, keeping the raw string', () => {
    const [late] = historyEventsInZone([{ occurredAt: '2026-10-31T23:30:00.123456Z', id: 1 }], ZONE);

    expect(late).toEqual({ occurredAt: '2026-10-31T23:30:00.123456Z', id: 1, day: '2026-11-01' });
    expect(historyEventsInZone([{ occurredAt: '2026-10-31T22:59:00+00:00' }], ZONE)[0]?.day).toBe('2026-10-31');
  });
});

describe('the start of history and a table this build does not know', () => {
  it('draws the marker as a row of its own, named as the start of history', () => {
    const marker = event({
      id: 9,
      tableName: 'organizations',
      operation: 'HISTORY_BEGINS',
      origin: 'backfill',
      transactionId: null,
      actor: null,
      sessionRole: 'postgres',
    });
    const [row] = historyRowsOf(
      historyEntriesOf([marker], { period: PERIOD, members: [] }),
      historyNamesOf([], LISTS),
      ZONE,
    );

    expect(row?.marker).toBe(true);
    expect(row?.reconstructed).toBe(false);
    expect(row?.subject).toBe(t('history.markerSubject'));
    expect(row?.kind).toBe(`${t('history.record.organization')} · ${t('history.action.historyBegins')}`);
    expect(row?.changes).toEqual([]);
  });

  it('draws an unknown table as a Zapis with its raw column and value', () => {
    const later = event({ id: 10, tableName: 'audited_later', operation: 'INSERT', newRow: { id: 'x', colour: 'red' } });
    const [row] = historyRowsOf(
      historyEntriesOf([later], { period: PERIOD, members: [] }),
      historyNamesOf([], LISTS),
      ZONE,
    );

    expect(row?.kind).toBe(`${t('history.record.other')} · ${t('history.action.added')}`);
    expect(row?.subject).toBe(t('history.record.other'));
    expect(row?.changes).toEqual([{ column: 'colour', field: 'colour', before: null, after: '"red"' }]);
  });
});

describe('where history begins is stated only when true', () => {
  const at = '2026-11-16T03:00:00+00:00';

  it('states the marker, and the organization insert in its own words, when the period reaches them', () => {
    const period = { from: '2026-11-01', to: '2026-11-30' };
    const marker = historyBeginsViewOf({ occurredAt: at, day: '2026-11-16', source: 'marker' }, period, ZONE);
    const created = historyBeginsViewOf({ occurredAt: at, day: '2026-11-16', source: 'organization' }, period, ZONE);

    expect(marker).toEqual({ source: 'marker', date: expect.stringContaining('2026') as string, time: '04:00' });
    expect(created?.source).toBe('organization');
    expect(historyBeginsMessageKey('marker')).toBe('history.begins');
    expect(historyBeginsMessageKey('organization')).toBe('history.beginsOrganization');
    expect(t('history.beginsOrganization')).not.toContain('ne mogu se vratiti');
  });

  it('states nothing on a short period that does not reach the beginning', () => {
    expect(
      historyBeginsViewOf({ occurredAt: at, day: '2026-11-16', source: 'marker' }, { from: '2026-11-17', to: '2026-11-20' }, ZONE),
    ).toBeNull();
  });

  it('states nothing from the earliest entry read, whatever the period', () => {
    expect(
      historyBeginsViewOf({ occurredAt: at, day: '2026-11-16', source: 'earliest' }, { from: '2025-01-01', to: '2026-11-30' }, ZONE),
    ).toBeNull();
    expect(historyBeginsViewOf(null, { from: '2025-01-01', to: '2026-11-30' }, ZONE)).toBeNull();
  });
});

describe('the rows the table draws and 14.3 prints', () => {
  const memberDeleted = event({
    id: 1,
    tableName: 'members',
    operation: 'DELETE',
    oldRow: { id: 'ivo', auth_user_id: 'auth-ivo', name: 'Ivo Ivić' },
    actor: null,
    sessionRole: 'postgres',
  });
  const leave = event({
    id: 2,
    tableName: 'leave_records',
    operation: 'INSERT',
    newRow: { id: 'l', member_id: 'ivo', during: '[2026-11-02,2026-11-05)', absence_type_id: 'g', half: 'FIRST' },
    actor: 'auth-ivo',
  });
  const team = event({
    id: 3,
    tableName: 'teams',
    operation: 'UPDATE',
    oldRow: { id: 'a', name: 'Stara', archived: false },
    newRow: { id: 'a', name: 'Smjena A', archived: false },
    origin: 'backfill',
    transactionId: null,
  });
  const version = event({
    id: 4,
    tableName: 'shift_type_versions',
    operation: 'DELETE',
    oldRow: { id: 'v', shift_type_id: 's1', start_time: '07:00:00', end_time: '19:00:00' },
    actor: 'auth-gone',
  });
  const events = [version, team, leave, memberDeleted];
  const names = historyNamesOf(events, LISTS);
  const entries = historyEntriesOf(events, { period: PERIOD, members: [{ id: 'ana', authUserId: 'auth-ana' }] });
  let rows: ReturnType<typeof historyRowsOf> = [];

  beforeAll(() => {
    rows = historyRowsOf(entries, names, ZONE);
  });

  it('draws one row per entry, in order, the time in the organization zone', () => {
    expect(rows.map((row) => row.id)).toEqual(['4', '3', '2', '1']);
    expect(rows[0]?.time).toContain('09:05');
  });

  it('names a departed member from the rows history holds, and an unknown author as departed', () => {
    expect(rows[2]?.author).toBe('Ivo Ivić');
    expect(rows[2]?.subject).toBe('Ivo Ivić');
    expect(rows[3]?.author).toBe(t('history.author.system'));
    expect(rows[0]?.author).toBe(t('history.author.departed'));
  });

  it('says the kind as record · action, and marks the backfilled row reconstructed', () => {
    expect(rows[1]?.kind).toBe(`${t('history.record.team')} · ${t('history.action.changed')}`);
    expect(rows[1]?.reconstructed).toBe(true);
    expect(rows[0]?.reconstructed).toBe(false);
  });

  it('words every operand: a range, a type, an enum, a time; an addition has no bilo, a deletion no sada', () => {
    expect(rows[2]?.changes.map((change) => change.field)).toEqual([
      t('history.field.member'),
      t('history.field.during'),
      t('history.field.half'),
      t('history.field.absenceType'),
    ]);
    expect(rows[2]?.changes.map((change) => change.before)).toEqual([null, null, null, null]);
    expect(rows[2]?.changes[0]?.after).toBe('Ivo Ivić');
    expect(rows[2]?.changes[1]?.after).toMatch(/^02\.\s?11\.\s?2026\.? – 04\.\s?11\.\s?2026\.?$/);
    expect(rows[2]?.changes[2]?.after).toBe(t('history.enum.halfFirst'));
    expect(rows[2]?.changes[3]?.after).toBe('Godišnji odmor');
    expect(rows[0]?.subject).toBe('Dnevna');
    expect(rows[0]?.changes.map((change) => [change.before, change.after])).toEqual([
      ['Dnevna', null],
      ['07:00', null],
      ['19:00', null],
    ]);
    expect(rows[1]?.changes).toEqual([{ column: 'name', field: t('history.field.name'), before: 'Stara', after: 'Smjena A' }]);
  });

  it('offers the members by name and the kinds in words', () => {
    expect(historyMemberOptionsOf([{ id: 'zz', count: 1 }, { id: 'ana', count: 2 }], names).map((option) => option.label)).toEqual([
      'Ana Anić',
      t('history.value.unknownMember'),
    ]);
    expect(historyKindOptionsOf([{ id: 'leave-record:added', count: 1 }])[0]?.label).toBe(
      `${t('history.record.leaveRecord')} · ${t('history.action.added')}`,
    );
  });
});
