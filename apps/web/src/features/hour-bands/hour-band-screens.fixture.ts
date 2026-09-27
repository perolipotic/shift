/**
 * THE HOUR BAND SCREENS' FILE SETS, written once (source structure B5).
 *
 * `/organizacija/satni-pojasi` and `/organizacija/satni-pojasi/$id` are more
 * than one file each: a page that only composes, the hook holding its read,
 * its state and its handlers, and the components that draw it. The sign-in
 * suite (`pages/prijava.test.ts`) reads each set as one source, and
 * `test/localization-applied.test.ts` checks that its folder read holds every
 * part, so both build their paths from this.
 *
 * THE TWO SETS ARE DISJOINT. The edit screen renders the list behind its
 * dialog, but no part belongs to both: a file in both sets would have its
 * strings, controls and handlers counted twice. Each set's handler names
 * (`submit` on both) are declared once within it, so the first-match
 * extractors read the one they mean.
 *
 * Paths are SEGMENTS under `apps/web/src`, joined by each suite against its own
 * root, so this module imports nothing and runs in neither the browser nor a
 * test on its own.
 *
 * The order is the order a set is read in: the page first, which is what the
 * "the page itself renders" check reads.
 */
export const HOUR_BAND_LIST_PARTS = {
  page: ['pages', 'organizacija.satni-pojasi.tsx'],
  hook: ['features', 'hour-bands', 'hooks', 'use-hour-band-list.ts'],
  addDialog: ['features', 'hour-bands', 'components', 'hour-band-add-dialog.tsx'],
  section: ['features', 'hour-bands', 'components', 'hour-band-list-section.tsx'],
  table: ['features', 'hour-bands', 'components', 'hour-band-table.tsx'],
  timeline: ['features', 'hour-bands', 'components', 'hour-band-timeline.tsx'],
} as const;

export const HOUR_BAND_EDIT_PARTS = {
  page: ['pages', 'organizacija.satni-pojasi.$id.tsx'],
  hook: ['features', 'hour-bands', 'hooks', 'use-hour-band-edit.ts'],
  body: ['features', 'hour-bands', 'components', 'hour-band-edit-body.tsx'],
  remove: ['features', 'hour-bands', 'components', 'hour-band-remove.tsx'],
} as const;

/**
 * Non-test modules anywhere under the feature — its root, `services/`, and
 * `components/`, `hooks/` and `utils/` at any depth — that are in NEITHER set,
 * each with the reason. Everything else found there must be listed above, and
 * everything listed above must exist. Paths are relative to the feature.
 */
export const HOUR_BAND_SCREENS_EXEMPT: readonly { readonly file: string; readonly why: string }[] = [
  {
    file: 'hour-band-screens.fixture.ts',
    why: 'this file: the two sets themselves, read by two suites and rendered by nothing',
  },
  {
    file: 'services/list.ts',
    why: 'the one read (AD-13), the display rows, the bar and the duration shapes; a key source of its own in the sign-in suite, executed by list.test.ts',
  },
  {
    file: 'services/write.ts',
    why: 'the three writes, the refusals and the confirmations; a key source of its own in the sign-in suite, executed by write.test.ts',
  },
];
