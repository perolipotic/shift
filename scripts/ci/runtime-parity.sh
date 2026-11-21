#!/usr/bin/env bash
# AD-19's runtime parity, the Deno half (story 16.2; AD-7).
#
#   bash scripts/ci/runtime-parity.sh <edge-runtime image> <node probe json>
#
# Bundles `deploy/parity/index.ts` with the pinned `edge-runtime` (which
# follows `deploy/parity/deno.json`'s map of `@shift/domain` onto the built
# `packages/domain/dist`, as a function's does), serves the eszip as the main
# service in a container with `--network none` and a read-only checkout, asks
# it once over the container's own loopback, and compares the body byte for
# byte with the JSON `test/runtime-parity.test.ts` wrote under Node from the
# same dist. Any difference fails the job and prints both digests.
#
# Run from the repository root, after `pnpm --filter @shift/domain build`.
# CI only (job `runtime-parity`): it starts a container. Never run it
# against a shared machine's Docker.
set -euo pipefail

image="${1:?usage: runtime-parity.sh <edge-runtime image> <node probe json>}"
expected="${2:?usage: runtime-parity.sh <edge-runtime image> <node probe json>}"
[ -s "$expected" ] || { echo "FAIL  the Node probe wrote nothing to $expected"; exit 1; }
[ -f packages/domain/dist/index.js ] || { echo "FAIL  packages/domain/dist is not built"; exit 1; }

suffix="$$"
name="shift-runtime-parity-$suffix"
out="$(mktemp -d)"
response="$(mktemp)"
cleanup() {
  rm -f "$response"
  docker rm -f "$name" > /dev/null 2>&1 || true
  # The bundle is written by the image's root user; the runner may not remove it.
  rm -rf "$out" 2> /dev/null || true
}
trap cleanup EXIT

# The bundle: no network either, so nothing can be fetched to make it work.
chmod 0777 "$out"
docker run --rm --network none \
  -v "$PWD:/repo:ro" -v "$out:/out" \
  "$image" bundle --entrypoint /repo/deploy/parity/index.ts --output /out/parity.eszip

docker run -d --name "$name" --network none -v "$PWD:/repo:ro" -v "$out:/out:ro" \
  "$image" start --main-service /out/parity.eszip --main-entrypoint /repo/deploy/parity/index.ts --port 9000 > /dev/null

ready=0
for _ in $(seq 1 60); do
  if [ "$(docker inspect -f '{{.State.Running}}' "$name" 2> /dev/null)" != true ]; then break; fi
  if docker exec "$name" bash -c 'exec 3<>/dev/tcp/127.0.0.1/9000' 2> /dev/null; then ready=1; break; fi
  sleep 1
done
if [ "$ready" != 1 ]; then
  echo "FAIL  the probe never listened on 9000"
  docker logs "$name" 2>&1 | tail -n 40
  exit 1
fi

# HTTP/1.0, so the answer is one plain body after the headers, never chunked.
docker exec "$name" timeout 60 bash -c '
  exec 3<>/dev/tcp/127.0.0.1/9000
  printf "GET / HTTP/1.0\r\nHost: probe\r\n\r\n" >&3
  cat <&3
' > "$response"

node --input-type=module - "$response" "$expected" <<'EOF'
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const [raw, expected] = process.argv.slice(2).map((path) => readFileSync(path));
const end = raw.indexOf('\r\n\r\n');
const status = raw.subarray(0, raw.indexOf('\r\n')).toString('latin1');
const body = end < 0 ? Buffer.alloc(0) : raw.subarray(end + 4);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

console.log(`edge-runtime: ${status}, ${body.length} bytes, sha256 ${digest(body)}`);
console.log(`node:         ${expected.length} bytes, sha256 ${digest(expected)}`);
if (!status.includes(' 200 ') || !body.equals(expected)) {
  console.log('FAIL  the probe under edge-runtime differs from the probe under Node');
  // Where they part, with a little context either side: enough to name the
  // differing value without uploading either answer.
  let at = 0;
  while (at < body.length && at < expected.length && body[at] === expected[at]) at += 1;
  const around = (bytes) => bytes.subarray(Math.max(0, at - 120), at + 120).toString('utf8');
  console.log(`first difference at byte ${at}`);
  console.log(`edge-runtime: …${around(body)}…`);
  console.log(`node:         …${around(expected)}…`);
  process.exit(1);
}
console.log('ok    byte-identical');
EOF
