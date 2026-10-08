import { expect, type Locator, type Page } from '@playwright/test';

/** WCAG 2.5.5's target size, and the floor every control in this app keeps. */
export const MINIMUM_TARGET = 44;

/**
 * The roles a person presses or types into. Role locators rather than a CSS
 * query: `date` and `time` inputs and a `textarea` resolve to `textbox`, a file
 * input to `button`, a native select to `combobox`.
 */
const CONTROL_ROLES = [
  'button',
  'link',
  'textbox',
  'searchbox',
  'spinbutton',
  'combobox',
  'checkbox',
  'radio',
] as const;

interface Measured {
  readonly role: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly iconOnly: boolean;
}

/** How far the document is wider than the viewport; 0 or less is no sideways
 *  scroll. */
async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

/** No sideways page scroll: the document is never wider than the viewport.
 *  Polled, so a layout still settling after the ready element is not a
 *  failure, and a lasting overflow still is. */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  await expect
    .poll(() => horizontalOverflow(page), { message: 'the page scrolls sideways by this many px' })
    .toBeLessThanOrEqual(0);
}

/**
 * Every element in `main` that scrolls sideways: its own content wider than
 * its box, and an `overflow-x` that lets a person scroll it. A box that
 * clips (`hidden`, `clip` — a truncated name, the `sr-only` pattern) is not
 * a scroller.
 */
async function innerHorizontalScrollers(scope: Locator): Promise<string[]> {
  return scope.evaluateAll((mains) =>
    mains.flatMap((main) =>
      [main, ...main.querySelectorAll('*')]
        .filter((element) => {
          const overflow = getComputedStyle(element).overflowX;

          return (overflow === 'auto' || overflow === 'scroll') && element.scrollWidth > element.clientWidth + 1;
        })
        .map(
          (element) =>
            `${element.tagName.toLowerCase()}.${element.className.toString().split(' ').slice(0, 3).join('.')}: ${String(element.scrollWidth)} > ${String(element.clientWidth)}`,
        ),
    ),
  );
}

/**
 * Story 7.6: no element inside the screen scrolls sideways either — a table
 * that became stacked rows below 640 px, so a person never swipes inside a
 * box to find a number. `scope` narrows it to a region where the screen also
 * holds a grid or table that keeps its own scroller by decision (the
 * rotation's history, ledgered in `deferred-work.md`). Polled, like the page
 * check.
 */
export async function expectNoInnerHorizontalScroll(page: Page, scope?: Locator): Promise<void> {
  await expect
    .poll(() => innerHorizontalScrollers(scope ?? page.locator('main')), {
      message: 'an element in main scrolls sideways',
    })
    .toEqual([]);
}

async function measureControls(page: Page): Promise<Measured[]> {
  const measured: Measured[] = [];

  for (const role of CONTROL_ROLES) {
    const found = await page.getByRole(role).evaluateAll(
      (elements, currentRole) =>
        elements
          .filter((element) => element.checkVisibility({ visibilityProperty: true }))
          .map((element) => {
            const box = element.getBoundingClientRect();
            const isField =
              element instanceof HTMLInputElement ||
              element instanceof HTMLSelectElement ||
              element instanceof HTMLTextAreaElement ||
              (element instanceof HTMLElement && element.isContentEditable);

            // VISIBLE text, not `innerText`: an icon button whose words sit in
            // an `sr-only` span (the collapsed rail's pattern) is icon-only to
            // a finger, whatever it is to a screen reader. A text node counts
            // when its own parent is drawn at more than 1 × 1 px.
            let visibleText = '';
            const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
            for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
              const parent = node.parentElement;
              const text = node.textContent?.trim() ?? '';
              if (parent === null || text === '') continue;
              const parentBox = parent.getBoundingClientRect();
              if (parentBox.width > 1 && parentBox.height > 1) visibleText += text;
            }

            const labels =
              element instanceof HTMLInputElement ||
              element instanceof HTMLSelectElement ||
              element instanceof HTMLTextAreaElement
                ? element.labels
                : null;
            const label = labels?.[0]?.innerText.trim() ?? '';
            const ariaLabel = element.getAttribute('aria-label');

            return {
              role: currentRole,
              name: ariaLabel ?? (isField ? label : visibleText),
              width: box.width,
              height: box.height,
              // An `aria-label` with nothing drawn beside the glyph is exactly
              // the icon-only control whose width matters too.
              iconOnly: !isField && visibleText === '',
            };
          })
          // A control drawn at 1 × 1 px is the `sr-only` pattern — a visually
          // hidden input whose pointer target is a separate, measured button —
          // and is not a target at all.
          .filter((control) => control.width > 1 || control.height > 1),
      role,
    );
    measured.push(...found);
  }

  return measured;
}

function tooSmall(measured: readonly Measured[]): string[] {
  return measured
    .filter(
      (control) =>
        control.height < MINIMUM_TARGET - 0.5 ||
        (control.iconOnly && control.width < MINIMUM_TARGET - 0.5),
    )
    .map(
      (control) =>
        `${control.role} "${control.name}": ${control.width.toFixed(1)}×${control.height.toFixed(1)}`,
    );
}

/**
 * Every visible control is at least 44 px tall, and an icon-only control (no
 * visible text of its own) is at least 44 px wide as well. Polled, like the
 * scroll check, so the measurement is of the settled screen.
 */
export async function expectTouchTargets(page: Page): Promise<void> {
  await expect
    .poll(async () => (await measureControls(page)).length, {
      message: 'no controls were measured at all',
    })
    .toBeGreaterThan(0);

  await expect
    .poll(async () => tooSmall(await measureControls(page)), {
      message: 'controls below the 44 px target',
    })
    .toEqual([]);
}
