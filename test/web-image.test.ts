import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/**
 * Story 20.3: the `shift-web` image (`deploy/web/`), the SPA's static server on
 * the self-hosted stack. No container may run here, so the image itself is
 * built and probed by CI's `web-image` job (`scripts/ci/probe-web-image.sh`);
 * this file holds what can be held without one: the header translation, run
 * for real under `sh`, the nginx config, the Dockerfile's pins and the CI
 * job's shape. DB-free.
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const read = (...path: string[]): string => readFileSync(join(repoRoot, ...path), 'utf8');
const dist = join(repoRoot, 'apps', 'web', 'dist');
const notBuilt = !existsSync(join(dist, '_headers'));

const IMAGE =
  'nginxinc/nginx-unprivileged:1.30.6-alpine3.24@sha256:f5116ed4606f3eb015dd4a8e28cb9b351476dc0ad4bc6e9f93b19cec130cdf03';
const HEADERS_INCLUDE = 'include /etc/nginx/shift/security-headers.conf;';
const IMMUTABLE = 'public, max-age=31536000, immutable';

// ------------------------------------------------------- the translation

const scratch = mkdtempSync(join(tmpdir(), 'shift-web-image-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** Runs `render-headers.sh` under `sh` on `text` (or on a file path). */
function render(text: string | { file: string }): { status: number | null; stdout: string; stderr: string } {
  let file: string;
  if (typeof text === 'string') {
    file = join(scratch, `headers-${Math.random().toString(36).slice(2)}`);
    writeFileSync(file, text);
  } else {
    file = text.file;
  }
  const result = spawnSync('sh', [join(repoRoot, 'deploy', 'web', 'render-headers.sh'), file], { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** The `/*` block's headers, `[name, value]`, in order (the reading Cloudflare and the probe share). */
function allPathsHeaders(file: string): [string, string][] {
  const headers: [string, string][] = [];
  let block = '';
  for (const line of file.split('\n')) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      block = line.trim();
      continue;
    }
    if (block !== '/*') continue;
    const at = line.indexOf(':');
    headers.push([line.slice(0, at).trim(), line.slice(at + 1).trim()]);
  }
  return headers;
}

const nginxLines = (headers: [string, string][]): string =>
  headers.map(([name, value]) => `add_header ${name} "${value}" always;\n`).join('');

describe('the shift-web image (story 20.3): dist/_headers as nginx lines', () => {
  it('renders public/_headers one add_header … always per header, values identical', () => {
    const file = read('apps', 'web', 'public', '_headers');
    const headers = allPathsHeaders(file);
    const result = render({ file: join(repoRoot, 'apps', 'web', 'public', '_headers') });

    expect(headers.map(([name]) => name)).toEqual([
      'X-Content-Type-Options',
      'Referrer-Policy',
      'X-Frame-Options',
      'Permissions-Policy',
      'Strict-Transport-Security',
    ]);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(nginxLines(headers));
  });

  it.skipIf(notBuilt)('renders the BUILT dist/_headers, the Report-Only CSP included', () => {
    const file = readFileSync(join(dist, '_headers'), 'utf8');
    const result = render({ file: join(dist, '_headers') });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(nginxLines(allPathsHeaders(file)));
    expect(result.stdout).toMatch(/^add_header Content-Security-Policy-Report-Only "default-src 'self'; [^"]+" always;$/m);
    expect(result.stdout.trim().split('\n')).toHaveLength(6);
  });

  it('keeps a value with ; , ( ) = and quotes of the single kind as it is', () => {
    const result = render("/*\n  X: a; b, c=(d) 'e'\n");

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`add_header X "a; b, c=(d) 'e'" always;\n`);
  });

  it.each([
    ['a block other than /*', '/*\n  X: a\n/app/*\n  Y: b\n'],
    ['a second /* block', '/*\n  X: a\n/*\n  Y: b\n'],
    ['a Cache-Control (nginx sets it per location)', '/*\n  Cache-Control: no-store\n'],
    ...['Content-Type', 'content-length', 'Server', 'Date', 'ETag', 'Last-Modified', 'Vary', 'Content-Encoding', 'Accept-Ranges', 'Content-Range', 'Connection', 'Keep-Alive', 'Transfer-Encoding', 'Location', 'Expires'].map(
      (name): [string, string] => [`a ${name} (nginx sets it)`, `/*\n  ${name}: x\n`],
    ),
    ['a non-ASCII value', '/*\n  X: café\n'],
    ['a high byte', '/*\n  X: a\u0080b\n'],
    ['a header before any block', '  X: a\n'],
    ['a ! detach', '/*\n  ! X-Frame-Options\n'],
    ['a duplicate name', '/*\n  X-Frame-Options: DENY\n  x-frame-options: SAMEORIGIN\n'],
    ['a double quote', '/*\n  X: a"b\n'],
    ['a dollar', '/*\n  X: $host\n'],
    ['a backslash', '/*\n  X: a\\b\n'],
    ['a tab inside', '/*\n  X: a\tb\n'],
    ['a carriage return (a CRLF file)', '/*\r\n  X: a\r\n'],
    ['a control character', '/*\n  X: a\u0001b\n'],
    ['a DEL', '/*\n  X: a\u007fb\n'],
    ['no colon', '/*\n  X-Frame-Options DENY\n'],
    ['a name that is not a token', '/*\n  X Frame: DENY\n'],
    ['an empty value', '/*\n  X:\n'],
    ['no header at all', '# nothing\n/*\n'],
  ])('refuses %s, printing nothing', (_why, text) => {
    const result = render(text);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/^render-headers: /);
  });

  it('refuses a missing file', () => {
    expect(render({ file: join(scratch, 'absent') }).status).not.toBe(0);
  });

  it('is POSIX sh and awk: no bash, no gawk extension', () => {
    const script = read('deploy', 'web', 'render-headers.sh');

    expect(script.split('\n')[0]).toBe('#!/bin/sh');
    expect(script).not.toMatch(/\[\[|\bfunction \w+ *\(\)|\$'|gensub|PROCINFO|\bmapfile\b|\blocal\b/);
  });
});

// --------------------------------------------------------- the nginx config

interface Block {
  readonly head: string;
  readonly body: string;
}

/** The `location … { … }` blocks of a server (none nests another here). */
function locationsOf(config: string): Block[] {
  return [...config.matchAll(/^\s*location\s+([^{]+?)\s*\{([\s\S]*?)^\s*\}/gm)].map((match) => ({
    head: (match[1] ?? '').trim(),
    body: match[2] ?? '',
  }));
}

describe('the shift-web image (story 20.3): the nginx config', () => {
  const config = read('deploy', 'web', 'default.conf');
  const directives = config
    .split('\n')
    .map((line) => line.replace(/#.*$/, '').trim())
    .filter((line) => line !== '');
  const locations = locationsOf(config);
  const location = (head: string): Block => {
    const found = locations.find((block) => block.head === head);
    expect(found, `no location ${head}`).toBeDefined();
    return found ?? { head, body: '' };
  };

  it('listens on 8080 over IPv4 only, names no version and makes relative redirects', () => {
    expect(directives.filter((line) => line.startsWith('listen '))).toEqual(['listen 8080;']);
    expect(directives).toContain('server_tokens off;');
    expect(directives).toContain('absolute_redirect off;');
    expect(directives).toContain('root /usr/share/nginx/html;');
    expect(directives).toContain('gzip on;');
  });

  it('includes the rendered headers at the server and in EVERY location', () => {
    const serverLevel = config.replace(/^\s*location\s+[^{]+\{[\s\S]*?^\s*\}/gm, '');

    expect(serverLevel).toContain(HEADERS_INCLUDE);
    expect(locations.map((block) => block.head).sort()).toEqual(
      ['/', '/assets/', '= /assets/', '= /site.webmanifest', '~ \\.map$', '@missing'].sort(),
    );
    for (const block of locations) expect(block.body, block.head).toContain(HEADERS_INCLUDE);
  });

  it('sets no header but Cache-Control: every security header is the rendered file’s', () => {
    const named = directives
      .filter((line) => line.startsWith('add_header '))
      .map((line) => line.split(/\s+/)[1]);

    expect(new Set(named)).toEqual(new Set(['Cache-Control']));
    expect(config).not.toMatch(/more_set_headers|proxy_hide_header|expires /);
  });

  it('serves /assets/ immutable for a year on success only, and a missing file as a plain 404', () => {
    const assets = location('/assets/').body;

    expect(assets).toContain(`add_header Cache-Control "${IMMUTABLE}";`);
    expect(assets).not.toMatch(/immutable"\s+always/);
    expect(assets).toMatch(/try_files \$uri @missing;/);
    expect(assets).not.toContain('index.html');

    // A missing file, and the directory itself (else 403), are the same plain 404.
    for (const head of ['@missing', '= /assets/']) {
      const missing = location(head).body;
      expect(missing, head).toContain('return 404 "Not found\\n";');
      expect(missing, head).toContain('types { }');
      expect(missing, head).toContain('default_type text/plain;');
      expect(missing, head).toContain('add_header Cache-Control "no-cache" always;');
    }
  });

  it('answers every other path from the file or index.html, no-cache', () => {
    const root = location('/').body;

    expect(root).toMatch(/try_files \$uri \/index\.html;/);
    expect(root).toContain('add_header Cache-Control "no-cache" always;');
    expect(directives.filter((line) => line.includes('immutable'))).toEqual([
      `add_header Cache-Control "${IMMUTABLE}";`,
    ]);
  });

  it('answers every *.map 404, and serves the manifest as application/manifest+json', () => {
    const map = location('~ \\.map$').body;
    expect(map).toContain('return 404');
    expect(map).not.toContain('try_files');

    const manifest = location('= /site.webmanifest').body;
    expect(manifest).toContain('types { }');
    expect(manifest).toContain('default_type application/manifest+json;');
    expect(manifest).toContain('add_header Cache-Control "no-cache" always;');
  });
});

// --------------------------------------------------------------- the image

describe('the shift-web image (story 20.3): the Dockerfile', () => {
  const dockerfile = read('deploy', 'web', 'Dockerfile');
  const instructions = dockerfile
    .replace(/\s*\\\n\s*/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
  const finalStage = instructions.slice(instructions.findLastIndex((line) => line.startsWith('FROM ')));

  it('builds both stages on nginx-unprivileged pinned by tag and digest', () => {
    expect(instructions.filter((line) => line.startsWith('FROM '))).toEqual([`FROM ${IMAGE} AS render`, `FROM ${IMAGE}`]);
  });

  it('refuses a dist/_headers without a Content-Security-Policy line, before rendering it', () => {
    const guard = instructions.findIndex((line) => line.startsWith('RUN grep -Eq '));
    const renderAt = instructions.findIndex((line) => line.startsWith('RUN sh /tmp/render/render-headers.sh'));

    expect(instructions[guard]).toBe(
      "RUN grep -Eq '^[[:space:]]+Content-Security-Policy(-Report-Only)?:' /tmp/render/_headers || { echo 'shift-web: dist/_headers has no Content-Security-Policy line' >&2; exit 1; }",
    );
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(renderAt);
    // The same pattern, run here, tells a built file from a pre-plugin one.
    const pattern = /^\s+Content-Security-Policy(-Report-Only)?:/m;
    expect(pattern.test(read('apps', 'web', 'public', '_headers'))).toBe(false);
    expect(pattern.test("/*\n  Content-Security-Policy-Report-Only: default-src 'self'\n")).toBe(true);
  });

  it('renders the headers from the built dist/_headers with the script', () => {
    expect(instructions).toContain('COPY --chmod=0644 deploy/web/render-headers.sh apps/web/dist/_headers /tmp/render/');
    expect(instructions).toContain(
      'RUN sh /tmp/render/render-headers.sh /tmp/render/_headers > /tmp/security-headers.conf',
    );
    expect(finalStage).toContain(
      'COPY --from=render --chown=root:root /tmp/security-headers.conf /etc/nginx/shift/security-headers.conf',
    );
  });

  it('ships the built dist and its server, root-owned and not writable by uid 101', () => {
    expect(finalStage).toContain('COPY --chown=root:root deploy/web/default.conf /etc/nginx/conf.d/default.conf');
    expect(finalStage).toContain('COPY --chown=root:root apps/web/dist/ /usr/share/nginx/html/');
    const hardening = finalStage.find((line) => line.includes('chown -R root:root')) ?? '';
    expect(hardening).toContain('chown -R root:root /etc/nginx /var/cache/nginx /usr/share/nginx/html');
    expect(hardening).toContain('chmod -R go-w /etc/nginx /var/cache/nginx /usr/share/nginx/html');
    // Readable by uid 101 whatever modes the artifact download left.
    expect(hardening).toContain('chmod -R a+rX /usr/share/nginx/html /etc/nginx/shift');
    expect(hardening.indexOf('a+rX')).toBeGreaterThan(hardening.indexOf('go-w'));
    expect(hardening).toContain('rm -f /usr/share/nginx/html/_headers /usr/share/nginx/html/_redirects');
    expect(hardening).toMatch(/find \/usr\/share\/nginx\/html -name '\*\.map'.*exit 1/);
  });

  it('checks its config at build, after the last change to it, and then runs as uid 101', () => {
    const users = finalStage.filter((line) => line.startsWith('USER '));
    expect(users).toEqual(['USER root', 'USER 101']);
    const check = finalStage.indexOf('RUN nginx -t && rm -rf /tmp/*');
    expect(check, 'nginx -t is not run at build').toBeGreaterThan(-1);
    // Nothing is copied or changed after the check, and the base's entrypoint
    // and command (`nginx -g 'daemon off;'`) stay.
    expect(finalStage.slice(check + 1)).toEqual([
      'USER 101',
      'EXPOSE 8080',
      'HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1',
    ]);
    expect(instructions.filter((line) => /^(ENTRYPOINT|CMD) /.test(line))).toEqual([]);
  });

  it('takes no secret, argument or variable at build time', () => {
    expect(instructions.filter((line) => /^(ARG|ENV|ADD) /.test(line))).toEqual([]);
    expect(dockerfile).not.toMatch(/--secret|sb_secret_|sb_publishable_[A-Za-z0-9]|re_[A-Za-z0-9]{8}/);
  });

  it('builds from a context that holds no source map', () => {
    const ignored = read('.dockerignore').split('\n').map((line) => line.trim());
    expect(ignored).toContain('apps/web/dist/**/*.map');
    expect(ignored.filter((line) => line.startsWith('!'))).toEqual(['!**/.env.example']);
  });
});

// -------------------------------------------------------------------- CI

interface Step {
  readonly uses?: string;
  readonly name?: string;
  readonly run?: string;
  readonly with?: Record<string, unknown>;
  readonly env?: Record<string, unknown>;
}
interface Job {
  readonly needs?: string | string[];
  readonly steps?: Step[];
  readonly environment?: unknown;
  readonly permissions?: unknown;
  readonly if?: string;
}

describe('the shift-web image (story 20.3): CI builds and probes it, never pushes it', () => {
  const pipelineText = read('.github', 'workflows', 'pipeline.yml');
  const pipeline = parse(pipelineText) as { jobs: Record<string, Job> };
  const job = pipeline.jobs['web-image'] ?? {};
  const jobText = JSON.stringify(job);
  const probe = read('scripts', 'ci', 'probe-web-image.sh');

  it('needs the build job, takes its dist, builds the image and probes it', () => {
    const steps = job.steps ?? [];
    expect(job.needs).toBe('build');
    expect(steps.map((step) => step.uses ?? step.run)).toEqual([
      'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
      'actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333',
      'docker build --pull -f deploy/web/Dockerfile -t "shift-web:ci-$GITHUB_SHA" .',
      'bash scripts/ci/probe-web-image.sh "shift-web:ci-$GITHUB_SHA" apps/web/dist',
    ]);
    expect(steps[0]?.with).toEqual({ 'persist-credentials': false });
    expect(steps[1]?.with).toEqual({ name: 'web-dist', path: 'apps/web/dist' });
    expect(pipelineText).toMatch(/actions\/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8\.0\.2/);
  });

  it('holds no secret, no environment, no login and no push', () => {
    expect(jobText).not.toMatch(/secrets\.|vars\.|docker login|docker push|--push|registry|ghcr/i);
    expect(job.environment).toBeUndefined();
    expect(job.permissions).toBeUndefined();
    expect(job.if).toBeUndefined();
    expect(probe).not.toMatch(/docker (login|push|tag)|--push|curl |wget /);
  });

  it('is required by ci-passed and reported by notify', () => {
    expect(pipeline.jobs['ci-passed']?.needs).toContain('web-image');
    expect(pipeline.jobs['notify']?.needs).toContain('web-image');
  });

  it('runs the container with no network and a read-only root, and probes the spec’s matrix', () => {
    expect(probe).toMatch(/docker run -d --name "\$name" --network none --read-only --tmpfs \/tmp "\$image"/);
    expect(probe).toContain('HTTP/1.0');
    expect(probe).toContain('nc 127.0.0.1 8080');
    for (const line of [
      'expect / 200 text/html no-cache',
      'expect /kalendar/2026-09 200 text/html no-cache',
      'expect /sw.js 200 application/javascript no-cache',
      'expect /push-sw.js 200 application/javascript no-cache',
      `expect "/$asset" 200 application/javascript '${IMMUTABLE}'`,
      'expect /assets/nope.js 404 text/plain no-cache',
      'expect /assets/x.js.map 404 text/plain no-cache',
      'expect /site.webmanifest 200 application/manifest+json no-cache',
      `expect "/$stylesheet" 200 text/css '${IMMUTABLE}'`,
      'expect /assets/ 404 text/plain no-cache',
      "METHOD=POST EXTRA='Content-Length: 0\\r\\n' expect / 405 - no-cache",
      'METHOD=HEAD expect / 200 text/html no-cache',
      `PROTO=1.1 EXTRA='Accept-Encoding: gzip\\r\\n' expect "/$asset" 200 application/javascript`,
      "grep -qix 'Content-Encoding: gzip' <<< \"$last_head\"",
      "grep -qix 'Vary: Accept-Encoding' <<< \"$last_head\"",
    ]) {
      expect(probe, line).toContain(line);
    }
    expect(probe).toContain('/proc/1/status');
    expect(probe).toContain("find /usr/share/nginx/html -name '*.map'");
    expect(probe).toMatch(/-user 101 -o -group 101 -perm -0020 -o -perm -0002/);
    expect(probe).toContain('trap cleanup EXIT');
  });

  it('probes revalidation, a refusal made before any location, the HEALTHCHECK and busybox refusals', () => {
    for (const line of [
      'EXTRA="If-Modified-Since: $modified\\r\\n" expect "$path" 304 - "$cache"',
      'expect / 400 - none',
      "docker inspect --format '{{index .Config.Healthcheck.Test 1}}'",
      'docker run --rm --network none --read-only --entrypoint sh',
      'Content-Security-Policy(-Report-Only)?: ',
    ]) {
      expect(probe, line).toContain(line);
    }
    // The entry chunk is the one the built page names, not any index-*.js.
    expect(probe).toContain('<script type="module"');
  });

  /**
   * The CI `test` job's build has a placeholder origin, so `static-hosting.test.ts`
   * asserts the plugin's origin wiring with an origin and not only the null
   * branch. Dropping that line would make the assertion vacuous silently.
   */
  it('gives the test job’s build a placeholder origin, written before the build', () => {
    const build = (pipeline.jobs['test']?.steps ?? []).find((step) => step.name === 'Build');

    expect(build?.run?.split('\n').filter((line) => line.trim() !== '')).toEqual([
      "printf 'VITE_SUPABASE_URL=https://api.example.test\\n' > apps/web/.env.production.local",
      'pnpm build',
    ]);
  });
});
