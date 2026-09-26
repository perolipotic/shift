import type { CalendarMonth } from '@/calendar/month';

/**
 * The calendar's modifier vocabulary (story 3.2b, UX-DR8, UX-DR12): a FIXED
 * set of four marks any cell can carry, alone or together — conflict,
 * overridden, leave and uncovered — each with a glyph, a fill or ring and a
 * label. Later stories only NAME the marks a cell carries (3.5 writes
 * `modifiers: ['overridden']`); the look, the legend and the words are here,
 * once.
 *
 * NEVER COLOUR ALONE: every modifier has a glyph and a label beside its
 * treatment, and a cell's label for assistive technology names each one.
 *
 * NOTHING DERIVES A MODIFIER YET. Every cell carries `modifiers: []` in this
 * story; which data produces which mark is 3.5's, 3.6's and Epics 4–5's.
 *
 * PURE, and executed by the node suite (AD-15): `routes/kalendar.tsx` renders
 * what these rules return.
 */

/** The four modifiers' ids. `destructive` is conflict's alone; no other mark uses it. */
export const MODIFIER_CONFLICT = 'conflict';
export const MODIFIER_OVERRIDDEN = 'overridden';
export const MODIFIER_LEAVE = 'leave';
export const MODIFIER_UNCOVERED = 'uncovered';

/** The four modifiers, in their canonical order. */
export const CALENDAR_MODIFIER_IDS = [
  MODIFIER_CONFLICT,
  MODIFIER_OVERRIDDEN,
  MODIFIER_LEAVE,
  MODIFIER_UNCOVERED,
] as const;

export type CalendarModifier = (typeof CALENDAR_MODIFIER_IDS)[number];

/** How a modifier is drawn: a 2 px inset ring, or a hatch over the type's own fill. */
export type ModifierTreatment = 'ring' | 'hatch';

/** One modifier as the calendar draws and names it. */
export interface CalendarModifierEntry {
  readonly id: CalendarModifier;
  /** Beside the name or letter, `aria-hidden`: the label carries the meaning. */
  readonly glyph: string;
  readonly treatment: ModifierTreatment;
  /** What it is called, in the legend and in a cell's label. */
  readonly labelKey: ReturnType<typeof modifierMessageKey>;
}

/** The vocabulary, in canonical order. */
export const CALENDAR_MODIFIERS: readonly CalendarModifierEntry[] = [
  { id: MODIFIER_CONFLICT, glyph: '⚠', treatment: 'ring', labelKey: modifierMessageKey(MODIFIER_CONFLICT) },
  { id: MODIFIER_OVERRIDDEN, glyph: '✎', treatment: 'ring', labelKey: modifierMessageKey(MODIFIER_OVERRIDDEN) },
  { id: MODIFIER_LEAVE, glyph: '◷', treatment: 'hatch', labelKey: modifierMessageKey(MODIFIER_LEAVE) },
  { id: MODIFIER_UNCOVERED, glyph: '◌', treatment: 'hatch', labelKey: modifierMessageKey(MODIFIER_UNCOVERED) },
];

/** The label a modifier is named by, in the legend and in a cell's label. Exhaustive. */
export function modifierMessageKey(
  modifier: CalendarModifier,
):
  | 'kalendar.modifier.conflict'
  | 'kalendar.modifier.overridden'
  | 'kalendar.modifier.leave'
  | 'kalendar.modifier.uncovered' {
  switch (modifier) {
    case MODIFIER_CONFLICT:
      return 'kalendar.modifier.conflict';
    case MODIFIER_OVERRIDDEN:
      return 'kalendar.modifier.overridden';
    case MODIFIER_LEAVE:
      return 'kalendar.modifier.leave';
    case MODIFIER_UNCOVERED:
      return 'kalendar.modifier.uncovered';
    default: {
      const unhandled: never = modifier;

      return unhandled;
    }
  }
}

/** What a cell with no rotation in effect is named for assistive technology. */
export function noRotationMessageKey(): 'kalendar.noRotation' {
  return 'kalendar.noRotation';
}

/**
 * The rings, precomposed in `index.css` over the existing tokens: conflict's
 * `destructive` ring outermost, overridden's inside it, so both stay visible
 * together as nested 2 px bands.
 */
export const RING_CONFLICT_CLASS = 'modifier-ring-conflict';
export const RING_OVERRIDDEN_CLASS = 'modifier-ring-overridden';
export const RING_BOTH_CLASS = 'modifier-ring-conflict-overridden';

/**
 * The hatches, `background-image` layers over the type's `bg-*` base fill:
 * leave at −45°, uncovered at 45°, and both together a cross-hatch.
 */
export const HATCH_LEAVE_CLASS = 'modifier-hatch-leave';
export const HATCH_UNCOVERED_CLASS = 'modifier-hatch-uncovered';
export const HATCH_BOTH_CLASS = 'modifier-hatch-leave-uncovered';

/** The modifiers given, in canonical order, each once. */
export function canonicalModifiersOf(modifiers: readonly CalendarModifier[]): readonly CalendarModifier[] {
  const present = new Set(modifiers);

  return CALENDAR_MODIFIER_IDS.filter((modifier) => present.has(modifier));
}

/** How a set of modifiers draws on one cell. */
export interface ModifierTreatmentShown {
  /** The modifiers, in canonical order, each once. */
  readonly modifiers: readonly CalendarModifier[];
  /** The ring and hatch classes, space-separated; `''` for none. */
  readonly className: string;
  /** The glyphs, in canonical order. */
  readonly glyphs: readonly string[];
  /** The glyphs as one run, drawn beside the name or letter: `⚠✎`. */
  readonly glyphText: string;
}

function ringClassOf(conflict: boolean, overridden: boolean): string | null {
  if (conflict && overridden) return RING_BOTH_CLASS;
  if (conflict) return RING_CONFLICT_CLASS;
  if (overridden) return RING_OVERRIDDEN_CLASS;

  return null;
}

function hatchClassOf(leave: boolean, uncovered: boolean): string | null {
  if (leave && uncovered) return HATCH_BOTH_CLASS;
  if (leave) return HATCH_LEAVE_CLASS;
  if (uncovered) return HATCH_UNCOVERED_CLASS;

  return null;
}

/**
 * The classes and glyphs of any subset of the four, composed: both rings stay
 * visible together, both hatches stay visible together, and each overlays the
 * type's base fill rather than replacing it.
 */
export function modifierTreatmentOf(modifiers: readonly CalendarModifier[]): ModifierTreatmentShown {
  const shown = canonicalModifiersOf(modifiers);
  const has = (modifier: CalendarModifier): boolean => shown.includes(modifier);
  const classes = [
    ringClassOf(has(MODIFIER_CONFLICT), has(MODIFIER_OVERRIDDEN)),
    hatchClassOf(has(MODIFIER_LEAVE), has(MODIFIER_UNCOVERED)),
  ].filter((name) => name !== null);

  const glyphs = shown.map((modifier) => glyphOf(modifier));

  return { modifiers: shown, className: classes.join(' '), glyphs, glyphText: glyphs.join('') };
}

/**
 * A modifier's glyph.
 *
 * @throws RangeError for a value outside the vocabulary — never a blank mark.
 */
export function glyphOf(modifier: CalendarModifier): string {
  const entry = CALENDAR_MODIFIERS.find((one) => one.id === modifier);

  if (entry === undefined) throw new RangeError(`${String(modifier)} is not a calendar modifier`);

  return entry.glyph;
}

/**
 * The modifiers present on the cells shown, in canonical order: the legend.
 * Empty means no legend at all — no tooltip and no info icon either.
 */
export function legendOf(
  cells: Iterable<{ readonly modifiers: readonly CalendarModifier[] } | null>,
): readonly CalendarModifier[] {
  const present: CalendarModifier[] = [];

  for (const cell of cells) if (cell !== null) present.push(...cell.modifiers);

  return canonicalModifiersOf(present);
}

/** What separates the parts of a cell's label, and the marks' names in the day list. */
export const LABEL_SEPARATOR = ', ';

/** Every key a cell's label resolves through. */
export type CellLabelKey = ReturnType<typeof modifierMessageKey> | ReturnType<typeof noRotationMessageKey>;

export type CellLabelTranslate = (key: CellLabelKey) => string;

/** What a cell's label is read from: its date, its team, and the cell itself. */
export interface CellLabelSource {
  /** `subota` */
  readonly weekday: string;
  /** `26.09.` */
  readonly dayMonth: string;
  /** The team's full name — never its letter. */
  readonly teamName: string;
  /** The type's name — never its letter — or `null` where no rotation is in effect. */
  readonly name: string | null;
  readonly range: string | null;
  readonly modifiers: readonly CalendarModifier[];
}

/**
 * A cell's full label for assistive technology, the same at every width:
 * `subota 26.09., Smjena A, Noć, 19:00–07:00`, then each modifier's label in
 * canonical order. Never a letter.
 */
export function cellLabelOf(source: CellLabelSource, translate: CellLabelTranslate): string {
  return [
    `${source.weekday} ${source.dayMonth}`,
    source.teamName,
    source.name ?? translate(noRotationMessageKey()),
    ...(source.range === null ? [] : [source.range]),
    ...canonicalModifiersOf(source.modifiers).map((modifier) => translate(modifierMessageKey(modifier))),
  ].join(LABEL_SEPARATOR);
}

/**
 * The marks' names as the day list reads them after the type and range, each
 * led by {@link LABEL_SEPARATOR} (`, Konflikt, Godišnji`), in canonical order;
 * `''` for none.
 */
export function modifierNamesTextOf(modifiers: readonly CalendarModifier[], translate: CellLabelTranslate): string {
  return canonicalModifiersOf(modifiers)
    .map((modifier) => `${LABEL_SEPARATOR}${translate(modifierMessageKey(modifier))}`)
    .join('');
}

/**
 * Every grid cell's {@link cellLabelOf}, row for row and column for column:
 * each read from its row's date, its column's team and itself.
 *
 * @throws RangeError for a cell with no column — never a label with no team.
 */
export function gridCellLabelsOf(
  month: Pick<CalendarMonth, 'columns' | 'rows'>,
  translate: CellLabelTranslate,
): readonly (readonly string[])[] {
  return month.rows.map((row) =>
    row.cells.map((cell, column) => {
      const team = month.columns[column];

      if (team === undefined) throw new RangeError(`the cell of ${cell.teamId} on ${row.date} has no column`);

      return cellLabelOf(
        {
          weekday: row.weekday,
          dayMonth: row.dayMonth,
          teamName: team.name,
          name: cell.name,
          range: cell.range,
          modifiers: cell.modifiers,
        },
        translate,
      );
    }),
  );
}
