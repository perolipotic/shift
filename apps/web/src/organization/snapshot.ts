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
import type { BrandAccentKey } from '@/organization/accent';

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
 * How long the organization row may be served from cache, in milliseconds.
 *
 * Here rather than at a call site because the navigation chrome reads this row
 * on EVERY signed-in screen (story 1.4c). Unbounded, TanStack Query treats every
 * mount and every window focus as a reason to refetch — so a person moving
 * between destinations re-reads the row for a border colour and a logo, all day.
 *
 * Five minutes: long enough that navigating is free, short enough that an
 * admin who renames the organization on one tab sees it on another without a
 * reload. It is a FLOOR on staleness rather than a cache: every write on the
 * settings surface invalidates this key explicitly, so a change made here shows
 * up immediately and this bound only governs changes made somewhere else.
 */
export const ORGANIZATION_READ_STALE_MS = 300000;

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
 *
 * `brand_accent` joined in story 1.4c and is the second column of that kind: it
 * holds a KEY — one of four curated words, or null — and never a colour, so the
 * contrast measurement stays in `test/theme-contrast.test.ts` where it already
 * is. `0006` argues the decision; `@/organization/accent` maps the key to what
 * the shell paints with.
 *
 * `logo_path` joined the list in story 1.4b, and it is the one column here that
 * exists to answer a question rather than to fill a field. Whether an
 * organization has a logo is a VALUE the snapshot carries, so the neutral
 * fallback is a pure read of data already on the client; without the column the
 * only way to ask would be a second network read behind the screen's one
 * figure, which is the shape AD-13 exists to prevent.
 *
 * `uses_fire_ranks` joined for member rank (`0014`). It is a setting that gates
 * DISPLAY AND ENTRY of a member's rank, read here because every surface that
 * shows or offers a rank already reads this one snapshot under this one key.
 */
export const ORGANIZATION_COLUMNS =
  'id,slug,name,short_name,description,address,contact_email,organization_type,timezone,locale,leave_year_start_month,leave_year_start_day,logo_path,brand_accent,uses_fire_ranks';

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
  /** Where the logo object lives, or `null` — which is what "no logo" IS. */
  readonly logoPath: string | null;
  /**
   * Which curated accent this organization chose, or `null` for none.
   *
   * `string | null` rather than the `BrandAccentKey` union, deliberately. This
   * type is what a ROW validates into, and the row comes from a database whose
   * constraint this build cannot see: narrowing here would mean either casting
   * (a type the runtime may not honour, which is the mistake
   * `organizationSnapshotOf` exists to refuse) or rejecting the whole snapshot
   * over one branding value, which would blank every screen in the application
   * for an organization whose accent a newer build wrote. The narrowing happens
   * at the point of USE instead — `brandAccentAppearance` resolves an unknown
   * key to the untinted shell.
   */
  readonly brandAccent: string | null;
  /**
   * Whether this organization records fire ranks (`0014`). It gates display
   * and entry only: off, no surface offers or shows a rank, and stored ranks
   * survive untouched.
   */
  readonly usesFireRanks: boolean;
}

/** The fields the settings FORM may change. Deliberately not the row. */
export interface OrganizationEdits {
  readonly name: string;
  readonly organizationType: string;
  readonly timezone: string;
  readonly leaveYearStartMonth: number;
  readonly leaveYearStartDay: number;
  /** Never here. See {@link OrganizationWrite} for why it is typed rather than said. */
  readonly logoPath?: never;
  /** Never here either, and for the same reason. */
  readonly brandAccent?: never;
  readonly usesFireRanks?: never;
}

/**
 * The logo reference, written on its own.
 *
 * A SEPARATE SHAPE rather than a sixth optional field on {@link
 * OrganizationEdits}, and the separation is the enforcement rather than the
 * tidiness: the two writes happen seconds apart and from different controls, so
 * a form submit that also carried `logo_path` would overwrite a logo uploaded
 * while the fields were being typed — silently, with a PATCH that reports
 * success. Disjoint types mean the form cannot send it and the upload cannot
 * send the fields, and neither is a rule anybody has to remember.
 */
export interface OrganizationLogoEdit {
  readonly logoPath: string;
  /** None of these, ever. See {@link OrganizationWrite}. */
  readonly name?: never;
  readonly organizationType?: never;
  readonly timezone?: never;
  readonly leaveYearStartMonth?: never;
  readonly leaveYearStartDay?: never;
  readonly brandAccent?: never;
  readonly usesFireRanks?: never;
}

/**
 * The accent, written on its own — a THIRD disjoint shape (story 1.4c).
 *
 * The argument {@link OrganizationLogoEdit} makes applies here unchanged and
 * one degree more sharply, because the accent control sits INSIDE the settings
 * form rather than beside it: a save that carried `brand_accent` would be a
 * save that can overwrite an accent chosen while the name was being typed, and
 * an accent write that carried the five fields would push a half-typed name to
 * the database the moment somebody opened the picker. Disjoint types mean
 * neither is expressible, and neither is a rule anybody has to remember.
 *
 * `string | null` rather than the key union, for the reason the snapshot's own
 * field is: the DATABASE decides which keys are admissible (`0006`), and a
 * write the interface cannot express is refused there — 23514, fails closed —
 * rather than by a second, softer gate here that could disagree with it.
 * `null` is a value this write can legitimately carry: it is how an
 * organization goes back to no accent at all.
 */
export interface OrganizationAccentEdit {
  /**
   * `BrandAccentKey | null`, NOT the column's own `string | null`.
   *
   * The two are deliberately different, and the direction is what decides
   * which. A READ is a value the database chose and this build may not know —
   * so {@link OrganizationSnapshot} keeps it wide, and an accent written by a
   * newer build reaches the client as itself rather than blanking the whole
   * organization. A WRITE is a value this build ORIGINATES, so there is no such
   * excuse: an accent the stylesheet has no token for is a mistake that can be
   * caught at `pnpm typecheck`, at the call site, for nothing.
   *
   * `null` is admitted because it is a real value rather than an absence: it is
   * how an organization returns to the untinted shell.
   */
  readonly brandAccent: BrandAccentKey | null;
  /** None of these, ever. See {@link OrganizationWrite}. */
  readonly name?: never;
  readonly organizationType?: never;
  readonly timezone?: never;
  readonly leaveYearStartMonth?: never;
  readonly leaveYearStartDay?: never;
  readonly logoPath?: never;
  readonly usesFireRanks?: never;
}

/**
 * The fire-rank setting, written on its own — a FOURTH disjoint shape.
 *
 * The accent's argument, unchanged: the switch saves the moment it changes,
 * beside a form that may hold half-typed fields, so a write that carried both
 * could push those fields or be overwritten by them. Disjoint types make
 * neither expressible.
 */
export interface OrganizationFireRanksEdit {
  readonly usesFireRanks: boolean;
  /**
   * None of these, ever — EVERY other field the snapshot carries, not only
   * the ones another write shape names. See {@link OrganizationWrite}.
   */
  readonly id?: never;
  readonly slug?: never;
  readonly shortName?: never;
  readonly description?: never;
  readonly address?: never;
  readonly contactEmail?: never;
  readonly locale?: never;
  readonly name?: never;
  readonly organizationType?: never;
  readonly timezone?: never;
  readonly leaveYearStartMonth?: never;
  readonly leaveYearStartDay?: never;
  readonly logoPath?: never;
  readonly brandAccent?: never;
}

/**
 * Either write, and NEITHER can be both.
 *
 * The `?: never` members on both sides are what make "disjoint" a fact the
 * compiler checks rather than a claim a comment makes. Without them a value
 * carrying the five fields AND a `logoPath` — from a spread, or from a variable
 * assembled elsewhere — satisfies `OrganizationLogoEdit` structurally, routes to
 * the logo branch of {@link organizationEditColumns}, and silently drops all
 * five identity fields on a save that reports success. With them such a value
 * is a `pnpm typecheck` failure at the call site, which is the only place it can
 * be fixed.
 */
export type OrganizationWrite =
  | OrganizationEdits
  | OrganizationLogoEdit
  | OrganizationAccentEdit
  | OrganizationFireRanksEdit;

/**
 * Which of the two a write is: the one that actually carries a logo path.
 *
 * `!== undefined` as well as `in`, because `exactOptionalPropertyTypes` still
 * admits `{ …five, logoPath: undefined }` at runtime from a spread of a partial
 * — and `'logoPath' in write` alone would route that to the logo branch and
 * write `logo_path = undefined`, which PostgREST drops, producing a PATCH with
 * an empty body that matches the row and changes nothing while reporting
 * success.
 */
function isLogoEdit(write: OrganizationWrite): write is OrganizationLogoEdit {
  return 'logoPath' in write && write.logoPath !== undefined;
}

/**
 * Which of the three a write is: the one that carries an accent.
 *
 * `!== undefined` rather than `!== null`, and the distinction is the whole
 * value of this predicate. `null` is a MEANINGFUL accent — it is how an
 * organization returns to the untinted shell — so a guard written `!= null`
 * would route "clear the accent" to the identity branch and send five form
 * fields the caller never typed. `undefined` is the only absence, and it is the
 * one `exactOptionalPropertyTypes` still admits at runtime from a spread of a
 * partial.
 */
function isAccentEdit(write: OrganizationWrite): write is OrganizationAccentEdit {
  return 'brandAccent' in write && write.brandAccent !== undefined;
}

/** Which of the four a write is: the one that carries the fire-rank setting. */
function isFireRanksEdit(write: OrganizationWrite): write is OrganizationFireRanksEdit {
  return 'usesFireRanks' in write && typeof write.usesFireRanks === 'boolean';
}

/**
 * The identity write, recognised POSITIVELY rather than as "neither of the
 * other two".
 *
 * The guard in {@link updateOrganization} was a growing list of negations, and
 * a list of negations is a list somebody has to remember to grow: a fourth
 * write shape added to {@link OrganizationWrite} without a fourth `!isX(write)`
 * would have started silently refusing that write as
 * {@link ORGANIZATION_TIMEZONE_UNKNOWN} — a timezone message for something that
 * carries no zone. Asking whether this IS the write that has a timezone makes
 * the fourth shape simply not match, which is the failure direction that does
 * not lie to anybody.
 *
 * `!== undefined` for the reason its two siblings use it: `exactOptionalProperty
 * Types` still admits `{ …logoPath, name: undefined }` at runtime from a spread.
 *
 * WORTH KNOWING, because it is the opposite of what a reader assumes: the chain
 * of negations this replaces did NOT in fact refuse a zone-less write.
 * `isRenderableTimeZone` delegates to `new Intl.DateTimeFormat(…, { timeZone })`,
 * and `timeZone: undefined` means "use the default" rather than "reject", so it
 * answers `true` for a write that carries no zone at all. The old shape was
 * therefore harmless AND unreadable: it looked like a guard that would refuse
 * the accent write and was not one. `snapshot.test.ts` pins that behaviour, so
 * nobody builds on the assumption in either direction.
 */
function isIdentityEdit(write: OrganizationWrite): write is OrganizationEdits {
  return 'name' in write && write.name !== undefined;
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
  const usesFireRanks = fields['uses_fire_ranks'];

  if (
    typeof usesFireRanks !== 'boolean' ||
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
    logoPath: textAt(fields, 'logo_path'),
    brandAccent: textAt(fields, 'brand_accent'),
    usesFireRanks,
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
  write: OrganizationWrite,
): Readonly<Record<string, unknown>> {
  // ONE COLUMN, AND ONLY THAT COLUMN, on the logo path. The write that follows
  // an upload names `logo_path` and nothing else, so an identity save that was
  // typed but not yet submitted is not part of it, and neither is the reverse.
  if (isLogoEdit(write)) return { logo_path: write.logoPath };

  // ONE COLUMN AGAIN on the accent, and `null` is a value rather than an
  // omission: PostgREST sends JSON `null` for it, which is the write that
  // clears the accent. Dropping the key instead would produce a PATCH with an
  // empty body that matches the row, changes nothing, and reports success.
  if (isAccentEdit(write)) return { brand_accent: write.brandAccent };

  // ONE COLUMN on the fire-rank setting, for the same reason.
  if (isFireRanksEdit(write)) return { uses_fire_ranks: write.usesFireRanks };

  if (isIdentityEdit(write)) {
    return {
      name: write.name,
      organization_type: write.organizationType,
      timezone: write.timezone,
      leave_year_start_month: write.leaveYearStartMonth,
      leave_year_start_day: write.leaveYearStartDay,
    };
  }

  // EXHAUSTIVE, and `never` is what makes it so — the idiom
  // `@/organization/messages` records. Written as a fall-through, a FOURTH
  // write shape added to `OrganizationWrite` would have been mapped as an
  // identity write and sent five columns it does not have, which PostgREST
  // drops: an empty PATCH that matches the row, changes nothing, and reports
  // success. Assigning to `never` turns that into a `pnpm typecheck` failure
  // here, at the one place the new shape has to be taught.
  const unhandled: never = write;

  return unhandled;
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
  write: OrganizationWrite,
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
  //
  // Asked of the IDENTITY write only, and asked POSITIVELY. Neither the logo
  // write nor the accent write carries a zone at all, so there is nothing to
  // check and nothing to refuse — and this guard was a chain of negations until
  // the 1.4c review, which is a shape that refuses a write nobody remembered to
  // exempt. `isIdentityEdit` asks whether this is the write that HAS a zone, so
  // a shape it does not recognise is simply not asked.
  if (isIdentityEdit(write) && !isRenderableTimeZone(write.timezone)) {
    return { ok: false, code: ORGANIZATION_TIMEZONE_UNKNOWN };
  }

  let answered;

  try {
    answered = await table
      .update(organizationEditColumns(write))
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
