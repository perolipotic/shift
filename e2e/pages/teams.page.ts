import type { Locator } from '@playwright/test';

import { escapeRegExp, fill, hr, plural } from '../utils/i18n.ts';
import { BasePage } from './base.page.ts';

/** `/ljudi/smjene` and `/ljudi/smjene/:id`, and a team's roster at `/smjene/:id`. */
export class TeamsPage extends BasePage {
  protected readonly path = '/ljudi/smjene';

  /** A team's edit link in the list. */
  editLink(teamName: string): Locator {
    return this.page.getByRole('link', { name: fill(hr.smjene.edit, { name: teamName }) });
  }

  /** The add dialog. */
  get addDialog(): Locator {
    return this.dialog(hr.smjene.addHeading);
  }

  /** The add dialog's name field. */
  get addNameInput(): Locator {
    return this.addDialog.getByLabel(hr.smjene.name, { exact: true });
  }

  /** The add dialog's own refusal, held inside the dialog. */
  get addRefusal(): Locator {
    return this.addDialog.getByRole('alert');
  }

  /** The edit dialog, while the team is active. */
  get editDialog(): Locator {
    return this.dialog(hr.smjene.editHeading);
  }

  /** The same dialog once the team is archived: its heading says so. */
  get viewDialog(): Locator {
    return this.dialog(hr.smjene.viewHeading);
  }

  /** The edit dialog's name field. */
  get editNameInput(): Locator {
    return this.editDialog.getByLabel(hr.smjene.name, { exact: true });
  }

  /** The edit dialog's Spremi. */
  get editSaveButton(): Locator {
    return this.editDialog.getByRole('button', { name: hr.smjene.save, exact: true });
  }

  /** The archive offer, named for the team as stored. */
  archiveButton(teamName: string): Locator {
    return this.editDialog.getByRole('button', { name: fill(hr.smjene.archive, { name: teamName }), exact: true });
  }

  /** The confirmation's question, naming the team. */
  archivePrompt(teamName: string): Locator {
    return this.editDialog.getByText(fill(hr.smjene.archivePrompt, { name: teamName }), { exact: true });
  }

  /** The confirmation's answer that archives the team. */
  archiveConfirmButton(teamName: string): Locator {
    return this.editDialog.getByRole('button', {
      name: fill(hr.smjene.archiveConfirm, { name: teamName }),
      exact: true,
    });
  }

  /** The confirmation's answer that returns to the form. */
  get archiveCancelButton(): Locator {
    return this.editDialog.getByRole('button', { name: hr.smjene.archiveCancel, exact: true });
  }

  /** The open dialog's close. */
  get closeButton(): Locator {
    return this.page.getByRole('button', { name: hr.smjene.close, exact: true });
  }

  /** The archived group's heading, `Arhivirano: N smjena`, whatever N is now (grouped as `1.234`). */
  get archivedHeading(): Locator {
    const [prefix = ''] = plural(hr.smjene.archivedCount, 1).split('1');

    return this.page.getByRole('heading', {
      name: new RegExp(`^${escapeRegExp(prefix)}\\d{1,3}(?:[.\\u00a0\\u202f]\\d{3})* `),
    });
  }

  /** The archived group's table: the one under its heading. */
  get archivedTable(): Locator {
    return this.archivedHeading.locator('xpath=ancestor::div[.//table][1]').getByRole('table');
  }

  /** A team's view link inside the archived group: an archived team is viewed, not edited. */
  archivedViewLink(teamName: string): Locator {
    return this.archivedTable.getByRole('link', { name: fill(hr.smjene.view, { name: teamName }) });
  }

  /** Adds a team through the dialog opened from the header, and submits it. */
  async addTeam(name: string): Promise<void> {
    await this.page.getByRole('button', { name: hr.smjene.open }).click();
    await this.page.getByLabel(hr.smjene.name, { exact: true }).fill(name);
    await this.page.getByRole('button', { name: hr.smjene.add }).click();
  }

  /** Opens a team from the list. */
  async openTeam(teamName: string): Promise<void> {
    await this.editLink(teamName).click();
  }

  /** Opens a team's roster. */
  async gotoRoster(teamId: string): Promise<void> {
    await this.page.goto(`/smjene/${teamId}`);
  }

  /** A link to a team's roster, by the team's name (Danas). */
  rosterLink(teamName: string): Locator {
    return this.page.getByRole('link', { name: teamName });
  }

  /** The roster's entry that holds `name`. */
  rosterEntry(name: string): Locator {
    return this.page.getByRole('listitem').filter({ hasText: name });
  }

  /** The roster's archived notice. */
  get rosterArchivedNotice(): Locator {
    return this.text(hr.smjene.roster.archived);
  }

  /** The roster's member count, `N osoba`. */
  rosterCount(count: number): Locator {
    return this.text(plural(hr.smjene.roster.count, count));
  }

  /** A roster line, matched whole. */
  rosterLine(line: string): Locator {
    return this.page.getByRole('listitem').getByText(line, { exact: true });
  }
}
