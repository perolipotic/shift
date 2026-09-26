import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import {
  CALENDAR_MODIFIERS,
  CALENDAR_MODIFIER_IDS,
  HATCH_BOTH_CLASS,
  HATCH_LEAVE_CLASS,
  HATCH_UNCOVERED_CLASS,
  RING_BOTH_CLASS,
  RING_CONFLICT_CLASS,
  RING_OVERRIDDEN_CLASS,
  LABEL_SEPARATOR,
  cellLabelOf,
  glyphOf,
  gridCellLabelsOf,
  legendOf,
  modifierMessageKey,
  modifierNamesTextOf,
  modifierTreatmentOf,
  noRotationMessageKey,
  type CalendarModifier,
  type CellLabelTranslate,
} from '@/calendar/modifiers';
import { initLocalization, t } from '@/i18n';

/**
 * Story 3.2b's modifier vocabulary, executed (AD-15): the fixed four, their
 * glyphs and labels, every subset composing, the legend and the cell label —
 * every row of the spec's matrix that is not the keyboard's.
 */

const translate: CellLabelTranslate = (key) => t(key);

beforeAll(async () => {
  await initLocalization();
});

/** Every subset of the four, the empty one included. */
function subsets(): readonly (readonly CalendarModifier[])[] {
  return Array.from({ length: 2 ** CALENDAR_MODIFIER_IDS.length }, (_, mask) =>
    CALENDAR_MODIFIER_IDS.filter((_, index) => (mask >> index) & 1),
  );
}

describe('the vocabulary', () => {
  it('is the four marks, in canonical order, each with its glyph, treatment and label', () => {
    expect(CALENDAR_MODIFIERS.map((entry) => entry.id)).toEqual(['conflict', 'overridden', 'leave', 'uncovered']);
    expect(CALENDAR_MODIFIERS.map((entry) => entry.glyph)).toEqual(['⚠', '✎', '◷', '◌']);
    expect(CALENDAR_MODIFIERS.map((entry) => entry.treatment)).toEqual(['ring', 'ring', 'hatch', 'hatch']);
    expect(CALENDAR_MODIFIERS.map((entry) => entry.labelKey)).toEqual([
      'kalendar.modifier.conflict',
      'kalendar.modifier.overridden',
      'kalendar.modifier.leave',
      'kalendar.modifier.uncovered',
    ]);
    expect(CALENDAR_MODIFIERS.map((entry) => t(entry.labelKey))).toEqual([
      'Konflikt',
      'Izmijenjeno',
      'Godišnji',
      'Nepokriveno',
    ]);
  });

  it.each(CALENDAR_MODIFIER_IDS)('never colour alone: %s has a glyph, a label and a treatment', (modifier) => {
    expect(glyphOf(modifier)).toMatch(/^\S$/u);
    expect(modifierMessageKey(modifier)).toBe(`kalendar.modifier.${modifier}`);
    expect(t(modifierMessageKey(modifier))).not.toMatch(/⟦/);
    expect(modifierTreatmentOf([modifier]).className).not.toBe('');
    expect(modifierTreatmentOf([modifier]).glyphs).toEqual([glyphOf(modifier)]);
  });

  it('draws every class from a utility in index.css, over the existing tokens, destructive for conflict alone', () => {
    const css = readFileSync(fileURLToPath(new URL('../index.css', import.meta.url)), 'utf8');
    const utilities = new Map(
      [...css.matchAll(/@utility (modifier-[a-z-]+) \{([\s\S]*?)\n\}/g)].map((found) => [found[1], found[2] ?? '']),
    );

    for (const name of [RING_CONFLICT_CLASS, RING_OVERRIDDEN_CLASS, RING_BOTH_CLASS, HATCH_LEAVE_CLASS, HATCH_UNCOVERED_CLASS, HATCH_BOTH_CLASS]) {
      const body = utilities.get(name);

      expect(body, `${name} is not a utility`).toBeDefined();
      expect(body, name).toMatch(/var\(--(destructive|modifier-(overridden|leave|uncovered))\)/);
      expect(body?.includes('--destructive'), name).toBe(name.includes('conflict'));
      expect(body, name).not.toMatch(/accent|oklch|#[0-9a-f]{3}/i);
    }
    // The rings nest: conflict's band outermost, overridden's inside it.
    expect(utilities.get(RING_BOTH_CLASS)).toMatch(/2px var\(--destructive\)[\s\S]*4px var\(--modifier-overridden\)/);
    // The hatches layer at their own angles.
    expect(utilities.get(HATCH_LEAVE_CLASS)).toContain('-45deg');
    expect(utilities.get(HATCH_UNCOVERED_CLASS)).toMatch(/\(\s*45deg/);
    expect(utilities.get(HATCH_BOTH_CLASS)).toMatch(/-45deg[\s\S]*\(\s*45deg/);
  });

  it('picks one class per kind for one mark', () => {
    expect(modifierTreatmentOf(['conflict']).className).toBe(RING_CONFLICT_CLASS);
    expect(modifierTreatmentOf(['overridden']).className).toBe(RING_OVERRIDDEN_CLASS);
    expect(modifierTreatmentOf(['leave']).className).toBe(HATCH_LEAVE_CLASS);
    expect(modifierTreatmentOf(['uncovered']).className).toBe(HATCH_UNCOVERED_CLASS);
    expect(modifierTreatmentOf([]).className).toBe('');
  });
});

describe('composing', () => {
  it('both rings and a deduplicated, canonical glyph run', () => {
    const shown = modifierTreatmentOf(['overridden', 'conflict', 'conflict']);

    expect(shown.modifiers).toEqual(['conflict', 'overridden']);
    expect(shown.className).toBe(RING_BOTH_CLASS);
    expect(shown.glyphs).toEqual(['⚠', '✎']);
    expect(shown.glyphText).toBe('⚠✎');
  });

  it('both hatches together', () => {
    expect(modifierTreatmentOf(['uncovered', 'leave']).className).toBe(HATCH_BOTH_CLASS);
  });

  it.each(subsets().map((subset) => [subset.join('+') || 'none', subset] as const))(
    'the subset %s composes: one ring class, one hatch class, a glyph per mark',
    (_, subset) => {
      const reversed = [...subset].reverse();
      const shown = modifierTreatmentOf([...reversed, ...reversed]);
      const classes = shown.className === '' ? [] : shown.className.split(' ');
      const rings = classes.filter((name) => name.startsWith('modifier-ring-'));
      const hatches = classes.filter((name) => name.startsWith('modifier-hatch-'));
      const has = (modifier: CalendarModifier) => subset.includes(modifier);

      expect(shown.modifiers).toEqual(subset);
      expect(shown.glyphs).toEqual(subset.map((modifier) => glyphOf(modifier)));
      expect(classes).toHaveLength(rings.length + hatches.length);
      expect(rings).toHaveLength(has('conflict') || has('overridden') ? 1 : 0);
      expect(hatches).toHaveLength(has('leave') || has('uncovered') ? 1 : 0);
      // Each ring or hatch present is the one naming every mark of its kind.
      expect(rings[0]?.includes('conflict') ?? false).toBe(has('conflict'));
      expect(rings[0]?.includes('overridden') ?? false).toBe(has('overridden'));
      expect(hatches[0]?.includes('leave') ?? false).toBe(has('leave'));
      expect(hatches[0]?.includes('uncovered') ?? false).toBe(has('uncovered'));
    },
  );
});

describe('the legend', () => {
  const plain = { modifiers: [] as readonly CalendarModifier[] };

  it('is empty without marks', () => {
    expect(legendOf([])).toEqual([]);
    expect(legendOf([plain, plain, null])).toEqual([]);
  });

  it('lists the marks present, in canonical order, each once', () => {
    expect(legendOf([plain, { modifiers: ['uncovered'] }, plain])).toEqual(['uncovered']);
    expect(
      legendOf([{ modifiers: ['uncovered', 'conflict'] }, null, { modifiers: ['leave', 'conflict'] }]),
    ).toEqual(['conflict', 'leave', 'uncovered']);
  });
});

describe('the cell label', () => {
  const day = { weekday: 'subota', dayMonth: '26.09.', teamName: 'Smjena A' };

  it('names a working day in full', () => {
    expect(cellLabelOf({ ...day, name: 'Noć', range: '19:00–07:00', modifiers: [] }, translate)).toBe(
      'subota 26.09., Smjena A, Noć, 19:00–07:00',
    );
  });

  it('names a day off and a day with no rotation', () => {
    expect(
      cellLabelOf({ ...day, teamName: 'Smjena B', name: 'Slobodno', range: null, modifiers: [] }, translate),
    ).toBe('subota 26.09., Smjena B, Slobodno');
    expect(cellLabelOf({ ...day, name: null, range: null, modifiers: [] }, translate)).toBe(
      'subota 26.09., Smjena A, Bez rotacije',
    );
    expect(t(noRotationMessageKey())).toBe('Bez rotacije');
  });

  it('names each modifier, in canonical order', () => {
    expect(
      cellLabelOf({ ...day, name: 'Noć', range: '19:00–07:00', modifiers: ['leave', 'conflict'] }, translate),
    ).toBe('subota 26.09., Smjena A, Noć, 19:00–07:00, Konflikt, Godišnji');
  });
});

describe('the failures are loud, never blank', () => {
  it('refuses a glyph for a value outside the vocabulary', () => {
    expect(() => glyphOf('unknown' as CalendarModifier)).toThrow(RangeError);
  });

  it('refuses a label for a cell with no column', () => {
    const cell = { teamId: 'team-x', name: 'Dan', range: null, modifiers: [] as readonly CalendarModifier[] };
    const row = { date: '2026-09-26', weekday: 'subota', dayMonth: '26.09.', cells: [cell, cell] };
    const month = { columns: [{ name: 'Smjena A' }], rows: [row] } as unknown as Parameters<typeof gridCellLabelsOf>[0];

    expect(() => gridCellLabelsOf(month, translate)).toThrow(RangeError);
    expect(
      gridCellLabelsOf({ ...month, rows: [{ ...row, cells: [cell] }] } as unknown as typeof month, translate),
    ).toEqual([['subota 26.09., Smjena A, Dan']]);
  });
});

describe("the day list's names of the marks", () => {
  it('leads each name with the separator, in canonical order, and is empty without marks', () => {
    expect(LABEL_SEPARATOR).toBe(', ');
    expect(modifierNamesTextOf([], translate)).toBe('');
    expect(modifierNamesTextOf(['leave', 'conflict', 'leave'], translate)).toBe(', Konflikt, Godišnji');
    expect(modifierNamesTextOf(['uncovered'], translate)).toBe(', Nepokriveno');
  });
});
