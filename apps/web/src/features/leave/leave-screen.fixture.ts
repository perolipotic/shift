/**
 * THE GODIŠNJI SCREEN'S FILE SET, written once (story 5.2c), on the *Sati*
 * screen's terms (`hours-screen.fixture.ts`): a page that only composes, the
 * hook holding its reads, and the components that draw it.
 * The source guards in `pages/` read it as source.
 *
 * Paths are SEGMENTS under `apps/web/src`, so this module imports nothing.
 * The page is first: the "the page itself renders" check reads it.
 */
export const LEAVE_SCREEN_PARTS = {
  page: ['pages', 'godisnji.tsx'],
  hook: ['features', 'leave', 'hooks', 'use-my-leave.ts'],
  body: ['features', 'leave', 'components', 'my-leave-body.tsx'],
  summary: ['features', 'leave', 'components', 'my-leave-summary.tsx'],
  skeleton: ['features', 'leave', 'components', 'my-leave-skeleton.tsx'],
  // STORY 7.15: the admin's overview — its hook, its body, the table from
  // 640 px and the stacked rows below it.
  overviewHook: ['features', 'leave', 'hooks', 'use-leave-overview.ts'],
  overviewBody: ['features', 'leave', 'components', 'leave-overview-body.tsx'],
  overviewTable: ['features', 'leave', 'components', 'leave-overview-table.tsx'],
  overviewRows: ['features', 'leave', 'components', 'leave-overview-rows.tsx'],
  // E884: the overview's search, its Smjena and Stanje chips and the summary
  // line, on the shared option-chip bar.
  overviewFilters: ['features', 'leave', 'components', 'leave-overview-filters.tsx'],
  // Epic 4 retro D2 (E890): the sortable heading the overview shares with
  // Sati, and the glyph record it draws from.
  sortableHead: ['components', 'sortable-head.tsx'],
  sortGlyphs: ['components', 'sort-glyphs.ts'],
  // STORY 9.3: a member's own requests — the hook holding their read and the
  // withdrawal, and the list with its status words and *Povuci zahtjev*.
  requestsHook: ['features', 'leave', 'hooks', 'use-my-leave-requests.ts'],
  requests: ['features', 'leave', 'components', 'my-leave-requests.tsx'],
} as const;

/**
 * STORY 9.3: THE REQUEST FORM'S FILE SET, `/godisnji/zatrazi` — its page,
 * the hook holding the role gate, the reads and the send, and the form. The
 * page is first.
 */
export const LEAVE_REQUEST_PARTS = {
  page: ['pages', 'godisnji.zatrazi.tsx'],
  hook: ['features', 'leave', 'hooks', 'use-leave-request-form.ts'],
  form: ['features', 'leave', 'components', 'leave-request-form.tsx'],
} as const;

/**
 * Non-test modules under the leave feature that are NOT part of the set, each
 * with the reason. Everything else found there must be listed above. Paths
 * are relative to the feature.
 */
export const LEAVE_SCREEN_EXEMPT: readonly { readonly file: string; readonly why: string }[] = [
  {
    file: 'leave-screen.fixture.ts',
    why: 'this file: the set itself, read by the sign-in suite and rendered by nothing',
  },
  {
    file: 'services/my-leave.ts',
    why: 'every rule of the screen and its two lines; a key source of its own, executed by my-leave.test.ts',
  },
  {
    file: 'services/leave-list.ts',
    why: "the leave reads — a member's records for the admin card, the viewer's own for this screen; renders nothing",
  },
  {
    file: 'services/leave-overview.ts',
    why: "every rule of the admin's overview (story 7.15): the role gate, the rows, the sort, the search and the summary; executed by leave-overview.test.ts",
  },
  {
    file: 'services/leave-section.ts',
    why: "every rule of the admin's leave card on the member page; a key source of its own, executed by leave-section.test.ts",
  },
  {
    file: 'services/leave-write.ts',
    why: "the admin card's record, amend and removal writes; renders nothing, executed by leave-write.test.ts",
  },
  {
    file: 'hooks/use-member-leave.ts',
    why: "the admin card's hook, a part of the member edit screen's set in pages/source-guards.fixture.ts",
  },
  {
    file: 'components/member-leave-card.tsx',
    why: "the admin card on the member page, a part of the member edit screen's set in pages/source-guards.fixture.ts",
  },
  {
    file: 'components/member-leave-records.tsx',
    why: "the admin card's records and removal confirmation, a part of the member edit screen's set",
  },
  {
    file: 'components/member-leave-dialog.tsx',
    why: "the admin card's record and amend dialog (story 7.12), a part of the member edit screen's set",
  },
  {
    file: 'services/leave-conflicts.ts',
    why: "the admin dialog's conflict preview (story 7.12); codes and operands only, executed by leave-conflicts.test.ts",
  },
  {
    file: 'services/leave-requests.ts',
    why: "a member's own requests on 0040's boundary (story 9.3): the read, the parse, the status, the insert and the withdrawal; renders nothing, executed by leave-requests.test.ts",
  },
  {
    file: 'hooks/use-leave-request-form.ts',
    why: "the request form's hook (story 9.3), a part of the request form's own set, LEAVE_REQUEST_PARTS",
  },
  {
    file: 'components/leave-request-form.tsx',
    why: "the request form itself (story 9.3), a part of the request form's own set, LEAVE_REQUEST_PARTS",
  },
  {
    file: 'components/leave-conflict-lines.tsx',
    why: "the admin dialog's conflict lines, extracted unchanged (story 9.4) so a request's decision screen words collisions the same; a part of the member edit screen's set",
  },
  {
    file: 'services/leave-request-review.ts',
    why: "every rule of a leave request's decision screen (story 9.4): its states, the preview through the dialog's pipeline, the closed line and the refusals; a key source of its own, executed by leave-request-review.test.ts",
  },
  {
    file: 'hooks/use-leave-request-review.ts',
    why: "the request decision screen's hook (story 9.4), a part of its own set, LEAVE_REQUEST_REVIEW_PARTS in conflicts-screen.fixture.ts",
  },
  {
    file: 'components/leave-request-review-body.tsx',
    why: "the request decision screen's body (story 9.4), a part of its own set, LEAVE_REQUEST_REVIEW_PARTS in conflicts-screen.fixture.ts",
  },
  {
    file: 'services/surface-keys.ts',
    why: "Godišnji's reads as one snapshot (story 8.2b), the keys its offline freshness is decided over; renders nothing and declares no key, executed by surface-keys.test.ts",
  },
];
