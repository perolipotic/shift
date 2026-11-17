import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  HISTORY_EXPORT_FAILED,
  HISTORY_EXPORT_FRAME_WAIT_MS,
  HISTORY_EXPORT_LIMIT,
  exportHistory,
  historyExportCount,
  historyExportOverLimit,
  historyExportPressOf,
  historyExportRefusalOf,
  historyExportDisabled,
  historyExportEmpty,
  historyExportMessageKey,
  historyExportOf,
  yieldToUi,
  type HistoryExport,
  type HistoryExportInput,
  type HistoryExportView,
} from '@/features/history/services/history-export';
import { historyKindText, type HistoryRow } from '@/features/history/services/history-rows';
import type { HistorySearchFilters } from '@/features/history/services/history-search';
import { initLocalization, t } from '@/lib/i18n';

/**
 * Story 14.3's rules, executed: the document is the ready view's own rows —
 * the same array the table drew, in order, every cell the row's own text —
 * under a header naming the organization, the period, the filters, the
 * summary, the generation time and where history begins.
 */

const ZONE = 'Europe/Zagreb';

function row(overrides: Partial<HistoryRow> & Pick<HistoryRow, 'id'>): HistoryRow {
  return {
    time: '10.11.2026 09:05',
    author: 'Ana Anić',
    kind: 'Smjena · promijenjeno',
    subject: 'Smjena A',
    reconstructed: false,
    marker: false,
    changes: [],
    ...overrides,
  };
}

const RENAME = row({
  id: '3',
  changes: [{ column: 'name', field: 'Naziv', before: 'Smjena A', after: 'Smjena Č' }],
});
const ADDITION = row({
  id: '2',
  kind: 'Smjena · dodano',
  changes: [{ column: 'name', field: 'Naziv', before: null, after: 'Smjena Đ' }],
});
const DELETION = row({
  id: '1',
  kind: 'Smjena · obrisano',
  reconstructed: true,
  changes: [
    { column: 'name', field: 'Naziv', before: 'Smjena Ž', after: null },
    { column: 'archived', field: 'Arhivirano', before: 'Da', after: null },
  ],
});
const MARKER = row({ id: '0', kind: 'Organizacija · početak', subject: 'Početak bilježenja povijesti', marker: true });

const FILTERS: HistorySearchFilters = { period: '30-dana', member: null, team: null, kind: null };

function viewOf(overrides: Partial<HistoryExportView> = {}): HistoryExportView {
  return {
    rows: [RENAME, ADDITION, DELETION],
    shown: 3,
    total: 7,
    members: [{ id: 'ana', label: 'Ana Anić', count: 3 }],
    teams: [{ id: 'a', label: 'Smjena A', count: 3 }],
    begins: null,
    period: { from: '2026-10-18', to: '2026-11-16' },
    organizationName: 'JVP Grad',
    zone: ZONE,
    ...overrides,
  };
}

function inputOf(view: HistoryExportView = viewOf(), filters: HistorySearchFilters = FILTERS): HistoryExportInput {
  // 16 Nov 2026 13:42 UTC is 14:42 in Zagreb.
  return { view, filters, generatedAt: new Date('2026-11-16T13:42:00Z') };
}

beforeAll(async () => {
  await initLocalization();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the rows are the screen’s', () => {
  it('holds exactly the view’s rows, in order, each cell the row’s own text', () => {
    const view = viewOf();
    const model = historyExportOf(inputOf(view));

    expect(model.rows).toHaveLength(view.rows.length);
    expect(model.rows.map((cells) => [cells.time, cells.author, cells.kind, cells.subject])).toEqual(
      view.rows.map((shown) => [shown.time, shown.author, shown.kind, shown.subject]),
    );
  });

  it('draws the columns Vrijeme, Autor, Vrsta, Predmet, Bilo and Sada', () => {
    expect(historyExportOf(inputOf()).columns).toEqual(['Vrijeme', 'Autor', 'Vrsta', 'Predmet', 'Bilo', 'Sada']);
  });

  it('puts a rename’s sides apart, an addition’s on Sada alone and a deletion’s on Bilo alone', () => {
    const [rename, addition, deletion] = historyExportOf(inputOf()).rows;

    expect(rename?.changes).toEqual([{ before: 'Naziv: Smjena A', after: 'Naziv: Smjena Č' }]);
    expect(rename?.none).toBeNull();
    expect(addition?.changes).toEqual([{ before: '', after: 'Naziv: Smjena Đ' }]);
    expect(deletion?.changes).toEqual([
      { before: 'Naziv: Smjena Ž', after: '' },
      { before: 'Arhivirano: Da', after: '' },
    ]);
  });

  it('says a row without a visible field once, across both sides', () => {
    const model = historyExportOf(inputOf(viewOf({ rows: [row({ id: '9' })] })));

    expect(model.rows[0]?.changes).toEqual([]);
    expect(model.rows[0]?.none).toBe('Bez promijenjenih polja');
  });

  it('badges the start of history and a reconstructed row as the table does, and nothing else', () => {
    const model = historyExportOf(inputOf(viewOf({ rows: [RENAME, DELETION, MARKER] })));

    expect(model.rows.map((cells) => cells.badge)).toEqual([null, 'Rekonstruirano', 'Početak povijesti']);
  });
});

describe('the header', () => {
  it('names the organization, the period, every filter as `sve`, the summary and the generation time in the zone', () => {
    const model = historyExportOf(inputOf());

    expect(model.title).toBe('Povijest promjena');
    expect(model.lines).toEqual([
      'Organizacija: JVP Grad',
      'Razdoblje: zadnjih 30 dana (18.10.2026 – 16.11.2026)',
      'Osoba: sve',
      'Smjena: sve',
      'Vrsta: sve',
      'Prikazano: 3 promjene od 7',
      'Izrađeno: 16.11.2026 u 14:42',
    ]);
  });

  it('names a narrowed filter by the label its chip shows, and a month by its words', () => {
    const kind = 'team:changed';
    const model = historyExportOf(
      inputOf(viewOf({ period: { from: '2026-10-01', to: '2026-10-31' } }), {
        period: '2026-10',
        member: 'ana',
        team: 'a',
        kind,
      }),
    );

    expect(model.lines.slice(1, 5)).toEqual([
      `Razdoblje: ${t('history.period.month', { month: 'listopad', year: '2026' })} (01.10.2026 – 31.10.2026)`,
      'Osoba: Ana Anić',
      'Smjena: Smjena A',
      `Vrsta: ${historyKindText(kind)}`,
    ]);
  });

  it('adds the begins statement when the page shows it, last', () => {
    const begins = { source: 'marker', date: '16.11.2026', time: '10:00' } as const;
    const model = historyExportOf(inputOf(viewOf({ begins })));

    expect(model.lines.at(-1)).toBe(t('history.begins', { date: '16.11.2026', time: '10:00' }));
    expect(model.lines).toHaveLength(8);
  });

  it('numbers the pages', () => {
    expect(historyExportOf(inputOf()).pageText(2, 5)).toBe('Stranica 2 od 5');
  });

  it('words a continuation and the note on replaced characters', () => {
    const model = historyExportOf(inputOf());

    expect(model.continued).toBe('(nastavak)');
    expect(model.glyphNote).toBe(
      'Napomena: znakovi koje PDF ne može prikazati (npr. emotikoni) zamijenjeni su znakom \uFFFD, a strelice znakovima poput ->.',
    );
    // The note is added by the writer, only when it replaced something.
    expect(model.lines).not.toContain(model.glyphNote);
  });
});

describe('the file name', () => {
  it('names the organization and the period’s ISO days', () => {
    expect(historyExportOf(inputOf()).fileName).toBe('Povijest promjena JVP Grad 2026-10-18 2026-11-16.pdf');
  });

  it('drops what no file system takes from the organization’s name, and closes a gap it leaves', () => {
    expect(historyExportOf(inputOf(viewOf({ organizationName: 'JVP: Grad/Sjever?' }))).fileName).toBe(
      'Povijest promjena JVP GradSjever 2026-10-18 2026-11-16.pdf',
    );
    expect(historyExportOf(inputOf(viewOf({ organizationName: '***' }))).fileName).toBe(
      'Povijest promjena 2026-10-18 2026-11-16.pdf',
    );
  });
});

describe('the action', () => {
  it('is closed with no row, inert while building, and says so', () => {
    expect(historyExportEmpty(viewOf({ rows: [] }))).toBe(true);
    expect(historyExportEmpty(viewOf())).toBe(false);
    expect(historyExportDisabled(viewOf(), true)).toBe(true);
    expect(historyExportDisabled(viewOf(), false)).toBe(false);
    expect(historyExportDisabled(viewOf({ rows: [] }), false)).toBe(true);
    expect(t(historyExportMessageKey(false))).toBe('Izvezi u PDF');
    expect(t(historyExportMessageKey(true))).toBe('Izvoz…');
  });

  it('answers the written file’s name and its changes, the start of history not counted', async () => {
    const written: HistoryExport[] = [];
    const done = await exportHistory(inputOf(viewOf({ rows: [RENAME, ADDITION, DELETION, MARKER] })), async (model) => {
      written.push(model);
    });

    expect(written).toHaveLength(1);
    expect(written[0]?.rows).toHaveLength(4);
    expect(done).toEqual({ fileName: written[0]?.fileName, count: 3 });
    expect(t('history.export.done', done ?? { fileName: '', count: 0 })).toBe(
      'Preuzeta je datoteka Povijest promjena JVP Grad 2026-10-18 2026-11-16.pdf s 3 promjene.',
    );
    expect(t('history.export.done', { fileName: 'x.pdf', count: 1 })).toBe('Preuzeta je datoteka x.pdf s 1 promjenom.');
    expect(t('history.export.done', { fileName: 'x.pdf', count: 5 })).toBe('Preuzeta je datoteka x.pdf s 5 promjena.');
  });

  it('refuses more than 2000 changes, the start of history not counted, and says how many and what to do', () => {
    const many = (count: number): HistoryRow[] =>
      Array.from({ length: count }, (_, index) => row({ id: String(index) }));

    expect(HISTORY_EXPORT_LIMIT).toBe(2000);
    expect(historyExportOverLimit(viewOf({ rows: many(2000) }))).toBe(false);
    expect(historyExportOverLimit(viewOf({ rows: [...many(2000), MARKER] }))).toBe(false);
    expect(historyExportOverLimit(viewOf({ rows: many(2001) }))).toBe(true);
    expect(historyExportCount(viewOf({ rows: [...many(3), MARKER] }))).toBe(3);
    expect(historyExportRefusalOf(viewOf({ rows: many(2001) }))).toEqual({ count: 2001, limit: 2000 });
    expect(t('history.export.tooLarge', { count: 2001, limit: 2000 })).toBe(
      'Izvoz u PDF prima najviše 2.000 promjena, a prikazana je 2.001 promjena. Suzi razdoblje ili filtre pa pokušaj ponovno.',
    );
    expect(t('history.export.tooLarge', { count: 2002, limit: 2000 })).toBe(
      'Izvoz u PDF prima najviše 2.000 promjena, a prikazane su 2.002 promjene. Suzi razdoblje ili filtre pa pokušaj ponovno.',
    );
    expect(t('history.export.tooLarge', { count: 4500, limit: 2000 })).toBe(
      'Izvoz u PDF prima najviše 2.000 promjena, a prikazano je 4.500 promjena. Suzi razdoblje ili filtre pa pokušaj ponovno.',
    );
  });

  it('decides a press: nothing with no row or while building, a refusal over the limit, else a build', () => {
    const many = Array.from({ length: 2001 }, (_, index) => row({ id: String(index) }));

    expect(historyExportPressOf(viewOf({ rows: [] }), false)).toBe('ignore');
    expect(historyExportPressOf(viewOf(), true)).toBe('ignore');
    expect(historyExportPressOf(viewOf({ rows: many }), true)).toBe('ignore');
    expect(historyExportPressOf(viewOf({ rows: many }), false)).toBe('refuse');
    expect(historyExportPressOf(viewOf(), false)).toBe('build');
  });

  it('never builds over the limit, whoever calls it', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const write = vi.fn(async () => undefined);
    const many = Array.from({ length: 2001 }, (_, index) => row({ id: String(index) }));

    await expect(exportHistory(inputOf(viewOf({ rows: many })), write)).resolves.toBeNull();
    expect(write).not.toHaveBeenCalled();
    expect(logged).toHaveBeenCalledWith(HISTORY_EXPORT_FAILED, expect.any(Error));
  });

  it('logs a writer that fails and answers null, never throwing', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const cause = new Error('offline');

    await expect(exportHistory(inputOf(), () => Promise.reject(cause))).resolves.toBeNull();
    expect(logged).toHaveBeenCalledWith(HISTORY_EXPORT_FAILED, cause);
  });
});

describe('a yield to the UI', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('waits for a frame, then a task', async () => {
    vi.useFakeTimers();
    let frame: (() => void) | null = null;

    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
      frame = callback;

      return 1;
    });
    let resolved = false;
    const yielded = yieldToUi().then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(10);
    expect(resolved).toBe(false);
    (frame as (() => void) | null)?.();
    await vi.advanceTimersByTimeAsync(0);
    await yielded;
    expect(resolved).toBe(true);
  });

  it('goes on without a frame in a hidden tab, which draws none', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', () => 1);
    let resolved = false;
    const yielded = yieldToUi().then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(HISTORY_EXPORT_FRAME_WAIT_MS - 1);
    expect(resolved).toBe(false);
    // The fallback fires at the limit, and the task it then queues runs next.
    await vi.advanceTimersByTimeAsync(2);
    await yielded;
    expect(resolved).toBe(true);
  });
});
