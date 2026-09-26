import { describe, expect, it } from 'vitest';

import {
  GRID_CELL_SELECTOR,
  GRID_ORIGIN,
  NO_KEY_MODIFIERS,
  gridCellSelectorOf,
  gridFocusAfter,
  gridPositionOf,
  isInertGridKey,
  keyModifiersOf,
  type KeyModifiers,
  gridTabStopOf,
  initialGridFocusOf,
  isSameGridPosition,
  type GridPosition,
  type GridSize,
} from '@/calendar/grid-keys';

/**
 * Story 3.2b's keyboard grid, executed (AD-15): every handled key at the
 * corners, the edges and the middle, a 1×1 grid, the keys and modifiers it
 * leaves alone, Space swallowed, the cell attributes, and the one tab stop.
 */

/** A month of 30 dates over four teams. */
const MONTH: GridSize = { rows: 30, columns: 4 };
const LAST_ROW = MONTH.rows - 1;
const LAST_COLUMN = MONTH.columns - 1;

const at = (row: number, column: number): GridPosition => ({ row, column });

const CTRL: KeyModifiers = { ...NO_KEY_MODIFIERS, ctrl: true };

/** `gridFocusAfter` with Ctrl held or nothing held. */
function after(key: string, ctrl: boolean, position: GridPosition, size: GridSize): GridPosition | null {
  return gridFocusAfter(key, ctrl ? CTRL : NO_KEY_MODIFIERS, position, size);
}

const CORNERS = {
  'top left': at(0, 0),
  'top right': at(0, LAST_COLUMN),
  'bottom left': at(LAST_ROW, 0),
  'bottom right': at(LAST_ROW, LAST_COLUMN),
} as const;

const EDGES = {
  top: at(0, 1),
  bottom: at(LAST_ROW, 2),
  left: at(12, 0),
  right: at(12, LAST_COLUMN),
} as const;

const MIDDLE = at(12, 1);

/** What each key does from `from`, by the rules the spec states. */
function expected(key: string, ctrl: boolean, from: GridPosition, size: GridSize): GridPosition {
  const lastRow = size.rows - 1;
  const lastColumn = size.columns - 1;

  switch (key) {
    case 'ArrowLeft':
      return at(from.row, Math.max(from.column - 1, 0));
    case 'ArrowRight':
      return at(from.row, Math.min(from.column + 1, lastColumn));
    case 'ArrowUp':
      return at(Math.max(from.row - 1, 0), from.column);
    case 'ArrowDown':
      return at(Math.min(from.row + 1, lastRow), from.column);
    case 'Home':
      return ctrl ? at(0, 0) : at(from.row, 0);
    case 'End':
      return ctrl ? at(lastRow, lastColumn) : at(from.row, lastColumn);
    default:
      throw new Error(key);
  }
}

const HANDLED = [
  ['ArrowLeft', false],
  ['ArrowRight', false],
  ['ArrowUp', false],
  ['ArrowDown', false],
  ['Home', false],
  ['End', false],
  ['Home', true],
  ['End', true],
] as const;

const PLACES = [
  ...Object.entries(CORNERS).map(([name, position]) => [`the ${name} corner`, position] as const),
  ...Object.entries(EDGES).map(([name, position]) => [`the ${name} edge`, position] as const),
  ['the middle', MIDDLE] as const,
];

describe('the keys', () => {
  it.each(PLACES.flatMap(([place, position]) => HANDLED.map(([key, ctrl]) => [place, key, ctrl, position] as const)))(
    'from %s, %s (ctrl %s)',
    (_, key, ctrl, position) => {
      expect(after(key, ctrl, position, MONTH)).toEqual(expected(key, ctrl, position, MONTH));
    },
  );

  it('the matrix: ← and ↑ stop at (0,0), End goes to the row end, Ctrl+End to the last cell', () => {
    expect(after('ArrowLeft', false, at(0, 0), MONTH)).toEqual(at(0, 0));
    expect(after('ArrowUp', false, at(0, 0), MONTH)).toEqual(at(0, 0));
    expect(after('End', false, at(0, 0), MONTH)).toEqual(at(0, LAST_COLUMN));
    expect(after('End', true, at(0, 0), MONTH)).toEqual(at(LAST_ROW, LAST_COLUMN));
    expect(after('Home', true, MIDDLE, MONTH)).toEqual(GRID_ORIGIN);
  });

  it('moves one cell in the middle', () => {
    expect(after('ArrowRight', false, MIDDLE, MONTH)).toEqual(at(12, 2));
    expect(after('ArrowDown', false, MIDDLE, MONTH)).toEqual(at(13, 1));
    expect(after('ArrowUp', false, MIDDLE, MONTH)).toEqual(at(11, 1));
    expect(after('ArrowLeft', false, MIDDLE, MONTH)).toEqual(at(12, 0));
  });

  it.each(HANDLED)('a 1×1 grid keeps %s (ctrl %s) on its one cell', (key, ctrl) => {
    expect(after(key, ctrl, at(0, 0), { rows: 1, columns: 1 })).toEqual(at(0, 0));
  });

  it.each(['Tab', 'Enter', ' ', 'Escape', 'PageDown', 'a', 'Shift', 'F5'])('leaves %j alone', (key) => {
    expect(after(key, false, MIDDLE, MONTH)).toBeNull();
    expect(after(key, true, MIDDLE, MONTH)).toBeNull();
  });

  it('handles nothing in a grid with no cells', () => {
    expect(after('ArrowDown', false, at(0, 0), { rows: 30, columns: 0 })).toBeNull();
    expect(after('Home', true, at(0, 0), { rows: 0, columns: 4 })).toBeNull();
  });

  it('keeps a position outside the grid inside it', () => {
    expect(after('ArrowDown', false, at(40, 9), MONTH)).toEqual(at(LAST_ROW, LAST_COLUMN));
  });
});

describe('the modifier keys', () => {
  const ARROWS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'] as const;

  it.each(ARROWS)('Ctrl+%s is not handled', (key) => {
    expect(gridFocusAfter(key, CTRL, MIDDLE, MONTH)).toBeNull();
  });

  it.each(
    (['alt', 'meta', 'shift'] as const).flatMap((held) =>
      [...ARROWS, 'Home', 'End'].flatMap((key) =>
        [false, true].map((ctrl) => [held, key, ctrl] as const),
      ),
    ),
  )('with %s held, %s (ctrl %s) is not handled', (held, key, ctrl) => {
    expect(gridFocusAfter(key, { ...NO_KEY_MODIFIERS, ctrl, [held]: true }, MIDDLE, MONTH)).toBeNull();
  });

  it('reads the modifiers off a keyboard event', () => {
    expect(keyModifiersOf({ ctrlKey: true, altKey: false, metaKey: true, shiftKey: false })).toEqual({
      ctrl: true,
      alt: false,
      meta: true,
      shift: false,
    });
    expect(keyModifiersOf({ ctrlKey: false, altKey: false, metaKey: false, shiftKey: false })).toEqual(NO_KEY_MODIFIERS);
  });
});

describe('Space and Enter', () => {
  it('swallows Space, with or without Shift, and moves nothing', () => {
    expect(isInertGridKey(' ', NO_KEY_MODIFIERS)).toBe(true);
    expect(isInertGridKey(' ', { ...NO_KEY_MODIFIERS, shift: true })).toBe(true);
    expect(gridFocusAfter(' ', NO_KEY_MODIFIERS, MIDDLE, MONTH)).toBeNull();
  });

  it('leaves Enter, Tab, Space with Ctrl, Alt or Meta, and the arrows unswallowed', () => {
    for (const key of ['Enter', 'Tab', 'ArrowDown', 'Home', 'a']) expect(isInertGridKey(key, NO_KEY_MODIFIERS), key).toBe(false);
    for (const held of ['ctrl', 'alt', 'meta'] as const) {
      expect(isInertGridKey(' ', { ...NO_KEY_MODIFIERS, [held]: true }), held).toBe(false);
    }
  });
});

describe('the cell attributes', () => {
  it('names a cell by its data-row and data-column', () => {
    expect(GRID_CELL_SELECTOR).toBe('[role="gridcell"]');
    expect(gridCellSelectorOf(at(0, 0))).toBe('[role="gridcell"][data-row="0"][data-column="0"]');
    expect(gridCellSelectorOf(at(29, 3))).toBe('[role="gridcell"][data-row="29"][data-column="3"]');
  });

  it('reads a position back from a dataset, and nothing from a partial or malformed one', () => {
    expect(gridPositionOf({ row: '12', column: '3' })).toEqual(at(12, 3));
    expect(gridPositionOf({ row: '0', column: '0' })).toEqual(at(0, 0));
    for (const dataset of [
      {},
      { row: '1' },
      { column: '1' },
      { row: '-1', column: '0' },
      { row: '1.5', column: '0' },
      { row: '', column: '0' },
      { row: '1', column: 'x' },
    ]) {
      expect(gridPositionOf(dataset), JSON.stringify(dataset)).toBeNull();
    }
  });
});

describe('the one tab stop', () => {
  const rows = (today: number | null, length = 30) =>
    Array.from({ length }, (_, index) => ({ isToday: index === today }));

  it("starts on today's first team when the month shows today, otherwise on the first cell", () => {
    expect(initialGridFocusOf(rows(25))).toEqual(at(25, 0));
    expect(initialGridFocusOf(rows(null))).toEqual(at(0, 0));
    expect(initialGridFocusOf([])).toEqual(at(0, 0));
  });

  it('survives a re-render of the same month and resets when the month changes', () => {
    const remembered = { month: '2026-09', position: at(7, 2) };

    expect(gridTabStopOf(null, '2026-09', rows(25), 4)).toEqual(at(25, 0));
    expect(gridTabStopOf(remembered, '2026-09', rows(25), 4)).toEqual(at(7, 2));
    expect(gridTabStopOf(remembered, '2026-10', rows(null, 31), 4)).toEqual(at(0, 0));
    expect(gridTabStopOf(remembered, '2026-08', rows(3, 31), 4)).toEqual(at(3, 0));
  });

  it('stays inside the grid when the columns shrink', () => {
    expect(gridTabStopOf({ month: '2026-09', position: at(7, 3) }, '2026-09', rows(25), 2)).toEqual(at(7, 1));
    expect(gridTabStopOf({ month: '2026-09', position: at(7, 3) }, '2026-09', rows(25), 0)).toEqual(at(25, 0));
  });

  it('compares positions', () => {
    expect(isSameGridPosition(at(1, 2), at(1, 2))).toBe(true);
    expect(isSameGridPosition(at(1, 2), at(2, 1))).toBe(false);
  });
});
