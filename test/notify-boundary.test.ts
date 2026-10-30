import { createECDH, randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Client } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import webpush from 'web-push';

import { FIXTURES, inRolledBackTransaction, noDatabase, organizationId } from './database.js';
import { formatIsoDate as spaFormatIsoDate } from '../apps/web/src/lib/i18n/format.ts';
import {
  ATTEMPTS_EXHAUSTED,
  BATCH_SIZE,
  SEND_TIMEOUT_MS,
  CLAIM_FAILED,
  CLAIM_RPC,
  INVOKE_SECRET_MIN_LENGTH,
  INVOKE_SECRET_REFUSED,
  METHOD_NOT_ALLOWED,
  NETWORK_ERROR,
  NOTIFY_RAN,
  PACE_MS,
  PROVIDER_CONFLICT,
  PROVIDER_RATE_LIMITED,
  PROVIDER_REFUSED,
  PROVIDER_TIMEOUT,
  PROVIDER_UNAUTHORIZED,
  PROVIDER_UNAVAILABLE,
  RECIPIENT_NO_EMAIL,
  RESEND_ENDPOINT,
  ROW_INVALID,
  RUN_DEADLINE,
  RUN_DEADLINE_MS,
  SETTLE_RPC,
  CLIENT_CONSTRUCTION_FAILED,
  DELETE_SUBSCRIPTION_RPC,
  PUSH_DELETE_FAILED,
  PUSH_ENCRYPTOR_MISSING,
  PUSH_NETWORK_ERROR,
  PUSH_NOT_CONFIGURED,
  PUSH_NO_SUBSCRIPTION,
  PUSH_SERVICE_RATE_LIMITED,
  PUSH_SERVICE_REFUSED,
  PUSH_SERVICE_UNAUTHORIZED,
  PUSH_SERVICE_UNAVAILABLE,
  PUSH_SUBSCRIPTION_GONE,
  PUSH_SUBSCRIPTION_INVALID,
  PUSH_TTL_SECONDS,
  createHandler,
  deliveryOfStatus,
  deviceOutcomeOfStatus,
  pushEncryptorOf,
  settlementOfDevices,
  readConfiguration,
  sameSecret,
  type Fetch,
  type OutboxClient,
  type PushEncryptor,
  type RpcAnswer,
} from '../supabase/functions/notify/handler.ts';
import {
  MESSAGE_OF_CODE,
  MESSAGE_UNKNOWN,
  OBAVIJESTI,
  OPERANDS_INVALID,
  SETTINGS_PATH,
  formatIsoDate,
  render,
  renderPush,
} from '../supabase/functions/notify/messages.ts';

/**
 * Story 10.1: the `notify` Edge Function, asserted without deploying it
 * (AD-15). `handler.ts` takes its environment, its client and its `fetch` as
 * arguments, so every row of the spec's I/O matrix is driven here:
 *
 *   - against a fake client, for the transport's own decisions (the invoke
 *     secret, the configuration, the provider's answers);
 *   - against the REAL `claim_notifications` and `settle_notification` in a
 *     rolled-back transaction, as `service_role`, with only `fetch` faked: the
 *     lease, the attempts and the settle are the database's, so that is where
 *     they are proved.
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const notifyRoot = join(repoRoot, 'supabase', 'functions', 'notify');

const INVOKE_SECRET = 'i'.repeat(INVOKE_SECRET_MIN_LENGTH + 8);

/** No real waiting in a test: the pace is asserted through the calls, not the clock. */
const instantly = (): Promise<void> => Promise.resolve();
const APP_URL = 'https://shift.example.org';
const ORGANIZATION_NAME = 'DVD Kaštel Novi';
/** Where the rendered tests send a row: the app, the pilot's slug and name. */
const TARGET = { appUrl: APP_URL, slug: 'dvd-kastel-novi', organizationName: ORGANIZATION_NAME } as const;
/** The link to `path` through the pilot's sign-in route. */
const linkTo = (path: string): string => `${APP_URL}/prijava/dvd-kastel-novi?povratak=${encodeURIComponent(path)}`;
/** Story 10.3: the line every email ends with, after a blank line, linking to the settings. */
const FOOTER = `\n\nObavijesti e-poštom možeš isključiti u aplikaciji, pod Obavijesti: ${linkTo('/obavijesti')}`;

const ENVIRONMENT: Readonly<Record<string, string>> = {
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SHIFT_SECRET_KEY: 'sb_secret_test',
  NOTIFY_INVOKE_SECRET: INVOKE_SECRET,
  RESEND_API_KEY: 're_test',
  NOTIFY_EMAIL_FROM: 'Shift <obavijesti@example.org>',
  SHIFT_APP_URL: APP_URL,
  // Story 10.4: a key pair's shapes (65 and 32 bytes, unpadded base64url) and its subject.
  VAPID_PUBLIC_KEY: `B${'a'.repeat(86)}`,
  VAPID_PRIVATE_KEY: 'p'.repeat(43),
  VAPID_SUBJECT: 'mailto:obavijesti@example.org',
};

const configured = readConfiguration((name) => ENVIRONMENT[name]);

function invoke(token: string | null = INVOKE_SECRET, method = 'POST'): Request {
  const headers: Record<string, string> = {};
  if (token !== null) headers['Authorization'] = `Bearer ${token}`;
  return new Request('http://localhost/functions/v1/notify', { method, headers });
}

/** A provider that answers every send with `status`, or throws. */
function provider(answer: number | 'network'): ReturnType<typeof vi.fn<Fetch>> {
  return vi.fn<Fetch>(() =>
    answer === 'network'
      ? Promise.reject(new TypeError('fetch failed'))
      : Promise.resolve(new Response(null, { status: answer })),
  );
}

interface FakeRow {
  id: string;
  code: string;
  channel: string;
  operands: unknown;
  attempts: number;
  claimed_at: string;
  email: string | null;
  locale: string | null;
  timezone: string | null;
  slug: string | null;
  organization_name: string | null;
  subscriptions?: unknown;
  subject_id?: string;
}

function row(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    id: crypto.randomUUID(),
    code: 'LEAVE_REQUEST_APPROVED',
    channel: 'email',
    operands: { startDate: '2046-03-02', endDate: '2046-03-06' },
    attempts: 1,
    claimed_at: '2046-03-01T10:00:00.123456+00:00',
    email: 'ana@example.org',
    locale: 'hr',
    timezone: 'Europe/Zagreb',
    slug: 'dvd-kastel-novi',
    organization_name: ORGANIZATION_NAME,
    ...overrides,
  };
}

/**
 * A fake secret-key client: the claim answers `rows`, every settle is
 * recorded (with its lease token checked against the row's), and
 * `settleAnswer` may make one settle fail.
 */
function fakeClient(
  rows: readonly unknown[] | RpcAnswer,
  settleAnswer: (index: number) => Promise<RpcAnswer> = () => Promise.resolve({ data: null, error: null }),
) {
  const settles: { p_id: unknown; p_result: unknown; p_failure_code: unknown }[] = [];
  const tokens: unknown[] = [];
  const deletes: Record<string, unknown>[] = [];
  const rpc = vi.fn((fn: string, args: Record<string, unknown>): Promise<RpcAnswer> => {
    if (fn === CLAIM_RPC) {
      return Promise.resolve(Array.isArray(rows) ? { data: rows, error: null } : (rows as RpcAnswer));
    }
    if (fn === DELETE_SUBSCRIPTION_RPC) {
      deletes.push(args);
      return Promise.resolve({ data: null, error: null });
    }
    settles.push({ p_id: args['p_id'], p_result: args['p_result'], p_failure_code: args['p_failure_code'] });
    tokens.push(args['p_claimed_at']);
    return settleAnswer(settles.length - 1);
  });
  return { client: { rpc } satisfies OutboxClient, rpc, settles, tokens, deletes };
}

/** The handler over a fake client, with no real waiting. */
function handlerOf(client: OutboxClient, fetch: Fetch, now?: () => number): (request: Request) => Promise<Response> {
  return createHandler(configured, { makeClient: () => client, fetch, sleep: instantly, ...(now ? { now } : {}) });
}

// --------------------------------------------------------------- the messages

describe('notify renders from a pinned copy of the obavijesti namespace', () => {
  it("keeps its messages deep-equal to hr.json's obavijesti", () => {
    const resource = JSON.parse(
      readFileSync(join(repoRoot, 'apps', 'web', 'src', 'lib', 'i18n', 'locales', 'hr.json'), 'utf8'),
    ) as Record<string, unknown>;

    expect(resource['obavijesti'], 'hr.json has no obavijesti namespace').toBeDefined();
    expect(OBAVIJESTI).toEqual(resource['obavijesti']);
  });

  it('maps every code it renders to a message that exists, and only plain {name} placeholders', () => {
    for (const key of Object.values(MESSAGE_OF_CODE)) {
      expect(OBAVIJESTI[key], key).toBeDefined();
      for (const message of [OBAVIJESTI[key].subject, OBAVIJESTI[key].body]) {
        // Plain interpolation only: no ICU argument a `{name}` renderer would
        // print raw.
        expect(message, key).not.toMatch(/\{[^}]*,/);
      }
    }
  });

  it.each(['2026-09-23', '2046-03-02', '0001-01-01', '9999-12-31', '2024-02-29'])(
    'formats %s exactly as the SPA formatIsoDate does',
    (iso) => {
      expect(formatIsoDate(iso)).toBe(spaFormatIsoDate(iso));
    },
  );

  it.each(['2026-02-30', '2026-13-01', '0000-01-01', '23.09.2026', ''])('refuses %j as a date, as the SPA does', (iso) => {
    expect(formatIsoDate(iso)).toBeNull();
    expect(spaFormatIsoDate(iso)).toBeNull();
  });

  it('renders the approval and the rejection with the organization, the dates and the Godišnji link', () => {
    const approved = render('LEAVE_REQUEST_APPROVED', 'hr', { startDate: '2046-03-02', endDate: '2046-03-06' }, TARGET);
    const rejected = render(
      'LEAVE_REQUEST_REJECTED',
      'hr-HR',
      { startDate: '2046-03-02', endDate: '2046-03-06' },
      { ...TARGET, appUrl: `${APP_URL}/` },
    );

    expect(approved).toEqual({
      ok: true,
      subject: 'Zahtjev za godišnji 02.03.2046–06.03.2046 je odobren',
      text: `${ORGANIZATION_NAME}: tvoj zahtjev za godišnji odmor 02.03.2046–06.03.2046 je odobren. Pogledaj ga u aplikaciji: ${linkTo('/godisnji')}${FOOTER}`,
    });
    expect(rejected).toMatchObject({ ok: true, subject: 'Zahtjev za godišnji 02.03.2046–06.03.2046 je odbijen' });
    expect(rejected.ok && rejected.text).toContain(linkTo('/godisnji'));
  });

  it('ends every email with the settings line, linking through the sign-in to /obavijesti (story 10.3)', () => {
    expect(OBAVIJESTI.footer).toBe('Obavijesti e-poštom možeš isključiti u aplikaciji, pod Obavijesti: {link}');
    expect(SETTINGS_PATH).toBe('/obavijesti');
    for (const code of Object.keys(MESSAGE_OF_CODE)) {
      const rendered = render(
        code,
        'hr',
        { startDate: '2046-03-02', endDate: '2046-03-06', date: '2046-03-02', effectiveFrom: '2046-03-02', shiftTypeName: 'Dnevna', memberName: 'Ana Kovač', requestId: REQUEST_ID },
        TARGET,
      );
      if (!rendered.ok) throw new Error(`${code} did not render`);
      expect(rendered.text.endsWith(FOOTER), code).toBe(true);
      const footerLink = new URL(/https?:\/\/\S+$/.exec(rendered.text)?.[0] ?? '');
      expect(footerLink.pathname).toBe('/prijava/dvd-kastel-novi');
      expect(footerLink.searchParams.get('povratak')).toBe('/obavijesti');
    }
  });

  it('refuses a code it has no message for, and operands that do not fill the message', () => {
    expect(render('SOMETHING_ELSE', 'hr', {}, TARGET)).toEqual({ ok: false, code: MESSAGE_UNKNOWN });
    expect(render('LEAVE_REQUEST_APPROVED', 'hr', { startDate: '2046-03-02' }, TARGET)).toEqual({
      ok: false,
      code: OPERANDS_INVALID,
    });
    expect(render('LEAVE_REQUEST_APPROVED', 'hr', [], TARGET)).toEqual({ ok: false, code: OPERANDS_INVALID });
    expect(
      render('LEAVE_REQUEST_APPROVED', 'hr', { startDate: '2046-02-30', endDate: '2046-03-06' }, TARGET),
    ).toEqual({ ok: false, code: OPERANDS_INVALID });
  });

  it('refuses a row whose organization has no slug or no name to link and name', () => {
    const operands = { startDate: '2046-03-02', endDate: '2046-03-06' };

    expect(render('LEAVE_REQUEST_APPROVED', 'hr', operands, { ...TARGET, slug: null })).toEqual({
      ok: false,
      code: OPERANDS_INVALID,
    });
    expect(render('LEAVE_REQUEST_APPROVED', 'hr', operands, { ...TARGET, organizationName: '  ' })).toEqual({
      ok: false,
      code: OPERANDS_INVALID,
    });
  });

  it('renders a locale with no resource of its own in Croatian', () => {
    const operands = { startDate: '2046-03-02', endDate: '2046-03-06' };

    expect(render('LEAVE_REQUEST_APPROVED', 'en', operands, TARGET)).toEqual(
      render('LEAVE_REQUEST_APPROVED', 'hr', operands, TARGET),
    );
    expect(render('LEAVE_REQUEST_APPROVED', null, operands, TARGET)).toEqual(
      render('LEAVE_REQUEST_APPROVED', 'hr', operands, TARGET),
    );
  });
});

// ------------------------------------------------------------ story 10.2's codes

/**
 * Every code the 0043 triggers write, with the operands they write it with,
 * the surface it links to, and the text it renders to.
 */
const REQUEST_ID = '0b5e7f9a-3c2d-4e1f-8a6b-9c0d1e2f3a4b';
const EVERY_CODE: readonly {
  code: string;
  operands: Record<string, string>;
  path: string;
  subject: string;
  text: string;
}[] = [
  {
    code: 'LEAVE_RECORDED',
    operands: { startDate: '2046-03-02', endDate: '2046-03-06' },
    path: '/godisnji',
    subject: 'Upisan ti je godišnji 02.03.2046–06.03.2046',
    text: `${ORGANIZATION_NAME}: upisan ti je godišnji odmor 02.03.2046–06.03.2046. Pogledaj ga u aplikaciji: {link}`,
  },
  {
    code: 'LEAVE_RECORD_CHANGED',
    operands: { startDate: '2046-03-02', endDate: '2046-03-06' },
    path: '/godisnji',
    subject: 'Izmijenjen ti je godišnji, sada 02.03.2046–06.03.2046',
    text: `${ORGANIZATION_NAME}: tvoj godišnji odmor izmijenjen je na 02.03.2046–06.03.2046. Pogledaj ga u aplikaciji: {link}`,
  },
  {
    code: 'LEAVE_RECORD_REMOVED',
    operands: { startDate: '2046-03-02', endDate: '2046-03-06' },
    path: '/godisnji',
    subject: 'Uklonjen ti je godišnji 02.03.2046–06.03.2046',
    text: `${ORGANIZATION_NAME}: uklonjen ti je godišnji odmor 02.03.2046–06.03.2046. Pogledaj u aplikaciji: {link}`,
  },
  {
    code: 'ROSTER_PUT_ON',
    operands: { date: '2046-03-02' },
    path: '/kalendar',
    subject: 'Promjena rasporeda 02.03.2046: na rasporedu si',
    text: `${ORGANIZATION_NAME}: upisana je promjena rasporeda koja te stavlja na raspored 02.03.2046. Pogledaj kalendar: {link}`,
  },
  {
    code: 'ROSTER_PUT_ON_CHANGED',
    operands: { date: '2046-03-02' },
    path: '/kalendar',
    subject: 'Izmijenjena promjena rasporeda 02.03.2046',
    text: `${ORGANIZATION_NAME}: izmijenjena je promjena rasporeda koja te stavlja na raspored 02.03.2046. Pogledaj kalendar: {link}`,
  },
  {
    code: 'ROSTER_PUT_ON_REMOVED',
    operands: { date: '2046-03-02' },
    path: '/kalendar',
    subject: 'Uklonjena promjena rasporeda 02.03.2046',
    text: `${ORGANIZATION_NAME}: uklonjena je promjena rasporeda koja te stavila na raspored 02.03.2046. Pogledaj kalendar: {link}`,
  },
  {
    code: 'ROSTER_TAKEN_OFF',
    operands: { date: '2046-03-02' },
    path: '/kalendar',
    subject: 'Promjena rasporeda 02.03.2046: nisi na rasporedu',
    text: `${ORGANIZATION_NAME}: upisana je promjena rasporeda koja te miče s rasporeda 02.03.2046. Pogledaj kalendar: {link}`,
  },
  {
    code: 'ROSTER_TAKEN_OFF_CHANGED',
    operands: { date: '2046-03-02' },
    path: '/kalendar',
    subject: 'Izmijenjena promjena rasporeda 02.03.2046',
    text: `${ORGANIZATION_NAME}: izmijenjena je promjena rasporeda koja te miče s rasporeda 02.03.2046. Pogledaj kalendar: {link}`,
  },
  {
    code: 'ROSTER_TAKEN_OFF_REMOVED',
    operands: { date: '2046-03-02' },
    path: '/kalendar',
    subject: 'Uklonjena promjena rasporeda 02.03.2046',
    text: `${ORGANIZATION_NAME}: uklonjena je promjena rasporeda koja te maknula s rasporeda 02.03.2046. Pogledaj kalendar: {link}`,
  },
  {
    code: 'TEAM_SHIFT_TYPE_SET',
    operands: { date: '2046-03-02', shiftTypeName: 'Noć' },
    path: '/kalendar',
    subject: 'Promjena rasporeda 02.03.2046',
    text: `${ORGANIZATION_NAME}: za 02.03.2046 vrijedi Noć umjesto rasporeda po rotaciji. Pogledaj kalendar: {link}`,
  },
  {
    code: 'TEAM_SHIFT_TYPE_CHANGED',
    operands: { date: '2046-03-02', shiftTypeName: 'Dan' },
    path: '/kalendar',
    subject: 'Izmijenjena promjena rasporeda 02.03.2046',
    text: `${ORGANIZATION_NAME}: za 02.03.2046 sada vrijedi Dan umjesto rasporeda po rotaciji. Pogledaj kalendar: {link}`,
  },
  {
    code: 'TEAM_SHIFT_TYPE_REMOVED',
    operands: { date: '2046-03-02' },
    path: '/kalendar',
    subject: 'Uklonjena promjena rasporeda 02.03.2046',
    text: `${ORGANIZATION_NAME}: za 02.03.2046 ponovno vrijedi raspored po rotaciji. Pogledaj kalendar: {link}`,
  },
  {
    code: 'ROTATION_CHANGES',
    operands: { effectiveFrom: '2046-03-02' },
    path: '/kalendar',
    subject: 'Nova rotacija od 02.03.2046',
    text: `${ORGANIZATION_NAME}: od 02.03.2046 vrijedi nova rotacija. Pogledaj kalendar: {link}`,
  },
  {
    code: 'ROTATION_CHANGE_CANCELLED',
    operands: { effectiveFrom: '2046-03-02' },
    path: '/kalendar',
    subject: 'Otkazana promjena rotacije od 02.03.2046',
    text: `${ORGANIZATION_NAME}: promjena rotacije zakazana od 02.03.2046 je otkazana. Pogledaj kalendar: {link}`,
  },
  {
    code: 'LEAVE_REQUEST_CREATED',
    operands: { requestId: REQUEST_ID, memberName: 'Ana Kovač', startDate: '2046-03-02', endDate: '2046-03-06' },
    path: `/za-odluku/zahtjev/${REQUEST_ID}`,
    subject: 'Novi zahtjev za godišnji: Ana Kovač',
    text: `${ORGANIZATION_NAME}: Ana Kovač traži godišnji odmor 02.03.2046–06.03.2046. Zahtjev čeka tvoju odluku: {link}`,
  },
];

describe("notify renders every 10.2 code with the organization's name and its sign-in link", () => {
  it('knows exactly the codes 0042 and 0043 write', () => {
    expect(Object.keys(MESSAGE_OF_CODE).sort()).toEqual(
      ['LEAVE_REQUEST_APPROVED', 'LEAVE_REQUEST_REJECTED', ...EVERY_CODE.map((entry) => entry.code)].sort(),
    );
  });

  it.each(EVERY_CODE)('renders $code', ({ code, operands, path, subject, text }) => {
    const rendered = render(code, 'hr', operands, TARGET);

    expect(rendered).toEqual({ ok: true, subject, text: `${text.replace('{link}', linkTo(path))}${FOOTER}` });
  });

  it.each(EVERY_CODE)('links $code through /prijava/<slug>?povratak=<path>, a target the sign-in follows', ({ code, operands, path }) => {
    const rendered = render(code, 'hr', operands, TARGET);
    if (!rendered.ok) throw new Error(`${code} did not render`);
    // The surface's link is the first; the footer's, to the settings, the last.
    const link = /https?:\/\/\S+/.exec(rendered.text)?.[0] ?? '';
    const url = new URL(link);

    expect(url.origin).toBe(APP_URL);
    expect(url.pathname).toBe('/prijava/dvd-kastel-novi');
    expect([...url.searchParams.keys()]).toEqual(['povratak']);
    expect(url.searchParams.get('povratak')).toBe(path);
  });

  it.each(EVERY_CODE.filter((entry) => entry.code !== 'LEAVE_REQUEST_CREATED'))(
    'names no other member and no absence in $code, which a member-role account receives (Q5)',
    ({ code }) => {
      const message = OBAVIJESTI[MESSAGE_OF_CODE[code] ?? 'leaveRequestApproved'];
      const placeholders = [...`${message.subject} ${message.body}`.matchAll(/\{(\w+)\}/g)].map((match) => match[1]);

      expect(placeholders.filter((name) => !['organizationName', 'link', 'date', 'startDate', 'endDate', 'effectiveFrom', 'shiftTypeName'].includes(name ?? ''))).toEqual([]);
    },
  );

  it('formats only the date operands as dates: a name that looks like one stays text', () => {
    const rendered = render(
      'LEAVE_REQUEST_CREATED',
      'hr',
      { requestId: REQUEST_ID, memberName: '2046-02-30', startDate: '2046-03-02', endDate: '2046-03-06' },
      TARGET,
    );
    const typed = render('TEAM_SHIFT_TYPE_SET', 'hr', { date: '2046-03-02', shiftTypeName: '2046-03-02' }, TARGET);

    expect(rendered).toMatchObject({ ok: true, subject: 'Novi zahtjev za godišnji: 2046-02-30' });
    expect(typed.ok && typed.text).toContain('za 02.03.2046 vrijedi 2046-03-02 umjesto');
  });

  it('refuses a new request whose operands name no request id to link to', () => {
    const { operands } = EVERY_CODE.find((entry) => entry.code === 'LEAVE_REQUEST_CREATED') ?? { operands: {} };

    expect(render('LEAVE_REQUEST_CREATED', 'hr', { ...operands, requestId: undefined }, TARGET)).toEqual({
      ok: false,
      code: OPERANDS_INVALID,
    });
    expect(render('LEAVE_REQUEST_CREATED', 'hr', { ...operands, requestId: '../ljudi' }, TARGET)).toEqual({
      ok: false,
      code: OPERANDS_INVALID,
    });
  });
});

// ---------------------------------------------------------- the configuration

describe('notify reads its environment once, with one code per missing variable', () => {
  it('accepts the complete environment', () => {
    expect(configured.ok).toBe(true);
  });

  it.each([
    ['SUPABASE_URL', '', 'PROJECT_URL_MISSING'],
    ['SUPABASE_URL', 'not a url', 'PROJECT_URL_INVALID'],
    ['SHIFT_SECRET_KEY', '', 'SECRET_KEY_MISSING'],
    ['SHIFT_SECRET_KEY', 'sb_publishable_test', 'SECRET_KEY_INVALID'],
    ['NOTIFY_INVOKE_SECRET', '', 'INVOKE_SECRET_MISSING'],
    ['NOTIFY_INVOKE_SECRET', 'short', 'INVOKE_SECRET_INVALID'],
    // The deploy check's charset: a space, a quote or a colon is refused at any length.
    ['NOTIFY_INVOKE_SECRET', `${'a'.repeat(40)} b`, 'INVOKE_SECRET_INVALID'],
    ['NOTIFY_INVOKE_SECRET', `${'a'.repeat(40)}:`, 'INVOKE_SECRET_INVALID'],
    ['RESEND_API_KEY', '', 'RESEND_API_KEY_MISSING'],
    ['RESEND_API_KEY', 'sb_secret_test', 'RESEND_API_KEY_INVALID'],
    ['NOTIFY_EMAIL_FROM', '  ', 'EMAIL_FROM_MISSING'],
    ['NOTIFY_EMAIL_FROM', 'obavijesti', 'EMAIL_FROM_INVALID'],
    ['NOTIFY_EMAIL_FROM', 'Shift obavijesti@example.org', 'EMAIL_FROM_INVALID'],
    ['NOTIFY_EMAIL_FROM', 'Shift <obavijesti>', 'EMAIL_FROM_INVALID'],
    ['SHIFT_APP_URL', '', 'APP_URL_MISSING'],
    ['SHIFT_APP_URL', 'ftp://example.org', 'APP_URL_INVALID'],
  ])('%s = %j answers %s', (name, value, code) => {
    const result = readConfiguration((key) => (key === name ? value : ENVIRONMENT[key]));

    expect(result).toEqual({ ok: false, code });
  });

  it.each([
    ['VAPID_PUBLIC_KEY', '', 'VAPID_PUBLIC_KEY_MISSING'],
    ['VAPID_PUBLIC_KEY', 'a'.repeat(43), 'VAPID_PUBLIC_KEY_INVALID'],
    ['VAPID_PRIVATE_KEY', ' ', 'VAPID_PRIVATE_KEY_MISSING'],
    ['VAPID_PRIVATE_KEY', `B${'a'.repeat(86)}`, 'VAPID_PRIVATE_KEY_INVALID'],
    ['VAPID_SUBJECT', '', 'VAPID_SUBJECT_MISSING'],
    ['VAPID_SUBJECT', 'obavijesti@example.org', 'VAPID_SUBJECT_INVALID'],
    ['VAPID_SUBJECT', 'http://example.org', 'VAPID_SUBJECT_INVALID'],
  ])('%s = %j still starts the function, with push alone off (%s): email never depends on push', (name, value, code) => {
    const result = readConfiguration((key) => (key === name ? value : ENVIRONMENT[key]));

    expect(result.ok).toBe(true);
    expect(result.ok && result.configuration.vapid).toBeNull();
    expect(result.ok && result.configuration.vapidProblem).toBe(code);
  });

  it('reads the VAPID pair and subject when all three are set', () => {
    expect(configured.ok && configured.configuration.vapid).toEqual({
      publicKey: ENVIRONMENT['VAPID_PUBLIC_KEY'],
      privateKey: ENVIRONMENT['VAPID_PRIVATE_KEY'],
      subject: ENVIRONMENT['VAPID_SUBJECT'],
    });
    expect(configured.ok && configured.configuration.vapidProblem).toBeNull();
  });

  it.each(['obavijesti@example.org', 'Shift <obavijesti@example.org>', 'DVD Mladost <no-reply@mail.example.org>'])(
    'accepts %j as the sender',
    (from) => {
      expect(readConfiguration((key) => (key === 'NOTIFY_EMAIL_FROM' ? from : ENVIRONMENT[key])).ok).toBe(true);
    },
  );

  it('is handed every variable it reads but SUPABASE_URL by the deploy action', () => {
    // The deploy action writes one env file for both functions with a
    // heredoc; every name in it is a `NAME=` line. `SUPABASE_URL` is the
    // Edge Runtime's own and is never set.
    const action = readFileSync(join(repoRoot, '.github', 'actions', 'deploy', 'action.yml'), 'utf8');
    const heredoc = /cat > "\$env_file" <<EOF\n([\s\S]*?)\n\s*EOF/.exec(action)?.[1] ?? '';
    const written = [...heredoc.matchAll(/^\s*([A-Z][A-Z0-9_]*)=/gm)].map((match) => match[1] ?? '');
    expect(written.length, 'the deploy action writes no function secrets').toBeGreaterThan(0);

    const read: string[] = [];
    readConfiguration((name) => {
      read.push(name);
      return ENVIRONMENT[name];
    });
    expect(read.filter((name) => name !== 'SUPABASE_URL').filter((name) => !written.includes(name))).toEqual([]);

    const fromAction = readConfiguration((name) =>
      name === 'SUPABASE_URL' || written.includes(name) ? ENVIRONMENT[name] : undefined,
    );
    expect(fromAction.ok).toBe(true);
  });

  it('answers every request 500 with the code when misconfigured, claiming nothing', async () => {
    const { client, rpc } = fakeClient([]);
    const handle = createHandler({ ok: false, code: 'RESEND_API_KEY_MISSING' }, {
      makeClient: () => client,
      fetch: provider(200),
    });

    const response = await handle(invoke());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ code: 'RESEND_API_KEY_MISSING' });
    expect(rpc).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------- the bad caller

describe('notify refuses any caller without the invoke secret, before anything is claimed', () => {
  it.each([
    ['no Authorization header', null],
    ['an empty bearer', ''],
    ['a wrong secret of the same length', 'j'.repeat(INVOKE_SECRET.length)],
    ['a prefix of the secret', INVOKE_SECRET.slice(0, -1)],
    ['the secret and more', `${INVOKE_SECRET}x`],
  ])('answers 401 to %s', async (_label, token) => {
    const { client, rpc } = fakeClient([row()]);
    const makeClient = vi.fn(() => client);
    const fetch = provider(200);
    const handle = createHandler(configured, { makeClient, fetch });

    const response = await handle(invoke(token));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ code: INVOKE_SECRET_REFUSED });
    expect(makeClient).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('answers 405 to anything but POST', async () => {
    const { client } = fakeClient([]);
    const handle = createHandler(configured, { makeClient: () => client, fetch: provider(200) });

    const response = await handle(invoke(INVOKE_SECRET, 'GET'));

    expect(response.status).toBe(405);
    expect(await response.json()).toMatchObject({ code: METHOD_NOT_ALLOWED });
  });

  it('compares the secret over its whole length (constant time), both polarities', () => {
    expect(sameSecret(INVOKE_SECRET, INVOKE_SECRET)).toBe(true);
    expect(sameSecret(`${INVOKE_SECRET.slice(0, -1)}j`, INVOKE_SECRET)).toBe(false);
    expect(sameSecret('', INVOKE_SECRET)).toBe(false);
    expect(sameSecret(INVOKE_SECRET, '')).toBe(false);
    expect(sameSecret('', '')).toBe(true);
  });

  it('accepts the scheme in any case', async () => {
    const { client, rpc } = fakeClient([]);
    const handle = createHandler(configured, { makeClient: () => client, fetch: provider(200) });

    const response = await handle(
      new Request('http://localhost/', { method: 'POST', headers: { Authorization: `bearer ${INVOKE_SECRET}` } }),
    );

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(CLAIM_RPC, { p_limit: BATCH_SIZE });
  });
});

// ----------------------------------------------------- the matrix, transport

describe("notify's matrix against a fake client: one send per row, settled by the provider's answer", () => {
  it('sends one email per claimed row with the row id as the Idempotency-Key, and settles it sent with its lease token', async () => {
    const claimed = row();
    const { client, settles, tokens } = fakeClient([claimed]);
    const fetch = provider(200);

    const response = await handlerOf(client, fetch)(invoke());

    expect(await response.json()).toEqual({
      code: NOTIFY_RAN,
      claimed: 1,
      sent: 1,
      failed: 0,
      retried: 0,
      released: 0,
      unsettled: 0,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(RESEND_ENDPOINT);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe(claimed.id);
    expect(headers['Authorization']).toBe('Bearer re_test');
    expect(JSON.parse(String(init?.body))).toEqual({
      from: ENVIRONMENT['NOTIFY_EMAIL_FROM'],
      to: ['ana@example.org'],
      subject: 'Zahtjev za godišnji 02.03.2046–06.03.2046 je odobren',
      text: `${ORGANIZATION_NAME}: tvoj zahtjev za godišnji odmor 02.03.2046–06.03.2046 je odobren. Pogledaj ga u aplikaciji: ${linkTo('/godisnji')}${FOOTER}`,
    });
    expect(settles).toEqual([{ p_id: claimed.id, p_result: 'sent', p_failure_code: null }]);
    expect(tokens).toEqual([claimed.claimed_at]);
  });

  it.each([null, '', '   '])('makes no call for a recipient with email %j, and fails the row RECIPIENT_NO_EMAIL', async (email) => {
    const claimed = row({ email });
    const { client, settles } = fakeClient([claimed]);
    const fetch = provider(200);

    await handlerOf(client, fetch)(invoke());

    expect(fetch).not.toHaveBeenCalled();
    expect(settles).toEqual([{ p_id: claimed.id, p_result: 'permanent', p_failure_code: RECIPIENT_NO_EMAIL }]);
  });

  it.each([
    ['a network error', 'network', NETWORK_ERROR],
    ['408', 408, PROVIDER_TIMEOUT],
    ['409', 409, PROVIDER_CONFLICT],
    ['429', 429, PROVIDER_RATE_LIMITED],
    ['500', 500, PROVIDER_UNAVAILABLE],
    ['503', 503, PROVIDER_UNAVAILABLE],
  ] as const)('releases the row as transient on %s', async (_label, answer, failureCode) => {
    const claimed = row();
    const { client, settles } = fakeClient([claimed]);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await handlerOf(client, provider(answer))(invoke());

    expect(settles).toEqual([{ p_id: claimed.id, p_result: 'transient', p_failure_code: failureCode }]);
    expect(await response.json()).toMatchObject({ retried: 1, sent: 0 });
    if (answer !== 'network') {
      // The status and the row id, never the body or the address.
      expect(errors).toHaveBeenCalledWith('PROVIDER_STATUS', claimed.id, answer);
      expect(JSON.stringify(errors.mock.calls)).not.toContain('ana@example.org');
    }
    errors.mockRestore();
  });

  it.each([400, 404, 413, 418, 422])('fails the row PROVIDER_REFUSED on %i, never retried', async (status) => {
    const claimed = row();
    const { client, settles } = fakeClient([claimed]);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await handlerOf(client, provider(status))(invoke());

    expect(settles).toEqual([{ p_id: claimed.id, p_result: 'permanent', p_failure_code: PROVIDER_REFUSED }]);
    expect(errors).toHaveBeenCalledWith('PROVIDER_STATUS', claimed.id, status);
    errors.mockRestore();
  });

  it.each([401, 403])('stops the run on %i and gives every held row back without spending its attempt', async (status) => {
    const rows = [row(), row(), row()];
    const { client, settles } = fakeClient(rows);
    const fetch = provider(status);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await handlerOf(client, fetch)(invoke());

    expect(fetch, 'the run went on sending with a refused key').toHaveBeenCalledTimes(1);
    expect(settles).toEqual(
      rows.map((claimed) => ({ p_id: claimed.id, p_result: 'released', p_failure_code: PROVIDER_UNAUTHORIZED })),
    );
    expect(await response.json()).toMatchObject({ released: 3, sent: 0, failed: 0, stopped: PROVIDER_UNAUTHORIZED });
    errors.mockRestore();
  });

  it('maps every status class once', () => {
    expect(deliveryOfStatus(200)).toEqual({ result: 'sent' });
    expect(deliveryOfStatus(202)).toEqual({ result: 'sent' });
    expect(deliveryOfStatus(401)).toEqual({ result: 'stop', failureCode: PROVIDER_UNAUTHORIZED });
    expect(deliveryOfStatus(403)).toEqual({ result: 'stop', failureCode: PROVIDER_UNAUTHORIZED });
    expect(deliveryOfStatus(408)).toEqual({ result: 'transient', failureCode: PROVIDER_TIMEOUT });
    expect(deliveryOfStatus(409)).toEqual({ result: 'transient', failureCode: PROVIDER_CONFLICT });
    expect(deliveryOfStatus(429)).toEqual({ result: 'transient', failureCode: PROVIDER_RATE_LIMITED });
    expect(deliveryOfStatus(418)).toEqual({ result: 'permanent', failureCode: PROVIDER_REFUSED });
    expect(deliveryOfStatus(502)).toEqual({ result: 'transient', failureCode: PROVIDER_UNAVAILABLE });
  });

  it('retries a row whose code it cannot render yet (a newer migration before the newer function), without a call', async () => {
    const claimed = row({ code: 'NOT_A_MESSAGE' });
    const { client, settles } = fakeClient([claimed]);
    const fetch = provider(200);

    await handlerOf(client, fetch)(invoke());

    expect(fetch).not.toHaveBeenCalled();
    expect(settles).toEqual([{ p_id: claimed.id, p_result: 'transient', p_failure_code: MESSAGE_UNKNOWN }]);
  });

  it('settles a batch of mixed results, each by its own answer', async () => {
    const rows = [row(), row({ email: null }), row(), row({ code: 'NOT_A_MESSAGE' }), row()];
    const answers = [200, 503, 422];
    let call = 0;
    const fetch = vi.fn<Fetch>(() => Promise.resolve(new Response(null, { status: answers[call++] ?? 200 })));
    const { client, settles } = fakeClient(rows);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await handlerOf(client, fetch)(invoke());

    expect(settles.map(({ p_result, p_failure_code }) => `${String(p_result)}:${String(p_failure_code)}`)).toEqual([
      'sent:null',
      `permanent:${RECIPIENT_NO_EMAIL}`,
      `transient:${PROVIDER_UNAVAILABLE}`,
      `transient:${MESSAGE_UNKNOWN}`,
      `permanent:${PROVIDER_REFUSED}`,
    ]);
    expect(await response.json()).toMatchObject({ claimed: 5, sent: 1, failed: 2, retried: 2, released: 0, unsettled: 0 });
    errors.mockRestore();
  });

  it('paces sends at least PACE_MS apart', async () => {
    let clock = 0;
    const waits: number[] = [];
    const { client } = fakeClient([row(), row(), row()]);
    const handle = createHandler(configured, {
      makeClient: () => client,
      fetch: provider(200),
      now: () => clock,
      sleep: (ms) => {
        waits.push(ms);
        clock += ms;
        return Promise.resolve();
      },
    });

    await handle(invoke());

    expect(waits).toEqual([PACE_MS, PACE_MS]);
  });

  it('stops sending past the run deadline, and gives the untried rows back without spending their attempt', async () => {
    let clock = 0;
    const rows = [row(), row(), row()];
    const { client, settles } = fakeClient(rows);
    // Each send takes most of the budget.
    const fetch = vi.fn<Fetch>(() => {
      clock += RUN_DEADLINE_MS - 1_000;
      return Promise.resolve(new Response(null, { status: 200 }));
    });

    const response = await handlerOf(client, fetch, () => clock)(invoke());

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(settles.map(({ p_result, p_failure_code }) => `${String(p_result)}:${String(p_failure_code)}`)).toEqual([
      'sent:null',
      'sent:null',
      `released:${RUN_DEADLINE}`,
    ]);
    expect(await response.json()).toMatchObject({ sent: 2, released: 1, stopped: RUN_DEADLINE });
  });

  it('keeps the worst case inside pg_net 55 s: the batch, the pace and the send timeout', () => {
    expect(BATCH_SIZE * (SEND_TIMEOUT_MS + PACE_MS)).toBeLessThan(55_000);
    expect(RUN_DEADLINE_MS + SEND_TIMEOUT_MS).toBeLessThan(55_000);
  });

  it.each([
    ['rejects', () => Promise.reject(new Error('socket hang up'))],
    ['answers an error', () => Promise.resolve({ data: null, error: { code: 'P0002', message: 'NOTIFICATION_NOT_CLAIMED' } })],
  ] as const)('goes on to the next row when a settle %s, counting it unsettled', async (_label, failing) => {
    const rows = [row(), row()];
    const { client, settles } = fakeClient(rows, (index) =>
      index === 0 ? (failing() as Promise<RpcAnswer>) : Promise.resolve({ data: null, error: null }),
    );
    const fetch = provider(200);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await handlerOf(client, fetch)(invoke());

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(settles).toHaveLength(2);
    expect(await response.json()).toMatchObject({ claimed: 2, sent: 1, unsettled: 1 });
    expect(errors).toHaveBeenCalledWith('SETTLE_FAILED', rows[0]?.id);
    errors.mockRestore();
  });

  it('fails a malformed row ROW_INVALID when it has an id, and counts one with none unsettled', async () => {
    const good = row();
    const { client, settles } = fakeClient([{ id: 'abc', claimed_at: 'token' }, { nothing: true }, null, good]);
    const fetch = provider(200);

    const response = await handlerOf(client, fetch)(invoke());

    expect(settles).toEqual([
      { p_id: 'abc', p_result: 'permanent', p_failure_code: ROW_INVALID },
      { p_id: good.id, p_result: 'sent', p_failure_code: null },
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await response.json()).toMatchObject({ claimed: 1, sent: 1, failed: 1, unsettled: 2 });
  });

  it('answers 500 CLAIM_FAILED and sends nothing when the claim fails, throws, or answers no list', async () => {
    const throwing: OutboxClient = { rpc: () => Promise.reject(new Error('fetch failed')) };
    const errored = fakeClient({ data: null, error: { code: '42501', message: 'permission denied' } }).client;
    const notAList = fakeClient({ data: { rows: [] }, error: null }).client;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    for (const client of [throwing, errored, notAList]) {
      const fetch = provider(200);
      const response = await handlerOf(client, fetch)(invoke());

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ code: CLAIM_FAILED });
      expect(fetch).not.toHaveBeenCalled();
    }
    errors.mockRestore();
  });

  it('answers 500 CLIENT_CONSTRUCTION_FAILED, logging the code alone', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const handle = createHandler(configured, {
      makeClient: () => {
        throw new Error('bad key sb_secret_test');
      },
      fetch: provider(200),
    });

    const response = await handle(invoke());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ code: CLIENT_CONSTRUCTION_FAILED });
    expect(errors.mock.calls).toEqual([[CLIENT_CONSTRUCTION_FAILED]]);
    errors.mockRestore();
  });
});

describe('notify may not think: it reaches the database through its three RPCs alone', () => {
  const sources = readdirSync(notifyRoot)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => ({ name, source: readFileSync(join(notifyRoot, name), 'utf8') }));

  it('holds the four files the spec names', () => {
    expect(sources.map(({ name }) => name).sort()).toEqual(['deno-runtime.d.ts', 'handler.ts', 'index.ts', 'messages.ts']);
  });

  it.each(sources)('$name reads no table directly and imports no domain code', ({ source }) => {
    expect(source).not.toMatch(/\.from\(/);
    expect(source).not.toMatch(/from\s+['"][^'"]*(@shift\/domain|packages\/domain|apps\/web)/);
  });

  it('names exactly claim_notifications, settle_notification and delete_push_subscription', () => {
    expect([CLAIM_RPC, SETTLE_RPC, DELETE_SUBSCRIPTION_RPC]).toEqual([
      'claim_notifications',
      'settle_notification',
      'delete_push_subscription',
    ]);
    // Every RPC the handler names is one of the three.
    const handler = sources.find(({ name }) => name === 'handler.ts')?.source ?? '';
    const called = [...handler.matchAll(/client\.rpc\((\w+)/g)].map((match) => match[1]);
    expect(new Set(called)).toEqual(new Set(['CLAIM_RPC', 'SETTLE_RPC', 'DELETE_SUBSCRIPTION_RPC']));
  });

  it('reads the VAPID keys in notify alone, and sends push through web-push in index.ts only (AD-17)', () => {
    const index = sources.find(({ name }) => name === 'index.ts')?.source ?? '';
    const handler = sources.find(({ name }) => name === 'handler.ts')?.source ?? '';
    expect(index).toMatch(/from 'npm:web-push@\d+\.\d+\.\d+'/);
    expect(index).toContain('generateRequestDetails');
    // The builder only: the send is the handler's own fetch, asserted here.
    expect(index).not.toContain('sendNotification');
    expect(handler).not.toMatch(/from\s+['"]npm:web-push/);
    for (const name of ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']) expect(handler).toContain(`'${name}'`);
  });
});

// -------------------------------------------------------- the matrix, live

/**
 * The secret-key client, played by a `pg` connection: each RPC runs as
 * `service_role` (the role a `sb_secret_*` request takes) inside a savepoint,
 * so a refusal answers `{ error }` as PostgREST would and the transaction goes
 * on.
 */
function serviceRoleClient(client: Client): OutboxClient {
  return {
    async rpc(fn, args) {
      await client.query('savepoint notify_rpc');
      try {
        await client.query('set local role service_role');
        let data: unknown = null;
        if (fn === CLAIM_RPC) {
          // The lease token as TEXT, as PostgREST serializes it: a JS Date
          // would drop the microseconds and never match again.
          data = (
            await client.query(
              `select id::text as id, code, subject_id::text as subject_id, channel, operands, attempts,
                      claimed_at::text as claimed_at, email, locale, timezone, slug, organization_name, subscriptions
                 from public.claim_notifications($1)`,
              [args['p_limit']],
            )
          ).rows;
        } else if (fn === DELETE_SUBSCRIPTION_RPC) {
          await client.query('select public.delete_push_subscription($1::uuid, $2, $3::uuid)', [
            args['p_id'],
            args['p_endpoint'],
            args['p_member'],
          ]);
        } else {
          await client.query('select public.settle_notification($1::uuid, $2::timestamptz, $3, $4)', [
            args['p_id'],
            args['p_claimed_at'],
            args['p_result'],
            args['p_failure_code'],
          ]);
        }
        await client.query('release savepoint notify_rpc');
        await client.query('reset role');
        return { data, error: null };
      } catch (cause) {
        await client.query('rollback to savepoint notify_rpc');
        await client.query('reset role');
        const error = cause as { code?: string; message?: string };
        return { data: null, error: { code: error.code ?? '', message: error.message ?? '' } };
      }
    },
  };
}

interface OutboxState {
  attempts: number;
  claimed: boolean;
  sent: boolean;
  failed: boolean;
  failureCode: string | null;
}

async function stateOf(client: Client, id: string): Promise<OutboxState> {
  const { rows } = await client.query<OutboxState>(
    `select attempts, claimed_at is not null as claimed, sent_at is not null as sent,
            failed_at is not null as failed, failure_code as "failureCode"
       from notification_outbox where id = $1`,
    [id],
  );
  const found = rows[0];
  if (found === undefined) throw new Error(`outbox row ${id} is not in the database`);
  return found;
}

/**
 * The fixture's member-role account with `email` set, one outbox row for it
 * written as the owner, and every OTHER open row in the database hidden for
 * the rest of the (rolled-back) transaction, so the claim sees this case's
 * rows alone.
 */
async function arrange(
  client: Client,
  slug: string,
  username: string,
  email: string | null,
): Promise<{ organization: string; member: string; insert: (code?: string) => Promise<string> }> {
  await client.query(
    `update notification_outbox set failed_at = now(), failure_code = 'HIDDEN_BY_TEST'
      where sent_at is null and failed_at is null`,
  );
  const organization = await organizationId(client, slug);
  const { rows } = await client.query<{ id: string }>(
    'update members set email = $3 where organization_id = $1 and username = $2 returning id::text as id',
    [organization, username, email],
  );
  const member = rows[0]?.id;
  if (member === undefined) throw new Error(`${slug} has no member ${username}`);

  const insert = async (code = 'LEAVE_REQUEST_APPROVED'): Promise<string> => {
    const { rows: inserted } = await client.query<{ id: string }>(
      `insert into notification_outbox (organization_id, code, subject_id, recipient_member_id, channel, operands)
       values ($1, $2, gen_random_uuid(), $3, 'email', '{"startDate":"2046-03-02","endDate":"2046-03-06"}')
       returning id::text as id`,
      [organization, code, member],
    );
    const id = inserted[0]?.id;
    if (id === undefined) throw new Error('outbox insert returned no row');
    return id;
  };

  return { organization, member, insert };
}

describe("notify's matrix against the real claim and settle (0042)", () => {
  const run = (client: Client, fetch: Fetch): Promise<Response> =>
    createHandler(configured, { makeClient: () => serviceRoleClient(client), fetch, sleep: instantly })(invoke());

  /** Time passes: every backoff in this case's transaction is over. */
  const backoffOver = (client: Client): Promise<unknown> =>
    client.query('update notification_outbox set next_attempt_at = null where next_attempt_at is not null');

  it.skipIf(noDatabase).each(FIXTURES)('sends a $fixture row once and marks it sent', async ({ slug, member }) => {
    await inRolledBackTransaction(async (client) => {
      const { insert } = await arrange(client, slug, member, 'member@example.org');
      const id = await insert();
      const fetch = provider(200);

      const response = await run(client, fetch);

      expect(await response.json(), slug).toMatchObject({ code: NOTIFY_RAN, claimed: 1, sent: 1 });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect((fetch.mock.calls[0]?.[1]?.headers as Record<string, string>)['Idempotency-Key']).toBe(id);
      expect(await stateOf(client, id)).toEqual({ attempts: 1, claimed: true, sent: true, failed: false, failureCode: null });

      // Sent is final: the next run claims nothing.
      const again = provider(200);
      expect(await (await run(client, again)).json()).toMatchObject({ claimed: 0 });
      expect(again).not.toHaveBeenCalled();
    });
  });

  it.skipIf(noDatabase).each(FIXTURES)(
    "claims a $fixture row with the organization's name and slug, and the email names it and links through them (0043)",
    async ({ slug, member }) => {
      await inRolledBackTransaction(async (client) => {
        const { organization, insert } = await arrange(client, slug, member, 'member@example.org');
        await insert();
        const { rows: stored } = await client.query<{ name: string; slug: string }>(
          'select name, slug from organizations where id = $1',
          [organization],
        );
        const claimed = await serviceRoleClient(client).rpc(CLAIM_RPC, { p_limit: 10 });
        const [row] = (claimed.data ?? []) as { organization_name: string; slug: string }[];

        expect(row, slug).toMatchObject({ organization_name: stored[0]?.name, slug: stored[0]?.slug });

        await client.query('update notification_outbox set claimed_at = null, attempts = 0 where organization_id = $1', [organization]);
        const fetch = provider(200);
        await run(client, fetch);
        const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)) as { text: string };
        expect(body.text.startsWith(`${stored[0]?.name ?? '?'}: `), `${slug}: the email does not open with the organization`).toBe(true);
        expect(body.text, slug).toContain(`/prijava/${slug}?povratak=%2Fgodisnji`);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'makes no call for a $fixture member with no address, and fails the row RECIPIENT_NO_EMAIL',
    async ({ slug, member }) => {
      await inRolledBackTransaction(async (client) => {
        const { insert } = await arrange(client, slug, member, null);
        const id = await insert();
        const fetch = provider(200);

        await run(client, fetch);

        expect(fetch).not.toHaveBeenCalled();
        expect(await stateOf(client, id)).toMatchObject({ sent: false, failed: true, failureCode: RECIPIENT_NO_EMAIL });
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'releases a $fixture row on a transient failure with the code kept, and fails it ATTEMPTS_EXHAUSTED on the fifth',
    async ({ slug, member }) => {
      await inRolledBackTransaction(async (client) => {
        const { insert } = await arrange(client, slug, member, 'member@example.org');
        const id = await insert();

        await run(client, provider(503));
        expect(await stateOf(client, id)).toEqual({
          attempts: 1,
          claimed: false,
          sent: false,
          failed: false,
          failureCode: PROVIDER_UNAVAILABLE,
        });

        // The backoff: not claimed again before attempts x 10 minutes.
        const { rows: backoff } = await client.query<{ minutes: number }>(
          `select extract(epoch from next_attempt_at - now())::int / 60 as minutes from notification_outbox where id = $1`,
          [id],
        );
        expect(backoff[0]?.minutes).toBe(10);
        const tooSoon = provider(200);
        await run(client, tooSoon);
        expect(tooSoon, `${slug}: a row was claimed inside its backoff`).not.toHaveBeenCalled();

        for (let attempt = 2; attempt <= 4; attempt += 1) {
          await backoffOver(client);
          await run(client, provider(429));
        }
        const { rows: longer } = await client.query<{ minutes: number }>(
          `select extract(epoch from next_attempt_at - now())::int / 60 as minutes from notification_outbox where id = $1`,
          [id],
        );
        expect(longer[0]?.minutes, 'the backoff does not grow with the attempts').toBe(40);
        expect(await stateOf(client, id)).toMatchObject({ attempts: 4, failed: false, failureCode: PROVIDER_RATE_LIMITED });

        await backoffOver(client);
        const fifth = provider('network');
        await run(client, fifth);
        expect(fifth).toHaveBeenCalledTimes(1);
        expect(await stateOf(client, id)).toMatchObject({ attempts: 5, failed: true, failureCode: ATTEMPTS_EXHAUSTED });

        await backoffOver(client);
        const sixth = provider(200);
        await run(client, sixth);
        expect(sixth, `${slug}: a sixth attempt was made`).not.toHaveBeenCalled();
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)('fails a $fixture row PROVIDER_REFUSED on a 4xx, never retried', async ({ slug, member }) => {
    await inRolledBackTransaction(async (client) => {
      const { insert } = await arrange(client, slug, member, 'member@example.org');
      const id = await insert();

      await run(client, provider(422));
      const again = provider(200);
      await run(client, again);

      expect(await stateOf(client, id)).toMatchObject({ attempts: 1, failed: true, failureCode: PROVIDER_REFUSED });
      expect(again).not.toHaveBeenCalled();
    });
  });

  it.skipIf(noDatabase).each(FIXTURES)(
    're-claims a $fixture row whose claim is older than 10 minutes, with the same Idempotency-Key, and leaves a younger one',
    async ({ slug, member }) => {
      await inRolledBackTransaction(async (client) => {
        const { insert } = await arrange(client, slug, member, 'member@example.org');
        const crashed = await insert();
        const running = await insert('LEAVE_REQUEST_REJECTED');
        // A run that claimed both and died before settling: one long ago, one
        // still within its lease.
        await client.query(
          `update notification_outbox set attempts = 1,
                  claimed_at = case when id = $1 then now() - interval '11 minutes' else now() - interval '9 minutes' end
            where id in ($1, $2)`,
          [crashed, running],
        );
        const fetch = provider(200);

        await run(client, fetch);

        expect(fetch).toHaveBeenCalledTimes(1);
        expect((fetch.mock.calls[0]?.[1]?.headers as Record<string, string>)['Idempotency-Key']).toBe(crashed);
        expect(await stateOf(client, crashed)).toMatchObject({ attempts: 2, sent: true });
        expect(await stateOf(client, running)).toMatchObject({ attempts: 1, claimed: true, sent: false, failed: false });
      });
    },
  );

  it.skipIf(noDatabase)('fails, never re-sends, a row whose lease expired on its fifth attempt', async () => {
    const [{ slug, member }] = FIXTURES;
    await inRolledBackTransaction(async (client) => {
      const { insert } = await arrange(client, slug, member, 'member@example.org');
      const id = await insert();
      await client.query(
        `update notification_outbox set attempts = 5, claimed_at = now() - interval '11 minutes' where id = $1`,
        [id],
      );
      const fetch = provider(200);

      await run(client, fetch);

      expect(fetch).not.toHaveBeenCalled();
      expect(await stateOf(client, id)).toMatchObject({ failed: true, failureCode: ATTEMPTS_EXHAUSTED });
    });
  });

  it.skipIf(noDatabase)('returns the address, locale, timezone and slug with each claimed row', async () => {
    const [{ slug, member }] = FIXTURES;
    await inRolledBackTransaction(async (client) => {
      const { insert, organization } = await arrange(client, slug, member, 'member@example.org');
      const id = await insert();

      const answer = await serviceRoleClient(client).rpc(CLAIM_RPC, { p_limit: 10 });

      expect(answer.error).toBeNull();
      const { rows: expected } = await client.query<{ locale: string; timezone: string }>(
        'select locale, timezone from organizations where id = $1',
        [organization],
      );
      expect(answer.data).toEqual([
        expect.objectContaining({
          id,
          code: 'LEAVE_REQUEST_APPROVED',
          channel: 'email',
          attempts: 1,
          email: 'member@example.org',
          locale: expected[0]?.locale,
          timezone: expected[0]?.timezone,
          slug,
        }),
      ]);
    });
  });

  it.skipIf(noDatabase).each(FIXTURES)(
    'gives a $fixture row back without spending its attempt when the provider refuses the key, and sends it next run',
    async ({ slug, member }) => {
      await inRolledBackTransaction(async (client) => {
        const { insert } = await arrange(client, slug, member, 'member@example.org');
        const first = await insert();
        const second = await insert('LEAVE_REQUEST_REJECTED');
        const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        const refused = provider(401);
        await run(client, refused);
        errors.mockRestore();

        expect(refused).toHaveBeenCalledTimes(1);
        for (const id of [first, second]) {
          expect(await stateOf(client, id), slug).toEqual({
            attempts: 0,
            claimed: false,
            sent: false,
            failed: false,
            failureCode: PROVIDER_UNAUTHORIZED,
          });
        }

        const fixed = provider(200);
        await run(client, fixed);
        expect(fixed).toHaveBeenCalledTimes(2);
        expect(await stateOf(client, first)).toMatchObject({ attempts: 1, sent: true });
      });
    },
  );

  it.skipIf(noDatabase)('refuses a stale lease: a run whose row was re-claimed settles nothing (P0002)', async () => {
    const [{ slug, member }] = FIXTURES;
    await inRolledBackTransaction(async (client) => {
      const { insert } = await arrange(client, slug, member, 'member@example.org');
      const id = await insert();
      const rpc = serviceRoleClient(client);

      const firstClaim = (await rpc.rpc(CLAIM_RPC, { p_limit: 1 })).data as { claimed_at: string }[];
      const stale = firstClaim[0]?.claimed_at;
      // The first run's lease expires, and a second run claims the row.
      await client.query(`update notification_outbox set claimed_at = now() - interval '11 minutes' where id = $1`, [id]);
      const secondClaim = (await rpc.rpc(CLAIM_RPC, { p_limit: 1 })).data as { claimed_at: string }[];
      const fresh = secondClaim[0]?.claimed_at;

      const late = await rpc.rpc(SETTLE_RPC, { p_id: id, p_claimed_at: stale, p_result: 'sent', p_failure_code: null });
      const current = await rpc.rpc(SETTLE_RPC, { p_id: id, p_claimed_at: fresh, p_result: 'sent', p_failure_code: null });

      expect(fresh).not.toBe(stale);
      expect(late.error).toMatchObject({ code: 'P0002', message: 'NOTIFICATION_NOT_CLAIMED' });
      expect(current.error).toBeNull();
      expect(await stateOf(client, id)).toMatchObject({ attempts: 2, sent: true });
    });
  });

  it.skipIf(noDatabase)('guards the claim and the settle with named refusals', async () => {
    const [{ slug, member }] = FIXTURES;
    await inRolledBackTransaction(async (client) => {
      const { insert } = await arrange(client, slug, member, 'member@example.org');
      const unclaimed = await insert();
      const settled = await insert('LEAVE_REQUEST_REJECTED');
      const rpc = serviceRoleClient(client);
      const settle = (id: string, token: unknown, result: unknown, code: unknown) =>
        rpc.rpc(SETTLE_RPC, { p_id: id, p_claimed_at: token, p_result: result, p_failure_code: code });

      const limits: Record<string, unknown> = {};
      for (const limit of [0, -1, 101, null]) {
        limits[String(limit)] = (await rpc.rpc(CLAIM_RPC, { p_limit: limit })).error;
      }
      const inRange = await rpc.rpc(CLAIM_RPC, { p_limit: 100 });
      const claimedRows = inRange.data as { id: string; claimed_at: string }[];
      const token = (id: string) => claimedRows.find((claimed) => claimed.id === id)?.claimed_at;
      await settle(settled, token(settled), 'sent', null);
      // Back to unclaimed, keeping the other row's lease for the guards below.
      await client.query('update notification_outbox set claimed_at = null where id = $1', [unclaimed]);

      const answers = {
        unknownResult: (await settle(settled, token(settled), 'delivered', null)).error,
        noFailureCode: (await settle(settled, token(settled), 'transient', null)).error,
        badFailureCode: (await settle(settled, token(settled), 'permanent', 'not a code')).error,
        unclaimed: (await settle(unclaimed, token(unclaimed), 'sent', null)).error,
        alreadySettled: (await settle(settled, token(settled), 'sent', null)).error,
      };

      for (const refusal of Object.values(limits)) {
        expect(refusal).toMatchObject({ code: '22023', message: 'NOTIFICATION_LIMIT_INVALID' });
      }
      expect(inRange.error).toBeNull();
      expect(answers).toEqual({
        unknownResult: { code: '22023', message: 'NOTIFICATION_RESULT_UNKNOWN' },
        noFailureCode: { code: '22023', message: 'NOTIFICATION_FAILURE_CODE_INVALID' },
        badFailureCode: { code: '22023', message: 'NOTIFICATION_FAILURE_CODE_INVALID' },
        unclaimed: { code: 'P0002', message: 'NOTIFICATION_NOT_CLAIMED' },
        alreadySettled: { code: 'P0002', message: 'NOTIFICATION_NOT_CLAIMED' },
      });
    });
  });

  it.skipIf(noDatabase)('claims email and push rows, and no other channel (0045)', async () => {
    const [{ slug, member }] = FIXTURES;
    await inRolledBackTransaction(async (client) => {
      const { insert } = await arrange(client, slug, member, 'member@example.org');
      const id = await insert();
      // A channel nobody writes, past the check for this probe only.
      await client.query('alter table notification_outbox drop constraint notification_outbox_channel_check');
      await client.query(`update notification_outbox set channel = 'sms' where id = $1`, [id]);

      const answer = await serviceRoleClient(client).rpc(CLAIM_RPC, { p_limit: 10 });

      expect(answer.data).toEqual([]);
    });
  });
});

// ---------------------------------------------------------- story 10.4: push

/** A device's keys, in the shapes 0045 checks (65 and 16 bytes, unpadded base64url). */
const P256DH = `B${'k'.repeat(86)}`;
const AUTH = 'a'.repeat(22);

/**
 * A fake `web-push`: the request it would build, with a VAPID header and an
 * `aes128gcm` body, recording each payload it was asked to encrypt.
 */
function fakeEncryptor(): { encryptPush: PushEncryptor; payloads: string[]; ttls: number[] } {
  const payloads: string[] = [];
  const ttls: number[] = [];
  const encryptPush: PushEncryptor = (subscription, payload, options) => {
    payloads.push(payload);
    ttls.push(options.ttl);
    return {
      endpoint: subscription.endpoint,
      headers: {
        TTL: String(options.ttl),
        'Content-Type': 'application/octet-stream',
        'Content-Encoding': 'aes128gcm',
        Authorization: `vapid t=jwt-for-${new URL(subscription.endpoint).origin}, k=${options.vapid.publicKey}`,
      },
      body: new TextEncoder().encode(`encrypted:${subscription.keys.p256dh}:${subscription.keys.auth}`),
    };
  };
  return { encryptPush, payloads, ttls };
}

const DEVICE_MEMBER = crypto.randomUUID();

function device(index: number): { id: string; endpoint: string; p256dh: string; auth: string; member_id: string } {
  return {
    member_id: DEVICE_MEMBER,
    id: crypto.randomUUID(),
    endpoint: `https://fcm.googleapis.com/fcm/send/device-${index}`,
    p256dh: P256DH,
    auth: AUTH,
  };
}

const SUBJECT_ID = crypto.randomUUID();

/** What a delete must match: the id, the endpoint and the member the claim returned. */
const deleteOf = (target: { id: string; endpoint: string; member_id: string }) => ({
  p_id: target.id,
  p_endpoint: target.endpoint,
  p_member: target.member_id,
});

function pushRow(devices: readonly unknown[] | null, overrides: Partial<FakeRow> = {}): FakeRow {
  return row({ channel: 'push', email: null, subscriptions: devices, subject_id: SUBJECT_ID, ...overrides });
}

/** A push service answering each endpoint with its own status. */
function pushServices(answers: Readonly<Record<string, number | 'network'>>): ReturnType<typeof vi.fn<Fetch>> {
  return vi.fn<Fetch>((url) => {
    const answer = answers[url] ?? 201;
    return answer === 'network'
      ? Promise.reject(new TypeError('fetch failed'))
      : Promise.resolve(new Response(null, { status: answer }));
  });
}

describe('notify renders a push payload from the same message, without the email footer (story 10.4)', () => {
  it.each(EVERY_CODE)('renders $code as the subject, the body and its link', ({ code, operands, path, subject, text }) => {
    expect(renderPush(code, 'hr', operands, TARGET)).toEqual({
      ok: true,
      title: subject,
      body: text.replace('{link}', linkTo(path)),
      url: linkTo(path),
    });
  });

  it('refuses what the email refuses', () => {
    expect(renderPush('SOMETHING_ELSE', 'hr', {}, TARGET)).toEqual({ ok: false, code: MESSAGE_UNKNOWN });
    expect(renderPush('LEAVE_REQUEST_APPROVED', 'hr', { startDate: '2046-03-02' }, TARGET)).toEqual({
      ok: false,
      code: OPERANDS_INVALID,
    });
  });
});

describe("notify's push matrix against a fake client and a fake web-push (story 10.4)", () => {
  const handlerWith = (client: OutboxClient, fetch: Fetch, encryptPush?: PushEncryptor) =>
    createHandler(configured, {
      makeClient: () => client,
      fetch,
      sleep: instantly,
      ...(encryptPush === undefined ? {} : { encryptPush }),
    });

  it('posts the encrypted payload with a VAPID header to every device, and settles the row sent', async () => {
    const devices = [device(1), device(2)];
    const claimed = pushRow(devices);
    const { client, settles, deletes } = fakeClient([claimed]);
    const fetch = pushServices({});
    const { encryptPush, payloads, ttls } = fakeEncryptor();

    const response = await handlerWith(client, fetch, encryptPush)(invoke());

    expect(await response.json()).toMatchObject({ claimed: 1, sent: 1, failed: 0, retried: 0 });
    expect(fetch.mock.calls.map(([url]) => url).sort()).toEqual(devices.map(({ endpoint }) => endpoint).sort());
    for (const [, init] of fetch.mock.calls) {
      const headers = init.headers as Record<string, string>;
      expect(init.method).toBe('POST');
      expect(headers['Authorization']).toMatch(new RegExp(`^vapid t=.+, k=${ENVIRONMENT['VAPID_PUBLIC_KEY'] ?? '?'}$`));
      expect(headers['Content-Encoding']).toBe('aes128gcm');
      expect(headers['TTL']).toBe(String(PUSH_TTL_SECONDS));
      // Never Resend's: no idempotency key, no email key.
      expect(headers['Idempotency-Key']).toBeUndefined();
      expect(JSON.stringify(headers)).not.toContain('re_test');
      expect(new TextDecoder().decode(init.body as Uint8Array)).toBe(`encrypted:${P256DH}:${AUTH}`);
    }
    expect(ttls).toEqual([PUSH_TTL_SECONDS, PUSH_TTL_SECONDS]);
    expect(payloads.map((payload) => JSON.parse(payload) as unknown)).toEqual([
      {
        title: 'Zahtjev za godišnji 02.03.2046–06.03.2046 je odobren',
        body: `${ORGANIZATION_NAME}: tvoj zahtjev za godišnji odmor 02.03.2046–06.03.2046 je odobren. Pogledaj ga u aplikaciji: ${linkTo('/godisnji')}`,
        url: linkTo('/godisnji'),
        // One notification per fact on a device: a re-send replaces it.
        tag: `LEAVE_REQUEST_APPROVED:${SUBJECT_ID}`,
      },
      expect.anything(),
    ]);
    expect(payloads[0]).toBe(payloads[1]);
    expect(payloads[0]).not.toContain('/obavijesti');
    expect(settles).toEqual([{ p_id: claimed.id, p_result: 'sent', p_failure_code: null }]);
    expect(deletes).toEqual([]);
  });

  it('deletes a device that answers 410 and settles the row sent when another accepted', async () => {
    const [gone, live] = [device(1), device(2)];
    const claimed = pushRow([gone, live]);
    const { client, settles, deletes } = fakeClient([claimed]);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await handlerWith(client, pushServices({ [gone.endpoint]: 410, [live.endpoint]: 201 }), fakeEncryptor().encryptPush)(invoke());

    expect(deletes).toEqual([deleteOf(gone)]);
    expect(settles).toEqual([{ p_id: claimed.id, p_result: 'sent', p_failure_code: null }]);
    // The row id and the status, never the endpoint (it carries the device's token).
    expect(errors).toHaveBeenCalledWith('PROVIDER_STATUS', claimed.id, 410);
    expect(JSON.stringify(errors.mock.calls)).not.toContain(gone.endpoint);
    errors.mockRestore();
  });

  it.each([404, 410])('deletes every device that answers %i and fails the row PUSH_SUBSCRIPTION_GONE', async (status) => {
    const only = device(1);
    const claimed = pushRow([only]);
    const { client, settles, deletes } = fakeClient([claimed]);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await handlerWith(client, pushServices({ [only.endpoint]: status }), fakeEncryptor().encryptPush)(invoke());

    expect(deletes).toEqual([deleteOf(only)]);
    expect(settles).toEqual([{ p_id: claimed.id, p_result: 'permanent', p_failure_code: PUSH_SUBSCRIPTION_GONE }]);
    errors.mockRestore();
  });

  it('retries a row no device accepted when one failed transiently, and never stops the run on a push 401 or 403', async () => {
    const [gone, busy] = [device(1), device(2)];
    const refused = device(3);
    const rows = [pushRow([gone, busy]), pushRow([refused]), row()];
    const { client, settles, deletes } = fakeClient(rows);
    const fetch = vi.fn<Fetch>((url) =>
      Promise.resolve(
        new Response(null, { status: url === gone.endpoint ? 410 : url === busy.endpoint ? 503 : url === refused.endpoint ? 403 : 200 }),
      ),
    );
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await handlerWith(client, fetch, fakeEncryptor().encryptPush)(invoke());

    expect(deletes).toEqual([deleteOf(gone)]);
    expect(settles.map(({ p_result, p_failure_code }) => `${String(p_result)}:${String(p_failure_code)}`)).toEqual([
      `transient:${PUSH_SERVICE_UNAVAILABLE}`,
      `transient:${PUSH_SERVICE_UNAUTHORIZED}`,
      'sent:null',
    ]);
    expect(await response.json()).not.toHaveProperty('stopped');
    errors.mockRestore();
  });

  it('fails a push row the claim returned with no device PUSH_NO_SUBSCRIPTION, with no call', async () => {
    const rows = [pushRow(null), pushRow([]), pushRow([{ id: 'x' }])];
    const { client, settles } = fakeClient(rows);
    const fetch = pushServices({});

    await handlerWith(client, fetch, fakeEncryptor().encryptPush)(invoke());

    expect(fetch).not.toHaveBeenCalled();
    expect(settles.map(({ p_failure_code }) => p_failure_code)).toEqual([
      PUSH_NO_SUBSCRIPTION,
      PUSH_NO_SUBSCRIPTION,
      PUSH_NO_SUBSCRIPTION,
    ]);
  });

  it('fails a device whose keys cannot encrypt, and retries a row it cannot render or encrypt at all', async () => {
    const broken = pushRow([device(1)]);
    const unknown = pushRow([device(2)], { code: 'NOT_A_MESSAGE' });
    const unwired = pushRow([device(3)]);
    const throwing: PushEncryptor = () => {
      throw new Error('bad key');
    };
    const fetch = pushServices({});

    const first = fakeClient([broken, unknown]);
    await handlerWith(first.client, fetch, throwing)(invoke());
    const second = fakeClient([unwired]);
    await handlerWith(second.client, fetch)(invoke());

    expect(fetch).not.toHaveBeenCalled();
    expect(first.settles.map(({ p_result, p_failure_code }) => `${String(p_result)}:${String(p_failure_code)}`)).toEqual([
      `permanent:${PUSH_SUBSCRIPTION_INVALID}`,
      `transient:${MESSAGE_UNKNOWN}`,
    ]);
    expect(second.settles).toEqual([{ p_id: unwired.id, p_result: 'transient', p_failure_code: PUSH_ENCRYPTOR_MISSING }]);
  });

  it('logs a failed delete with the subscription id alone, and still settles the row', async () => {
    const only = device(1);
    const claimed = pushRow([only]);
    const settles: unknown[] = [];
    const client: OutboxClient = {
      rpc: (fn, args) => {
        if (fn === CLAIM_RPC) return Promise.resolve({ data: [claimed], error: null });
        if (fn === DELETE_SUBSCRIPTION_RPC) return Promise.reject(new Error('down'));
        settles.push(args['p_failure_code']);
        return Promise.resolve({ data: null, error: null });
      },
    };
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await handlerWith(client, pushServices({ [only.endpoint]: 410 }), fakeEncryptor().encryptPush)(invoke());

    expect(errors).toHaveBeenCalledWith(PUSH_DELETE_FAILED, only.id);
    expect(settles).toEqual([PUSH_SUBSCRIPTION_GONE]);
    errors.mockRestore();
  });

  it.each([
    ['missing', undefined],
    ['malformed', 'not-a-key'],
  ])('sends email as before and retries a push row PUSH_NOT_CONFIGURED when the VAPID key is %s', async (_label, value) => {
    const unconfigured = readConfiguration((name) => (name === 'VAPID_PRIVATE_KEY' ? value : ENVIRONMENT[name]));
    if (!unconfigured.ok) throw new Error('a VAPID problem stopped the function');
    const email = row();
    const pushed = pushRow([device(1)]);
    const { client, settles } = fakeClient([email, pushed]);
    const fetch = provider(200);

    const response = await createHandler(unconfigured, {
      makeClient: () => client,
      fetch,
      sleep: instantly,
      encryptPush: fakeEncryptor().encryptPush,
    })(invoke());

    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe(RESEND_ENDPOINT);
    expect(settles).toEqual([
      { p_id: email.id, p_result: 'sent', p_failure_code: null },
      { p_id: pushed.id, p_result: 'transient', p_failure_code: PUSH_NOT_CONFIGURED },
    ]);
  });

  it('settles the row though a gone device\'s delete never answers, within the send timeout', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const only = device(1);
      const claimed = pushRow([only]);
      const settles: unknown[] = [];
      const client: OutboxClient = {
        rpc: (fn, args) => {
          if (fn === CLAIM_RPC) return Promise.resolve({ data: [claimed], error: null });
          if (fn === DELETE_SUBSCRIPTION_RPC) return new Promise<RpcAnswer>(() => undefined);
          settles.push(args['p_failure_code']);
          return Promise.resolve({ data: null, error: null });
        },
      };
      const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      const running = handlerWith(client, pushServices({ [only.endpoint]: 410 }), fakeEncryptor().encryptPush)(invoke());
      await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS + 1);
      await running;

      expect(settles).toEqual([PUSH_SUBSCRIPTION_GONE]);
      expect(errors).toHaveBeenCalledWith(PUSH_DELETE_FAILED, only.id);
      errors.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it('builds a real encrypted request through web-push 3.6.7 (the adapter index.ts wires)', () => {
    const vapid = webpush.generateVAPIDKeys();
    const browser = createECDH('prime256v1');
    browser.generateKeys();
    const encrypt = pushEncryptorOf(webpush.generateRequestDetails as Parameters<typeof pushEncryptorOf>[0]);

    const request = encrypt(
      {
        endpoint: 'https://fcm.googleapis.com/fcm/send/real',
        keys: { p256dh: browser.getPublicKey('base64url'), auth: randomBytes(16).toString('base64url') },
      },
      JSON.stringify({ title: 't', body: 'b', url: 'u', tag: 'x' }),
      { vapid: { subject: 'mailto:obavijesti@example.org', publicKey: vapid.publicKey, privateKey: vapid.privateKey }, ttl: PUSH_TTL_SECONDS },
    );

    expect(request.endpoint).toBe('https://fcm.googleapis.com/fcm/send/real');
    expect(request.headers['Authorization']).toMatch(new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${vapid.publicKey}$`));
    expect(request.headers['Content-Encoding']).toBe('aes128gcm');
    expect(request.headers['TTL']).toBe(String(PUSH_TTL_SECONDS));
    expect(Number.isInteger(Number(request.headers['TTL']))).toBe(true);
    expect(Object.keys(request.headers).map((name) => name.toLowerCase())).not.toContain('content-length');
    expect(request.body).toBeInstanceOf(Uint8Array);
    expect(request.body.length).toBeGreaterThan(0);
    // Encrypted: the plaintext is not in the body.
    expect(Buffer.from(request.body).toString('latin1')).not.toContain('"title"');
  });

  it('retries a row whose only device the network could not reach PUSH_NETWORK_ERROR, never Resend\'s code', async () => {
    const only = device(1);
    const claimed = pushRow([only]);
    const { client, settles } = fakeClient([claimed]);

    await handlerWith(client, pushServices({ [only.endpoint]: 'network' }), fakeEncryptor().encryptPush)(invoke());

    expect(settles).toEqual([{ p_id: claimed.id, p_result: 'transient', p_failure_code: PUSH_NETWORK_ERROR }]);
  });

  it('does not pace a push: only the emails wait for each other', async () => {
    let clock = 0;
    const waits: number[] = [];
    const { client } = fakeClient([row(), pushRow([device(1)]), pushRow([device(2)]), row()]);
    const handle = createHandler(configured, {
      makeClient: () => client,
      fetch: pushServices({}),
      encryptPush: fakeEncryptor().encryptPush,
      now: () => clock,
      sleep: (ms) => {
        waits.push(ms);
        clock += ms;
        return Promise.resolve();
      },
    });

    await handle(invoke());

    expect(waits).toEqual([PACE_MS]);
  });

  it('maps each push answer: accepted, gone, or the email classification but for 401 and 403', () => {
    expect(deviceOutcomeOfStatus(201)).toEqual({ result: 'accepted' });
    expect(deviceOutcomeOfStatus(404)).toEqual({ result: 'gone' });
    expect(deviceOutcomeOfStatus(410)).toEqual({ result: 'gone' });
    expect(deviceOutcomeOfStatus(413)).toEqual({ result: 'permanent', failureCode: PUSH_SERVICE_REFUSED });
    expect(deviceOutcomeOfStatus(429)).toEqual({ result: 'transient', failureCode: PUSH_SERVICE_RATE_LIMITED });
    expect(deviceOutcomeOfStatus(401)).toEqual({ result: 'transient', failureCode: PUSH_SERVICE_UNAUTHORIZED });
    expect(deviceOutcomeOfStatus(403)).toEqual({ result: 'transient', failureCode: PUSH_SERVICE_UNAUTHORIZED });
    expect(deviceOutcomeOfStatus(502)).toEqual({ result: 'transient', failureCode: PUSH_SERVICE_UNAVAILABLE });
    // Never Resend's codes: a failure says which channel failed.
    for (const status of [401, 403, 408, 409, 413, 429, 500, 503]) {
      expect(String((deviceOutcomeOfStatus(status) as { failureCode?: string }).failureCode)).toMatch(/^PUSH_/);
    }

    expect(settlementOfDevices([])).toEqual({ result: 'permanent', failureCode: PUSH_NO_SUBSCRIPTION });
    expect(settlementOfDevices([{ result: 'gone' }, { result: 'gone' }])).toEqual({
      result: 'permanent',
      failureCode: PUSH_SUBSCRIPTION_GONE,
    });
    expect(
      settlementOfDevices([{ result: 'permanent', failureCode: PROVIDER_REFUSED }, { result: 'transient', failureCode: NETWORK_ERROR }]),
    ).toEqual({ result: 'transient', failureCode: NETWORK_ERROR });
    expect(settlementOfDevices([{ result: 'gone' }, { result: 'permanent', failureCode: PROVIDER_REFUSED }])).toEqual({
      result: 'permanent',
      failureCode: PROVIDER_REFUSED,
    });
  });
});

/** Gives the fixture member `count` devices and writes one push row for them, as the owner. */
async function arrangePush(
  client: Client,
  slug: string,
  username: string,
  count: number,
): Promise<{ organization: string; member: string; devices: { id: string; endpoint: string }[]; push: () => Promise<string> }> {
  const { organization, member } = await arrange(client, slug, username, null);
  const devices: { id: string; endpoint: string }[] = [];
  for (let index = 0; index < count; index += 1) {
    const { rows } = await client.query<{ id: string; endpoint: string }>(
      `insert into push_subscriptions (organization_id, member_id, endpoint, p256dh, auth)
       values ($1, $2, $3, $4, $5) returning id::text as id, endpoint`,
      [organization, member, `https://fcm.googleapis.com/fcm/send/${member}-${index}`, P256DH, AUTH],
    );
    const inserted = rows[0];
    if (inserted !== undefined) devices.push(inserted);
  }
  const push = async (): Promise<string> => {
    const { rows } = await client.query<{ id: string }>(
      `insert into notification_outbox (organization_id, code, subject_id, recipient_member_id, channel, operands)
       values ($1, 'LEAVE_REQUEST_APPROVED', gen_random_uuid(), $2, 'push', '{"startDate":"2046-03-02","endDate":"2046-03-06"}')
       returning id::text as id`,
      [organization, member],
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('outbox insert returned no row');
    return id;
  };
  return { organization, member, devices, push };
}

describe("notify's push matrix against the real claim, settle and delete (0045)", () => {
  const run = (client: Client, fetch: Fetch): Promise<Response> =>
    createHandler(configured, {
      makeClient: () => serviceRoleClient(client),
      fetch,
      sleep: instantly,
      encryptPush: fakeEncryptor().encryptPush,
    })(invoke());

  it.skipIf(noDatabase).each(FIXTURES)(
    "claims a $fixture push row with its member's devices and posts to each, with no address needed",
    async ({ slug, member }) => {
      await inRolledBackTransaction(async (client) => {
        const { devices, push, member: memberId } = await arrangePush(client, slug, member, 2);
        const id = await push();

        const claimed = await serviceRoleClient(client).rpc(CLAIM_RPC, { p_limit: 10 });
        expect(claimed.data, slug).toEqual([
          expect.objectContaining({
            id,
            channel: 'push',
            email: null,
          }),
        ]);
        // Every device, in no promised order (one transaction gives them one `created_at`).
        const returned = ((claimed.data as { subscriptions: { id: string }[] }[])[0]?.subscriptions ?? []).toSorted((a, b) =>
          a.id.localeCompare(b.id),
        );
        expect(returned).toEqual(
          devices
            .map(({ id: deviceId, endpoint }) => ({ id: deviceId, endpoint, p256dh: P256DH, auth: AUTH, member_id: memberId }))
            .toSorted((a, b) => a.id.localeCompare(b.id)),
        );

        await client.query('update notification_outbox set claimed_at = null, attempts = 0 where id = $1', [id]);
        const fetch = pushServices({});
        await run(client, fetch);

        expect(fetch.mock.calls.map(([url]) => url).sort()).toEqual(devices.map(({ endpoint }) => endpoint).sort());
        expect(await stateOf(client, id)).toMatchObject({ sent: true, failed: false });
      });
    },
  );

  it.skipIf(noDatabase)('deletes the gone device, keeps the other, and settles the row sent', async () => {
    const [{ slug, member }] = FIXTURES;
    await inRolledBackTransaction(async (client) => {
      const { devices, push } = await arrangePush(client, slug, member, 2);
      const [gone, live] = devices;
      const id = await push();
      const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      await run(client, pushServices({ [gone?.endpoint ?? '']: 410, [live?.endpoint ?? '']: 201 }));
      errors.mockRestore();

      const { rows } = await client.query<{ id: string }>('select id::text as id from push_subscriptions where id = any($1::uuid[])', [
        devices.map(({ id: deviceId }) => deviceId),
      ]);
      expect(rows.map(({ id: deviceId }) => deviceId)).toEqual([live?.id]);
      expect(await stateOf(client, id)).toMatchObject({ sent: true });
    });
  });

  it.skipIf(noDatabase)('deletes the only device on 404 and fails the row PUSH_SUBSCRIPTION_GONE, changing nothing else', async () => {
    const [{ slug, member }] = FIXTURES;
    await inRolledBackTransaction(async (client) => {
      const { organization, devices, push } = await arrangePush(client, slug, member, 1);
      const id = await push();
      const before = await client.query('select count(*)::int as n from members where organization_id = $1', [organization]);
      const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      await run(client, pushServices({ [devices[0]?.endpoint ?? '']: 404 }));
      errors.mockRestore();

      const { rows } = await client.query('select 1 from push_subscriptions where id = $1', [devices[0]?.id]);
      expect(rows).toEqual([]);
      expect(await stateOf(client, id)).toMatchObject({ failed: true, failureCode: PUSH_SUBSCRIPTION_GONE });
      const after = await client.query('select count(*)::int as n from members where organization_id = $1', [organization]);
      expect(after.rows).toEqual(before.rows);
    });
  });

  it.skipIf(noDatabase)('settles a queued push row PUSH_NO_SUBSCRIPTION at claim once its last device is gone, and returns it to no one', async () => {
    const [{ slug, member }] = FIXTURES;
    await inRolledBackTransaction(async (client) => {
      const { devices, push } = await arrangePush(client, slug, member, 1);
      const id = await push();
      await client.query('delete from push_subscriptions where id = $1', [devices[0]?.id]);

      const fetch = pushServices({});
      const response = await run(client, fetch);

      expect(await response.json()).toMatchObject({ claimed: 0 });
      expect(fetch).not.toHaveBeenCalled();
      expect(await stateOf(client, id)).toMatchObject({ attempts: 0, failed: true, failureCode: PUSH_NO_SUBSCRIPTION });
    });
  });

  it.skipIf(noDatabase)('lets service_role alone delete a subscription by id', async () => {
    const [{ slug, member }] = FIXTURES;
    await inRolledBackTransaction(async (client) => {
      const { devices, member: memberId } = await arrangePush(client, slug, member, 1);
      const { rows } = await client.query<{ role: string; held: boolean }>(
        `select role, has_function_privilege(role, 'public.delete_push_subscription(uuid, text, uuid)', 'execute') as held
           from unnest(array['anon', 'authenticated', 'service_role']) as role`,
      );
      expect(Object.fromEntries(rows.map(({ role, held }) => [role, held]))).toEqual({
        anon: false,
        authenticated: false,
        service_role: true,
      });

      const target = { p_id: devices[0]?.id, p_endpoint: devices[0]?.endpoint, p_member: memberId };
      const answer = await serviceRoleClient(client).rpc(DELETE_SUBSCRIPTION_RPC, target);
      const again = await serviceRoleClient(client).rpc(DELETE_SUBSCRIPTION_RPC, target);
      expect(answer.error).toBeNull();
      expect(again.error, 'a device already gone is no error').toBeNull();
    });
  });

  it.skipIf(noDatabase)('keeps a device re-registered to another member after the claim, though its old owner\'s push answered 410', async () => {
    const [{ slug, member, bystander }] = FIXTURES;
    await inRolledBackTransaction(async (client) => {
      const { organization, devices, push, member: memberId } = await arrangePush(client, slug, member, 1);
      const id = await push();
      const claimed = (await serviceRoleClient(client).rpc(CLAIM_RPC, { p_limit: 10 })).data as { claimed_at: string }[];
      // Between the claim and the send, the bystander signs in on that phone and turns push on.
      await client.query(
        `update push_subscriptions set member_id = (select id from members where organization_id = $1 and username = $2)
          where id = $3`,
        [organization, bystander, devices[0]?.id],
      );
      // The run that holds the claim answers 410 for the old subscription.
      const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const handle = createHandler(configured, {
        makeClient: () => ({
          rpc: (fn: string, args: Record<string, unknown>) =>
            fn === CLAIM_RPC
              ? Promise.resolve({
                  data: [
                    {
                      ...pushRow(
                        [{ id: devices[0]?.id, endpoint: devices[0]?.endpoint, p256dh: P256DH, auth: AUTH, member_id: memberId }],
                        { id, claimed_at: claimed[0]?.claimed_at ?? '' },
                      ),
                    },
                  ],
                  error: null,
                })
              : serviceRoleClient(client).rpc(fn as typeof SETTLE_RPC, args),
        }),
        fetch: pushServices({ [devices[0]?.endpoint ?? '']: 410 }),
        sleep: instantly,
        encryptPush: fakeEncryptor().encryptPush,
      });
      await handle(invoke());
      errors.mockRestore();

      const { rows } = await client.query('select 1 from push_subscriptions where id = $1', [devices[0]?.id]);
      expect(rows, "a stale 410 deleted another member's live device").toHaveLength(1);
    });

  });
});

/**
 * The cron job's send branch (0042): with both Vault secrets present,
 * `private.invoke_notify()` queues one POST to `notify_url` carrying the
 * invoke secret as its bearer — and that request passes the handler's auth.
 * Rolled back, so pg_net's worker never sees it.
 */
describe('the cron job calls notify with the invoke secret from Vault (0042)', () => {
  it.skipIf(noDatabase)('queues a POST to notify_url with Authorization: Bearer <notify_invoke_secret>', async () => {
    await inRolledBackTransaction(async (client) => {
      const target = 'http://notify.invalid/functions/v1/notify';
      await client.query(`delete from vault.secrets where name in ('notify_url', 'notify_invoke_secret')`);
      await client.query(`select vault.create_secret($1, 'notify_url')`, [target]);
      await client.query(`select vault.create_secret($1, 'notify_invoke_secret')`, [INVOKE_SECRET]);

      const { rows: queued } = await client.query<{ id: string }>('select private.invoke_notify()::text as id');
      const id = queued[0]?.id;
      expect(id, 'invoke_notify queued nothing').toBeTruthy();
      const { rows } = await client.query<{ url: string; method: string; headers: Record<string, string> }>(
        'select url, method::text as method, headers from net.http_request_queue where id = $1::bigint',
        [id],
      );
      const request = rows[0];
      expect(request).toMatchObject({ url: target, method: 'POST' });
      expect(request?.headers['Authorization']).toBe(`Bearer ${INVOKE_SECRET}`);

      // The same headers, as the request notify receives: past its auth.
      const { client: fake, rpc } = fakeClient([]);
      const response = await createHandler(configured, { makeClient: () => fake, fetch: provider(200), sleep: instantly })(
        new Request(target, { method: 'POST', headers: request?.headers ?? {} }),
      );
      expect(response.status).toBe(200);
      expect(rpc).toHaveBeenCalledWith(CLAIM_RPC, { p_limit: BATCH_SIZE });
    });
  });
});
