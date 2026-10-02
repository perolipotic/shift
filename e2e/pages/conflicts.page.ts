import type { Locator } from '@playwright/test';

import { escapeRegExp, hr, plural } from '../utils/i18n.ts';
import { BasePage } from './base.page.ts';

const raspored = hr.raspored;

/**
 * `/raspored`: the conflicts queue (story 5.3b) — its count, always shown,
 * a row per unresolved conflict (upcoming soonest first, then past most
 * recent first), the empty sentence, or, in their place, the failure with its
 * retry.
 */
export class ConflictsPage extends BasePage {
  protected readonly path = '/raspored';

  /** The count's heading (h2), for `count` conflicts. */
  countHeading(count: number): Locator {
    return this.page.getByRole('heading', { level: 2, name: plural(raspored.count, count), exact: true });
  }

  /** The count's heading, whatever it counts. */
  get anyCountHeading(): Locator {
    return this.page.getByRole('heading', { level: 2 });
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
    return this.page.getByText(raspored.empty, { exact: true });
  }

  /** The retry the unavailable alert offers. */
  get retryButton(): Locator {
    return this.page.getByRole('button', { name: raspored.retry, exact: true });
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

const resolution = raspored.resolution;

/**
 * `/raspored/$memberId/$date/$teamId`: one conflict's resolution screen
 * (story 5.4b) — the way back, ‹ ›, the facts, the radio cards with their
 * consequence strips, and Odustani and Spremi odluku. Since story 5.4c, the
 * second card, "Zamijeni osobu", and the candidate picker after it.
 */
export class ConflictResolutionPage extends BasePage {
  protected readonly path = '/raspored';

  /** Opens the screen of the conflict `(memberId, date, teamId)`. */
  async gotoConflict(memberId: string, date: string, teamId: string): Promise<void> {
    await this.page.goto(`${this.path}/${memberId}/${date}/${teamId}`);
  }

  /** The way back to the queue, with its count (`Raspored · 3 neriješena`) or plainly. */
  get backLink(): Locator {
    return this.page.getByRole('main').getByRole('link', { name: new RegExp(`^(Raspored · |${resolution.backToQueue})`) });
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

  /** The candidate picker's own radio group, "Tko odrađuje smjenu" (story 5.4c). */
  get candidates(): Locator {
    return this.page.getByRole('radiogroup', { name: resolution.candidatesHeading });
  }

  /** One candidate, by the name their line starts with. */
  candidate(name: string): Locator {
    return this.candidates.getByRole('radio', { name: new RegExp(`^${escapeRegExp(name)}( ·|$)`) });
  }

  /** One candidate group, by its heading: `slobodan`, `radi taj dan · 24 h bez pauze` or `na godišnjem taj dan`. */
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

  /** Odustani, back to the queue. */
  get cancelLink(): Locator {
    return this.page.getByRole('link', { name: resolution.cancel, exact: true });
  }

  /** A message on the screen, matched whole. */
  line(message: string): Locator {
    return this.page.getByText(message, { exact: true });
  }

  /** The line a conflict no longer open states. */
  get missingLine(): Locator {
    return this.page.getByText(resolution.missing, { exact: true });
  }

  /** The strip's three terms, in order: their labels. */
  get stripLabels(): Locator {
    return this.acceptOption.getByText(
      new RegExp(`^(${resolution.coverageLabel}|${resolution.hoursLabel}|${resolution.balanceLabel})$`),
    );
  }
}
