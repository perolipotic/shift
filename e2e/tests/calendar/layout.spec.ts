import { randomUUID } from 'node:crypto';

import type { Locator, Page, Route } from '@playwright/test';

import type { CalendarPage } from '../../pages/calendar.page.ts';
import { ADMIN_STATE, MEMBER_STATE, type Fixture } from '../../utils/run-fixture.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

/**
 * Package 3c: the calendar's layout where no unit test can see it.
 *
 * - The team header is STICKY at the top of the grid's own scroller, so a
 *   28–31-row month scrolled to its end still names its teams — on a phone and
 *   on a short window. The corner, header and date column stack in order, are
 *   opaque, and never paint over the phone's bottom bar.
 * - A focused cell lands CLEAR of the sticky date column, the sticky header
 *   and the phone's bottom bar — from the keys, from Tab and from the day
 *   detail's close — in a grid wide enough to scroll sideways, and the
 *   margins that do it are at least the sizes they clear.
 * - While the read is pending, the skeleton and the mode switch follow the
 *   chrome's role answer the moment it is in the cache.
 * - Under forced colours every modifier treatment, the focused cell and the
 *   sticky header keep a visible outline or border, where the box-shadows and
 *   gradients they normally draw are dropped.
 */

/** Whether a request is the calendar's one read, not the chrome's branding read of the same table. */
function isCalendarRead(route: Route): boolean {
  const url = decodeURIComponent(route.request().url());

  return url.includes('/rest/v1/organizations') && url.includes('rotation_steps(');
}

/**
 * Widens the grid: `count` extra active teams, with no rotation, appended to
 * the calendar's answer in the browser alone, so the grid scrolls sideways
 * without writing a team other tests would see. Each is built from the team
 * columns alone — nothing copied from a real row — and named `Širina 01`…,
 * which sorts after every `S…` name under the Croatian collation, so the real
 * teams keep the first columns and the order is fixed.
 */
async function widenWithTeams(page: Page, count: number): Promise<void> {
  await page.route('**/rest/v1/organizations*', async (route) => {
    if (!isCalendarRead(route)) return route.fallback();

    const response = await route.fetch();
    const body = (await response.json()) as Record<string, unknown>[];

    for (const organization of body) {
      const teams = organization['teams'] as Record<string, unknown>[];
      for (let index = 0; index < count; index += 1) {
        teams.push({
          organization_id: organization['id'],
          id: randomUUID(),
          name: `Širina ${String(index + 1).padStart(2, '0')}`,
          archived: false,
        });
      }
    }

    await route.fulfill({ response, json: body });
  });
}

/** The grid's scroller: the table primitive's own wrapper. */
function scrollerOf(grid: Locator): Locator {
  return grid.locator('xpath=..');
}

/** How far the focused cell sits clear of each edge it must not pass; negative is hidden. */
interface Clearance {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  /** Above the phone's bottom bar, in the viewport; `Infinity` where there is no bar. */
  readonly bar: number;
}

/**
 * The focused cell's clearance: past the sticky date column on the left, below
 * a sticky TEAM header cell on top, inside the scroller's client edges (its
 * scrollbars excluded) on the right and bottom, and above the phone's bottom
 * bar in the viewport.
 */
async function focusedClearance(page: Page): Promise<Clearance> {
  return page.evaluate(() => {
    const cell = document.activeElement;
    if (!(cell instanceof HTMLTableCellElement) || cell.getAttribute('role') !== 'gridcell') {
      throw new Error('E2E: focus is not on a gridcell');
    }
    const table = cell.closest('table');
    const scroller = table?.parentElement ?? null;
    const dateColumn = cell.parentElement?.querySelector('th') ?? null;
    // A team header CELL, which is what sticks; the `thead` box itself scrolls away.
    const header = table?.tHead?.querySelector('th:nth-child(2)') ?? null;
    if (table === null || header === null || scroller === null || dateColumn === null) {
      throw new Error('E2E: the grid has no scroller, header or date column');
    }
    const bar = [...document.querySelectorAll('nav')]
      .map((nav) => nav.parentElement)
      .find(
        (parent): parent is HTMLElement =>
          parent !== null && getComputedStyle(parent).position === 'sticky' && parent.checkVisibility(),
      );
    const box = scroller.getBoundingClientRect();
    const left = box.left + scroller.clientLeft;
    const top = box.top + scroller.clientTop;
    const drawn = cell.getBoundingClientRect();

    return {
      left: drawn.left - dateColumn.getBoundingClientRect().right,
      top: drawn.top - header.getBoundingClientRect().bottom,
      right: left + scroller.clientWidth - drawn.right,
      bottom: top + scroller.clientHeight - drawn.bottom,
      bar: bar === undefined ? Infinity : bar.getBoundingClientRect().top - drawn.bottom,
    };
  });
}

/** Fails naming the edge the focused cell is hidden past. */
async function expectClear(page: Page, step: string): Promise<void> {
  const clearance = await focusedClearance(page);
  for (const [edge, value] of Object.entries(clearance)) {
    expect(value, `${step}: the focused cell is hidden past its ${edge} edge`).toBeGreaterThanOrEqual(-ROUNDING);
  }
}

/** Sub-pixel layout rounding, and nothing more. */
const ROUNDING = 1;

for (const [width, height, name] of [
  [390, 844, 'on a phone'],
  [1280, 600, 'on a short window'],
] as const) {
  test.describe(`the team header ${name}`, () => {
    test.use({ storageState: ADMIN_STATE, viewport: { width, height } });

    test('stays in view when the month is scrolled to its end', async ({ calendarPage, fixture }) => {
      await calendarPage.goto('?prikaz=sve');
      const header = calendarPage.columnHeader(fixture.team.name);
      await expect(header).toBeAttached();
      const scroller = scrollerOf(calendarPage.grid);

      // The month is taller than its scroller, so there is somewhere to scroll.
      const room = await scroller.evaluate((element) => element.scrollHeight - element.clientHeight);
      expect(room, 'the grid does not scroll inside its own container').toBeGreaterThan(0);

      await scroller.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

      const frame = await scroller.boundingBox();
      const named = await header.boundingBox();
      expect(frame).not.toBeNull();
      expect(named, 'the team header has no box').not.toBeNull();
      expect(named!.y, 'the team header scrolled up out of its container').toBeGreaterThanOrEqual(frame!.y - ROUNDING);
      expect(named!.y + named!.height, 'the team header sits below its container').toBeLessThanOrEqual(
        frame!.y + frame!.height + ROUNDING,
      );
      // And it is the top of the container, not merely somewhere inside it.
      expect(named!.y - frame!.y).toBeLessThanOrEqual(ROUNDING);
    });
  });
}

/** The grid, widened past a phone's width, and its scroller. */
async function wideGrid(page: Page, calendarPage: CalendarPage, fixture: Fixture): Promise<Locator> {
  await widenWithTeams(page, 12);
  await calendarPage.goto('?prikaz=sve');
  await expect(calendarPage.columnHeader(fixture.team.name)).toBeAttached();
  const scroller = scrollerOf(calendarPage.grid);
  const overflow = await scroller.evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(overflow, 'the grid does not scroll sideways').toBeGreaterThan(0);

  return scroller;
}

/** Scrolls the scroller so column 0 sits partly under the sticky date column. */
async function coverFirstColumn(scroller: Locator): Promise<void> {
  await scroller.evaluate((element) => {
    element.scrollLeft = 20;
  });
}

test.describe('a focused cell in a grid that scrolls sideways, on a phone', () => {
  test.use({ storageState: ADMIN_STATE, viewport: { width: 390, height: 844 } });

  test('from the keys, lands clear of the date column, the header and the bottom bar', async ({
    page,
    calendarPage,
    fixture,
  }) => {
    const scroller = await wideGrid(page, calendarPage, fixture);
    const rows = await calendarPage.rowCount();
    const columns = await calendarPage.columnCount();
    expect(columns).toBeGreaterThan(12);

    // Across to the far end, then back one column at a time: each step left
    // brings a cell out from under the sticky date column.
    // The LEAST scroll: a step to a cell already in view, away from every
    // edge, does not move the grid.
    await calendarPage.cellAt({ row: 4, column: 1 }).focus();
    const scrolled = () => scroller.evaluate((element) => [element.scrollLeft, element.scrollTop]);
    const before = await scrolled();
    await page.keyboard.press('ArrowDown');
    expect(await calendarPage.focusedCell()).toEqual({ row: 5, column: 1 });
    expect(await scrolled(), 'a step to a cell in view scrolled the grid').toEqual(before);
    await page.keyboard.press('Control+Home');
    expect(await calendarPage.focusedCell()).toEqual({ row: 0, column: 0 });
    await page.keyboard.press('End');
    await expectClear(page, 'End');
    expect(await scroller.evaluate((element) => element.scrollLeft), 'End did not scroll sideways').toBeGreaterThan(0);
    for (let column = columns - 2; column >= 0; column -= 1) {
      await page.keyboard.press('ArrowLeft');
      expect(await calendarPage.focusedCell()).toEqual({ row: 0, column });
      await expectClear(page, `ArrowLeft to column ${String(column)}`);
    }

    // Down one row at a time to the month's end — each step down brings a cell
    // out from under the bottom bar — then back up, each step up bringing one
    // out from under the sticky header.
    for (let row = 1; row < rows; row += 1) {
      await page.keyboard.press('ArrowDown');
      expect(await calendarPage.focusedCell()).toEqual({ row, column: 0 });
      await expectClear(page, `ArrowDown to row ${String(row)}`);
    }
    for (let row = rows - 2; row >= 0; row -= 1) {
      await page.keyboard.press('ArrowUp');
      expect(await calendarPage.focusedCell()).toEqual({ row, column: 0 });
      await expectClear(page, `ArrowUp to row ${String(row)}`);
    }
  });

  test('from Tab and from the day detail closing, lands clear too', async ({ page, calendarPage, fixture }) => {
    const scroller = await wideGrid(page, calendarPage, fixture);

    // Tab into the grid on its one tab stop, while that cell is partly under
    // the sticky date column.
    await coverFirstColumn(scroller);
    await calendarPage.teamFilter.focus();
    await page.keyboard.press('Tab');
    await expect(calendarPage.tabStops).toBeFocused();
    await expectClear(page, 'Tab');

    // Open its detail, cover the cell while the Dialog is open, and close it:
    // focus comes back to the cell, whole.
    await page.keyboard.press('Enter');
    await expect(calendarPage.dialog()).toBeVisible();
    await coverFirstColumn(scroller);
    await page.keyboard.press('Escape');
    await expect(calendarPage.dialog()).toHaveCount(0);
    await expect(calendarPage.tabStops).toBeFocused();
    await expectClear(page, 'the day detail closing');
  });

  test('is revealed inside margins at least the sizes they clear', async ({ page, calendarPage, fixture }) => {
    await wideGrid(page, calendarPage, fixture);

    const sizes = await calendarPage.grid.evaluate((table: HTMLTableElement) => {
      const cell = table.querySelector('[role="gridcell"]');
      if (cell === null || table.tHead === null) throw new Error('E2E: no cell or header');
      const style = getComputedStyle(cell);
      const widths = [...table.querySelectorAll('tr > th:first-child')].map((th) => th.getBoundingClientRect().width);
      const heights = [...table.tHead.querySelectorAll('th')].map((th) => th.getBoundingClientRect().height);

      return {
        marginLeft: parseFloat(style.scrollMarginLeft),
        marginTop: parseFloat(style.scrollMarginTop),
        width: Math.max(...widths),
        height: Math.max(...heights),
      };
    });
    expect(sizes.width, 'the date column is wider than the cells’ scroll-margin-left').toBeLessThanOrEqual(
      sizes.marginLeft + ROUNDING,
    );
    expect(sizes.height, 'the header is taller than the cells’ scroll-margin-top').toBeLessThanOrEqual(
      sizes.marginTop + ROUNDING,
    );
  });
});

test.describe('the sticky layers on a phone', () => {
  test.use({ storageState: ADMIN_STATE, viewport: { width: 390, height: 844 } });

  test('stack corner, header, date column, cells; are opaque; and stay under the bottom bar', async ({
    page,
    calendarPage,
    fixture,
  }) => {
    const scroller = await wideGrid(page, calendarPage, fixture);
    await scroller.evaluate((element) => {
      element.scrollLeft = 150;
      element.scrollTop = 300;
    });

    const stack = await calendarPage.grid.evaluate((table: HTMLTableElement) => {
      const wrapper = table.parentElement;
      const head = table.tHead?.rows[0];
      if (wrapper === null || head === undefined) throw new Error('E2E: no scroller or header row');
      const frame = wrapper.getBoundingClientRect();
      const corner = head.cells[0];
      // A team header wholly in view past the corner, and a date wholly in view below the header.
      const header = [...head.cells].slice(1).find((th) => {
        const box = th.getBoundingClientRect();

        return box.left >= frame.left + 120 && box.right <= frame.right;
      });
      const date = [...(table.tBodies[0]?.rows ?? [])]
        .map((row) => row.cells[0])
        .find((th) => {
          const box = th?.getBoundingClientRect();

          return box !== undefined && box.top >= frame.top + 60 && box.bottom <= frame.bottom;
        });
      if (corner === undefined || header === undefined || date === undefined) {
        throw new Error('E2E: nothing in view to probe');
      }
      const topmost = (element: Element): boolean => {
        const box = element.getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);

        return hit !== null && (hit === element || element.contains(hit));
      };
      const opaque = (element: Element): boolean => {
        const colour = getComputedStyle(element).backgroundColor;
        const alpha = /\/\s*([\d.]+)\)$/.exec(colour)?.[1] ?? /rgba\([^)]*,\s*([\d.]+)\)$/.exec(colour)?.[1] ?? '1';

        return Number(alpha) === 1;
      };
      const cornerBox = corner.getBoundingClientRect();

      return {
        cornerLeft: cornerBox.left - (frame.left + wrapper.clientLeft),
        cornerTop: cornerBox.top - (frame.top + wrapper.clientTop),
        corner: topmost(corner),
        header: topmost(header),
        date: topmost(date),
        cornerOpaque: opaque(corner),
        headerOpaque: opaque(header),
        dateOpaque: opaque(date),
      };
    });
    expect(Math.abs(stack.cornerLeft), 'the corner left the scroller’s left edge').toBeLessThanOrEqual(ROUNDING);
    expect(Math.abs(stack.cornerTop), 'the corner left the scroller’s top edge').toBeLessThanOrEqual(ROUNDING);
    // Under the corner: a scrolled date and a scrolled team header.
    expect(stack.corner, 'something paints over the corner').toBe(true);
    // Under a team header: scrolled cells.
    expect(stack.header, 'a cell paints over the team header').toBe(true);
    // Under a date: scrolled cells.
    expect(stack.date, 'a cell paints over the date column').toBe(true);
    expect(stack.cornerOpaque, 'the corner shows what scrolls under it').toBe(true);
    expect(stack.headerOpaque, 'the team header shows what scrolls under it').toBe(true);
    expect(stack.dateOpaque, 'the date column shows what scrolls under it').toBe(true);

    // The page scrolled so the grid runs under the bottom bar: the bar, not a
    // sticky cell, is what every point across it hits.
    const covered = await page.evaluate(() => {
      const bar = [...document.querySelectorAll('nav')]
        .map((nav) => nav.parentElement)
        .find(
          (parent): parent is HTMLElement =>
            parent !== null && getComputedStyle(parent).position === 'sticky' && parent.checkVisibility(),
        );
      const wrapper = document.querySelector('table[role="grid"]')?.parentElement;
      if (bar === undefined || wrapper === null || wrapper === undefined) throw new Error('E2E: no bar or grid');
      const barBox = bar.getBoundingClientRect();
      // Bring the scroller's lower half under the bar.
      window.scrollBy(0, wrapper.getBoundingClientRect().bottom - barBox.bottom - 150);
      const frame = wrapper.getBoundingClientRect();
      const box = bar.getBoundingClientRect();
      const y = box.top + box.height / 2;
      const misses: number[] = [];
      for (let x = 2; x < box.right; x += 8) {
        const hit = document.elementFromPoint(x, y);
        if (hit === null || !bar.contains(hit)) misses.push(x);
      }

      return { under: frame.top < box.top && frame.bottom > box.bottom, misses };
    });
    expect(covered.under, 'the grid does not run under the bar').toBe(true);
    expect(covered.misses, 'the grid paints over the bottom bar at these x').toEqual([]);
  });
});

/** Whether a request is the chrome's own role read (`MEMBER_ROLE_KEY`). */
function isRoleRead(route: Route): boolean {
  const url = new URL(route.request().url());

  return url.pathname.endsWith('/rest/v1/members') && url.searchParams.get('select') === 'role';
}

/** A route handler held until `release` is called. */
function held(): { readonly wait: Promise<void>; readonly release: () => void } {
  let release: () => void = () => undefined;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });

  return { wait, release };
}

test.describe('the calendar while its read is pending, on a phone, as a member', () => {
  test.use({ storageState: MEMBER_STATE, viewport: { width: 390, height: 844 } });

  test('follows the chrome’s role the moment it is cached: grid, then the day list and the switch', async ({
    page,
    calendarPage,
  }) => {
    const role = held();
    const calendar = held();
    await page.route('**/rest/v1/members*', async (route) => {
      if (isRoleRead(route)) await role.wait;
      await route.fallback();
    });
    await page.route('**/rest/v1/organizations*', async (route) => {
      if (isCalendarRead(route)) await calendar.wait;
      await route.fallback();
    });

    await calendarPage.goto();
    // The month's placeholder bars, not the month heading's.
    const pulses = page.getByRole('main').locator('.animate-pulse[class~="h-[30px]"]');
    const { moj, sve } = calendarPage.modes();

    // No role yet: the grid's thirty rows of five (a date and four team
    // columns), and no switch, since the mode is unknown.
    await expect(pulses).toHaveCount(30 * 5);
    await expect(moj).toHaveCount(0);

    // The role lands in the cache: the day list's thirty rows of two, and the
    // switch on *Moj raspored* — before the calendar's read has answered.
    role.release();
    await expect(pulses).toHaveCount(30 * 2);
    await expect(moj).toHaveAttribute('aria-pressed', 'true');
    await expect(sve).toHaveAttribute('aria-pressed', 'false');
    await expect(calendarPage.anyGrid).toHaveCount(0);

    calendar.release();
    await expect(calendarPage.dayList).toBeVisible();
    await expect(pulses).toHaveCount(0);
    await expect(moj).toHaveAttribute('aria-pressed', 'true');
  });
});

/** The six modifier treatments, as `modifiers.ts` names them. */
const TREATMENTS = [
  { name: 'modifier-ring-conflict', kind: 'ring' },
  { name: 'modifier-ring-overridden', kind: 'ring' },
  { name: 'modifier-ring-conflict-overridden', kind: 'ring' },
  { name: 'modifier-hatch-leave', kind: 'hatch' },
  { name: 'modifier-hatch-uncovered', kind: 'hatch' },
  { name: 'modifier-hatch-leave-uncovered', kind: 'hatch' },
] as const;

/** The grid cell box's padding (`CALENDAR_CELL_CLASS`), which a ring's inset outline must stay inside. */
const CELL_PADDING = 'px-2 py-1';

interface Drawn {
  readonly name: string;
  readonly boxShadow: string;
  readonly backgroundImage: string;
  /** `style width`; `none …` is no outline. */
  readonly outline: string;
  /** `width top-style left-style`; `0px …` is no border. */
  readonly border: string;
  /** How deep the outline reaches into the box, and the box's thinnest padding. */
  readonly outlineDepth: number;
  readonly outlineWidth: number;
  readonly padding: number;
}

/** Each treatment's computed drawing, on a probe carrying its class and the cell's padding. */
async function drawnTreatments(page: Page): Promise<Drawn[]> {
  return page.evaluate(
    ({ names, padding }) =>
      names.map((name) => {
        const probe = document.createElement('div');
        probe.className = `${padding} ${name}`;
        document.body.append(probe);
        const style = getComputedStyle(probe);
        const drawn = {
          name,
          boxShadow: style.boxShadow,
          backgroundImage: style.backgroundImage,
          outline: `${style.outlineStyle} ${style.outlineWidth}`,
          border: `${style.borderTopWidth} ${style.borderTopStyle} ${style.borderLeftStyle}`,
          outlineDepth: -parseFloat(style.outlineOffset),
          outlineWidth: parseFloat(style.outlineWidth),
          padding: Math.min(parseFloat(style.paddingTop), parseFloat(style.paddingLeft)),
        };
        probe.remove();

        return drawn;
      }),
    { names: TREATMENTS.map((treatment) => treatment.name), padding: CELL_PADDING },
  );
}

test.describe('the calendar under forced colours', () => {
  test.use({ storageState: ADMIN_STATE, viewport: { width: 1280, height: 800 } });

  test('keeps an outline or a border where the shadows and hatches are dropped', async ({ page, calendarPage }) => {
    await calendarPage.goto();
    await expect(calendarPage.monthHeading()).toBeVisible();

    // Normally: the shadow or the hatch, and no outline or border of their own.
    await page.emulateMedia({ forcedColors: 'none' });
    for (const [index, drawn] of (await drawnTreatments(page)).entries()) {
      const kind = TREATMENTS[index]?.kind;
      if (kind === 'ring') expect(drawn.boxShadow, drawn.name).not.toBe('none');
      else expect(drawn.backgroundImage, drawn.name).not.toBe('none');
      expect(drawn.outline, drawn.name).toMatch(/^none /);
      expect(drawn.border, drawn.name).toMatch(/^0px /);
    }

    // Forced: the browser drops both, and each keeps its own fallback.
    await page.emulateMedia({ forcedColors: 'active' });
    const forced = await drawnTreatments(page);
    for (const [index, drawn] of forced.entries()) {
      const kind = TREATMENTS[index]?.kind;
      if (kind === 'ring') {
        expect(drawn.outline, `${drawn.name} has no outline`).not.toMatch(/^none /);
        // Inset, and no deeper than the cell's padding, so it never covers the label.
        expect(drawn.outlineWidth, `${drawn.name} reaches past its inset`).toBeLessThanOrEqual(drawn.outlineDepth);
        expect(drawn.outlineDepth, `${drawn.name} covers the label`).toBeLessThanOrEqual(drawn.padding);
      } else {
        expect(drawn.border, `${drawn.name} has no border`).toMatch(/^[1-9]\d*px (dotted|dashed) /);
      }
    }
    // Still told apart from each other.
    const rings = forced.filter((_, index) => TREATMENTS[index]?.kind === 'ring').map((drawn) => drawn.outline);
    const hatches = forced.filter((_, index) => TREATMENTS[index]?.kind === 'hatch').map((drawn) => drawn.border);
    expect(new Set(rings).size).toBe(rings.length);
    expect(new Set(hatches).size).toBe(hatches.length);
  });

  test('shows the focused cell and the sticky header’s edge', async ({ page, calendarPage }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await calendarPage.goto('?prikaz=sve');
    await expect(calendarPage.grid).toBeVisible();

    await calendarPage.teamFilter.focus();
    await page.keyboard.press('Tab');
    await expect(calendarPage.tabStops).toBeFocused();
    const outline = await calendarPage.tabStops.evaluate((cell) => {
      const style = getComputedStyle(cell);

      return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
    });
    expect(outline.style, 'the focused cell shows no focus under forced colours').not.toBe('none');
    expect(outline.width).toBeGreaterThan(0);

    const edges = await calendarPage.headerCells.evaluateAll((cells) =>
      cells.map((cell) => {
        const style = getComputedStyle(cell);

        return `${style.borderBottomStyle} ${style.borderBottomWidth}`;
      }),
    );
    for (const edge of edges) expect(edge, 'a sticky header cell has no edge under forced colours').toMatch(/^solid [1-9]/);
  });
});
