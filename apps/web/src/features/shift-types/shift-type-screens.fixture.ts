/**
 * THE SHIFT TYPE SCREENS' FILE SETS, written once (source structure B4).
 *
 * `/postavke-rotacije` and `/postavke-rotacije/tipovi-smjena/$id` are more
 * than one file each: a page that only composes, the hook holding its read,
 * its state and its handlers, and the components that draw it. The sign-in
 * suite (`pages/prijava.test.ts`) reads each set as one source, and
 * `test/localization-applied.test.ts` checks that its folder read holds every
 * part, so both build their paths from this.
 *
 * THE TWO SETS ARE DISJOINT. The edit screen renders the list behind its
 * dialog, but no part belongs to both: a file in both sets would have its
 * strings, controls and handlers counted twice. Each set's handler names
 * (`submit` on both, `archive` on the edit) are declared once within it, so
 * the first-match extractors read the one they mean.
 *
 * Paths are SEGMENTS under `apps/web/src`, joined by each suite against its own
 * root, so this module imports nothing and runs in neither the browser nor a
 * test on its own.
 *
 * The order is the order a set is read in: the page first, which is what the
 * "the page itself renders" check reads, and on the edit set the rename form's
 * part before the times form's, so the first form read is the one bound to
 * `submit`.
 */
export const SHIFT_TYPE_LIST_PARTS = {
  page: ['pages', 'postavke-rotacije.tsx'],
  hook: ['features', 'shift-types', 'hooks', 'use-shift-type-list.ts'],
  section: ['features', 'shift-types', 'components', 'shift-type-list-section.tsx'],
  table: ['features', 'shift-types', 'components', 'shift-type-table.tsx'],
  // Story 7.6: the same rows stacked below 640 px.
  rows: ['features', 'shift-types', 'components', 'shift-type-rows.tsx'],
  // Story 7.6: what a type's times and duration say, shared by both forms.
  cells: ['features', 'shift-types', 'components', 'shift-type-cells.tsx'],
  addDialog: ['features', 'shift-types', 'components', 'shift-type-add-dialog.tsx'],
} as const;

export const SHIFT_TYPE_EDIT_PARTS = {
  page: ['pages', 'postavke-rotacije.tipovi-smjena.$id.tsx'],
  hook: ['features', 'shift-types', 'hooks', 'use-shift-type-edit.ts'],
  body: ['features', 'shift-types', 'components', 'shift-type-edit-body.tsx'],
  facts: ['features', 'shift-types', 'components', 'shift-type-facts.tsx'],
  times: ['features', 'shift-types', 'components', 'shift-type-times.tsx'],
  archive: ['features', 'shift-types', 'components', 'shift-type-archive.tsx'],
} as const;

/**
 * Non-test modules anywhere under the feature — its root, `services/`, and
 * `components/`, `hooks/` and `utils/` at any depth — that are in NEITHER set,
 * each with the reason. Everything else found there must be listed above, and
 * everything listed above must exist. Paths are relative to the feature.
 */
export const SHIFT_TYPE_SCREENS_EXEMPT: readonly { readonly file: string; readonly why: string }[] = [
  {
    file: 'shift-type-screens.fixture.ts',
    why: 'this file: the two sets themselves, read by two suites and rendered by nothing',
  },
  {
    file: 'services/list.ts',
    why: 'the one read (AD-13), the display rows and the duration shapes; a key source of its own in the sign-in suite, executed by list.test.ts',
  },
  {
    file: 'services/write.ts',
    why: 'the four writes, the kinds, the refusals and the confirmations; a key source of its own in the sign-in suite, executed by write.test.ts',
  },
  {
    file: 'utils/ramp.ts',
    why: 'the chip ramp slot numbering, imported by test/theme-contrast.test.ts; renders nothing and declares no key',
  },
];
