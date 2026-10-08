/**
 * The phone's sort control (story 7.6), as a pure module (AD-15): below
 * 640 px *Sati* and *Ljudi* draw no column headings to press, so one
 * `Poredano: {column} ↑|↓` button opens a list of the sortable columns.
 * Picking one is the same change a heading press makes — the screen's own
 * `pressColumn` — so a new column starts ascending and the sorted one flips,
 * and the state is the one the table reads across the 640 px switch.
 */

/** One sortable column the control offers: its sort key and its heading, from the screen's `t()` or data. */
export interface SortControlColumn<K extends string = string> {
  readonly key: K;
  readonly label: string;
  /**
   * Whether the list offers it (default `true`). A column the phone row does
   * not show — Ljudi's address — is not offered, yet still names the trigger
   * while it is the sorted one (sorted from 640 px, then narrowed).
   */
  readonly listed?: boolean;
}

/** The columns the list offers: every one not marked `listed: false`. */
export function sortControlListedOf<K extends string>(
  columns: readonly SortControlColumn<K>[],
): readonly SortControlColumn<K>[] {
  return columns.filter((column) => column.listed !== false);
}

/**
 * The list's one tab stop, kept on an option: clamped to the last one when
 * the columns shrink while the list is open (a band removed under it), so
 * one option always has `tabIndex=0`. `0` with no options.
 */
export function sortControlCursorClampOf(cursor: number, count: number): number {
  return Math.max(Math.min(cursor, count - 1), 0);
}

/** Which way the sorted column runs: the arrow the control draws and the word it says. */
export type SortControlDirection = 'up' | 'down';

/**
 * Where the list's one tab stop starts: on the sorted column, so opening the
 * list focuses what is chosen — or the first column, should the sorted one not
 * be offered.
 */
export function sortControlCursorOf<K extends string>(columns: readonly SortControlColumn<K>[], active: K): number {
  return Math.max(
    columns.findIndex((column) => column.key === active),
    0,
  );
}

/**
 * The heading the trigger names: the sorted column's — listed or not — or the
 * first column's should no column be the sorted one; `''` with no columns.
 */
export function sortControlLabelOf<K extends string>(columns: readonly SortControlColumn<K>[], active: K): string {
  return (columns.find((column) => column.key === active) ?? columns[0])?.label ?? '';
}
