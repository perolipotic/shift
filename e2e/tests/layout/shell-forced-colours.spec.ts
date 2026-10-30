import type { Locator } from '@playwright/test';

import { hr } from '../../utils/i18n.ts';
import { ADMIN_STATE } from '../../utils/run-fixture.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

/**
 * Story 15.1: the glass shell under forced colours (Windows High Contrast).
 *
 * A forced-colours mode drops the glass's translucent fill, its inset hairline
 * and its shadow, so `glass-chrome` and `glass-over-content` each carry a
 * fallback in system colour keywords: `Canvas` behind, a `CanvasText` border
 * around, and no `backdrop-filter`. The current destination keeps its
 * underline, which is the non-colour half of its treatment. Measured on the
 * desktop sidebar and on the phone's tab bar, the pattern of the calendar's
 * forced-colours test (`calendar/layout.spec.ts`). Since story 15.2 the
 * *Više* sheet too: the docked Dialog's glass panel.
 */

/** What the panel and its current link compute, and what the two keywords resolve to. */
async function drawn(panel: Locator, current: Locator) {
  const link = await current.evaluate((element) => getComputedStyle(element).textDecorationLine);

  return panel.evaluate(
    (element, textDecoration) => {
      // The two keywords as this browser resolves them in this mode.
      const probe = document.createElement('div');
      probe.style.cssText = 'background-color: Canvas; border: 1px solid CanvasText; forced-color-adjust: none;';
      document.body.append(probe);
      const keywords = getComputedStyle(probe);
      const canvas = keywords.backgroundColor;
      const canvasText = keywords.borderTopColor;
      probe.remove();

      const style = getComputedStyle(element);

      return {
        background: style.backgroundColor,
        borderColors: [style.borderTopColor, style.borderRightColor, style.borderBottomColor, style.borderLeftColor],
        borderWidths: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth],
        backdrop: style.backdropFilter,
        canvas,
        canvasText,
        textDecoration,
      };
    },
    link,
  );
}

for (const layout of [
  { name: 'the desktop sidebar', viewport: { width: 1280, height: 800 }, phone: false },
  { name: 'the phone tab bar', viewport: { width: 390, height: 800 }, phone: true },
] as const) {
  test.describe(`${layout.name} under forced colours`, () => {
    test.use({ storageState: ADMIN_STATE, viewport: layout.viewport, isMobile: layout.phone, hasTouch: layout.phone });

    test('is Canvas with a CanvasText border and no blur, and the current link keeps its underline', async ({
      page,
      calendarPage,
    }) => {
      await calendarPage.goto();
      await expect(calendarPage.monthHeading()).toBeVisible();
      const current = calendarPage.navigationLink(hr.nav.kalendar, { exact: true });
      await expect(current).toHaveAttribute('aria-current', 'page');

      // The glass panel: the aside around the sidebar's landmark, or the
      // phone's pill, which is the landmark itself.
      const panel = layout.phone ? calendarPage.navigation : calendarPage.navigation.locator('xpath=ancestor::aside[1]');

      // Normally: glass, blurred, and the underline already there.
      await page.emulateMedia({ forcedColors: 'none' });
      const normal = await drawn(panel, current);
      expect(normal.backdrop, 'the shell is not glass to begin with').toMatch(/blur/);
      expect(normal.textDecoration).toContain('underline');

      await page.emulateMedia({ forcedColors: 'active' });
      const forced = await drawn(panel, current);

      expect(forced.background, 'the glass is not Canvas').toBe(forced.canvas);
      expect(forced.backdrop, 'the glass still blurs').toBe('none');
      for (const [index, colour] of forced.borderColors.entries()) {
        expect(colour, `border side ${String(index)} is not CanvasText`).toBe(forced.canvasText);
        expect(parseFloat(forced.borderWidths[index] ?? '0'), `border side ${String(index)} is not drawn`).toBeGreaterThanOrEqual(1);
      }
      expect(forced.textDecoration, 'the current link lost its underline').toContain('underline');
    });
  });
}

/**
 * Story 15.2: the layered panels are glass too, through the Dialog primitive's
 * `glass-panel`, with the same fallback. The phone's *Više* sheet is the
 * docked Dialog: blurred over a tinted, unblurred scrim normally, and `Canvas`
 * with a `CanvasText` border and no blur under forced colours.
 */
test.describe('the Više sheet under forced colours', () => {
  test.use({ storageState: ADMIN_STATE, viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true });

  test('is a glass panel over an unblurred scrim, and Canvas with a CanvasText border when forced', async ({
    page,
    calendarPage,
  }) => {
    await calendarPage.goto();
    await expect(calendarPage.monthHeading()).toBeVisible();
    await calendarPage.moreButton.click();
    const sheet = calendarPage.moreSheet;
    await expect(sheet).toBeVisible();

    const panel = () =>
      sheet.evaluate((element) => {
        const probe = document.createElement('div');
        probe.style.cssText = 'background-color: Canvas; border: 1px solid CanvasText; forced-color-adjust: none;';
        document.body.append(probe);
        const keywords = getComputedStyle(probe);
        const canvas = keywords.backgroundColor;
        const canvasText = keywords.borderTopColor;
        probe.remove();

        // The scrim token as this browser resolves it, to compare the
        // `::backdrop` with: Chromium's own default backdrop is tinted too.
        const token = document.createElement('div');
        token.style.cssText = 'background-color: var(--glass-scrim);';
        document.body.append(token);
        const glassScrim = getComputedStyle(token).backgroundColor;
        token.remove();

        const style = getComputedStyle(element);
        const scrim = getComputedStyle(element, '::backdrop');

        return {
          background: style.backgroundColor,
          borderColors: [style.borderTopColor, style.borderRightColor, style.borderBottomColor, style.borderLeftColor],
          borderWidths: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth],
          backdrop: style.backdropFilter,
          scrimBackdrop: scrim.backdropFilter,
          scrimBackground: scrim.backgroundColor,
          glassScrim,
          canvas,
          canvasText,
        };
      });

    await page.emulateMedia({ forcedColors: 'none' });
    const normal = await panel();
    expect(normal.backdrop, 'the sheet is not glass to begin with').toMatch(/blur/);
    expect(normal.scrimBackdrop, 'the scrim blurs').toBe('none');
    expect(normal.glassScrim, 'the scrim token does not resolve').not.toBe('rgba(0, 0, 0, 0)');
    expect(normal.scrimBackground, 'the backdrop is not the glass scrim').toBe(normal.glassScrim);

    await page.emulateMedia({ forcedColors: 'active' });
    const forced = await panel();

    expect(forced.background, 'the sheet is not Canvas').toBe(forced.canvas);
    expect(forced.backdrop, 'the sheet still blurs').toBe('none');
    for (const [index, colour] of forced.borderColors.entries()) {
      expect(colour, `border side ${String(index)} is not CanvasText`).toBe(forced.canvasText);
      expect(parseFloat(forced.borderWidths[index] ?? '0'), `border side ${String(index)} is not drawn`).toBeGreaterThanOrEqual(1);
    }
  });
});
