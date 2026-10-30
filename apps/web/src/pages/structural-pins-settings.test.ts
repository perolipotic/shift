import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SETTINGS_SCREEN_PARTS } from '@/features/organization/settings-screen.fixture';

import {
  attributeOf,
  bareInputElements,
  buttonElements,
  CHROME,
  componentFunction,
  exportedFunction,
  heightPx,
  inputElements,
  occurrences,
  selectElements,
  SETTINGS,
  SETTINGS_EMAIL_NOTIFICATIONS,
  SETTINGS_FIRE_RANKS,
  SETTINGS_HOOK,
  SETTINGS_LOGO,
  source,
  srcRoot,
  TARGET_FLOOR_PX,
} from './source-guards.fixture';

// The organization settings surface: its fields' accessible names, the facts page and
// its dialogs, the logo control, and the curated accent set.

/** The read's message and retry, and the three fact cards (story 7.18). */
const SETTINGS_CARD = join(srcRoot, ...SETTINGS_SCREEN_PARTS.card);

/** Story 7.18: the dialog every change opens in, its form, and one fact's shape. */
const SETTINGS_DIALOG = join(srcRoot, ...SETTINGS_SCREEN_PARTS.dialog);

/** Story 7.18: *Profil* — the name, the logo and the accent — and the name's dialog. */
const SETTINGS_PROFILE = join(srcRoot, ...SETTINGS_SCREEN_PARTS.profile);

/** Story 7.18: the accent's dialog, its named radio cards and the UX-DR5 rule. */
const SETTINGS_ACCENT = join(srcRoot, ...SETTINGS_SCREEN_PARTS.accent);

/** Story 7.18: *Vrijeme i godina* — the locked zone and the leave year — and its dialog. */
const SETTINGS_TIME = join(srcRoot, ...SETTINGS_SCREEN_PARTS.time);

/** Story 7.18: the settings page's element ids, named once; no string a screen renders. */
const SETTINGS_ELEMENT_IDS = join(srcRoot, 'features', 'organization', 'utils', 'element-ids.ts');

/** The status line's name for the stored accent. */
const SETTINGS_ACCENT_LABEL = join(srcRoot, ...SETTINGS_SCREEN_PARTS.accentLabel);

/**
 * The one signed-URL read behind every lockup.
 *
 * It exists because the settings surface and the chrome had a copy each: two
 * `queryFn`s registered for ONE query key, so whichever mounted first owned the
 * fetch and the other's cache bound and retry policy were dead code that read
 * as live. Every claim about how the logo URL is fetched is made against this
 * file now, and against the two surfaces only that they route through it.
 */
const LOGO_URL = join(srcRoot, 'features', 'organization', 'hooks', 'logo-url.ts');

describe('every field on the settings surface carries an accessible name', () => {
  /**
   * The same claims the credential form makes, on the settings surface (story
   * 1.4a). Since story 7.18 its fields live in dialogs, one change each, and
   * their ids are constants named once in `utils/element-ids.ts`.
   *
   * Written as its own block rather than folded into the one above, because the
   * assertions there are about `type="password"` and `autoComplete="username"` —
   * facts about credentials, not about forms. What generalizes is the binding:
   * `htmlFor`/`id` is the only thing that ties a `<Label>` to its control.
   */
  it('gives every field a label bound by htmlFor, and every label a field', () => {
    // THREE LABELLED FIELDS since story 7.18: the name's `<Input>` and the
    // leave year's day and month. The accent and the fire-rank setting are
    // radio groups, each named by `aria-labelledby` and asserted in their own
    // blocks below.
    const screen = source(SETTINGS);
    const fields = [...inputElements(screen), ...selectElements(screen)];
    const ids = fields.map((element) => /\bid=\{(\w+)\}/.exec(element)?.[1] ?? null);
    const targets = [...screen.matchAll(/<Label htmlFor=\{(\w+)\}/g)].map((found) => found[1] ?? '');

    expect(inputElements(screen)).toHaveLength(1);
    expect(selectElements(screen), 'a control became a select again').toHaveLength(2);
    expect(ids, 'a field carries no id constant, so no <Label> can name it').not.toContain(null);
    expect(new Set(ids).size, 'two fields share one id').toBe(ids.length);
    expect([...targets].sort()).toEqual([...(ids as string[])].sort());
    for (const id of ids) {
      expect(source(SETTINGS_ELEMENT_IDS), `${String(id)} names no id`).toMatch(
        new RegExp(`export const ${String(id)} = '[\\w-]+';`),
      );
    }
  });

  it('binds the refusal to every field, and only while it is on the page', () => {
    // One message per dialog, above its buttons: every field of the open
    // dialog points at it, and only while it is drawn — a reference to an
    // absent id is ignored in silence. ONE CONSTANT: only one dialog is open
    // at a time, and each draws its body only while open.
    const screen = source(SETTINGS);

    expect(source(SETTINGS_DIALOG), 'the dialog draws its refusal unconditionally').toMatch(
      /\{failure === null \? null : \(\s*<Notice id=\{ORGANIZATION_DIALOG_ERROR_ID\} role="alert">/,
    );
    for (const field of [...inputElements(screen), ...selectElements(screen), ...bareInputElements(screen)]) {
      expect(field, 'a field describes nothing, or names its refusal unconditionally').toContain(
        'aria-describedby={failure === null ? undefined : ORGANIZATION_DIALOG_ERROR_ID}',
      );
    }
  });

  it('bounds the leave-year day at 28, so the control cannot express the broken case', () => {
    // `0002:106` admits 1-28 by SHAPE rather than by validation, because a leave
    // year starting on the 30th has no boundary in February. The options come
    // from `@/features/organization/utils/leave-start`, where the days stop at
    // `LEAVE_START_LAST_DAY` (28) — asserted by that module's own test.
    const screen = source(SETTINGS_TIME);

    expect(selectElements(screen).some((control) => control.includes('id={ORGANIZATION_LEAVE_DAY_FIELD_ID}'))).toBe(true);
    expect(selectElements(screen).some((control) => control.includes('id={ORGANIZATION_LEAVE_MONTH_FIELD_ID}'))).toBe(
      true,
    );
    expect(screen).toContain('LEAVE_START_DAYS.map(');
    expect(screen).toContain('LEAVE_START_MONTHS.map(');
    expect(source(SETTINGS), 'a day beyond 28 is expressible').not.toMatch(/max=\{(29|30|31)\}/);
  });

  it('keeps every entered value by never controlling a field', () => {
    // UX-DR34: a refused save keeps what was entered. `value={…}` is the shape
    // that loses it on the render that shows the refusal; `defaultValue={…}`
    // seeds an uncontrolled field and never re-renders it away.
    for (const field of [...inputElements(source(SETTINGS)), ...selectElements(source(SETTINGS))]) {
      expect(field, 'a settings field is controlled').not.toMatch(/(?<![A-Za-z])value=\{/);
      expect(field, 'a settings field is not seeded from the row').toContain('defaultValue={organization.');
    }
  });

  it('delegates the failure-to-message pairing rather than branching on it', () => {
    const screen = source(SETTINGS);

    for (const file of [SETTINGS_CARD, SETTINGS_DIALOG]) {
      expect(source(file), `${file} no longer renders its message through the mapping`).toContain(
        't(organizationMessageKey(',
      );
    }
    for (const key of [
      'organization.error.refused',
      'organization.error.name',
      'organization.error.invalid',
      'organization.error.unavailable',
    ]) {
      expect(screen, `${key} is branched on in the screen`).not.toContain(key);
    }
  });

  it('builds no request and no client of its own', () => {
    const screen = source(SETTINGS);

    // A WORD BOUNDARY on `fetch(`, since the read's retry calls the query's
    // own `refetch()`, which is the query re-reading rather than a request
    // this screen builds.
    expect(screen, 'the settings screen reaches for fetch(').not.toMatch(/(?<![\w.])fetch\(/);
    for (const forbidden of ['createClient(', 'localStorage']) {
      expect(screen, `the settings screen reaches for ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('renders the read refusal outside the branch that needs a snapshot to exist', () => {
    // MUTATION-PROVEN GAP, found by the 1.4a review: a refusal drawn inside the
    // snapshot-gated branch is reachable only once a row has been read, so a
    // read that was REFUSED or UNAVAILABLE produced no row and no message.
    const card = source(SETTINGS_CARD);
    const gated = componentFunction(card, 'renderCards');

    expect(gated, 'no renderCards function to read').not.toBe('');
    expect(card, 'the settings card renders no alert').toContain('role="alert"');
    expect(gated, 'the refusal is inside the snapshot-gated branch').not.toContain('role="alert"');
    expect(gated, 'the refusal message is inside the snapshot-gated branch').not.toContain(
      'organizationMessageKey(',
    );
  });

  it('shows the skeleton only while the read is actually pending', () => {
    // Gated on `organization === null`, the skeleton was what a permanently
    // failed read looked like: a pulsing bar identical to a slow one. UX-DR40
    // asks for a skeleton rather than a spinner, not one that never resolves.
    const gated = componentFunction(source(SETTINGS_CARD), 'renderCards');

    expect(gated, 'the screen renders no skeleton').toContain('animate-pulse');
    expect(gated, 'the skeleton is not conditioned on the read being pending').toMatch(
      /isPending \? \(\s*<div role="status" aria-busy\b[\s\S]{0,80}?animate-pulse/,
    );
  });

  it('says it is loading to a screen reader, not only with pulsing bars (C500)', () => {
    const gated = componentFunction(source(SETTINGS_CARD), 'renderCards');

    expect(gated, 'the skeleton is silent to a screen reader').toMatch(
      /<div role="status" aria-busy[^>]*>\s*<span className="sr-only">\{t\('organization\.loading'\)\}<\/span>/,
    );
  });
});

describe('the settings page is facts, and each change opens its own dialog (story 7.18)', () => {
  /**
   * STORY 7.18. The page states the organization as facts in cards, and
   * every change — the name, the logo, the accent, the leave year's start,
   * the fire-rank setting and (story 10.3) the email-notifications switch —
   * opens its own dialog with one Spremi: six dialogs. Nothing on
   * the page writes on change, and no field is mounted outside a dialog.
   */
  const DIALOG_BODIES = [
    SETTINGS_PROFILE,
    SETTINGS_LOGO,
    SETTINGS_ACCENT,
    SETTINGS_TIME,
    SETTINGS_FIRE_RANKS,
    // Story 10.3.
    SETTINGS_EMAIL_NOTIFICATIONS,
  ];

  it('mounts no form outside the one dialog form every change draws', () => {
    expect(occurrences(source(SETTINGS), '<form'), 'a second form arrived on the page').toBe(1);
    expect(source(SETTINGS_DIALOG)).toContain('<form');
    // ONE SPREMI: the dialog form's only submit, beside its cancel.
    expect(occurrences(source(SETTINGS_DIALOG), 'type="submit"')).toBe(1);
    expect(source(SETTINGS_DIALOG), 'the save is not the existing key').toContain("{t('organization.save')}");
    // EVERY BODY IS DRAWN THROUGH IT, inside its own dialog.
    for (const file of DIALOG_BODIES) {
      expect(source(file), `${file} draws a form of its own`).not.toContain('<form');
      expect(source(file), `${file} draws its change outside the shared dialog`).toContain('<OrganizationDialogForm');
    }
    expect(
      occurrences(source(SETTINGS), '<OrganizationChangeDialog'),
      'a change has no dialog, or two',
      // SIX SINCE STORY 10.3: the email-notifications switch.
    ).toBe(6);
  });

  it('keeps each dialog mounted and drives it through open, so every close returns focus', () => {
    // 7.14 WAS BITTEN BY UNMOUNTING AN OPEN <dialog>: the element vanished with
    // its own state and focus fell to the body. The dialog element is always
    // rendered; `open` follows the hook's state, and ✕, the backdrop and
    // Escape all close it through that state and the element's own `close()`,
    // which returns focus to the opener. Not dismissible while a write is in
    // flight.
    const file = source(SETTINGS_DIALOG);
    const shell = file.slice(
      file.indexOf('export function OrganizationChangeDialog('),
      file.indexOf('export function OrganizationDialogForm('),
    );

    expect(shell, 'no dialog to read').not.toBe('');
    expect(shell).toMatch(/<Dialog\s+open=\{shown\}/);
    expect(shell).toContain('dismissible={!pending}');
    expect(shell, 'Escape closes the element behind the state').toMatch(
      /onCancel=\{[\s\S]{0,160}?event\.preventDefault\(\);\s*if \(!pending\) close\(\);/,
    );
    expect(shell, 'the body survives its opening').toContain('<Fragment key={opening.key}>');
    expect(shell, 'the dialog element itself is unmounted while closed').not.toMatch(/\?\s*<Dialog|&&\s*<Dialog/);
  });

  it('opens each dialog from its own button, which focus returns to', () => {
    const hook = source(SETTINGS_HOOK);
    const openers = [...source(SETTINGS).matchAll(/ref=\{openers\.(\w+)\}/g)].map((found) => found[1]);

    // SIX OPENERS, ONE PER DIALOG; `ProfileRow` takes *Profil*'s three by prop.
    // SIX SINCE STORY 10.3: the email-notifications card's own.
    expect(openers.sort()).toEqual(['emailNotifications', 'fireRanks', 'leaveYear']);
    expect(source(SETTINGS_PROFILE)).toContain('<Button ref={opener}');
    for (const opener of ['openers.name', 'openers.logo', 'openers.accent']) {
      expect(source(SETTINGS_PROFILE), `${opener} opens nothing`).toContain(`opener={${opener}}`);
    }
    expect(hook, 'a landed save does not return focus to its opener').toMatch(
      /setOpening\(null\);\s*setSaved\(dialog\);\s*focusLater\(\[\(\) => openers\[dialog\]\.current\], cardHeading\(dialog\)\);/,
    );
    expect(componentFunction(hook, 'close'), 'a closed dialog loses its opener').toContain(
      'focusLater([() => openers[was.dialog].current], cardHeading(was.dialog))',
    );
    expect(componentFunction(hook, 'close'), 'a dialog closes under its own write').toMatch(
      /if \(saving\.current\) return;/,
    );
  });

  it('writes nothing on change', () => {
    // The accent and the fire-rank setting used to save the instant they
    // changed, and the logo the instant a file was picked. Each now waits for
    // its Spremi, so a mistaken choice costs nothing.
    const screen = source(SETTINGS);

    for (const gone of ['applyAccent', 'applyFireRanks', 'chooseAccent', 'chooseFireRanks', 'queuedAccent', 'drainFireRanks']) {
      expect(screen, `${gone} is still on the surface`).not.toContain(gone);
    }
    for (const change of screen.match(/onChange=\{[\s\S]*?\n\s*\}\}/g) ?? []) {
      expect(change, 'a change handler writes').not.toMatch(/save\w*\(/);
    }
  });

  it('shows the timezone locked, says why, and offers no control for it (FR-8)', () => {
    const time = source(SETTINGS_TIME);

    expect(source(SETTINGS), 'a timezone control arrived').not.toMatch(/id=\{?["\w-]*TIMEZONE[\w-]*FIELD/);
    expect(time, 'the zone is not stated').toContain('{organization.timezone}');
    expect(time, 'the lock is not said in words').toContain("t('organization.timezoneLocked')");
    expect(time, 'the page does not say why').toContain("t('organization.timezoneReason')");
    // NEVER WRITTEN: no write names the zone or the type (story 7.18 review),
    // so a save on a stale cache cannot write an old one back.
    for (const handler of ['saveName', 'saveLeaveYear']) {
      expect(componentFunction(source(SETTINGS_HOOK), handler), `${handler} writes the zone`).not.toMatch(/timezone/);
      expect(componentFunction(source(SETTINGS_HOOK), handler), `${handler} writes the type`).not.toMatch(/organizationType/);
    }
  });

  it('sends the name and the leave year each on its own, and nothing it does not show', () => {
    // STORY 7.18 REVIEW. Both used to send one five-column write, the fields a
    // dialog did not show filled from the cached snapshot: a stale cache then
    // wrote another admin's change back. `snapshot.test.ts` executes the
    // columns each shape maps to; this reads that each handler sends its own.
    const hook = source(SETTINGS_HOOK);
    const name = componentFunction(hook, 'saveName');
    const year = componentFunction(hook, 'saveLeaveYear');

    expect(name, 'no saveName function to read').not.toBe('');
    expect(year, 'no saveLeaveYear function to read').not.toBe('');
    expect(name).toContain('row.id, { name })');
    expect(year).toMatch(/row\.id, \{\s*leaveYearStartMonth,\s*leaveYearStartDay,\s*\}\)/);
    expect(year).toContain('Number(entered.get(ORGANIZATION_LEAVE_MONTH_FIELD))');
    expect(year).toContain('Number(entered.get(ORGANIZATION_LEAVE_DAY_FIELD))');
    for (const handler of [name, year]) {
      expect(handler, 'a dialog sends a field off the cached row').not.toMatch(/row\.(?!id\b)\w+/);
      expect(handler.indexOf('preventDefault()'), 'the default submission is not stopped first').toBeLessThan(
        handler.indexOf('updateOrganization('),
      );
      expect(handler, 'an identity save carries another write with it').not.toMatch(/logoPath|brandAccent|usesFireRanks/);
    }
    expect(name, 'the name write carries the leave year').not.toMatch(/leaveYearStart/);
    expect(year, 'the leave year write carries the name').not.toMatch(/\bname\b/);
  });

  it('holds the name and the leave year still while their write is in flight', () => {
    // As 7.11's fields and every other control in these dialogs: a value
    // changed mid-write would be neither what was sent nor what was kept.
    for (const [file, id] of [
      [SETTINGS_PROFILE, 'ORGANIZATION_NAME_FIELD_ID'],
      [SETTINGS_TIME, 'ORGANIZATION_LEAVE_DAY_FIELD_ID'],
      [SETTINGS_TIME, 'ORGANIZATION_LEAVE_MONTH_FIELD_ID'],
    ] as const) {
      const control = new RegExp(`id=\\{${id}\\}[\\s\\S]{0,600}?className=`).exec(source(file))?.[0] ?? '';

      expect(control, `no ${id} control to read`).not.toBe('');
      expect(control, `${id} stays live while its write is in flight`).toContain('disabled={pending}');
    }
  });

  it('moves focus to the read retry when a re-read loses the row under an open dialog', () => {
    // The dialog closes with the row; without this, focus fell to `<body>`.
    const hook = source(SETTINGS_HOOK);

    expect(hook).toMatch(
      /if \(organization !== null \|\| opening === null \|\| saving\.current\) return;[\s\S]{0,200}?focusLater\(\[byId\(ORGANIZATION_READ_RETRY_ID\), byId\(ORGANIZATION_ERROR_ID\)\], byId\(ORGANIZATION_ERROR_ID\)\);/,
    );
    expect(source(SETTINGS_CARD), 'the retry carries no id to focus').toContain('id={ORGANIZATION_READ_RETRY_ID}');
    expect(source(SETTINGS_CARD), 'the read message cannot take focus').toMatch(
      /<Notice id=\{ORGANIZATION_ERROR_ID\}[^>]*tabIndex=\{-1\}/,
    );
  });
});

describe('the logo control the general sweeps structurally cannot see', () => {
  /**
   * STORY 1.4b. Every other control on this screen is an `<Input>`, a
   * `<Select>` or a `<Button>`, and every sweep above is built on those
   * detectors. The file picker is neither: it is a bare `<input type="file">`
   * kept off-screen, and the affordance a pointer meets is a `<Button>` that
   * opens it. Since story 7.18 both live in the logo's dialog, and the pick is
   * held until its Spremi.
   */

  it('keeps exactly one file picker, off-screen but still in the accessibility tree', () => {
    const pickers = bareInputElements(source(SETTINGS));

    // NON-VACUITY first: with no bare input found, every assertion below would
    // pass against an empty string and read as coverage.
    expect(pickers, 'no bare <input> on the settings surface').toHaveLength(1);

    const picker = pickers[0] ?? '';

    expect(attributeOf(picker, 'type'), 'the picker is not a file input').toBe('file');
    expect(picker, 'the picker carries no id to open it by').toContain('id={ORGANIZATION_LOGO_FIELD_ID}');
    // `sr-only` and NOT `hidden`: `hidden` removes the control from the
    // accessibility tree and from the tab order.
    expect(picker, 'the picker is not kept off-screen').toContain('sr-only');
    expect(picker, 'the picker is removed from the accessibility tree').not.toMatch(/(^|\s)hidden(\s|$|=)/);
    expect(picker, 'the picker carries no accessible name').toMatch(/aria-label=\{t\(/);
    // DISABLED TOO while a write is in flight, and not only the button.
    expect(picker, 'the picker stays live while an upload is in flight').toContain('disabled={pending}');
    expect(picker, 'the accept hint is written by hand rather than derived').toContain(
      'accept={ORGANIZATION_LOGO_ACCEPT}',
    );
  });

  it('gives the picker a visible action that clears the tap-target floor', () => {
    const choose =
      buttonElements(source(SETTINGS_LOGO)).find((element) => element.includes('variant="dashed"')) ?? null;

    expect(choose, 'nothing in the dialog opens the file picker').not.toBeNull();
    expect(source(SETTINGS_LOGO), 'the visible action does not open the picker').toContain('picker.current?.click()');
    expect(choose, 'the choose action would submit the dialog').toContain('type="button"');
    expect(choose, 'the choose action stays live while an upload is in flight').toContain('disabled={pending}');

    const measured = heightPx(attributeOf(choose ?? '', 'className'));

    expect(measured, 'the choose action declares no usable height class').not.toBeNull();
    expect(measured).toBeGreaterThanOrEqual(TARGET_FLOOR_PX);
  });

  it('never renders a broken image, however the signed URL stops working', () => {
    // A signed URL is a capability with a deadline: the cache is bounded below
    // the expiry, and the element falls back when the load fails for any
    // reason a timer cannot predict. Asserted on the one module that fetches.
    const reader = source(LOGO_URL);

    expect(reader, 'the derived key is not the snapshot’s own').toContain('queryKey: organizationLogoKey(logoPath)');
    expect(reader, 'the signed URL is cached without regard for its expiry').toContain('staleTime: LOGO_URL_STALE_MS');
    expect(reader, 'a settled refusal is retried as though it were slow').toContain('retry: false');
    expect(reader, 'storage is asked even when the column says there is nothing').toContain(
      'enabled: logoPath !== null',
    );
    expect(reader, 'a URL the browser cannot load is never taken back').toContain('setUnrenderable(readable)');

    // And both surfaces route through it rather than round it: the settings
    // hook reads it, and both places the page draws the stored logo — the
    // *Profil* fact and the logo's dialog — fall back with it.
    for (const { surface, reads, draws } of [
      { surface: SETTINGS, reads: SETTINGS_HOOK, draws: [SETTINGS_PROFILE, SETTINGS_LOGO] },
      { surface: CHROME, reads: CHROME, draws: [CHROME] },
    ]) {
      expect(source(reads), 'a surface fetches the signed URL itself').toContain('useRenderableLogo(');
      expect(source(surface), 'a surface still registers its own logo query').not.toContain(
        'queryKey: organizationLogoKey(',
      );
      for (const file of draws) {
        expect(source(file), 'the lockup has no failure path, so a dead URL renders broken').toContain(
          'onUnrenderable={logo.onUnrenderable}',
        );
      }
    }
  });

  it('delegates the whole upload rather than sequencing it here', () => {
    // A `.tsx` is collected by nothing (AD-15): the sequence, the ordering and
    // the path are executed in `logo.test.ts`. What is left to assert is that
    // the surface ROUTES through it, hands over the snapshot, and derives no
    // path of its own.
    const upload = componentFunction(source(SETTINGS_HOOK), 'saveLogo');

    expect(upload, 'no saveLogo function to read').not.toBe('');
    expect(upload, 'the surface no longer routes through the upload module').toContain('replaceOrganizationLogo(');
    expect(upload, 'the surface hands over something other than the snapshot').toMatch(
      /replaceOrganizationLogo\([\s\S]{0,240}?\n\s+row,/,
    );
    for (const sequenced of ['organizationLogoPath(', 'uploadOrganizationLogo(', 'logoPath:']) {
      expect(source(SETTINGS), `the surface sequences the upload itself by naming ${sequenced}`).not.toContain(
        sequenced,
      );
    }
  });

  it('logs a read it could not render rather than falling back in silence', () => {
    const reader = componentFunction(source(LOGO_URL), 'signedLogoUrl');

    expect(reader, 'no signedLogoUrl function to read').not.toBe('');
    expect(reader, 'a failed read reports nothing at all').toMatch(/!outcome\.ok[\s\S]{0,80}?console\.error\(/);
  });

  it('clears the picker after a chosen file, and holds the file for Spremi', () => {
    // A file input fires no `change` event when the same file is chosen twice
    // running, so without the reset "the upload was refused, try that file
    // again" does nothing at all. The pick only holds the file: Spremi sends.
    const dialog = source(SETTINGS_LOGO);
    const change = /onChange=\{\(event\) => \{([\s\S]*?)\n {10}\}\}/.exec(dialog)?.[1] ?? '';

    expect(change, 'no change handler to read').not.toBe('');
    expect(change, 'the picker is never cleared').toContain('value = NO_FILE_CHOSEN');
    expect(change, 'a pick uploads before Spremi').not.toContain('saveLogo(');
    expect(change, 'the pick is not held').toContain('setChosen(file)');
    expect(dialog, 'Spremi waits for nothing').toContain('canSave={chosen !== null}');
    expect(dialog, 'Spremi does not send the held file').toContain('await saveLogo(chosen)');
  });
});

describe('the accent control offers a curated set and nothing else', () => {
  /**
   * STORY 1.4c, and since story 7.18 the control is named radio cards in the
   * accent's own dialog (UX-DR5). A radio group is neither an `<Input>`, a
   * `<Select>` nor a `<Button>`, so every general sweep in this file
   * structurally cannot see it. Each property it would otherwise have
   * inherited is claimed here by name.
   */
  const group = (): string => /<RadioGroup\b([\s\S]*?)>/.exec(source(SETTINGS_ACCENT))?.[1] ?? '';

  it('is one radio group of named cards, labelled and described by the rule', () => {
    const accent = source(SETTINGS_ACCENT);

    expect(group(), 'no accent control on the settings surface').not.toBe('');
    expect(group(), 'the accent control is not labelled').toContain('aria-labelledby={ORGANIZATION_ACCENT_LABEL_ID}');
    expect(group(), 'the UX-DR5 rule does not describe the choice, or the refusal does not').toContain(
      'aria-describedby={failure === null ? ORGANIZATION_ACCENT_RULE_ID : ORGANIZATION_ACCENT_REFUSED_DESCRIPTION}',
    );
    expect(group(), 'a refused accent is not marked').toContain(
      'aria-invalid={refusedField === ORGANIZATION_ACCENT_FIELD}',
    );
    expect(accent).toContain('<p id={ORGANIZATION_ACCENT_LABEL_ID}');
    expect(accent).toContain('<p id={ORGANIZATION_ACCENT_RULE_ID}');
    expect(accent, 'the rule is not said beside the cards').toContain("t('organization.accentRule')");
    // A NAME ON EVERY CARD, in words: the mark beside it only previews the
    // tint, hidden from assistive technology, so no card is a colour alone.
    expect(accent).toContain('<RadioCard key={brandAccentValue(option)} value={brandAccentValue(option)}>');
    expect(accent).toMatch(/<span aria-hidden[^>]*>\s*<OrganizationLockup/);
    expect(group(), 'the cards stay live while the write is in flight').toContain('disabled={pending}');
  });

  it('offers the curated options rather than a set written into the screen', () => {
    // A LIST WRITTEN HERE would be a fifth copy of the accent set — after the
    // check constraint, the tokens, the module and `hr.json`. The options come
    // from the module `accent.test.ts` pins to `0006`, and their names come
    // from the mapping it executes.
    const accent = source(SETTINGS_ACCENT);

    expect(accent, 'the options are not read off the curated set').toContain('BRAND_ACCENT_OPTIONS.map(');
    expect(accent, 'the option names are not resolved through the tested mapping').toContain(
      't(accentMessageKey(option))',
    );
  });

  it('offers no way to express a colour, which is the whole of the curation', () => {
    // The frozen "Never": no free-form colour input, no hex field, no colour
    // picker. Every colour has its contrast measured at BUILD time.
    const screen = source(SETTINGS);

    expect(screen, 'the screen offers a native colour picker').not.toContain('type="color"');
    expect(screen, 'the screen accepts a hand-written colour').not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    for (const forbidden of ['oklch(', 'rgb(', 'hsl(', 'setProperty']) {
      expect(screen, `the screen names ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('starts from what the row holds, and never folds an unknown accent into none', () => {
    // A row written by a newer build is an ordinary state during a deploy.
    // Folded into `Neutralna`, the dialog would claim the organization had no
    // accent. Nothing is chosen instead, Spremi waits, and the line says why.
    const accent = source(SETTINGS_ACCENT);

    expect(accent).toContain('const unknown = stored !== null && brandAccentOf(stored) === null;');
    expect(accent).toContain('useState<string | null>(unknown ? null : brandAccentValue(brandAccentOf(stored)))');
    expect(accent, 'Spremi does not wait for a choice').toContain('canSave={chosen !== null}');
    expect(accent, 'nothing says why Spremi waits').toMatch(
      /\{chosen === null \? \([\s\S]{0,160}?t\('organization\.accentChoose'\)/,
    );
  });

  it('keeps a failed refetch out of the write’s own outcome', () => {
    // The row has already changed by the time the invalidation runs, so a
    // refetch that rejects must not be reported as a refused save: that tells
    // somebody their accent was rejected while the database holds it. Its own
    // `catch`, and no `setFailure` inside it. ONE RUNNER for all five writes
    // since story 7.18, so one place to hold it.
    const write = componentFunction(source(SETTINGS_HOOK), 'write');
    const invalidation =
      /try \{\s*await queryClient\.invalidateQueries[\s\S]*?catch[\s\S]*?\n {6}\}/.exec(write)?.[0] ?? '';

    expect(write, 'no write function to read').not.toBe('');
    expect(occurrences(write, 'invalidateQueries('), 'an invalidation escapes its own try').toBe(
      occurrences(invalidation, 'invalidateQueries('),
    );
    expect(invalidation, 'the invalidation is not guarded at all').not.toBe('');
    expect(invalidation, 'a failed refetch reports the landed write as refused').not.toContain('setFailure(');
    expect(invalidation, 'a failed refetch is swallowed in silence').toContain('console.error(');
    expect(invalidation, 'the invalidation is not the snapshot’s key').toContain(
      'invalidateQueries({ queryKey: ORGANIZATION_SNAPSHOT_KEY })',
    );
    // TWO SINCE STORY 10.3, both in the runner's one guarded try: the
    // snapshot, and a write's declared dependents (the email switch's
    // `/obavijesti` read).
    expect(occurrences(source(SETTINGS_HOOK), 'invalidateQueries('), 'a write invalidates outside the runner').toBe(2);
  });

  it('marks and focuses the control a refused save names, and only that one', () => {
    // The database names the constraint, and `refusedOrganizationFieldOf`
    // (executed in `snapshot.test.ts`) maps it to a control. What is left to
    // pin here is the wiring: each field compares against its OWN field, and a
    // refused save moves focus to the named control in the handler.
    const write = componentFunction(source(SETTINGS_HOOK), 'write');

    for (const [file, id, field] of [
      [SETTINGS_PROFILE, 'ORGANIZATION_NAME_FIELD_ID', 'ORGANIZATION_NAME_FIELD'],
      [SETTINGS_TIME, 'ORGANIZATION_LEAVE_DAY_FIELD_ID', 'ORGANIZATION_LEAVE_DAY_FIELD'],
      [SETTINGS_TIME, 'ORGANIZATION_LEAVE_MONTH_FIELD_ID', 'ORGANIZATION_LEAVE_MONTH_FIELD'],
    ] as const) {
      const control = new RegExp(`id=\\{${id}\\}[\\s\\S]{0,400}?aria-invalid=\\{([^}]*)\\}`).exec(source(file))?.[1];

      expect(control, `${id} carries no aria-invalid`).toBe(`refusedField === ${field}`);
    }
    expect(write, 'a refused save does not keep the field it names').toMatch(
      /const field = outcome\.field \?\? null;[\s\S]{0,120}?setRefusedField\(field\)/,
    );
    expect(write, 'a refused save does not move focus to the named control').toContain(
      'focusRefused(dialog, field === null ? undefined : REFUSED_FIELD_IDS[field]);',
    );
    // A WRITE THAT THREW is refused the same way, never left on a disabled button.
    expect(write, 'a thrown write leaves focus on the body').toMatch(
      /setFailure\(unavailable\);\s*focusRefused\(dialog, undefined\);/,
    );
    // ANY OTHER REFUSAL puts focus back on the logo's `Odaberi sliku`, or on
    // Spremi: every control was disabled while the write was in flight and so
    // lost it. `focusLater` waits for the target to re-enable.
    const focusRefused = componentFunction(source(SETTINGS_HOOK), 'focusRefused');

    expect(focusRefused, 'a refusal that names no field leaves focus on the body').toContain(
      'field ?? (dialog === LOGO_DIALOG ? ORGANIZATION_LOGO_CHOOSE_ID : ORGANIZATION_DIALOG_SAVE_ID)',
    );
    expect(focusRefused).toContain('focusLater([byId(retry), byId(ORGANIZATION_DIALOG_SAVE_ID)], cardHeading(dialog));');
    expect(source(SETTINGS_LOGO), 'Odaberi sliku carries no id to come back to').toContain(
      'id={ORGANIZATION_LOGO_CHOOSE_ID}',
    );
    expect(source(SETTINGS_DIALOG), 'Spremi carries no id to come back to').toContain(
      'id={ORGANIZATION_DIALOG_SAVE_ID}',
    );
    // THE MAP, read entry by entry: each field sends focus to its own id.
    const body = /const REFUSED_FIELD_IDS[^=]*=\s*\{([\s\S]*?)\};/.exec(source(SETTINGS_HOOK))?.[1] ?? '';

    expect(body, 'no field map to read').not.toBe('');
    for (const [field, id] of [
      ['name', 'ORGANIZATION_NAME_FIELD_ID'],
      ['leaveYearStartDay', 'ORGANIZATION_LEAVE_DAY_FIELD_ID'],
      ['leaveYearStartMonth', 'ORGANIZATION_LEAVE_MONTH_FIELD_ID'],
    ] as const) {
      expect(body, `a ${field} refusal focuses another control`).toContain(`${field}: ${id},`);
    }
    expect(source(SETTINGS_HOOK), 'the field outlives the refusal it explains').toContain(
      'refusedField: failure === null ? null : refusedField,',
    );
  });

  it('offers the failed read a retry that re-reads the one query', () => {
    const hook = source(SETTINGS_HOOK);
    const retry = componentFunction(hook, 'retryRead');
    const button = buttonElements(source(SETTINGS_CARD)).find((element) => element.includes('onClick={retryRead}'));

    expect(retry, 'no retryRead function to read').not.toBe('');
    expect(retry, 'the retry does not re-read the snapshot query').toContain('snapshot.refetch()');
    expect(hook, 'the retry is offered for a code whose message asks for none').toContain(
      'offersReadRetry(readFailure)',
    );
    // A THROWN read is a failed read: the refusal and the retry both read
    // `readFailureOf(answered)` (executed in `snapshot.test.ts`) — the read as
    // the page's freshness answers it (story 8.2d), so offline with nothing
    // cached it is the unavailable message, never an endless skeleton — after
    // a refusal the read RESOLVED with, which is drawn as its own message
    // whatever the freshness says (`organizationRefusalOf`, executed in
    // `surface-keys.test.ts`).
    expect(hook, 'a read that threw is not treated as a failed read').toContain(
      'const readFailure = organizationRefusalOf(snapshot.data) ?? readFailureOf(answered);',
    );
    // STORY 8.2d, decision 2a: no read retry offline.
    expect(hook, 'the read retry is offered offline').toMatch(/const readRetry = clock\.online && /);
    // AFTER THE RETRY: the answer is committed through `flushSync`, then a
    // success focuses the first change on the page (the button just
    // unmounted) and every attempt re-keys the alert.
    expect(retry, 'the retry does not commit before deciding focus').toMatch(
      /await snapshot\.refetch\(\);\s*flushSync\(\(\) => \{\s*setReadAttempts\(/,
    );
    expect(retry, 'a successful retry drops focus to the body').toMatch(
      /\}\);\s*if \(retried\.data\?\.ok === true\) focusLater\(\[\(\) => nameOpener\.current\], cardHeading\(NAME_DIALOG\)\);/,
    );
    expect(source(SETTINGS_CARD), 'a retry that fails again is not re-announced').toMatch(
      /<Notice id=\{ORGANIZATION_ERROR_ID\} role="alert" key=\{readAttempts\}/,
    );
    expect(button, 'nothing on the card calls the retry').toBeDefined();
    expect(source(SETTINGS_CARD), 'the retry is not labelled by the existing key').toMatch(
      /onClick=\{retryRead\}\s*>\s*\{t\('shell\.retry'\)\}/,
    );
    expect(source(SETTINGS_CARD), 'the retry renders whether or not a read failed').toMatch(
      /\{readRetry \? \(\s*<Button/,
    );
  });

  it('states what the row holds, even an accent this build cannot name', () => {
    // READ OUT OF THE SNAPSHOT, in *Profil*: the fact is what the database
    // holds. `accentMessageKey` folds an unrecognised key to `Neutralna`, which
    // is right for the class it resolves and a lie here, so the label comes
    // from its own module (executed in `accent-label.test.ts`).
    const profile = source(SETTINGS_PROFILE);

    expect(profile, 'the fact is read off something other than the row').toContain(
      'storedAccentLabel(organization.brandAccent)',
    );
    expect(profile, 'the card does not take the label from its module').toContain(
      "import { storedAccentLabel } from '@/features/organization/utils/accent-label';",
    );
    for (const file of SETTINGS.filter((part) => part !== SETTINGS_ACCENT_LABEL)) {
      expect(source(file), `${file} keeps a local copy of the label`).not.toContain('function storedAccentLabel(');
    }

    const label = exportedFunction(source(SETTINGS_ACCENT_LABEL), 'storedAccentLabel');

    expect(label, 'no storedAccentLabel function to read').not.toBe('');
    expect(label, 'the fact renames an accent it cannot resolve').toMatch(
      /brandAccentOf\(accent\) === null && accent !== null/,
    );
  });

  it('writes the accent on its own, never with another write', () => {
    // THE CLOBBER the disjoint write shapes exist to prevent: an identity save
    // that also carried `brandAccent` would overwrite a choice made in another
    // dialog, and an accent write that carried the name would push one.
    const hook = source(SETTINGS_HOOK);
    const accentWrite = componentFunction(hook, 'saveAccent');

    expect(accentWrite, 'no saveAccent function to read').not.toBe('');
    expect(accentWrite, 'the accent write does not go through the tested module').toContain('updateOrganization(');
    expect(accentWrite, 'the accent write carries another field with it').toContain('{ brandAccent: accent }');
    expect(source(SETTINGS_ACCENT), 'the chosen key does not cross through the narrowing').toContain(
      'saveAccent(brandAccentOf(chosen))',
    );
  });
});
