import { expect, type Locator } from '@playwright/test';

import { escapeRegExp, fill, hr } from '../utils/i18n.ts';
import { STEP_NAMES } from '../utils/rotation.ts';
import { BasePage } from './base.page.ts';

const builder = hr.rotation.builder;
const shiftTypes = hr.rotation.shiftTypes;
const stepper = builder.stepper;

/**
 * `/postavke-rotacije`: the shift types, the rotation builder (pattern,
 * offsets, preview, history) and, below 640 px, its four-step stepper.
 */
export class RotationPage extends BasePage {
  protected readonly path = '/postavke-rotacije';

  /** A section's heading, at any level. */
  sectionHeading(name: string): Locator {
    return this.page.getByRole('heading', { name, exact: true });
  }

  // --------------------------------------------------------- shift types

  /** Opens the new shift type dialog. */
  get shiftTypeOpenButton(): Locator {
    return this.page.getByRole('button', { name: shiftTypes.open });
  }

  get addShiftTypeDialog(): Locator {
    return this.dialog(shiftTypes.addHeading);
  }

  /** Adds a shift type through its dialog: working with its times, or non-working with `null`. */
  async addShiftType(name: string, times: readonly [string, string] | null): Promise<void> {
    await this.shiftTypeOpenButton.click();
    await this.page.getByLabel(shiftTypes.name, { exact: true }).fill(name);
    if (times === null) {
      await this.page.getByLabel(shiftTypes.kind, { exact: true }).selectOption({ label: shiftTypes.nonworking });
    } else {
      await this.page.getByLabel(shiftTypes.start, { exact: true }).fill(times[0]);
      await this.page.getByLabel(shiftTypes.end, { exact: true }).fill(times[1]);
    }
    await this.page.getByRole('button', { name: shiftTypes.add }).click();
    await expect(this.text(shiftTypes.created)).toBeVisible();
  }

  /** A type's edit link, which opens its dialog over the builder. */
  shiftTypeEditLink(name: string): Locator {
    return this.page.getByRole('link', { name: fill(shiftTypes.edit, { name }) });
  }

  /** The edit dialog's name field. By role, so the closed add dialog's hidden
   *  field of the same label is not matched. */
  get shiftTypeNameTextbox(): Locator {
    return this.page.getByRole('textbox', { name: shiftTypes.name, exact: true });
  }

  get shiftTypeSaveButton(): Locator {
    return this.page.getByRole('button', { name: shiftTypes.save, exact: true });
  }

  get shiftTypeCloseButton(): Locator {
    return this.page.getByRole('button', { name: shiftTypes.close, exact: true });
  }

  /** The edit dialog, while the type is active. */
  get shiftTypeEditDialog(): Locator {
    return this.dialog(shiftTypes.editHeading);
  }

  /** The same dialog once the type is archived: its heading says so. */
  get shiftTypeViewDialog(): Locator {
    return this.dialog(shiftTypes.viewHeading);
  }

  /** The times block's `Vrijedi od` date, in the edit dialog. */
  get timesFromInput(): Locator {
    return this.shiftTypeEditDialog.getByLabel(shiftTypes.timesFrom, { exact: true });
  }

  /** The times block's start, in the edit dialog. */
  get timesStartInput(): Locator {
    return this.shiftTypeEditDialog.getByLabel(shiftTypes.start, { exact: true });
  }

  /** The times block's end, in the edit dialog. */
  get timesEndInput(): Locator {
    return this.shiftTypeEditDialog.getByLabel(shiftTypes.end, { exact: true });
  }

  /** Saves the corrected times from the chosen date. */
  get timesCorrectButton(): Locator {
    return this.shiftTypeEditDialog.getByRole('button', { name: shiftTypes.timesCorrect, exact: true });
  }

  /** Cancels the scheduled correction; offered in place of the times form. */
  get cancelScheduledTimesButton(): Locator {
    return this.shiftTypeEditDialog.getByRole('button', { name: shiftTypes.cancelScheduled, exact: true });
  }

  /**
   * The dialog's `Od {date} vrijedi {range}, {duration}.` line for a correction
   * scheduled from `date` (as shown, `28.09.2026`) to `range` (`08:00–20:00`).
   * Everything is matched literally but the duration.
   */
  scheduledTimesLine(date: string, range: string): Locator {
    const message = shiftTypes.scheduled;
    if (!message.includes('{date}') || !message.includes('{range}') || !message.includes('{duration}')) {
      throw new Error(`E2E: ${message} lacks {date}, {range} or {duration}`);
    }
    const [before = '', after = ''] = fill(message, { date, range }).split('{duration}');

    return this.shiftTypeEditDialog.getByText(new RegExp(`^${escapeRegExp(before)}.+${escapeRegExp(after)}$`));
  }

  /** Why the archive is not offered while a correction is scheduled. */
  get changeScheduledNote(): Locator {
    return this.shiftTypeEditDialog.getByText(shiftTypes.error.changeScheduled, { exact: true });
  }

  /** The archive offer, named for the type. */
  archiveShiftTypeButton(name: string): Locator {
    return this.shiftTypeEditDialog.getByRole('button', { name: fill(shiftTypes.archive, { name }), exact: true });
  }

  /** The confirmation's answer that archives the type. */
  archiveShiftTypeConfirmButton(name: string): Locator {
    return this.shiftTypeEditDialog.getByRole('button', {
      name: fill(shiftTypes.archiveConfirm, { name }),
      exact: true,
    });
  }

  /** The archived types' table: the one under their heading. */
  get archivedShiftTypes(): Locator {
    return this.sectionHeading(shiftTypes.archivedHeading).locator('xpath=ancestor::div[.//table][1]').getByRole('table');
  }

  /** A type's row in the archived table, by its name. */
  archivedShiftTypeRow(name: string): Locator {
    return this.archivedShiftTypes.getByRole('row').filter({ hasText: name });
  }

  // ------------------------------------------------------------ pattern

  get newStepSelect(): Locator {
    return this.page.getByLabel(builder.newStep, { exact: true });
  }

  get addStepButton(): Locator {
    return this.page.getByRole('button', { name: builder.addStep });
  }

  /** Appends a step of the type `name` to the pattern. */
  async addStep(name: string): Promise<void> {
    await this.newStepSelect.selectOption({ label: name });
    await this.addStepButton.click();
  }

  /** The pattern's steps, in order. */
  get steps(): Locator {
    return this.page.getByRole('list', { name: builder.stepsCaption }).getByRole('listitem');
  }

  /** A step's drag handle, by its position (from 1). */
  dragHandle(position: number): Locator {
    return this.page.getByRole('button', {
      name: fill(builder.drag.handle, { position: String(position) }),
      exact: true,
    });
  }

  /** A step's remove button, by its position (from 1). */
  removeStepButton(position: number): Locator {
    return this.page.getByRole('button', { name: fill(builder.remove, { position: String(position) }), exact: true });
  }

  /**
   * A real mouse drag: press on the handle, move past dnd-kit's activation
   * distance, glide onto the target row's centre, release.
   */
  async dragOnto(handle: Locator, target: Locator): Promise<void> {
    // Centred first, so the drag stays clear of the viewport edge where
    // dnd-kit's auto-scroll would move the page under the pointer.
    await handle.evaluate((element) => {
      element.scrollIntoView({ block: 'center' });
    });
    const from = await handle.boundingBox();
    const to = await target.boundingBox();
    if (from === null || to === null) throw new Error('E2E: the drag has nothing to hold or nowhere to go');

    const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
    await this.page.mouse.move(start.x, start.y);
    await this.page.mouse.down();
    await this.page.mouse.move(start.x, start.y + 10, { steps: 5 });
    await this.page.mouse.move(start.x, to.y + to.height / 2, { steps: 15 });
    await this.page.mouse.up();
  }

  /** What dnd-kit's live region says — every word of it from `hr.json`. */
  announced(message: string): Locator {
    return this.text(message);
  }

  /**
   * One macrotask in the page. dnd-kit's keyboard sensor starts listening for
   * the arrows in a `setTimeout` after the lift, so a key pressed before that
   * timer has run is lost — which happens under a loaded, parallel run. A
   * zero-delay timer queued now runs after dnd-kit's; nothing is waited on by
   * the clock.
   */
  async afterPendingTimers(): Promise<void> {
    await this.page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          setTimeout(resolve, 0);
        }),
    );
  }

  /** A cycle figure's value, by its label: the label's parent holds both. */
  figure(label: string): Locator {
    return this.text(label).locator('..');
  }

  // ------------------------------------------------------------ offsets

  get anchorInput(): Locator {
    return this.page.getByLabel(builder.anchor, { exact: true });
  }

  get effectiveFromInput(): Locator {
    return this.page.getByLabel(builder.effectiveFrom, { exact: true });
  }

  /** The step a team stands on, by the team's name. */
  offsetOf(teamName: string): Locator {
    return this.page.getByLabel(fill(builder.offsetOf, { name: teamName }), { exact: true });
  }

  get spreadButton(): Locator {
    return this.page.getByRole('button', { name: builder.spread, exact: true });
  }

  /** The offsets table's team names, in the list's order: every body row's first cell. */
  async offsetTeamNames(): Promise<string[]> {
    const offsets = this.page.getByRole('table').filter({
      has: this.page.getByRole('columnheader', { name: builder.columnOffset, exact: true }),
    });
    const bodyRows = offsets.getByRole('row').filter({ has: this.page.getByRole('cell') });
    const teamNames: string[] = [];
    for (const row of await bodyRows.all()) {
      teamNames.push(((await row.getByRole('cell').first().textContent()) ?? '').trim());
    }

    return teamNames;
  }

  // ------------------------------------------------------------ preview

  /** The transposed preview: teams are rows, dates are columns (headed `Dan N`). */
  get preview(): Locator {
    return this.page.getByRole('table').filter({
      has: this.page.getByRole('columnheader', { name: fill(builder.dayNumber, { day: '1' }) }),
    });
  }

  /** The preview's column headers: the team column, then one per date. */
  get previewHeaders(): Locator {
    return this.preview.getByRole('columnheader');
  }

  /** The header naming a cycle over its first day. */
  previewCycleHeader(cycle: number): Locator {
    return this.preview.getByRole('columnheader', { name: fill(builder.cycleLabel, { cycle: String(cycle) }) });
  }

  get previewCyclesSelect(): Locator {
    return this.page.getByLabel(builder.previewCycles, { exact: true });
  }

  /**
   * The cell one team works in on the `day`-th date (0 = today) of the
   * transposed preview: teams are rows (the team's name in the first cell),
   * dates are columns (headed `Dan N`).
   */
  async previewCell(teamName: string, day: number): Promise<Locator> {
    const row = this.preview
      .getByRole('row')
      .filter({ has: this.page.getByRole('cell', { name: teamName, exact: true }) });
    await expect(row, `the preview has no row for ${teamName}`).toHaveCount(1);

    return row.getByRole('cell').nth(day + 1);
  }

  // ------------------------------------------------------ save, history

  /** Saves the draft, from the header. */
  get saveButton(): Locator {
    return this.page.getByRole('button', { name: builder.save });
  }

  /** The save's confirmation, with the warnings it carries. */
  get savedConfirmation(): Locator {
    return this.statusWith(builder.saved);
  }

  /** The confirmation's lines: its warnings and their dates. */
  get savedConfirmationLines(): Locator {
    return this.savedConfirmation.getByRole('listitem');
  }

  /** The history's row that holds `text`. */
  historyRow(text: string): Locator {
    return this.page
      .getByRole('table')
      .filter({ has: this.page.getByRole('columnheader', { name: builder.history.columnSaved }) })
      .getByRole('row')
      .filter({ hasText: text });
  }

  /** The refusal of a second change while one is scheduled. */
  get scheduledRefusal(): Locator {
    return this.alertWith(builder.error.scheduled);
  }

  /** The cancel offered beside the refusal, naming the scheduled date. */
  cancelScheduledOffer(date: string): Locator {
    return this.scheduledRefusal.getByRole('button', { name: fill(builder.cancelScheduled.offer, { date }) });
  }

  /** The confirm button of the cancel's dialog. */
  get cancelScheduledConfirm(): Locator {
    return this.dialog().getByRole('button', { name: builder.cancelScheduled.confirm });
  }

  // ------------------------------------------------------------ stepper

  /** The progress line above the bar: `Korak N od 4`, the total being the stepper's step count. */
  stepProgress(step: number): Locator {
    return this.text(fill(stepper.progress, { current: String(step), total: String(STEP_NAMES.length) }));
  }

  /** The step bar. */
  get stepBar(): Locator {
    return this.page.getByRole('navigation', { name: stepper.label });
  }

  /** One step's button in the bar, by its name. */
  stepButton(step: number): Locator {
    const name = STEP_NAMES[step - 1];
    if (name === undefined) throw new Error(`E2E: no step ${step}`);

    return this.stepBar.getByRole('button', { name: new RegExp(name) });
  }

  /** Dalje, by the label naming the step it leads to. */
  nextButton(label: string): Locator {
    return this.page.getByRole('button', { name: label, exact: true });
  }

  /** Natrag. */
  get backButton(): Locator {
    return this.page.getByRole('button', { name: stepper.back, exact: true });
  }
}
