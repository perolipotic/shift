/**
 * The text `notify` sends, and the one way it is rendered.
 *
 * A COPY of `apps/web/src/lib/i18n/locales/hr.json`'s `obavijesti` namespace.
 * The function cannot import from `apps/web` (it is deployed on its own), so
 * the copy is pinned deep-equal to the resource by `test/notify-boundary.test.ts`:
 * one source of truth, checked in CI. Edit `hr.json` first, then this file.
 *
 * Rendering is plain `{name}` interpolation and nothing else: no ICU, no
 * plural, no select. An operand that is an ISO calendar date is formatted the
 * way the SPA's `formatIsoDate` formats it (`23.09.2026`, UX-DR34). Nothing
 * here computes a domain answer (AD-16's spirit, AD-18): the operands arrive
 * already decided, in the outbox row.
 *
 * Imports nothing, so Vitest asserts it in the node environment (AD-15).
 */

export const OBAVIJESTI = {
  leaveRequestApproved: {
    subject: 'Zahtjev za godišnji {startDate}–{endDate} je odobren',
    body: '{organizationName}: tvoj zahtjev za godišnji odmor {startDate}–{endDate} je odobren. Pogledaj ga u aplikaciji: {link}',
  },
  leaveRequestRejected: {
    subject: 'Zahtjev za godišnji {startDate}–{endDate} je odbijen',
    body: '{organizationName}: tvoj zahtjev za godišnji odmor {startDate}–{endDate} je odbijen. Pogledaj ga u aplikaciji: {link}',
  },
  leaveRecorded: {
    subject: 'Upisan ti je godišnji {startDate}–{endDate}',
    body: '{organizationName}: upisan ti je godišnji odmor {startDate}–{endDate}. Pogledaj ga u aplikaciji: {link}',
  },
  leaveRecordChanged: {
    subject: 'Izmijenjen ti je godišnji, sada {startDate}–{endDate}',
    body: '{organizationName}: tvoj godišnji odmor izmijenjen je na {startDate}–{endDate}. Pogledaj ga u aplikaciji: {link}',
  },
  leaveRecordRemoved: {
    subject: 'Uklonjen ti je godišnji {startDate}–{endDate}',
    body: '{organizationName}: uklonjen ti je godišnji odmor {startDate}–{endDate}. Pogledaj u aplikaciji: {link}',
  },
  rosterPutOn: {
    subject: 'Promjena rasporeda {date}: na rasporedu si',
    body: '{organizationName}: upisana je promjena rasporeda koja te stavlja na raspored {date}. Pogledaj kalendar: {link}',
  },
  rosterPutOnChanged: {
    subject: 'Izmijenjena promjena rasporeda {date}',
    body: '{organizationName}: izmijenjena je promjena rasporeda koja te stavlja na raspored {date}. Pogledaj kalendar: {link}',
  },
  rosterPutOnRemoved: {
    subject: 'Uklonjena promjena rasporeda {date}',
    body: '{organizationName}: uklonjena je promjena rasporeda koja te stavila na raspored {date}. Pogledaj kalendar: {link}',
  },
  rosterTakenOff: {
    subject: 'Promjena rasporeda {date}: nisi na rasporedu',
    body: '{organizationName}: upisana je promjena rasporeda koja te miče s rasporeda {date}. Pogledaj kalendar: {link}',
  },
  rosterTakenOffChanged: {
    subject: 'Izmijenjena promjena rasporeda {date}',
    body: '{organizationName}: izmijenjena je promjena rasporeda koja te miče s rasporeda {date}. Pogledaj kalendar: {link}',
  },
  rosterTakenOffRemoved: {
    subject: 'Uklonjena promjena rasporeda {date}',
    body: '{organizationName}: uklonjena je promjena rasporeda koja te maknula s rasporeda {date}. Pogledaj kalendar: {link}',
  },
  teamShiftTypeSet: {
    subject: 'Promjena rasporeda {date}',
    body: '{organizationName}: za {date} vrijedi {shiftTypeName} umjesto rasporeda po rotaciji. Pogledaj kalendar: {link}',
  },
  teamShiftTypeChanged: {
    subject: 'Izmijenjena promjena rasporeda {date}',
    body: '{organizationName}: za {date} sada vrijedi {shiftTypeName} umjesto rasporeda po rotaciji. Pogledaj kalendar: {link}',
  },
  teamShiftTypeRemoved: {
    subject: 'Uklonjena promjena rasporeda {date}',
    body: '{organizationName}: za {date} ponovno vrijedi raspored po rotaciji. Pogledaj kalendar: {link}',
  },
  rotationChanges: {
    subject: 'Nova rotacija od {effectiveFrom}',
    body: '{organizationName}: od {effectiveFrom} vrijedi nova rotacija. Pogledaj kalendar: {link}',
  },
  rotationChangeCancelled: {
    subject: 'Otkazana promjena rotacije od {effectiveFrom}',
    body: '{organizationName}: promjena rotacije zakazana od {effectiveFrom} je otkazana. Pogledaj kalendar: {link}',
  },
  leaveRequestCreated: {
    subject: 'Novi zahtjev za godišnji: {memberName}',
    body: '{organizationName}: {memberName} traži godišnji odmor {startDate}–{endDate}. Zahtjev čeka tvoju odluku: {link}',
  },
  footer: 'Obavijesti e-poštom možeš isključiti u aplikaciji, pod Obavijesti: {link}',
} as const;

/**
 * A message an outbox code renders with. `footer` is not one: it is the line
 * every email ends with (story 10.3), linking to the settings.
 */
export type MessageKey = Exclude<keyof typeof OBAVIJESTI, 'footer'>;

/** The surface the footer links to: the member's own notification settings. */
export const SETTINGS_PATH = '/obavijesti';

/**
 * The resources by language. One today, as in the SPA. A locale with no
 * resource of its own renders in Croatian, as the SPA does.
 */
const MESSAGES_BY_LANGUAGE: Readonly<Record<string, typeof OBAVIJESTI>> = { hr: OBAVIJESTI };

const FALLBACK_LANGUAGE = 'hr';

/** Each outbox code `notify` can render, and the message it renders with. */
export const MESSAGE_OF_CODE: Readonly<Record<string, MessageKey>> = {
  LEAVE_REQUEST_APPROVED: 'leaveRequestApproved',
  LEAVE_REQUEST_REJECTED: 'leaveRequestRejected',
  LEAVE_RECORDED: 'leaveRecorded',
  LEAVE_RECORD_CHANGED: 'leaveRecordChanged',
  LEAVE_RECORD_REMOVED: 'leaveRecordRemoved',
  ROSTER_PUT_ON: 'rosterPutOn',
  ROSTER_PUT_ON_CHANGED: 'rosterPutOnChanged',
  ROSTER_PUT_ON_REMOVED: 'rosterPutOnRemoved',
  ROSTER_TAKEN_OFF: 'rosterTakenOff',
  ROSTER_TAKEN_OFF_CHANGED: 'rosterTakenOffChanged',
  ROSTER_TAKEN_OFF_REMOVED: 'rosterTakenOffRemoved',
  TEAM_SHIFT_TYPE_SET: 'teamShiftTypeSet',
  TEAM_SHIFT_TYPE_CHANGED: 'teamShiftTypeChanged',
  TEAM_SHIFT_TYPE_REMOVED: 'teamShiftTypeRemoved',
  ROTATION_CHANGES: 'rotationChanges',
  ROTATION_CHANGE_CANCELLED: 'rotationChangeCancelled',
  LEAVE_REQUEST_CREATED: 'leaveRequestCreated',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The in-app path of the surface a message links to, from the row's operands
 * (the request's id for a new request), or `null` when the operands do not
 * name one.
 */
export function linkPathOf(key: MessageKey, operands: Readonly<Record<string, unknown>>): string | null {
  switch (key) {
    case 'leaveRequestApproved':
    case 'leaveRequestRejected':
    case 'leaveRecorded':
    case 'leaveRecordChanged':
    case 'leaveRecordRemoved':
      return '/godisnji';
    case 'rosterPutOn':
    case 'rosterPutOnChanged':
    case 'rosterPutOnRemoved':
    case 'rosterTakenOff':
    case 'rosterTakenOffChanged':
    case 'rosterTakenOffRemoved':
    case 'teamShiftTypeSet':
    case 'teamShiftTypeChanged':
    case 'teamShiftTypeRemoved':
    case 'rotationChanges':
    case 'rotationChangeCancelled':
      return '/kalendar';
    case 'leaveRequestCreated': {
      const id = operands['requestId'];
      return typeof id === 'string' && UUID.test(id) ? `/za-odluku/zahtjev/${id.toLowerCase()}` : null;
    }
  }
}

/** The organization a row belongs to, as the claim returns it. */
export interface RenderTarget {
  /** The app's origin; a trailing slash is ignored. */
  readonly appUrl: string;
  /** The organization's slug: the sign-in link names it. */
  readonly slug: string | null;
  /** The organization's name: every body names it. */
  readonly organizationName: string | null;
}

/**
 * The link an email carries: the organization's sign-in route, returning to
 * the surface (`/prijava/<slug>?povratak=<path>`). A signed-in visitor is
 * sent straight on; anyone else signs in first, into the right organization.
 */
export function linkOf(appUrl: string, slug: string, path: string): string {
  return `${appUrl.replace(/\/+$/, '')}/prijava/${encodeURIComponent(slug)}?povratak=${encodeURIComponent(path)}`;
}

/** No message is known for the row's code: a code `notify` cannot render. */
export const MESSAGE_UNKNOWN = 'MESSAGE_UNKNOWN';
/** The message names an operand the row does not carry, or carries as other than a string or number. */
export const OPERANDS_INVALID = 'OPERANDS_INVALID';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The operands that are ISO calendar dates, by name, and the only ones
 * formatted as dates. A name (a member's, a shift type's) is text, however
 * much it looks like a date.
 */
const DATE_OPERANDS: ReadonlySet<string> = new Set(['startDate', 'endDate', 'date', 'effectiveFrom']);

/**
 * `2026-09-23` → `23.09.2026`, as `apps/web`'s `formatIsoDate`. `null` for a
 * string that is not a real calendar date, so a malformed value is a case
 * rather than `NaN.NaN.NaN`.
 */
export function formatIsoDate(isoDate: string): string | null {
  const match = ISO_DATE.exec(isoDate);
  if (match === null) return null;

  const [, year = '', month = '', day = ''] = match;
  const instant = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12));
  // `Date.UTC` maps years 0–99 to 1900–1999; set the full year explicitly.
  instant.setUTCFullYear(Number(year));

  const valid =
    Number(year) >= 1 &&
    instant.getUTCFullYear() === Number(year) &&
    instant.getUTCMonth() === Number(month) - 1 &&
    instant.getUTCDate() === Number(day);

  return valid ? `${day}.${month}.${year}` : null;
}

/** The language subtag of a BCP 47 tag, lowercased: `hr-HR` → `hr`. */
function languageOf(locale: string | null): string {
  return (locale ?? '').split('-')[0]?.trim().toLowerCase() ?? '';
}

function interpolate(template: string, values: Readonly<Record<string, string>>): string | null {
  let missing = false;
  const text = template.replace(/\{(\w+)\}/g, (_whole, name: string) => {
    const value = values[name];
    if (value === undefined) {
      missing = true;
      return '';
    }
    return value;
  });
  return missing ? null : text;
}

export type Rendered =
  | { readonly ok: true; readonly subject: string; readonly text: string }
  | { readonly ok: false; readonly code: typeof MESSAGE_UNKNOWN | typeof OPERANDS_INVALID };

/**
 * A push notification's payload (story 10.4): the email's subject as the
 * title, its body WITHOUT the footer (the footer speaks of email), and the
 * same sign-in link to the surface, which the service worker opens on a tap.
 */
export type RenderedPush =
  | { readonly ok: true; readonly title: string; readonly body: string; readonly url: string }
  | { readonly ok: false; readonly code: typeof MESSAGE_UNKNOWN | typeof OPERANDS_INVALID };

type Composed =
  | { readonly ok: true; readonly subject: string; readonly body: string; readonly link: string; readonly footer: string }
  | { readonly ok: false; readonly code: typeof MESSAGE_UNKNOWN | typeof OPERANDS_INVALID };

/** The parts one row renders to, shared by the email and the push. */
function compose(code: string, locale: string | null, operands: unknown, target: RenderTarget): Composed {
  const key = Object.hasOwn(MESSAGE_OF_CODE, code) ? MESSAGE_OF_CODE[code] : undefined;
  if (key === undefined) return { ok: false, code: MESSAGE_UNKNOWN };

  const language = languageOf(locale);
  const messages = MESSAGES_BY_LANGUAGE[language] ?? MESSAGES_BY_LANGUAGE[FALLBACK_LANGUAGE];
  if (messages === undefined) return { ok: false, code: MESSAGE_UNKNOWN };

  if (operands === null || typeof operands !== 'object' || Array.isArray(operands)) {
    return { ok: false, code: OPERANDS_INVALID };
  }

  const slug = (target.slug ?? '').trim();
  const organizationName = (target.organizationName ?? '').trim();
  if (slug === '' || organizationName === '') return { ok: false, code: OPERANDS_INVALID };

  const values: Record<string, string> = {};
  for (const [name, value] of Object.entries(operands as Record<string, unknown>)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      values[name] = String(value);
    } else if (typeof value === 'string' && DATE_OPERANDS.has(name)) {
      const formatted = formatIsoDate(value);
      if (formatted === null) return { ok: false, code: OPERANDS_INVALID };
      values[name] = formatted;
    } else if (typeof value === 'string') {
      values[name] = value;
    }
  }

  const path = linkPathOf(key, operands as Record<string, unknown>);
  if (path === null) return { ok: false, code: OPERANDS_INVALID };
  const link = linkOf(target.appUrl, slug, path);
  values['organizationName'] = organizationName;
  values['link'] = link;

  const message = messages[key];
  const subject = interpolate(message.subject, values);
  const body = interpolate(message.body, values);
  const footer = interpolate(messages.footer, { link: linkOf(target.appUrl, slug, SETTINGS_PATH) });
  if (subject === null || body === null || footer === null) return { ok: false, code: OPERANDS_INVALID };

  return { ok: true, subject, body, link, footer };
}

/**
 * One outbox row's email, in the organization's language, naming the
 * organization and linking through its sign-in route to the surface. Every
 * body ends with the footer line, linking the same way to `/obavijesti`,
 * where the member turns email off (story 10.3).
 */
export function render(code: string, locale: string | null, operands: unknown, target: RenderTarget): Rendered {
  const composed = compose(code, locale, operands, target);
  if (!composed.ok) return composed;

  return { ok: true, subject: composed.subject, text: `${composed.body}\n\n${composed.footer}` };
}

/**
 * One outbox row's push payload (story 10.4): the same text as the email, by
 * the same code and operands, without the email's footer, and the link the
 * notification opens.
 */
export function renderPush(code: string, locale: string | null, operands: unknown, target: RenderTarget): RenderedPush {
  const composed = compose(code, locale, operands, target);
  if (!composed.ok) return composed;

  return { ok: true, title: composed.subject, body: composed.body, url: composed.link };
}
