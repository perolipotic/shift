import { readFileSync } from 'node:fs';

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { initLocalization, t } from '@/i18n';
import {
  ROTATION_UNCHANGED,
  emptyDraftOf,
  prefillOf,
  withEffectiveFrom,
  withStepAdded,
  withStepRemoved,
  withTeamStep,
  type RotationDraft,
} from '@/rotation/draft';
import { readRotation, rotationTeamsOf, type RotationSnapshot } from '@/rotation/list';
import { PILOT, TODAY, UJ5, answerOf, typeRow, type FixtureRows } from '@/rotation/rotation.fixture';
import {
  ROTATION_WARNINGS_FAILED,
  WARNING_CHAIN,
  WARNING_LIST,
  rotationWarningLinesOf,
  shownSaveOutcomeOf,
  warningTextOf,
  warningsSummaryOf,
  type RotationWarningLine,
  type WarningTranslate,
} from '@/rotation/warnings';

/**
 * Story 2.5's adapter, executed (AD-15): the saved draft handed to
 * `@shift/domain`, and each code it returns mapped to its key and values —
 * type names, formatted dates, the duration keys and the plural counts —
 * resolved here through the real `hr.json`.
 */

async function snapshotOf(rows: FixtureRows): Promise<RotationSnapshot> {
  const outcome = await readRotation({ select: () => Promise.resolve(answerOf(rows)) });

  if (!outcome.ok) throw new Error(outcome.code);

  return outcome.snapshot;
}

const translate: WarningTranslate = (key, values) => t(key, values);

/** Every line and its details, as the builder renders them. */
function textsOf(lines: readonly RotationWarningLine[]): readonly (readonly string[])[] {
  return lines.map((line) => [
    warningTextOf(line.text, translate),
    ...line.details.map((detail) => warningTextOf(detail, translate)),
  ]);
}

beforeAll(async () => {
  await initLocalization();
});

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('rotationWarningLinesOf — the pilot', () => {
  it('says the 24 h rest gap true on the clock, and nothing else', async () => {
    const snapshot = await snapshotOf(PILOT);
    const lines = rotationWarningLinesOf(snapshot, prefillOf(snapshot, TODAY), TODAY);

    expect(textsOf(lines)).toEqual([['24 h rada bez slobodnog dana između (Dan → Noć)']]);
    expect(warningTextOf(warningsSummaryOf(lines), translate)).toBe('1 upozorenje za sljedeći ciklus:');
  });

  it('never says "bez pauze"', async () => {
    const snapshot = await snapshotOf(PILOT);
    const lines = rotationWarningLinesOf(snapshot, prefillOf(snapshot, TODAY), TODAY);
    const text = textsOf(lines).flat().join(' ');

    expect(text).not.toMatch(/pauz/i);
  });

  it('warns of a gap and a duplicate when A and B share step 1, with dates and names', async () => {
    const snapshot = await snapshotOf(PILOT);
    const draft = withTeamStep(prefillOf(snapshot, TODAY), 'pilot-smjena-b', 0);
    const lines = rotationWarningLinesOf(snapshot, draft, TODAY);

    expect(textsOf(lines)).toEqual([
      [
        '2 dana u sljedećem ciklusu s radnim tipom na kojem nije nijedna smjena:',
        '26.09.2026: Noć',
        '29.09.2026: Dan',
      ],
      [
        '2 dana u sljedećem ciklusu s dvije ili više smjena na istom tipu:',
        '26.09.2026: Dan',
        '27.09.2026: Noć',
      ],
      ['24 h rada bez slobodnog dana između (Dan → Noć)'],
    ]);
    expect(warningTextOf(warningsSummaryOf(lines), translate)).toBe('3 upozorenja za sljedeći ciklus:');
  });

  it('says an endless pattern as one whole cycle', async () => {
    const snapshot = await snapshotOf(PILOT);
    const draft = withStepAdded(emptyDraftOf(rotationTeamsOf(snapshot), TODAY), 'pilot-dan');

    expect(textsOf(rotationWarningLinesOf(snapshot, draft, TODAY)).at(-1)).toEqual([
      'Uzorak je bez slobodnog dana: 12 h rada u svakom ciklusu (Dan)',
    ]);
  });

  it('says a run with a type with no times has an unknown duration, never a guessed one', async () => {
    const rows: FixtureRows = {
      ...PILOT,
      types: [
        ...PILOT.types.filter((row) => row['id'] !== 'pilot-noc'),
        typeRow('pilot-noc', 'Noć', '2026-09-25T20:07:49.331741+00:00'),
      ],
    };
    const snapshot = await snapshotOf(rows);
    const draft = prefillOf(snapshot, TODAY);

    expect(textsOf(rotationWarningLinesOf(snapshot, draft, TODAY))).toEqual([
      ['Rad bez slobodnog dana između (Dan → Noć), trajanje nepoznato'],
    ]);
    const endless = withStepRemoved(withStepRemoved(draft, 3), 2);

    expect(textsOf(rotationWarningLinesOf(snapshot, endless, TODAY)).at(-1)).toEqual([
      'Uzorak je bez slobodnog dana (Dan → Noć), trajanje nepoznato',
    ]);
  });
});

describe('rotationWarningLinesOf — UJ-5', () => {
  it('reports gaps on 4 of 5 dates, no duplicate, and a 24 h rest gap J → P → N', async () => {
    const snapshot = await snapshotOf(UJ5);
    const lines = rotationWarningLinesOf(snapshot, prefillOf(snapshot, TODAY), TODAY);

    expect(textsOf(lines)).toEqual([
      [
        '4 dana u sljedećem ciklusu s radnim tipom na kojem nije nijedna smjena:',
        '27.09.2026: Jutarnja',
        '28.09.2026: Jutarnja, Popodnevna',
        '29.09.2026: Popodnevna, Noćna',
        '30.09.2026: Noćna',
      ],
      ['24 h rada bez slobodnog dana između (Jutarnja → Popodnevna → Noćna)'],
    ]);
  });
});

describe('the counts use all three plural forms', () => {
  const GAP = 'u sljedećem ciklusu s radnim tipom na kojem nije nijedna smjena:';
  const SUMMARY = 'za sljedeći ciklus:';

  it.each([
    [1, `1 dan ${GAP}`, `1 upozorenje ${SUMMARY}`],
    [2, `2 dana ${GAP}`, `2 upozorenja ${SUMMARY}`],
    [5, `5 dana ${GAP}`, `5 upozorenja ${SUMMARY}`],
    [21, `21 dan ${GAP}`, `21 upozorenje ${SUMMARY}`],
  ])('%i', (count, gap, summary) => {
    const gapText = { key: 'rotation.builder.warnings.coverageGap', values: { count } } as const;
    const summaryText = { key: 'rotation.builder.warnings.summary', values: { count } } as const;

    expect(warningTextOf(gapText, translate)).toBe(gap);
    expect(warningTextOf(summaryText, translate)).toBe(summary);
  });

  it('joins a list with commas and a run with arrows', () => {
    const date = {
      key: 'rotation.builder.warnings.date',
      values: { date: '01.10.2026', types: { join: WARNING_LIST, items: ['A', 'B'] } },
    } as const;
    const run = {
      key: 'rotation.builder.warnings.restGapUnknown',
      values: { types: { join: WARNING_CHAIN, items: ['A', 'B'] } },
    } as const;

    expect(warningTextOf(date, translate)).toBe('01.10.2026: A, B');
    expect(warningTextOf(run, translate)).toBe('Rad bez slobodnog dana između (A → B), trajanje nepoznato');
  });
});

describe('shownSaveOutcomeOf', () => {
  it('passes a refused save through, with no warnings', async () => {
    const snapshot = await snapshotOf(PILOT);
    const refused = { ok: false, code: ROTATION_UNCHANGED, afterPattern: false } as const;

    expect(shownSaveOutcomeOf(refused, snapshot, prefillOf(snapshot, TODAY), TODAY)).toBe(refused);
  });

  it('gives a landed save its warnings', async () => {
    const snapshot = await snapshotOf(PILOT);
    const shown = shownSaveOutcomeOf({ ok: true }, snapshot, prefillOf(snapshot, TODAY), TODAY);

    expect(shown.ok && textsOf(shown.warnings)).toEqual([
      ['24 h rada bez slobodnog dana između (Dan → Noć)'],
    ]);
  });

  it('computes the warnings from the effective date the save used, not from today (story 2.6)', async () => {
    const NEXT_WEEK = '2026-10-03';
    const snapshot = await snapshotOf(PILOT);
    // A and B share step 1: a coverage gap. The anchor stays today; the
    // change applies from next week, so the next cycle is 03.10.–06.10.
    const draft = withEffectiveFrom(withTeamStep(prefillOf(snapshot, TODAY), 'pilot-smjena-b', 0), NEXT_WEEK);
    const shown = shownSaveOutcomeOf({ ok: true }, snapshot, draft, draft.effectiveFrom);
    const [gap] = shown.ok ? textsOf(shown.warnings) : [];

    expect(gap?.[0]).toBe('2 dana u sljedećem ciklusu s radnim tipom na kojem nije nijedna smjena:');
    expect(gap?.[1]).toMatch(/^03\.10\.2026: /);
    expect(gap?.join(' ')).not.toContain('26.09.2026');
  });

  it('logs a throw and keeps the plain confirmation', async () => {
    const snapshot = await snapshotOf(PILOT);
    const broken: RotationDraft = withStepAdded(prefillOf(snapshot, TODAY), 'no-such-type');

    expect(shownSaveOutcomeOf({ ok: true }, snapshot, broken, TODAY)).toEqual({ ok: true, warnings: [] });
    expect(console.error).toHaveBeenCalledWith(ROTATION_WARNINGS_FAILED, expect.any(RangeError));
  });
});

describe('the module', () => {
  it('projects nothing itself and writes no warning text', () => {
    const source = readFileSync(new URL('./warnings.ts', import.meta.url), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    expect(code).not.toContain('%');
    expect(code).not.toMatch(/projectedShiftType|projectedStepId|daysBetween/);
    expect(code).not.toMatch(/pauz|slobodn|smjen/i);
  });
});
