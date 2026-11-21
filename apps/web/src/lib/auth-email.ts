/**
 * STORY 19.1 (AD-21, AD-12, D-S4). The Croatian Auth email templates GoTrue
 * sends over SMTP: confirmation, recovery and email change. Built at BUILD time
 * from `hr.json`'s `signup.email` keys (`vite.config.ts`, plugin
 * `shift-auth-email`) into `dist/auth-email/*.html`, which the `shift-web`
 * image serves from the app origin. GoTrue fetches each one from
 * `GOTRUE_MAILER_TEMPLATES_*`, and its subject is `GOTRUE_MAILER_SUBJECTS_*`
 * in the stack's compose file; `test/auth-email.test.ts` pins both to
 * `hr.json`.
 *
 * Every link is AD-12's: `{{ .SiteURL }}/potvrda?token_hash={{ .TokenHash }}&type=<type>`.
 * The SPA posts it with `verifyOtp`, on a click (19.2), so no session token is
 * ever in a URL and a mail scanner's GET consumes nothing. GoTrue's
 * `{{ .ConfirmationURL }}` (a GET on `/auth/v1/verify`) is never used.
 *
 * Pure: no `node:` import, no I/O. The build reads the resource and emits the
 * files. Kept out of the service worker's precache (`globIgnores`).
 */

/** The three templates, by the file name GoTrue fetches and the `type` its link carries. */
export const AUTH_EMAIL_TEMPLATES = [
  { key: 'confirmation', file: 'confirmation.html', type: 'signup' },
  { key: 'recovery', file: 'recovery.html', type: 'recovery' },
  { key: 'emailChange', file: 'email-change.html', type: 'email_change' },
] as const;

/** Where the templates land in `dist/`, and so under the app origin. */
export const AUTH_EMAIL_DIRECTORY = 'auth-email';

export type AuthEmailKey = (typeof AUTH_EMAIL_TEMPLATES)[number]['key'];

interface TemplateCopy {
  readonly subject: string;
  readonly heading: string;
  readonly body: string;
  readonly action: string;
  readonly ignore: string;
}

interface EmailCopy {
  readonly expiry: string;
  readonly fallback: string;
  readonly templates: Readonly<Record<AuthEmailKey, TemplateCopy>>;
}

/** Escapes text for an HTML text node or a double-quoted attribute. */
export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function stringAt(node: unknown, path: readonly string[]): string {
  let current: unknown = node;
  for (const part of path) {
    current = typeof current === 'object' && current !== null ? (current as Record<string, unknown>)[part] : undefined;
  }
  if (typeof current !== 'string' || current.trim() === '') {
    throw new Error(`hr.json has no message at ${path.join('.')}: the Auth email templates cannot be built`);
  }
  // GoTrue parses each template as a Go template: copy holding a delimiter
  // would be read as an action (or fail to parse, and GoTrue would fall back
  // to its default English mail). The copy is text, never template syntax.
  if (current.includes('{{') || current.includes('}}')) {
    throw new Error(`hr.json's ${path.join('.')} holds a Go template delimiter ({{ or }}): the Auth email templates cannot be built`);
  }
  return current;
}

/** The `signup.email` copy, read off the resource; a missing message throws, so the build fails. */
export function emailCopyOf(resource: unknown): EmailCopy {
  const base = ['signup', 'email'];
  const templates = Object.fromEntries(
    AUTH_EMAIL_TEMPLATES.map(({ key }) => [
      key,
      {
        subject: stringAt(resource, [...base, key, 'subject']),
        heading: stringAt(resource, [...base, key, 'heading']),
        body: stringAt(resource, [...base, key, 'body']),
        action: stringAt(resource, [...base, key, 'action']),
        ignore: stringAt(resource, [...base, key, 'ignore']),
      },
    ]),
  ) as Record<AuthEmailKey, TemplateCopy>;
  return {
    expiry: stringAt(resource, [...base, 'expiry']),
    fallback: stringAt(resource, [...base, 'fallback']),
    templates,
  };
}

/** AD-12's link, as GoTrue's template syntax; `&` written as an HTML attribute needs it. */
export function linkOf(type: string): string {
  return `{{ .SiteURL }}/potvrda?token_hash={{ .TokenHash }}&amp;type=${type}`;
}

/**
 * Each template's file name (under `auth-email/`) and its HTML. Inline styles
 * only, and no image, script or remote resource: a mail client loads nothing.
 */
export function authEmailTemplates(resource: unknown): { readonly file: string; readonly html: string }[] {
  const copy = emailCopyOf(resource);
  return AUTH_EMAIL_TEMPLATES.map(({ key, file, type }) => {
    const text = copy.templates[key];
    const link = linkOf(type);
    const html = [
      '<!doctype html>',
      '<html lang="hr">',
      '<head>',
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      `<title>${escapeHtml(text.subject)}</title>`,
      '</head>',
      '<body style="margin:0;padding:24px 16px;background:#e8edf5;color:#18202b;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5">',
      '<div style="max-width:520px;margin:0 auto;padding:24px;background:#ffffff;border-radius:12px">',
      `<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3">${escapeHtml(text.heading)}</h1>`,
      `<p style="margin:0 0 24px">${escapeHtml(text.body)}</p>`,
      `<p style="margin:0 0 24px"><a href="${link}" style="display:inline-block;padding:12px 20px;background:#1f3a5f;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:bold">${escapeHtml(text.action)}</a></p>`,
      `<p style="margin:0 0 8px;font-size:14px">${escapeHtml(copy.fallback)}</p>`,
      `<p style="margin:0 0 24px;font-size:14px;word-break:break-all"><a href="${link}" style="color:#1f3a5f">${link}</a></p>`,
      `<p style="margin:0 0 8px;font-size:14px">${escapeHtml(copy.expiry)}</p>`,
      `<p style="margin:0;font-size:14px">${escapeHtml(text.ignore)}</p>`,
      '</div>',
      '</body>',
      '</html>',
      '',
    ].join('\n');
    return { file, html };
  });
}

/** Each template's subject, by the GoTrue variable that carries it. */
export function authEmailSubjects(resource: unknown): Readonly<Record<string, string>> {
  const copy = emailCopyOf(resource);
  return {
    GOTRUE_MAILER_SUBJECTS_CONFIRMATION: copy.templates.confirmation.subject,
    GOTRUE_MAILER_SUBJECTS_RECOVERY: copy.templates.recovery.subject,
    GOTRUE_MAILER_SUBJECTS_EMAIL_CHANGE: copy.templates.emailChange.subject,
  };
}
