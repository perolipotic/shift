// Fails when the root Vitest run skipped anything.
//
// The root suite gates its build- and DB-dependent cases with `it.skipIf`, so a
// checkout with no build or no stack reports them as skipped rather than green
// (`test/static-hosting.test.ts`, `test/rls-isolation.test.ts`). That is the
// right answer locally and the wrong one in CI, where the job has started the
// stack and built the app: there a skip means a prerequisite silently went
// missing, and the assertions it gates never ran.
//
//   vitest run --reporter=default --reporter=json --outputFile.json=<report>
//   node scripts/ci/assert-no-skipped.mjs <report>

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * @typedef {{ fullName?: string, title?: string, status?: string }} Assertion
 * @typedef {{ name?: string, assertionResults?: Assertion[] }} FileResult
 * @typedef {{ numTotalTests?: number, testResults?: FileResult[] }} Report
 */

/** The statuses that mean the test body ran. */
const RAN = new Set(['passed', 'failed']);

/**
 * Every test that did not run, as `file › name (status)`, plus whether the
 * report ran anything at all.
 *
 * @param {Report} report
 * @param {string} [root]
 * @returns {{ total: number, skipped: string[] }}
 */
export function skippedTests(report, root = '') {
  /** @type {string[]} */
  const skipped = [];
  let total = 0;

  for (const file of report.testResults ?? []) {
    const name = (file.name ?? '?').replace(root, '').replace(/^\//, '');
    for (const assertion of file.assertionResults ?? []) {
      total += 1;
      const status = assertion.status ?? 'unknown';
      if (!RAN.has(status)) skipped.push(`${name} › ${assertion.fullName ?? assertion.title ?? '?'} (${status})`);
    }
  }
  return { total, skipped };
}

/** @param {readonly string[]} argv */
function main(argv) {
  const [file] = argv;
  if (file === undefined) {
    console.error('usage: node scripts/ci/assert-no-skipped.mjs <vitest-json-report>');
    process.exit(2);
  }

  const root = fileURLToPath(new URL('../..', import.meta.url));
  const { total, skipped } = skippedTests(JSON.parse(readFileSync(file, 'utf8')), root);

  if (total === 0) {
    process.stdout.write('::error title=No tests ran::the Vitest report lists no tests at all\n');
    process.exit(1);
  }
  if (skipped.length > 0) {
    process.stdout.write(
      `::error title=Skipped tests::${String(skipped.length)} of ${String(total)} root Vitest tests did not run. ` +
        'In CI the stack is up and the app is built, so a skip means a prerequisite went missing.\n',
    );
    for (const line of skipped) console.error(`  skipped: ${line}`);
    process.exit(1);
  }
  console.warn(`all ${String(total)} root Vitest tests ran; none skipped`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
