import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { readCalendar, type CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { LEAVE_CONFLICTS_KNOWN, LEAVE_CONFLICTS_UNKNOWN } from '@/features/leave/services/leave-conflicts';
import type { LeaveRecord } from '@/features/leave/services/leave-list';
import {
  PREVIEW_BASE,
  PREVIEW_READY,
  PREVIEW_REFRESHING,
  REVIEW_CLOSED,
  REVIEW_LOADING,
  REVIEW_MISSING,
  REVIEW_PENDING,
  REVIEW_UNAVAILABLE,
  decisionRefreshKeysOf,
  leaveRequestReviewOf,
  reviewFailureMessageKey,
  reviewNeedsActors,
  reviewNeedsPreview,
  type LeaveRequestReview,
  type LeaveRequestReviewSources,
  type ReviewPreview,
} from '@/features/leave/services/leave-request-review';
import {
  LEAVE_REQUEST_ROOT_KEY,
  MY_LEAVE_REQUESTS_KEY,
  REQUEST_APPROVAL_STALE,
  REQUEST_APPROVED,
  REQUEST_REJECTED,
  REQUEST_DENIED,
  REQUEST_FAILED,
  REQUEST_NOT_PENDING,
  leaveRequestFoundOf,
} from '@/features/leave/services/leave-requests';
import { LEAVE_PREVIEW_READY, leavePreviewStateOf, memberLeaveBaseOf } from '@/features/leave/services/leave-section';
import { LEAVE_RECORDS_KEY } from '@/features/leave/services/leave-list';
import { LEAVE_WRITE_DEPENDENTS } from '@/features/teams/services/dependents';
import { initLocalization, t } from '@/lib/i18n';
import {
  PILOT,
  SEEDED,
  VIEWER_MEMBER,
  VIEWER_NAME,
  calendarMemberRow,
  calendarOrganizationRow,
  calendarTableOf,
  memberMembershipRow,
  membersAnswerOf,
  membershipRow,
  overridesAnswerOf,
  rosterOverridesAnswerOf,
  viewerRow,
  viewerSession,
} from '@/features/rotation/rotation.fixture';

/**
 * Story 9.4's decision screen, executed (AD-15) over a real snapshot: the
 * pilot's Smjena A, which works Dan on 02, 06, 10, 14 and 18 September and
 * Noć the day after each, with the viewer on it. The preview is checked
 * against the admin leave dialog's own pipeline over the same reads.
 */

const TEAM_A = 'pilot-smjena-a';
const REQUEST = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-09-01T08:00:00Z');
const ADMIN_AUTH = 'admin-auth-1';

let snapshot: CalendarSnapshot;

beforeAll(async () => {
  await initLocalization();

  const source = calendarTableOf(
    {
      data: [
        calendarOrganizationRow(PILOT, {
          viewers: [viewerRow([membershipRow(TEAM_A, SEEDED)], { role: 'admin' })],
          versions: [memberMembershipRow(VIEWER_MEMBER, TEAM_A, SEEDED)],
        }),
      ],
      error: null,
      count: 1,
    },
    membersAnswerOf([calendarMemberRow(VIEWER_MEMBER, VIEWER_NAME)]),
    overridesAnswerOf(),
    rosterOverridesAnswerOf([]),
  );
  const outcome = await readCalendar(source, source, viewerSession());

  if (!outcome.ok) throw new Error(outcome.code);

  snapshot = outcome.snapshot;
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A request row as the by-id read answers it: the range canonical, its upper bound exclusive. */
function requestRow({
  from = '2026-09-10',
  toExclusive = '2026-09-16',
  closedAt = null as string | null,
  decisions = [] as unknown,
} = {}) {
  return { id: REQUEST, member_id: VIEWER_MEMBER, during: `[${from},${toExclusive})`, closed_at: closedAt, leave_request_decisions: decisions };
}

const answered = (data: readonly unknown[] | undefined) => ({ data, isPending: data === undefined, isError: false });

/** Every read answered, the request pending over 10.09–15.09, no live leave, no resolution. */
function sourcesOf(overrides: Partial<LeaveRequestReviewSources> = {}): LeaveRequestReviewSources {
  return {
    request: answered([requestRow()]),
    members: {
      members: [{ id: VIEWER_MEMBER, name: VIEWER_NAME, leaveAllowanceDays: 20 }],
      refusal: null,
      loading: false,
      paused: false,
    },
    calendar: { snapshot, loading: false },
    organization: {
      data: { ok: true, snapshot: { leaveYearStartMonth: 1, leaveYearStartDay: 1 } },
      isPending: false,
      isError: false,
      fetchStatus: 'idle',
    },
    records: { records: [], loading: false, refreshing: false },
    resolutions: { data: [], isPending: false, isError: false, fetchStatus: 'idle' },
    actors: answered(undefined),
    calendarRefreshing: false,
    ...overrides,
  };
}

function pendingOf(review: LeaveRequestReview): Extract<LeaveRequestReview, { kind: typeof REVIEW_PENDING }> {
  if (review.kind !== REVIEW_PENDING) throw new Error(`not pending: ${review.kind}`);

  return review;
}

function readyOf(preview: ReviewPreview): Extract<ReviewPreview, { kind: typeof PREVIEW_READY }> {
  if (preview.kind !== PREVIEW_READY) throw new Error(`not ready: ${preview.kind}`);

  return preview;
}

describe('a pending request', () => {
  it('names who asked and the range, with the admin leave dialog\'s figures for that range', () => {
    const review = pendingOf(leaveRequestReviewOf(sourcesOf(), REQUEST, NOW));
    const preview = readyOf(review.preview);

    expect(review.facts.memberName).toBe(VIEWER_NAME);
    expect(review.facts.from).toBe('10.09.2026');
    expect(review.facts.to).toBe('15.09.2026');

    // ONE PIPELINE: what the dialog would preview for the same range over the same reads.
    const sources = sourcesOf();
    const base = memberLeaveBaseOf(
      { members: sources.members, calendar: sources.calendar, organization: sources.organization, records: sources.records },
      VIEWER_MEMBER,
      NOW,
    );

    if (base.kind !== 'ready') throw new Error('base not ready');

    const dialog = leavePreviewStateOf(base.input, '2026-09-10', '2026-09-15');

    if (dialog.kind !== LEAVE_PREVIEW_READY) throw new Error('dialog not ready');

    expect(preview.figures).toEqual(dialog.preview);
    expect(preview.inYearDays).toBeNull();
  });

  it('lists the collisions approval would create, as the dialog words them', () => {
    const preview = readyOf(pendingOf(leaveRequestReviewOf(sourcesOf(), REQUEST, NOW)).preview);

    if (preview.conflicts === null || preview.conflicts.kind !== LEAVE_CONFLICTS_KNOWN) throw new Error('not known');

    expect(preview.conflicts.created.map(({ weekday, date, type }) => `${weekday} ${date} ${type}`)).toEqual([
      'čet 10.09. Dan',
      'pet 11.09. Noć',
      'pon 14.09. Dan',
      'uto 15.09. Noć',
    ]);
  });

  it('leaves out a collision already resolved, as the queue does', () => {
    const resolved = { member_id: VIEWER_MEMBER, date: '2026-09-10', team_id: TEAM_A, kind: 'accept_uncovered', roster_override_id: null };
    const preview = readyOf(
      pendingOf(
        leaveRequestReviewOf(
          sourcesOf({ resolutions: { data: [resolved], isPending: false, isError: false, fetchStatus: 'idle' } }),
          REQUEST,
          NOW,
        ),
      ).preview,
    );

    if (preview.conflicts === null || preview.conflicts.kind !== LEAVE_CONFLICTS_KNOWN) throw new Error('not known');

    expect(preview.conflicts.created).toHaveLength(3);
  });

  it('notes a cost above the balance, and never refuses it', () => {
    const members = { members: [{ id: VIEWER_MEMBER, name: VIEWER_NAME, leaveAllowanceDays: 1 }], refusal: null, loading: false, paused: false };
    const preview = readyOf(pendingOf(leaveRequestReviewOf(sourcesOf({ members }), REQUEST, NOW)).preview);

    expect(preview.figures.exceedsBalance).toBe(true);
  });

  it('notes an overlap with live leave recorded since, and names no collision for it', () => {
    const live: LeaveRecord = { id: '22222222-2222-4222-8222-222222222222', from: '2026-09-14', to: '2026-09-14' };
    const preview = readyOf(
      pendingOf(leaveRequestReviewOf(sourcesOf({ records: { records: [live], loading: false, refreshing: false } }), REQUEST, NOW))
        .preview,
    );

    expect(preview.figures.overlapsRecord).toBe(true);
    expect(preview.conflicts).toBeNull();
  });

  it('says the collisions cannot be checked while the resolutions or the calendar are re-read', () => {
    for (const sources of [
      sourcesOf({ resolutions: { data: [], isPending: false, isError: false, fetchStatus: 'fetching' } }),
      sourcesOf({ calendarRefreshing: true }),
    ]) {
      const preview = readyOf(pendingOf(leaveRequestReviewOf(sources, REQUEST, NOW)).preview);

      expect(preview.conflicts?.kind).toBe(LEAVE_CONFLICTS_UNKNOWN);
    }
  });

  it('draws no figure while the member\'s records are re-read', () => {
    const review = pendingOf(
      leaveRequestReviewOf(sourcesOf({ records: { records: [], loading: false, refreshing: true } }), REQUEST, NOW),
    );

    expect(review.preview).toEqual({ kind: PREVIEW_REFRESHING });
  });

  it('shows the base\'s line for an unscheduled member, or a read of the preview that failed — and stays decidable', () => {
    const unscheduled = sourcesOf({
      calendar: { snapshot: { ...snapshot, members: snapshot.members.map((member) => ({ ...member, memberships: [] })) }, loading: false },
    });

    expect(pendingOf(leaveRequestReviewOf(unscheduled, REQUEST, NOW)).preview).toEqual({
      kind: PREVIEW_BASE,
      key: 'ljudi.leaveRecord.unscheduled',
    });

    const failed = sourcesOf({ records: { records: null, loading: false, refreshing: false } });

    expect(pendingOf(leaveRequestReviewOf(failed, REQUEST, NOW)).preview).toEqual({
      kind: PREVIEW_BASE,
      key: 'ljudi.leaveRecord.unavailable',
    });
  });

  it('waits while the preview\'s reads are unanswered', () => {
    expect(
      leaveRequestReviewOf(sourcesOf({ records: { records: null, loading: true, refreshing: false } }), REQUEST, NOW).kind,
    ).toBe(REVIEW_LOADING);
  });

  it('reads its preview, and no acting admin', () => {
    const request = leaveRequestFoundOf([requestRow()], REQUEST)?.request ?? null;

    expect(reviewNeedsPreview(request)).toBe(true);
    expect(reviewNeedsActors(request)).toBe(false);
    expect(reviewNeedsPreview(null)).toBe(false);
  });
});

describe('a closed request', () => {
  const decided = (outcome: string) =>
    requestRow({
      closedAt: '2026-09-02T12:05:00Z',
      decisions: [{ outcome, decided_by: ADMIN_AUTH, decided_at: '2026-09-02T12:05:00Z' }],
    });

  it('names who decided and when, in the organization\'s zone, with no preview', () => {
    const review = leaveRequestReviewOf(
      sourcesOf({
        request: answered([decided('approved')]),
        actors: answered([{ auth_user_id: ADMIN_AUTH, name: 'Ana Admin' }]),
      }),
      REQUEST,
      NOW,
    );

    expect(review).toEqual({
      kind: REVIEW_CLOSED,
      facts: expect.objectContaining({ memberName: VIEWER_NAME, from: '10.09.2026', to: '15.09.2026' }) as unknown,
      line: { decided: true, actor: 'Ana Admin', date: '02.09.2026', time: '14:05' },
    });
  });

  it('names no admin who is no longer a member, and waits for the names', () => {
    const rejected = sourcesOf({ request: answered([decided('rejected')]), actors: answered([]) });
    const review = leaveRequestReviewOf(rejected, REQUEST, NOW);

    if (review.kind !== REVIEW_CLOSED) throw new Error('not closed');

    expect(review.line).toEqual(expect.objectContaining({ actor: null }));
    expect(review.facts.request.status).toBe('rejected');
    expect(leaveRequestReviewOf(sourcesOf({ request: answered([decided('rejected')]) }), REQUEST, NOW).kind).toBe(
      REVIEW_LOADING,
    );
  });

  it('shows a withdrawn request\'s date, and reads no names', () => {
    const withdrawn = requestRow({ closedAt: '2026-09-03T08:00:00Z' });
    const review = leaveRequestReviewOf(sourcesOf({ request: answered([withdrawn]) }), REQUEST, NOW);

    expect(review).toEqual(
      expect.objectContaining({ kind: REVIEW_CLOSED, line: { decided: false, date: '03.09.2026' } }),
    );
    expect(reviewNeedsActors(leaveRequestFoundOf([withdrawn], REQUEST)?.request ?? null)).toBe(false);
    expect(reviewNeedsActors(leaveRequestFoundOf([decided('approved')], REQUEST)?.request ?? null)).toBe(true);
  });
});

describe('the states before a request', () => {
  it('is missing when no row has the id, never an error', () => {
    expect(leaveRequestReviewOf(sourcesOf({ request: answered([]) }), REQUEST, NOW)).toEqual({ kind: REVIEW_MISSING });
  });

  it('waits while the request is unanswered, and is unavailable when it failed or cannot be trusted', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(leaveRequestReviewOf(sourcesOf({ request: answered(undefined) }), REQUEST, NOW).kind).toBe(REVIEW_LOADING);
    expect(
      leaveRequestReviewOf(sourcesOf({ request: { data: undefined, isPending: false, isError: true } }), REQUEST, NOW).kind,
    ).toBe(REVIEW_UNAVAILABLE);
    expect(leaveRequestReviewOf(sourcesOf({ request: answered([{ id: REQUEST }]) }), REQUEST, NOW).kind).toBe(
      REVIEW_UNAVAILABLE,
    );
  });

  it('is unavailable when the member list or the calendar failed, and waits while either is unanswered', () => {
    const members = { members: null, refusal: null, loading: true, paused: false };

    expect(leaveRequestReviewOf(sourcesOf({ members }), REQUEST, NOW).kind).toBe(REVIEW_LOADING);
    expect(
      leaveRequestReviewOf(sourcesOf({ members: { ...members, loading: false, refusal: 'MEMBERS_UNAVAILABLE' } }), REQUEST, NOW)
        .kind,
    ).toBe(REVIEW_UNAVAILABLE);
    expect(leaveRequestReviewOf(sourcesOf({ calendar: { snapshot: null, loading: false } }), REQUEST, NOW).kind).toBe(
      REVIEW_UNAVAILABLE,
    );
    expect(leaveRequestReviewOf(sourcesOf({ calendar: { snapshot: null, loading: true } }), REQUEST, NOW).kind).toBe(
      REVIEW_LOADING,
    );
  });
});

describe('a refused decision', () => {
  it.each([
    [REQUEST_NOT_PENDING, 'Zahtjev više ne čeka odluku.'],
    [
      REQUEST_APPROVAL_STALE,
      'U međuvremenu je upisan godišnji koji se preklapa s ovim zahtjevom. Odobrenje nije moguće, a zahtjev možeš odbiti.',
    ],
    [REQUEST_DENIED, 'Nemaš ovlasti odlučiti o ovom zahtjevu.'],
    [REQUEST_FAILED, 'Odluku nije bilo moguće spremiti. Pokušaj ponovno.'],
  ] as const)('says %s in its own words', (code, words) => {
    expect(t(reviewFailureMessageKey(code))).toBe(words);
  });
});

describe('a member gone from both lists (review)', () => {
  // Built per test: the snapshot is read in `beforeAll`.
  const goneOf = () => ({
    members: { members: [], refusal: null, loading: false, paused: false },
    calendar: { snapshot: { ...snapshot, members: [] }, loading: false },
  });

  it('still draws a pending request under a neutral line, its preview the absent reason, and stays decidable', () => {
    const review = pendingOf(leaveRequestReviewOf(sourcesOf(goneOf()), REQUEST, NOW));

    expect(review.facts.memberName).toBeNull();
    expect(review.preview).toEqual({ kind: PREVIEW_BASE, key: 'zaOdluku.request.absent' });
    expect(t('zaOdluku.request.memberGone')).toBe('Osoba više nije na popisu');
  });

  it('still draws a closed request, never the unavailable state', () => {
    const withdrawn = requestRow({ closedAt: '2026-09-03T08:00:00Z' });
    const review = leaveRequestReviewOf(
      sourcesOf({ ...goneOf(), request: answered([withdrawn]) }),
      REQUEST,
      NOW,
    );

    expect(review).toEqual(expect.objectContaining({ kind: REVIEW_CLOSED, line: { decided: false, date: '03.09.2026' } }));
  });
});

describe('what a decision re-reads, besides the request itself', () => {
  const text = (keys: readonly (readonly unknown[])[]) => keys.map((key) => JSON.stringify(key));

  it('is, for an approval, the request keys, every leave write dependent and the member\'s records', () => {
    const keys = text(decisionRefreshKeysOf(REQUEST_APPROVED, VIEWER_MEMBER));

    for (const key of [MY_LEAVE_REQUESTS_KEY, LEAVE_REQUEST_ROOT_KEY, ...LEAVE_WRITE_DEPENDENTS, LEAVE_RECORDS_KEY(VIEWER_MEMBER)]) {
      expect(keys).toContain(JSON.stringify(key));
    }
  });

  it('is, for a rejection, the request keys alone', () => {
    expect(decisionRefreshKeysOf(REQUEST_REJECTED, VIEWER_MEMBER)).toEqual([MY_LEAVE_REQUESTS_KEY, LEAVE_REQUEST_ROOT_KEY]);
  });

  it('is, for a request no longer pending, an approval\'s: another admin may have approved it', () => {
    expect(decisionRefreshKeysOf(REQUEST_NOT_PENDING, VIEWER_MEMBER)).toEqual(decisionRefreshKeysOf(REQUEST_APPROVED, VIEWER_MEMBER));
  });

  it('is, for a stale approval, the request keys and the member\'s records; nothing more for any other refusal', () => {
    expect(decisionRefreshKeysOf(REQUEST_APPROVAL_STALE, VIEWER_MEMBER)).toEqual([
      MY_LEAVE_REQUESTS_KEY,
      LEAVE_REQUEST_ROOT_KEY,
      LEAVE_RECORDS_KEY(VIEWER_MEMBER),
    ]);
    expect(decisionRefreshKeysOf(REQUEST_DENIED, VIEWER_MEMBER)).toEqual([]);
    expect(decisionRefreshKeysOf(REQUEST_FAILED, VIEWER_MEMBER)).toEqual([]);
  });
});
