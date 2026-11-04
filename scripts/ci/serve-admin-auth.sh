#!/usr/bin/env bash
# Serves the admin-auth Edge Function on a CI runner, and serves it again if
# the edge runtime's container dies: `bash scripts/ci/serve-admin-auth.sh`, in
# the background, logging to stdout.
#
# The runtime once exited 135 right after its first request (run 41706588708),
# and nothing served the function for the rest of the shard: the E2E setup's
# OPTIONS got the gateway's 503. A restart is up in a few seconds, inside the
# setup's 30 s patience (`requireAdminAuth`). Stopped by `pkill -f serve-admin-auth.sh`.
set -uo pipefail

for _ in $(seq 1 5); do
  pnpm exec supabase functions serve admin-auth
  echo "::warning title=functions serve exited::exit $?; serving admin-auth again in 2 s"
  sleep 2
done
echo "::error title=functions serve::admin-auth exited five times; not serving it again"
