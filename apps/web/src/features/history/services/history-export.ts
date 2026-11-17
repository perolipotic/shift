import type { HistoryPeriod } from '@shift/domain';

import { fileNameSafeOf } from '@/features/hours/services/hours-export';
import {
  historyBeginsMessageKey,
  historyKindText,
  historyPeriodText,
  type HistoryBeginsView,
  type HistoryOptionView,
  type HistoryRow,
  type HistoryRowChange,
} from '@/features/history/services/history-rows';
import type { HistorySearchFilters } from '@/features/history/services/history-search';
import { t } from '@/lib/i18n';
import { formatDate, formatIsoDate, formatTime } from '@/lib/i18n/format';
import { NO_TEXT } from '@/utils/text';

/**
 * *Povijest promjena* as a PDF (story 14.3; spine AD-11 "The PDF (14.3)"):
 * exactly the rows the screen rendered — the ready view's `rows`, the SAME
 * array the table and the stacked rows draw, in their order. Nothing is read
 * again, nothing is filtered again, and no row is worded again (AD-13): each
 * cell is the row's own text, and a change's sides are the screen's own
 * `{field}: {value}` words.
 *
 * EVERY RULE OF THE EXPORT IS HERE, and the node suite executes it: the
 * header lines (organization, period, filters, summary, generation time,
 * where history begins), the columns, the cells, the file's name, when the
 * action is offered, and what a failed build does. `./pdf` is the only module
 * that knows the writer, and it only lays this model out.
 *
 * *BILO* AND *SADA* ARE TWO COLUMNS: the writer's Roboto has no `→`, so the
 * screen's one *Bilo → sada* column is drawn as two (UX-DR51, reinterpreted).
 */

/** What the export reads off the ready view: the rows and the words the page already shows. */
export interface HistoryExportView {
  /** The rows the screen drew, in order: the export's only rows. */
  readonly rows: readonly HistoryRow[];
  /** The changes among `rows` and in the period, as the summary line counts them. */
  readonly shown: number;
  readonly total: number;
  /** The Osoba and Smjena chips' options: the labels the chips show. */
  readonly members: readonly HistoryOptionView[];
  readonly teams: readonly HistoryOptionView[];
  /** The begins statement, when the page shows it. */
  readonly begins: HistoryBeginsView | null;
  /** The period's first and last day, ISO. */
  readonly period: HistoryPeriod;
  /** The organization snapshot's `name`. */
  readonly organizationName: string;
  /** The organization's time zone: the generation time is read in it. */
  readonly zone: string;
}

/** Everything one export is built from. */
export interface HistoryExportInput {
  readonly view: HistoryExportView;
  /** The filters the chips show (the offered ones). */
  readonly filters: HistorySearchFilters;
  /** When the admin pressed the action. */
  readonly generatedAt: Date;
}

/** One change's two sides, each `{field}: {value}`, or `''` on the side with no value. */
export interface HistoryExportChange {
  readonly before: string;
  readonly after: string;
}

/** One row of the document, one per `view.rows` entry. */
export interface HistoryExportRow {
  readonly time: string;
  readonly author: string;
  readonly kind: string;
  /** *Početak povijesti* on the marker, *Rekonstruirano* on a backfilled row, else `null`. */
  readonly badge: string | null;
  readonly subject: string;
  readonly changes: readonly HistoryExportChange[];
  /** *Bez promijenjenih polja* when no visible field changed (spanning both sides), else `null`. */
  readonly none: string | null;
}

/** The document, ready for a writer. */
export interface HistoryExport {
  readonly fileName: string;
  readonly title: string;
  /** Under the title: organization, period, the three filters, summary, generation time, and where history begins. */
  readonly lines: readonly string[];
  /** Vrijeme, Autor, Vrsta, Predmet, Bilo, Sada. */
  readonly columns: readonly string[];
  readonly rows: readonly HistoryExportRow[];
  /** Each page's footer, `Stranica n od m`. */
  readonly pageText: (page: number, pages: number) => string;
  /** Under a row's time on each row that continues an entry too tall for one page: *(nastavak)*. */
  readonly continued: string;
  /** The header line the writer adds when it replaced a character the font cannot draw (`./history-pdf-text`). */
  readonly glyphNote: string;
}

/** The file's extension: a format, not copy. */
const HISTORY_EXPORT_EXTENSION = '.pdf';

/** The build or the writer failed: logged beside it, never shown. */
export const HISTORY_EXPORT_FAILED = 'HISTORY_EXPORT_FAILED';

/** A side with no value: an addition has no *bilo*, a deletion no *sada*. */
const NO_SIDE = NO_TEXT;

/** A chip's label, as `history-filters.tsx` reads it: the option's, or nothing if the period does not offer it. */
function labelOf(options: readonly HistoryOptionView[], id: string): string {
  return options.find((option) => option.id === id)?.label ?? NO_TEXT;
}

/** The three filter lines, in the chips' order and words: `Osoba: sve` when a chip is not set. */
function filterLinesOf(view: HistoryExportView, filters: HistorySearchFilters): readonly string[] {
  return [
    filters.member === null
      ? t('history.chip.memberAll')
      : t('history.chip.member', { value: labelOf(view.members, filters.member) }),
    filters.team === null
      ? t('history.chip.teamAll')
      : t('history.chip.team', { value: labelOf(view.teams, filters.team) }),
    filters.kind === null
      ? t('history.chip.kindAll')
      : t('history.chip.kind', { value: historyKindText(filters.kind) }),
  ];
}

function changeOf({ field, before, after }: HistoryRowChange): HistoryExportChange {
  return {
    before: before === null ? NO_SIDE : t('history.removedValue', { field, before }),
    after: after === null ? NO_SIDE : t('history.added', { field, after }),
  };
}

function badgeOf(row: HistoryRow): string | null {
  if (row.marker) return t('history.markerBadge');

  return row.reconstructed ? t('history.reconstructed') : null;
}

function rowOf(row: HistoryRow): HistoryExportRow {
  return {
    time: row.time,
    author: row.author,
    kind: row.kind,
    badge: badgeOf(row),
    subject: row.subject,
    changes: row.changes.map(changeOf),
    none: row.changes.length === 0 ? t('history.noChanges') : null,
  };
}

/** The document `input` stands for. */
export function historyExportOf({ view, filters, generatedAt }: HistoryExportInput): HistoryExport {
  const { period, zone } = view;
  const from = formatIsoDate(period.from) ?? period.from;
  const to = formatIsoDate(period.to) ?? period.to;
  const fileName = t('history.export.fileName', {
    organization: fileNameSafeOf(view.organizationName),
    from: period.from,
    to: period.to,
  });

  return {
    // An organization with nothing left to show leaves its gap, closed here.
    fileName: `${fileName.replace(/ {2,}/g, ' ').trim()}${HISTORY_EXPORT_EXTENSION}`,
    title: t('history.caption'),
    lines: [
      t('history.export.organization', { name: view.organizationName }),
      t('history.export.period', { value: historyPeriodText(filters.period), from, to }),
      ...filterLinesOf(view, filters),
      t('history.summary', { shown: view.shown, total: view.total }),
      t('history.export.generated', { date: formatDate(generatedAt, zone), time: formatTime(generatedAt, zone) }),
      ...(view.begins === null
        ? []
        : [t(historyBeginsMessageKey(view.begins.source), { date: view.begins.date, time: view.begins.time })]),
    ],
    columns: [
      t('history.column.time'),
      t('history.column.author'),
      t('history.column.kind'),
      t('history.column.subject'),
      t('history.export.before'),
      t('history.export.after'),
    ],
    rows: view.rows.map(rowOf),
    pageText: (page, pages) => t('history.export.page', { page, pages }),
    continued: t('history.export.continued'),
    glyphNote: t('history.export.glyphNote'),
  };
}

/**
 * The most changes one export builds (epic 14 retro A9). pdfmake lays a
 * document out and renders it in ONE synchronous call, so the tab is frozen
 * for as long as that takes, growing with the rows; nothing inside it can
 * yield. Measured in node on a server CPU (AMD EPYC 9354P), entries of three
 * changes: 2000 build in about 3 s and 5000 in about 8 s; a laptop or phone
 * is two to four times slower. 2000 keeps the freeze to seconds and covers a
 * busy month; above it the admin narrows the period or the filters.
 */
export const HISTORY_EXPORT_LIMIT = 2000;

/** The changes an export of `view` holds: its rows, the start-of-history row not counted. */
export function historyExportCount(view: Pick<HistoryExportView, 'rows'>): number {
  return view.rows.filter((row) => !row.marker).length;
}

/** Whether the export refuses `view`: more changes than {@link HISTORY_EXPORT_LIMIT}. Nothing is built. */
export function historyExportOverLimit(view: Pick<HistoryExportView, 'rows'>): boolean {
  return historyExportCount(view) > HISTORY_EXPORT_LIMIT;
}

/** What the refusal says: how many changes are shown, the limit, and to narrow the period or the filters. */
// A type, not an interface: `t()` takes it as its values.
export type HistoryExportRefusal = {
  readonly count: number;
  readonly limit: number;
};

export function historyExportRefusalOf(view: Pick<HistoryExportView, 'rows'>): HistoryExportRefusal {
  return { count: historyExportCount(view), limit: HISTORY_EXPORT_LIMIT };
}

/** What a press on the action does: nothing (no row, or a file already being built), refuse, or build. */
export const HISTORY_EXPORT_PRESS = { ignore: 'ignore', refuse: 'refuse', build: 'build' } as const;

export type HistoryExportPress = (typeof HISTORY_EXPORT_PRESS)[keyof typeof HISTORY_EXPORT_PRESS];

export function historyExportPressOf(view: Pick<HistoryExportView, 'rows'>, building: boolean): HistoryExportPress {
  if (building || historyExportEmpty(view)) return HISTORY_EXPORT_PRESS.ignore;

  return historyExportOverLimit(view) ? HISTORY_EXPORT_PRESS.refuse : HISTORY_EXPORT_PRESS.build;
}

/**
 * Lets the browser paint before the next stage of a build: the button's
 * *Izvoz…* first, then a frame between each stage the writer can split. A
 * frame is waited for (`requestAnimationFrame`, then a task, so the paint has
 * happened); where there is no frame to wait for (the node suite), a task.
 */
export function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    const task = (): void => {
      setTimeout(resolve, 0);
    };

    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(task);
    else task();
  });
}

/**
 * Whether the action is closed outright: no row to export. Drawn as a native
 * `disabled`, out of the tab order, because there is nothing it could do.
 */
export function historyExportEmpty(view: Pick<HistoryExportView, 'rows'>): boolean {
  return view.rows.length === 0;
}

/**
 * Whether choosing the action does nothing: no row to export, or a file
 * already being built. While building it stays FOCUSABLE (`aria-disabled`).
 */
export function historyExportDisabled(view: Pick<HistoryExportView, 'rows'>, pending: boolean): boolean {
  return pending || historyExportEmpty(view);
}

/** The action's label: its imperative, or what it says while the file is built. */
export function historyExportMessageKey(pending: boolean): 'history.export.action' | 'history.export.pending' {
  return pending ? 'history.export.pending' : 'history.export.action';
}

/**
 * What the status line after a download says: the file's name and how many
 * changes it holds — the start-of-history row is no change.
 */
// A type, not an interface: `t()` takes it as its values.
export type HistoryExportDone = {
  readonly fileName: string;
  readonly count: number;
};

/** What writes a document to a file: `./pdf`'s writer, or a test's. */
export type HistoryExportWriter = (document: HistoryExport) => Promise<void>;

/**
 * Builds the document and writes it, answering what its status line says —
 * the written document's own name and change count. GUARDED: a failed build,
 * a writer that cannot load (offline after the page loaded), or one that
 * refuses, is logged and answered `null` — never thrown, so the screen shows
 * its message and offers the action again.
 */
export async function exportHistory(
  input: HistoryExportInput,
  write: HistoryExportWriter,
): Promise<HistoryExportDone | null> {
  try {
    // The hook refuses first; a caller that did not is refused here, never built.
    if (historyExportOverLimit(input.view)) throw new Error('HISTORY_EXPORT_OVER_LIMIT');
    // The press has painted *Izvoz…* before any of the build runs.
    await yieldToUi();

    const document = historyExportOf(input);

    await write(document);

    return { fileName: document.fileName, count: historyExportCount(input.view) };
  } catch (cause) {
    console.error(HISTORY_EXPORT_FAILED, cause);

    return null;
  }
}
