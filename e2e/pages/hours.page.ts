import type { Locator } from '@playwright/test';

import { escapeRegExp, hr } from '../utils/i18n.ts';
import { BasePage } from './base.page.ts';

const kalendar = hr.kalendar;
const sati = hr.sati;

/**
 * `/sati`: the viewer's own month of hours (story 4.1b) — the month
 * navigation it shares with the calendar, the total and the shift count, a
 * row per band, the leave row and the failure.
 */
export class HoursPage extends BasePage {
  protected readonly path = '/sati';

  /** The month's heading (h2). */
  monthHeading(name: string | RegExp): Locator {
    return this.page.getByRole('heading', { level: 2, name });
  }

  get nextButton(): Locator {
    return this.page.getByRole('button', { name: kalendar.next });
  }

  /** `Ovaj mjesec`. */
  get currentButton(): Locator {
    return this.page.getByRole('button', { name: kalendar.current, exact: true });
  }

  /** The tile a summary label heads: its label and its figure. */
  private tile(label: string): Locator {
    return this.page.getByText(label, { exact: true }).locator('xpath=..');
  }

  /** The month's total hours, with its label. */
  get totalTile(): Locator {
    return this.tile(sati.total);
  }

  /** The month's shift count, with its label. */
  get shiftsTile(): Locator {
    return this.tile(sati.shifts);
  }

  /** The list of band rows, named by its heading. */
  get bandsList(): Locator {
    return this.page.getByRole('list', { name: sati.bands, exact: true });
  }

  /** Every band's row, in band order. */
  get bandRows(): Locator {
    return this.bandsList.getByRole('listitem');
  }

  /** One band's row, its name matched whole: `Dan` never matches `Danas`. */
  bandRow(name: string): Locator {
    return this.bandRows.filter({ has: this.page.getByText(name, { exact: true }) });
  }

  /** Every band row's hours as it reads (`12 h`), in band order. */
  async bandHours(): Promise<string[]> {
    // The hours are each row's first figure, drawn semibold beside the name.
    return this.bandRows.locator('span.font-semibold').allTextContents();
  }

  /** The note on the shifts with no times, whatever its count: any of its plural forms. */
  get untimedNote(): Locator {
    const forms = [...sati.untimed.matchAll(/\{# ([^{}]+)\}/g)].map((found) => escapeRegExp(found[1] ?? ''));

    return this.page.getByText(new RegExp(`^\\d+ (?:${forms.join('|')})$`));
  }

  /** The leave row, apart from the bands. */
  get leaveRow(): Locator {
    return this.tile(sati.leave);
  }

  /** A figure inside a tile or a row, matched whole. */
  figureIn(scope: Locator, text: string): Locator {
    return scope.getByText(text, { exact: true });
  }
}
