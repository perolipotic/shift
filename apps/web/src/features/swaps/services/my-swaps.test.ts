import { beforeAll, describe, expect, it, vi } from 'vitest';

import { readCalendar, type CalendarSnapshot } from '@/features/calendar/services/snapshot';
import {
  PILOT,
  SEEDED,
  VIEWER_MEMBER,
  VIEWER_NAME,
  calendarMemberRow,
  calendarOrganizationRow,
  calendarRosterOverrideRow,
  calendarTableOf,
  memberMembershipRow,
  membersAnswerOf,
  membershipRow,
  overridesAnswerOf,
  rosterOverridesAnswerOf,
  viewerRow,
  viewerSession,
} from '@/features/rotation/rotation.fixture';
import {
  ANSWER_SWAP_REQUEST_FUNCTION,
  DECISIONS_EMBED,
  MY_SWAPS_UNAVAILABLE,
  MY_SWAP_REQUESTS_COLUMNS,
  MY_SWAP_REQUESTS_KEY,
  SWAP_ACCEPT,
  SWAP_ACCEPTED,
  SWAP_ACT_DENIED,
  SWAP_ACT_FAILED,
  SWAP_APPROVED,
  SWAP_DEACTIVATED,
  SWAP_DECLINE,
  SWAP_DECLINED,
  SWAP_NOT_OPEN,
  SWAP_PROPOSED,
  SWAP_REJECTED,
  SWAP_WITHDRAW,
  SWAP_WITHDRAWN,
  SWAP_WORD_WAITING_COLLEAGUE,
  SWAP_WORD_WAITING_DECISION,
  SWAP_WORD_WAITING_YOU,
  WITHDRAW_SWAP_REQUEST_FUNCTION,
  actOnSwapRequest,
  mySwapRequestsQueryOptions,
  mySwapRowsOf,
  mySwapsFilterOf,
  mySwapsOf,
  openSwapProposalsOf,
  readMySwapRows,
  swapActFailureMessageKey,
  swapActFailureOf,
  swapActedMessageKey,
  swapStaleOf,
  swapStatusOf,
  swapWordMessageKey,
  swapWordOf,
  type MySwap,
  type MySwapsTable,
  type SwapActFailure,
  type SwapAction,
  type SwapRequestRpc,
  type SwapWord,
} from '@/features/swaps/services/my-swaps';
import { initLocalization, t } from '@/lib/i18n';

/**
 * Story 12.3's rules, executed (AD-15): the spec's I/O matrix over the pilot,
 * on 12.2's terms. The rotation is Dan, Noć, Slobodno, Slobodno, and Smjena B
 * runs one step ahead of A. On 2026-09-10 A works Dan (the viewer and Karlo
 * on it) and B works Noć (Ana, Dino, Eva and Ivo); C (Luka, Mara) is off.
 * B works Dan on 2026-09-13 and 2026-10-03, when the viewer is off.
 */

type Row = Record<string, unknown>;

const DATE = '2026-09-10';
const TODAY = '2026-09-08';
const TWELVE_HOURS = 12 * 60;

const ANA = '00000000-0000-4000-8000-0000000000e1';
const DINO = '00000000-0000-4000-8000-0000000000e2';
const EVA = '00000000-0000-4000-8000-0000000000e3';
const IVO = '00000000-0000-4000-8000-0000000000e4';
const KARLO = '00000000-0000-4000-8000-0000000000e5';
const LUKA = '00000000-0000-4000-8000-0000000000e6';
const MARA = '00000000-0000-4000-8000-0000000000e7';

function idOf(rows: readonly Row[], index: number): string {
  const id = rows[index]?.['id'];

  if (typeof id !== 'string') throw new Error(`no row ${String(index)}`);

  return id;
}

const A = idOf(PILOT.teams, 0);
const B = idOf(PILOT.teams, 1);
const C = idOf(PILOT.teams, 2);

async function snapshotOf(
  { rosterOverrides = [] }: { readonly rosterOverrides?: readonly Row[] } = {},
): Promise<CalendarSnapshot> {
  const source = calendarTableOf(
    {
      data: [
        calendarOrganizationRow(PILOT, {
          viewers: [viewerRow([membershipRow(A, SEEDED)], { role: 'member_role' })],
          versions: [
            memberMembershipRow(VIEWER_MEMBER, A, SEEDED),
            memberMembershipRow(KARLO, A, SEEDED),
            memberMembershipRow(ANA, B, SEEDED),
            memberMembershipRow(DINO, B, SEEDED),
            memberMembershipRow(EVA, B, SEEDED),
            memberMembershipRow(IVO, B, SEEDED),
            memberMembershipRow(LUKA, C, SEEDED),
            memberMembershipRow(MARA, C, SEEDED),
          ],
          statuses: [],
        }),
      ],
      error: null,
      count: 1,
    },
    membersAnswerOf([
      calendarMemberRow(VIEWER_MEMBER, VIEWER_NAME),
      calendarMemberRow(ANA, 'Ana Babić'),
      calendarMemberRow(DINO, 'Dino Grgić'),
      calendarMemberRow(EVA, 'Eva Šarić'),
      calendarMemberRow(IVO, 'Ivo Horvat'),
      calendarMemberRow(KARLO, 'Karlo Jelić'),
      calendarMemberRow(LUKA, 'Luka Perić'),
      calendarMemberRow(MARA, 'Mara Kovač'),
    ]),
    overridesAnswerOf([]),
    rosterOverridesAnswerOf(rosterOverrides),
  );
  const outcome = await readCalendar(source, source, viewerSession());

  if (!outcome.ok) throw new Error(outcome.code);

  return outcome.snapshot;
}

/** One row as the read answers it, open and unanswered unless told otherwise. */
function rowOf(overrides: Row = {}): Row {
  return {
    id: 'swap-1',
    proposer_id: IVO,
    addressee_id: VIEWER_MEMBER,
    team_id: B,
    date: '2026-09-13',
    return_team_id: null,
    return_date: null,
    answer: null,
    closed_at: null,
    [DECISIONS_EMBED]: [],
    ...overrides,
  };
}

function swapsOf(rows: readonly Row[]): readonly MySwap[] {
  const swaps = mySwapsOf(rows, VIEWER_MEMBER);

  if (swaps === null) throw new Error('rows not trusted');

  return swaps;
}

const CLOSED = '2026-09-07T10:00:00Z';

let snapshot: CalendarSnapshot;

beforeAll(async () => {
  await initLocalization();
  snapshot = await snapshotOf();
});

describe('the read (story 12.3)', () => {
  it('selects the swap with its decision, filtered to the viewer on either side', async () => {
    const or = vi.fn(async () => ({ data: [rowOf()], error: null }));
    const select = vi.fn(() => ({ or }));

    const outcome = await readMySwapRows({ select } as unknown as MySwapsTable, VIEWER_MEMBER);

    expect(outcome).toEqual({ ok: true, rows: [rowOf()] });
    expect(select).toHaveBeenCalledWith(MY_SWAP_REQUESTS_COLUMNS);
    expect(MY_SWAP_REQUESTS_COLUMNS).toContain(`${DECISIONS_EMBED}(outcome)`);
    expect(or).toHaveBeenCalledWith(`proposer_id.eq.${VIEWER_MEMBER},addressee_id.eq.${VIEWER_MEMBER}`);
    expect(mySwapsFilterOf(VIEWER_MEMBER)).toBe(`proposer_id.eq.${VIEWER_MEMBER},addressee_id.eq.${VIEWER_MEMBER}`);
  });

  it('is unavailable on an error, a throw, something that is not rows, or a member id it will not interpolate', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const answering = (answer: unknown): MySwapsTable =>
      ({ select: () => ({ or: async () => answer }) }) as unknown as MySwapsTable;
    const unavailable = { ok: false, code: MY_SWAPS_UNAVAILABLE };

    expect(await readMySwapRows(answering({ data: null, error: { code: '42501' } }), VIEWER_MEMBER)).toEqual(unavailable);
    expect(await readMySwapRows(answering({ data: {}, error: null }), VIEWER_MEMBER)).toEqual(unavailable);
    expect(await readMySwapRows(answering('nope'), VIEWER_MEMBER)).toEqual(unavailable);
    expect(
      await readMySwapRows(
        {
          select: () => ({
            or: async () => {
              throw new Error('network');
            },
          }),
        } as unknown as MySwapsTable,
        VIEWER_MEMBER,
      ),
    ).toEqual(unavailable);

    const select = vi.fn();

    expect(await readMySwapRows({ select } as unknown as MySwapsTable, 'x,addressee_id.neq.y')).toEqual(unavailable);
    expect(select).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it('is read under its one key, waiting for the viewer', async () => {
    const options = mySwapRequestsQueryOptions(() => ({}) as MySwapsTable, null);

    expect(options.queryKey).toEqual(MY_SWAP_REQUESTS_KEY);
    expect(options.enabled).toBe(false);
    expect(mySwapRequestsQueryOptions(() => ({}) as MySwapsTable, VIEWER_MEMBER).enabled).toBe(true);
  });
});

describe('the status, derived as 0049 stores it', () => {
  it.each([
    ['open, no answer', null, null, [], SWAP_PROPOSED],
    ['open, accepted', null, 'accepted', [], SWAP_ACCEPTED],
    ['closed, declined', CLOSED, 'declined', [], SWAP_DECLINED],
    ['closed, no decision', CLOSED, null, [], SWAP_WITHDRAWN],
    ['closed after accepting, no decision', CLOSED, 'accepted', [], SWAP_WITHDRAWN],
    ['approved', CLOSED, 'accepted', [{ outcome: 'approved' }], SWAP_APPROVED],
    ['rejected', CLOSED, 'accepted', { outcome: 'rejected' }, SWAP_REJECTED],
    ['closed on deactivation', CLOSED, null, [{ outcome: 'deactivated' }], SWAP_DEACTIVATED],
    ['closed on deactivation after accepting', CLOSED, 'accepted', [{ outcome: 'deactivated' }], SWAP_DEACTIVATED],
  ])('%s', (_name, closedAt, answer, decisions, status) => {
    expect(swapStatusOf(closedAt, answer, decisions)).toBe(status);
  });

  it.each([
    ['open and declined', null, 'declined', []],
    ['approved, never accepted', CLOSED, null, [{ outcome: 'approved' }]],
    ['rejected, never accepted', CLOSED, null, [{ outcome: 'rejected' }]],
    ['approved after a decline', CLOSED, 'declined', [{ outcome: 'approved' }]],
    ['rejected after a decline', CLOSED, 'declined', [{ outcome: 'rejected' }]],
    ['closed on deactivation after a decline', CLOSED, 'declined', [{ outcome: 'deactivated' }]],
    ['open with a decision', null, 'accepted', [{ outcome: 'approved' }]],
    ['an unknown answer', null, 'maybe', []],
    ['an unknown outcome', CLOSED, 'accepted', [{ outcome: 'sure' }]],
    ['two decisions', CLOSED, 'accepted', [{ outcome: 'approved' }, { outcome: 'rejected' }]],
    ['a blank close', '', null, []],
  ])('cannot say: %s', (_name, closedAt, answer, decisions) => {
    expect(swapStatusOf(closedAt, answer, decisions)).toBeNull();
  });

  it('says one word per state, by side', () => {
    expect(swapWordOf(SWAP_PROPOSED, true)).toBe(SWAP_WORD_WAITING_YOU);
    expect(swapWordOf(SWAP_PROPOSED, false)).toBe(SWAP_WORD_WAITING_COLLEAGUE);
    expect(swapWordOf(SWAP_ACCEPTED, true)).toBe(SWAP_WORD_WAITING_DECISION);
    expect(swapWordOf(SWAP_ACCEPTED, false)).toBe(SWAP_WORD_WAITING_DECISION);

    const words: Record<SwapWord, string> = {
      waitingYou: 'Čeka tvoj odgovor',
      waitingColleague: 'Čeka odgovor kolege',
      waitingDecision: 'Čeka odluku',
      declined: 'Odbijena',
      withdrawn: 'Povučena',
      approved: 'Odobrena',
      rejected: 'Nije odobrena',
      deactivated: 'Zatvorena deaktivacijom',
    };

    for (const [word, text] of Object.entries(words)) {
      expect(t(swapWordMessageKey(word as SwapWord))).toBe(text);
    }
  });
});

describe('the rows the read answered', () => {
  it('drops, and logs, each row it cannot trust, and keeps the rest', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const kept = rowOf({ id: 'kept' });
    const ids = (rows: readonly unknown[]) => mySwapsOf(rows, VIEWER_MEMBER)?.map((swap) => swap.id);

    expect(ids([kept, rowOf({ id: 'kept', date: '2026-10-03' })]), 'a second row with one id').toEqual(['kept']);
    expect(ids([kept, rowOf({ id: 'other', proposer_id: ANA, addressee_id: IVO })]), 'neither side the viewer').toEqual(['kept']);
    expect(ids([rowOf({ id: 'half', return_team_id: A }), kept]), 'a half-named return').toEqual(['kept']);
    expect(ids([rowOf({ id: 'date', date: '13.09.2026' }), kept]), 'a date that is not one').toEqual(['kept']);
    expect(ids([rowOf({ id: 'open-declined', answer: 'declined' }), kept]), 'open and declined').toEqual(['kept']);
    expect(ids([rowOf({ id: 'both', addressee_id: IVO }), kept]), 'one member on both sides').toEqual(['kept']);
    expect(ids(['row', kept])).toEqual(['kept']);
    expect(ids([])).toEqual([]);
    // Only an answer that is no list at all is no answer.
    expect(mySwapsOf({ rows: [] }, VIEWER_MEMBER)).toBeNull();
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });

  it('drops a decision 0049 cannot write — an approval or rejection never accepted, a close after a decline — and keeps the rest', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const rows = [
      rowOf({ id: 'approved-unanswered', closed_at: CLOSED, [DECISIONS_EMBED]: [{ outcome: 'approved' }] }),
      rowOf({ id: 'rejected-declined', closed_at: CLOSED, answer: 'declined', [DECISIONS_EMBED]: [{ outcome: 'rejected' }] }),
      rowOf({ id: 'deactivated-declined', closed_at: CLOSED, answer: 'declined', [DECISIONS_EMBED]: [{ outcome: 'deactivated' }] }),
      rowOf({ id: 'deactivated-proposed', closed_at: CLOSED, [DECISIONS_EMBED]: [{ outcome: 'deactivated' }] }),
      rowOf({ id: 'approved', closed_at: CLOSED, answer: 'accepted', [DECISIONS_EMBED]: [{ outcome: 'approved' }] }),
    ];

    expect(mySwapsOf(rows, VIEWER_MEMBER)?.map((swap) => [swap.id, swap.status])).toEqual([
      ['deactivated-proposed', SWAP_DEACTIVATED],
      ['approved', SWAP_APPROVED],
    ]);
    errors.mockRestore();
  });

  it('reads a return shift whole', () => {
    expect(swapsOf([rowOf({ return_team_id: A, return_date: DATE })])[0]?.returnShift).toEqual({ teamId: A, date: DATE });
  });

  it('gives the day detail the viewer’s open proposals alone, or none while unknown', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const rows = [
      rowOf({ id: 'mine-open', proposer_id: VIEWER_MEMBER, addressee_id: ANA, team_id: A, date: DATE }),
      rowOf({ id: 'mine-accepted', proposer_id: VIEWER_MEMBER, addressee_id: IVO, team_id: A, date: '2026-09-14', answer: 'accepted' }),
      rowOf({ id: 'mine-closed', proposer_id: VIEWER_MEMBER, addressee_id: ANA, team_id: A, date: '2026-09-18', closed_at: CLOSED }),
      rowOf({ id: 'asked' }),
    ];

    expect(openSwapProposalsOf(rows, VIEWER_MEMBER)).toEqual([
      { teamId: A, date: DATE, addresseeId: ANA },
      { teamId: A, date: '2026-09-14', addresseeId: IVO },
    ]);
    expect(openSwapProposalsOf(undefined, VIEWER_MEMBER)).toBeNull();
    expect(openSwapProposalsOf({ rows: [] } as unknown as readonly unknown[], VIEWER_MEMBER)).toBeNull();
    errors.mockRestore();
  });
});

describe('the card’s rows (the I/O matrix)', () => {
  it('Addressee: a proposed swap with their consequence, Prihvati and Odbij, and no Povuci', () => {
    const [row] = mySwapRowsOf(snapshot, swapsOf([rowOf()]), TODAY, []);

    expect(row).toMatchObject({
      viewerIsAddressee: true,
      colleagueName: 'Ivo Horvat',
      given: { team: 'Smjena B' },
      returnShift: null,
      word: SWAP_WORD_WAITING_YOU,
      waitsForViewer: true,
      past: false,
      stale: false,
      canAccept: true,
      canDecline: true,
      canWithdraw: false,
    });
    expect(row?.consequence).toEqual({
      lines: [{ shift: row?.given, viewerWorks: true }],
      hours: [{ memberId: VIEWER_MEMBER, month: '2026-09', deltaMinutes: TWELVE_HOURS }],
    });
  });

  it('the consequence with a return shift in another month: both dates, the addressee’s delta per month', () => {
    const [row] = mySwapRowsOf(
      snapshot,
      swapsOf([rowOf({ date: '2026-10-03', return_team_id: A, return_date: DATE })]),
      TODAY,
      [],
    );

    expect(row?.consequence?.lines.map((line) => [line.shift.team, line.viewerWorks])).toEqual([
      ['Smjena B', true],
      ['Smjena A', false],
    ]);
    expect(row?.consequence?.hours).toEqual([
      { memberId: VIEWER_MEMBER, month: '2026-09', deltaMinutes: -TWELVE_HOURS },
      { memberId: VIEWER_MEMBER, month: '2026-10', deltaMinutes: TWELVE_HOURS },
    ]);
  });

  it('the consequence counts the addressee’s own leave keys', () => {
    // The return shift already counts as leave on the viewer's Sati: giving it away moves none of their hours.
    const [row] = mySwapRowsOf(
      snapshot,
      swapsOf([rowOf({ return_team_id: A, return_date: DATE })]),
      TODAY,
      [{ memberId: VIEWER_MEMBER, date: DATE, teamId: A }],
    );

    expect(row?.consequence?.hours).toEqual([{ memberId: VIEWER_MEMBER, month: '2026-09', deltaMinutes: TWELVE_HOURS }]);
  });

  it('Accept: an accepted swap waits for a decision; the addressee may withdraw it, no longer answer it', () => {
    const [row] = mySwapRowsOf(snapshot, swapsOf([rowOf({ answer: 'accepted' })]), TODAY, []);

    expect(row).toMatchObject({ word: SWAP_WORD_WAITING_DECISION, waitsForViewer: false, canAccept: false, canDecline: false, canWithdraw: true });
    expect(row?.consequence).not.toBeNull();
  });

  it('Proposer: waits for the colleague, Povuci while proposed or accepted, and no consequence', () => {
    const proposed = rowOf({ proposer_id: VIEWER_MEMBER, addressee_id: ANA, team_id: A, date: DATE });
    const [row] = mySwapRowsOf(snapshot, swapsOf([proposed]), TODAY, []);

    expect(row).toMatchObject({
      viewerIsAddressee: false,
      colleagueName: 'Ana Babić',
      word: SWAP_WORD_WAITING_COLLEAGUE,
      waitsForViewer: false,
      canAccept: false,
      canDecline: false,
      canWithdraw: true,
      consequence: null,
    });

    const [accepted] = mySwapRowsOf(snapshot, swapsOf([{ ...proposed, answer: 'accepted' }]), TODAY, []);

    expect(accepted).toMatchObject({ word: SWAP_WORD_WAITING_DECISION, canWithdraw: true });
  });

  it('Decline and Withdraw: closed swaps read as such until their given date, with no buttons', () => {
    const rows = mySwapRowsOf(
      snapshot,
      swapsOf([
        rowOf({ id: 'declined', proposer_id: VIEWER_MEMBER, addressee_id: ANA, team_id: A, date: DATE, answer: 'declined', closed_at: CLOSED }),
        rowOf({ id: 'withdrawn', date: '2026-10-03', closed_at: CLOSED }),
        rowOf({ id: 'gone', team_id: B, date: '2026-09-05', closed_at: CLOSED }),
      ]),
      TODAY,
      [],
    );

    expect(rows.map((row) => [row.swap.id, row.word, row.canAccept || row.canDecline || row.canWithdraw, row.consequence])).toEqual([
      ['declined', SWAP_DECLINED, false, null],
      ['withdrawn', SWAP_WITHDRAWN, false, null],
    ]);
  });

  it('Stale: the given shift no longer the proposer’s withholds Prihvati, and Odbij stays', () => {
    // Luka's team is off on 09-10.
    const [row] = mySwapRowsOf(snapshot, swapsOf([rowOf({ proposer_id: LUKA, team_id: C, date: DATE })]), TODAY, []);

    expect(row).toMatchObject({ stale: true, canAccept: false, canDecline: true, consequence: null });
  });

  it('Stale: a return shift no longer the addressee’s, or a roster change refused, withholds Prihvati', async () => {
    const [back] = mySwapRowsOf(snapshot, swapsOf([rowOf({ return_team_id: C, return_date: DATE })]), TODAY, []);

    expect(back).toMatchObject({ stale: true, canAccept: false, canDecline: true });

    // A live change already puts the viewer on B on 09-13: the roster's live key refuses the swap.
    const taken = await snapshotOf({ rosterOverrides: [calendarRosterOverrideRow('ro-on', B, '2026-09-13', null, VIEWER_MEMBER)] });
    const [refused] = mySwapRowsOf(taken, swapsOf([rowOf()]), TODAY, []);

    expect(refused).toMatchObject({ stale: true, canAccept: false, canDecline: true, consequence: null });
    expect(swapStaleOf(snapshot, swapsOf([rowOf()])[0] as MySwap)).toBe(false);
  });

  it('Past: an open swap with a date before today reads so; Prihvati withheld, Odbij and Povuci stay, nothing closes', () => {
    const later = '2026-09-11';
    const [asked] = mySwapRowsOf(snapshot, swapsOf([rowOf()]), '2026-09-14', []);
    const [mine] = mySwapRowsOf(
      snapshot,
      swapsOf([rowOf({ proposer_id: VIEWER_MEMBER, addressee_id: ANA, team_id: A, date: DATE })]),
      later,
      [],
    );
    const [returnPast] = mySwapRowsOf(snapshot, swapsOf([rowOf({ date: '2026-10-03', return_team_id: A, return_date: DATE })]), later, []);

    expect(asked).toMatchObject({ past: true, canAccept: false, canDecline: true, word: SWAP_WORD_WAITING_YOU });
    expect(mine).toMatchObject({ past: true, canWithdraw: true });
    expect(returnPast).toMatchObject({ past: true, canAccept: false });
  });

  it('Today is not past: an open swap whose given date is today offers Prihvati', () => {
    const [row] = mySwapRowsOf(snapshot, swapsOf([rowOf()]), '2026-09-13', []);

    expect(row).toMatchObject({ past: false, canAccept: true, canDecline: true });
  });

  it('Today is not past: an open swap whose return date is today', () => {
    const [row] = mySwapRowsOf(snapshot, swapsOf([rowOf({ date: '2026-10-03', return_team_id: A, return_date: DATE })]), DATE, []);

    expect(row).toMatchObject({ past: false, canAccept: true });
  });

  it('a closed swap whose given date is today is still listed', () => {
    const rows = mySwapRowsOf(snapshot, swapsOf([rowOf({ closed_at: CLOSED, answer: 'declined' })]), '2026-09-13', []);

    expect(rows.map((row) => [row.swap.id, row.word])).toEqual([['swap-1', SWAP_DECLINED]]);
  });

  it('a closed two-way swap stays listed until its last date: given past and return ahead is listed, both past is not', () => {
    // Given 09-13 (B), return 10-03 (A), declined and closed: its notice links /danas while the return shift is ahead.
    const declined = rowOf({ team_id: B, date: '2026-09-13', return_team_id: A, return_date: '2026-10-03', answer: 'declined', closed_at: CLOSED });

    expect(mySwapRowsOf(snapshot, swapsOf([declined]), '2026-09-20', []).map((row) => [row.swap.id, row.word, row.past])).toEqual([
      ['swap-1', SWAP_DECLINED, false],
    ]);
    expect(mySwapRowsOf(snapshot, swapsOf([declined]), '2026-10-03', []).map((row) => row.swap.id)).toEqual(['swap-1']);
    expect(mySwapRowsOf(snapshot, swapsOf([declined]), '2026-10-04', [])).toEqual([]);
  });

  it('Stale for the proposer: their own shift no longer theirs flags the row, and Povuci stays', async () => {
    // A live change takes the viewer off A on 09-10: the shift they gave is no longer theirs.
    const off = await snapshotOf({ rosterOverrides: [calendarRosterOverrideRow('ro-off', A, DATE, VIEWER_MEMBER, null)] });
    const mine = rowOf({ proposer_id: VIEWER_MEMBER, addressee_id: ANA, team_id: A, date: DATE });
    const [proposed] = mySwapRowsOf(off, swapsOf([mine]), TODAY, []);
    const [accepted] = mySwapRowsOf(off, swapsOf([{ ...mine, answer: 'accepted' }]), TODAY, []);

    expect(proposed).toMatchObject({ stale: true, canAccept: false, canDecline: false, canWithdraw: true });
    expect(accepted).toMatchObject({ stale: true, canWithdraw: true });
    expect(mySwapRowsOf(snapshot, swapsOf([mine]), TODAY, [])[0]?.stale).toBe(false);
  });

  it('a team the snapshot does not hold is named as unknown, never blank', () => {
    const [row] = mySwapRowsOf(snapshot, swapsOf([rowOf({ team_id: 'gone-team' })]), TODAY, []);

    expect(row?.given.team).toBeNull();
    expect(t('danas.swaps.unknownTeam')).toBe('Nepoznata smjena');
  });

  it('No swaps: no rows', () => {
    expect(mySwapRowsOf(snapshot, [], TODAY, [])).toEqual([]);
  });

  it('orders the rows waiting for the viewer first, then the rest, soonest first', () => {
    const rows = mySwapRowsOf(
      snapshot,
      swapsOf([
        rowOf({ id: 'mine-late', proposer_id: VIEWER_MEMBER, addressee_id: ANA, team_id: A, date: '2026-09-14' }),
        rowOf({ id: 'asked-late', date: '2026-10-03' }),
        rowOf({ id: 'mine-soon', proposer_id: VIEWER_MEMBER, addressee_id: ANA, team_id: A, date: DATE }),
        rowOf({ id: 'accepted-soon', proposer_id: DINO, date: '2026-09-09', answer: 'accepted' }),
        rowOf({ id: 'asked-soon' }),
      ]),
      TODAY,
      [],
    );

    expect(rows.map((row) => row.swap.id)).toEqual(['asked-soon', 'asked-late', 'accepted-soon', 'mine-soon', 'mine-late']);
  });
});

describe('the writes', () => {
  function rpcAnswering(answer: unknown) {
    const rpc = vi.fn(async () => answer);

    return { client: { rpc } as unknown as SwapRequestRpc, rpc };
  }

  it.each([
    [SWAP_ACCEPT, ANSWER_SWAP_REQUEST_FUNCTION, { p_request_id: 'swap-1', p_answer: 'accepted' }],
    [SWAP_DECLINE, ANSWER_SWAP_REQUEST_FUNCTION, { p_request_id: 'swap-1', p_answer: 'declined' }],
    [SWAP_WITHDRAW, WITHDRAW_SWAP_REQUEST_FUNCTION, { p_request_id: 'swap-1' }],
  ] as const)('%s calls 0049’s definer', async (action: SwapAction, fn, args) => {
    const { client, rpc } = rpcAnswering({ data: null, error: null });

    expect(await actOnSwapRequest(client, 'swap-1', action)).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith(fn, args);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('Race: maps a refusal by SQLSTATE — P0002 no longer open, 42501 not allowed, anything else failed', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(swapActFailureOf({ code: 'P0002' })).toBe(SWAP_NOT_OPEN);
    expect(swapActFailureOf({ code: '42501' })).toBe(SWAP_ACT_DENIED);
    expect(swapActFailureOf({ code: '22023' })).toBe(SWAP_ACT_FAILED);
    expect(await actOnSwapRequest(rpcAnswering({ data: null, error: { code: 'P0002' } }).client, 'swap-1', SWAP_ACCEPT)).toEqual({
      ok: false,
      code: SWAP_NOT_OPEN,
    });
    expect(await actOnSwapRequest(rpcAnswering({ error: { code: '42501' } }).client, 'swap-1', SWAP_WITHDRAW)).toEqual({
      ok: false,
      code: SWAP_ACT_DENIED,
    });
    expect(await actOnSwapRequest(rpcAnswering({ error: 'boom' }).client, 'swap-1', SWAP_DECLINE)).toEqual({ ok: false, code: SWAP_ACT_FAILED });
    expect(await actOnSwapRequest(rpcAnswering(undefined).client, 'swap-1', SWAP_DECLINE)).toEqual({ ok: false, code: SWAP_ACT_FAILED });

    const throwing = {
      rpc: async () => {
        throw new Error('network');
      },
    } as unknown as SwapRequestRpc;

    expect(await actOnSwapRequest(throwing, 'swap-1', SWAP_ACCEPT)).toEqual({ ok: false, code: SWAP_ACT_FAILED });
    errors.mockRestore();
  });

  it('words every outcome and refusal, naming the shift', () => {
    const named = { day: 'nedjelja 13.09.2026', team: 'Smjena B' };

    for (const action of [SWAP_ACCEPT, SWAP_DECLINE, SWAP_WITHDRAW] as const) {
      expect(t(swapActedMessageKey(action), named)).toContain('nedjelja 13.09.2026 · Smjena B');
    }
    for (const code of [SWAP_NOT_OPEN, SWAP_ACT_DENIED, SWAP_ACT_FAILED] as readonly SwapActFailure[]) {
      expect(t(swapActFailureMessageKey(code), named)).toContain('nedjelja 13.09.2026 · Smjena B');
    }
    expect(t(swapActedMessageKey(SWAP_ACCEPT), named)).toContain('čeka odluku');
  });
});
