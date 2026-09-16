import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { formatDate } from '@/i18n/format';
import { organizationMessageKey } from '@/organization/messages';
import {
  ORGANIZATION_COLUMNS,
  ORGANIZATION_INVALID,
  ORGANIZATION_NAME_BLANK,
  ORGANIZATION_REFUSED,
  ORGANIZATION_SNAPSHOT_KEY,
  ORGANIZATION_TABLE,
  ORGANIZATION_TIMEZONE_UNKNOWN,
  ORGANIZATION_UNAVAILABLE,
  organizationEditColumns,
  organizationSnapshotOf,
  organizationTimeZone,
  readOrganization,
  updateOrganization,
  type OrganizationEdits,
  type OrganizationFailure,
  type OrganizationTable,
  type PostgrestAnswer,
} from '@/organization/snapshot';

/**
 * The story's I/O matrix, executed (story 1.4a).
 *
 * AD-15 bans jsdom and `apps/web/vitest.config.ts` collects `src/**\/*.test.ts`
 * only, so nothing here renders anything. It does not have to: the table is a
 * PARAMETER (`@/supabase/sign-in` set the shape), so every row of the matrix
 * runs against a stub with nothing running — no stack, no environment, no
 * network — and the two claims that cannot be executed at all, the provider
 * wiring and the single-read rule, are read off the source instead.
 *
 * THE CLAIM THAT MATTERS IS THE SILENT ONE. Row level security refuses an
 * update by failing USING, so the statement matches no row and SUCCEEDS: the
 * answer carries no error at all. A mapping that read `error` alone would report
 * every refused save as saved — the member-role case, the cross-tenant case and
 * the deactivated-admin case all at once — so the empty-row-set case is asserted
 * on its own and again per refusal.
 */

const srcRoot = fileURLToPath(new URL('..', import.meta.url));
const SCREEN = join(srcRoot, 'routes', 'organizacija.tsx');
const ENTRY = join(srcRoot, 'main.tsx');

const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
/** `//` to end of line. The leading class keeps `https://` inside a string
 *  intact — the two-pass idiom from `test/key-hygiene.test.ts`. */
const LINE_SLASH = /(^|[\s;,{}()[\]])\/\/[^\n]*/g;

/** Comment-blind source: both files explain these rules in prose at length, and
 *  a comment-aware read would be satisfied by the explanation. */
function source(file: string): string {
  return readFileSync(file, 'utf8').replace(BLOCK_COMMENT, '').replace(LINE_SLASH, '$1');
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

// ----------------------------------------------------------------- the fixture

/** `supabase/seed.sql:44-60` — the pilot organization, as PostgREST returns it. */
const PILOT_ROW = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'dvd-kastel-novi',
  name: 'DVD Kaštel Novi',
  short_name: 'DVD Kaštel Novi',
  description: 'Dobrovoljno vatrogasno društvo.',
  address: 'Trg braće Radić 1, Kaštel Novi',
  contact_email: 'kontakt@dvd-kastel-novi.example.com',
  organization_type: 'Fire Department',
  timezone: 'Europe/Zagreb',
  locale: 'hr',
  leave_year_start_month: 1,
  leave_year_start_day: 1,
};

const EDITS: OrganizationEdits = {
  name: 'DVD Kaštel Novi',
  organizationType: 'Fire Department',
  timezone: 'Europe/Zagreb',
  leaveYearStartMonth: 4,
  leaveYearStartDay: 1,
};

/** What the seed's row maps to. Built through the mapper, so one drift fails
 *  loudly rather than being asserted twice in two spellings. */
function pilotSnapshot(): NonNullable<ReturnType<typeof organizationSnapshotOf>> {
  const mapped = organizationSnapshotOf(PILOT_ROW);
  if (mapped === null) throw new Error('the fixture row is not a snapshot');

  return mapped;
}

/** Every call recorded, so what went over the wire is assertable. */
interface Recorded {
  readonly selected: string[];
  readonly limited: number[];
  readonly updated: Readonly<Record<string, unknown>>[];
  readonly filtered: { column: string; value: string }[];
}

function recorder(): Recorded {
  return { selected: [], limited: [], updated: [], filtered: [] };
}

/** A table that answers with whatever PostgREST would have answered. */
function answering(answer: PostgrestAnswer, log: Recorded = recorder()): OrganizationTable {
  return {
    select: (columns) => {
      log.selected.push(columns);

      return {
        limit: (count) => {
          log.limited.push(count);

          return Promise.resolve(answer);
        },
      };
    },
    update: (values) => {
      log.updated.push(values);

      return {
        eq: (column, value) => {
          log.filtered.push({ column, value });

          return {
            select: (columns) => {
              log.selected.push(columns);

              return Promise.resolve(answer);
            },
          };
        },
      };
    },
  };
}

/** A table whose call never completes — the offline case, and the one a build
 *  with no environment produces when `supabaseClient()` throws. */
function throwing(): OrganizationTable {
  const reject = (): Promise<PostgrestAnswer> =>
    Promise.reject(new TypeError('Failed to fetch'));

  return {
    select: () => ({ limit: reject }),
    update: () => ({ eq: () => ({ select: reject }) }),
  };
}

/** The refusal shapes PostgREST reports, verbatim in shape. */
const BLANK_NAME: PostgrestAnswer = {
  data: null,
  error: {
    code: '23514',
    message:
      'new row for relation "organizations" violates check constraint "organizations_name_check"',
    details: 'Failing row contains (…).',
  },
};
const LEAVE_DAY_OUT_OF_RANGE: PostgrestAnswer = {
  data: null,
  error: {
    code: '23514',
    message:
      'new row for relation "organizations" violates check constraint "organizations_leave_year_start_day_check"',
    details: 'Failing row contains (…).',
  },
};
const SERVICE_FAILED: PostgrestAnswer = {
  data: null,
  error: { code: '57014', message: 'canceling statement due to statement timeout' },
};
/** What a policy refusal looks like: no error, and no row. */
const NO_ROW_MATCHED: PostgrestAnswer = { data: [], error: null };

// ---------------------------------------------------------------- the mapping

describe('one PostgREST row becomes the canonical snapshot', () => {
  it('maps every column, snake_case to camelCase', () => {
    expect(organizationSnapshotOf(PILOT_ROW)).toEqual({
      id: PILOT_ROW.id,
      slug: 'dvd-kastel-novi',
      name: 'DVD Kaštel Novi',
      shortName: 'DVD Kaštel Novi',
      description: 'Dobrovoljno vatrogasno društvo.',
      address: 'Trg braće Radić 1, Kaštel Novi',
      contactEmail: 'kontakt@dvd-kastel-novi.example.com',
      organizationType: 'Fire Department',
      timezone: 'Europe/Zagreb',
      locale: 'hr',
      leaveYearStartMonth: 1,
      leaveYearStartDay: 1,
    });
  });

  it('admits the four nullable columns as null and no others', () => {
    // `short_name`, `description`, `address` and `contact_email` are nullable on
    // the table (`0002:73-81`); everything else is `not null`. A mapper that
    // admitted a missing `timezone` would hand L8 an `undefined` zone, which
    // `Intl` resolves to the DEVICE's — the exact defect the required argument
    // in `format.ts` exists to make impossible.
    const sparse = organizationSnapshotOf({
      ...PILOT_ROW,
      short_name: null,
      description: null,
      address: null,
      contact_email: null,
    });

    expect(sparse?.shortName).toBeNull();
    expect(sparse?.description).toBeNull();
    expect(sparse?.address).toBeNull();
    expect(sparse?.contactEmail).toBeNull();
  });

  it.each([
    'id',
    'slug',
    'name',
    'organization_type',
    'timezone',
    'locale',
    'leave_year_start_month',
    'leave_year_start_day',
  ])('refuses a row missing %s rather than casting it', (column) => {
    const partial: Record<string, unknown> = { ...PILOT_ROW };
    delete partial[column];

    expect(organizationSnapshotOf(partial)).toBeNull();
  });

  it('refuses anything that is not a row at all', () => {
    // The vacuous half: a mapper returning a snapshot for `undefined` would make
    // "no row is a refusal" unreachable, since there would always be a row.
    expect(organizationSnapshotOf(undefined)).toBeNull();
    expect(organizationSnapshotOf(null)).toBeNull();
    expect(organizationSnapshotOf([PILOT_ROW])).toBeNull();
    expect(organizationSnapshotOf('organizations')).toBeNull();
  });
});

// ------------------------------------------------------------------- the read

describe('the read returns one snapshot or one code', () => {
  it('returns the organization the session reaches', async () => {
    const outcome = await readOrganization(answering({ data: [PILOT_ROW], error: null }));

    expect(outcome).toEqual({ ok: true, snapshot: pilotSnapshot() });
  });

  it('asks for exactly the canonical columns, once', async () => {
    // ONE READ, and the columns named in one place. A screen that selected its
    // own subset would be the second source of truth AD-13 forbids.
    const log = recorder();
    await readOrganization(answering({ data: [PILOT_ROW], error: null }, log));

    expect(log.selected).toEqual([ORGANIZATION_COLUMNS]);
  });

  it('asks for two rows, so that there being one is something it can observe', async () => {
    // Not `limit(1)`. Truncating to one row makes a widened policy invisible,
    // because a truncated answer is byte-identical to a correct one — so the
    // read asks for two and refuses the second, which is how "there was only
    // one" becomes a fact rather than an assumption.
    const log = recorder();
    await readOrganization(answering({ data: [PILOT_ROW], error: null }, log));

    expect(log.limited, 'the read does not bound the number of rows at all').toEqual([2]);
  });

  it('refuses two rows rather than rendering an arbitrary one as THE organization', async () => {
    // The select policy narrows to one row today. If it ever widens, picking
    // `rows[0]` would render another tenant's row with every figure on screen
    // internally consistent and wrong — a silent failure, and the worst kind.
    // It is the SERVICE's fault, not the caller's, so it is not a refusal.
    const second = { ...PILOT_ROW, id: '22222222-2222-4222-8222-222222222222' };

    expect(await readOrganization(answering({ data: [PILOT_ROW, second], error: null }))).toEqual({
      ok: false,
      code: ORGANIZATION_UNAVAILABLE,
    });
  });

  it('reports a row it cannot map as the service, never as a refusal', async () => {
    // A renamed column, a partial response, schema drift. Reported as
    // `ORGANIZATION_REFUSED` — which it was until the 1.4a review — this tells
    // an entitled admin they lack a permission they hold, and sends them to ask
    // for rights instead of to report a fault. That is the "actionable and
    // wrong" failure the module's own mapping argues against.
    expect(await readOrganization(answering({ data: [{ id: 1 }], error: null }))).toEqual({
      ok: false,
      code: ORGANIZATION_UNAVAILABLE,
    });
  });

  it('reads a refusal out of an empty row set, which carries no error', async () => {
    // `organizations_select_own_organization` returns zero rows to a session
    // with no claim, a banned account, or no member row — and raises nothing at
    // all. Reported as absent data rather than as a refusal, the surface would
    // render an empty form over a row it cannot see.
    expect(await readOrganization(answering(NO_ROW_MATCHED))).toEqual({
      ok: false,
      code: ORGANIZATION_REFUSED,
    });
  });

  it('reads a refusal out of a null data field too', async () => {
    expect(await readOrganization(answering({ data: null, error: null }))).toEqual({
      ok: false,
      code: ORGANIZATION_REFUSED,
    });
  });

  it('reports a service failure as the service, never as the caller', async () => {
    expect(await readOrganization(answering(SERVICE_FAILED))).toEqual({
      ok: false,
      code: ORGANIZATION_UNAVAILABLE,
    });
  });

  it('reports a rejected call as the service', async () => {
    // `supabaseClient()` throws `SUPABASE_ENVIRONMENT_MISSING` on a build with
    // no environment, and that reaches here as a rejection.
    expect(await readOrganization(throwing())).toEqual({
      ok: false,
      code: ORGANIZATION_UNAVAILABLE,
    });
  });
});

// ----------------------------------------------------------------- the update

describe('the update writes the edited fields and answers with the row', () => {
  it('sends the five editable columns, spelled as the table spells them', () => {
    expect(organizationEditColumns(EDITS)).toEqual({
      name: 'DVD Kaštel Novi',
      organization_type: 'Fire Department',
      timezone: 'Europe/Zagreb',
      leave_year_start_month: 4,
      leave_year_start_day: 1,
    });
  });

  it('sends no slug and no locale, which no control may offer', () => {
    // AD-12 builds every sign-in address from the slug, so changing it would
    // refuse every issued credential; the locale is a hard-coded constant and a
    // control that changes nothing is a dead control. Neither is on the edits
    // type at all, so this asserts the mapping cannot reintroduce them.
    const written = Object.keys(organizationEditColumns(EDITS));

    expect(written).not.toContain('slug');
    expect(written).not.toContain('locale');
    expect(written).not.toContain('id');
  });

  it('addresses the row by id and reads the written row back', async () => {
    const log = recorder();
    await updateOrganization(
      answering({ data: [PILOT_ROW], error: null }, log),
      PILOT_ROW.id,
      EDITS,
    );

    expect(log.updated).toEqual([organizationEditColumns(EDITS)]);
    expect(log.filtered).toEqual([{ column: 'id', value: PILOT_ROW.id }]);
    expect(log.selected).toEqual([ORGANIZATION_COLUMNS]);
  });

  it('returns the row as the database now holds it', async () => {
    const outcome = await updateOrganization(
      answering({ data: [PILOT_ROW], error: null }),
      PILOT_ROW.id,
      EDITS,
    );

    expect(outcome).toEqual({ ok: true, snapshot: pilotSnapshot() });
  });

  it.each([
    ['a member-role session'],
    ['an admin naming another tenant'],
    ['a deactivated admin'],
  ])('refuses %s, which reaches here as no row and no error', async () => {
    // All three are the SAME answer, and that is the point rather than an
    // economy: row level security refuses an update by failing USING, so the
    // statement matches nothing and raises nothing. There is no signal here that
    // could tell them apart, and inventing one would be a claim the database
    // never made.
    expect(await updateOrganization(answering(NO_ROW_MATCHED), PILOT_ROW.id, EDITS)).toEqual({
      ok: false,
      code: ORGANIZATION_REFUSED,
    });
  });

  it('names the field when the blank-name check refuses the value', async () => {
    // UX-DR34: the refusal names the problem. `btrim(name) <> ''` is the shape
    // that refuses `'   '`, and its constraint carries the column's name.
    expect(await updateOrganization(answering(BLANK_NAME), PILOT_ROW.id, EDITS)).toEqual({
      ok: false,
      code: ORGANIZATION_NAME_BLANK,
    });
  });

  it('does not name the field when some other shape refuses the value', async () => {
    // A leave-year day of 30 is refused by `between 1 and 28`. Reporting it as a
    // blank name would be actionable and wrong, which is worse than general.
    expect(
      await updateOrganization(answering(LEAVE_DAY_OUT_OF_RANGE), PILOT_ROW.id, EDITS),
    ).toEqual({ ok: false, code: ORGANIZATION_INVALID });
  });

  it('reports every non-constraint error as the service', async () => {
    expect(await updateOrganization(answering(SERVICE_FAILED), PILOT_ROW.id, EDITS)).toEqual({
      ok: false,
      code: ORGANIZATION_UNAVAILABLE,
    });
  });

  it('reports a rejected call as the service', async () => {
    expect(await updateOrganization(throwing(), PILOT_ROW.id, EDITS)).toEqual({
      ok: false,
      code: ORGANIZATION_UNAVAILABLE,
    });
  });

  it('reports a written row it cannot map as the service, not as a refusal', async () => {
    // The shape between the two: an answer carrying a row that is not an
    // organization. Returning `ok: true` with a half-built snapshot is what
    // would put an `undefined` timezone into the rendering frame; returning a
    // REFUSAL — which it did until the 1.4a review — tells the admin who just
    // successfully wrote the row that they were not allowed to.
    expect(
      await updateOrganization(answering({ data: [{ id: 1 }], error: null }), PILOT_ROW.id, EDITS),
    ).toEqual({ ok: false, code: ORGANIZATION_UNAVAILABLE });
  });

  it.each(['Europe/Zagrb', 'not a zone', '', 'UTC+2'])(
    'refuses the timezone %s before it is written at all',
    async (timezone) => {
      // `0002:93` leaves the column unchecked on purpose — `pg_timezone_names`
      // is not immutable and cannot appear in a constraint — so this is the one
      // validation in the system that is not the database's, and it has to be:
      // every zoned function in `@/i18n/format` THROWS `RangeError` on an
      // unknown zone, so a typo saved here takes down each later screen that
      // renders an instant, far from the edit that caused it.
      const log = recorder();
      const outcome = await updateOrganization(
        answering({ data: [PILOT_ROW], error: null }, log),
        PILOT_ROW.id,
        { ...EDITS, timezone },
      );

      expect(outcome).toEqual({ ok: false, code: ORGANIZATION_TIMEZONE_UNKNOWN });
      // NOT WRITTEN, which is the half a code alone does not say: the refusal
      // has to happen before the request, or the row carries the bad value and
      // the message is an apology.
      expect(log.updated, 'the unknown zone reached the table anyway').toEqual([]);
    },
  );

  it('writes a zone the runtime can actually render in', async () => {
    // The positive control. A validator that refused everything would satisfy
    // every case above and make the surface unable to save at all.
    const log = recorder();
    const outcome = await updateOrganization(
      answering({ data: [PILOT_ROW], error: null }, log),
      PILOT_ROW.id,
      { ...EDITS, timezone: 'Pacific/Kiritimati' },
    );

    expect(outcome.ok).toBe(true);
    expect(log.updated[0]?.['timezone']).toBe('Pacific/Kiritimati');
  });
});

// ------------------------------------------------------- the rendering frame

describe('the organization is the frame every date renders in', () => {
  /**
   * L8 and CAP-2, at the seam this story owns.
   *
   * `format.test.ts` already proves the FORMATTER honours the zone it is given,
   * in a child process under `TZ=Pacific/Kiritimati`. What had no source until
   * now was the VALUE: `deferred-work.md` recorded "1.4 supplies the value,
   * tests pass a literal". So what is asserted here is that the value comes from
   * the snapshot — a version of `organizationTimeZone` returning a constant, or
   * a surface reaching for the device zone, changes the output below.
   */
  const INSTANT = new Date('2026-09-12T20:00:00Z');

  it('renders a date in the organization own zone', () => {
    expect(formatDate(INSTANT, organizationTimeZone(pilotSnapshot()))).toBe('12.09.2026');
  });

  it('follows the snapshot when the organization zone is a different one', () => {
    // The mutation this refuses: `organizationTimeZone` returning `'Europe/
    // Zagreb'`, or the constant the seed happens to carry. At this instant the
    // two zones disagree about the DATE, not merely the hour, so a constant
    // cannot pass both cases.
    const elsewhere = organizationSnapshotOf({ ...PILOT_ROW, timezone: 'Pacific/Kiritimati' });

    expect(elsewhere).not.toBeNull();
    expect(organizationTimeZone(pilotSnapshot())).toBe('Europe/Zagreb');
    expect(elsewhere === null ? '' : formatDate(INSTANT, organizationTimeZone(elsewhere))).toBe(
      '13.09.2026',
    );
  });

  it('produces byte-identical output for two organizations differing only in type', () => {
    // CAP-2: Organization Type is inert by contract. It is free text on the
    // table and nothing branches on it, so the rendering frame two organizations
    // produce is the same frame.
    const security = organizationSnapshotOf({ ...PILOT_ROW, organization_type: 'Security' });

    expect(security).not.toBeNull();
    expect(security === null ? '' : organizationTimeZone(security)).toBe(
      organizationTimeZone(pilotSnapshot()),
    );
    expect(security === null ? '' : formatDate(INSTANT, organizationTimeZone(security))).toBe(
      formatDate(INSTANT, organizationTimeZone(pilotSnapshot())),
    );
  });
});

// ---------------------------------------------------------------- the mapping

describe('every failure code has its own message key', () => {
  const CODES: OrganizationFailure[] = [
    ORGANIZATION_REFUSED,
    ORGANIZATION_NAME_BLANK,
    ORGANIZATION_INVALID,
    ORGANIZATION_TIMEZONE_UNKNOWN,
    ORGANIZATION_UNAVAILABLE,
  ];

  it.each(CODES)('maps %s to a key of its own', (code) => {
    expect(organizationMessageKey(code)).toMatch(/^organization\.error\./);
  });

  it('maps the four codes to four distinct keys', () => {
    // The mutation a per-code loop cannot see: a mapping that returned one key
    // for everything satisfies every case above while a refused save and an
    // outage say the same thing.
    expect(new Set(CODES.map(organizationMessageKey)).size).toBe(CODES.length);
  });

  it('pairs each code with the key that describes it', () => {
    // ORDER, which is what the swapped-branches mutation breaks. Executed here
    // because a `.tsx` is collected by nothing.
    expect(organizationMessageKey(ORGANIZATION_REFUSED)).toBe('organization.error.refused');
    expect(organizationMessageKey(ORGANIZATION_NAME_BLANK)).toBe('organization.error.name');
    expect(organizationMessageKey(ORGANIZATION_INVALID)).toBe('organization.error.invalid');
    expect(organizationMessageKey(ORGANIZATION_TIMEZONE_UNKNOWN)).toBe(
      'organization.error.timezone',
    );
    expect(organizationMessageKey(ORGANIZATION_UNAVAILABLE)).toBe(
      'organization.error.unavailable',
    );
  });
});

// --------------------------------------------------------- one snapshot, one key

describe('the surface reads once, under one key', () => {
  it('declares a single query key and uses that constant', () => {
    // AD-13. Two call sites writing `['organization']` by hand are two keys the
    // moment one of them gains a qualifier, and the failure is a stale figure
    // beside a fresh one rather than an error.
    const screen = source(SCREEN);

    expect(ORGANIZATION_SNAPSHOT_KEY).toEqual(['organization']);
    expect(occurrences(screen, 'queryKey:'), 'the screen names more query keys than one').toBe(
      occurrences(screen, 'queryKey: ORGANIZATION_SNAPSHOT_KEY'),
    );
    expect(occurrences(screen, 'queryKey:')).toBeGreaterThan(0);
  });

  it('issues exactly one read and no second one', () => {
    // MUTATION THIS REFUSES: a second `useQuery` for one more figure, which is
    // the ordinary way AD-13 gets broken — nothing fails, the screen just shows
    // two answers from two moments.
    const screen = source(SCREEN);

    expect(occurrences(screen, 'useQuery('), 'the screen issues more than one read').toBe(1);
    expect(occurrences(screen, 'readOrganization(')).toBe(1);
  });

  it('reaches the table through the snapshot module rather than naming it', () => {
    const screen = source(SCREEN);

    for (const required of [
      "from '@/organization/snapshot'",
      'supabaseClient().from(ORGANIZATION_TABLE)',
      'updateOrganization(',
    ]) {
      expect(screen, `the settings screen no longer reaches ${required}`).toContain(required);
    }
    expect(ORGANIZATION_TABLE).toBe('organizations');
    // The relation name is the snapshot module's, so a screen holding it as a
    // literal is a second place for it to drift.
    expect(screen, 'the screen names the relation itself').not.toContain("'organizations'");
  });

  it('offers no control over the slug and no control over the locale', () => {
    // The two "Never"s that are invisible in a diff: both are ordinary-looking
    // fields, and both break something far away — every issued credential, and
    // nothing at all, respectively.
    const screen = source(SCREEN);

    expect(screen, 'the settings screen offers a slug control').not.toContain('slug');
    expect(screen, 'the settings screen offers a locale control').not.toContain('locale');
  });

  it('refetches the snapshot after a save rather than trusting the form', () => {
    const screen = source(SCREEN);

    expect(screen, 'a successful save does not refetch the snapshot').toContain(
      'invalidateQueries({ queryKey: ORGANIZATION_SNAPSHOT_KEY })',
    );
  });
});

describe('the query cache is wired into the application, not merely installed', () => {
  /**
   * `main.tsx` is unreachable from the node suite — it mounts into a DOM AD-15
   * bans — so the provider is asserted at source level, the way
   * `test/localization-applied.test.ts` asserts the localization provider. The
   * failure this catches is total and silent in the type system: every
   * `useQuery` call throws at first render with no `QueryClientProvider` above
   * it, on the one screen in the application that reads data.
   */
  it('wraps the router in a QueryClientProvider', () => {
    const entry = source(ENTRY);

    expect(entry, 'main.tsx builds no query client').toContain('new QueryClient(');
    expect(entry, 'the provider does not receive the client').toMatch(
      /<QueryClientProvider client=\{queryClient\}>/,
    );
    expect(entry, 'the router is not inside the query provider').toMatch(
      /<QueryClientProvider[^>]*>\s*<RouterProvider/,
    );
  });

  it('keeps the cache inside the localization gate it must not outlive', () => {
    // The mount stays inside `if (await bootLocalization(initLocalization))`.
    // `test/localization-applied.test.ts` owns that claim; this is the narrower
    // one that adding the provider did not move the mount out of the gate.
    const entry = source(ENTRY);

    expect(entry).toMatch(
      /if\s*\(\s*await\s+bootLocalization\(initLocalization\)\s*\)\s*\{\s*createRoot\(/,
    );
    expect(entry.indexOf('new QueryClient(')).toBeLessThan(entry.indexOf('createRoot('));
  });
});

describe('the detectors read what they claim to read', () => {
  it('finds the two files it scans', () => {
    // Vacuous-pass guard: a renamed or moved file would make every "contains"
    // assertion above hold against nothing.
    expect(source(SCREEN).length).toBeGreaterThan(500);
    expect(source(ENTRY).length).toBeGreaterThan(200);
  });

  it('strips comments before scanning, in both syntaxes', () => {
    expect(source(SCREEN)).not.toContain('UX-DR34');
    expect(occurrences('aXbXc', 'X')).toBe(2);
    expect(occurrences('abc', 'X')).toBe(0);
  });
});
