/**
 * THE SATI SCREEN'S FILE SET, written once (story 4.1b; the organization
 * table's parts since story 4.2, its export since story 4.3), on the calendar's
 * terms (`calendar-screen.fixture.ts`): a page that only composes, the hook
 * holding its one read, the components that draw it, and the month
 * navigation it shares with the calendar. `pages/prijava.test.ts` reads it as
 * source.
 *
 * Paths are SEGMENTS under `apps/web/src`, so this module imports nothing.
 * The page is first: the "the page itself renders" check reads it.
 */
export const HOURS_SCREEN_PARTS = {
  page: ['pages', 'sati.tsx'],
  hook: ['features', 'hours', 'hooks', 'use-hours.ts'],
  body: ['features', 'hours', 'components', 'hours-body.tsx'],
  summary: ['features', 'hours', 'components', 'hours-summary.tsx'],
  skeleton: ['features', 'hours', 'components', 'hours-skeleton.tsx'],
  organizationFilters: ['features', 'hours', 'components', 'organization-hours-filters.tsx'],
  organizationTable: ['features', 'hours', 'components', 'organization-hours-table.tsx'],
  // Story 7.6: the same view as stacked rows below 640 px.
  organizationRows: ['features', 'hours', 'components', 'organization-hours-rows.tsx'],
  // Story 7.6: what an empty result says, drawn by both forms.
  organizationEmpty: ['features', 'hours', 'components', 'organization-hours-empty.tsx'],
  // Story 7.14: the ⓘ beside a figure and the drawer of what composes it.
  explanation: ['features', 'hours', 'components', 'hours-explanation.tsx'],
  organizationExport: ['features', 'hours', 'components', 'organization-hours-export.tsx'],
  exportHook: ['features', 'hours', 'hooks', 'use-hours-export.ts'],
  monthNav: ['components', 'month-nav.tsx'],
  // Story 7.5: the filter bar Kalendar and Sati share.
  filterBar: ['components', 'filter-bar.tsx'],
  // Story 7.6: the phone's sort control Sati and Ljudi share.
  sortControl: ['components', 'sort-control.tsx'],
} as const;

/**
 * Non-test modules under the feature that are NOT part of the set, each with
 * the reason. Everything else found there must be listed above. Paths are
 * relative to the feature.
 */
export const HOURS_SCREEN_EXEMPT: readonly { readonly file: string; readonly why: string }[] = [
  {
    file: 'hours-screen.fixture.ts',
    why: 'this file: the set itself, read by the sign-in suite and rendered by nothing',
  },
  {
    file: 'services/my-hours.ts',
    why: 'every rule of the screen and its failure message; a key source of its own, executed by my-hours.test.ts',
  },
  {
    file: 'services/organization-hours.ts',
    why: "every rule of the admin's organization table (story 4.2); renders nothing, executed by organization-hours.test.ts",
  },
  {
    file: 'services/hours-export.ts',
    why: "every rule of the table's export (story 4.3): columns, cells, names, the guard; renders nothing, executed by hours-export.test.ts",
  },
  {
    file: 'services/hours-explanation.ts',
    why: "the shifts behind a figure (story 7.14): the domain's operands given names, dates and words; renders nothing, executed by hours-explanation.test.ts",
  },
  {
    file: 'services/hours-conflicts.ts',
    why: "the conflict count beside the figures (story 5.3d): the leave read's state and the collisions; renders nothing, executed by hours-conflicts.test.ts",
  },
  {
    file: 'services/xlsx.ts',
    why: 'the only module that knows the lazily loaded XLSX writer (story 4.3); maps cells and renders nothing',
  },
];
