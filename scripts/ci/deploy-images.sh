#!/usr/bin/env bash
# Story 20.6: the image half of a deploy (.github/actions/deploy), one
# subcommand per step, so each branch can be tested with stand-ins for docker,
# psql and Coolify (test/coolify-deploy.test.ts).
#
#   deploy-images.sh functions-image    prints the shift-functions reference by digest
#                                       to deploy: GIVEN as it is (production), or the
#                                       probed build of these sources (reused, or built,
#                                       probed and pushed now)
#   deploy-images.sh deploy-functions   moves :<environment> to REF, restarts the stack
#                                       with its images pulled again, waits for Postgres
#                                       to have restarted after the request, probes notify,
#                                       then records REF as verified (:<environment>-live);
#                                       the restart is skipped only when both
#                                       :<environment>-live and :<environment> name REF
#   deploy-images.sh deploy-web         moves :<environment> to REF, has Coolify deploy
#                                       the shift-web application, waits for the origin
#                                       to serve this build
#
# Environment: ENVIRONMENT, REPOSITORY, GIVEN, REF, STACK_UUID, WEB_UUID,
# APP_ORIGIN, DIST, DB_URL (no password: PGPASSWORD), SUPABASE_URL,
# COOLIFY_API_URL, COOLIFY_API_TOKEN, GITHUB_SHA. RESTART_TRIES and
# RESTART_INTERVAL bound the restart wait (60 x 10 s, and 600 s of wall clock
# whatever each psql takes), NOTIFY_TRIES and NOTIFY_INTERVAL the notify probe
# (30 x 10 s, and 300 s of wall clock); FUNCTIONS_PROBE replaces the
# offline probe in tests only. A failure after a channel tag was moved puts the
# tag back on the digest it named before, so a later restart or redeploy brings
# back the verified image (the one running may already be the new one: the
# warning says so, and DEPLOY.md §8.7 is the way back).
set -euo pipefail
# Inputs, from the environment (names above).
: "${REPOSITORY:=}" "${ENVIRONMENT:=}"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FUNCTIONS_PROBE="${FUNCTIONS_PROBE:-$here/probe-functions-image.sh}"
registry() { bash "$here/registry.sh" "$@"; }
coolify() { node "$here/coolify.mjs" "$@"; }

# The paths a shift-functions image is built from, and the probe that passed
# it: a change to any of them is a new image. test/coolify-deploy.test.ts holds
# this list to cover every COPY of deploy/functions/Dockerfile.
#
# AD-7 (story 16.2): and the tracked sources of `@shift/domain`, which the
# server projections (`calendar-feed` 16.4, `remind` 17.2) run as its built
# `dist`, with what builds it: its package.json and tsconfig*.json, the base
# tsconfig and the lockfile. Never `dist` itself (untracked, so `git ls-tree`
# cannot see it). Otherwise a change to the domain alone would reuse an image
# running the old rules beside a new SPA. `@shift/ics` joins in 16.4.
FUNCTIONS_SOURCES=(deploy/functions supabase/functions/admin-auth supabase/functions/notify .dockerignore scripts/ci/probe-functions-image.sh packages/domain/src packages/domain/package.json packages/domain/tsconfig.json packages/domain/tsconfig.test.json tsconfig.base.json pnpm-lock.yaml)

# Moves <repository>:<tag> to $1 and arms a trap that moves it back to what it
# named before if the script then fails. Armed BEFORE the move, so a move whose
# verification fails is put back too.
previous_ref=''
moved_tag=''
point_channel() {
  local ref="$1" tag="$2" repository="${1%@*}" before
  before="$(registry digest "$repository:$tag")"
  if [ "$before" != "${ref#*@}" ]; then
    moved_tag="$repository:$tag" previous_ref="${before:+$repository@$before}"
  fi
  registry point "$ref" "$tag"
}
restore_channel() {
  local status=$?
  if [ "$status" -ne 0 ] && [ -n "$moved_tag" ]; then
    if [ -n "$previous_ref" ]; then
      echo "::warning::putting $moved_tag back on ${previous_ref#*@}; the container Coolify runs may already be the new image: redeploy to return to it (DEPLOY.md §8.7)" >&2
      registry point "$previous_ref" "${moved_tag##*:}" >&2 \
        || echo "::error::could not put $moved_tag back on ${previous_ref#*@}: set it by hand (DEPLOY.md §8.7)" >&2
    else
      echo "::error::$moved_tag named nothing before this deploy and now names an image that failed: nothing to put back (DEPLOY.md §8.7)" >&2
    fi
  fi
  exit "$status"
}
# DEPLOY.md §6: notify is live behind Kong and the router, and refuses a
# caller without the invoke secret before it claims anything. Sends no token,
# so it can never trigger a send. Retried while the stack starts.
probe_notify() {
  local body status='' deadline=$((SECONDS + 300))
  for _ in $(seq 1 "${NOTIFY_TRIES:-30}"); do
    [ "$SECONDS" -lt "$deadline" ] || break
    body="$(curl -sS -m 15 -o - -w '\n%{http_code}' -X POST "$SUPABASE_URL/functions/v1/notify" 2> /dev/null || true)"
    status="${body##*$'\n'}"
    if [ "$status" = "401" ] && grep -q '"code":"INVOKE_SECRET_REFUSED"' <<< "${body%$'\n'*}"; then
      echo "notify answers 401 INVOKE_SECRET_REFUSED"
      return 0
    fi
    sleep "${NOTIFY_INTERVAL:-10}"
  done
  echo "::error title=notify probe::expected 401 INVOKE_SECRET_REFUSED, last got ${status:-no answer}" >&2
  return 1
}
trap restore_channel EXIT

case "${1:-}" in
  functions-image)
    # Production deploys the digest staging probed, deployed and smoke-tested,
    # never a build of its own (an empty hand-over is a failure, not a rebuild).
    if [ "$ENVIRONMENT" = production ] && [ -z "${GIVEN:-}" ]; then
      echo "::error title=shift-functions::production deploys staging's functions digest, and none was handed over" >&2
      exit 1
    fi
    if [ -n "${GIVEN:-}" ]; then
      if ! [[ "$GIVEN" == "$REPOSITORY@"* && "${GIVEN#*@}" =~ ^sha256:[0-9a-f]{64}$ ]]; then
        echo "::error title=shift-functions::$GIVEN is not $REPOSITORY by digest" >&2; exit 1
      fi
      found="$(registry digest "$GIVEN")"
      [ "$found" = "${GIVEN#*@}" ] \
        || { echo "::error title=shift-functions::$GIVEN is not in the registry" >&2; exit 1; }
      echo "deploying the given $GIVEN" >&2
      echo "$GIVEN"
      exit 0
    fi
    source_hash="$(git ls-tree -r HEAD -- "${FUNCTIONS_SOURCES[@]}" | sha256sum | cut -c1-16)"
    # A failed read here costs only a rebuild (GHCR may refuse to read a
    # package that does not exist yet, before the first push creates it).
    existing="$(registry digest "$REPOSITORY:src-$source_hash")" \
      || { echo "::warning::cannot read $REPOSITORY:src-$source_hash: building" >&2; existing=''; }
    if [ -n "$existing" ]; then
      echo "reusing the probed build of these sources: $REPOSITORY:src-$source_hash" >&2
      # This commit's tag too, so the run summary's reference has a commit tag.
      registry point "$REPOSITORY@$existing" "$GITHUB_SHA" >&2
      echo "$REPOSITORY@$existing"
      exit 0
    fi
    docker build --pull -f deploy/functions/Dockerfile -t "shift-functions:deploy-$GITHUB_SHA" . >&2
    bash "$FUNCTIONS_PROBE" "shift-functions:deploy-$GITHUB_SHA" >&2
    registry push "shift-functions:deploy-$GITHUB_SHA" "$REPOSITORY" "$GITHUB_SHA" "src-$source_hash"
    ;;
  deploy-functions)
    repository="${REF%@*}" digest="${REF#*@}"
    # An unreadable registry fails here: it is never taken for "unchanged".
    live="$(registry digest "$repository:$ENVIRONMENT-live")"
    # Skipped only when the channel tag names the verified digest too: one left
    # on another digest (a failed run that could not put it back) may be what
    # the stack last pulled.
    channel="$(registry digest "$repository:$ENVIRONMENT")"
    if [ "$live" = "$digest" ] && [ "$channel" = "$digest" ]; then
      echo "shift-functions is unchanged ($digest): no restart"
      probe_notify
      exit 0
    fi
    requested_at="$(psql "$DB_URL" -XAtc 'select now()')"
    [ -n "$requested_at" ] || { echo "::error title=shift-functions::no time from Postgres" >&2; exit 1; }
    point_channel "$REF" "$ENVIRONMENT"
    coolify restart-service "$STACK_UUID"
    restarted='' deadline=$((SECONDS + 600))
    for _ in $(seq 1 "${RESTART_TRIES:-60}"); do
      [ "$SECONDS" -lt "$deadline" ] || break
      sleep "${RESTART_INTERVAL:-10}"
      restarted="$(psql "$DB_URL" -XAtc "select pg_postmaster_start_time() > '$requested_at'::timestamptz" 2> /dev/null || true)"
      [ "$restarted" != "t" ] || break
    done
    if [ "$restarted" != "t" ]; then
      echo "::error title=shift-functions::the stack did not restart in time after the request" >&2
      exit 1
    fi
    echo "the stack restarted after the request"
    probe_notify
    # Verified: the digest a later run compares with (and skips on).
    registry point "$REF" "$ENVIRONMENT-live"
    ;;
  deploy-web)
    point_channel "$REF" "$ENVIRONMENT"
    coolify deploy-application "$WEB_UUID"
    node "$here/wait-for-web.mjs" "$APP_ORIGIN" "$DIST" "${WEB_TIMEOUT:-600}"
    ;;
  *)
    echo "usage: deploy-images.sh functions-image|deploy-functions|deploy-web" >&2
    exit 2
    ;;
esac
