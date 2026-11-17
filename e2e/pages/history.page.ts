import type { Download, Locator } from '@playwright/test';

import { escapeRegExp, fill, hr, icu, plural } from '../utils/i18n.ts';
import { BasePage } from './base.page.ts';

const history = hr.history;

/**
 * `/povijest-promjena` (story 14.2): the admin's change history — a table of
 * *Vrijeme*, *Autor*, *Vrsta*, *Predmet* and *Bilo → sada* from 640 px,
 * stacked rows below it, the Razdoblje, Osoba, Smjena and Vrsta chips, and
 * the statement of where history begins.
 */
export class HistoryPage extends BasePage {
  readonly path = '/povijest-promjena';

  /** The table from 640 px, named by its caption. */
  get table(): Locator {
    return this.page.getByRole('table', { name: history.caption });
  }

  /** The stacked rows below 640 px, named by the same caption. */
  get stackedList(): Locator {
    return this.page.getByRole('list', { name: history.caption });
  }

  /** The table row that names `text` anywhere in it. */
  rowNaming(text: string): Locator {
    return this.table.getByRole('row').filter({ hasText: text });
  }

  /**
   * The stacked row that names `text` anywhere in it. Only the list's own items:
   * a row's change lines are a nested list, whose items would match too.
   */
  stackedRowNaming(text: string): Locator {
    return this.stackedList.locator(':scope > li').filter({ hasText: text });
  }

  /** `record · action`, as a row's *Vrsta* says it. */
  kindText(record: string, action: string): string {
    return fill(history.kindLine, { record, action });
  }

  /** `field: before → after`, as a row's *Bilo → sada* says a change. */
  changeText(field: string, before: string, after: string): string {
    return fill(history.change, { field, before, after });
  }

  /** The statement of where history begins, whatever its date. */
  get beginsStatement(): Locator {
    const head = history.begins.slice(0, history.begins.indexOf('{'));

    return this.page.getByRole('main').getByText(new RegExp(`^${escapeRegExp(head)}`));
  }

  /** The chip bar's active chip whose name holds `text` (`Smjena: Smjena A`). */
  chip(text: string): Locator {
    // Exact: the chip's remove button is named `Ukloni filtar smjena: …`, which
    // holds the chip's own name case-insensitively.
    return this.page
      .getByRole('group', { name: hr.filter.label, exact: true })
      .getByRole('button', { name: text, exact: true });
  }

  /** The ✕ of the active team chip whose value is `value`. */
  removeTeamChip(value: string): Locator {
    return this.page.getByRole('button', { name: fill(history.remove.team, { value }), exact: true });
  }

  /** The offline notice that stands in place of the rows. */
  get offlineNotice(): Locator {
    return this.page.getByRole('status').filter({ hasText: history.offline });
  }

  /** The line the chips leave when they show nothing. */
  get filteredLine(): Locator {
    return this.page.getByText(history.filtered, { exact: true });
  }

  /** *Poništi filtre*, beside the filtered-out line. */
  get clearFiltersButton(): Locator {
    return this.page.getByRole('main').getByRole('button', { name: hr.filter.clear, exact: true });
  }

  /** The alert a failed read shows in place of the rows. */
  get unavailableAlert(): Locator {
    return this.page.getByRole('alert').filter({ hasText: history.unavailable });
  }

  /** *Pokušaj ponovno*, under the unavailable alert. */
  get retryButton(): Locator {
    return this.page.getByRole('button', { name: history.retry, exact: true });
  }

  /** The table's drawn rows, the header row aside. */
  get bodyRows(): Locator {
    return this.table.locator('tbody tr');
  }

  /** *Prikaži još*, under rows drawn in steps (epic 14 retro A9). */
  get showMoreButton(): Locator {
    return this.page.getByRole('button', { name: history.more, exact: true });
  }

  /** The status line that says how many of `total` rows are drawn. */
  partialLine(shown: number, total: number): Locator {
    return this.page.getByRole('status').filter({ hasText: icu(history.partial, { shown, total }) });
  }

  // ------------------------------------------------ the export (story 14.3)

  /** `Izvezi u PDF`, above the rows; while building, it wears the pending label. */
  get exportButton(): Locator {
    return this.page.getByRole('button', { name: history.export.action, exact: true });
  }

  /** The line a failed build shows. */
  get exportFailed(): Locator {
    return this.page.getByRole('alert').filter({ hasText: history.export.failed });
  }

  /** The status line after a download: the file's name and how many changes it holds. */
  exportDone(fileName: string, count: number): Locator {
    // The plural helper takes no braces inside a form: the file's name goes in after.
    const placeholder = '\u0000';
    const text = plural(history.export.done.replaceAll('{fileName}', placeholder), count).replace(placeholder, fileName);

    return this.page.getByRole('status').filter({ hasText: text });
  }

  /** The file name the export gives, whatever the organization and period: `Povijest promjena … YYYY-MM-DD YYYY-MM-DD.pdf`. */
  get exportFileName(): RegExp {
    const day = '\\d{4}-\\d{2}-\\d{2}';
    const [head] = history.export.fileName.split('{');

    return new RegExp(`^${escapeRegExp(head ?? '')}.+ ${day} ${day}\\.pdf$`);
  }

  /** Chooses the export and answers the download it starts. */
  async exportDownload(): Promise<Download> {
    const [download] = await Promise.all([this.page.waitForEvent('download'), this.exportButton.click()]);

    return download;
  }
}
