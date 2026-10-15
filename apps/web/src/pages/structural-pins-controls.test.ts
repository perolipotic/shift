import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { HOURS_SCREEN_PARTS } from '@/features/hours/hours-screen.fixture';
import { SHIFT_TYPE_LIST_PARTS } from '@/features/shift-types/shift-type-screens.fixture';

import {
  attributeOf,
  buttonElements,
  heightPx,
  inputElements,
  KALENDAR,
  MEMBER_CREATE,
  MEMBER_EDIT,
  MEMBER_LIST,
  MEMBERS_FEATURE,
  NOT_FOUND,
  occurrences,
  ROTATION_HISTORY_DIALOG,
  SCREENS,
  selectElements,
  SETTINGS,
  SHARED_SORT_CONTROL,
  SHIFT_TYPE_LIST,
  SIGN_IN_FORM,
  source,
  srcRoot,
  TARGET_FLOOR_PX,
} from './source-guards.fixture';

// App-wide control pins: the Select primitive, stacked table rows, the 44 px tap-target
// floor, the input boundary, and forms that refuse in Croatian.

const INPUT_PRIMITIVE = join(srcRoot, 'components', 'ui', 'input.tsx');

const SELECT_PRIMITIVE = join(srcRoot, 'components', 'ui', 'select.tsx');

describe('every select is the one Select primitive, in the one Input look', () => {
  /**
   * VISUAL REFRESH B held nine, then twelve, native `<select>`s to one LITERAL
   * class string written on each, because the 44 px sweep reads `h-11` off a
   * quoted `className`. The look now lives once, in `components/ui/select.tsx`
   * — still a native `<select>` underneath — and a screen composes only the
   * height, as it does on `<Input>`. So this holds three things: no screen
   * writes a bare `<select>` beside the primitive, every screen's `<Select>`
   * composes `h-11` and nothing else, and the primitive draws the string
   * `components/README.md` documents.
   */
  const SELECT_SCREENS = [MEMBER_LIST, MEMBER_CREATE, MEMBER_EDIT, SETTINGS, SHIFT_TYPE_LIST, KALENDAR];
  const README = join(srcRoot, 'components', 'README.md');

  function selectClasses(): string[] {
    return SELECT_SCREENS.flatMap((file) =>
      selectElements(source(file)).map((control) => attributeOf(control, 'className') ?? ''),
    );
  }

  it('finds all fourteen, so the comparison is not vacuous', () => {
    // THIRTEEN: the twelve visual refresh B held to one literal, and the shift
    // type kind on `/postavke-rotacije`, which that block never listed.
    // FOURTEEN SINCE STORY 3.3a: the calendar's team filter.
    // FIFTEEN SINCE STORY 3.5b: the override form's type.
    // SEVENTEEN SINCE STORY 3.6b: the roster form's "Skida se" and "Dolazi".
    // SIXTEEN SINCE STORY 7.5: the calendar's filter is chips, not a Select.
    // FOURTEEN SINCE STORY 7.13: so is the member list's.
    // TWELVE SINCE STORY 7.18: the accent and the fire-rank setting are
    // radio groups in their dialogs, not selects.
    expect(selectClasses()).toHaveLength(12);
  });

  it('composes only the 44 px height onto each, so no screen restyles the primitive', () => {
    for (const classes of selectClasses()) expect(classes).toBe('h-11');
  });

  it('leaves no bare native select on any screen', () => {
    const files = [...new Set([...SCREENS.map((screen) => screen.file), ...SELECT_SCREENS])];

    for (const file of files) {
      expect(source(file), `a bare <select> on ${file}`).not.toMatch(/<select\b/);
    }
  });

  it('draws the documented class string in the primitive', () => {
    const documented =
      /Select class string:\s*`([^`]+)`/.exec(readFileSync(README, 'utf8'))?.[1] ?? '';
    const drawn = /cn\(\s*"([^"]+)"/.exec(source(SELECT_PRIMITIVE))?.[1] ?? '';

    expect(documented.length, 'README no longer documents the select class string').toBeGreaterThan(0);
    expect(drawn).toBe(documented);
  });
});

describe('a table becomes stacked rows below 640 px (story 7.6)', () => {
  /**
   * NFR-15: below 640 px the Sati, Ljudi and shift-types tables render their
   * own view model as a list (`ul` of `li`, each value a `dt` + `dd`), never
   * a table restyled with `display` overrides, which drops its roles in
   * WebKit, and never both forms with one hidden. What no DOM test here can
   * see (AD-15) is read from the source; the widths are measured in
   * `e2e/tests/layout/responsive.spec.ts`.
   */
  const STACKED_PRIMITIVE = join(srcRoot, 'components', 'ui', 'stacked-list.tsx');
  const ROWS = [
    join(srcRoot, ...HOURS_SCREEN_PARTS.organizationRows),
    join(MEMBERS_FEATURE, 'components', 'member-rows.tsx'),
    join(srcRoot, ...SHIFT_TYPE_LIST_PARTS.rows),
  ];
  const SWITCHES = [
    join(srcRoot, ...HOURS_SCREEN_PARTS.body),
    join(MEMBERS_FEATURE, 'components', 'member-table.tsx'),
    join(srcRoot, ...SHIFT_TYPE_LIST_PARTS.table),
  ];

  it('builds the list from one primitive: a ul, an li, and a dt beside every dd', () => {
    const primitive = source(STACKED_PRIMITIVE);

    expect(primitive).toMatch(/<ul\b/);
    expect(primitive).toMatch(/<li\b/);
    expect(primitive).toMatch(/<dl\b/);
    expect(occurrences(primitive, '<dt'), 'a field draws no label, or two').toBe(1);
    expect(occurrences(primitive, '<dd'), 'a field draws no value, or two').toBe(1);
    // The label is only ever HIDDEN visually, never dropped.
    expect(primitive).toMatch(/data-\[hidden=true\]:sr-only/);
    expect(primitive, 'the list scrolls sideways').not.toMatch(/overflow-/);
    // The list is named by the table's caption: the name is required.
    expect(primitive).toMatch(/"aria-label": string/);
  });

  it.each(ROWS)('draws %s as a list, never a restyled table', (file) => {
    const rows = source(file);

    expect(rows.length).toBeGreaterThan(500);
    expect(rows, 'a rows form draws table markup').not.toMatch(/<Table|<table\b|<tr\b|<td\b|<th\b/);
    expect(rows, 'a rows form scrolls sideways').not.toMatch(/overflow-/);
    expect(rows, 'a rows form overrides display with a style').not.toMatch(/display\s*:/);
    expect(rows).toMatch(/<StackedList\b[^>]*aria-label=/);
  });

  it.each(ROWS)('labels every value in %s through StackedField', (file) => {
    const rows = source(file);
    // LABEL FIRST, pinned: every `<StackedField` opens with `label={`, so the
    // check reads no further than the tag's name and cannot be fooled by a
    // `=>` or a `>` inside a later prop.
    const opened = occurrences(rows, '<StackedField ') + occurrences(rows, '<StackedField\n');
    const labelled = [...rows.matchAll(/<StackedField\s+label=\{/g)].length;

    expect(opened, 'no value goes through StackedField').toBeGreaterThan(1);
    expect(labelled, 'a StackedField does not open with its column label').toBe(opened);
    expect(rows, 'a value is drawn outside StackedField').not.toMatch(/<dd\b|<dt\b|<dl\b/);
  });

  /**
   * The 2026-10 deferred-work cleanup: four more tables stack, each in the
   * same file as its table, so the `ROWS` sweeps (which refuse table markup)
   * do not apply. What does: a named list, a label on every field, and one
   * form at a time by `usePhone`. The rotation section is read for the first
   * two only; its stepper hides steps by breakpoint class on purpose.
   */
  const INLINE_ROWS = [
    join(srcRoot, 'features', 'hour-bands', 'components', 'hour-band-table.tsx'),
    join(srcRoot, 'features', 'teams', 'components', 'team-table.tsx'),
    ROTATION_HISTORY_DIALOG,
    join(srcRoot, 'features', 'rotation', 'components', 'rotation-section.tsx'),
  ];

  it.each(INLINE_ROWS)('stacks %s below 640 px as a named list whose every value is labelled', (file) => {
    const screen = source(file);
    const opened = occurrences(screen, '<StackedField ') + occurrences(screen, '<StackedField\n');
    const labelled = [...screen.matchAll(/<StackedField\s+label=\{/g)].length;

    expect(screen).toMatch(/const isPhone = usePhone\(\);/);
    expect(screen).toMatch(/<StackedList\b[^>]*aria-label=/);
    expect(opened, 'no value goes through StackedField').toBeGreaterThan(0);
    expect(labelled, 'a StackedField does not open with its column label').toBe(opened);
  });

  it.each(INLINE_ROWS.slice(0, 3))('never draws both forms in %s, one hidden by a class', (file) => {
    expect(source(file)).not.toMatch(/max-sm:hidden|sm:hidden|hidden sm:/);
  });

  it.each(SWITCHES)('renders one form at a time in %s, by usePhone', (file) => {
    const screen = source(file);

    expect(screen).toMatch(/const isPhone = usePhone\(\);/);
    // Never both drawn and one hidden by a breakpoint class.
    expect(screen).not.toMatch(/max-sm:hidden|sm:hidden|hidden sm:/);
  });

  it('sorts on a phone through the one shared control, whose pick is the heading press', () => {
    const control = source(SHARED_SORT_CONTROL);

    expect(control).toMatch(/<Popover\b[^>]*aria-label=\{t\('sort\.picker'\)\}/);
    expect(control).toMatch(/aria-pressed=\{column\.key === active\}/);
    expect(control).toMatch(/pickerIndexAfter\(/);
    // A pick and Escape put focus back on the control.
    expect(control).toMatch(/setOpen\(false\);\s*trigger\.current\?\.focus\(\);/);
    expect(source(join(srcRoot, ...HOURS_SCREEN_PARTS.organizationRows))).toMatch(/onPick=\{onPress\}/);
    expect(source(join(MEMBERS_FEATURE, 'components', 'member-table.tsx'))).toMatch(/onPick=\{pressColumn\}/);
  });
});

describe('every control on the screen clears the 44 px tap-target floor', () => {
  /**
   * MUTATION-PROVEN GAP. The inherited primitives are `h-9` — 36 px — and the
   * screen composes `h-11` onto each of them. Deleting all four `h-11` classes
   * left 900 tests green while every control on the one screen nobody can skip
   * dropped 8 px below UX-DR40's floor.
   *
   * The height is asserted on the COMPOSED className rather than on the
   * primitive, because that is where the fix lives: the primitives are
   * inherited byte-verbatim and must not be edited.
   */
  it.each([0, 1])('gives input %i a height of at least 44 px', (index) => {
    const element = inputElements(source(SIGN_IN_FORM))[index] ?? '';
    const measured = heightPx(attributeOf(element, 'className'));

    expect(measured, `input ${index} declares no usable height class`).not.toBeNull();
    expect(measured).toBeGreaterThanOrEqual(TARGET_FLOOR_PX);
  });

  it('gives the submit button a height of at least 44 px', () => {
    const element = buttonElements(source(SIGN_IN_FORM))[0] ?? '';
    const measured = heightPx(attributeOf(element, 'className'));

    expect(measured, 'the submit button declares no usable height class').not.toBeNull();
    expect(measured).toBeGreaterThanOrEqual(TARGET_FLOOR_PX);
  });

  it('gives the not-found link the same floor, since it is also a control', () => {
    const element = buttonElements(source(NOT_FOUND))[0] ?? '';
    const measured = heightPx(attributeOf(element, 'className'));

    expect(measured, 'the not-found link declares no usable height class').not.toBeNull();
    expect(measured).toBeGreaterThanOrEqual(TARGET_FLOOR_PX);
  });

  it.each(SCREENS)('clears the floor on every control in $name', ({ file, expectedFields, expectedButtons }) => {
    // The named assertions above are the mutation-proven ones and stay. This is
    // the general claim they cannot make: a control added to any screen later,
    // on any of the four, is measured without anyone remembering to add a case
    // — which is how the organization prompt's own two controls got covered.
    const screen = source(file);

    // THREE DETECTORS, not two. `<select>` joined in story 1.4c, and it joined
    // the GENERAL sweep rather than only the named block that introduced it:
    // a control type known to one screen's own block and to nothing else is a
    // control type that escapes the floor and the count everywhere else, which
    // is exactly the state `<Link>` was in until the chrome brought it in.
    const fields = [...inputElements(screen), ...selectElements(screen)];
    const buttons = buttonElements(screen);
    const controls = [...fields, ...buttons];

    // NON-VACUITY. Without this the loop asserts nothing on a screen it finds
    // no controls on, and it already found none on two of the four — so half
    // its cases were passing on an empty set while reading as coverage. It also
    // records the detectors' reach: they match self-closing `<Input />`,
    // `<Button` and `<select` only, so a raw `<button>` or a future primitive is
    // invisible here and the count is what would notice it disappearing.
    // Counted APART, so a field swapped for a button moves both numbers.
    expect(fields.length, `the field count moved on ${file}`).toBe(expectedFields);
    expect(buttons.length, `the button count moved on ${file}`).toBe(expectedButtons);

    for (const element of controls) {
      const measured = heightPx(attributeOf(element, 'className'));

      expect(measured, `a control declares no usable height class: ${element}`).not.toBeNull();
      expect(measured).toBeGreaterThanOrEqual(TARGET_FLOOR_PX);
    }
  });
});

describe('the boundary the theme layer raised is the one the control draws', () => {
  /**
   * MUTATION-PROVEN GAP, and the same shape as story 1.1b's original loopback.
   * `--input` was raised to 3.23:1 for WCAG 1.4.11 and measured in
   * `test/theme-contrast.test.ts`; changing one class in `input.tsx` from
   * `border-input` to `border-border` left every ratio true of a token that
   * nothing on screen consumed, with the whole suite green.
   *
   * `test/theme-applied.test.ts` holds the other half — that the BUILT sheet
   * emits a `.border-input` rule. This is the source-level half, so a
   * build-less checkout still refuses the mutation.
   */
  it('draws the text input boundary from --input', () => {
    const primitive = source(INPUT_PRIMITIVE);

    expect(
      primitive,
      'input.tsx no longer names border-input — the raised token is not the one the control draws',
    ).toContain('border-input');
  });

  it('does not draw it from --border, which is pinned below AA on purpose', () => {
    expect(source(INPUT_PRIMITIVE)).not.toContain('border-border');
  });
});

describe('every form refuses in Croatian, never in the browser’s language (B298)', () => {
  /**
   * `required`, `min`, `max` and `type="email"` without `noValidate` stop a
   * submit with a bubble in the browser's or the OS's language: the one class
   * of user-facing text every string sweep in this file walks past. So EVERY
   * form is `noValidate`, and the app's own preflight refuses — each in
   * Croatian, from `hr.json`, on the field it names. Found by walking the
   * source rather than listed, so a new form cannot escape the sweep.
   */
  const forms = readdirSync(srcRoot, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.tsx'))
    .map((file) => join(srcRoot, file))
    .filter((file) => /<form\b/.test(source(file)));

  /** Each `<form>` opening tag: one line, or many closed by a line holding `>` alone. */
  function formOpenings(text: string): string[] {
    return [...text.matchAll(/<form\b(?:[^>\n]*>|[\s\S]*?\n\s*>)/g)].map((found) => found[0]);
  }

  it('finds the forms, so the sweep is not vacuous', () => {
    expect(forms.length).toBeGreaterThanOrEqual(19);
    expect(formOpenings('<form\n  method="post"\n  onSubmit={(event) => {}}\n>')).toHaveLength(1);
    expect(formOpenings('<form\n  method="post"\n>')[0]).not.toMatch(/\bnoValidate\b/);
  });

  it.each(forms.map((file) => [file.slice(srcRoot.length + 1), file]))('%s: every <form> is noValidate', (_name, file) => {
    const openings = formOpenings(source(file ?? ''));

    expect(openings.length).toBeGreaterThan(0);
    for (const opening of openings) {
      expect(opening, 'a form left to the browser’s own validation bubbles').toMatch(/\bnoValidate\b/);
    }
  });

  it('caps no reason by maxLength: the code-point preflight is the one limit (C485)', () => {
    // `maxLength` counts UTF-16 units while the database counts code points,
    // so it contradicted the preflight on an emoji-heavy reason. The NAME
    // inputs keep theirs (`NAME_MAX_LENGTH`, 0036), beside their own
    // too-long refusals.
    const reasons = forms.flatMap((file) =>
      [...source(file).matchAll(/<Input\b[\s\S]*?\/>/g)]
        .map((found) => found[0])
        .filter((input) => input.includes('name="reason"')),
    );

    expect(reasons, 'the three reason inputs are not found').toHaveLength(3);
    for (const input of reasons) expect(input).not.toMatch(/\bmaxLength=/);
  });
});
