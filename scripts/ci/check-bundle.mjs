// Story 20.6 (AD-17 as amended): the bundle about to ship carries no secret.
//
//   node scripts/ci/check-bundle.mjs <dist> [<vapid public key>]
//
// Self-hosted, GitHub holds none of an environment's runtime secrets, so the
// deploy cannot grep for their values as it did on the hosted platform. It
// refuses their SHAPES instead, in every file under <dist> (maps included,
// although the deploy deletes them before the image is built):
//
// - an opaque secret key: `sb_secret_` followed by 20 or more key characters;
// - a JWT whose payload carries a `role` other than `anon` (a `service_role`
//   key pasted into the build); a JWT-shaped string with no role is no key;
// - a Resend API key: `re_` at a word start followed by a long run of key
//   characters (the shape test/key-hygiene.test.ts refuses in the repository);
// - the Web Push private key of THIS environment's public key: every
//   43-character base64url run (or padded standard base64) that is not part
//   of a longer run is tried as a P-256 private key, and the
//   check fails if one derives the public key the bundle subscribes under.
//   That is exact: no other 43-character string can derive it.
//
// It prints where (the file and the kind), never the value. Exit codes: 0
// clean, 1 a finding, 2 usage error.

import { createECDH } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SECRET_KEY = /sb_secret_[A-Za-z0-9_-]{20,}/;
const RESEND_KEY = /(?<![A-Za-z0-9_])re_[A-Za-z0-9]{6,}_[A-Za-z0-9]{16,}/;
const JWT = /eyJ[A-Za-z0-9_-]{8,}\.(eyJ[A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{8,}/g;
// Every 43-character base64url run, or 43 standard-base64 characters and one
// `=` (the same 32 bytes, padded), not part of a longer run.
const KEY_43 = /(?<![A-Za-z0-9_+/-])([A-Za-z0-9_-]{43}|[A-Za-z0-9+/]{43}=)(?![A-Za-z0-9_+/=-])/g;

/**
 * The kinds of secret found in one text, at most one finding per kind.
 *
 * @param {string} text
 * @param {string} [vapidPublicKey] this environment's VAPID public key (base64url)
 * @returns {string[]}
 */
export function findSecrets(text, vapidPublicKey = '') {
  /** @type {string[]} */
  const found = [];
  if (SECRET_KEY.test(text)) found.push('an sb_secret_ key');
  if (RESEND_KEY.test(text)) found.push('a Resend API key');

  for (const match of text.matchAll(JWT)) {
    const role = jwtRole(match[1] ?? '');
    // A stack key always carries a role; a JWT-shaped string without one (a
    // library's example token) is not a key of ours.
    if (role !== undefined && role !== null && role !== 'anon') {
      found.push(`a JWT whose role is ${JSON.stringify(role)}, not "anon"`);
      break;
    }
  }

  if (vapidPublicKey !== '') {
    for (const match of text.matchAll(KEY_43)) {
      if (derivesPublicKey(match[1] ?? '', vapidPublicKey)) {
        found.push('the VAPID private key of this environment');
        break;
      }
    }
  }
  return found;
}

/**
 * @param {string} payload base64url JSON
 * @returns {unknown} the role claim, or null when the payload is not JSON
 */
export function jwtRole(payload) {
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof claims === 'object' && claims !== null && 'role' in claims ? claims.role : undefined;
  } catch {
    return null;
  }
}

/**
 * @param {string} candidate base64url, 43 characters
 * @param {string} publicKey base64url, 65 bytes uncompressed
 */
function derivesPublicKey(candidate, publicKey) {
  try {
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(Buffer.from(candidate, 'base64url'));
    return ecdh.getPublicKey('base64url') === publicKey;
  } catch {
    return false;
  }
}

/** @param {string} root */
function filesUnder(root) {
  /** @type {string[]} */
  const files = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) files.push(...filesUnder(path));
    else files.push(path);
  }
  return files;
}

/**
 * Every finding under a directory, as `<relative path>: <kind>`.
 *
 * @param {string} dist
 * @param {string} [vapidPublicKey]
 * @returns {string[]}
 */
export function checkBundle(dist, vapidPublicKey = '') {
  return filesUnder(dist).flatMap((file) =>
    findSecrets(readFileSync(file, 'latin1'), vapidPublicKey).map((kind) => `${relative(dist, file)}: ${kind}`),
  );
}

/** @param {readonly string[]} argv */
function main(argv) {
  const [dist, vapidPublicKey = ''] = argv;
  if (dist === undefined || argv.length > 2) {
    console.error('usage: node scripts/ci/check-bundle.mjs <dist> [<vapid public key>]');
    process.exit(2);
  }
  let files;
  try {
    files = filesUnder(dist);
  } catch {
    console.error(`check-bundle: ${dist} is not a directory`);
    process.exit(2);
  }
  if (files.length === 0) {
    // Checking nothing is not a pass.
    console.error(`check-bundle: ${dist} holds no file`);
    process.exit(2);
  }

  const findings = checkBundle(dist, vapidPublicKey);
  if (findings.length === 0) {
    console.warn(`${String(files.length)} files, no secret-shaped value`);
    return;
  }
  for (const finding of findings) process.stdout.write(`::error title=Secret in bundle::${finding}\n`);
  process.exit(1);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
