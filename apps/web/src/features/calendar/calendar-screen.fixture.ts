/**
 * THE CALENDAR SCREEN'S FILE SET, written once (source structure B3).
 *
 * `/kalendar` is more than one file: a page that only composes, the hooks
 * holding its read, its state and its handlers, the components that draw it,
 * and two helpers. Two suites read it as source — `pages/prijava.test.ts` and
 * `features/calendar/services/snapshot.test.ts` — and two hand-written copies
 * of the list would be two answers to "what is the screen". Both build their
 * paths from this.
 *
 * Paths are SEGMENTS under `apps/web/src`, joined by each suite against its own
 * root, so this module imports nothing and runs in neither the browser nor a
 * test on its own.
 *
 * THIS FILE LIVES INSIDE THE FEATURE, so the snapshot suite's "the calendar
 * only reads" sweep reads it too: no modulo sign, no write and none of the
 * words that sweep counts, in code or in the reasons below.
 *
 * The order is the order a set is read in: the page first, which is what the
 * "the page itself renders" check reads.
 */
export const CALENDAR_SCREEN_PARTS = {
  page: ['pages', 'kalendar.tsx'],
  screenHook: ['features', 'calendar', 'hooks', 'use-calendar-screen.ts'],
  dayDetailHook: ['features', 'calendar', 'hooks', 'use-day-detail.ts'],
  overrideFormHook: ['features', 'calendar', 'hooks', 'use-override-form.ts'],
  monthNav: ['features', 'calendar', 'components', 'calendar-month-nav.tsx'],
  modeSwitch: ['features', 'calendar', 'components', 'calendar-mode-switch.tsx'],
  filter: ['features', 'calendar', 'components', 'calendar-filter.tsx'],
  monthBody: ['features', 'calendar', 'components', 'calendar-month-body.tsx'],
  grid: ['features', 'calendar', 'components', 'calendar-grid.tsx'],
  cell: ['features', 'calendar', 'components', 'calendar-cell.tsx'],
  legend: ['features', 'calendar', 'components', 'calendar-legend.tsx'],
  dayList: ['features', 'calendar', 'components', 'calendar-day-list.tsx'],
  dayDetailDialog: ['features', 'calendar', 'components', 'day-detail-dialog.tsx'],
  overrideForm: ['features', 'calendar', 'components', 'override-form.tsx'],
  skeleton: ['features', 'calendar', 'components', 'calendar-skeleton.tsx'],
  cellLabel: ['features', 'calendar', 'utils', 'cell-label.ts'],
  screenKeys: ['features', 'calendar', 'utils', 'screen-keys.ts'],
} as const;

/**
 * Non-test modules anywhere under the feature — its root, `services/`, and
 * `components/`, `hooks/` and `utils/` at any depth — that are NOT part of the
 * set, each with the reason. Everything else found there must be listed above,
 * and everything listed above must exist. Paths are relative to the feature.
 */
export const CALENDAR_SCREEN_EXEMPT: readonly { readonly file: string; readonly why: string }[] = [
  {
    file: 'calendar-screen.fixture.ts',
    why: 'this file: the set itself, read by two suites and rendered by nothing',
  },
  {
    file: 'services/snapshot.ts',
    why: 'the one read (AD-13) and its failure messages; a key source of its own in the sign-in suite, executed by snapshot.test.ts',
  },
  {
    file: 'services/override-write.ts',
    why: 'the override set and removal (story 3.5b) and their refusal messages; a key source of its own in the sign-in suite, executed by override-write.test.ts',
  },
  {
    file: 'utils/month.ts',
    why: 'the month model, executed by month.test.ts; declares no key and is swept by the snapshot suite under its own counts',
  },
  {
    file: 'utils/modifiers.ts',
    why: 'the mark vocabulary; a key source of its own in the sign-in suite, so in the set its strings would count twice',
  },
  {
    file: 'utils/grid-keys.ts',
    why: 'the grid keyboard rules, executed by grid-keys.test.ts; renders nothing and declares no key',
  },
  {
    file: 'utils/skeleton.ts',
    why: 'the skeleton shape rule, executed by skeleton.test.ts; renders nothing and declares no key',
  },
  {
    file: 'utils/element-ids.ts',
    why: 'the ids one element carries and another names; literals no screen part may hold, which the literal sweep would read as copy',
  },
  {
    file: 'utils/day-detail.ts',
    why: 'the day detail model, executed by day-detail.test.ts; swept by the snapshot suite under its own counts',
  },
];
