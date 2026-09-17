import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import {
  compareText,
  formatDate,
  formatDayMonthRange,
  formatMonthName,
  formatNumber,
  formatTime,
  formatTimeRange,
  formatWeekdayName,
  isRenderableTimeZone,
  RANGE_DASH,
} from '@/i18n/format';
import { i18n, initLocalization, missingKeyPlaceholder, t } from '@/i18n';

/**
 * The localization layer's binding output, and the guard that no other file
 * formats anything (story 1.1c, L5-L8 and UX-DR34/35).
 *
 * Two kinds of assertion, catching two different failures.
 *
 *   - VALUES. Every row of the spec's I/O matrix, because CLDR `hr` disagrees
 *     with three of the binding formats and "just use `Intl`" therefore
 *     produces the wrong string: `12. 09. 2026.` for the date, a U+2009-padded
 *     dash for a range. The plural rows carry 21 and 101 specifically —
 *     Croatian's `one` is `n % 10 === 1 && n % 100 !== 11`, so a `count === 1`
 *     implementation passes at 1, 2 and 5 and only fails at 21.
 *   - THE SOURCE SCAN. This is what catches the L8 defect class, and the value
 *     assertions above cannot: `Intl.DateTimeFormat` with no `timeZone`
 *     silently resolves to the system zone, and the development machine's
 *     system zone IS `Europe/Zagreb` — so every expectation below would still
 *     pass while the shipped application rendered a travelling member's device
 *     time. The scan reads the files instead of the output.
 *
 * The foreign-zone case is proved in a child process rather than in-process,
 * for the same reason: this module memoizes its formatters, so a formatter
 * built from the ambient zone before a mid-test `process.env.TZ` mutation would
 * be immune to that mutation and the leak would pass. A fresh process under
 * `TZ=Pacific/Kiritimati` has no such hole.
 */

/** `apps/web/src` — where the module under test lives. */
const srcRoot = fileURLToPath(new URL('../', import.meta.url));

/**
 * `apps/web` — the scan root, one level ABOVE `src`.
 *
 * The invariant is "the only `Intl` construction site in `apps/web`", and
 * rooting at `src` left `vite.config.ts` and `vitest.config.ts` unscanned
 * though both are `apps/web` TypeScript that ships or shapes the build.
 */
const webRoot = fileURLToPath(new URL('../../', import.meta.url));

/** Croatia is on CEST (UTC+2) on every date used below, so a UTC instant of
 *  `HH:00` renders as `HH+2:00` in the organization's zone. */
const ZONE = 'Europe/Zagreb';

/** UTC+14, and no daylight saving — the furthest zone from Zagreb there is, so
 *  a leak of the device zone changes both the date and the hour. */
const FOREIGN_ZONE = 'Pacific/Kiritimati';

const at = (iso: string): Date => new Date(iso);

/**
 * The needles are assembled at runtime, so this file does not appear in its own
 * scan as a violation of the rule it enforces (the idiom in
 * `packages/domain/test/purity.test.ts`).
 */
const INTL = `In${'tl'}`;
const NEW_DATE_TIME_FORMAT = `new ${INTL}.DateTime${'Format'}`;

const to = (suffix: string): string => `to${suffix}`;
const get = (suffix: string): string => `get${suffix}`;

/**
 * Method calls that produce or assemble a date/time string outside this layer.
 *
 * Three families, and the last two were the gap. `toLocale*` is the obvious
 * one. `toISOString`/`toDateString`/`toTimeString`/`toUTCString` format without
 * any locale at all — still a formatted date reaching a user, still L6. And the
 * `getDate`/`getMonth`/`getFullYear` family is the shape the spec's "Never"
 * names explicitly — "template-assembled date outside the module" — which is
 * also an L8 leak, because `getHours()` reads the DEVICE's clock and no
 * `timeZone` argument exists to forget.
 *
 * Matched as `.name(` — a call, not a substring — so `toLocaleLowerCase` (which
 * `format.ts` legitimately uses) and an identifier that merely contains one of
 * these words are not false positives. `.toLocaleDateString(` does not match
 * `to('DateString')` either, because the `\.` is anchored immediately before
 * the name.
 */
const FORBIDDEN_CALLS = [
  to(`Locale${'String'}`),
  to(`Locale${'DateString'}`),
  to(`Locale${'TimeString'}`),
  to('ISOString'),
  to('DateString'),
  to('TimeString'),
  to('UTCString'),
  get('Date'),
  get('Month'),
  get('FullYear'),
  get('Hours'),
  get('Minutes'),
  get('Day'),
];

/**
 * `Intl` members that are TYPES, not values.
 *
 * A surface annotating `Intl.DateTimeFormatOptions` constructs nothing and is
 * not a violation, so a plain `Intl.` substring test was over-broad. Every
 * other member access is a value use — including `const F = Intl.DateTimeFormat`
 * with no call, which a `new`-anchored test would also have missed.
 */
const INTL_TYPE_MEMBERS = [
  'DateTimeFormatOptions',
  'DateTimeFormatPart',
  'DateTimeFormatPartTypes',
  'DateTimeRangeFormatPart',
  'NumberFormatOptions',
  'NumberFormatPart',
  'ResolvedDateTimeFormatOptions',
  'ResolvedNumberFormatOptions',
  'LocalesArgument',
  'PluralRulesOptions',
];

/**
 * Every value-level reach for `Intl` in one source, named.
 *
 * Three shapes, because a substring test on `Intl.` caught only the first:
 * member access, computed access (`Intl['DateTimeFormat']`), and aliasing the
 * namespace itself (`const { DateTimeFormat } = Intl`).
 */
function intlValueUses(source: string): string[] {
  const found: string[] = [];

  for (const match of source.matchAll(new RegExp(`\\b${INTL}\\s*\\.\\s*([A-Za-z_$][\\w$]*)`, 'g'))) {
    const member = match[1] ?? '';
    if (!INTL_TYPE_MEMBERS.includes(member)) found.push(`${INTL}.${member}`);
  }
  for (const _ of source.matchAll(new RegExp(`\\b${INTL}\\s*\\[`, 'g'))) found.push(`${INTL}[computed]`);
  for (const _ of source.matchAll(new RegExp(`=\\s*${INTL}\\b(?!\\s*\\.)`, 'g'))) found.push(`alias of ${INTL}`);

  return found;
}

/** Calls from {@link FORBIDDEN_CALLS} present in one source, named. */
function forbiddenCallsIn(source: string): string[] {
  return FORBIDDEN_CALLS.filter((name) =>
    new RegExp(`\\.\\s*${name}\\s*\\(`).test(source),
  );
}

/**
 * Every exported FUNCTION name in a source, in every shape one can be declared.
 *
 * Three shapes, because `export function` alone missed two of them: an
 * `export async function` (this module has none today, and a zone-taking one is
 * exactly the kind a later story adds) and an arrow bound to an exported const,
 * which is how most of this repository's non-`format` helpers are written. A
 * completeness guard that cannot see a declaration cannot report it missing.
 *
 * Exported VALUES — `LOCALE`, `RANGE_DASH` — are deliberately not matched: they
 * take no arguments, so the zone rule has nothing to say about them.
 */
function exportedFunctionNames(source: string): string[] {
  const declared = [...source.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)].map(
    (found) => found[1] ?? '',
  );
  const arrows = [
    ...source.matchAll(
      /export\s+const\s+(\w+)\s*(?::[^=]+)?=\s*(?:async\s+)?\([^)]*\)\s*(?::[^=]+)?=>/g,
    ),
  ].map((found) => found[1] ?? '');

  return [...declared, ...arrows];
}

/**
 * The parameter list of one exported function, split at top-level commas.
 *
 * Nesting-aware: a parameter typed `{ a: number, b: number }` or defaulted to
 * `f(x, y)` contains commas that are not parameter boundaries.
 */
function parametersOf(source: string, name: string): string[] {
  const marker = `export function ${name}(`;
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`SIGNATURE_NOT_FOUND:${name}`);

  const open = start + marker.length - 1;
  let depth = 0;
  let end = -1;
  for (let index = open; index < source.length; index += 1) {
    const character = source[index];
    if (character === '(' || character === '[' || character === '{') depth += 1;
    if (character === ')' || character === ']' || character === '}') {
      depth -= 1;
      if (depth === 0 && character === ')') {
        end = index;
        break;
      }
    }
  }
  if (end === -1) throw new Error(`SIGNATURE_UNBALANCED:${name}`);

  const parameters: string[] = [];
  let current = '';
  let nesting = 0;
  for (const character of source.slice(open + 1, end)) {
    if ('([{<'.includes(character)) nesting += 1;
    if (')]}>'.includes(character)) nesting -= 1;
    if (character === ',' && nesting === 0) {
      parameters.push(current.trim());
      current = '';
      continue;
    }
    current += character;
  }
  if (current.trim() !== '') parameters.push(current.trim());

  return parameters;
}

/**
 * The exported FUNCTIONS that format no instant, and so take no zone.
 *
 * A named list rather than one inline exclusion, because story 1.5a made it
 * two: `formatNumber` formats a figure and `compareText` orders two strings,
 * and neither has an instant to resolve against a zone. Naming them is what
 * keeps the completeness check below honest — every other exported function is
 * held to `timeZone: string`, and an exemption has to be written down here to
 * exist.
 */
const UNZONED_ENTRY_POINTS = ['formatNumber', 'compareText'];

/**
 * The exported entry points that must take a REQUIRED zone.
 *
 * Every exported FUNCTION not named above does, and the list is asserted
 * complete against the module's actual exports below — otherwise an eighth
 * entry point added without a zone would simply not be checked. Seven are zoned
 * and two are not, which is nine exported functions in all; `LOCALE` and
 * `RANGE_DASH` are exported VALUES and belong to neither count.
 */
const ZONED_ENTRY_POINTS = [
  'formatDate',
  'formatTime',
  'formatTimeRange',
  'formatDayMonthRange',
  'formatMonthName',
  'formatWeekdayName',
  // Story 1.4a. It renders nothing, but it takes a zone and it is held to the
  // same rule as the six that do: `timeZone: string`, required and positional.
  // A `?` or a default here would let a caller ask "is the DEVICE's zone
  // renderable", which is always yes and answers the wrong question.
  'isRenderableTimeZone',
];

beforeAll(async () => {
  await initLocalization();
});

// ---------------------------------------------------------------- the matrix

describe('dates render in the binding Croatian format, not CLDR default', () => {
  // CLDR `hr` numeric is `12. 09. 2026.` — spaced, with a trailing period. The
  // module composes from `formatToParts`, so this fails the moment someone
  // "simplifies" it to `format()`.
  it.each([
    { instant: '2026-09-12T10:00:00Z', expected: '12.09.2026' },
    { instant: '2026-01-01T10:00:00Z', expected: '01.01.2026' },
    { instant: '2026-12-31T10:00:00Z', expected: '31.12.2026' },
  ])('renders $instant as $expected', ({ instant, expected }) => {
    expect(formatDate(at(instant), ZONE)).toBe(expected);
  });

  it('carries no space and no trailing period', () => {
    expect(formatDate(at('2026-09-12T10:00:00Z'), ZONE)).not.toMatch(/[\s]/);
    expect(formatDate(at('2026-09-12T10:00:00Z'), ZONE)).not.toMatch(/\.$/);
  });
});

describe('times render 24-hour and zero-padded', () => {
  it.each([
    { instant: '2026-09-12T17:00:00Z', expected: '19:00' },
    { instant: '2026-09-13T05:00:00Z', expected: '07:00' },
    // Midnight is `00:00`, never `24:00` — a night shift ending at midnight is
    // the pilot's ordinary case, and h24 would render the wrong end of the day.
    { instant: '2026-09-11T22:00:00Z', expected: '00:00' },
  ])('renders $instant as $expected', ({ instant, expected }) => {
    expect(formatTime(at(instant), ZONE)).toBe(expected);
  });
});

describe('ranges use an unspaced en dash', () => {
  it('renders a shift crossing midnight as 19:00–07:00', () => {
    expect(formatTimeRange(at('2026-09-12T17:00:00Z'), at('2026-09-13T05:00:00Z'), ZONE)).toBe(
      '19:00–07:00',
    );
  });

  it('renders a week as 10.09–16.09', () => {
    expect(
      formatDayMonthRange(at('2026-09-10T10:00:00Z'), at('2026-09-16T10:00:00Z'), ZONE),
    ).toBe('10.09–16.09');
  });

  // Named separately from the value assertions above, because a hyphen and an
  // en dash are visually near-identical in a diff and `Intl.formatRange` pads
  // its dash with U+2009 — both are the mistake UX-DR34 exists to forbid.
  it.each([
    { name: 'a time range', produced: () => formatTimeRange(at('2026-09-12T17:00:00Z'), at('2026-09-13T05:00:00Z'), ZONE) },
    { name: 'a day-month range', produced: () => formatDayMonthRange(at('2026-09-10T10:00:00Z'), at('2026-09-16T10:00:00Z'), ZONE) },
  ])('separates $name with U+2013 and no whitespace', ({ produced }) => {
    const rendered = produced();

    expect(rendered).toContain('–');
    expect(rendered).not.toContain('-');
    expect(rendered).not.toContain(' ');
    expect(rendered).not.toMatch(/\s/);
  });

  it('exports that dash as the one range separator', () => {
    expect(RANGE_DASH).toBe('–');
  });
});

describe('text orders the way Croatian orders it, not the way UTF-16 does', () => {
  /**
   * ITS OWN BLOCK, and not a tail on the range separators above.
   *
   * These cases were nested under `ranges use an unspaced en dash`, which is a
   * claim about UX-DR34 and has nothing to say about collation — a reader
   * scanning the suite for what guards the member list's ordering would not find
   * it there, and a reviewer reading the dash block would wonder what collation
   * was doing in it. Same assertions, correct home.
   */
  /**
   * Croatian order, which is not code-unit order (story 1.5a).
   *
   * The comparator is the second thing in this module that CLDR gets right and
   * JavaScript gets wrong — the first being the date separators above — and the
   * failure mode is the same: the naive form produces output that looks
   * plausible and is wrong in a way nobody reports. `a < b` compares UTF-16 code
   * units, which puts every Croatian diacritic after `z`.
   */
  it('puts č directly after c rather than after z', () => {
    // The case `<` gets wrong, and both directions of it, so a comparator
    // returning a constant fails too.
    expect(compareText('Cvitanović', 'Čavić')).toBeLessThan(0);
    expect(compareText('Čavić', 'Cvitanović')).toBeGreaterThan(0);
    expect(compareText('Čavić', 'Zoran')).toBeLessThan(0);
    // What `<` would say, stated here so the disagreement is visible rather
    // than asserted about an invisible mechanism.
    expect('Čavić' < 'Zoran').toBe(false);
  });

  it('reports equal text as equal, so a sort over it is stable', () => {
    expect(compareText('Ana', 'Ana')).toBe(0);
  });

  it('orders addresses by the same rule, which is why it is not named for names', () => {
    expect(compareText('ana@dvd.hr', 'čavić@dvd.hr')).toBeLessThan(0);
    expect(compareText('zoran@dvd.hr', 'čavić@dvd.hr')).toBeGreaterThan(0);
  });

  /**
   * `formatTimeRange`'s doc says a range crossing midnight "needs no special
   * case here". Every other instant in this file is CEST, so that claim was
   * asserted nowhere — and the interesting crossing is not midnight but the
   * DST boundary, where wall-clock arithmetic and elapsed time disagree.
   *
   * Croatia leaves CEST at 03:00 on 25.10.2026. This night runs 19:00 to 07:00
   * on the clock but THIRTEEN elapsed hours, and it must still render the same
   * literal as a twelve-hour night — the shift is defined by the clock, not by
   * the duration, so the composed-from-parts approach is what makes this work
   * without a branch.
   */
  it('renders a night across the DST boundary by the clock, not by elapsed time', () => {
    const start = at('2026-10-24T17:00:00Z');
    const end = at('2026-10-25T06:00:00Z');

    expect((end.valueOf() - start.valueOf()) / 3_600_000, 'the fixture is not the long night').toBe(13);
    expect(formatTimeRange(start, end, ZONE)).toBe('19:00–07:00');
    expect(formatDate(end, ZONE)).toBe('25.10.2026');
  });

  it('renders the spring-forward night the same way', () => {
    // 29.03.2026, when CET becomes CEST: eleven elapsed hours, same literal.
    const start = at('2026-03-28T18:00:00Z');
    const end = at('2026-03-29T05:00:00Z');

    expect((end.valueOf() - start.valueOf()) / 3_600_000).toBe(11);
    expect(formatTimeRange(start, end, ZONE)).toBe('19:00–07:00');
  });
});

describe("month and day names are CLDR verbatim and lowercase", () => {
  it.each([
    { instant: '2026-01-15T10:00:00Z', expected: 'siječanj' },
    { instant: '2026-09-15T10:00:00Z', expected: 'rujan' },
  ])('names the month of $instant $expected', ({ instant, expected }) => {
    expect(formatMonthName(at(instant), ZONE)).toBe(expected);
  });

  it.each([
    { instant: '2026-09-12T10:00:00Z', expected: 'subota' },
    { instant: '2026-09-14T10:00:00Z', expected: 'ponedjeljak' },
  ])('names the weekday of $instant $expected', ({ instant, expected }) => {
    expect(formatWeekdayName(at(instant), ZONE)).toBe(expected);
  });

  // Capitalization belongs to the consuming surface, which is the only thing
  // that knows whether the name starts a sentence.
  it('capitalizes nothing itself', () => {
    const names = [
      formatMonthName(at('2026-09-15T10:00:00Z'), ZONE),
      formatWeekdayName(at('2026-09-12T10:00:00Z'), ZONE),
    ];

    expect(names.map((name) => name.toLocaleLowerCase('hr'))).toEqual(names);
  });
});

describe('numbers use Croatian grouping and decimal separators', () => {
  it('renders 1234.5 as 1.234,50', () => {
    expect(formatNumber(1234.5)).toBe('1.234,50');
  });

  it('renders a count without decimals when asked', () => {
    expect(formatNumber(1234, 0)).toBe('1.234');
  });
});

describe('a formatter honours its zone argument rather than the ambient one', () => {
  const instant = at('2026-09-12T23:30:00Z');

  it('renders 23:30Z as 13.09.2026 01:30 in the organization zone', () => {
    expect(formatDate(instant, ZONE)).toBe('13.09.2026');
    expect(formatTime(instant, ZONE)).toBe('01:30');
  });

  // The zone argument is load-bearing, not decorative: the same instant in a
  // UTC+14 zone is a different hour. Without this a module that ignored the
  // argument entirely would pass every assertion above on this machine.
  it('renders the same instant differently in a UTC+14 zone', () => {
    expect(formatTime(instant, FOREIGN_ZONE)).toBe('13:30');
  });

  it('rejects an invalid zone at construction rather than falling back', () => {
    expect(() => formatDate(instant, 'Europe/Zagrb')).toThrow(RangeError);
  });
});

describe('an invalid instant fails by name, not by a bare RangeError', () => {
  /**
   * `formatToParts` throws `RangeError: Invalid time value` on an unparseable
   * `Date` — no key, no field, nothing saying which of a table's several
   * hundred cells was bad. That is the failure mode `part()` was made total to
   * avoid, so the guard exists for the same reason.
   */
  const invalid = new Date('not-a-date');

  it.each([
    { name: 'formatDate', run: () => formatDate(invalid, ZONE) },
    { name: 'formatTime', run: () => formatTime(invalid, ZONE) },
    { name: 'formatMonthName', run: () => formatMonthName(invalid, ZONE) },
    { name: 'formatWeekdayName', run: () => formatWeekdayName(invalid, ZONE) },
    { name: 'formatTimeRange', run: () => formatTimeRange(invalid, invalid, ZONE) },
    { name: 'formatDayMonthRange', run: () => formatDayMonthRange(invalid, invalid, ZONE) },
  ])('$name names FORMAT_INVALID_INSTANT', ({ run }) => {
    expect(run).toThrow('FORMAT_INVALID_INSTANT');
  });

  it('says something more useful than the runtime would', () => {
    expect(() => formatDate(invalid, ZONE)).not.toThrow('Invalid time value');
  });

  it('still formats a valid instant', () => {
    // Guard against a guard that rejects everything.
    expect(formatDate(at('2026-09-12T10:00:00Z'), ZONE)).toBe('12.09.2026');
  });
});

describe('plurals resolve through all three Croatian forms', () => {
  // 21 and 101 are the load-bearing rows. Croatian `one` is
  // `n % 10 === 1 && n % 100 !== 11`, so `count === 1` passes 1, 2 and 5.
  it.each([
    { count: 1, expected: '1 dan' },
    { count: 2, expected: '2 dana' },
    { count: 5, expected: '5 dana' },
    { count: 21, expected: '21 dan' },
    { count: 101, expected: '101 dan' },
    { count: 22, expected: '22 dana' },
    { count: 11, expected: '11 dana' },
  ])('renders $count days as $expected', ({ count, expected }) => {
    expect(t('count.days', { count })).toBe(expected);
  });

  it.each([
    { count: 1, expected: '1 konflikt' },
    { count: 2, expected: '2 konflikta' },
    { count: 5, expected: '5 konflikata' },
    { count: 21, expected: '21 konflikt' },
    { count: 101, expected: '101 konflikt' },
  ])('renders $count conflicts as $expected', ({ count, expected }) => {
    expect(t('count.conflicts', { count })).toBe(expected);
  });

  it('groups a large count with the Croatian separator', () => {
    expect(t('count.days', { count: 1234 })).toBe('1.234 dana');
  });
});

describe('a missing key degrades visibly and never throws', () => {
  // `t` is typed against the resource file, so a literal missing key is a
  // compile error — which is the point. Reaching it needs the widening cast
  // below, and that cast is the only place in the tree that does so.
  const untyped = t as unknown as (key: string) => string;

  it.each(['nope.missing', 'count.nope', 'utterly-absent'])('renders ⟦%s⟧', (key) => {
    expect(untyped(key)).toBe(`⟦${key}⟧`);
  });

  it('never renders a blank', () => {
    expect(untyped('nope.missing')).not.toBe('');
  });

  it('never throws', () => {
    expect(() => untyped('nope.missing')).not.toThrow();
  });

  it('brackets with codepoints outside Latin Extended-A, so it cannot pass for Croatian', () => {
    const rendered = missingKeyPlaceholder('a.b');

    expect([...rendered].map((character) => character.codePointAt(0))).toContain(0x27e6);
    expect([...rendered].map((character) => character.codePointAt(0))).toContain(0x27e7);
  });
});

describe('a message that cannot be formatted degrades like a missing one', () => {
  /**
   * Two shapes reached the user raw before `parseErrorHandler` was wired.
   *
   *   - A plural key resolved with no `count`. `intl-messageformat` throws
   *     `MissingValueError`, and the plugin's DEFAULT handler returns the
   *     untranslated source — so the screen showed
   *     `{count, plural, one {# dan} few {# dana} other {# dana}}`.
   *   - A parent node rather than a leaf. `t('count')` resolved to the resource
   *     OBJECT, and React then throws "Objects are not valid as a React child",
   *     taking the whole screen down for one bad key. i18next's own
   *     `returnedObjectHandler` cannot catch this under ICU: the translator
   *     gates that branch on `i18nFormat.handleAsObject`, which the ICU plugin
   *     does not set.
   *
   * Both are L5 — degrade visibly and safely, never blank and never a crash.
   */
  const untyped = t as unknown as (key: string, options?: object) => unknown;

  it('renders ⟦key⟧ for a plural message resolved without a count', () => {
    expect(untyped('count.days')).toBe('⟦count.days⟧');
  });

  it('leaks no ICU source to the screen', () => {
    expect(String(untyped('count.days'))).not.toContain('plural');
    expect(String(untyped('count.conflicts'))).not.toContain('{');
  });

  it('renders ⟦key⟧ for a parent node, so React is never handed an object', () => {
    const resolved = untyped('count');

    expect(typeof resolved).toBe('string');
    expect(resolved).toBe('⟦count⟧');
  });

  it('always returns a string, whatever the key', () => {
    for (const key of ['count', 'count.days', 'count.conflicts', 'nope.missing', '']) {
      expect(typeof untyped(key), `t(${JSON.stringify(key)}) returned a non-string`).toBe('string');
    }
  });

  it('still formats a correct call — the handler is not swallowing everything', () => {
    expect(untyped('count.days', { count: 5 })).toBe('5 dana');
  });
});

describe('the exported t is the instance t, after init', () => {
  // `i18n.t` is bound when the instance is created and keeps that identity
  // across `init`, which is what lets `index.ts` export the reference directly
  // and keep `TFunction`'s key typing. An i18next release that started
  // rebinding `t` would ship a permanently empty `t`; this is what notices.
  it('resolves a real key through the exported reference', () => {
    expect(t).toBe(i18n.t);
    expect(t('count.days', { count: 2 })).toBe('2 dana');
  });

  it('has exactly one language configured', () => {
    expect(i18n.languages).toEqual(['hr']);
  });
});

describe('an unknown timezone is refused before it can be saved', () => {
  /**
   * Story 1.4a. `0002:93` leaves the `timezone` column unchecked on purpose —
   * `pg_timezone_names` is not immutable, so it cannot appear in a constraint —
   * which left the one value every later surface resolves against validated
   * nowhere at all. The failure that produces is not a wrong date: every zoned
   * function in this module THROWS `RangeError` on an unknown zone, so a typo
   * saved on the settings surface takes down each screen that renders an
   * instant, far from the edit that caused it.
   */
  it('accepts the zones the fixtures actually carry', () => {
    expect(isRenderableTimeZone(ZONE)).toBe(true);
    expect(isRenderableTimeZone(FOREIGN_ZONE)).toBe(true);
    expect(isRenderableTimeZone('Etc/UTC')).toBe(true);
  });

  it('refuses what would throw at render time', () => {
    // BOTH POLARITIES, and the second is the one that matters: a validator that
    // returned `true` for everything would pass the block above entirely.
    for (const unknown of ['Europe/Zagrb', 'not a zone', '', 'UTC+2', 'Europe']) {
      expect(isRenderableTimeZone(unknown), `${unknown} was accepted`).toBe(false);
    }
  });

  it('agrees with what the formatters actually do', () => {
    // The claim is not "this string looks like a zone" but "this module can
    // render in it", so it is proved against the module's own behaviour rather
    // than against a pattern.
    expect(() => formatDate(new Date('2026-09-12T10:00:00Z'), 'Europe/Zagrb')).toThrow();
    expect(formatDate(new Date('2026-09-12T10:00:00Z'), ZONE)).toBe('12.09.2026');
  });
});

// ------------------------------------------------------- the foreign-zone run

describe('output is identical under a foreign device timezone', () => {
  /**
   * A fresh process, because this module memoizes its formatters: mutating
   * `process.env.TZ` inside the suite would leave already-built formatters
   * carrying the old ambient zone, and a module that had omitted `timeZone`
   * would pass. `format.ts` imports nothing, so Node's own type stripping can
   * load it directly with no bundler and no alias resolution.
   */
  type Measured = { zone: string; date: string; time: string; range: string };

  /**
   * Every instant below is chosen so the two zones DISAGREE about the answer.
   *
   * This is not cosmetic. The first derivation used `2026-09-12T23:30:00Z` for
   * the date, which renders `13.09.2026` in `Europe/Zagreb` (+2) AND in
   * `Pacific/Kiritimati` (+14) — so the date assertion could not detect the one
   * defect it exists for. `11:00Z` splits them: 12.09 in Zagreb, 13.09 in
   * Kiritimati. The time keeps `23:30Z` (01:30 against 13:30) and the range
   * keeps `17:00Z`/`05:00Z` (19:00–07:00 against 07:00–19:00).
   */
  const DATE_INSTANT = '2026-09-12T11:00:00Z';
  const TIME_INSTANT = '2026-09-12T23:30:00Z';

  function underForeignZone(): Measured {
    const moduleUrl = new URL('./format.ts', import.meta.url).href;
    const script = [
      `const m = await import(${JSON.stringify(moduleUrl)});`,
      `process.stdout.write(JSON.stringify({`,
      `  zone: ${INTL}.DateTime${'Format'}().resolvedOptions().timeZone,`,
      `  date: m.formatDate(new Date('${DATE_INSTANT}'), '${ZONE}'),`,
      `  time: m.formatTime(new Date('${TIME_INSTANT}'), '${ZONE}'),`,
      `  range: m.formatTimeRange(new Date('2026-09-12T17:00:00Z'), new Date('2026-09-13T05:00:00Z'), '${ZONE}'),`,
      `}));`,
    ].join('\n');

    // Bounded: an unbounded `execFileSync` turns a hung child into a hung
    // suite with no diagnostic, and an unbounded buffer into an opaque kill.
    const stdout = execFileSync(
      process.execPath,
      ['--experimental-strip-types', '--no-warnings', '--input-type=module', '-e', script],
      {
        env: { ...process.env, TZ: FOREIGN_ZONE },
        encoding: 'utf8',
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
      },
    );

    try {
      return JSON.parse(stdout) as Measured;
    } catch {
      // Without this the child's real failure — a module-resolution error from
      // a newly added import, a type-stripping error on an older Node — arrives
      // as a `SyntaxError: Unexpected token` naming nothing useful.
      throw new Error(
        `FOREIGN_ZONE_CHILD_OUTPUT_NOT_JSON: the child wrote ${JSON.stringify(stdout)}`,
      );
    }
  }

  // Read lazily and once: at module scope a failing child process throws during
  // collection, and the guard assertion below would never report.
  let cached: ReturnType<typeof underForeignZone> | null = null;
  const measured = (): ReturnType<typeof underForeignZone> =>
    (cached ??= underForeignZone());

  // Guard against a vacuous pass: if the child did not actually pick up the
  // foreign zone, every assertion below would hold for the wrong reason.
  it('really ran under Pacific/Kiritimati', () => {
    expect(measured().zone).toBe(FOREIGN_ZONE);
  });

  it('renders the same date — a zone leak would read 13.09.2026', () => {
    expect(measured().date).toBe('12.09.2026');
  });

  it('renders the same time — a zone leak would read 13:30', () => {
    expect(measured().time).toBe('01:30');
  });

  it('renders the same range — a zone leak would read 07:00–19:00', () => {
    expect(measured().range).toBe('19:00–07:00');
  });
});

// ------------------------------------------------------------- the source scan

/** The one file permitted to construct a formatter. */
const FORMATTING_MODULE = join(srcRoot, 'i18n', 'format.ts');

const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
/** `//` to end of line. The leading class keeps `https://` inside a string
 *  intact — the two-pass idiom from `test/key-hygiene.test.ts`. */
const LINE_SLASH = /(^|[\s;,{}()[\]])\/\/[^\n]*/g;

/**
 * Comment-blind source. Every file here documents the rule in prose — this
 * module's own header names `Intl.DateTimeFormat` several times — and a
 * comment-aware scan would punish exactly the explanation we want written.
 */
function stripComments(source: string): string {
  return source.replace(BLOCK_COMMENT, '').replace(LINE_SLASH, '$1');
}

function stripped(file: string): string {
  return stripComments(readFileSync(file, 'utf8'));
}

/** Directories that are not this workspace's own source. `node_modules` is the
 *  load-bearing one: `apps/web` is now the scan root, and every dependency
 *  under it constructs formatters entirely legitimately. */
const NOT_SOURCE = new Set(['node_modules', 'dist', 'coverage']);

function collect(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    if (NOT_SOURCE.has(entry)) continue;
    const absolute = join(directory, entry);
    if (statSync(absolute).isDirectory()) found.push(...collect(absolute));
    else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) found.push(absolute);
  }

  return found;
}

/** The argument list of each `new Intl.DateTimeFormat(...)`, brace-matched so a
 *  nested options object cannot end it early. */
function constructionArguments(source: string): string[] {
  const found: string[] = [];
  let cursor = source.indexOf(NEW_DATE_TIME_FORMAT);

  while (cursor !== -1) {
    const open = source.indexOf('(', cursor);
    if (open === -1) throw new Error('CONSTRUCTION_UNOPENED');

    let depth = 0;
    let end = -1;
    for (let index = open; index < source.length; index += 1) {
      if (source[index] === '(') depth += 1;
      if (source[index] === ')') {
        depth -= 1;
        if (depth === 0) {
          end = index;
          break;
        }
      }
    }
    if (end === -1) throw new Error('CONSTRUCTION_UNBALANCED');

    found.push(source.slice(open + 1, end));
    cursor = source.indexOf(NEW_DATE_TIME_FORMAT, end);
  }

  return found;
}

describe('the formatting module is the only Intl construction site', () => {
  // Lazy: a `readdirSync` at module scope throws during collection, and the
  // vacuous-pass guard below would never report.
  const files = (): string[] => collect(webRoot);

  it('finds files to scan at all', () => {
    // Without this every assertion below passes vacuously, and a client tree
    // that had been moved or renamed would look compliant.
    expect(files().length).toBeGreaterThan(0);
    expect(files()).toContain(FORMATTING_MODULE);
  });

  it('scans above src, so the build configuration is covered too', () => {
    // The invariant is scoped to `apps/web`, not `apps/web/src`. Named so that
    // narrowing the root back to `src` fails here rather than silently.
    expect(files()).toContain(join(webRoot, 'vite.config.ts'));
    expect(files()).toContain(join(webRoot, 'vitest.config.ts'));
  });

  it('reads only text files, never a source carrying a raw control byte', () => {
    // This story first shipped `format.ts` with three literal NUL bytes, used as
    // cache-key separators. It compiled, linted and passed all 689 tests, but git
    // classified the module as binary — no diff, no blame, unreviewable in a pull
    // request — and `grep` skipped it in silence. The separators are `\u0000`
    // escapes now, and this is what stops a raw one coming back.
    //
    // Checked by codepoint rather than by regular expression: a character class of
    // control bytes is itself an ESLint `no-control-regex` error.
    const ALLOWED = new Set([9, 10, 13]); // tab, newline, carriage return
    const carriesControlByte = (source: string): boolean => {
      for (let index = 0; index < source.length; index += 1) {
        const code = source.charCodeAt(index);
        if (code < 0x20 && !ALLOWED.has(code)) return true;
      }

      return false;
    };

    const offenders = files().filter((file) => carriesControlByte(readFileSync(file, 'utf8')));

    expect(offenders).toEqual([]);
  });

  it('reaches for Intl in format.ts and nowhere else', () => {
    const offenders: string[] = [];
    for (const file of files()) {
      if (file === FORMATTING_MODULE) continue;
      for (const use of intlValueUses(stripped(file))) {
        offenders.push(`${relative(webRoot, file)} uses ${use}`);
      }
    }

    expect(offenders, `${INTL} may only be reached from src/i18n/format.ts (L6)`).toEqual([]);
  });

  it('assembles no date string by hand anywhere', () => {
    const offenders: string[] = [];
    for (const file of files()) {
      for (const call of forbiddenCallsIn(stripped(file))) {
        offenders.push(`${relative(webRoot, file)} calls .${call}()`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('passes timeZone to every formatter it does construct', () => {
    const constructions = constructionArguments(stripped(FORMATTING_MODULE));

    // Non-empty guard: a module that had stopped constructing formatters at all
    // would satisfy the filter below without asserting anything.
    expect(constructions.length).toBeGreaterThan(0);
    expect(
      constructions.filter((argumentList) => !argumentList.includes('timeZone')),
      'a date formatter built without timeZone silently uses the device zone (L8)',
    ).toEqual([]);
  });
});

describe('the timeZone argument is required, not merely present', () => {
  /**
   * The gap this closes. Every value assertion in this file passes `timeZone`
   * explicitly, so making the parameter OPTIONAL — `timeZone: string =
   * Intl.DateTimeFormat().resolvedOptions().timeZone` — left all 63 tests green
   * and `tsc` clean while handing every caller the device zone by default.
   * That is L8 defeated by a default value, and only the source says so.
   */
  const source = (): string => stripped(FORMATTING_MODULE);

  it('checks every exported date/time entry point, and knows of no others', () => {
    // Completeness guard: an eighth zoned export added later must be listed
    // here or this fails, rather than the new export going unchecked.
    //
    // THE READER SEES EVERY SHAPE AN EXPORT CAN TAKE, which it did not: it
    // matched `export function` alone, so `export async function` and
    // `export const name = (…) =>` were both invisible — and either could ship a
    // date formatter with an optional zone that this block would never look at.
    // The self-test below proves all three shapes and both polarities.
    const exported = exportedFunctionNames(source());
    const zoned = exported.filter((name) => !UNZONED_ENTRY_POINTS.includes(name));

    // Both lists non-empty, so neither an emptied exemption list nor an
    // emptied requirement list can make the comparison below vacuous.
    expect(UNZONED_ENTRY_POINTS.length).toBeGreaterThan(0);
    expect(exported.length).toBe(ZONED_ENTRY_POINTS.length + UNZONED_ENTRY_POINTS.length);
    expect(ZONED_ENTRY_POINTS.length).toBeGreaterThan(0);
    expect([...zoned].sort()).toEqual([...ZONED_ENTRY_POINTS].sort());
  });

  it('reads every shape an export can be declared in, and no exported value', () => {
    // Detector self-test, both polarities — the idiom every reader in this
    // repository follows. A reader blind to one shape makes the completeness
    // guard above pass while a new entry point goes unchecked.
    const probe = [
      'export function plain(a: string) {}',
      'export async function waiting(a: string) {}',
      'export const arrow = (a: string): string => a;',
      'export const typed: Fn = (a: string) => a;',
      "export const LOCALE = 'hr';",
      'const notExported = (a: string) => a;',
    ].join('\n');

    expect(exportedFunctionNames(probe)).toEqual(['plain', 'waiting', 'arrow', 'typed']);
    expect(exportedFunctionNames('const x = 1;')).toEqual([]);
  });

  it.each(ZONED_ENTRY_POINTS)('declares %s(…, timeZone: string) with no default', (name) => {
    const zoneParameters = parametersOf(source(), name).filter((parameter) =>
      parameter.startsWith('timeZone'),
    );

    expect(zoneParameters, `${name} declares no timeZone parameter at all`).toHaveLength(1);
    expect(
      zoneParameters[0],
      `${name}'s timeZone must be exactly \`timeZone: string\` — a \`?\` or a \`=\` default lets a caller inherit the device zone (L8)`,
    ).toMatch(/^timeZone: string$/);
  });

  it('never asks the runtime what the ambient zone is', () => {
    // `resolvedOptions()` is the only way to read the device zone, and this
    // module has no legitimate use for it. Banning the call outright is
    // stronger than checking each site, and it is what makes the default-value
    // mutation above impossible to write in the first place.
    expect(source()).not.toContain(`resolved${'Options'}`);
  });
});

describe('the scan detects the shapes it exists to catch', () => {
  // Guards the detector. A matcher that matched nothing would let every
  // assertion above pass while a surface formatted its own dates. The sources
  // below are synthetic strings, never files, so this cannot trip its own scan.

  it('reports a construction with no timeZone', () => {
    const source = `const f = ${NEW_DATE_TIME_FORMAT}('hr', { hour: '2-digit' });`;

    expect(constructionArguments(source)).toHaveLength(1);
    expect(constructionArguments(source)[0]).not.toContain('timeZone');
  });

  it('accepts a construction that passes one', () => {
    const source = `const f = ${NEW_DATE_TIME_FORMAT}('hr', { timeZone, hour: '2-digit' });`;

    expect(constructionArguments(source)[0]).toContain('timeZone');
  });

  it('reads past a nested call rather than stopping at its closing paren', () => {
    const source = `const f = ${NEW_DATE_TIME_FORMAT}('hr', { ...shape(kind), timeZone });`;

    expect(constructionArguments(source)).toHaveLength(1);
    expect(constructionArguments(source)[0]).toContain('timeZone');
  });

  it('finds every construction, not only the first', () => {
    const source = [
      `${NEW_DATE_TIME_FORMAT}('hr', { timeZone });`,
      `${NEW_DATE_TIME_FORMAT}('hr', { hour: '2-digit' });`,
    ].join('\n');

    expect(constructionArguments(source)).toHaveLength(2);
  });

  it('strips a comment before scanning, so prose about the rule is not a breach', () => {
    const commented = `/* never call ${INTL}.DateTime${'Format'} here */\nexport const x = 1;`;

    expect(intlValueUses(commented)).not.toEqual([]);
    expect(intlValueUses(stripComments(commented))).toEqual([]);
  });

  it.each([
    { name: 'plain member access', source: `new ${INTL}.DateTime${'Format'}('hr')` },
    { name: 'a member access with no call', source: `const F = ${INTL}.DateTime${'Format'};` },
    { name: 'computed access', source: `new ${INTL}['DateTime' + 'Format']('hr')` },
    { name: 'destructuring the namespace', source: `const { DateTimeFormat } = ${INTL};` },
    { name: 'aliasing the namespace', source: `const shorthand = ${INTL};` },
  ])('reports $name', ({ source }) => {
    expect(intlValueUses(source)).not.toEqual([]);
  });

  it.each(INTL_TYPE_MEMBERS)('accepts the type-only reference %s', (member) => {
    // Over-broad detection is its own failure: a surface annotating an options
    // type constructs nothing, and reporting it would train people to work
    // around the scan.
    expect(intlValueUses(`function f(o: ${INTL}.${member}) {}`)).toEqual([]);
  });

  it.each([
    { name: 'a device-local hour read', source: `const h = instant.get${'Hours'}();` },
    { name: 'a hand-assembled date', source: `const d = instant.get${'Date'}() + '.' + instant.get${'Month'}();` },
    { name: 'an ISO string', source: `const s = instant.to${'ISOString'}();` },
    { name: 'a locale string', source: `const s = instant.to${'Locale'}${'String'}('hr');` },
    { name: 'a bare date string', source: `const s = instant.to${'DateString'}();` },
  ])('reports $name', ({ source }) => {
    expect(forbiddenCallsIn(source)).not.toEqual([]);
  });

  it.each([
    { name: 'toLocaleLowerCase, which this module legitimately uses', source: `x.to${'Locale'}LowerCase('hr')` },
    { name: 'valueOf, used by the invalid-instant guard', source: `Number.isNaN(instant.valueOf())` },
    { name: 'an identifier that merely contains a banned word', source: `const getDatesInWeek = 1;` },
  ])('stays silent on $name', ({ source }) => {
    expect(forbiddenCallsIn(source)).toEqual([]);
  });

  it.each([
    { name: 'a default value', parameter: `timeZone: string = 'Europe/Zagreb'` },
    { name: 'an optional marker', parameter: 'timeZone?: string' },
    { name: 'a resolvedOptions default', parameter: `timeZone: string = ${INTL}.DateTime${'Format'}().resolvedOptions().timeZone` },
  ])('rejects a zone parameter carrying $name', ({ parameter }) => {
    const source = `export function formatProbe(instant: Date, ${parameter}): string {}`;
    const [zone] = parametersOf(source, 'formatProbe').filter((p) => p.startsWith('timeZone'));

    expect(zone).not.toMatch(/^timeZone: string$/);
  });

  it('accepts a required zone parameter', () => {
    const source = `export function formatProbe(instant: Date, timeZone: string): string {}`;
    const [zone] = parametersOf(source, 'formatProbe').filter((p) => p.startsWith('timeZone'));

    expect(zone).toMatch(/^timeZone: string$/);
  });

  it('splits parameters at top-level commas only', () => {
    // A nested object type or a defaulted call contains commas that are not
    // parameter boundaries; splitting on every comma would mis-read the zone.
    const source = `export function formatProbe(shape: { a: number, b: number }, timeZone: string): string {}`;

    expect(parametersOf(source, 'formatProbe')).toEqual([
      'shape: { a: number, b: number }',
      'timeZone: string',
    ]);
  });
});
