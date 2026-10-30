import { expect, test } from '../../utils/custom-fixtures.ts';

/**
 * Every digit is an Outfit tabular figure (story 15.1, D1, UX-DR40; story 7.2
 * before it), measured in a real browser: no unit test can tell whether a face
 * actually loaded or what width its glyphs render at.
 *
 * Outfit's default digits are proportional (`1` is 321 units, `0` is 659), so
 * without `tnum` a `1111` is about half the width of a `0000`. The document
 * sets `font-variant-numeric: tabular-nums` once on `html`, and under it all
 * ten digits share one advance (590 units) at every weight. Each probe is set
 * in the body slot (`<p>`) and the heading slot (`<h2>`) at every weight the
 * app draws (400–700; `font-extrabold` is mapped to 700); in every case the
 * two strings must render the same width. Every weight also shares the one
 * advance, so a column that mixes weights (a semibold date under a regular
 * one, a bold total) aligns: `1111` at 400 is as wide as `0000` at 700.
 *
 * The sign-in screen at bare `/prijava` is the surface because it needs no
 * session, and its own stylesheet is the app's, so the probes inherit exactly
 * what a screen does.
 */

const WEIGHTS = [400, 500, 600, 700] as const;
const TAGS = ['p', 'h2'] as const;

test('a run of ones is exactly as wide as a run of zeros, in both slots and at every weight', async ({ page, loginPage }) => {
  await loginPage.goto();
  await expect(loginPage.organizationInput).toBeVisible();

  const widths = await page.evaluate(
    async ({ tags, weights }) => {
      const probes: { key: string; ones: HTMLElement; zeros: HTMLElement }[] = [];

      for (const tag of tags) {
        for (const weight of weights) {
          const make = (text: string): HTMLElement => {
            const element = document.createElement(tag);
            element.textContent = text;
            Object.assign(element.style, {
              display: 'inline-block',
              margin: '0',
              whiteSpace: 'nowrap',
              fontSize: '32px',
              fontWeight: String(weight),
              letterSpacing: '0',
            });
            document.body.append(element);

            return element;
          };

          probes.push({ key: `${tag}@${weight}`, ones: make('1111'), zeros: make('0000') });
        }
      }

      // Lay the probes out so the digit faces are requested, then wait for them.
      void document.body.offsetWidth;
      await document.fonts.ready;

      return probes.map(({ key, ones, zeros }) => ({
        key,
        ones: ones.getBoundingClientRect().width,
        zeros: zeros.getBoundingClientRect().width,
      }));
    },
    { tags: TAGS, weights: WEIGHTS },
  );

  expect(widths).toHaveLength(TAGS.length * WEIGHTS.length);
  const width = (key: string, string: 'ones' | 'zeros'): number => widths.find((probe) => probe.key === key)?.[string] ?? 0;
  for (const tag of TAGS) {
    const light = width(`${tag}@400`, 'ones');
    const heavy = width(`${tag}@700`, 'zeros');

    expect(Math.abs(light - heavy), `${tag}: 1111 at 400 is ${light}px, 0000 at 700 is ${heavy}px`).toBeLessThanOrEqual(
      0.5,
    );
  }

  for (const { key, ones, zeros } of widths) {
    expect(ones, `${key}: 1111 is ${ones}px, 0000 is ${zeros}px`).toBeGreaterThan(0);
    expect(Math.abs(ones - zeros), `${key}: 1111 is ${ones}px, 0000 is ${zeros}px`).toBeLessThanOrEqual(0.5);
  }

  const faces = await page.evaluate(() => ({
    check: document.fonts.check('16px "Outfit Variable"'),
    loaded: [...document.fonts]
      .filter((face) => face.family.replace(/["']/g, '') === 'Outfit Variable' && face.status === 'loaded')
      .map((face) => face.weight),
  }));

  expect(faces.check).toBe(true);
  // The widths could match by accident in some other tabular face; Outfit's
  // variable file (one face for the whole weight axis) was actually fetched.
  expect(faces.loaded, 'no Outfit face loaded').not.toEqual([]);
});

test('the digits are tabular only because the document asks for it', async ({ page, loginPage }) => {
  // NON-VACUITY for the test above: with `tnum` switched off, Outfit's own
  // digits are proportional and the two runs differ, so equal widths above
  // are the document's `tabular-nums`, not a face that happens to be monospaced.
  await loginPage.goto();
  await expect(loginPage.organizationInput).toBeVisible();

  const widths = await page.evaluate(async () => {
    const make = (text: string): HTMLElement => {
      const element = document.createElement('p');
      element.textContent = text;
      Object.assign(element.style, {
        display: 'inline-block',
        margin: '0',
        whiteSpace: 'nowrap',
        fontSize: '32px',
        fontVariantNumeric: 'proportional-nums',
      });
      document.body.append(element);

      return element;
    };
    const ones = make('1111');
    const zeros = make('0000');

    void document.body.offsetWidth;
    await document.fonts.ready;

    const measured = {
      ones: ones.getBoundingClientRect().width,
      zeros: zeros.getBoundingClientRect().width,
      root: getComputedStyle(document.documentElement).fontVariantNumeric,
    };
    // The probes leave the page as they found it.
    ones.remove();
    zeros.remove();

    return measured;
  });

  expect(widths.root).toBe('tabular-nums');
  expect(widths.zeros - widths.ones, 'proportional Outfit digits measured the same width').toBeGreaterThan(10);
});

test('digits change neither the line box nor the face of the words around them', async ({ page, loginPage }) => {
  await loginPage.goto();
  await expect(loginPage.organizationInput).toBeVisible();

  const measured = await page.evaluate(async () => {
    const make = (tag: string, text: string, family?: string): HTMLElement => {
      const element = document.createElement(tag);
      element.textContent = text;
      Object.assign(element.style, { display: 'inline-block', margin: '0', whiteSpace: 'nowrap', fontSize: '32px' });
      if (family !== undefined) element.style.fontFamily = family;
      document.body.append(element);

      return element;
    };

    const pWords = make('p', 'Smjena');
    const pMixed = make('p', 'Smjena 17');
    const hWords = make('h2', 'Listopad');
    const hMixed = make('h2', 'Listopad 2026');
    // The same word forced into Outfit alone: the heading's word must match it.
    const outfitOnly = make('h2', 'Listopad', "'Outfit Variable'");

    void document.body.offsetWidth;
    await document.fonts.ready;

    const height = (element: HTMLElement): number => element.getBoundingClientRect().height;

    return {
      p: [height(pWords), height(pMixed)],
      h2: [height(hWords), height(hMixed)],
      word: [hWords.getBoundingClientRect().width, outfitOnly.getBoundingClientRect().width],
    };
  });

  // One face draws words and digits alike (story 15.1), so a digit changes
  // no line box, and a heading's words are Outfit, not a fallback.
  expect(measured.p[1], 'body line height').toBeCloseTo(measured.p[0] ?? 0, 1);
  expect(measured.h2[1], 'heading line height').toBeCloseTo(measured.h2[0] ?? 0, 1);
  expect(measured.word[0], 'heading word is Outfit').toBeCloseTo(measured.word[1] ?? 0, 1);
});
