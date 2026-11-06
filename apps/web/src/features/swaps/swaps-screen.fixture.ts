/**
 * STORY 12.2: THE SWAP PROPOSAL'S FILE SET, `/kalendar/zamjena` — its page,
 * the hook holding the role gate, the reads and the send, and the form. The
 * page is first: the "the page itself renders" check reads it. The status
 * line the send returns with is drawn on *Kalendar*, so its hook and line are
 * parts of the calendar's set (`calendar-screen.fixture.ts`), not this one.
 *
 * Paths are SEGMENTS under `apps/web/src`, so this module imports nothing.
 */
export const SWAP_PROPOSAL_PARTS = {
  page: ['pages', 'kalendar.zamjena.tsx'],
  hook: ['features', 'swaps', 'hooks', 'use-swap-proposal.ts'],
  form: ['features', 'swaps', 'components', 'swap-proposal-form.tsx'],
} as const;
