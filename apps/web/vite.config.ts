import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// AD-14: a static SPA build. No SSR, no application server, no prerender step.
// The publishable key (AD-17) is injected at build time through VITE_* env
// vars; the secret key never enters this build.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
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
    // The PNG icons in `public/` were generated once from `favicon.svg`, and
    // are committed rather than generated on each build:
    //   pnpm dlx @vite-pwa/assets-generator@2.0.0 --preset minimal-2023 public/favicon.svg
    // (its `favicon.ico` and 64 px icon were not kept; nothing links them).
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
        theme_color: '#f8fafc',
        background_color: '#f8fafc',
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
    // STORY 7.2. The Shift Figures files are ~1.3 KB each, under Vite's 4 KB
    // inline limit, so they would land in the CSS as data URIs and every
    // weight would ride along with the first stylesheet. As files, each is
    // fetched only when a digit at that weight renders (`unicode-range`).
    assetsInlineLimit: (file) => (file.endsWith('.woff2') ? false : undefined),
  },
});
