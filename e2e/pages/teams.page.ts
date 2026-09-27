import type { Locator } from '@playwright/test';

import { fill, hr } from '../utils/i18n.ts';
import { BasePage } from './base.page.ts';

/** `/ljudi/smjene` and `/ljudi/smjene/:id`, and a team's roster at `/smjene/:id`. */
export class TeamsPage extends BasePage {
  protected readonly path = '/ljudi/smjene';

  /** A team's edit link in the list. */
  editLink(teamName: string): Locator {
    return this.page.getByRole('link', { name: fill(hr.smjene.edit, { name: teamName }) });
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

  /** A roster line, matched whole. */
  rosterLine(line: string): Locator {
    return this.page.getByRole('listitem').getByText(line, { exact: true });
  }
}
