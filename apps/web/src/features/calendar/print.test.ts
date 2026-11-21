import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { CALENDAR_SCREEN_PARTS } from '@/features/calendar/calendar-screen.fixture';
import { calendarFilterWordsOf } from '@/features/calendar/components/calendar-filters';
import {
  calendarPrintHeaderOf,
  calendarPrintHeaderTextOf,
  ownScheduleWordsOf,
} from '@/features/calendar/components/calendar-print-header';
import { readCalendar, type CalendarSnapshot } from '@/features/calendar/services/snapshot';
import {
  GRID_RANGE_CLASS,
  MODE_MOJ,
  MODE_SVE,
  calendarMonthOf,
  type CalendarFilter,
  type CalendarMonth,
} from '@/features/calendar/utils/month';
import {
  PILOT,
  SEEDED,
  VIEWER_MEMBER,
  VIEWER_NAME,
  calendarLoanRow,
  calendarMemberRow,
  calendarOrganizationRow,
  calendarTableOf,
  loansAnswerOf,
  memberMembershipRow,
  membersAnswerOf,
  membershipRow,
  overridesAnswerOf,
  rosterOverridesAnswerOf,
  viewerRow,
  viewerSession,
} from '@/features/rotation/rotation.fixture';
import { onEveryPrint } from '@/hooks/print';
import { initLocalization } from '@/lib/i18n';

/**
 * STORY 16.1 (UX-DR56, FR-84, decision D3): THE MONTH PRINTS. The header's
 * words, executed, and the parts of the print a source can hold: the page
 * marks itself for the print stylesheet, the stylesheet is A4 landscape and
 * draws only the month, *Ispiši* calls the browser's print and nothing else,
 * and a range always prints. The printed pages themselves were rendered and
 * looked at (the spec's Verification); no test here lays out a page.
 */

const srcRoot = fileURLToPath(new URL('../..', import.meta.url));
const raw = (parts: readonly string[]): string => readFileSync(join(srcRoot, ...parts), 'utf8');
const code = (parts: readonly string[]): string =>
  raw(parts)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

function monthWith(filter: Partial<CalendarFilter>): CalendarMonth {
  const teams = ['a', 'b'].map((id) => ({ id, name: `Smjena ${id.toUpperCase()}`, letter: id.toUpperCase() }));

  return {
    filter: {
      teams,
      chosen: null,
      people: [
        { id: 'luka', name: 'Luka Knežević', teamId: 'a', teamName: 'Smjena A' },
        { id: 'ana', name: 'Ana Anić', teamId: 'b', teamName: 'Smjena B' },
        { id: 'iva', name: 'Iva Ivić', teamId: 'b', teamName: 'Smjena B' },
      ],
      person: null,
      teamCounts: { a: 1, b: 2 },
      ...filter,
    },
  } as unknown as CalendarMonth;
}

const A = 'pilot-smjena-a';
const D = 'pilot-smjena-d';
const PRINTED = new Date('2026-09-14T08:00:00Z');

/** The pilot as a member of A sees it, lent to D on 20.–22.09. (story 18.5's notice). */
async function memberSnapshot(): Promise<CalendarSnapshot> {
  const source = calendarTableOf(
    {
      data: [
        calendarOrganizationRow(PILOT, {
          viewers: [viewerRow([membershipRow(A, SEEDED)], { role: 'member_role' })],
          versions: [memberMembershipRow(VIEWER_MEMBER, A, SEEDED)],
        }),
      ],
      error: null,
      count: 1,
    },
    membersAnswerOf([calendarMemberRow(VIEWER_MEMBER, VIEWER_NAME)]),
    overridesAnswerOf(),
    rosterOverridesAnswerOf(),
    loansAnswerOf([calendarLoanRow('loan-viewer', VIEWER_MEMBER, D, '2026-09-20', '2026-09-22')]),
  );
  const outcome = await readCalendar(source, source, viewerSession());

  if (!outcome.ok) throw new Error(outcome.code);

  return outcome.snapshot;
}

let snapshot: CalendarSnapshot;

beforeAll(async () => {
  await initLocalization();
  snapshot = await memberSnapshot();
});

describe("the printed month's header", () => {
  it('names the organization, the month, the filter and when it was printed, in the organization zone', () => {
    // 23:30 UTC on 30.11. is 00:30 on 01.12. in Zagreb (CET): the zone's date, never UTC's.
    const text = calendarPrintHeaderTextOf({
      organizationName: 'JVP Grad',
      timeZone: 'Europe/Zagreb',
      monthName: 'Studeni',
      year: '2026',
      filter: 'Prikazano: Smjena B · 2 osobe od 3',
      printedAt: new Date('2026-11-30T23:30:00Z'),
    });

    expect(text).toEqual({
      organization: 'JVP Grad',
      title: 'Raspored · Studeni 2026',
      filter: 'Prikazano: Smjena B · 2 osobe od 3',
      printedAt: 'Ispisano: 01.12.2026 u 00:30',
    });
  });

  it("says Sve smjene's filter as the bar's own summary, with none on too", () => {
    expect(calendarFilterWordsOf(monthWith({}))).toBe('Prikazano: sve smjene (2) · 3 osobe');
    expect(calendarFilterWordsOf(monthWith({ chosen: 'b' }))).toBe('Prikazano: Smjena B · 2 osobe od 3');
    expect(calendarFilterWordsOf(monthWith({ person: 'luka' }))).toBe('Prikazano: Luka Knežević · Smjena A');
  });

  it("says Moj raspored's whose by name and which team, without the screen's note on the filters", () => {
    expect(ownScheduleWordsOf('Lana Članica', 'Smjena A')).toBe('Moj raspored: Lana Članica · Smjena A');
    expect(ownScheduleWordsOf('Lana Članica', null)).toBe('Moj raspored: Lana Članica · bez smjene');
  });
});

describe('the header the page prints, from the rendered month', () => {
  const monthIn = (mode: typeof MODE_MOJ | typeof MODE_SVE): CalendarMonth =>
    calendarMonthOf(snapshot, { mjesec: '2026-09', prikaz: mode }, '2026-09-14');

  it("prints Moj raspored's own words, naming the viewer, in that mode", () => {
    const header = calendarPrintHeaderOf({ refused: false, snapshot, month: monthIn(MODE_MOJ), mode: MODE_MOJ, printedAt: PRINTED });

    expect(header).toEqual({
      organization: 'DVD Fixture',
      title: 'Raspored · Rujan 2026',
      filter: `Moj raspored: ${VIEWER_NAME} · Smjena A`,
      printedAt: 'Ispisano: 14.09.2026 u 10:00',
    });
  });

  it("prints the filter bar's summary in Sve smjene", () => {
    const header = calendarPrintHeaderOf({ refused: false, snapshot, month: monthIn(MODE_SVE), mode: MODE_SVE, printedAt: PRINTED });

    expect(header?.filter).toBe('Prikazano: sve smjene (4) · 1 osoba');
  });

  it('prints no header, and so offers no Ispiši, while no month is drawn or the read was refused', () => {
    const month = monthIn(MODE_SVE);

    expect(calendarPrintHeaderOf({ refused: true, snapshot, month, mode: MODE_SVE, printedAt: PRINTED })).toBeNull();
    expect(calendarPrintHeaderOf({ refused: false, snapshot: null, month, mode: MODE_SVE, printedAt: PRINTED })).toBeNull();
    expect(calendarPrintHeaderOf({ refused: false, snapshot, month: null, mode: MODE_SVE, printedAt: PRINTED })).toBeNull();
    expect(calendarPrintHeaderOf({ refused: false, snapshot, month, mode: null, printedAt: PRINTED })).toBeNull();
  });

  it("prints the viewer's loan notice the screen shows: the loan is in the month the print draws", () => {
    // The print is the screen's DOM; this pins the model both draw from.
    expect(monthIn(MODE_MOJ).ownLoan).toMatchObject({ teamName: 'Smjena D' });
  });
});

describe('the time printed is taken before every print', () => {
  it('stamps on beforeprint and on the switch to print media, and stops when unsubscribed', () => {
    const window = new EventTarget();
    const media = new EventTarget();
    let stamps = 0;
    const off = onEveryPrint({ window, media }, () => {
      stamps += 1;
    });
    const change = (matches: boolean): Event => Object.assign(new Event('change'), { matches });

    window.dispatchEvent(new Event('beforeprint'));
    media.dispatchEvent(change(true));
    media.dispatchEvent(change(false));
    expect(stamps).toBe(2);

    off();
    window.dispatchEvent(new Event('beforeprint'));
    media.dispatchEvent(change(true));
    expect(stamps).toBe(2);
  });
});

describe('the print stylesheet and the page it prints', () => {
  const css = raw(['index.css']);
  const page = code(CALENDAR_SCREEN_PARTS.page);
  const hook = code(['hooks', 'print.ts']);

  it('is A4 landscape on a named page the month alone takes', () => {
    expect(css).toMatch(/@page calendar-month \{\s*size: A4 landscape;/);
    expect(css).toMatch(/\[data-print-month\] \{\s*page: calendar-month;/);
  });

  it('draws only the month: everything neither it, inside it, nor holding it is not drawn', () => {
    expect(css).toContain(
      'body:has([data-print-month]) :not([data-print-month], [data-print-month] *, :has([data-print-month])) {\n    display: none !important;',
    );
    expect(css).toMatch(/\[data-print-month\] \[data-sticky-head\],\s*\[data-print-month\] dialog \{\s*display: none !important;/);
  });

  it('prints black on no fill, in either theme', () => {
    expect(css).toMatch(
      /\[data-print-month\],\s*\[data-print-month\] \* \{\s*color: oklch\(0 0 0\) !important;\s*background-color: transparent !important;\s*background-image: none !important;\s*box-shadow: none !important;/,
    );
    // Dark's tokens are `:root[data-theme="dark"]` (0,2,0): the paper's must tie it and come later.
    expect(css).toMatch(/:root:has\(\[data-print-month\]\) \{[^}]*--border: oklch\(0\.7 0 0\);[^}]*--foreground: oklch\(0 0 0\);/);
    expect(css.indexOf(':root:has([data-print-month])')).toBeGreaterThan(css.indexOf(':root[data-theme="dark"]'));
  });

  it('gives every ring, edge and hatch a black outline or border in print', () => {
    for (const utility of [
      'modifier-ring-conflict',
      'modifier-ring-overridden',
      'modifier-ring-conflict-overridden',
      'modifier-edge-short-staffed',
      'modifier-ring-conflict-short-staffed',
      'modifier-ring-overridden-short-staffed',
      'modifier-ring-conflict-overridden-short-staffed',
      'modifier-hatch-leave',
      'modifier-hatch-uncovered',
      'modifier-hatch-leave-uncovered',
    ]) {
      expect(css, `${utility} prints as colour alone`).toContain(`[data-print-month] .${utility}`);
    }
  });

  it('marks the month for the stylesheet and keeps the controls off paper', () => {
    expect(page).toMatch(/<main\s+data-print-month/);
    expect(page).toContain('<PageHeader className="print:hidden">');
    expect(page).toContain('<div className="min-w-0 print:hidden">');
    expect(page).toContain("{t('print.action')}");
  });

  it("prints through the browser's own dialog and nothing else (D3)", () => {
    expect(hook).toContain('window.print();');
    expect(hook).not.toMatch(/fetch|supabase|pdfmake|import\(/);
    expect(page).not.toMatch(/pdfmake|history-pdf|\.pdf\b/);
  });

  it("prints a grid cell's range at every width, so a midnight-crossing shift shows both times (DI-5)", () => {
    expect(GRID_RANGE_CLASS.split(' ')).toContain('print:inline');
  });
});
