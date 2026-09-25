// Fails a deploy job before any remote command runs, naming every required
// secret or variable that is missing or malformed, rather than letting the
// first CLI call fail with an authorization error that reads like a paused
// project (DEPLOY.md §0).
//
//   node scripts/ci/require-config.mjs --environment staging \
//     secret:SUPABASE_ACCESS_TOKEN var:SUPABASE_PROJECT_REF:project-ref ...
//
// Each `kind:NAME[:format]` is looked up as the environment variable NAME,
// which the workflow maps from `secrets.NAME` or `vars.NAME`. A value is
// refused when it is absent, when it has leading or trailing whitespace (a
// dashboard paste with a newline is the usual way), or when it does not have
// its format's shape. Values are never printed.
//
// Exit codes: 0 all good, 1 something missing or malformed, 2 usage error
// (including no requirements at all — a check of nothing is not a pass).

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The shapes a value can be checked against. Each returns a reason, or null.
 *
 * @type {Readonly<Record<string, (value: string) => string | null>>}
 */
export const FORMATS = {
  // Supabase project refs are 20 lowercase letters and digits.
  'project-ref': (value) =>
    /^[a-z0-9]{20}$/.test(value) ? null : 'is not a Supabase project ref (20 lowercase letters and digits)',
  publishable: (value) =>
    /^sb_publishable_[A-Za-z0-9_-]+$/.test(value) ? null : 'is not a publishable key (sb_publishable_…)',
  secret: (value) => (/^sb_secret_[A-Za-z0-9_-]+$/.test(value) ? null : 'is not a secret key (sb_secret_…)'),
};

/**
 * @typedef {{ kind: 'secret' | 'var', name: string, format: string | null }} Requirement
 * @typedef {{ requirement: Requirement, reason: string }} Problem
 */

/**
 * @param {readonly string[]} specs
 * @returns {Requirement[]}
 */
export function parseRequirements(specs) {
  return specs.map((spec) => {
    const match = /^(secret|var):([A-Z][A-Z0-9_]*)(?::([a-z-]+))?$/.exec(spec);
    if (match === null) {
      throw new Error(`not a requirement (expected secret:NAME, var:NAME or kind:NAME:format): ${spec}`);
    }
    const [, kind, name = '', format = null] = match;
    if (format !== null && !(format in FORMATS)) throw new Error(`unknown format "${format}" in ${spec}`);
    return { kind: kind === 'secret' ? 'secret' : 'var', name, format };
  });
}

/**
 * Every requirement that is missing or malformed, with the reason.
 *
 * @param {readonly Requirement[]} requirements
 * @param {Readonly<Record<string, string | undefined>>} env
 * @returns {Problem[]}
 */
export function problems(requirements, env) {
  /** @type {Problem[]} */
  const found = [];
  for (const requirement of requirements) {
    const value = env[requirement.name] ?? '';
    if (value.trim() === '') {
      found.push({ requirement, reason: 'is not set' });
    } else if (value !== value.trim()) {
      found.push({ requirement, reason: 'has leading or trailing whitespace' });
    } else if (requirement.format !== null) {
      const reason = FORMATS[requirement.format]?.(value) ?? null;
      if (reason !== null) found.push({ requirement, reason });
    }
  }
  return found;
}

/**
 * The requirements whose value is absent or whitespace-only.
 *
 * @param {readonly Requirement[]} requirements
 * @param {Readonly<Record<string, string | undefined>>} env
 * @returns {Requirement[]}
 */
export function missing(requirements, env) {
  return problems(requirements, env)
    .filter(({ reason }) => reason === 'is not set')
    .map(({ requirement }) => requirement);
}

/**
 * One line per problem, in GitHub's annotation syntax.
 *
 * @param {readonly (Problem | Requirement)[]} found
 * @param {string} environment
 * @returns {string[]}
 */
export function describe(found, environment) {
  return found.map((entry) => {
    const { requirement, reason } =
      'requirement' in entry ? entry : { requirement: entry, reason: 'is not set' };
    const what = requirement.kind === 'secret' ? 'secret' : 'variable';
    const title = reason === 'is not set' ? `Missing ${what}` : `Invalid ${what}`;
    return (
      `::error title=${title}::${requirement.name} ${reason}. Set it as an Actions ${what} ` +
      `on the "${environment}" environment (DEPLOY.md §8.2).`
    );
  });
}

/** @param {readonly string[]} argv */
function main(argv) {
  const at = argv.indexOf('--environment');
  const environment = at === -1 ? 'repository' : (argv[at + 1] ?? 'repository');
  const specs = at === -1 ? argv : argv.filter((_, index) => index !== at && index !== at + 1);

  if (specs.length === 0) {
    console.error('usage: node scripts/ci/require-config.mjs [--environment NAME] kind:NAME[:format] ...');
    process.exit(2);
  }

  let requirements;
  try {
    requirements = parseRequirements(specs);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }

  const found = problems(requirements, process.env);
  if (found.length === 0) {
    console.warn(`all ${String(specs.length)} required secrets and variables are set for ${environment}`);
    return;
  }

  // Annotations are read from stdout.
  for (const line of describe(found, environment)) process.stdout.write(`${line}\n`);
  console.error(
    `${String(found.length)} required item(s) missing or invalid: ${found.map(({ requirement }) => requirement.name).join(', ')}`,
  );
  process.exit(1);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
