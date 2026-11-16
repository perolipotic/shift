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
  historyChangeCount,
  historyNamesOf,
  historyOperandText,
  historyPeriodText,
  historyRecordMessageKey,
  historyRowsOf,
} from '@/features/history/services/history-rows';
import { initLocalization, t } from '@/lib/i18n';
import { formatIsoDate } from '@/lib/i18n/format';

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

describe('an operand never breaks the rows (story 14.2 review)', () => {
  it('draws PostgreSQL\'s 24:00:00 as the end of the day instead of throwing', () => {
    expect(historyOperandText({ type: 'time', minute: 1440 }, historyNamesOf([], LISTS))).toBe('24:00');
    expect(historyOperandText({ type: 'time', minute: 450 }, historyNamesOf([], LISTS))).toBe('07:30');
  });

  it('counts every entry but the start of history', () => {
    expect(
      historyChangeCount([
        { kind: { record: 'organization', action: 'history-begins' } },
        { kind: { record: 'team', action: 'changed' } },
        { kind: { record: 'leave-record', action: 'amended' } },
      ]),
    ).toBe(2);
  });
});

describe('every real change is drawn in words, never a bare id (epic 14 retro A3, A4)', () => {
  const STEPS = [
    event({ id: 20, tableName: 'rotation_patterns', operation: 'INSERT', rowId: 'p1', newRow: { id: 'p1' } }),
    event({
      id: 21,
      tableName: 'rotation_steps',
      operation: 'INSERT',
      newRow: { id: 'st0', pattern_id: 'p1', position: 0, shift_type_id: 's1' },
    }),
    event({
      id: 22,
      tableName: 'rotation_steps',
      operation: 'INSERT',
      newRow: { id: 'st1', pattern_id: 'p1', position: 1, shift_type_id: 's2' },
    }),
    event({
      id: 23,
      tableName: 'roster_overrides',
      operation: 'INSERT',
      newRow: { id: 'o1', team_id: 'a', date: '2026-11-12', member_out_id: 'ana', member_in_id: 'ivo', reason: 'r' },
    }),
    event({
      id: 24,
      tableName: 'roster_overrides',
      operation: 'INSERT',
      newRow: { id: 'o2', team_id: 'a', date: '2026-11-13', member_out_id: null, member_in_id: 'ivo', reason: 'r' },
    }),
    event({
      id: 25,
      tableName: 'roster_overrides',
      operation: 'INSERT',
      newRow: { id: 'o3', team_id: 'a', date: '2026-11-14', member_out_id: 'ana', member_in_id: null, reason: 'r' },
    }),
  ];
  const lists = {
    ...LISTS,
    members: [...LISTS.members, { id: 'ivo', name: 'Ivo Ivić' }],
    shiftTypes: [...LISTS.shiftTypes, { id: 's2', name: 'Noćna' }],
  };
  const names = historyNamesOf(STEPS, lists);

  function rowOf(subject: AuditEvent, held: readonly AuditEvent[] = STEPS) {
    const [row] = historyRowsOf(
      historyEntriesOf([subject], { period: PERIOD, members: [] }),
      historyNamesOf([subject, ...held], lists),
      ZONE,
    );

    return row;
  }

  it('names a step by its 1-based position and shift type, a pattern by its steps, an override by its day and people', () => {
    expect(historyOperandText({ type: 'rotation-step', id: 'st1' }, names)).toBe('Korak 2: Noćna');
    expect(historyOperandText({ type: 'rotation-pattern', id: 'p1' }, names)).toBe(
      t('history.value.rotationPattern', { count: 2, steps: 'Dnevna i Noćna' }),
    );
    expect(historyOperandText({ type: 'rotation-pattern', id: 'p1' }, names)).toMatch(/^2 koraka: /);
    expect(historyOperandText({ type: 'roster-override', id: 'o1' }, names)).toBe(
      t('history.value.rosterOverride', { date: formatIsoDate('2026-11-12'), memberIn: 'Ivo Ivić', memberOut: 'Ana Anić' }),
    );
    expect(historyOperandText({ type: 'roster-override', id: 'o2' }, names)).toBe(
      t('history.value.rosterOverrideIn', { date: formatIsoDate('2026-11-13'), memberIn: 'Ivo Ivić' }),
    );
    expect(historyOperandText({ type: 'roster-override', id: 'o2' }, names)).toBe(
      `${String(formatIsoDate('2026-11-13'))}: ulazi Ivo Ivić`,
    );
    expect(historyOperandText({ type: 'roster-override', id: 'o3' }, names)).toBe(
      `${String(formatIsoDate('2026-11-14'))}: izlazi Ana Anić`,
    );
    expect(historyOperandText({ type: 'roster-override', id: 'o1' }, names)).toBe(
      `${String(formatIsoDate('2026-11-12'))}: ulazi Ivo Ivić, izlazi Ana Anić`,
    );
  });

  it('says a neutral word for a step, pattern or override the read does not hold', () => {
    const empty = historyNamesOf([], LISTS);

    expect(historyOperandText({ type: 'rotation-step', id: 'gone' }, empty)).toBe(t('history.value.earlierStep'));
    expect(historyOperandText({ type: 'rotation-pattern', id: 'gone' }, empty)).toBe(t('history.value.earlierPattern'));
    expect(historyOperandText({ type: 'roster-override', id: 'gone' }, empty)).toBe(
      t('history.value.earlierRosterOverride'),
    );
  });

  it('draws an assignment insert with its pattern and offset lines', () => {
    const assignment = event({
      id: 30,
      tableName: 'rotation_assignments',
      operation: 'INSERT',
      newRow: { id: 'ra', team_id: 'a', pattern_id: 'p1', offset_step_id: 'st0', anchor_date: '2026-11-01', effective_from: '2026-11-01' },
    });
    const changes = rowOf(assignment)?.changes ?? [];

    expect(changes.map((change) => [change.field, change.after])).toEqual([
      [t('history.field.team'), 'Smjena A'],
      [t('history.field.rotationPattern'), t('history.value.rotationPattern', { count: 2, steps: 'Dnevna i Noćna' })],
      [t('history.field.offsetStep'), 'Korak 1: Dnevna'],
      [t('history.field.effectiveFrom'), formatIsoDate('2026-11-01')],
      [t('history.field.anchorDate'), formatIsoDate('2026-11-01')],
    ]);
  });

  it('draws a pattern insert as one pattern line, a step position from 1', () => {
    expect(rowOf(STEPS[0] as AuditEvent)?.changes).toEqual([
      {
        column: 'id',
        field: t('history.field.rotationPattern'),
        before: null,
        after: t('history.value.rotationPattern', { count: 2, steps: 'Dnevna i Noćna' }),
      },
    ]);
    const step = rowOf(STEPS[2] as AuditEvent)?.changes.find((change) => change.column === 'position');

    expect(step?.after).toBe('2');
    expect(step?.field).toBe(t('history.field.stepPosition'));
  });

  it('counts from 1 only a rotation step\'s position, never another record\'s number', () => {
    const membership = event({
      id: 33,
      tableName: 'team_membership_versions',
      operation: 'INSERT',
      newRow: { id: 'v', member_id: 'ana', team_id: 'a', position: 3 },
    });
    const position = rowOf(membership)?.changes.find((change) => change.column === 'position');

    expect(position?.after).toBe('3');
    expect(position?.field).toBe(t('history.field.position'));
  });

  it('draws a relinked resolution as an override line, before and after', () => {
    const relinked = event({
      id: 31,
      tableName: 'conflict_resolutions',
      operation: 'UPDATE',
      oldRow: { id: 'c', member_id: 'ana', kind: 'replace_member', roster_override_id: 'o1', removed_at: null },
      newRow: { id: 'c', member_id: 'ana', kind: 'replace_member', roster_override_id: 'o2', removed_at: null },
    });

    expect(rowOf(relinked)?.changes).toEqual([
      {
        column: 'roster_override_id',
        field: t('history.field.rosterOverride'),
        before: historyOperandText({ type: 'roster-override', id: 'o1' }, names),
        after: historyOperandText({ type: 'roster-override', id: 'o2' }, names),
      },
    ]);
  });

  it('draws a status-only update as Stanje, before and after', () => {
    const removed = event({
      id: 32,
      tableName: 'leave_records',
      operation: 'UPDATE',
      oldRow: { id: 'l', member_id: 'ana', removed_at: null, removed_by: null },
      newRow: { id: 'l', member_id: 'ana', removed_at: '2026-11-10T08:00:00+00:00', removed_by: 'auth-ana' },
    });

    expect(rowOf(removed)?.changes).toEqual([
      {
        column: '$status',
        field: t('history.field.status'),
        before: t('history.enum.statusCurrent'),
        after: t('history.enum.statusRemoved'),
      },
    ]);
  });

  it('marks two sides that differ but read alike as the earlier and the new value', () => {
    const repatterned = event({
      id: 34,
      tableName: 'rotation_assignments',
      operation: 'UPDATE',
      oldRow: { id: 'ra', team_id: 'a', pattern_id: 'gone-1' },
      newRow: { id: 'ra', team_id: 'a', pattern_id: 'gone-2' },
    });
    const [change] = rowOf(repatterned, [])?.changes ?? [];
    const earlier = t('history.value.earlierPattern');

    expect(change).toEqual({
      column: 'pattern_id',
      field: t('history.field.rotationPattern'),
      before: t('history.value.differsBefore', { value: earlier }),
      after: t('history.value.differsAfter', { value: earlier }),
    });
    expect(change?.before).not.toBe(change?.after);
  });

  it('words every status', () => {
    for (const status of ['current', 'open', 'confirmed', 'answered', 'closed', 'removed']) {
      const key = historyEnumMessageKey('status', status);

      expect(key).not.toBeNull();
      expect(t(key ?? 'history.value.yes')).not.toBe(key);
    }
  });

  it('names a decision whose request has no event read through the request as it stands', () => {
    const decision = event({
      id: 40,
      tableName: 'leave_request_decisions',
      operation: 'INSERT',
      rowId: 'req-old',
      newRow: { request_id: 'req-old', outcome: 'rejected' },
    });
    const [row] = historyRowsOf(
      historyEntriesOf([decision], {
        period: PERIOD,
        members: [],
        requests: [{ tableName: 'leave_requests', id: 'req-old', row: { id: 'req-old', member_id: 'ana' } }],
      }),
      names,
      ZONE,
    );

    expect(row?.subject).toBe('Ana Anić');
  });
});
