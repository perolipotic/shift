import type { Locator } from '@playwright/test';

import { fill, hr } from '../utils/i18n.ts';
import { BasePage } from './base.page.ts';

const bands = hr.organization.hourBands;

/** `/organizacija/satni-pojasi`: the hour band list and its add and edit dialogs. */
export class HourBandsPage extends BasePage {
  protected readonly path = '/organizacija/satni-pojasi';

  /** The list's h1. */
  get listHeading(): Locator {
    return this.heading(bands.heading);
  }

  /** A band's edit link in the list. */
  editLink(name: string): Locator {
    return this.page.getByRole('link', { name: fill(bands.edit, { name }) });
  }

  /** Opens the add dialog, from the explainer. */
  get openButton(): Locator {
    return this.page.getByRole('button', { name: bands.open });
  }

  get addDialog(): Locator {
    return this.dialog(bands.addHeading);
  }

  get editDialog(): Locator {
    return this.dialog(bands.editHeading);
  }

  get nameInput(): Locator {
    return this.page.getByLabel(bands.name, { exact: true });
  }

  get startInput(): Locator {
    return this.page.getByLabel(bands.start, { exact: true });
  }

  get addButton(): Locator {
    return this.page.getByRole('button', { name: bands.add });
  }

  /** The open dialog's close button. */
  get closeButton(): Locator {
    return this.page.getByRole('button', { name: bands.close, exact: true });
  }

  /** The edit dialog's name field. */
  get editDialogName(): Locator {
    return this.editDialog.getByLabel(bands.name, { exact: true });
  }

  /** The edit dialog's close button. */
  get editDialogClose(): Locator {
    return this.editDialog.getByRole('button', { name: bands.close });
  }
}
