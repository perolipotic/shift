import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

import { AUTH_EMAIL_DIRECTORY, authEmailTemplates } from './src/lib/auth-email';
import { headersWithPolicy, supabaseOriginOf } from './src/lib/content-security-policy';

/** The addresses a loopback caller arrives from. */
const LOOPBACK: ReadonlySet<string> = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** The path the dev server answers with its checkout (retro 10 A14). */
export const CHECKOUT_PATH = '/__shift/checkout';

/**
 * DEV SERVER ONLY (retro 10 A14): `GET /__shift/checkout` answers the
 * repository root this server was started from, as `{ "root": "…" }`, to a
 * loopback caller only (any other caller gets 404). The e2e
 * global setup reuses a server already on 127.0.0.1:5173 only when it is this
 * checkout's, so a parallel session's Vite never silently serves another
 * branch's run. `apply: 'serve'`: nothing of it reaches a build.
 */
function checkoutAnswer(): Plugin {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  return {
    name: 'shift-checkout-answer',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(CHECKOUT_PATH, (request, response) => {
        // LOOPBACK CALLERS ONLY: a server started with a LAN `--host` (the
        // demo) must not tell the network where the checkout lives.
        const caller = request.socket.remoteAddress ?? '';
        if (!LOOPBACK.has(caller)) {
          response.statusCode = 404;
          response.end();
          return;
        }
        response.setHeader('content-type', 'application/json');
        response.setHeader('cache-control', 'no-store');
        response.end(JSON.stringify({ root }));
      });
    },
  };
}

/**
 * BUILD ONLY (story 20.3): once the bundle is written, the Content-Security-
 * Policy is derived from this build's `VITE_SUPABASE_URL` and the SHA-256 of
 * each inline script of the written `index.html`, and appended to
 * `dist/_headers`' `/*` block (`headersWithPolicy` in
 * `src/lib/content-security-policy.ts`; this plugin only reads and writes the
 * files). The
 * `shift-web` image serves that block on every response (`deploy/web/`). A
 * missing `index.html` or `_headers`, or an origin no policy can name, fails
 * the build.
 */
function contentSecurityPolicyHeader(): Plugin {
  let outDir = '';
  let supabaseUrl: string | undefined;
  return {
    name: 'shift-content-security-policy',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
      supabaseUrl = config.env['VITE_SUPABASE_URL'] as string | undefined;
      // Refuse an unusable origin before anything is bundled.
      supabaseOriginOf(supabaseUrl);
    },
    writeBundle: {
      order: 'post',
      handler() {
        const page = join(outDir, 'index.html');
        const headers = join(outDir, '_headers');
        if (!existsSync(page)) throw new Error(`${page} is missing: no Content-Security-Policy can be derived`);
        if (!existsSync(headers)) throw new Error(`${headers} is missing: nowhere to put the Content-Security-Policy`);

        writeFileSync(
          headers,
          headersWithPolicy({
            headers: readFileSync(headers, 'utf8'),
            page: readFileSync(page, 'utf8'),
            supabaseUrl,
            sha256Base64: (text) => createHash('sha256').update(text, 'utf8').digest('base64'),
          }),
        );
      },
    },
  };
}

/**
 * BUILD ONLY (story 19.1, AD-21): the Croatian Auth email templates, built
 * from `hr.json`'s `signup.email` keys (`src/lib/auth-email.ts`) and emitted
 * as `dist/auth-email/*.html`. GoTrue fetches them from the app origin
 * (`GOTRUE_MAILER_TEMPLATES_*`). They are no part of the app: the worker
 * never precaches them (`globIgnores` below). A missing message fails the
 * build.
 */
function authEmail(): Plugin {
  const resource = fileURLToPath(new URL('./src/lib/i18n/locales/hr.json', import.meta.url));
  return {
    name: 'shift-auth-email',
    apply: 'build',
    generateBundle() {
      for (const { file, html } of authEmailTemplates(JSON.parse(readFileSync(resource, 'utf8')))) {
        this.emitFile({ type: 'asset', fileName: `${AUTH_EMAIL_DIRECTORY}/${file}`, source: html });
      }
    },
  };
}

// AD-14: a static SPA build. No SSR, no application server, no prerender step.
// The publishable key (AD-17) is injected at build time through VITE_* env
// vars; the secret key never enters this build.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    checkoutAnswer(),
    contentSecurityPolicyHeader(),
    authEmail(),
    // STORY 8.1. AD-14 stays intact: the PWA adds client-side pieces only, a
    // manifest and a service worker generated at build time, with no server.
    //
    // `prompt`, never `autoUpdate`: a new version waits until the member taps
    // *Osvježi* (`components/update-notice.tsx`), so nothing reloads mid-task.
    // `injectRegister: false` because registration is imported from
    // `virtual:pwa-register/react` in app code; an injected script would be a
    // second script on the built page. No `devOptions`: e2e runs on the dev
    // server, which must stay worker-free.
    //
    // The name is "Shift" (the human's decision, 2026-10-19), with no
    // organization's name or logo: a per-organization manifest is deferred.
    // The colour is `--background` in the light theme; the dark one stays in
    // `index.html`'s `theme-color` pair, which the manifest format cannot hold.
    //
    // The PNG icons in `public/` are rendered from `favicon.svg` (the rotation
    // ring on ink, 2026-10-30) and committed rather than generated on each
    // build: 192 and 512 keep the rounded corners on transparency; the
    // maskable 512 and the 180 Apple touch icon are the same drawing full
    // bleed (no corner radius), because the platform applies its own mask.
    //
    // The worker precaches the app shell only. It has no runtime caching, so
    // a Supabase request (or any other cross-origin one) always goes to the
    // network; offline reads are story 8.2's persisted query cache. No worker
    // sourcemap, so `sw.js` and `workbox-*.js` name no map.
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      manifestFilename: 'site.webmanifest',
      // The icons are PNGs in `public/`, which `globPatterns` already
      // precaches; adding them again would list each one twice.
      includeManifestIcons: false,
      manifest: {
        // A stable identity, so a later change to `start_url` does not make
        // the browser treat the installed app as a different one.
        id: '/',
        name: 'Shift',
        short_name: 'Shift',
        lang: 'hr',
        start_url: '/',
        display: 'standalone',
        theme_color: '#e8edf5',
        background_color: '#e8edf5',
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,svg,png}'],
        // STORY 10.4. The push handlers (`public/push-sw.js`) are imported
        // by the worker, never precached: the browser checks an imported
        // script for updates with the worker itself.
        //
        // STORY 14.3. The change history's PDF writer (`pdfmake`, ~0.8 MB) and
        // its Roboto fonts (~0.9 MB) are loaded by `import()` only when an
        // admin exports, and never precached: no install downloads them, and
        // the export is online only, as the history is. Rolldown names each
        // chunk after its module (`pdfmake.js`, `vfs_fonts.js`);
        // `test/static-hosting.test.ts` finds the writer chunks by their
        // contents and proves `sw.js` lists neither.
        //
        // STORY 19.1. The Auth email templates GoTrue fetches are no part of
        // the app, and never precached.
        globIgnores: [
          '**/node_modules/**/*',
          'push-sw.js',
          'assets/pdfmake-*.js',
          'assets/vfs_fonts-*.js',
          'auth-email/**',
        ],
        importScripts: ['push-sw.js'],
        navigateFallback: '/index.html',
        sourcemap: false,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // STORY 2.1b. The domain package's SOURCE, not its `dist/`: the root
      // `typecheck` and `test` never build, so a link through `dist/` would
      // make both depend on a build nobody ran (AD-7 keeps the package pure;
      // this only decides where its files are read from).
      '@shift/domain': fileURLToPath(
        new URL('../../packages/domain/src/index.ts', import.meta.url),
      ),
    },
  },
  build: {
    outDir: 'dist',
    // HIDDEN: the maps are built, so a production stack trace can still be
    // decoded from the same build, but no chunk names its map, and the deploy
    // deletes `*.map` before upload (DEPLOY.md §4): the CDN never serves the
    // original sources and their comments.
    sourcemap: 'hidden',
    // STORY 7.2, kept by story 15.1. No font file is inlined into the CSS as
    // a data URI, whatever its size: as a file, each subset is fetched only
    // when a character in its `unicode-range` renders. (The rule was written
    // for the ~1.3 KB Shift Figures files; Outfit, which replaced them, ships
    // subsets over Vite's 4 KB limit, and the rule keeps a smaller one honest.)
    assetsInlineLimit: (file) => (file.endsWith('.woff2') ? false : undefined),
  },
});
