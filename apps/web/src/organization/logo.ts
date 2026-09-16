/**
 * The organization logo's storage seam (story 1.4b).
 *
 * THE FIRST CALL TO SUPABASE STORAGE IN THE APPLICATION. Nothing reached
 * `.storage` before this file, so the shape it takes is the shape every later
 * asset path will copy — which is why it copies the two shapes that already
 * exist rather than inventing a third. The handle is a PARAMETER, exactly as
 * `@/supabase/sign-in` takes its auth client and `@/organization/snapshot`
 * takes its table, so every row of the story's I/O matrix executes in the node
 * suite (AD-15) against a stub with nothing running — no browser, no stack, no
 * environment. The interface below is structural and narrow on purpose: it
 * names the two calls used and the two fields the mapping reads, so
 * `supabaseClient().storage.from(ORGANIZATION_LOGO_BUCKET)` satisfies it and a
 * stub does not have to impersonate the rest of the storage API.
 *
 * WHERE THE REFUSALS ACTUALLY LIVE. Nothing here validates a file. The size
 * bound and the type allowlist are properties of the BUCKET (`0005`), and the
 * isolation rule is a policy on `storage.objects` — so a member-role session,
 * an admin of another tenant and an anonymous caller are refused by the
 * database and not by this module, which is the only reading of Q1 and Q2 that
 * survives somebody opening a terminal. What this module owes is that each
 * refusal arrives as its own stable code, so the surface can say something
 * true about it.
 *
 * Every shape below was measured against the running local stack rather than
 * assumed, because the storage service does not answer the way PostgREST does:
 * EVERY refusal arrives as HTTP 400, and the distinction lives in the body's
 * `statusCode` field — `413` for the size bound, `415` for the type allowlist,
 * `403` for a policy, `404` for an object this caller may not see. Reading the
 * HTTP status would collapse all four into one.
 *
 * Codes, never messages (the conventions): `{ code }` out of here, translated
 * only at the edge — `@/organization/messages` is that edge.
 */

import {
  ORGANIZATION_SNAPSHOT_KEY,
  updateOrganization,
  type OrganizationOutcome,
  type OrganizationSnapshot,
  type OrganizationTable,
} from '@/organization/snapshot';

/** The private bucket `0005` creates. Named here so no screen holds it. */
export const ORGANIZATION_LOGO_BUCKET = 'organization-logos';

/**
 * The object's name inside the organization's own folder.
 *
 * ONE KEY PER ORGANIZATION, which is what makes replacing a logo an upsert
 * rather than an accumulation: the matrix's "one object, never two" is a
 * consequence of the key being derived rather than generated, and a
 * content-hashed or timestamped name would leave every superseded logo in the
 * bucket with nothing left pointing at it.
 */
export const ORGANIZATION_LOGO_OBJECT = 'logo';

/** The bucket's own `file_size_limit`, in bytes (`0005`) — 2 MiB. */
export const ORGANIZATION_LOGO_MAX_BYTES = 2097152;

/** The bucket's own `allowed_mime_types` (`0005`). No SVG: it is a document. */
export const ORGANIZATION_LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

/**
 * The same three types as the file picker's `accept` hint.
 *
 * DERIVED rather than written twice. A hint that disagreed with the bucket
 * would either offer a type the upload then refuses, or hide one the bucket
 * accepts — and both are invisible in a diff because neither is an error
 * anywhere. It is also what keeps the literal out of the screen, where
 * `prijava.test.ts` forbids every string that is not a structural attribute.
 */
export const ORGANIZATION_LOGO_ACCEPT = ORGANIZATION_LOGO_TYPES.join(',');

/**
 * What a file input's value is set back to once a chosen file is handled.
 *
 * Here rather than written inline, and not for tidiness: a file input fires no
 * `change` event when the SAME file is chosen twice in a row, so without the
 * reset "try again with the same file after a refusal" silently does nothing —
 * the one retry a person is most likely to attempt. The screen it belongs to
 * may hold no string literal at all (`prijava.test.ts`), so the empty string
 * lives in the module that owns the upload.
 */
export const NO_FILE_CHOSEN = '';

/**
 * How long a signed read URL is good for, in seconds.
 *
 * The bucket is private, so a rendered logo is a signed URL and never a public
 * one — which means the URL is a capability with an expiry rather than an
 * address. An hour outlives any single visit to the settings screen without
 * being a link worth passing around.
 */
export const SIGNED_URL_SECONDS = 3600;

/**
 * How long a signed URL may be served from cache, in milliseconds.
 *
 * COMFORTABLY BELOW THE EXPIRY, and the gap is the whole point. A cached URL is
 * a capability with a deadline: cache it for as long as it is valid and the tab
 * left open across the boundary renders the browser's broken-image glyph, which
 * is precisely the state the acceptance criterion forbids. A quarter of the
 * expiry leaves three quarters of margin for a slow refetch, and the `<img>`
 * carries an `onError` fallback as the second line of defence — the URL can also
 * stop working for reasons no timer predicts.
 */
export const LOGO_URL_STALE_MS = (SIGNED_URL_SECONDS * 1000) / 4;

/**
 * The policy refused a WRITE: a member-role session, another tenant, or none.
 *
 * Write-side only, and that separation is a message rather than a taxonomy. The
 * refusal a person reads for this code says they need an administrator's rights
 * to CHANGE the logo — true of somebody who tried to, and false of a member who
 * merely could not see one. {@link LOGO_UNREADABLE} is the read's own code for
 * that reason.
 */
export const LOGO_REFUSED = 'LOGO_REFUSED';
/**
 * The object could not be read: hidden by policy, or not there at all.
 *
 * Never a claim about rights. The storage service answers `Object not found`
 * both to a caller whose SELECT policy hides the object and to one asking for
 * an object that was never written — measured against both — so this code says
 * only what is true of both: there is nothing to render, and the surface falls
 * back.
 */
export const LOGO_UNREADABLE = 'LOGO_UNREADABLE';
/** The bucket's `file_size_limit` refused the file. */
export const LOGO_TOO_LARGE = 'LOGO_TOO_LARGE';
/** The bucket's `allowed_mime_types` refused the file. */
export const LOGO_TYPE_UNSUPPORTED = 'LOGO_TYPE_UNSUPPORTED';
/** The service could not be reached, or answered with something that is not an object. */
export const LOGO_UNAVAILABLE = 'LOGO_UNAVAILABLE';

export type LogoFailure =
  | typeof LOGO_REFUSED
  | typeof LOGO_UNREADABLE
  | typeof LOGO_TOO_LARGE
  | typeof LOGO_TYPE_UNSUPPORTED
  | typeof LOGO_UNAVAILABLE;

export type LogoUploadOutcome =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly code: LogoFailure };

export type LogoUrlOutcome =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly code: LogoFailure };

/** As much of a `StorageError` as the mapping below reads. */
export interface StorageFailure {
  // `| undefined` spelled out on every member, for the reason
  // `@/supabase/sign-in`'s `AuthFailure` records: `exactOptionalPropertyTypes`
  // is on and storage-js declares these as present-and-possibly-undefined
  // rather than optional, so `status?: number` would not be a supertype of it.
  readonly status?: number | undefined;
  readonly statusCode?: string | undefined;
  readonly message?: string | undefined;
}

/** What an upload resolves to. `data` carries the written object, or nothing. */
export interface StorageUploadAnswer {
  readonly data: { readonly path: string } | null;
  readonly error: StorageFailure | null;
}

/** What signing a read resolves to. */
export interface StorageSignedUrlAnswer {
  readonly data: { readonly signedUrl: string } | null;
  readonly error: StorageFailure | null;
}

/** The options the upload sends. `upsert` is what makes a replacement one object. */
export interface StorageUploadOptions {
  readonly contentType: string;
  readonly upsert: boolean;
}

/** The two calls this module makes, named structurally so they can be stubbed. */
export interface LogoStorage {
  upload(
    path: string,
    file: Blob,
    options: StorageUploadOptions,
  ): PromiseLike<StorageUploadAnswer>;
  createSignedUrl(path: string, expiresIn: number): PromiseLike<StorageSignedUrlAnswer>;
}

/**
 * Where an organization's logo lives — its id, then the object.
 *
 * THE FOLDER IS THE ISOLATION. `0005`'s three policies all compare
 * `(storage.foldername(name))[1]` against the caller's tenant, so the first
 * segment is not a convention for tidiness: it is the value the database
 * authorizes against, and a path built any other way is an object nobody can
 * read. Built here rather than at the two call sites for that reason — the two
 * spellings would be one edit apart from disagreeing, and the failure is
 * silent.
 */
export function organizationLogoPath(organizationId: string): string {
  return `${organizationId}/${ORGANIZATION_LOGO_OBJECT}`;
}

/**
 * The query key the rendered logo is cached under.
 *
 * A DEPENDENT KEY, prefixed with the snapshot's own, and both halves of that
 * matter. It is dependent because the URL is derived FROM `logo_path` rather
 * than being a second independent answer to the question the snapshot already
 * answered — so AD-13's rule holds: two figures on the screen still come from
 * one read of the row. And it is PREFIXED because invalidating
 * {@link ORGANIZATION_SNAPSHOT_KEY} after a save must take the derived URL with
 * it; two unrelated keys would leave yesterday's logo beside today's row, which
 * is exactly the stale-beside-fresh failure AD-13 names.
 *
 * `logoPath` is part of the key rather than merely an input to the fetch, so a
 * logo replaced at a different path is a different cache entry rather than a
 * stale hit.
 */
export function organizationLogoKey(logoPath: string | null): readonly unknown[] {
  return [...ORGANIZATION_SNAPSHOT_KEY, ORGANIZATION_LOGO_OBJECT, logoPath];
}

/** The storage service's own code for a refusal, whichever field carries it. */
function statusOf(error: StorageFailure): string {
  const declared = error.statusCode;

  if (declared !== undefined && declared !== '') return declared;

  return error.status === undefined ? '' : String(error.status);
}

/**
 * Which failure a storage error is.
 *
 * FOUR CODES, and the partition is the point: too large, wrong type, refused
 * and unavailable are four different things for the person in front of the
 * screen to do next — shrink the file, export it differently, ask for the
 * rights, try again — so collapsing any two would cost an action.
 *
 * `404` is a REFUSAL and not an absence, and that is the one that looks wrong
 * at first. The storage service answers `Object not found` both to a caller
 * asking for an object that is not there and to one whose SELECT policy hides
 * it — verified live against both cases — so there is no signal here that could
 * tell them apart, and inventing one would be a claim the service never made.
 * It fails closed either way: the surface renders the neutral fallback.
 */
function logoFailureOf(error: StorageFailure, hidden: LogoFailure): LogoFailure {
  const status = statusOf(error);

  if (status === '413') return LOGO_TOO_LARGE;
  if (status === '415') return LOGO_TYPE_UNSUPPORTED;
  if (status === '403' || status === '404') return hidden;

  return LOGO_UNAVAILABLE;
}

/**
 * Whether a file can be sent at all, or the code that says why not.
 *
 * THE BUCKET IS STILL THE ENFORCEMENT POINT. `0005` carries `file_size_limit`
 * and `allowed_mime_types`, AD-9 leaves no server tier, and
 * `test/rls-isolation.test.ts` uploads an oversized file and a disallowed type
 * over the real transport to prove it — so nothing here is a gate. What it is
 * is a refusal that does not cost a 50 MB upload first: the answer is identical
 * either way, and the only difference is whether the bytes crossed the network
 * before the person read it.
 *
 * Read off the SAME exported constants the bucket was built from and the
 * picker's `accept` hint is derived from, so a bound that moves in `0005`
 * without moving here is a test failure rather than a client refusing what the
 * database would have accepted.
 */
function unsendable(file: Blob): LogoFailure | null {
  if (file.size > ORGANIZATION_LOGO_MAX_BYTES) return LOGO_TOO_LARGE;

  return ORGANIZATION_LOGO_TYPES.includes(file.type as (typeof ORGANIZATION_LOGO_TYPES)[number])
    ? null
    : LOGO_TYPE_UNSUPPORTED;
}

/**
 * Writes the chosen file to the organization's own folder, replacing what is
 * there.
 *
 * `upsert` is not a convenience. Without it the second upload is refused as a
 * duplicate — measured live, `409 KeyAlreadyExists` — so replacing a logo would
 * be a refusal the person has to read, and the only way to make it work would
 * be a second key per upload, which is how a bucket accumulates every logo an
 * organization ever had with nothing pointing at the old ones.
 *
 * `contentType` is the file's own. A `Blob` with no type at all makes the
 * storage service default to `text/plain`, which the bucket's allowlist then
 * refuses — the right answer, reached without this module deciding anything.
 *
 * The PATH IS DERIVED and never taken from the answer: what goes into
 * `organizations.logo_path` has to be the path the policies authorize, and the
 * answer is only asked to prove the write happened at all.
 */
export async function uploadOrganizationLogo(
  storage: LogoStorage,
  organizationId: string,
  file: Blob,
): Promise<LogoUploadOutcome> {
  const path = organizationLogoPath(organizationId);
  const refusable = unsendable(file);

  if (refusable !== null) return { ok: false, code: refusable };

  let answered;

  try {
    answered = await storage.upload(path, file, { contentType: file.type, upsert: true });
  } catch {
    // A rejected promise is the transport failing outside storage-js's own
    // error mapping — a blocked request, an aborted navigation, or
    // `SUPABASE_ENVIRONMENT_MISSING` from a build with no environment.
    return { ok: false, code: LOGO_UNAVAILABLE };
  }

  if (answered.error !== null) {
    return { ok: false, code: logoFailureOf(answered.error, LOGO_REFUSED) };
  }

  // AN ANSWER WITH NEITHER AN ERROR NOR AN OBJECT is the service's fault and
  // never the caller's. Reporting it as a refusal would tell an entitled admin
  // they lack a permission they hold, which is the "actionable and wrong"
  // failure `@/organization/snapshot` argues against at length. The read path
  // below maps the identical shape to the identical code, deliberately: the two
  // disagreed until review, and an answer carrying neither an error nor a
  // payload says the same thing about the service whichever call produced it.
  return answered.data === null ? { ok: false, code: LOGO_UNAVAILABLE } : { ok: true, path };
}

/**
 * A URL the browser may render the organization's logo from, or one code.
 *
 * NOT A SECOND SNAPSHOT (AD-13). The path this is asked for comes FROM the
 * snapshot the surface already holds, so this is a read derived from that one
 * read rather than an independent second answer to the same question — and
 * when `logo_path` is null it is never asked at all, because absence is a
 * column and not a probe.
 *
 * A REFERENCE IS NOT AN AUTHORIZATION. An admin can write any string into
 * their own `logo_path`, another tenant's included; the SELECT policy scopes by
 * folder, so the signing refuses, no URL is produced and no bytes are served.
 * That is why a path that resolves to nothing and a path that belongs to
 * somebody else reach the caller as the same code.
 */
export async function readOrganizationLogoUrl(
  storage: LogoStorage,
  logoPath: string,
): Promise<LogoUrlOutcome> {
  let answered;

  try {
    answered = await storage.createSignedUrl(logoPath, SIGNED_URL_SECONDS);
  } catch {
    return { ok: false, code: LOGO_UNAVAILABLE };
  }

  if (answered.error !== null) {
    return { ok: false, code: logoFailureOf(answered.error, LOGO_UNREADABLE) };
  }

  const signed = answered.data;

  // NO URL AND NO ERROR is the service answering nothing at all, and it is the
  // service's fault rather than the caller's — the same shape and the same code
  // the upload above uses. It still has to fail closed: handing an empty string
  // to an `<img>` is a request for the current page, which is the broken image
  // the matrix forbids.
  if (signed === null || signed.signedUrl === '') return { ok: false, code: LOGO_UNAVAILABLE };

  return { ok: true, url: signed.signedUrl };
}

/**
 * The whole of what choosing a file means: point the row at the key, then write
 * the object.
 *
 * ORCHESTRATION LIVES HERE RATHER THAN IN THE SCREEN, and that is the same
 * decision `signInMessageKey` and `organizationEditColumns` record. A `.tsx` is
 * collected by nothing (AD-15), so a sequence written there is read as source
 * text and never executed — and the mutation that shape permits is not subtle:
 * `uploadOrganizationLogo(storage, organization.slug, file)` typechecks, lints,
 * and leaves every assertion in the repository green while every upload is
 * refused 403 at runtime, because the folder the policies authorize is the id.
 * Taking the SNAPSHOT rather than an id is what removes the choice: there is
 * nothing to pass wrongly.
 *
 * THE ROW IS WRITTEN FIRST, and the order is the one that cannot strand an
 * object. Reversed — upload, then update — a refused or failed column write
 * after a successful upsert has already destroyed the previous logo and left an
 * object nothing references, permanently, because `0005` writes no DELETE
 * policy and no surface can reclaim it. In this order the column write is the
 * gate: if the caller may not write the row they may not write the object
 * either (the same claim and the same freshness check stand behind both), so a
 * refusal costs nothing at all. And because the key is FIXED per organization,
 * the value written is identical on every upload — so the column write is
 * idempotent, and an upload that then fails degrades into the matrix's own "a
 * reference that resolves to nothing -> neutral fallback" row rather than into
 * an orphan.
 *
 * The snapshot that comes back is the row as the database now holds it. The
 * caller still invalidates: the derived URL is keyed under the snapshot's key,
 * so one invalidation refreshes the row and the preview together.
 */
export async function replaceOrganizationLogo(
  storage: LogoStorage,
  table: OrganizationTable,
  organization: OrganizationSnapshot,
  file: Blob,
): Promise<OrganizationOutcome | { readonly ok: false; readonly code: LogoFailure }> {
  const path = organizationLogoPath(organization.id);

  // REFUSED BEFORE ANYTHING IS WRITTEN. `unsendable` is checked here as well as
  // inside the upload, because in this order the row write happens first: a
  // file the bucket would refuse must not move the column on its way to being
  // refused.
  const refusable = unsendable(file);

  if (refusable !== null) return { ok: false, code: refusable };

  const referenced = await updateOrganization(table, organization.id, { logoPath: path });

  if (!referenced.ok) return referenced;

  const written = await uploadOrganizationLogo(storage, organization.id, file);

  return written.ok ? referenced : { ok: false, code: written.code };
}

/**
 * The single character a neutral mark shows, or `null` when there is none.
 *
 * `[...name][0]` and not `name.slice(0, 1)`. `slice` counts UTF-16 code units,
 * so a name beginning with an astral character renders half a surrogate pair
 * and a name beginning with a decomposed `Č` renders a bare `C` with its caron
 * orphaned onto whatever follows — and Croatian diacritic coverage is an
 * explicit requirement of this project rather than a nicety. The spread
 * iterates code POINTS, which fixes the first and halves the second; the
 * remaining combining-mark case is why the value is normalized first.
 *
 * `null` for a name that is blank or whitespace only. `0002:72` makes that
 * unreachable from the database — `btrim(name) <> ''` is a check on the column
 * — but the mark's accessible name is the organization's name, and an empty
 * accessible name on a `role="img"` is an element a screen reader announces as
 * nothing at all. The caller substitutes a generic label.
 */
export function organizationLogoMark(name: string): string | null {
  const trimmed = name.normalize('NFC').trim();

  return trimmed === '' ? null : ([...trimmed][0] ?? null);
}
