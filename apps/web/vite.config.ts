import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// AD-14: a static SPA build. No SSR, no application server, no prerender step.
// The publishable key (AD-17) is injected at build time through VITE_* env
// vars; the secret key never enters this build.
export default defineConfig({
  plugins: [react(), tailwindcss()],
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
    sourcemap: true,
    // STORY 7.2. The Shift Figures files are ~1.3 KB each, under Vite's 4 KB
    // inline limit, so they would land in the CSS as data URIs and every
    // weight would ride along with the first stylesheet. As files, each is
    // fetched only when a digit at that weight renders (`unicode-range`).
    assetsInlineLimit: (file) => (file.endsWith('.woff2') ? false : undefined),
  },
});
