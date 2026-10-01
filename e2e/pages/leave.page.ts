import type { Locator } from '@playwright/test';

import { hr } from '../utils/i18n.ts';
import { BasePage } from './base.page.ts';

const godisnji = hr.godisnji;

/**
 * `/godisnji`: the viewer's own leave (story 5.2c) — three tiles, the
 * allowance, the days used in the current leave year and the balance — or,
 * in their place, the failure with its retry, or the viewer's own line when
 * they have never been on a team.
 */
export class LeavePage extends BasePage {
  protected readonly path = '/godisnji';

  /** The tile a label heads: its label and its figure. */
  private tile(label: string): Locator {
    return this.page.getByText(label, { exact: true }).locator('xpath=..');
  }

  /** The figure of the tile a label heads, its second paragraph. */
  private tileValue(label: string): Locator {
    return this.tile(label).locator('p').nth(1);
  }

  /** The allowance's figure. */
  get allowanceFigure(): Locator {
    return this.tileValue(godisnji.allowance);
  }

  /** The figure of the days used in the current leave year. */
  get usedFigure(): Locator {
    return this.tileValue(godisnji.used);
  }

  /** The balance's figure. */
  get balanceFigure(): Locator {
    return this.tileValue(godisnji.balance);
  }

  /** The retry the unavailable alert offers. */
  get retryButton(): Locator {
    return this.page.getByRole('button', { name: godisnji.retry, exact: true });
  }
}
