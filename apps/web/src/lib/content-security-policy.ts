/**
 * STORY 20.3. The SPA's Content-Security-Policy, computed at BUILD time from
 * the very `VITE_SUPABASE_URL` the bundle is built with and the inline scripts
 * of the built `index.html`, so it cannot drift from either. The Vite build
 * (`vite.config.ts`, plugin `shift-content-security-policy`, through
 * `headersWithPolicy`) appends it to `dist/_headers`' `/*` block, which the
 * `shift-web` image serves on every response (`deploy/web/`).
 *
 * REPORT-ONLY until story 20.5 has read the browser's reports on staging:
 * enforcing it is changing `CSP_HEADER`, nothing else. There is no
 * `report-uri`: no endpoint exists to receive reports, and 20.5 reads the
 * console's Report-Only messages instead.
 *
 * Pure: no `node:` import, no I/O. The build reads and writes the files and
 * hands in its SHA-256 function.
 */

/** The response header the policy ships in. Enforcing it (20.5) changes this alone. */
export const CSP_HEADER = 'Content-Security-Policy-Report-Only';

/**
 * A plain `http(s)` origin: scheme, host, optional port, nothing else. A
 * WHATWG-parsed host can still hold `"`, `;` or `,`, which would end a CSP
 * directive or break the nginx line it is served from.
 */
const PLAIN_ORIGIN = /^https?:\/\/(?:[a-z0-9.-]+|\[[0-9a-f:.]+\])(?::\d{1,5})?$/;

/**
 * The Supabase origin the bundle talks to, or `null` when the build has none
 * (CI's `build` job builds with no environment: the policy then names no
 * origin). Anything that is not an `http(s)` URL with a plain host throws, so
 * the build fails rather than ship a policy that blocks every request.
 */
export function supabaseOriginOf(value: string | undefined): string | null {
  const raw = (value ?? '').trim();
  if (raw === '') return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('VITE_SUPABASE_URL is not a URL, so no Content-Security-Policy can name its origin');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('VITE_SUPABASE_URL is not an http(s) URL, so no Content-Security-Policy can name its origin');
  }
  if (!PLAIN_ORIGIN.test(url.origin)) {
    throw new Error('VITE_SUPABASE_URL has a host a Content-Security-Policy cannot name');
  }

  return url.origin;
}

/**
 * One `<!-- … -->` comment, or one `<script …>…</script>` element, in page
 * order. Matching both in one pass means a `<!--` inside a script's text never
 * starts a comment, and a `<script>` inside a comment is never an element.
 * Attribute values may be quoted with either quote and hold `>`.
 */
const COMMENT_OR_SCRIPT = /<!--[\s\S]*?-->|<script\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/script\s*>/gi;

/** Whether a tag's attribute text has a `src` attribute: a name, never text inside a quoted value. */
function hasSrcAttribute(attributes: string): boolean {
  const names = attributes.replace(/"[^"]*"|'[^']*'/g, '""');
  return /(?:^|\s)src(?=\s*=|\s|\/|$)/i.test(names);
}

/**
 * The text of every inline `<script>` of a page, as the browser hashes it: the
 * text between its tags, whitespace kept, with CRLF and CR read as LF (the HTML
 * parser normalises newlines before the hash is taken). A script with a `src`
 * attribute is not inline; a script inside an HTML comment is not an element.
 */
export function inlineScriptsOf(html: string): string[] {
  const scripts: string[] = [];

  for (const match of html.matchAll(COMMENT_OR_SCRIPT)) {
    if (match[0].startsWith('<!--')) continue;
    if (hasSrcAttribute(match[1] ?? '')) continue;
    scripts.push((match[2] ?? '').replace(/\r\n?/g, '\n'));
  }

  return scripts;
}

export interface PolicyInputs {
  /** `supabaseOriginOf(VITE_SUPABASE_URL)`: the API origin, or `null` for none. */
  readonly supabaseOrigin: string | null;
  /** The base64 SHA-256 of each inline script's text, as `inlineScriptsOf` gives it. */
  readonly scriptHashes: readonly string[];
}

const BASE64_SHA256 = /^[A-Za-z0-9+/]{43}=$/;

/**
 * The policy, one line. Styles allow `'unsafe-inline'`: `index.html` has inline
 * `<style>` blocks and a `style=` attribute (the boot fallback), and React sets
 * `style` attributes. Images and requests reach the Supabase origin (REST,
 * Auth, Storage's logos); nothing else leaves the page's own origin.
 * Functions sit under the same origin (`/functions/v1`); a push subscription is
 * the browser's own request, outside the policy. The app opens no Realtime
 * channel: one would need the origin's `wss:` form in `connect-src` as well.
 */
export function contentSecurityPolicy({ supabaseOrigin, scriptHashes }: PolicyInputs): string {
  for (const hash of scriptHashes) {
    if (!BASE64_SHA256.test(hash)) throw new Error('a script hash is not a base64 SHA-256 digest');
  }
  const self = ["'self'"];
  const withSupabase = supabaseOrigin === null ? self : [...self, supabaseOrigin];
  const directives: [string, readonly string[]][] = [
    ['default-src', self],
    ['script-src', [...self, ...[...new Set(scriptHashes)].map((hash) => `'sha256-${hash}'`)]],
    ['style-src', [...self, "'unsafe-inline'"]],
    ['img-src', withSupabase],
    ['connect-src', withSupabase],
    ['font-src', self],
    ['worker-src', self],
    ['manifest-src', self],
    ['base-uri', self],
    ['form-action', self],
    ['object-src', ["'none'"]],
    ['frame-src', ["'none'"]],
    ['frame-ancestors', ["'none'"]],
  ];

  return directives.map(([name, sources]) => `${name} ${sources.join(' ')}`).join('; ');
}

/**
 * A `_headers` file (Cloudflare's format: an unindented path, then indented
 * `Name: value` lines) with `Name: value` added as the last header of its `/*`
 * block. Throws when there is no `/*` block or more than one (the image serves
 * one set of headers, and `render-headers.sh` refuses a second), or when it
 * already names the header (case-insensitively), so a second build step can
 * never add a second policy.
 */
export function withHeaderInAllPaths(file: string, name: string, value: string): string {
  const lines = file.split('\n');
  let inAllPaths = false;
  let blocks = 0;
  let insertAt = -1;

  lines.forEach((line, index) => {
    if (line.trim() === '' || line.trimStart().startsWith('#')) return;
    if (!/^\s/.test(line)) {
      inAllPaths = line.trim() === '/*';
      if (inAllPaths) {
        blocks += 1;
        insertAt = index + 1;
      }
      return;
    }
    if (!inAllPaths) return;
    if (line.split(':')[0]?.trim().toLowerCase() === name.toLowerCase()) {
      throw new Error(`_headers already sets ${name}`);
    }
    insertAt = index + 1;
  });
  if (blocks === 0) throw new Error('_headers has no /* block');
  if (blocks > 1) throw new Error('_headers has more than one /* block');

  lines.splice(insertAt, 0, `  ${name}: ${value}`);
  return lines.join('\n');
}

export interface BuiltHeadersInputs {
  /** The built `dist/_headers` text (`public/_headers`, as copied). */
  readonly headers: string;
  /** The built `dist/index.html` text. */
  readonly page: string;
  /** This build's `VITE_SUPABASE_URL` as Vite resolved it (absent or empty: no origin). */
  readonly supabaseUrl: string | undefined;
  /**
   * The base64 SHA-256 of a UTF-8 text. Injected so this module stays free of
   * `node:` imports; the build and the tests pass `node:crypto`'s.
   */
  readonly sha256Base64: (text: string) => string;
}

/**
 * The build's whole step (story 20.3): the `_headers` text with this page's and
 * this origin's policy added to its one `/*` block. Throws on an origin no
 * policy can name, on a `_headers` without exactly one `/*` block, and on one
 * that already sets either policy header (enforcing or Report-Only). `vite.config.ts` only reads and writes the
 * files around it.
 */
export function headersWithPolicy({ headers, page, supabaseUrl, sha256Base64 }: BuiltHeadersInputs): string {
  // Either policy header, not only the one added: an enforcing policy beside
  // the Report-Only one would be enforced unverified.
  if (/^[ \t]+content-security-policy(?:-report-only)?[ \t]*:/im.test(headers)) {
    throw new Error('_headers already sets a Content-Security-Policy');
  }
  const supabaseOrigin = supabaseOriginOf(supabaseUrl);
  const scriptHashes = inlineScriptsOf(page).map((script) => sha256Base64(script));
  return withHeaderInAllPaths(headers, CSP_HEADER, contentSecurityPolicy({ supabaseOrigin, scriptHashes }));
}
