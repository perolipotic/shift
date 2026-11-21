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
#                                       to have restarted after the request; skipped when
#                                       REF is the digest last verified (:<environment>-live)
#   deploy-images.sh deploy-web         moves :<environment> to REF, has Coolify deploy
#                                       the shift-web application, waits for the origin
#                                       to serve this build
#
# Environment: ENVIRONMENT, REPOSITORY, GIVEN, REF, STACK_UUID, WEB_UUID,
# APP_ORIGIN, DIST, DB_URL (no password: PGPASSWORD), COOLIFY_API_URL,
# COOLIFY_API_TOKEN, GITHUB_SHA. RESTART_TRIES and RESTART_INTERVAL bound the
# wait (60 x 10 s). A failure after a channel tag was moved puts the tag back on
# the digest it named before, so an unrelated restart never brings up an
# unverified image.
set -euo pipefail
# Inputs, from the environment (names above).
: "${REPOSITORY:=}" "${ENVIRONMENT:=}"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
registry() { bash "$here/registry.sh" "$@"; }
coolify() { node "$here/coolify.mjs" "$@"; }

# The paths a shift-functions image is built from, and the probe that passed
# it: a change to any of them is a new image. test/coolify-deploy.test.ts holds
# this list to cover every COPY of deploy/functions/Dockerfile.
FUNCTIONS_SOURCES=(deploy/functions supabase/functions/admin-auth supabase/functions/notify .dockerignore scripts/ci/probe-functions-image.sh)

# Moves <repository>:<tag> to $1 and arms a trap that moves it back to what it
# named before if the script then fails.
previous_ref=''
moved_tag=''
point_channel() {
  local ref="$1" tag="$2" repository="${1%@*}" before
  before="$(registry digest "$repository:$tag")"
  registry point "$ref" "$tag"
  if [ -n "$before" ] && [ "$before" != "${ref#*@}" ]; then
    previous_ref="$repository@$before" moved_tag="$tag"
  fi
}
restore_channel() {
  local status=$?
  if [ "$status" -ne 0 ] && [ -n "$moved_tag" ]; then
    echo "::warning::putting ${previous_ref%@*}:$moved_tag back on ${previous_ref#*@}" >&2
    registry point "$previous_ref" "$moved_tag" >&2 || true
  fi
  exit "$status"
}
trap restore_channel EXIT

case "${1:-}" in
  functions-image)
    if [ -n "${GIVEN:-}" ]; then
      [[ "$GIVEN" == "$REPOSITORY@"* ]] && [[ "${GIVEN#*@}" =~ ^sha256:[0-9a-f]{64}$ ]] \
        || { echo "::error title=shift-functions::$GIVEN is not $REPOSITORY by digest" >&2; exit 1; }
      found="$(registry digest "$GIVEN")"
      [ "$found" = "${GIVEN#*@}" ] \
        || { echo "::error title=shift-functions::$GIVEN is not in the registry" >&2; exit 1; }
      echo "deploying the given $GIVEN" >&2
      echo "$GIVEN"
      exit 0
    fi
    source_hash="$(git ls-tree -r HEAD -- "${FUNCTIONS_SOURCES[@]}" | sha256sum | cut -c1-16)"
    existing="$(registry digest "$REPOSITORY:src-$source_hash")"
    if [ -n "$existing" ]; then
      echo "reusing the probed build of these sources: $REPOSITORY:src-$source_hash" >&2
      # This commit's tag too, so the run summary's reference has a commit tag.
      registry point "$REPOSITORY@$existing" "$GITHUB_SHA" >&2
      echo "$REPOSITORY@$existing"
      exit 0
    fi
    docker build --pull -f deploy/functions/Dockerfile -t "shift-functions:deploy-$GITHUB_SHA" . >&2
    bash "$here/probe-functions-image.sh" "shift-functions:deploy-$GITHUB_SHA" >&2
    registry push "shift-functions:deploy-$GITHUB_SHA" "$REPOSITORY" "$GITHUB_SHA" "src-$source_hash"
    ;;
  deploy-functions)
    repository="${REF%@*}" digest="${REF#*@}"
    # An unreadable registry fails here: it is never taken for "unchanged".
    live="$(registry digest "$repository:$ENVIRONMENT-live")"
    if [ "$live" = "$digest" ]; then
      echo "shift-functions is unchanged ($digest): no restart"
      exit 0
    fi
    requested_at="$(psql "$DB_URL" -XAtc 'select now()')"
    [ -n "$requested_at" ] || { echo "::error title=shift-functions::no time from Postgres" >&2; exit 1; }
    point_channel "$REF" "$ENVIRONMENT"
    coolify restart-service "$STACK_UUID"
    for _ in $(seq 1 "${RESTART_TRIES:-60}"); do
      sleep "${RESTART_INTERVAL:-10}"
      restarted="$(psql "$DB_URL" -XAtc "select pg_postmaster_start_time() > '$requested_at'::timestamptz" 2> /dev/null || true)"
      if [ "$restarted" = "t" ]; then
        echo "the stack restarted after the request"
        exit 0
      fi
    done
    echo "::error title=shift-functions::the stack did not restart in time after the request" >&2
    exit 1
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
