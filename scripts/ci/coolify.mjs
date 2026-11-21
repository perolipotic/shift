// Story 20.6 (H-9): the two Coolify API calls the deploy makes, with a token
// that can deploy and nothing else (Coolify's `deploy` ability).
//
//   COOLIFY_API_URL=… COOLIFY_API_TOKEN=… node scripts/ci/coolify.mjs deploy-application <uuid>
//   COOLIFY_API_URL=… COOLIFY_API_TOKEN=… node scripts/ci/coolify.mjs restart-service <uuid>
//
// `deploy-application` queues a deployment of a Docker-image application
// (`shift-web`): `POST /api/v1/deploy?uuid=<uuid>&force=false`. Coolify pulls
// the application's configured image tag (the environment's channel tag,
// which the deploy job has just pointed at the probed digest) and replaces
// the container. Prints `deployment-uuid=<id>`.
//
// `restart-service` restarts a whole service stack with its images pulled
// again (`POST /api/v1/services/<uuid>/restart?latest=true`): the only call a
// deploy-only token has that makes Coolify pull a service's image. Coolify
// v4.7.6 stops every container of the stack, pulls, and recreates them, so
// Postgres restarts too (the deploy proves the restart by that).
//
// Both calls are queued by Coolify and answered at once. The token is sent in
// the Authorization header only and never printed; an error prints the HTTP
// status and Coolify's own `message`, cut short. Exit codes: 0 queued, 1
// refused, 2 usage error.

import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * @typedef {(url: string, init: { method: string, headers: Record<string, string>, signal?: AbortSignal }) => Promise<{ status: number, text: () => Promise<string> }>} Fetch
 * @typedef {{ apiUrl: string, token: string, fetch: Fetch, timeoutMs?: number }} Client
 */

/** Coolify's resource ids are lowercase letters and digits (require-config's `coolify-uuid`). */
const UUID = /^[a-z0-9]{8,64}$/;

/**
 * One POST to Coolify's API. Resolves to the parsed JSON body of a 2xx.
 *
 * @param {Client} client
 * @param {string} path beginning with `/`
 * @returns {Promise<unknown>}
 */
export async function post(client, path) {
  const base = client.apiUrl.replace(/\/+$/, '');
  let response;
  try {
    response = await client.fetch(`${base}/api/v1${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${client.token}`, accept: 'application/json' },
      signal: AbortSignal.timeout(client.timeoutMs ?? 30_000),
    });
  } catch (error) {
    throw new Error(`Coolify did not answer ${path} (${error instanceof Error ? error.name : 'error'})`, {
      cause: error,
    });
  }
  const text = await response.text();
  /** @type {unknown} */
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  if (response.status < 200 || response.status > 299) {
    throw new Error(`Coolify refused ${path}: HTTP ${String(response.status)} ${messageOf(body, client.token)}`);
  }
  return body;
}

/**
 * Coolify's `message`, at most 200 characters, with the token blanked in case
 * an error ever echoed it.
 *
 * @param {unknown} body
 * @param {string} token
 */
export function messageOf(body, token) {
  const message =
    typeof body === 'object' && body !== null && 'message' in body && typeof body.message === 'string'
      ? body.message
      : '(no message)';
  const safe = token === '' ? message : message.split(token).join('[token]');
  return safe.replace(/[\r\n]+/g, ' ').slice(0, 200);
}

/**
 * @param {Client} client
 * @param {string} uuid
 * @returns {Promise<string>} the queued deployment's uuid
 */
export async function deployApplication(client, uuid) {
  if (!UUID.test(uuid)) throw new Error('not a Coolify resource uuid');
  const body = await post(client, `/deploy?uuid=${uuid}&force=false`);
  const deployments =
    typeof body === 'object' && body !== null && 'deployments' in body && Array.isArray(body.deployments)
      ? body.deployments
      : [];
  /** @type {unknown} */
  const ours = deployments.find(
    (entry) => typeof entry === 'object' && entry !== null && entry.resource_uuid === uuid,
  );
  const id =
    typeof ours === 'object' && ours !== null && 'deployment_uuid' in ours && typeof ours.deployment_uuid === 'string'
      ? ours.deployment_uuid
      : '';
  if (id === '') {
    // Coolify answers 200 with a per-resource message when it queued nothing
    // (not an application, unauthorized, skipped): that is a failure here.
    throw new Error(`Coolify queued no deployment for ${uuid}: ${messageOf(ours ?? body, client.token)}`);
  }
  return id;
}

/**
 * @param {Client} client
 * @param {string} uuid
 * @returns {Promise<string>} Coolify's message
 */
export async function restartService(client, uuid) {
  if (!UUID.test(uuid)) throw new Error('not a Coolify resource uuid');
  const body = await post(client, `/services/${uuid}/restart?latest=true`);
  const message = messageOf(body, client.token);
  // Coolify v4.7.6 answers "Service restarting request queued."; a 2xx with
  // anything else queued nothing, and the deploy would wait out its window.
  if (!/queued/i.test(message)) throw new Error(`Coolify queued no restart for ${uuid}: ${message}`);
  return message;
}

/** @param {readonly string[]} argv */
async function main(argv) {
  const [command, uuid = ''] = argv;
  const apiUrl = process.env['COOLIFY_API_URL'] ?? '';
  const token = process.env['COOLIFY_API_TOKEN'] ?? '';
  if (argv.length !== 2 || (command !== 'deploy-application' && command !== 'restart-service')) {
    console.error('usage: node scripts/ci/coolify.mjs deploy-application|restart-service <uuid>');
    process.exit(2);
  }
  if (apiUrl === '' || token === '') {
    console.error('coolify: COOLIFY_API_URL and COOLIFY_API_TOKEN must be set');
    process.exit(2);
  }
  /** @type {Client} */
  const client = { apiUrl, token, fetch: /** @type {Fetch} */ (globalThis.fetch) };
  try {
    if (command === 'deploy-application') {
      const id = await deployApplication(client, uuid);
      process.stdout.write(`deployment-uuid=${id}\n`);
      const output = process.env['GITHUB_OUTPUT'];
      if (output !== undefined && output !== '') appendFileSync(output, `deployment-uuid=${id}\n`);
    } else {
      process.stdout.write(`${await restartService(client, uuid)}\n`);
    }
  } catch (error) {
    process.stdout.write(`::error title=Coolify::${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}
