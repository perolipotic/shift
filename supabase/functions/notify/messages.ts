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
    body: 'Tvoj zahtjev za godišnji odmor {startDate}–{endDate} je odobren. Pogledaj ga u aplikaciji: {link}',
  },
  leaveRequestRejected: {
    subject: 'Zahtjev za godišnji {startDate}–{endDate} je odbijen',
    body: 'Tvoj zahtjev za godišnji odmor {startDate}–{endDate} je odbijen. Pogledaj ga u aplikaciji: {link}',
  },
} as const;

export type MessageKey = keyof typeof OBAVIJESTI;

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
};

/** The path of the surface each message links to, under the app's URL. */
export const LINK_PATH_OF_MESSAGE: Readonly<Record<MessageKey, string>> = {
  leaveRequestApproved: '/godisnji',
  leaveRequestRejected: '/godisnji',
};

/** No message is known for the row's code: a code `notify` cannot render. */
export const MESSAGE_UNKNOWN = 'MESSAGE_UNKNOWN';
/** The message names an operand the row does not carry, or carries as other than a string or number. */
export const OPERANDS_INVALID = 'OPERANDS_INVALID';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

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
 * One outbox row's email, in the organization's language.
 *
 * `appUrl` is the app's origin (no trailing slash needed); the link is the
 * message's surface under it.
 */
export function render(
  code: string,
  locale: string | null,
  operands: unknown,
  appUrl: string,
): Rendered {
  const key = Object.hasOwn(MESSAGE_OF_CODE, code) ? MESSAGE_OF_CODE[code] : undefined;
  if (key === undefined) return { ok: false, code: MESSAGE_UNKNOWN };

  const language = languageOf(locale);
  const messages = MESSAGES_BY_LANGUAGE[language] ?? MESSAGES_BY_LANGUAGE[FALLBACK_LANGUAGE];
  if (messages === undefined) return { ok: false, code: MESSAGE_UNKNOWN };

  if (operands === null || typeof operands !== 'object' || Array.isArray(operands)) {
    return { ok: false, code: OPERANDS_INVALID };
  }

  const values: Record<string, string> = {};
  for (const [name, value] of Object.entries(operands as Record<string, unknown>)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      values[name] = String(value);
    } else if (typeof value === 'string' && ISO_DATE.test(value)) {
      const formatted = formatIsoDate(value);
      if (formatted === null) return { ok: false, code: OPERANDS_INVALID };
      values[name] = formatted;
    } else if (typeof value === 'string') {
      values[name] = value;
    }
  }
  values['link'] = `${appUrl.replace(/\/+$/, '')}${LINK_PATH_OF_MESSAGE[key]}`;

  const message = messages[key];
  const subject = interpolate(message.subject, values);
  const text = interpolate(message.body, values);
  if (subject === null || text === null) return { ok: false, code: OPERANDS_INVALID };

  return { ok: true, subject, text };
}
