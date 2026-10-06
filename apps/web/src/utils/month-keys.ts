import { LOCALE, formatIsoMonthName, formatIsoMonthShortName } from '@/lib/i18n/format';

/**
 * The month toolbar's keyboard and grid rules (story 7.4), as a pure module
 * (AD-15): `components/month-nav.tsx` only moves the month and DOM focus to
 * what these return.
 *
 * Months are `YYYY-MM` within the calendar's bounds, 0001-01 to 9999-12 — the
 * same bounds `adjacentMonth` holds the ‹ › buttons to (story 3.1).
 */

/** The first and last years the calendar represents. */
export const FIRST_YEAR = 1;
export const LAST_YEAR = 9999;

/** The month picker's columns: ↑ and ↓ move by one row of them. */
export const MONTH_GRID_COLUMNS = 4;

/** The modifier keys held with a key, as `KeyboardEvent` has them. */
export interface MonthKeyModifiers {
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}

function held(modifiers: MonthKeyModifiers): boolean {
  return modifiers.ctrlKey || modifiers.altKey || modifiers.metaKey || modifiers.shiftKey;
}

/**
 * The month step a key asks for inside the toolbar: PgUp the month before
 * (`-1`), PgDn the month after (`1`), `null` for any other key — and for
 * either with a modifier held, which belongs to the browser (Ctrl+PgUp
 * changes the tab).
 */
export function monthStepOfKey(key: string, modifiers: MonthKeyModifiers): -1 | 1 | null {
  if (held(modifiers)) return null;
  if (key === 'PageUp') return -1;
  if (key === 'PageDown') return 1;

  return null;
}

function indexOf(month: string): number {
  return Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
}

function monthAt(index: number): string {
  const year = Math.floor(index / 12);

  return `${String(year).padStart(4, '0')}-${String(index - year * 12 + 1).padStart(2, '0')}`;
}

/**
 * `month` moved by `step` months, crossing years; `month` itself where that
 * would leave the calendar.
 */
export function monthMovedBy(month: string, step: number): string {
  const moved = indexOf(month) + step;
  const year = Math.floor(moved / 12);

  return year < FIRST_YEAR || year > LAST_YEAR ? month : monthAt(moved);
}

/**
 * Where the month picker's focus goes from `month` on `key`: ← and → by one
 * month, ↑ and ↓ by one row ({@link MONTH_GRID_COLUMNS}), crossing into the
 * year before or after. `null` for a key the picker does not handle — Enter
 * and Space press the focused month, Tab leaves it, Escape closes it.
 */
export function pickerMonthAfter(key: string, month: string, modifiers: MonthKeyModifiers): string | null {
  if (held(modifiers)) return null;

  const step =
    key === 'ArrowLeft'
      ? -1
      : key === 'ArrowRight'
        ? 1
        : key === 'ArrowUp'
          ? -MONTH_GRID_COLUMNS
          : key === 'ArrowDown'
            ? MONTH_GRID_COLUMNS
            : null;

  return step === null ? null : monthMovedBy(month, step);
}

/** `year`'s twelve months, `YYYY-01` to `YYYY-12`, in grid order. */
export function monthsOfYear(year: number): readonly string[] {
  return Array.from({ length: 12 }, (_, index) => monthAt(year * 12 + index));
}

/** The year a `YYYY-MM` falls in. */
export function yearOfMonth(month: string): number {
  return Number(month.slice(0, 4));
}

/** `month`'s month of the year in `year`: where the year ‹ › keep the picker's place. */
export function sameMonthIn(month: string, year: number): string {
  return monthAt(year * 12 + Number(month.slice(5, 7)) - 1);
}

/** `2026`, or `0001` — a year as the month heading writes it. */
export function yearTextOf(year: number): string {
  return String(year).padStart(4, '0');
}

/**
 * `sij` — `month`'s short name, the picker's button.
 *
 * @throws RangeError when `month` is not a `YYYY-MM` the formatter reads.
 */
export function monthShortNameOf(month: string): string {
  const name = formatIsoMonthShortName(`${month}-01`);

  if (name === null) throw new RangeError(`the month ${month} has no short name`);

  return name;
}

/**
 * `Ožujak` — `month`'s full name, capitalized as it starts a name: a picker
 * button's accessible name, `Ožujak 2025`, holds its visible short name.
 *
 * @throws RangeError when `month` is not a `YYYY-MM` the formatter reads.
 */
export function monthNameOf(month: string): string {
  const name = formatIsoMonthName(`${month}-01`);

  if (name === null) throw new RangeError(`the month ${month} has no name`);

  return `${name.charAt(0).toLocaleUpperCase(LOCALE)}${name.slice(1)}`;
}
