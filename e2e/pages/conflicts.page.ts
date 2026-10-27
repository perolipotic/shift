import type { Locator } from '@playwright/test';

import { escapeRegExp, hr, plural } from '../utils/i18n.ts';
import { BasePage } from './base.page.ts';

const zaOdluku = hr.zaOdluku;

/**
 * `/za-odluku`: the conflicts queue (story 5.3b) — its count, always shown,
 * a row per unresolved conflict (upcoming soonest first, then past most
 * recent first), the empty sentence, or, in their place, the failure with its
 * retry. Since story 7.16, two tabs: *Čeka odluku*, the queue, and *Odlučeno*,
 * the decisions in force.
 */
export class ConflictsPage extends BasePage {
  readonly path = '/za-odluku';

  /** The count's heading (h2), for `count` conflicts. */
  countHeading(count: number): Locator {
    return this.page.getByRole('heading', { level: 2, name: plural(zaOdluku.count, count), exact: true });
  }

  /** The count's heading, whatever it counts. */
  get anyCountHeading(): Locator {
    return this.page.getByRole('heading', { level: 2 });
  }

  // ------------------------------------------------- the tabs (story 7.16)
  // Their names live here alone: story 9.1 renames them.

  /** *Čeka odluku*, the default tab; it carries the queue's count once read. */
  get unresolvedTab(): Locator {
    return this.page.getByRole('tab', { name: new RegExp(`^${escapeRegExp(zaOdluku.tabs.unresolved)}( · \\d+)?$`) });
  }

  /** *Odlučeno*, the decisions in force. */
  get resolvedTab(): Locator {
    return this.page.getByRole('tab', { name: zaOdluku.tabs.resolved, exact: true });
  }

  /** Every entry of *Odlučeno*, newest decision first: the open tab's list items. */
  get resolvedEntries(): Locator {
    return this.page.getByRole('tabpanel').getByRole('listitem');
  }

  /**
   * *Odlučeno* drawn: its count heading, which stands only once the tab's
   * reads have landed — the names of whoever decided among them — zero
   * included (story 8.2c's offline test waits on it).
   */
  get resolvedCount(): Locator {
    return this.page.getByRole('tabpanel').getByRole('heading', { level: 2 });
  }

  /** The *Odlučeno* entries of one member, by name. */
  resolvedEntriesOf(memberName: string): Locator {
    return this.resolvedEntries.filter({ hasText: memberName });
  }

  /** The queue's list: the one list inside the section its count names. */
  get list(): Locator {
    return this.page.getByRole('main').getByRole('region').getByRole('list');
  }

  /** Every row of the queue, in the order it is shown. */
  get rows(): Locator {
    return this.list.getByRole('listitem');
  }

  /** The rows of one member, by name, in the order they are shown. */
  rowsOf(memberName: string): Locator {
    return this.rows.filter({ hasText: memberName });
  }

  /** The sentence an organization with no conflicts reads. */
  get emptySentence(): Locator {
    return this.page.getByText(zaOdluku.empty, { exact: true });
  }

  /** The retry the unavailable alert offers. */
  get retryButton(): Locator {
    return this.page.getByRole('button', { name: zaOdluku.retry, exact: true });
  }

  /** The link a row is, to its conflict's resolution screen (story 5.4b). */
  rowLink(row: Locator): Locator {
    return row.getByRole('link');
  }

  /** The status line a saved decision returns with (story 5.4b). */
  get savedStatus(): Locator {
    return this.page.getByRole('main').getByRole('status');
  }
}

const resolution = zaOdluku.resolution;

/**
 * `/za-odluku/$memberId/$date/$teamId`: one conflict's resolution screen
 * (story 5.4b) — the way back, ‹ ›, the facts, the radio cards with their
 * consequence strips, and Odustani and Spremi odluku. Since story 5.4c, the
 * second card, "Zamijeni osobu", and the candidate picker after it. Since
 * story 5.4d, the third card, "Izmijeni godišnji odmor".
 */
export class ConflictResolutionPage extends BasePage {
  readonly path = '/za-odluku';

  /** Opens the screen of the conflict `(memberId, date, teamId)`. */
  async gotoConflict(memberId: string, date: string, teamId: string): Promise<void> {
    await this.page.goto(`${this.path}/${memberId}/${date}/${teamId}`);
  }

  /** The unavailable alert's read retry. */
  get retryButton(): Locator {
    return this.page.getByRole('button', { name: resolution.retry, exact: true });
  }

  /** The way back to the queue, with its count (`Za odluku · 3 čekaju odluku`) or plainly. */
  get backLink(): Locator {
    const counted = resolution.back.slice(0, resolution.back.indexOf('{'));

    return this.page
      .getByRole('main')
      .getByRole('link', { name: new RegExp(`^(${escapeRegExp(counted)}|${escapeRegExp(resolution.backToQueue)})`) });
  }

  /** `2 od 3 · odluči što vrijedi za ovu smjenu.` */
  position(position: number, count: number): Locator {
    return this.page.getByText(
      resolution.position.replace('{position}', String(position)).replace('{count}', String(count)),
      { exact: true },
    );
  }

  /** ‹ — named by the target's date, or plainly at the queue's start. */
  get previousButton(): Locator {
    return this.page.getByRole('button', { name: new RegExp(`^${resolution.previousNone}`) });
  }

  /** › — named by the target's date, or plainly at the queue's end. */
  get nextButton(): Locator {
    return this.page.getByRole('button', { name: new RegExp(`^${resolution.nextNone}`) });
  }

  /** The radio group, named by its heading. */
  get choice(): Locator {
    return this.page.getByRole('radiogroup', { name: resolution.choice });
  }

  /** The first card, "Prihvati kao nepokriveno". */
  get acceptOption(): Locator {
    return this.choice.getByRole('radio', { name: resolution.acceptTitle });
  }

  /** The second card, "Zamijeni osobu" (story 5.4c). */
  get replaceOption(): Locator {
    return this.choice.getByRole('radio', { name: resolution.replaceTitle });
  }

  /** The third card, "Izmijeni godišnji odmor" (story 5.4d). */
  get amendOption(): Locator {
    return this.choice.getByRole('radio', { name: resolution.amendTitle });
  }

  /** The candidate picker's own radio group, "Tko odrađuje smjenu" (story 5.4c). */
  get candidates(): Locator {
    return this.page.getByRole('radiogroup', { name: resolution.candidatesHeading });
  }

  /** One candidate, by the name their line starts with. */
  candidate(name: string): Locator {
    return this.candidates.getByRole('radio', { name: new RegExp(`^${escapeRegExp(name)}( ·|$)`) });
  }

  /** One candidate group, by its heading: `slobodan`, `radi taj dan` or `na godišnjem taj dan`. */
  candidateGroup(heading: string): Locator {
    return this.candidates.getByRole('group', { name: heading, exact: true });
  }

  /** Every card in the group. */
  get options(): Locator {
    return this.choice.getByRole('radio');
  }

  /** Spremi odluku. */
  get saveButton(): Locator {
    return this.page.getByRole('button', { name: new RegExp(`^(${resolution.save}|${resolution.saving})$`) });
  }

  /** The held hint's link to the calendar, where the pending change is removed. */
  get heldActionLink(): Locator {
    return this.page.getByRole('link', { name: resolution.heldAction, exact: true });
  }

  /** Odustani, back to the queue. */
  get cancelLink(): Locator {
    return this.page.getByRole('link', { name: resolution.cancel, exact: true });
  }

  /** The line a conflict no longer open states. */
  get missingLine(): Locator {
    return this.page.getByText(resolution.missing, { exact: true });
  }

  /** The strip's three terms, in order: their labels. */
  get stripLabels(): Locator {
    return this.stripLabelsOf(this.acceptOption);
  }

  /** One card's strip labels, in order. */
  stripLabelsOf(option: Locator): Locator {
    return option.getByText(new RegExp(`^(${resolution.coverageLabel}|${resolution.absentLabel}|${resolution.balanceLabel})$`));
  }
}
