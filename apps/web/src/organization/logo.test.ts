import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  LOGO_REFUSED,
  LOGO_TOO_LARGE,
  LOGO_TYPE_UNSUPPORTED,
  LOGO_UNAVAILABLE,
  LOGO_UNREADABLE,
  LOGO_URL_STALE_MS,
  NO_FILE_CHOSEN,
  ORGANIZATION_LOGO_ACCEPT,
  ORGANIZATION_LOGO_BUCKET,
  ORGANIZATION_LOGO_MAX_BYTES,
  ORGANIZATION_LOGO_OBJECT,
  ORGANIZATION_LOGO_TYPES,
  SIGNED_URL_SECONDS,
  organizationLogoKey,
  organizationLogoMark,
  organizationLogoPath,
  readOrganizationLogoUrl,
  replaceOrganizationLogo,
  uploadOrganizationLogo,
  type LogoFailure,
  type LogoStorage,
  type StorageSignedUrlAnswer,
  type StorageUploadAnswer,
  type StorageUploadOptions,
} from '@/organization/logo';
import { organizationMessageKey } from '@/organization/messages';
import {
  ORGANIZATION_REFUSED,
  ORGANIZATION_SNAPSHOT_KEY,
  organizationSnapshotOf,
  type OrganizationSnapshot,
  type OrganizationTable,
  type PostgrestAnswer,
} from '@/organization/snapshot';

/**
 * The story's I/O matrix, executed (story 1.4b).
 *
 * AD-15 bans jsdom and `apps/web/vitest.config.ts` collects `src/**\/*.test.ts`
 * only, so nothing here renders anything and nothing here reaches a stack. It
 * does not have to: the storage handle is a PARAMETER — the shape
 * `@/supabase/sign-in` set and `@/organization/snapshot` copied — so every row
 * of the matrix runs against a stub.
 *
 * WHAT THE STUB HAS TO IMPERSONATE, and the reason the shapes below are quoted
 * rather than invented: the storage service answers EVERY refusal with HTTP
 * 400, and the distinction lives in the body. A module that read the HTTP
 * status would map a file that is too large, a file of the wrong type, a
 * member-role session and another tenant's object onto one code — four
 * different things to do next collapsed into one. Each body below was measured
 * against the running local stack with `0005` applied, through the same HTTP
 * path the browser uses.
 */

const srcRoot = fileURLToPath(new URL('..', import.meta.url));
const RESOURCE = join(srcRoot, 'i18n', 'locales', 'hr.json');

/** One Croatian message by its dotted key, so a string and the constant it
 *  describes can be asserted against each other rather than by eye. */
function message(key: string): string {
  const resource: unknown = JSON.parse(readFileSync(RESOURCE, 'utf8'));

  return String(
    key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], resource),
  );
}

/** A fixture organization id. Any uuid; the point is the folder it becomes. */
const ORGANIZATION = '50d809c6-5112-42fe-81a3-2bf6889b5023';
const LOGO_PATH = `${ORGANIZATION}/${ORGANIZATION_LOGO_OBJECT}`;

/** Something with a size and a type, which is all `upload` is handed. */
function image(type = 'image/png'): Blob {
  return new Blob([new Uint8Array([137, 80, 78, 71])], { type });
}

/** Every call recorded, so what went over the wire is assertable. */
interface Recorded {
  readonly uploaded: { path: string; type: string; options: StorageUploadOptions }[];
  readonly signed: { path: string; expiresIn: number }[];
}

function recorder(): Recorded {
  return { uploaded: [], signed: [] };
}

/** A handle that answers with whatever the storage service would have answered. */
function answering(
  answers: {
    readonly upload?: StorageUploadAnswer;
    readonly signedUrl?: StorageSignedUrlAnswer;
  },
  log: Recorded = recorder(),
): LogoStorage {
  return {
    upload: (path, file, options) => {
      log.uploaded.push({ path, type: file.type, options });

      return Promise.resolve(answers.upload ?? WROTE_THE_OBJECT);
    },
    createSignedUrl: (path, expiresIn) => {
      log.signed.push({ path, expiresIn });

      return Promise.resolve(answers.signedUrl ?? SIGNED);
    },
  };
}

/** A handle whose call never completes — the offline case, and the one a build
 *  with no environment produces when `supabaseClient()` throws. */
function throwing(): LogoStorage {
  const reject = (): Promise<never> => Promise.reject(new TypeError('Failed to fetch'));

  return { upload: reject, createSignedUrl: reject };
}

// ------------------------------------------------- the answers, measured live

const WROTE_THE_OBJECT: StorageUploadAnswer = {
  data: { path: LOGO_PATH },
  error: null,
};
const SIGNED: StorageSignedUrlAnswer = {
  data: { signedUrl: `/object/sign/${ORGANIZATION_LOGO_BUCKET}/${LOGO_PATH}?token=signed` },
  error: null,
};
/** `403 AccessDenied` — what every policy refusal on `storage.objects` is. */
const POLICY_REFUSED: StorageUploadAnswer = {
  data: null,
  error: {
    status: 400,
    statusCode: '403',
    message: 'new row violates row-level security policy',
  },
};
/** `413 EntityTooLarge` — the bucket's `file_size_limit`. */
const TOO_LARGE: StorageUploadAnswer = {
  data: null,
  error: {
    status: 400,
    statusCode: '413',
    message: 'The object exceeded the maximum allowed size',
  },
};
/** `415 InvalidMimeType` — the bucket's `allowed_mime_types`. */
const WRONG_TYPE: StorageUploadAnswer = {
  data: null,
  error: {
    status: 400,
    statusCode: '415',
    message: 'mime type application/pdf is not supported',
  },
};
/** `404 NoSuchKey` — a cross-tenant read, an anonymous read, and a path that
 *  resolves to nothing, all three of them, indistinguishably. */
const NOT_VISIBLE: StorageSignedUrlAnswer = {
  data: null,
  error: { status: 400, statusCode: '404', message: 'Object not found' },
};
/** Something that is not a refusal at all: the service failing. */
const SERVICE_FAILED: StorageUploadAnswer = {
  data: null,
  error: { status: 500, statusCode: '500', message: 'Internal server error' },
};

// --------------------------------------------------------------- the constants

describe('the bucket this module writes to is the one the migration creates', () => {
  it('names the bucket, the object and the bound the migration declares', () => {
    // Three hand-written copies of each fact exist — `0005`, this module, and
    // the message that names the limit — so pinning them here is what makes a
    // migration that raises the bound and a module that does not a failure.
    expect(ORGANIZATION_LOGO_BUCKET).toBe('organization-logos');
    expect(ORGANIZATION_LOGO_OBJECT).toBe('logo');
    expect(ORGANIZATION_LOGO_MAX_BYTES).toBe(2097152);
    expect([...ORGANIZATION_LOGO_TYPES]).toEqual(['image/png', 'image/jpeg', 'image/webp']);
  });

  it('offers the file picker exactly the types the bucket accepts, and no SVG', () => {
    // DERIVED rather than written twice: a hint that offered a type the bucket
    // refuses is a refusal nobody could have predicted from the control.
    expect(ORGANIZATION_LOGO_ACCEPT.split(',')).toEqual([...ORGANIZATION_LOGO_TYPES]);
    expect(ORGANIZATION_LOGO_ACCEPT, 'an SVG is a document, not an image').not.toContain('svg');
  });

  it('signs a URL for a bounded time, and caches it for comfortably less', () => {
    // PINNED BY VALUE, both of them. `expiresIn > 0` passed for one second and
    // for one week, and the pair is what actually matters: a URL cached for as
    // long as it is valid renders the browser's broken-image glyph on the tab
    // left open across the boundary, which is the state the acceptance
    // criterion forbids.
    expect(SIGNED_URL_SECONDS).toBe(3600);
    expect(LOGO_URL_STALE_MS).toBe(900000);
    expect(
      LOGO_URL_STALE_MS,
      'a cached URL outlives the capability it carries',
    ).toBeLessThan(SIGNED_URL_SECONDS * 1000);
  });

  it('says the size bound the bucket actually carries, and says it in the right unit', () => {
    // TIED TO THE CONSTANT, so the message and the bucket cannot drift. The
    // string said "2 MB" for 2,097,152 bytes, which is 2 MiB — a decimal
    // megabyte is 1,000,000 — so a 2.0 MB file refused by a message promising
    // 2 MB is a person told the truth in a unit that makes it read as a lie.
    const mebibytes = ORGANIZATION_LOGO_MAX_BYTES / 1024 / 1024;

    expect(Number.isInteger(mebibytes), 'the bound is no longer a whole number of MiB').toBe(true);
    expect(
      message('organization.error.logoTooLarge'),
      'the refusal does not name the bound the bucket enforces',
    ).toContain(`${mebibytes} MiB`);
  });

  it('names every type the bucket accepts, and no type it does not', () => {
    // The other half of the same claim. A message listing a type the allowlist
    // refuses sends somebody to export a file that will be refused again.
    const named = message('organization.error.logoType').toLowerCase();

    for (const type of ORGANIZATION_LOGO_TYPES) {
      const subtype = type.split('/')[1] ?? '';

      expect(named, `${type} is accepted and the refusal does not name it`).toContain(subtype);
    }
    expect(named, 'the refusal names a type the bucket refuses').not.toContain('svg');
  });

  it('resets a file input to nothing, so the same file can be chosen twice', () => {
    // The retry a person is most likely to attempt after a refusal fires no
    // `change` event unless the control is cleared first.
    expect(NO_FILE_CHOSEN).toBe('');
  });
});

describe('an object lives in a folder named for its organization', () => {
  it('puts the organization id first, which is what every policy compares', () => {
    // `0005` scopes all three policies by `(storage.foldername(name))[1]`, so
    // the first segment is not tidiness: it is the value the database
    // authorizes against, and a path shaped any other way is unreachable.
    expect(organizationLogoPath(ORGANIZATION)).toBe(LOGO_PATH);
    expect(organizationLogoPath(ORGANIZATION).split('/')[0]).toBe(ORGANIZATION);
  });

  it('gives every organization its own folder and one key inside it', () => {
    // One key per organization is what makes a replacement an upsert rather
    // than an accumulation, and what makes the matrix's "one object, never two"
    // a property of the path instead of a hope about the caller.
    const other = '2081dadd-fb06-4326-a038-bfa16dcefb81';

    expect(organizationLogoPath(other)).not.toBe(organizationLogoPath(ORGANIZATION));
    expect(organizationLogoPath(ORGANIZATION)).toBe(organizationLogoPath(ORGANIZATION));
  });

  it('keys the rendered URL under the snapshot key, never beside it', () => {
    // AD-13. A sibling key would survive `invalidateQueries` on the snapshot
    // key and leave yesterday's logo beside today's row — no error, just two
    // answers from two moments.
    const key = organizationLogoKey(LOGO_PATH);

    expect(key.slice(0, ORGANIZATION_SNAPSHOT_KEY.length)).toEqual([...ORGANIZATION_SNAPSHOT_KEY]);
    expect(key).toEqual([...ORGANIZATION_SNAPSHOT_KEY, ORGANIZATION_LOGO_OBJECT, LOGO_PATH]);
  });

  it('gives a different path a different key, so a replacement is not a stale hit', () => {
    expect(organizationLogoKey(LOGO_PATH)).not.toEqual(organizationLogoKey(null));
  });
});

// ----------------------------------------------------------------- the upload

describe('an admin uploads a logo into their own folder', () => {
  it('writes the object at the organization own key and answers with the path', async () => {
    const log = recorder();
    const outcome = await uploadOrganizationLogo(answering({}, log), ORGANIZATION, image());

    expect(outcome).toEqual({ ok: true, path: LOGO_PATH });
    expect(log.uploaded).toEqual([
      { path: LOGO_PATH, type: 'image/png', options: { contentType: 'image/png', upsert: true } },
    ]);
  });

  it('upserts, so replacing a logo is one object and never two', async () => {
    // MEASURED: without `upsert` the second upload is refused as a duplicate
    // (`409 KeyAlreadyExists`), so replacing would be a refusal to read rather
    // than a replacement — and the only way round it would be a second key per
    // upload, which is how a bucket accumulates every logo ever uploaded.
    const log = recorder();
    await uploadOrganizationLogo(answering({}, log), ORGANIZATION, image());
    await uploadOrganizationLogo(answering({}, log), ORGANIZATION, image('image/webp'));

    expect(log.uploaded.map((call) => call.path), 'a replacement wrote a second key').toEqual([
      LOGO_PATH,
      LOGO_PATH,
    ]);
    expect(log.uploaded.every((call) => call.options.upsert)).toBe(true);
  });

  it('sends the file own type, so the bucket allowlist judges the real thing', async () => {
    // A `Blob` with no type at all makes the service default to `text/plain`,
    // which the allowlist then refuses — the right answer, reached without this
    // module deciding anything about file contents.
    const log = recorder();
    await uploadOrganizationLogo(answering({}, log), ORGANIZATION, image('image/jpeg'));

    expect(log.uploaded[0]?.options.contentType).toBe('image/jpeg');
  });

  it('returns the derived path rather than whatever the answer said', async () => {
    // What goes into `organizations.logo_path` has to be the path the policies
    // authorize. An answer naming some other key would put a reference in the
    // row that nothing can read.
    const outcome = await uploadOrganizationLogo(
      answering({ upload: { data: { path: 'somewhere/else' }, error: null } }),
      ORGANIZATION,
      image(),
    );

    expect(outcome).toEqual({ ok: true, path: LOGO_PATH });
  });
});

describe('every session that may not write is refused by the policy, not the interface', () => {
  it.each([
    ['a member-role session'],
    ['an admin of another organization'],
    ['an anonymous caller'],
    ['a deactivated admin'],
  ])('refuses %s, which reaches here as the policy refusal', async () => {
    // All four are the SAME answer, and that is the point rather than an
    // economy: `0005`'s insert policy has no USING clause to fail, so WITH
    // CHECK raises, and it raises the identical `403` whoever asked. There is
    // no signal here that could tell them apart.
    expect(
      await uploadOrganizationLogo(answering({ upload: POLICY_REFUSED }), ORGANIZATION, image()),
    ).toEqual({ ok: false, code: LOGO_REFUSED });
  });

  it('refuses a file over the bucket size limit, and says so as its own code', async () => {
    expect(
      await uploadOrganizationLogo(answering({ upload: TOO_LARGE }), ORGANIZATION, image()),
    ).toEqual({ ok: false, code: LOGO_TOO_LARGE });
  });

  it('refuses a type outside the bucket allowlist, and says so as its own code', async () => {
    expect(
      await uploadOrganizationLogo(
        answering({ upload: WRONG_TYPE }),
        ORGANIZATION,
        image('application/pdf'),
      ),
    ).toEqual({ ok: false, code: LOGO_TYPE_UNSUPPORTED });
  });

  it('tells the four refusals apart although every one of them is HTTP 400', () => {
    // THE CLAIM THIS FILE EXISTS FOR. Reading `status` rather than `statusCode`
    // maps all four onto one code and the person is told to try again when what
    // they need is a smaller file.
    const codes = [POLICY_REFUSED, TOO_LARGE, WRONG_TYPE].map((answer) => answer.error?.status);

    expect(new Set(codes), 'the HTTP status distinguishes nothing').toEqual(new Set([400]));
  });

  it('reports a service failure as the service, never as the caller', async () => {
    expect(
      await uploadOrganizationLogo(answering({ upload: SERVICE_FAILED }), ORGANIZATION, image()),
    ).toEqual({ ok: false, code: LOGO_UNAVAILABLE });
  });

  it('reports an answer with neither an error nor an object as the service', async () => {
    // Reported as a refusal this would tell an entitled admin they lack a
    // permission they hold, and send them to ask for rights instead of to
    // report a fault.
    expect(
      await uploadOrganizationLogo(
        answering({ upload: { data: null, error: null } }),
        ORGANIZATION,
        image(),
      ),
    ).toEqual({ ok: false, code: LOGO_UNAVAILABLE });
  });

  it('reports a rejected call as the service', async () => {
    expect(await uploadOrganizationLogo(throwing(), ORGANIZATION, image())).toEqual({
      ok: false,
      code: LOGO_UNAVAILABLE,
    });
  });
});

// ------------------------------------------------------------------- the read

describe('the rendered URL is signed, scoped and never public', () => {
  it('signs the path the snapshot carries, with an expiry', async () => {
    const log = recorder();
    const outcome = await readOrganizationLogoUrl(answering({}, log), LOGO_PATH);

    expect(outcome).toEqual({ ok: true, url: SIGNED.data?.signedUrl });
    expect(log.signed[0]?.path).toBe(LOGO_PATH);
    expect(log.signed[0]?.expiresIn, 'the URL never expires').toBeGreaterThan(0);
  });

  it.each([
    ['an admin of another organization'],
    ['an anonymous caller'],
    ['a reference that resolves to nothing'],
  ])('returns no URL to %s', async () => {
    // Q4, and the fallback case, reaching the caller as one code because the
    // service reports all three as `Object not found` — measured live against
    // both fixtures. No bytes and no signed URL, so the surface falls back.
    expect(await readOrganizationLogoUrl(answering({ signedUrl: NOT_VISIBLE }), LOGO_PATH)).toEqual(
      { ok: false, code: LOGO_UNREADABLE },
    );
  });

  it('never tells a reader they lack a permission to CHANGE what they cannot SEE', () => {
    // THE READ HAS ITS OWN CODE, and this is why. `LOGO_REFUSED`'s message says
    // an administrator's rights are needed to change the logo — true of an
    // account that tried to change one, and false of a member whose read was
    // hidden or whose reference resolved to nothing. Two codes, two messages.
    expect(LOGO_UNREADABLE).not.toBe(LOGO_REFUSED);
    expect(organizationMessageKey(LOGO_UNREADABLE)).not.toBe(
      organizationMessageKey(LOGO_REFUSED),
    );
    expect(message(organizationMessageKey(LOGO_REFUSED)).toLowerCase()).toContain('administrator');
    expect(
      message(organizationMessageKey(LOGO_UNREADABLE)).toLowerCase(),
      'the read refusal claims something about the reader rights',
    ).not.toContain('administrator');
  });

  it('refuses an empty URL rather than handing one to an img element', async () => {
    // An empty `src` is a request for the current page, which is the broken
    // image the matrix forbids — and it is not an error anywhere, so nothing
    // else would notice.
    expect(
      await readOrganizationLogoUrl(
        answering({ signedUrl: { data: { signedUrl: '' }, error: null } }),
        LOGO_PATH,
      ),
    ).toEqual({ ok: false, code: LOGO_UNAVAILABLE });
  });

  it('agrees with the upload about an answer carrying neither an error nor a payload', async () => {
    // THE TWO DISAGREED until review: the upload called it the service's fault
    // and the read called it a refusal, for the identical shape. It is the
    // service's fault in both directions — nothing was refused, because nothing
    // was answered.
    expect(
      await readOrganizationLogoUrl(
        answering({ signedUrl: { data: null, error: null } }),
        LOGO_PATH,
      ),
    ).toEqual({ ok: false, code: LOGO_UNAVAILABLE });
    expect(
      await uploadOrganizationLogo(
        answering({ upload: { data: null, error: null } }),
        ORGANIZATION,
        image(),
      ),
    ).toEqual({ ok: false, code: LOGO_UNAVAILABLE });
  });

  it('reports a rejected call as the service', async () => {
    expect(await readOrganizationLogoUrl(throwing(), LOGO_PATH)).toEqual({
      ok: false,
      code: LOGO_UNAVAILABLE,
    });
  });

  it('asks storage nothing when there is no logo to ask about', () => {
    // PRESENCE IS A COLUMN, NOT A PROBE, and this is the case that executes it:
    // an organization with `logo_path` null produces a key whose last segment
    // IS null, and the surface's query is `enabled` on exactly that — so
    // nothing reaches storage at all. The version this replaces passed a real
    // path and asserted a call was made, which is the opposite claim.
    const key = organizationLogoKey(null);

    expect(key[key.length - 1], 'a missing logo does not key on its own absence').toBeNull();
    expect(key).not.toEqual(organizationLogoKey(LOGO_PATH));
  });

  it('reaches storage exactly once to render a logo, and writes nothing', async () => {
    const log = recorder();
    await readOrganizationLogoUrl(answering({}, log), LOGO_PATH);

    expect(log.uploaded, 'reading a logo wrote something').toEqual([]);
    expect(log.signed).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- the mapping

describe('every logo failure has a message of its own', () => {
  const CODES: LogoFailure[] = [
    LOGO_REFUSED,
    LOGO_UNREADABLE,
    LOGO_TOO_LARGE,
    LOGO_TYPE_UNSUPPORTED,
    LOGO_UNAVAILABLE,
  ];

  it.each(CODES)('maps %s to a key of its own', (code) => {
    expect(organizationMessageKey(code)).toMatch(/^organization\.error\./);
  });

  it('maps the five codes to five distinct keys', () => {
    // The mutation a per-code loop cannot see: a mapping that returned one key
    // for everything satisfies every case above while "too large" and "wrong
    // type" say the same unusable thing.
    expect(new Set(CODES.map(organizationMessageKey)).size).toBe(CODES.length);
  });

  it('pairs each code with the key that describes it', () => {
    // ORDER, which is what a swapped-branches mutation breaks. Executed here
    // because a `.tsx` is collected by nothing.
    expect(organizationMessageKey(LOGO_REFUSED)).toBe('organization.error.logoRefused');
    expect(organizationMessageKey(LOGO_UNREADABLE)).toBe('organization.error.logoUnreadable');
    expect(organizationMessageKey(LOGO_TOO_LARGE)).toBe('organization.error.logoTooLarge');
    expect(organizationMessageKey(LOGO_TYPE_UNSUPPORTED)).toBe('organization.error.logoType');
    expect(organizationMessageKey(LOGO_UNAVAILABLE)).toBe('organization.error.logoUnavailable');
  });
});

// --------------------------------------------------- the file that never flies

describe('a file the bucket would refuse is refused before it is transmitted', () => {
  /**
   * THE BUCKET IS STILL THE ENFORCEMENT POINT — `test/rls-isolation.test.ts`
   * uploads an oversized file and a disallowed type over the real transport and
   * asserts the 413 and the 415 — so nothing here is a gate. What it is is the
   * difference between reading the refusal now and reading it after a 50 MB
   * upload, and between refusing a renamed `.pdf` locally and refusing it after
   * the bytes have crossed the network.
   */

  it('refuses a file over the exported bound without calling storage at all', async () => {
    const log = recorder();
    const oversized = new Blob([new Uint8Array(ORGANIZATION_LOGO_MAX_BYTES + 1)], {
      type: 'image/png',
    });

    expect(await uploadOrganizationLogo(answering({}, log), ORGANIZATION, oversized)).toEqual({
      ok: false,
      code: LOGO_TOO_LARGE,
    });
    expect(log.uploaded, 'the oversized file was transmitted anyway').toEqual([]);
  });

  it('accepts a file exactly at the bound, so the check is not off by one', async () => {
    // The boundary in the other direction. `>=` here would refuse a file the
    // bucket accepts, which is a client refusing what the database would allow
    // — the one failure mode a courtesy check must not have.
    const log = recorder();
    const exact = new Blob([new Uint8Array(ORGANIZATION_LOGO_MAX_BYTES)], { type: 'image/png' });

    expect((await uploadOrganizationLogo(answering({}, log), ORGANIZATION, exact)).ok).toBe(true);
    expect(log.uploaded).toHaveLength(1);
  });

  it.each(['application/pdf', 'image/svg+xml', 'text/plain', ''])(
    'refuses the type %s without calling storage at all',
    async (type) => {
      const log = recorder();

      expect(await uploadOrganizationLogo(answering({}, log), ORGANIZATION, image(type))).toEqual({
        ok: false,
        code: LOGO_TYPE_UNSUPPORTED,
      });
      expect(log.uploaded, `${type} was transmitted anyway`).toEqual([]);
    },
  );

  it.each([...ORGANIZATION_LOGO_TYPES])('sends the type %s, which the bucket accepts', async (type) => {
    // The positive control the refusals need: a check that refused everything
    // would satisfy every case above and make the surface unable to upload.
    const log = recorder();

    expect((await uploadOrganizationLogo(answering({}, log), ORGANIZATION, image(type))).ok).toBe(
      true,
    );
    expect(log.uploaded[0]?.options.contentType).toBe(type);
  });
});

// ------------------------------------------------------- the whole of an upload

describe('replacing a logo points the row at the key and then writes the object', () => {
  /**
   * THE ORCHESTRATION IS HERE BECAUSE IT HAS TO BE EXECUTED. Written in the
   * screen, `uploadOrganizationLogo(storage, organization.slug, file)`
   * typechecks, lints, and leaves every assertion in this repository green
   * while every upload is refused 403 at runtime — the folder the policies
   * authorize is the id. Nothing that lives in a `.tsx` can notice that
   * (AD-15); this can, and does, below.
   */

  const SNAPSHOT_ROW = {
    id: ORGANIZATION,
    slug: 'a-slug-that-is-not-the-id',
    name: 'An Organization',
    short_name: null,
    description: null,
    address: null,
    contact_email: null,
    organization_type: 'A Type',
    timezone: 'Etc/UTC',
    locale: 'hr',
    leave_year_start_month: 1,
    leave_year_start_day: 1,
    logo_path: null,
  };

  function snapshot(): OrganizationSnapshot {
    const mapped = organizationSnapshotOf(SNAPSHOT_ROW);
    if (mapped === null) throw new Error('the fixture row is not a snapshot');

    return mapped;
  }

  /** What the row write recorded, in order, alongside the object write. */
  interface Sequence {
    readonly steps: string[];
    readonly updated: Readonly<Record<string, unknown>>[];
  }

  function table(answer: PostgrestAnswer, sequence: Sequence): OrganizationTable {
    return {
      select: () => ({ limit: () => Promise.resolve(answer) }),
      update: (values) => {
        sequence.steps.push('update');
        sequence.updated.push(values);

        return {
          eq: () => ({ select: () => Promise.resolve(answer) }),
        };
      },
    };
  }

  function storage(sequence: Sequence, log: Recorded): LogoStorage {
    const handle = answering({}, log);

    return {
      upload: (path, file, options) => {
        sequence.steps.push('upload');

        return handle.upload(path, file, options);
      },
      createSignedUrl: handle.createSignedUrl.bind(handle),
    };
  }

  const WROTE_THE_ROW: PostgrestAnswer = {
    data: [{ ...SNAPSHOT_ROW, logo_path: LOGO_PATH }],
    error: null,
  };
  /** A refused write: row level security fails USING, so no row and no error. */
  const NO_ROW_MATCHED: PostgrestAnswer = { data: [], error: null };

  it('uploads under the organization id, never under anything else it carries', async () => {
    // THE MUTATION THIS EXISTS FOR. `slug` on the fixture is deliberately not
    // the id, so a version reaching for it produces a different path and this
    // fails — which is what nothing in the repository could see while the
    // sequence lived in the screen.
    const log = recorder();
    const sequence: Sequence = { steps: [], updated: [] };

    await replaceOrganizationLogo(
      storage(sequence, log),
      table(WROTE_THE_ROW, sequence),
      snapshot(),
      image(),
    );

    expect(log.uploaded[0]?.path, 'the upload names a folder no policy authorizes').toBe(
      organizationLogoPath(snapshot().id),
    );
    expect(log.uploaded[0]?.path).not.toContain(SNAPSHOT_ROW.slug);
  });

  it('writes the row FIRST and the object second, so a failure strands nothing', async () => {
    // THE ORDER IS THE WHOLE CLAIM. Reversed, a column write that is refused
    // after a successful upsert has already destroyed the previous logo and
    // left an object nothing references — permanently, because `0005` writes no
    // DELETE policy and no surface can reclaim it.
    const log = recorder();
    const sequence: Sequence = { steps: [], updated: [] };

    await replaceOrganizationLogo(
      storage(sequence, log),
      table(WROTE_THE_ROW, sequence),
      snapshot(),
      image(),
    );

    expect(sequence.steps, 'the object is written before the row points at it').toEqual([
      'update',
      'upload',
    ]);
    expect(sequence.updated, 'the row write carries more than the logo reference').toEqual([
      { logo_path: LOGO_PATH },
    ]);
  });

  it('writes no object when the row write is refused', async () => {
    // The refusal costs nothing at all, which is the other half of putting the
    // row first: the same claim and the same freshness check stand behind both
    // writes, so a caller who may not write the row may not write the object.
    const log = recorder();
    const sequence: Sequence = { steps: [], updated: [] };

    expect(
      await replaceOrganizationLogo(
        storage(sequence, log),
        table(NO_ROW_MATCHED, sequence),
        snapshot(),
        image(),
      ),
    ).toEqual({ ok: false, code: ORGANIZATION_REFUSED });
    expect(log.uploaded, 'a refused row write still wrote an object').toEqual([]);
    expect(sequence.steps).toEqual(['update']);
  });

  it('moves neither the row nor the object for a file the bucket would refuse', async () => {
    // Put the row first and the courtesy check earns a second job: without it a
    // file the bucket is about to refuse would still move the column on its way
    // to being refused.
    const log = recorder();
    const sequence: Sequence = { steps: [], updated: [] };
    const oversized = new Blob([new Uint8Array(ORGANIZATION_LOGO_MAX_BYTES + 1)], {
      type: 'image/png',
    });

    expect(
      await replaceOrganizationLogo(
        storage(sequence, log),
        table(WROTE_THE_ROW, sequence),
        snapshot(),
        oversized,
      ),
    ).toEqual({ ok: false, code: LOGO_TOO_LARGE });
    expect(sequence.steps, 'a file that cannot be sent still moved the row').toEqual([]);
  });

  it('reports a failed object write, having left the reference in place', async () => {
    // The degraded state this ordering chooses on purpose: `logo_path` names a
    // key whose object is missing or stale, which is the matrix's own "a
    // reference that resolves to nothing -> neutral fallback" row. The key is
    // FIXED per organization, so the value written is identical every time and
    // the row is no worse off than before.
    const log = recorder();
    const sequence: Sequence = { steps: [], updated: [] };
    const refusing: LogoStorage = {
      upload: () => {
        sequence.steps.push('upload');

        return Promise.resolve(POLICY_REFUSED);
      },
      createSignedUrl: answering({}, log).createSignedUrl,
    };

    expect(
      await replaceOrganizationLogo(refusing, table(WROTE_THE_ROW, sequence), snapshot(), image()),
    ).toEqual({ ok: false, code: LOGO_REFUSED });
    expect(sequence.steps).toEqual(['update', 'upload']);
  });

  it('answers with the row as the database now holds it', async () => {
    const log = recorder();
    const sequence: Sequence = { steps: [], updated: [] };
    const outcome = await replaceOrganizationLogo(
      storage(sequence, log),
      table(WROTE_THE_ROW, sequence),
      snapshot(),
      image(),
    );

    expect(outcome.ok).toBe(true);
    expect(outcome.ok ? outcome.snapshot.logoPath : null).toBe(LOGO_PATH);
  });
});

// -------------------------------------------------------------- the neutral mark

describe('the neutral mark carries a character a person can actually read', () => {
  it('takes a whole code point, not half a surrogate pair', () => {
    // `slice(0, 1)` counts UTF-16 code units, so an astral first character
    // renders a lone surrogate — the replacement glyph, on a mark whose whole
    // job is to stand in for a logo.
    expect(organizationLogoMark('𝒜kademija')).toBe('𝒜');
    expect(organizationLogoMark('𝒜kademija')?.length, 'the mark is half a pair').toBe(2);
  });

  it('keeps a Croatian diacritic attached to the letter it belongs to', () => {
    // Decomposed `Č` is `C` plus a combining caron: taken as one code point it
    // is a bare `C` with the caron orphaned onto whatever follows. Normalizing
    // to NFC first is what makes the composed and decomposed spellings the same
    // mark — and diacritic coverage is an explicit requirement of this project.
    expect(organizationLogoMark('Čakovec')).toBe('Č');
    expect(organizationLogoMark('Čakovec'), 'a decomposed caron was dropped').toBe('Č');
    expect(organizationLogoMark('Žrnovnica')).toBe('Ž');
    expect(organizationLogoMark('Šibenik')).toBe('Š');
    expect(organizationLogoMark('Đakovo')).toBe('Đ');
  });

  it('ignores leading whitespace rather than drawing it', () => {
    expect(organizationLogoMark('  Kaštela')).toBe('K');
  });

  it('answers null for a name with nothing in it, so no mark goes unnamed', () => {
    // `0002:72` makes this unreachable from the database — `btrim(name) <> ''`
    // is a check on the column — but an empty accessible name on a `role="img"`
    // is an element a screen reader announces as nothing at all, so the caller
    // needs to be able to tell.
    expect(organizationLogoMark('')).toBeNull();
    expect(organizationLogoMark('   ')).toBeNull();
    expect(organizationLogoMark('\n\t')).toBeNull();
  });
});
