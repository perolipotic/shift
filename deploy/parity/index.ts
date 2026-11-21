/**
 * The runtime-parity probe's Deno entry (story 16.2; AD-7, AD-19 test 2).
 *
 * CI's `runtime-parity` job bundles this file with the pinned `edge-runtime`
 * (`edge-runtime bundle`), serves the eszip as the main service in a
 * container with `--network none`, asks it once, and compares the answer
 * byte for byte with what `test/runtime-parity.test.ts` wrote under Node
 * (`scripts/ci/runtime-parity.sh`).
 *
 * `@shift/domain` resolves through `deno.json`'s import map onto the
 * package's tsc-built `dist`, exactly as a function's does (AD-7): never
 * `src/`, never an `npm:` or `jsr:` specifier, never a copy. It is NOT an
 * Edge Function: no router entry, no `config.toml` table, and the functions
 * image never holds it.
 */

import * as domain from '@shift/domain';

import * as fixtures from '../../packages/domain/parity/fixtures.ts';
import { runtimeParityProbe } from '../../packages/domain/parity/probe.ts';

interface ParityDenoRuntime {
  serve(handler: () => Promise<Response>): unknown;
}

const runtime = (globalThis as unknown as { Deno: ParityDenoRuntime }).Deno;

runtime.serve(async () => {
  try {
    return new Response(await runtimeParityProbe(domain, fixtures, crypto.subtle), {
      headers: { 'content-type': 'application/json' },
    });
  } catch (cause) {
    console.error('PARITY_PROBE_FAILED', cause);
    return new Response('PARITY_PROBE_FAILED', { status: 500 });
  }
});
