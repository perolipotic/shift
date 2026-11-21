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
  CALENDAR_CELL_CLASS,
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

  it('offers no print of Moj raspored when the viewer is missing from the members, and still prints Sve smjene', () => {
    const nameless = { ...snapshot, members: snapshot.members.filter((member) => member.id !== snapshot.viewer.memberId) };

    expect(calendarPrintHeaderOf({ refused: false, snapshot: nameless, month: monthIn(MODE_MOJ), mode: MODE_MOJ, printedAt: PRINTED })).toBeNull();
    expect(calendarPrintHeaderOf({ refused: false, snapshot: nameless, month: monthIn(MODE_SVE), mode: MODE_SVE, printedAt: PRINTED })).not.toBeNull();
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
    // Every print rule, the page too, inside the print media query: the screen reads none of it.
    expect(css).toMatch(/@media print \{\s*@page calendar-month \{/);
    expect(css).toMatch(/\[data-print-month\] \{\s*page: calendar-month;/);
  });

  it('draws only the month: everything neither it, inside it, nor holding it is not drawn', () => {
    expect(css).toMatch(
      /body:has\(\[data-print-month\]\) :not\(\[data-print-month\], \[data-print-month\] \*, :has\(\[data-print-month\]\)\) \{\s*display: none !important;/,
    );
    expect(css).toMatch(/\[data-print-month\] \[data-sticky-head\],\s*\[data-print-month\] dialog \{\s*display: none !important;/);
  });

  it('prints black on no fill, in either theme', () => {
    expect(css).toMatch(
      /\[data-print-month\],\s*\[data-print-month\] \* \{\s*color: oklch\(0 0 0\) !important;\s*background-color: transparent !important;\s*background-image: none !important;\s*box-shadow: none !important;/,
    );
    // The paper's borders are set on the month's elements, never by redeclaring a theme token
    // (one declaration per theme), so the dark theme's hairline cannot reach paper.
    expect(css).toMatch(/\[data-print-month\] \* \{[^}]*border-color: oklch\(0\.7 0 0\) !important;/);
    expect(css).toMatch(/\[data-print-month\] \.border-foreground \{\s*border-color: oklch\(0 0 0\) !important;/);
    const printBlock = css.slice(css.indexOf('@page calendar-month'));
    expect(printBlock).not.toMatch(/--(border|input|foreground):/);
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
    // A hatch's border is all four sides; the short-staffed edge comes after it, so a cell both
    // hatched and short-staffed keeps its bottom edge, as under forced colours.
    // A ring on a hatched cell is drawn inside the hatch's border, never over it.
    expect(css).toMatch(/\.modifier-ring-conflict, [^)]*\):is\(\s*\.modifier-hatch-leave,[^{]*\{\s*outline-offset: -4px !important;/);
    expect(css.lastIndexOf('[data-print-month] .modifier-hatch-leave-uncovered')).toBeLessThan(
      css.indexOf('[data-print-month] .modifier-edge-short-staffed'),
    );
  });

  it('marks the month for the stylesheet and keeps the controls off paper', () => {
    expect(page).toMatch(/<main\s+data-print-month/);
    expect(page).toContain('<PageHeader className="print:hidden">');
    expect(page).toContain('<div className="min-w-0 print:hidden">');
    expect(page).toContain("{t('print.action')}");
    // The loan notice is drawn on paper, though the sentence it follows is not.
    expect(page).toMatch(/<LoanNoticeLine\s+notice=\{month\.ownLoan\}\s+className="(?![^"]*print:hidden)[^"]*print:mt-0/);
  });

  it("prints through the browser's own dialog and nothing else (D3)", () => {
    expect(hook).toContain('window.print();');
    // The page's stamp: subscribed on mount, committed synchronously, and taken before Ispiši prints.
    expect(hook).toMatch(/useEffect\(\(\) => onEveryPrint\(\{ window, media: window\.matchMedia\('print'\) \}, stamp\)/);
    expect(hook).toMatch(/flushSync\(\(\) => \{\s*setPrintedAt\(new Date\(\)\);/);
    expect(hook).toMatch(/stamp\(\);\s*window\.print\(\);/);
    expect(hook).not.toMatch(/fetch|supabase|pdfmake|import\(/);
    expect(page).not.toMatch(/pdfmake|history-pdf|\.pdf\b/);
  });

  it("prints a grid cell's range at every width, so a midnight-crossing shift shows both times (DI-5)", () => {
    expect(GRID_RANGE_CLASS.split(' ')).toContain('print-month:inline');
  });

  it('keeps the classes Danas shares off its print: print-month:, never print:', () => {
    // CALENDAR_CELL_CLASS and GRID_RANGE_CLASS reach Danas's week grid and list.
    for (const shared of [CALENDAR_CELL_CLASS, GRID_RANGE_CLASS]) {
      expect(shared.split(' ').filter((name) => name.startsWith('print:'))).toEqual([]);
    }
    expect(CALENDAR_CELL_CLASS).toContain('print-month:flex-row');
    expect(css).toMatch(/@custom-variant print-month \{\s*@media print \{\s*\[data-print-month\] & \{\s*@slot;/);
  });
});
