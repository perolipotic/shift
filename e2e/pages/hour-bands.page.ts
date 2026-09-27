import { expect, type Locator } from '@playwright/test';

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

  /** Adds a band through the add dialog, and waits for the dialog to close and the page's created status. */
  async addBand(name: string, start: string): Promise<void> {
    await this.openButton.click();
    await this.nameInput.fill(name);
    await this.startInput.fill(start);
    await this.addButton.click();
    await expect(this.addDialog).toBeHidden();
    await expect(this.statusWith(bands.created)).toBeVisible();
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

  /** The add dialog's computed end: an `<output>` labelled `Kraj`, never typed. */
  get addDialogEnd(): Locator {
    return this.addDialog.getByLabel(bands.end, { exact: true });
  }

  /** The add dialog's own refusal, held inside the dialog. */
  get addDialogRefusal(): Locator {
    return this.addDialog.getByRole('alert');
  }

  /** A message inside the add dialog, matched whole (the computed duration). */
  addDialogText(message: string): Locator {
    return this.addDialog.getByText(message, { exact: true });
  }

  /** The add dialog's Cancel. */
  get addDialogCancel(): Locator {
    return this.addDialog.getByRole('button', { name: bands.cancel, exact: true });
  }

  /** The edit dialog's start field. */
  get editDialogStart(): Locator {
    return this.editDialog.getByLabel(bands.start, { exact: true });
  }

  /** A message inside the edit dialog, matched whole (the computed duration). */
  editDialogText(message: string): Locator {
    return this.editDialog.getByText(message, { exact: true });
  }

  /** The edit dialog's computed end. */
  get editDialogEnd(): Locator {
    return this.editDialog.getByLabel(bands.end, { exact: true });
  }

  /** The edit dialog's Spremi. */
  get editDialogSave(): Locator {
    return this.editDialog.getByRole('button', { name: bands.save, exact: true });
  }

  /** The removal offer, named for the band as stored. */
  removeButton(name: string): Locator {
    return this.editDialog.getByRole('button', { name: fill(bands.remove, { name }), exact: true });
  }

  /** The confirmation's answer that removes the band. */
  removeConfirmButton(name: string): Locator {
    return this.editDialog.getByRole('button', { name: fill(bands.removeConfirm, { name }), exact: true });
  }

  /** The confirmation's answer that returns to the form. */
  get removeCancelButton(): Locator {
    return this.editDialog.getByRole('button', { name: bands.removeCancel, exact: true });
  }

  /** The confirmation's question, naming the band. */
  removePrompt(name: string): Locator {
    return this.editDialog.getByText(fill(bands.removePrompt, { name }), { exact: true });
  }
}
