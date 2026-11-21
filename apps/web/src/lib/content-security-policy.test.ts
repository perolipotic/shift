import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  contentSecurityPolicy,
  CSP_HEADER,
  headersWithPolicy,
  inlineScriptsOf,
  supabaseOriginOf,
  withHeaderInAllPaths,
} from '@/lib/content-security-policy';

/**
 * Story 20.3: the SPA's Content-Security-Policy, derived at build time from
 * `VITE_SUPABASE_URL` and the built page's inline scripts. The build that
 * appends it to `dist/_headers` is asserted in `test/static-hosting.test.ts`.
 */

const HASH = 'opN87l8v3Ji3z7B0onNN92xFhHr7xIEJeAzuIJFBZTY=';

/** The policy as `directive -> sources`, so a test reads one directive at a time. */
function directivesOf(policy: string): Map<string, string[]> {
  return new Map(
    policy.split('; ').map((directive) => {
      const [name = '', ...sources] = directive.split(' ');
      return [name, sources];
    }),
  );
}

describe('the Content-Security-Policy header', () => {
  it('ships Report-Only until 20.5 verifies it', () => {
    expect(CSP_HEADER).toBe('Content-Security-Policy-Report-Only');
  });
});

describe('supabaseOriginOf', () => {
  it('reads the origin of an http(s) URL, lower-cased, with no path or default port', () => {
    expect(supabaseOriginOf('https://API.Example.test/rest/v1/')).toBe('https://api.example.test');
    expect(supabaseOriginOf('https://api.example.test:443')).toBe('https://api.example.test');
    expect(supabaseOriginOf('http://127.0.0.1:54321')).toBe('http://127.0.0.1:54321');
    expect(supabaseOriginOf('  https://api.example.test  ')).toBe('https://api.example.test');
  });

  it('answers null for a build with no origin', () => {
    expect(supabaseOriginOf(undefined)).toBeNull();
    expect(supabaseOriginOf('')).toBeNull();
    expect(supabaseOriginOf('   ')).toBeNull();
  });

  it('refuses a value no policy can name', () => {
    expect(() => supabaseOriginOf('api.example.test')).toThrow(/not a URL/);
    expect(() => supabaseOriginOf('https://')).toThrow(/not a URL/);
    expect(() => supabaseOriginOf('ftp://api.example.test')).toThrow(/not an http\(s\) URL/);
    expect(() => supabaseOriginOf('javascript:alert(1)')).toThrow(/not an http\(s\) URL/);
    expect(() => supabaseOriginOf('wss://api.example.test')).toThrow(/not an http\(s\) URL/);
    // WHATWG keeps these in a host; each would end a directive or the nginx string.
    for (const host of ['a"b.test', 'a;b.test', 'a,b.test', "a'b.test"]) {
      expect(() => supabaseOriginOf(`https://${host}`), host).toThrow(/cannot name/);
    }
  });
});

describe('inlineScriptsOf', () => {
  it('returns each inline script exactly as written, and skips a script with a src', () => {
    const page = [
      '<head>',
      '<script>\n  var a = 1;\n</script>',
      '<script type="module" crossorigin src="/assets/index-x.js"></script>',
      "<SCRIPT type='module'>b()</SCRIPT >",
      '</head>',
    ].join('\n');

    expect(inlineScriptsOf(page)).toEqual(['\n  var a = 1;\n', 'b()']);
  });

  it('never hashes a script inside a comment, and reads data-src as no src', () => {
    expect(inlineScriptsOf('<!-- <script>old()</script> --><script data-src="x">c()</script>')).toEqual(['c()']);
  });

  it('finds none on a page without one', () => {
    expect(inlineScriptsOf('<script src="/a.js"></script>')).toEqual([]);
  });

  it('keeps a <!-- inside a script’s text: only a comment outside a script is one', () => {
    expect(inlineScriptsOf('<script>var a = "<!--";</script><!-- x --><script>b()</script>')).toEqual([
      'var a = "<!--";',
      'b()',
    ]);
  });

  it('reads src only as an attribute name, never inside a quoted value', () => {
    expect(inlineScriptsOf('<script data-x="a src=b">c()</script>')).toEqual(['c()']);
    expect(inlineScriptsOf("<script title='src = x'>d()</script>")).toEqual(['d()']);
    expect(inlineScriptsOf('<script SRC="/a.js"></script><script defer src=/b.js></script>')).toEqual([]);
    expect(inlineScriptsOf('<script data-note="a > b">e()</script>')).toEqual(['e()']);
  });

  it('reads CRLF and CR as LF, as the browser’s parser does before hashing', () => {
    expect(inlineScriptsOf('<script>\r\n  a();\r  b();\n</script>')).toEqual(['\n  a();\n  b();\n']);
  });
});

describe('headersWithPolicy (the build’s step)', () => {
  const sha256Base64 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('base64');
  const headers = '/*\n  X-Frame-Options: DENY\n';
  const page = '<head><script>a()</script><script type="module" src="/assets/index-x.js"></script></head>';
  const policyOf = (built: string): string => built.split('\n').find((line) => line.includes(CSP_HEADER)) ?? '';

  it('names the origin in img-src and connect-src, and hashes the inline script', () => {
    const built = headersWithPolicy({ headers, page, supabaseUrl: 'https://api.example.test/', sha256Base64 });
    const directives = directivesOf(policyOf(built).replace(`  ${CSP_HEADER}: `, ''));

    expect(built.startsWith('/*\n  X-Frame-Options: DENY\n')).toBe(true);
    expect(directives.get('img-src')).toEqual(["'self'", 'https://api.example.test']);
    expect(directives.get('connect-src')).toEqual(["'self'", 'https://api.example.test']);
    expect(directives.get('script-src')).toEqual(["'self'", `'sha256-${sha256Base64('a()')}'`]);
  });

  it('names no origin for an empty value', () => {
    for (const supabaseUrl of ['', undefined]) {
      const directives = directivesOf(
        policyOf(headersWithPolicy({ headers, page, supabaseUrl, sha256Base64 })).replace(`  ${CSP_HEADER}: `, ''),
      );

      expect(directives.get('connect-src')).toEqual(["'self'"]);
      expect(directives.get('img-src')).toEqual(["'self'"]);
    }
  });

  it('refuses an ftp:// value', () => {
    expect(() => headersWithPolicy({ headers, page, supabaseUrl: 'ftp://api.example.test', sha256Base64 })).toThrow(
      /not an http\(s\) URL/,
    );
  });
});

describe('contentSecurityPolicy', () => {
  it('is the policy the spec names, with the Supabase origin for images and requests', () => {
    const policy = contentSecurityPolicy({ supabaseOrigin: 'https://api.example.test', scriptHashes: [HASH] });

    expect(policy).toBe(
      [
        "default-src 'self'",
        `script-src 'self' 'sha256-${HASH}'`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' https://api.example.test",
        "connect-src 'self' https://api.example.test",
        "font-src 'self'",
        "worker-src 'self'",
        "manifest-src 'self'",
        "base-uri 'self'",
        "form-action 'self'",
        "object-src 'none'",
        "frame-src 'none'",
        "frame-ancestors 'none'",
      ].join('; '),
    );
  });

  it('names no origin when the build has none', () => {
    const directives = directivesOf(contentSecurityPolicy({ supabaseOrigin: null, scriptHashes: [] }));

    expect(directives.get('img-src')).toEqual(["'self'"]);
    expect(directives.get('connect-src')).toEqual(["'self'"]);
    expect(directives.get('script-src')).toEqual(["'self'"]);
  });

  it('allows no unsafe script source, ever', () => {
    const policy = contentSecurityPolicy({ supabaseOrigin: 'https://api.example.test', scriptHashes: [HASH, HASH] });
    const script = directivesOf(policy).get('script-src') ?? [];

    expect(script).toEqual(["'self'", `'sha256-${HASH}'`]);
    expect(policy).not.toMatch(/unsafe-eval|unsafe-hashes|strict-dynamic|\*|data:|blob:/);
  });

  it('refuses a hash that is not a base64 SHA-256', () => {
    expect(() => contentSecurityPolicy({ supabaseOrigin: null, scriptHashes: ["x' 'unsafe-inline"] })).toThrow(
      /not a base64 SHA-256/,
    );
  });
});

describe('withHeaderInAllPaths', () => {
  const file = '# comment\n/*\n  X-Frame-Options: DENY\n  Referrer-Policy: no-referrer\n';

  it('adds the header as the last of the /* block', () => {
    expect(withHeaderInAllPaths(file, CSP_HEADER, "default-src 'self'")).toBe(
      `# comment\n/*\n  X-Frame-Options: DENY\n  Referrer-Policy: no-referrer\n  ${CSP_HEADER}: default-src 'self'\n`,
    );
  });

  it('stays inside the /* block when another block follows', () => {
    expect(withHeaderInAllPaths('/*\n  A: 1\n\n/x\n  B: 2\n', 'C', '3')).toBe('/*\n  A: 1\n  C: 3\n\n/x\n  B: 2\n');
  });

  it('refuses a file with no /* block, two of them, or one that already sets the header', () => {
    expect(() => withHeaderInAllPaths('/x\n  A: 1\n', 'C', '3')).toThrow(/no \/\* block/);
    expect(() => withHeaderInAllPaths('/*\n  A: 1\n/*\n  B: 2\n', 'C', '3')).toThrow(/more than one \/\* block/);
    expect(() => withHeaderInAllPaths(`/*\n  ${CSP_HEADER.toLowerCase()}: x\n`, CSP_HEADER, 'y')).toThrow(
      /already sets/,
    );
  });
});
