/**
 * The organization snapshot: the first table read in the application, and the
 * shape every later surface copies (story 1.4a).
 *
 * ONE SNAPSHOT, ONE QUERY KEY (AD-13). The surface reads the organization once,
 * under {@link ORGANIZATION_SNAPSHOT_KEY}, and narrows by SELECTION from the one
 * canonical type below — it never issues a second read for a second figure.
 * That rule is the whole reason TanStack Query lands here rather than in a later
 * story: independent keys are precisely what put a stale total beside a fresh
 * one, and whatever shape the first data path takes is the shape the rest of the
 * application will imitate.
 *
 * THE TABLE IS A PARAMETER, never an import, exactly as `@/supabase/sign-in`
 * takes its auth client. That is what makes every row of this story's I/O matrix
 * executable from the node suite (AD-15) against a stub — no browser, no stack,
 * no environment — and it is also what keeps this module free of JSX so the node
 * suite collects it at all. The interfaces below are structural and narrow on
 * purpose: they name the two calls used and the two fields the mapping reads, so
 * `supabaseClient().from(ORGANIZATION_TABLE)` satisfies them and a stub does not
 * have to impersonate the rest of PostgREST.
 *
 * WHAT A REFUSAL LOOKS LIKE HERE IS NOT A THROW. Row level security refuses an
 * update by failing USING, which means the statement matches no row and
 * succeeds: PostgREST answers 204, or — with `select` appended, as below — an
 * empty array and no error. So the update asks for the written row BACK and
 * treats an empty answer as the refusal. Reading `error` alone would report
 * every refused save as a success, which is the exact shape
 * `test/rls-isolation.test.ts` warns about on `members`.
 *
 * Codes, never messages (the conventions): `{ code }` out of here, translated
 * only at the edge — `@/organization/messages` is that edge.
 */

import { isRenderableTimeZone } from '@/i18n/format';

/** The relation the surface reads and writes. Named here so no screen holds it. */
export const ORGANIZATION_TABLE = 'organizations';

/**
 * The single query key every figure on the settings surface comes from.
 *
 * A CONSTANT rather than an inline array at the call site, and that is the
 * enforcement rather than the convenience: two call sites writing
 * `['organization']` by hand are two keys the moment one of them gains a
 * qualifier, and AD-13's failure mode is precisely a screen reading the same
 * thing twice under keys that drifted apart.
 */
export const ORGANIZATION_SNAPSHOT_KEY = ['organization'] as const;

/**
 * The columns the snapshot is built from, in one place.
 *
 * `slug` is READ and never written: AD-12 builds every member's sign-in address
 * as `username@slug.shift.invalid`, so editing it would silently refuse every
 * existing credential in the organization. It is in the snapshot because the
 * organization genuinely has one; it is absent from {@link OrganizationEdits}
 * because no control may offer it.
 *
 * `created_at` is not here. It is the one `timestamptz` the conventions permit
 * and nothing renders it, so selecting it would be a column read for no reader.
 */
export const ORGANIZATION_COLUMNS =
  'id,slug,name,short_name,description,address,contact_email,organization_type,timezone,locale,leave_year_start_month,leave_year_start_day';

/**
 * The organization, as everything downstream sees it.
 *
 * `camelCase` values against the database's `snake_case` columns, which is the
 * conventions' rule and also the seam: the mapping below is the one place the
 * two spellings meet, so a renamed column is one edit rather than a search.
 */
export interface OrganizationSnapshot {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly shortName: string | null;
  readonly description: string | null;
  readonly address: string | null;
  readonly contactEmail: string | null;
  readonly organizationType: string;
  readonly timezone: string;
  readonly locale: string;
  readonly leaveYearStartMonth: number;
  readonly leaveYearStartDay: number;
}

/** The fields the settings surface may change. Deliberately not the row. */
export interface OrganizationEdits {
  readonly name: string;
  readonly organizationType: string;
  readonly timezone: string;
  readonly leaveYearStartMonth: number;
  readonly leaveYearStartDay: number;
}

/**
 * No row was reachable, or the write matched none — the policy's silent refusal.
 *
 * ONE CODE FOR BOTH DIRECTIONS, and the message is worded to be true of both:
 * a read that returns no row and a write that matches none are the same fact
 * from the caller's side — this session reaches no organization row it may act
 * on — and the database gives no signal that could tell them apart.
 */
export const ORGANIZATION_REFUSED = 'ORGANIZATION_REFUSED';
/** The `btrim(name) <> ''` check (`0002:72`) refused the value. */
export const ORGANIZATION_NAME_BLANK = 'ORGANIZATION_NAME_BLANK';
/** Some other shape on the table refused the value — a leave-year day out of range. */
export const ORGANIZATION_INVALID = 'ORGANIZATION_INVALID';
/** The entered zone is one no runtime can render in. See {@link isRenderableTimeZone}. */
export const ORGANIZATION_TIMEZONE_UNKNOWN = 'ORGANIZATION_TIMEZONE_UNKNOWN';
/** The service could not be reached, or answered with something that is not a row. */
export const ORGANIZATION_UNAVAILABLE = 'ORGANIZATION_UNAVAILABLE';

export type OrganizationFailure =
  | typeof ORGANIZATION_REFUSED
  | typeof ORGANIZATION_NAME_BLANK
  | typeof ORGANIZATION_INVALID
  | typeof ORGANIZATION_TIMEZONE_UNKNOWN
  | typeof ORGANIZATION_UNAVAILABLE;

export type OrganizationOutcome =
  | { readonly ok: true; readonly snapshot: OrganizationSnapshot }
  | { readonly ok: false; readonly code: OrganizationFailure };

/** As much of a PostgREST error as the mapping below reads. */
export interface PostgrestFailure {
  // `| undefined` spelled out on every member, for the reason
  // `@/supabase/sign-in`'s `AuthFailure` records: `exactOptionalPropertyTypes`
  // is on and postgrest-js declares these as present-and-possibly-undefined
  // rather than optional, so `code?: string` would not be a supertype of it.
  readonly code?: string | undefined;
  readonly message?: string | undefined;
  readonly details?: string | undefined;
}

/** What every call below resolves to, whichever verb produced it. */
export interface PostgrestAnswer {
  readonly data: readonly unknown[] | null;
  readonly error: PostgrestFailure | null;
}

/** The tail of the update chain: `.eq('id', …).select(…)`. */
export interface OrganizationUpdateFilter {
  eq(column: string, value: string): { select(columns: string): PromiseLike<PostgrestAnswer> };
}

/** The tail of the read chain. `limit` is the point: see {@link ONE_ROW}. */
export interface OrganizationSelectFilter {
  limit(count: number): PromiseLike<PostgrestAnswer>;
}

/** The two calls this module makes, named structurally so they can be stubbed. */
export interface OrganizationTable {
  select(columns: string): OrganizationSelectFilter;
  update(values: Readonly<Record<string, unknown>>): OrganizationUpdateFilter;
}

/** The column the row is addressed by. `id` IS the tenant on this table. */
const ID_COLUMN = 'id';

/**
 * How many rows an organization read may return.
 *
 * `organizations_select_own_organization` narrows to one row today, so this is
 * belt AND braces — and the braces are what matter, because the failure without
 * them is silent: a policy later loosened for some other reader would have this
 * module pick `rows[0]` and render an arbitrary tenant's row as THE
 * organization, with every figure on the screen internally consistent and wrong.
 * Asking for one row and refusing more than one turns that into a visible
 * failure instead.
 */
const ONE_ROW = 1;

/**
 * The SQLSTATE a check constraint raises, and the constraint that names `name`.
 *
 * The constraint name is PostgreSQL's own for a column-level check —
 * `<table>_<column>_check` — on `0002`'s `name text not null check (btrim(name)
 * <> '')`. Matching it is what lets the surface NAME THE FIELD rather than say
 * "something was wrong", which is what UX-DR34 asks for; every other check on
 * the table falls through to the general code, because a message that named the
 * wrong field would be worse than a general one.
 */
const CHECK_VIOLATION = '23514';
const NAME_CHECK_CONSTRAINT = 'organizations_name_check';

/** A PostgREST answer's rows, or an empty list — `null` data is not a row. */
function rowsOf(answer: PostgrestAnswer): readonly unknown[] {
  return answer.data ?? [];
}

function textAt(row: Record<string, unknown>, column: string): string | null {
  const value = row[column];

  return typeof value === 'string' ? value : null;
}

function numberAt(row: Record<string, unknown>, column: string): number | null {
  const value = row[column];

  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * One PostgREST row as the canonical snapshot, or `null` if it is not one.
 *
 * VALIDATED rather than cast, and the difference is what reaches a screen. A
 * cast makes `snapshot.timezone` a `string` the type system believes in and the
 * runtime may not — and `timezone` is the value every date and time on every
 * later surface renders against (L8), so `undefined` there formats in the
 * DEVICE's zone rather than failing. Every required column is checked; the four
 * nullable ones are admitted as `null`, which is what the columns actually are.
 */
export function organizationSnapshotOf(row: unknown): OrganizationSnapshot | null {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) return null;

  const fields = row as Record<string, unknown>;

  const id = textAt(fields, 'id');
  const slug = textAt(fields, 'slug');
  const name = textAt(fields, 'name');
  const organizationType = textAt(fields, 'organization_type');
  const timezone = textAt(fields, 'timezone');
  const locale = textAt(fields, 'locale');
  const leaveYearStartMonth = numberAt(fields, 'leave_year_start_month');
  const leaveYearStartDay = numberAt(fields, 'leave_year_start_day');

  if (
    id === null ||
    slug === null ||
    name === null ||
    organizationType === null ||
    timezone === null ||
    locale === null ||
    leaveYearStartMonth === null ||
    leaveYearStartDay === null
  ) {
    return null;
  }

  return {
    id,
    slug,
    name,
    shortName: textAt(fields, 'short_name'),
    description: textAt(fields, 'description'),
    address: textAt(fields, 'address'),
    contactEmail: textAt(fields, 'contact_email'),
    organizationType,
    timezone,
    locale,
    leaveYearStartMonth,
    leaveYearStartDay,
  };
}

/**
 * The zone every date and time renders in (L8, CAP-2).
 *
 * The organization is the frame, never the device — and until this story the
 * value had no source at all, so `format.ts`'s required `timeZone` argument was
 * satisfied by literals in tests and by nothing in the application. This is the
 * source. It is a function rather than a bare property read so there is ONE
 * place to look when a later surface asks "whose zone is this", and so the claim
 * is executable: a version returning a constant fails `snapshot.test.ts`.
 */
export function organizationTimeZone(snapshot: OrganizationSnapshot): string {
  return snapshot.timezone;
}

/**
 * The edits, spelled the way the columns are.
 *
 * Exported because the test executes it: the surface hands over `camelCase` and
 * PostgREST only understands `snake_case`, and a mis-spelled key is not a type
 * error anywhere — PostgREST answers 204 having updated nothing, which is
 * indistinguishable from a policy refusal.
 */
export function organizationEditColumns(
  edits: OrganizationEdits,
): Readonly<Record<string, unknown>> {
  return {
    name: edits.name,
    organization_type: edits.organizationType,
    timezone: edits.timezone,
    leave_year_start_month: edits.leaveYearStartMonth,
    leave_year_start_day: edits.leaveYearStartDay,
  };
}

/**
 * Which failure a PostgREST error is.
 *
 * A check violation is the value's problem and everything else is the
 * service's: a refused policy does not arrive here at all — it arrives as an
 * empty row set — so an `error` that is not a constraint is a transport or a
 * schema fault, and telling somebody their input was wrong for it would be
 * false in the direction that makes people retype correct values.
 */
function failureOf(error: PostgrestFailure): OrganizationFailure {
  if (error.code !== CHECK_VIOLATION) return ORGANIZATION_UNAVAILABLE;

  const named = `${error.message ?? ''} ${error.details ?? ''}`;

  return named.includes(NAME_CHECK_CONSTRAINT) ? ORGANIZATION_NAME_BLANK : ORGANIZATION_INVALID;
}

/**
 * One PostgREST answer as an outcome — the whole mapping, in one place.
 *
 * Shared by the read and the update rather than written twice, because the three
 * ways an answer can be wrong are the same three either way and they are easy to
 * get subtly different:
 *
 *   - AN ERROR is whatever `failureOf` says it is.
 *   - NO ROW is the policy's silent refusal. Row level security fails USING, the
 *     statement matches nothing and raises nothing, and that is the only signal
 *     a member-role session, a cross-tenant admin and a deactivated admin
 *     produce.
 *   - MORE THAN ONE ROW, or a row that is not an organization, is the SERVICE's
 *     fault and never the caller's. Reporting either as a refusal — which this
 *     module did until the 1.4a review — tells an entitled admin they lack a
 *     permission they hold, over a renamed column or a partial response. That is
 *     the "actionable and wrong" failure `failureOf` above argues against, and
 *     it is worse than a general message because it sends somebody to ask for
 *     rights instead of to report a fault.
 */
function outcomeOf(answer: PostgrestAnswer): OrganizationOutcome {
  if (answer.error !== null) return { ok: false, code: failureOf(answer.error) };

  const rows = rowsOf(answer);

  if (rows.length === 0) return { ok: false, code: ORGANIZATION_REFUSED };
  if (rows.length > ONE_ROW) return { ok: false, code: ORGANIZATION_UNAVAILABLE };

  const snapshot = organizationSnapshotOf(rows[0]);

  return snapshot === null
    ? { ok: false, code: ORGANIZATION_UNAVAILABLE }
    : { ok: true, snapshot };
}

/**
 * The organization this session reaches, or one stable code.
 *
 * NO ROW IS A REFUSAL, not an empty success. `organizations_select_own_
 * organization` returns zero rows to a session whose claim is missing, whose
 * account is banned, or whose member row is gone — every one of which is "this
 * session reaches no organization", and none of which raises. Returning an
 * absent snapshot instead would leave the surface rendering an empty form over
 * a row it cannot see.
 */
export async function readOrganization(table: OrganizationTable): Promise<OrganizationOutcome> {
  let answered;

  try {
    // `limit(ONE_ROW + 1)`, not `limit(1)`, and the extra row is the assertion:
    // asking for one and taking it would make a widened policy invisible, since
    // a truncated answer looks exactly like a correct one. Asking for two is how
    // "there was only one" becomes something this module can observe.
    answered = await table.select(ORGANIZATION_COLUMNS).limit(ONE_ROW + 1);
  } catch {
    // A rejected promise is the transport failing outside postgrest-js's own
    // error mapping — a blocked request, an aborted navigation, a DNS failure,
    // or `SUPABASE_ENVIRONMENT_MISSING` from a build with no environment.
    return { ok: false, code: ORGANIZATION_UNAVAILABLE };
  }

  return outcomeOf(answered);
}

/**
 * Writes the edited fields back, and answers with the row as it now stands.
 *
 * `.eq(ID_COLUMN, id)` is belt AND braces: the policy already refuses every row
 * but this session's own organization, and an unfiltered `update` would rely on
 * that alone — which is the one shape that turns a loosened policy into a write
 * across every tenant rather than into a refused statement.
 *
 * `select` is what makes the refusal visible, and the returned row is what makes
 * the caller's refetch honest: what comes back is what the database now holds,
 * including anything a default or a trigger changed, rather than what was sent.
 */
export async function updateOrganization(
  table: OrganizationTable,
  id: string,
  edits: OrganizationEdits,
): Promise<OrganizationOutcome> {
  // REFUSED BEFORE IT IS SENT, and this is the only validation in the system
  // that is not the database's. `0002:93` leaves `timezone` unchecked on purpose
  // — `pg_timezone_names` is not immutable and so cannot appear in a constraint
  // — which leaves the one value every later surface resolves against (L8)
  // checked nowhere at all. And the failure it produces is not a wrong date:
  // every zoned function in `@/i18n/format` THROWS `RangeError` on an unknown
  // zone, so `Europe/Zagrb` saved here takes down each screen that renders an
  // instant, long after the edit and nowhere near it.
  //
  // Asked of the runtime rather than matched against a pattern, and asked in
  // `format.ts` because that is the only file in `apps/web` permitted to touch
  // `Intl` at all.
  if (!isRenderableTimeZone(edits.timezone)) {
    return { ok: false, code: ORGANIZATION_TIMEZONE_UNKNOWN };
  }

  let answered;

  try {
    answered = await table
      .update(organizationEditColumns(edits))
      .eq(ID_COLUMN, id)
      .select(ORGANIZATION_COLUMNS);
  } catch {
    return { ok: false, code: ORGANIZATION_UNAVAILABLE };
  }

  // ZERO ROWS IS THE REFUSAL, and it is the only signal there is: a member-role
  // session, an admin naming another tenant, and a deactivated admin all reach
  // exactly this — the statement matched no row, raised nothing, and changed
  // nothing. Every one of them keeps what was typed, because the surface never
  // controlled the fields in the first place (UX-DR34).
  return outcomeOf(answered);
}
