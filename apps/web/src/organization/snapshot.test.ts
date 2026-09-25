import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { formatDate, isRenderableTimeZone } from '@/i18n/format';
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
  type OrganizationFireRanksEdit,
  type OrganizationWrite,
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
/** Where the logo-or-mark decision lives since story 1.4c: one component, drawn
 *  by the settings surface AND by the navigation chrome. */
const LOCKUP = join(srcRoot, 'organization', 'lockup.tsx');
/** The one signed-URL read behind every lockup, shared by both surfaces. */
const LOGO_URL = join(srcRoot, 'organization', 'logo-url.ts');
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
  // Both fixtures are seeded logo-less, which is the fallback case (story
  // 1.4b): `logo_path` is nullable, carries no default, and null IS "no logo".
  logo_path: null,
  // And accent-less, which is the untinted shell (story 1.4c): `brand_accent`
  // is nullable with no default for the reason `0002:38-41` gives — a default
  // would encode one organization's answer for every tenant — and null IS "no
  // accent" rather than a missing value.
  brand_accent: null,
  // Member rank (`0014`): the pilot records fire ranks.
  uses_fire_ranks: true,
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
      logoPath: null,
      brandAccent: null,
      usesFireRanks: true,
    });
  });

  it('carries the fire-rank setting as the boolean it is, and refuses anything else', () => {
    // MEMBER RANK. The column is `not null`, so a missing or non-boolean value
    // is a row that is not an organization — never silently "off", which
    // would hide every stored rank behind a read fault.
    expect(organizationSnapshotOf({ ...PILOT_ROW, uses_fire_ranks: false })?.usesFireRanks).toBe(
      false,
    );
    for (const value of [undefined, null, 'true', 1]) {
      expect(organizationSnapshotOf({ ...PILOT_ROW, uses_fire_ranks: value })).toBeNull();
    }
  });

  it('admits the five nullable columns as null and no others', () => {
    // `short_name`, `description`, `address` and `contact_email` are nullable on
    // the table (`0002:73-81`), and `logo_path` joined them in `0005`;
    // everything else is `not null`. A mapper that
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
    expect(sparse?.logoPath, 'a missing logo reference is not the same as no column').toBeNull();
    expect(sparse?.brandAccent, 'a missing accent is not the same as no column').toBeNull();
  });

  it('carries the logo reference when there is one', () => {
    // The positive control the null case needs: a mapper that returned `null`
    // for every value would satisfy the assertion above and make the fallback
    // the only thing this screen can ever draw.
    const path = `${PILOT_ROW.id}/logo`;

    expect(organizationSnapshotOf({ ...PILOT_ROW, logo_path: path })?.logoPath).toBe(path);
  });

  it('carries the accent key when there is one, and never a colour', () => {
    // The positive control the null case needs, and a claim about the SHAPE of
    // the value: what the column holds is one of `0006`'s four curated keys, so
    // the mapper hands the accent on as the key it is. A colour would have to be
    // measured at runtime, and nothing in `apps/web/src` measures contrast.
    expect(organizationSnapshotOf({ ...PILOT_ROW, brand_accent: 'violet' })?.brandAccent).toBe(
      'violet',
    );
    // NOT NARROWED HERE. The row comes from a database whose constraint this
    // build cannot see, so a value a newer build wrote reaches the snapshot as
    // itself rather than blanking the whole organization; `brandAccentAppearance`
    // is what resolves it to the untinted shell at the point of use.
    expect(organizationSnapshotOf({ ...PILOT_ROW, brand_accent: 'teal' })?.brandAccent).toBe(
      'teal',
    );
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

  it('names every column a surface actually reads a value out of', () => {
    // ASSERTED AGAINST ITS CONTENT, not against itself. The case above compares
    // what went over the wire to the constant, so both sides move together and
    // deleting a column from the list is invisible — which is the shape the
    // 1.4c review demonstrated: drop `,brand_accent` and every write still
    // succeeds, every organization renders untinted, the accent control reads
    // `Neutralna` after any reload, and nothing at all fails.
    //
    // The two named here are the two that answer a QUESTION rather than fill a
    // field — is there a logo, is there an accent — so a screen that stops
    // selecting one degrades into a permanent "no" rather than into an error.
    // `id` is here because every write addresses the row by it.
    const columns = ORGANIZATION_COLUMNS.split(',');

    for (const column of ['id', 'logo_path', 'brand_accent', 'uses_fire_ranks']) {
      expect(columns, `the snapshot stops reading ${column}`).toContain(column);
    }
    // Spelled `snake_case`, because PostgREST speaks columns: a `camelCase`
    // entry is not an error anywhere — the row simply comes back without it.
    expect(
      columns.filter((column) => !/^[a-z][a-z0-9_]*$/.test(column)),
      'a selected column is not spelled the way the database spells one',
    ).toEqual([]);
    expect(new Set(columns).size, 'a column is selected twice').toBe(columns.length);
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

  it('sends the logo reference alone, and never beside the five fields', () => {
    // STORY 1.4b, and the whole of why the two writes are disjoint types: the
    // upload happens seconds after somebody starts typing in the name field,
    // and a logo write that also carried the five fields would save whatever
    // was half-typed — while a form submit that also carried `logo_path` would
    // overwrite a logo uploaded while it was being typed. Both are silent, and
    // both are PATCHes that report success.
    expect(organizationEditColumns({ logoPath: 'an-organization/logo' })).toEqual({
      logo_path: 'an-organization/logo',
    });

    const written = Object.keys(organizationEditColumns({ logoPath: 'an-organization/logo' }));

    expect(written, 'the logo write carries the form fields with it').toEqual(['logo_path']);
  });

  it('refuses a write that carries the five fields AND the logo reference', () => {
    // THE UNTAGGED-UNION HOLE, closed by `?: never` on both sides and asserted
    // by `@ts-expect-error` — which is itself executable, because an expectation
    // that stops being violated is a `pnpm typecheck` failure. Without the
    // exclusions such a value satisfies `OrganizationLogoEdit` structurally,
    // routes to the logo branch, and silently drops all five identity fields on
    // a save that reports success.
    // @ts-expect-error neither write may carry the other's fields, by construction
    const both: OrganizationWrite = { ...EDITS, logoPath: `${PILOT_ROW.id}/logo` };

    // And the runtime behaviour of the value the type system now refuses, so the
    // consequence is written down rather than left to be rediscovered.
    expect(Object.keys(organizationEditColumns(both))).toEqual(['logo_path']);
  });

  it('routes a logoPath of undefined to the identity write, not to the logo write', () => {
    // `'logoPath' in write` alone routed `{ …five, logoPath: undefined }` — the
    // shape a spread of a partial produces — to the logo branch, which writes
    // `logo_path: undefined`. PostgREST drops an undefined value, so that is a
    // PATCH with an empty body: it matches the row, changes nothing, and
    // reports success.
    const spread = { ...EDITS, logoPath: undefined } as OrganizationWrite;

    expect(organizationEditColumns(spread)).toEqual(organizationEditColumns(EDITS));
  });

  it('sends the accent alone, and never beside the five fields or the logo', () => {
    // STORY 1.4c, and the accent's case for a disjoint shape is the sharper of
    // the three: its control sits INSIDE the settings form, so a submit that
    // also carried `brand_accent` would overwrite a choice made while somebody
    // was typing, and an accent write that carried the five fields would push a
    // half-typed name the moment the picker was touched.
    expect(organizationEditColumns({ brandAccent: 'violet' })).toEqual({
      brand_accent: 'violet',
    });
    expect(
      Object.keys(organizationEditColumns({ brandAccent: 'violet' })),
      'the accent write carries something else with it',
    ).toEqual(['brand_accent']);
    expect(Object.keys(organizationEditColumns(EDITS))).not.toContain('brand_accent');
  });

  it('sends null as a VALUE, which is how an organization returns to no accent', () => {
    // MUTATION-PROVEN GAP. `isAccentEdit` guards on `!== undefined`, and a
    // one-character change to `!== null` routes "clear the accent" into the
    // IDENTITY branch — where `updateOrganization` then asks the timezone
    // validator about a zone the write does not carry and refuses it as
    // `ORGANIZATION_TIMEZONE_UNKNOWN`. A colour control reporting a timezone
    // problem, on the one write that takes an organization back to the untinted
    // shell.
    //
    // The key must also be PRESENT: PostgREST drops an undefined value, so a
    // branch that omitted it would send an empty PATCH that matches the row,
    // changes nothing, and reports success.
    const cleared = organizationEditColumns({ brandAccent: null });

    expect(Object.keys(cleared), 'clearing the accent sends no column at all').toEqual([
      'brand_accent',
    ]);
    expect(cleared['brand_accent'], 'the cleared accent is dropped rather than written').toBeNull();
  });

  it('routes a brandAccent of undefined to the identity write, not to the accent write', () => {
    // The same hole `logoPath: undefined` closes, and the same shape produces
    // it: a spread of a partial. `exactOptionalPropertyTypes` admits the value
    // at runtime, and `'brandAccent' in write` alone would route it to the
    // accent branch and write `brand_accent: undefined` — an empty PATCH that
    // reports success.
    const spread = { ...EDITS, brandAccent: undefined } as OrganizationWrite;

    expect(organizationEditColumns(spread)).toEqual(organizationEditColumns(EDITS));
  });

  it('refuses a write that carries the accent AND either of the other two', () => {
    // The untagged-union hole again, on both of the accent's neighbours. The
    // `?: never` members are what make "disjoint" a fact the compiler checks;
    // `@ts-expect-error` is itself executable, because an expectation that
    // stops being violated is a `pnpm typecheck` failure.
    // @ts-expect-error the accent write may not carry the identity fields
    const withFields: OrganizationWrite = { ...EDITS, brandAccent: 'violet' };
    // @ts-expect-error the accent write may not carry the logo reference
    const withLogo: OrganizationWrite = { logoPath: `${PILOT_ROW.id}/logo`, brandAccent: 'violet' };

    // And the runtime behaviour of the values the type system now refuses, so
    // the consequence is written down rather than left to be rediscovered:
    // each routes to WHICHEVER GUARD RUNS FIRST and silently drops the rest.
    // That order is not a decision worth defending — it is the reason the
    // combination is a `pnpm typecheck` failure at the call site, which is the
    // only place it can be fixed.
    expect(Object.keys(organizationEditColumns(withFields))).toEqual(['brand_accent']);
    expect(Object.keys(organizationEditColumns(withLogo))).toEqual(['logo_path']);
  });

  it('sends the fire-rank setting alone, as a fourth disjoint write', async () => {
    // MEMBER RANK. The switch saves the moment it changes, beside a form that
    // may hold half-typed fields, so it names its one column and nothing else.
    for (const value of [true, false]) {
      expect(organizationEditColumns({ usesFireRanks: value })).toEqual({
        uses_fire_ranks: value,
      });

      const log = recorder();
      const outcome = await updateOrganization(
        answering({ data: [PILOT_ROW], error: null }, log),
        PILOT_ROW.id,
        { usesFireRanks: value },
      );

      expect(outcome.ok, 'the setting write was refused by a check that does not apply').toBe(
        true,
      );
      expect(log.updated).toEqual([{ uses_fire_ranks: value }]);
    }
    expect(Object.keys(organizationEditColumns(EDITS))).not.toContain('uses_fire_ranks');

    // @ts-expect-error the setting write may not carry the identity fields
    const withFields: OrganizationWrite = { ...EDITS, usesFireRanks: true };
    // @ts-expect-error the setting write may not carry the accent
    const withAccent: OrganizationWrite = { brandAccent: 'violet', usesFireRanks: true };

    expect(withFields).toBeDefined();
    expect(withAccent).toBeDefined();
  });

  it('types the setting write apart from EVERY other snapshot field', () => {
    // The doc's claim, made executable: each `@ts-expect-error` below is a
    // `pnpm typecheck` failure the moment the field stops being excluded.
    const excluded: OrganizationFireRanksEdit[] = [
      // @ts-expect-error not the id
      { usesFireRanks: true, id: PILOT_ROW.id },
      // @ts-expect-error not the slug
      { usesFireRanks: true, slug: 'x' },
      // @ts-expect-error not the short name
      { usesFireRanks: true, shortName: 'x' },
      // @ts-expect-error not the description
      { usesFireRanks: true, description: 'x' },
      // @ts-expect-error not the address
      { usesFireRanks: true, address: 'x' },
      // @ts-expect-error not the contact address
      { usesFireRanks: true, contactEmail: 'x' },
      // @ts-expect-error not the locale
      { usesFireRanks: true, locale: 'x' },
      // @ts-expect-error not the type
      { usesFireRanks: true, organizationType: 'x' },
      // @ts-expect-error not the zone
      { usesFireRanks: true, timezone: 'x' },
      // @ts-expect-error not the leave year's month
      { usesFireRanks: true, leaveYearStartMonth: 1 },
      // @ts-expect-error not the leave year's day
      { usesFireRanks: true, leaveYearStartDay: 1 },
      // @ts-expect-error not the logo
      { usesFireRanks: true, logoPath: 'x' },
    ];
    const snapshotFields = Object.keys(organizationSnapshotOf(PILOT_ROW) ?? {}).filter(
      (field) => field !== 'usesFireRanks',
    );
    const covered = new Set([
      ...excluded.flatMap((write) => Object.keys(write)),
      // The identity fields and the accent are covered by the case above.
      'name',
      'brandAccent',
    ]);

    for (const field of snapshotFields) expect(covered, `${field} is not excluded`).toContain(field);
  });

  it('writes the accent without asking the timezone validator anything', async () => {
    // MUTATION-PROVEN GAP, and the second one-character regression this block
    // exists for: deleting `!isAccentEdit(write) &&` from the guard in
    // `updateOrganization` refuses EVERY accent write as
    // `ORGANIZATION_TIMEZONE_UNKNOWN`, because the accent write carries no zone
    // and `isRenderableTimeZone(undefined)` is false. Executed here rather than
    // read as source text, which is the only way a guard's polarity is a fact.
    for (const accent of ['violet', null] as const) {
      const log = recorder();
      const outcome = await updateOrganization(
        answering({ data: [PILOT_ROW], error: null }, log),
        PILOT_ROW.id,
        { brandAccent: accent },
      );

      expect(
        outcome.ok,
        `the accent write was refused by a check that does not apply (${String(accent)})`,
      ).toBe(true);
      expect(log.updated).toEqual([{ brand_accent: accent }]);
      expect(log.filtered).toEqual([{ column: 'id', value: PILOT_ROW.id }]);
      expect(log.selected, 'the accent write does not read the row back').toEqual([
        ORGANIZATION_COLUMNS,
      ]);
    }
  });

  it('pins what the timezone check answers for a write that carries no zone', () => {
    // THE ASSUMPTION THE GUARD'S SHAPE INVITES, and it is false. A reader — and
    // a reviewer — naturally expects `!isAccentEdit(write) &&` to be what stops
    // an accent write being refused as `ORGANIZATION_TIMEZONE_UNKNOWN`. It is
    // not: `isRenderableTimeZone` delegates to
    // `new Intl.DateTimeFormat(…, { timeZone })`, and `undefined` there means
    // "use the default" rather than "reject", so the check ANSWERS TRUE for a
    // write with no zone.
    //
    // Pinned rather than relied on. The guard is positive now
    // (`isIdentityEdit`), which is the readable shape and the one a fourth
    // write shape cannot fall through; this records why the version it replaces
    // was nonetheless not a live defect, so the next person to reason about it
    // reasons from a measurement rather than from the code's shape.
    expect(isRenderableTimeZone(undefined as unknown as string)).toBe(true);
    expect(isRenderableTimeZone('Europe/Zagrb')).toBe(false);
  });

  it('sends no logo reference when the form saves its five fields', () => {
    // The other direction of the same claim, which is the one the acceptance
    // criterion words as "saving identity cannot clobber a logo uploaded
    // seconds earlier".
    expect(Object.keys(organizationEditColumns(EDITS))).not.toContain('logo_path');
  });

  it('writes the logo reference without asking the timezone validator anything', async () => {
    // The timezone check is the identity write's, and running it against a
    // write that carries no zone at all would refuse every upload.
    const log = recorder();
    const outcome = await updateOrganization(
      answering({ data: [PILOT_ROW], error: null }, log),
      PILOT_ROW.id,
      { logoPath: `${PILOT_ROW.id}/logo` },
    );

    expect(outcome.ok, 'the logo write was refused by a check that does not apply').toBe(true);
    expect(log.updated).toEqual([{ logo_path: `${PILOT_ROW.id}/logo` }]);
    expect(log.filtered).toEqual([{ column: 'id', value: PILOT_ROW.id }]);
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
    expect(occurrences(screen, 'queryKey: ORGANIZATION_SNAPSHOT_KEY')).toBeGreaterThan(0);
    // TWO KEYS SINCE STORY 1.4b, and every one of them has to be the snapshot's
    // key or DERIVED from it. `organizationLogoKey` is asserted in
    // `logo.test.ts` to be the snapshot key with the path appended, so a key
    // written by hand here — the shape that drifts the moment one of the two
    // gains a qualifier — is what this refuses.
    expect(
      occurrences(screen, 'queryKey:'),
      'the screen names a query key that is neither the snapshot key nor derived from it',
    ).toBe(
      occurrences(screen, 'queryKey: ORGANIZATION_SNAPSHOT_KEY') +
        occurrences(screen, 'queryKey: organizationLogoKey('),
    );
  });

  it('reads the organization row exactly once, however many figures it draws', () => {
    // MUTATION THIS REFUSES: a second read of the same ROW for one more figure,
    // which is the ordinary way AD-13 gets broken — nothing fails, the screen
    // just shows two answers from two moments.
    //
    // The logo's signed URL is a second `useQuery` and deliberately not a second
    // snapshot: it is derived from a value the one read returned, keyed under
    // that read's key, and disabled entirely when there is no logo. So the
    // bound here is on `readOrganization`, which is the read of the row.
    const screen = source(SCREEN);

    expect(occurrences(screen, 'readOrganization('), 'the screen reads the row twice').toBe(1);
    // ONE `useQuery` ON THE SCREEN since story 1.4c: the derived logo URL moved
    // into `@/organization/logo-url`, which the navigation chrome shares — two
    // copies of it were two `queryFn`s registered for one key. The bound is
    // still that the ROW is read once here and the derived read is one hook
    // call, so a third query on this screen is the AD-13 violation it always
    // was.
    expect(occurrences(screen, 'useQuery('), 'the screen issues a second query').toBe(1);
    expect(
      occurrences(screen, 'useRenderableLogo('),
      'the screen fetches the signed URL more than once, or not through the shared hook',
    ).toBe(1);
  });

  it('never asks storage whether a logo exists, and never renders a broken image', () => {
    // PRESENCE IS A COLUMN, NOT A PROBE. `logo_path` is on the snapshot the
    // screen already holds, so the fallback is a pure read; the derived query
    // is `enabled` only when there is something to sign, so an organization
    // with no logo makes no storage call at all.
    // The `enabled` bound lives on the shared hook now, with the query it
    // guards; the SCREEN's half of the claim is that what it hands the hook is
    // the column rather than a probe.
    expect(source(LOGO_URL), 'the logo query runs even when there is no logo').toContain(
      'enabled: logoPath !== null',
    );
    expect(
      source(SCREEN),
      'the screen reads presence from somewhere other than the snapshot',
    ).toContain('organization.logoPath');
  });

  it('draws a neutral mark rather than announcing that there is no logo', () => {
    // The voice rule, as markup — and since story 1.4c this file's half of it is
    // about the SCREEN and nothing else. The mark, its accessible name and its
    // fallback moved into `@/organization/lockup` when the chrome started
    // drawing them too, and `routes/prijava.test.ts` owns that component's
    // internals: asserting them here as well was one claim written twice, in a
    // file whose subject is the snapshot module and the surface that reads it.
    //
    // What IS this file's claim is that the surface delegates rather than
    // keeping a copy: a second `role="img"` here would be a second answer to
    // "what does an organization with no logo look like", and copies drift.
    const screen = source(SCREEN);

    expect(screen, 'the settings surface does not draw the shared lockup').toContain(
      '<OrganizationLockup',
    );
    expect(
      screen,
      'the settings surface draws its own neutral mark beside the shared one',
    ).not.toContain('role="img"');
    expect(screen, 'the settings surface draws its own image beside the shared one').not.toContain(
      '<img',
    );
    // And it says nothing about the absence — no key for "there is no logo",
    // which `test/localization-applied.test.ts` also enforces by banning `Nema`
    // from every built chunk.
    expect(
      source(LOCKUP),
      'the lockup announces an absence instead of drawing a mark',
    ).not.toContain('logoMissing');
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
