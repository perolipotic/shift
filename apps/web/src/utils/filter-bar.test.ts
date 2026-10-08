import { beforeAll, describe, expect, it } from 'vitest';

import { initLocalization, t } from '@/lib/i18n';
import {
  ALL_TEAMS_OPTION,
  NO_TEAM_OPTION,
  entersPickerList,
  filterChipMessageKey,
  filterRemoveMessageKey,
  filterSummaryMessageKey,
  filterSummaryValuesOf,
  teamOptionChoiceOf,
  teamOptionOf,
  filterStateKeyOf,
  modelStateKeyOf,
  FILTERS_CLEARED,
  FILTER_PERSON,
  FILTER_TEAM,
  filterBarOf,
  filterChoiceOf,
  filterRemovalOf,
  focusAfterRemovalOf,
  hasActiveFilter,
  monthInMessageKey,
  peopleGroupsOf,
  peopleMatching,
  pickerIndexAfter,
  yearOfMonthText,
  type FilterBarInput,
  type FilterPersonOption,
  type FilterTeamOption,
  focusAfterOptionRemovalOf,
  optionPickerAlignOf,
  optionChipsActiveCount,
} from '@/utils/filter-bar';

/**
 * Story 7.5's filter bar model, executed (AD-15): the chips, the summary, what
 * each press changes under each screen's rule, where focus goes after a ✕,
 * the Osoba picker's search and groups, and the month locative.
 */

const A: FilterTeamOption = { id: 'a', name: 'Smjena A', count: 5 };
const B: FilterTeamOption = { id: 'b', name: 'Smjena B', count: 4 };
const TEAMS = [A, B, { id: 'c', name: 'Smjena C', count: 4 }, { id: 'd', name: 'Smjena D', count: 4 }];

const LUKA: FilterPersonOption = { id: 'luka', name: 'Luka Knežević', teamId: 'a', teamName: 'Smjena A' };
const ANA: FilterPersonOption = { id: 'ana', name: 'Ana Anić', teamId: 'b', teamName: 'Smjena B' };
const TONI: FilterPersonOption = { id: 'toni', name: 'Toni Bezsmjene', teamId: null, teamName: null };
const OLD: FilterPersonOption = { id: 'old', name: 'Đuro Đurić', teamId: 'x', teamName: 'Stara smjena' };
/** Seventeen people: Luka, Ana, Toni and fourteen more. */
const PEOPLE: readonly FilterPersonOption[] = [
  ANA,
  LUKA,
  TONI,
  ...Array.from({ length: 14 }, (_, index) => ({
    id: `p${String(index)}`,
    name: `Osoba ${String(index)}`,
    teamId: TEAMS[index % 4]?.id ?? null,
    teamName: TEAMS[index % 4]?.name ?? null,
  })),
];

function kalendar(over: Partial<FilterBarInput> = {}) {
  return filterBarOf({ combine: false, teams: TEAMS, team: null, people: PEOPLE, person: null, shownCount: 17, ...over });
}

function sati(over: Partial<FilterBarInput> = {}) {
  return filterBarOf({ combine: true, teams: TEAMS, team: null, people: PEOPLE, person: null, shownCount: 17, ...over });
}

beforeAll(async () => {
  await initLocalization();
});

describe('the chips and the summary', () => {
  it('reads no filter as two `sve` chips and every team and person', () => {
    const model = kalendar();

    expect(model.chips).toEqual([
      { key: FILTER_TEAM, value: null },
      { key: FILTER_PERSON, value: null },
    ]);
    expect(model.summary).toEqual({ kind: 'all', teams: 4, people: 17 });
    expect(hasActiveFilter(model)).toBe(false);
    expect(t('filter.summary.all', { teams: 4, people: 17 })).toBe('Prikazano: sve smjene (4) · 17 osoba');
    expect(model.chips.map((chip) => t(filterChipMessageKey(chip), { value: chip.value }))).toEqual([
      'Smjena: sve',
      'Osoba: sve',
    ]);
    expect(t(filterSummaryMessageKey(model.summary), filterSummaryValuesOf(model.summary))).toBe(
      'Prikazano: sve smjene (4) · 17 osoba',
    );
    expect(t('filter.open')).toBe('Filtri');
  });

  it('Kalendar, team: the chip names it, and the summary counts its people of all', () => {
    // Matrix: `?prikaz=sve&smjena=B`.
    const model = kalendar({ team: 'b', shownCount: 4 });

    expect(model.chips).toEqual([
      { key: FILTER_TEAM, value: 'Smjena B' },
      { key: FILTER_PERSON, value: null },
    ]);
    expect(model.summary).toEqual({ kind: 'team', team: 'Smjena B', shown: 4, total: 17 });
    expect(t(filterSummaryMessageKey(model.summary), filterSummaryValuesOf(model.summary))).toBe(
      'Prikazano: Smjena B · 4 osobe od 17',
    );
    const [team] = model.chips;

    expect(t(filterChipMessageKey(team!), { value: team!.value })).toBe('Smjena: Smjena B');
    expect(t(filterRemoveMessageKey(team!), { value: team!.value })).toBe('Ukloni filtar smjena: Smjena B');
    expect(t('filter.openCount', { count: model.activeCount })).toBe('Filtri · 1');
  });

  it('Kalendar, person: the Smjena chip is hidden, and the summary names their team', () => {
    // Matrix: pick Luka (A) with B chosen.
    const before = kalendar({ team: 'b', shownCount: 4 });
    const change = filterChoiceOf(before, FILTER_PERSON, 'luka');

    expect(change).toEqual({ smjena: null, osoba: 'luka' });

    const model = kalendar({ team: change.smjena, person: change.osoba, shownCount: 1 });

    expect(model.chips).toEqual([{ key: FILTER_PERSON, value: 'Luka Knežević' }]);
    expect(model.summary).toEqual({ kind: 'person', person: 'Luka Knežević', team: 'Smjena A' });
    expect(t(filterSummaryMessageKey(model.summary), filterSummaryValuesOf(model.summary))).toBe(
      'Prikazano: Luka Knežević · Smjena A',
    );
    const [person] = model.chips;

    expect(t(filterChipMessageKey(person!), { value: person!.value })).toBe('Osoba: Luka Knežević');
    expect(t(filterRemoveMessageKey(person!), { value: person!.value })).toBe('Ukloni filtar osoba: Luka Knežević');
  });

  it('Sati, both: the chips both show, and the summary joins them', () => {
    const model = sati({ team: 'b', person: 'luka', shownCount: 0 });

    expect(model.chips.map((chip) => chip.value)).toEqual(['Smjena B', 'Luka Knežević']);
    expect(model.summary).toEqual({ kind: 'both', team: 'Smjena B', person: 'Luka Knežević', shown: 0 });
    expect(model.activeCount).toBe(2);
    expect(t(filterSummaryMessageKey(model.summary), filterSummaryValuesOf(model.summary))).toBe(
      'Prikazano: Smjena B i Luka Knežević · 0 osoba',
    );
  });

  it('a person on no team reads `Bez smjene` as their team', () => {
    const { summary } = kalendar({ person: 'toni', shownCount: 1 });

    expect(summary).toEqual({ kind: 'person', person: 'Toni Bezsmjene', team: null });
    expect(t(filterSummaryMessageKey(summary), filterSummaryValuesOf(summary))).toBe(
      'Prikazano: Toni Bezsmjene · Bez smjene',
    );
    expect(t('filter.noTeam')).toBe('Bez smjene');
  });

  it('an unknown id is no filter: the chip reads `sve`', () => {
    // Matrix: `?smjena=nope`.
    const model = kalendar({ team: 'nope', person: 'nobody' });

    expect(model.team).toBeNull();
    expect(model.person).toBeNull();
    expect(model.chips.map((chip) => chip.value)).toEqual([null, null]);
    expect(model.activeCount).toBe(0);
  });

  it('counts in ICU plurals', () => {
    expect(t('filter.personCount', { count: 1 })).toBe('1 osoba');
    expect(t('filter.personCount', { count: 4 })).toBe('4 osobe');
    expect(t('filter.personCount', { count: 21 })).toBe('21 osoba');
    expect(t('filter.sheetShow', { count: 4 })).toBe('Prikaži 4 osobe');
    expect(t('filter.sheetShow', { count: 17 })).toBe('Prikaži 17 osoba');
    expect(t('filter.sheetShow', { count: 1 })).toBe('Prikaži 1 osobu');
    expect(t('filter.allTeams', { count: 4 })).toBe('Sve smjene (4)');
    expect(t('filter.matches', { shown: 1, total: 17 })).toBe('1 od 17');
    expect(t('filter.clear')).toBe('Poništi filtre');
  });
});

describe('what a press changes', () => {
  it('Kalendar: a team drops the person, a person drops the team, `sve` of a team drops both', () => {
    const withPerson = kalendar({ person: 'luka', shownCount: 1 });
    const withTeam = kalendar({ team: 'b', shownCount: 4 });

    expect(filterChoiceOf(withPerson, FILTER_TEAM, 'b')).toEqual({ smjena: 'b', osoba: null });
    expect(filterChoiceOf(withPerson, FILTER_TEAM, null)).toEqual({ smjena: null, osoba: null });
    expect(filterChoiceOf(withTeam, FILTER_PERSON, 'ana')).toEqual({ smjena: null, osoba: 'ana' });
    expect(filterChoiceOf(withTeam, FILTER_PERSON, null)).toEqual({ smjena: 'b', osoba: null });
  });

  it('Sati: the two combine, each choice keeping the other', () => {
    const both = sati({ team: 'b', person: 'luka', shownCount: 0 });

    expect(filterChoiceOf(both, FILTER_TEAM, 'a')).toEqual({ smjena: 'a', osoba: 'luka' });
    expect(filterChoiceOf(both, FILTER_PERSON, 'ana')).toEqual({ smjena: 'b', osoba: 'ana' });
    expect(filterChoiceOf(both, FILTER_TEAM, null)).toEqual({ smjena: null, osoba: 'luka' });
  });

  it("the phone sheet's Smjena radio reads the team, every team, or none while Kalendar shows a person", () => {
    expect(teamOptionOf(kalendar())).toBe(ALL_TEAMS_OPTION);
    expect(teamOptionOf(kalendar({ team: 'b', shownCount: 4 }))).toBe('b');
    expect(teamOptionOf(kalendar({ person: 'luka', shownCount: 1 }))).toBe(NO_TEAM_OPTION);
    expect(teamOptionOf(sati({ person: 'luka', shownCount: 1 }))).toBe(ALL_TEAMS_OPTION);
    expect(teamOptionChoiceOf(sati({ person: 'luka', shownCount: 1 }), 'b')).toEqual({ smjena: 'b', osoba: 'luka' });
    expect(teamOptionChoiceOf(sati({ team: 'b', shownCount: 4 }), ALL_TEAMS_OPTION)).toEqual({
      smjena: null,
      osoba: null,
    });
    expect(entersPickerList('ArrowDown')).toBe(true);
    expect(entersPickerList('Enter')).toBe(false);
  });

  it('✕ drops its own filter and keeps the other; Poništi filtre drops both', () => {
    // Matrix: ✕ on Smjena, Sati, both active.
    const both = sati({ team: 'b', person: 'luka', shownCount: 0 });

    expect(filterRemovalOf(both, FILTER_TEAM)).toEqual({ smjena: null, osoba: 'luka' });
    expect(filterRemovalOf(both, FILTER_PERSON)).toEqual({ smjena: 'b', osoba: null });
    expect(FILTERS_CLEARED).toEqual({ smjena: null, osoba: null });
  });
});

describe('the state a change leaves', () => {
  it('reads a change and a model alike, so the bar knows when the change has rendered', () => {
    const both = sati({ team: 'b', person: 'luka', shownCount: 0 });

    expect(modelStateKeyOf(both)).toBe(filterStateKeyOf({ smjena: 'b', osoba: 'luka' }));
    expect(modelStateKeyOf(kalendar())).toBe(filterStateKeyOf(FILTERS_CLEARED));
    expect(filterStateKeyOf({ smjena: 'b', osoba: null })).not.toBe(filterStateKeyOf({ smjena: null, osoba: 'b' }));
  });
});

describe('focus after a ✕', () => {
  it('moves to the next chip, or else to the first', () => {
    const both = sati({ team: 'b', person: 'luka', shownCount: 0 });

    expect(focusAfterRemovalOf(both, FILTER_TEAM)).toBe(FILTER_PERSON);
    expect(focusAfterRemovalOf(both, FILTER_PERSON)).toBe(FILTER_TEAM);
    // Kalendar: the person's chip is the only one; Smjena comes back first.
    expect(focusAfterRemovalOf(kalendar({ person: 'luka', shownCount: 1 }), FILTER_PERSON)).toBe(FILTER_TEAM);
    expect(focusAfterRemovalOf(kalendar({ team: 'b', shownCount: 4 }), FILTER_TEAM)).toBe(FILTER_PERSON);
  });
});

describe('the Osoba picker', () => {
  it('finds a name by any part, case and diacritics ignored', () => {
    expect(peopleMatching(PEOPLE, '')).toBe(PEOPLE);
    expect(peopleMatching(PEOPLE, '  ')).toBe(PEOPLE);
    expect(peopleMatching(PEOPLE, 'knezevic').map((person) => person.id)).toEqual(['luka']);
    expect(peopleMatching(PEOPLE, 'KNEŽ').map((person) => person.id)).toEqual(['luka']);
    // `đ` and `dj` read alike: Đuro is found by `Djuro`, `djuro` and `duro`.
    expect(peopleMatching([OLD], 'Djuro').map((person) => person.id)).toEqual(['old']);
    expect(peopleMatching([OLD], 'djuro').map((person) => person.id)).toEqual(['old']);
    expect(peopleMatching([OLD], 'duro').map((person) => person.id)).toEqual(['old']);
    expect(peopleMatching([OLD], 'đurić').map((person) => person.id)).toEqual(['old']);
    expect(peopleMatching(PEOPLE, 'zzz')).toEqual([]);
  });

  it('groups by team in the Smjena order, an archived team after them, Bez smjene last', () => {
    const groups = peopleGroupsOf([TONI, OLD, ANA, LUKA], TEAMS);

    expect(groups.map((group) => group.teamName)).toEqual(['Smjena A', 'Smjena B', 'Stara smjena', null]);
    expect(groups.map((group) => group.people.map((person) => person.id))).toEqual([['luka'], ['ana'], ['old'], ['toni']]);
    expect(peopleGroupsOf([], TEAMS)).toEqual([]);
  });

  it('moves through the list with ↑ ↓ Home End, stopping at the ends', () => {
    expect(pickerIndexAfter('ArrowDown', 0, 3)).toBe(1);
    expect(pickerIndexAfter('ArrowDown', 2, 3)).toBe(2);
    expect(pickerIndexAfter('ArrowUp', 0, 3)).toBe(0);
    expect(pickerIndexAfter('ArrowUp', 2, 3)).toBe(1);
    expect(pickerIndexAfter('Home', 2, 3)).toBe(0);
    expect(pickerIndexAfter('End', 0, 3)).toBe(2);
    expect(pickerIndexAfter('Enter', 0, 3)).toBeNull();
    expect(pickerIndexAfter('ArrowDown', 0, 0)).toBeNull();
  });
});

describe('the month in the locative', () => {
  it('reads all twelve, and refuses anything else', () => {
    expect(monthInMessageKey('2026-10')).toBe('filter.monthIn.10');
    expect(t(monthInMessageKey('2026-10'))).toBe('u listopadu');
    expect(t(monthInMessageKey('2026-01'))).toBe('u siječnju');
    expect(t(monthInMessageKey('2026-11'))).toBe('u studenome');
    for (let month = 1; month <= 12; month += 1) {
      const key = monthInMessageKey(`2026-${String(month).padStart(2, '0')}`);

      expect(t(key), key).toMatch(/^u \p{L}+$/u);
    }
    expect(() => monthInMessageKey('2026-13')).toThrow(RangeError);
    expect(() => monthInMessageKey('2026-1')).toThrow(RangeError);
    expect(yearOfMonthText('2026-10')).toBe('2026');
  });
});

describe('option chips count what is set and pass focus on after a removal (story 7.13)', () => {
  const chips = [
    { key: 'level', active: false },
    { key: 'team', active: true },
    { key: 'status', active: true },
  ];

  it('counts the set chips for Filtri · N', () => {
    expect(optionChipsActiveCount(chips)).toBe(2);
    expect(optionChipsActiveCount([])).toBe(0);
  });

  it('moves focus to the chip after the removed one, else to the first', () => {
    expect(focusAfterOptionRemovalOf(chips, 'level')).toBe('team');
    expect(focusAfterOptionRemovalOf(chips, 'team')).toBe('status');
    expect(focusAfterOptionRemovalOf(chips, 'status')).toBe('level');
    expect(focusAfterOptionRemovalOf([], 'status')).toBeNull();
  });

  it('opens the first picker from its left edge and every later one from its right', () => {
    expect(optionPickerAlignOf(chips, 'level')).toBe('start');
    expect(optionPickerAlignOf(chips, 'team')).toBe('end');
    expect(optionPickerAlignOf(chips, 'status')).toBe('end');
  });
});
