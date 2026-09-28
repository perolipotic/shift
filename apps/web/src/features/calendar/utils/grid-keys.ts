/**
 * The calendar grid's keyboard rules (story 3.2b, UX-DR39): the full and the
 * compressed grid are one ARIA grid with ONE tab stop, a roving `tabIndex`,
 * and the arrow, Home and End keys moving focus between its data cells.
 *
 * PURE, and executed by the node suite (AD-15), the way `features/rotation/utils/stepper.ts`
 * holds the stepper's rules: `pages/kalendar.tsx` only moves DOM focus to the
 * position these rules return.
 *
 * A POSITION is a data cell's: `row` the date's index in the month, `column`
 * the team's index among the columns. The date column and the header row are
 * not in it — neither takes focus.
 */

/** One data cell of the grid. */
export interface GridPosition {
  readonly row: number;
  readonly column: number;
}

/** How many data rows and columns the grid has. */
export interface GridSize {
  readonly rows: number;
  readonly columns: number;
}

/** The first cell of the month. */
export const GRID_ORIGIN: GridPosition = { row: 0, column: 0 };

function clamp(value: number, last: number): number {
  return Math.min(Math.max(value, 0), last);
}

/** The modifier keys held with a key, as `KeyboardEvent` has them. */
export interface KeyModifiers {
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly meta: boolean;
  readonly shift: boolean;
}

/** No modifier key held. */
export const NO_KEY_MODIFIERS: KeyModifiers = { ctrl: false, alt: false, meta: false, shift: false };

/** The modifiers of a keyboard event. */
export function keyModifiersOf(event: {
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}): KeyModifiers {
  return { ctrl: event.ctrlKey, alt: event.altKey, meta: event.metaKey, shift: event.shiftKey };
}

/**
 * Where focus goes from `position` on `key` (`KeyboardEvent.key`), with the
 * `modifiers` held; `null` for a key the grid does not handle — Tab leaves the
 * grid, and Enter and Space move nothing: they open the cell's day detail
 * ({@link isOpenGridKey}, story 3.4b).
 *
 * Arrows move one cell and STOP at the edges; Home and End go to the start and
 * end of the row; Ctrl+Home and Ctrl+End to the first and last cell of the
 * month. Ctrl counts with Home and End only: Ctrl+Arrow is not handled, and
 * neither is any key with Alt, Meta or Shift held — those belong to the
 * browser and assistive technology. A grid with no cells handles nothing.
 */
export function gridFocusAfter(
  key: string,
  modifiers: KeyModifiers,
  position: GridPosition,
  size: GridSize,
): GridPosition | null {
  if (size.rows <= 0 || size.columns <= 0) return null;
  if (modifiers.alt || modifiers.meta || modifiers.shift) return null;

  const lastRow = size.rows - 1;
  const lastColumn = size.columns - 1;
  const row = clamp(position.row, lastRow);
  const column = clamp(position.column, lastColumn);
  const { ctrl } = modifiers;

  switch (key) {
    case 'ArrowLeft':
      return ctrl ? null : { row, column: clamp(column - 1, lastColumn) };
    case 'ArrowRight':
      return ctrl ? null : { row, column: clamp(column + 1, lastColumn) };
    case 'ArrowUp':
      return ctrl ? null : { row: clamp(row - 1, lastRow), column };
    case 'ArrowDown':
      return ctrl ? null : { row: clamp(row + 1, lastRow), column };
    case 'Home':
      return ctrl ? GRID_ORIGIN : { row, column: 0 };
    case 'End':
      return ctrl ? { row: lastRow, column: lastColumn } : { row, column: lastColumn };
    default:
      return null;
  }
}

/**
 * Whether a key on a cell is one that OPENS its day detail (story 3.4b):
 * Enter or Space, Shift allowed, never with Ctrl, Alt or Meta — those belong
 * to the browser and assistive technology.
 */
export function isOpenGridKey(key: string, modifiers: KeyModifiers): boolean {
  return (key === 'Enter' || key === ' ') && !modifiers.ctrl && !modifiers.alt && !modifiers.meta;
}

/** What a key event's own flags say: auto-repeat, and an input method composing. */
export interface GridKeyFlags {
  readonly repeat: boolean;
  readonly composing: boolean;
}

/** What the screen does with a keydown on a cell that is an opening key, or composing. */
export interface GridOpenStep {
  /** Prevent the key's default: Space would scroll the page. */
  readonly prevent: boolean;
  /** Open the cell's detail now. */
  readonly open: boolean;
  /** Arm the cell for Space's keyup, which opens it (`gridOpensOnKeyUp`). */
  readonly arm: boolean;
}

const NOTHING: GridOpenStep = { prevent: false, open: false, arm: false };

/**
 * A keydown on a cell (story 3.4b), or `null` for a key that does not open —
 * the caller then moves focus by {@link gridFocusAfter}.
 *
 * - While an input method is composing, the keyboard is the IME's: nothing.
 * - ENTER opens on keydown; a held, auto-repeating Enter opens nothing more.
 * - SPACE is prevented on keydown, so the page never scrolls, and only ARMS
 *   the cell: it opens on keyup, so that keyup cannot land on the Dialog's
 *   close button and activate it. An auto-repeat does not re-arm.
 */
export function gridOpenOnKeyDown(key: string, modifiers: KeyModifiers, flags: GridKeyFlags): GridOpenStep | null {
  if (flags.composing) return NOTHING;
  if (!isOpenGridKey(key, modifiers)) return null;
  if (key === 'Enter') return { prevent: true, open: !flags.repeat, arm: false };

  return { prevent: true, open: false, arm: !flags.repeat };
}

/**
 * Whether a keyup on a cell opens its detail: Space, on the cell its keydown
 * armed (`armed`), with no input method composing.
 */
export function gridOpensOnKeyUp(
  key: string,
  modifiers: KeyModifiers,
  { armed, composing }: { readonly armed: boolean; readonly composing: boolean },
): boolean {
  return key === ' ' && armed && !composing && isOpenGridKey(key, modifiers);
}

/**
 * How a focused cell is scrolled into view: the least scroll that shows
 * it whole, on both axes, inside its `scroll-margin` — the sticky date
 * column's width and the sticky header's height (`calendar-grid.tsx`) — so it
 * never lands under either (package 3c).
 */
export const GRID_REVEAL: ScrollIntoViewOptions = { block: 'nearest', inline: 'nearest' };

/** The state a focused cell is revealed in: its focus shown, so a keyboard, not a pointer, put it there. */
export const FOCUS_VISIBLE = ':focus-visible';

/** Every data cell of the grid, and the one a position names (by `data-row`, `data-column`). */
export const GRID_CELL_SELECTOR = '[role="gridcell"]';

/** The grid's one tab stop: where focus falls back to when a day detail's opener is gone (story 3.4b). */
export const GRID_TAB_STOP_SELECTOR = `${GRID_CELL_SELECTOR}[tabindex="0"]`;

/**
 * The month heading's id: it names the grid and the day list, and takes focus
 * when a day detail's opener is gone and no grid is shown (story 3.4b).
 */
export const MONTH_HEADING_ID = 'kalendar-month-heading';

export function gridCellSelectorOf(position: GridPosition): string {
  return `${GRID_CELL_SELECTOR}[data-row="${String(position.row)}"][data-column="${String(position.column)}"]`;
}

/**
 * A cell's position from its `data-row` and `data-column` (an element's
 * `dataset`), or `null` when either is missing or not a whole number.
 */
export function gridPositionOf(dataset: {
  readonly row?: string | undefined;
  readonly column?: string | undefined;
}): GridPosition | null {
  const { row, column } = dataset;

  if (row === undefined || column === undefined || !/^\d+$/.test(row) || !/^\d+$/.test(column)) return null;

  return { row: Number(row), column: Number(column) };
}

/**
 * The grid's one tab stop before anything has been focused: today's first
 * team's cell when the month shows today, otherwise the first cell.
 */
export function initialGridFocusOf(rows: readonly { readonly isToday: boolean }[]): GridPosition {
  const today = rows.findIndex((row) => row.isToday);

  return today === -1 ? GRID_ORIGIN : { row: today, column: 0 };
}

/** The focus the grid remembers: a position, and the month it was taken in. */
export interface GridFocus {
  readonly month: string;
  readonly position: GridPosition;
}

/**
 * The tab stop shown: the remembered position while the month is the one it
 * was taken in (kept inside the grid, should the columns change on a
 * refetch), and {@link initialGridFocusOf} after the month changes.
 */
export function gridTabStopOf(
  remembered: GridFocus | null,
  month: string,
  rows: readonly { readonly isToday: boolean }[],
  columns: number,
): GridPosition {
  if (remembered === null || remembered.month !== month || rows.length === 0 || columns === 0) {
    return initialGridFocusOf(rows);
  }

  return {
    row: clamp(remembered.position.row, rows.length - 1),
    column: clamp(remembered.position.column, columns - 1),
  };
}

/** Whether two positions are the same cell. */
export function isSameGridPosition(left: GridPosition, right: GridPosition): boolean {
  return left.row === right.row && left.column === right.column;
}
