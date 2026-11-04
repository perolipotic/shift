#!/usr/bin/env bash
# Starts the local Supabase stack on a CI runner: `bash scripts/ci/start-supabase.sh "<services to exclude>"`.
#
# Two runner flakes it absorbs (epic 15 retro, A7):
# - The stack's host ports (54321-54329) lie inside Linux's ephemeral range
#   (32768-60999), so an outgoing connection made while the images are pulled
#   can hold 54322 and Docker fails with "address already in use" (runs
#   41524878160, 41800338715). The ephemeral range is moved below the stack's
#   ports first, so a new connection never takes one.
# - A start that still fails (a port taken before the range moved, or the image
#   registry's "toomanyrequests" outlasting the CLI's own retries) is stopped
#   and tried once more, after a pause.
set -euo pipefail

exclude="${1:?the services to exclude}"

sudo sysctl -q -w net.ipv4.ip_local_port_range="32768 54000"

for attempt in 1 2; do
  if pnpm exec supabase start -x "$exclude"; then
    exit 0
  fi
  if [ "$attempt" -eq 2 ]; then
    echo "::error title=supabase start failed::twice; see the log above"
    exit 1
  fi
  echo "::warning title=supabase start failed::retrying once in 15 s"
  pnpm exec supabase stop --no-backup || true
  sleep 15
done
