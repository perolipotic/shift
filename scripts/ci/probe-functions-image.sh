#!/usr/bin/env bash
# Probes a built `shift-functions` image (story 20.2) with no way out to the
# internet.
#
#   bash scripts/ci/probe-functions-image.sh <image>
#
# The image runs on an `--internal` Docker network, beside a stand-in GoTrue
# (busybox's httpd serving one file, `/user`, so `GET /user` answers 200). A
# function that tried to fetch a module at cold start would fail here: both
# workers must start from the bundles the image built. Every value below is a
# throwaway made up on the spot, shaped as each handler's configuration check
# demands; none is a key of any environment.
#
# CI only (job `functions-image`). Never run it against a shared machine's
# Docker: it starts containers.
set -euo pipefail

image="${1:?usage: probe-functions-image.sh <image>}"
suffix="$$"
network="shift-functions-probe-$suffix"
name="shift-functions-probe-$suffix"
gotrue="shift-gotrue-stub-$suffix"
# busybox, pinned, for the stand-in GoTrue.
BUSYBOX_IMAGE='busybox:1.36.1'

repeat() { printf "%${2}s" '' | tr ' ' "$1"; }
secret_key="sb_secret_$(repeat x 40)"
publishable_key="sb_publishable_$(repeat y 40)"
invoke_secret="$(repeat i 64)"

cleanup() {
  docker rm -f "$name" "$gotrue" > /dev/null 2>&1 || true
  docker network rm "$network" > /dev/null 2>&1 || true
}
trap cleanup EXIT

docker network create --internal "$network" > /dev/null
docker run -d --name "$gotrue" --network "$network" --network-alias gotrue-stub "$BUSYBOX_IMAGE" \
  sh -c 'mkdir -p /www && echo "{\"id\":\"probe\"}" > /www/user && exec httpd -f -p 9999 -h /www' > /dev/null

docker run -d --name "$name" --network "$network" \
  -e SHIFT_AUTH_URL=http://gotrue-stub:9999 \
  -e SUPABASE_URL=http://supabase-kong:8000 \
  -e SHIFT_SECRET_KEY="$secret_key" \
  -e SHIFT_PUBLISHABLE_KEY="$publishable_key" \
  -e SHIFT_ALLOWED_ORIGINS=https://app.example.test \
  -e SHIFT_APP_URL=https://app.example.test \
  -e NOTIFY_INVOKE_SECRET="$invoke_secret" \
  -e 'NOTIFY_EMAIL_FROM=Shift <probe@example.test>' \
  -e RESEND_API_KEY=re_probe \
  -e VAPID_PUBLIC_KEY= -e VAPID_PRIVATE_KEY= \
  -e VAPID_SUBJECT=mailto:probe@example.test \
  "$image" > /dev/null

# One HTTP/1.1 request over the image's own bash (it ships no HTTP client),
# with a deadline, printed raw: status line, headers, body.
request() {
  docker exec "$name" timeout 30 bash -c '
    exec 3<>/dev/tcp/127.0.0.1/9000
    printf "%s %s HTTP/1.1\r\nHost: probe\r\nConnection: close\r\nContent-Length: %s\r\n%b\r\n%s" \
      "$1" "$2" "${#4}" "$3" "$4" >&3
    cat <&3
  ' probe "$@"
}

ready=0
for _ in $(seq 1 60); do
  if docker exec "$name" bash -c 'exec 3<>/dev/tcp/127.0.0.1/9000' 2> /dev/null; then ready=1; break; fi
  sleep 1
done
if [ "$ready" != 1 ]; then
  echo "FAIL  the main service never listened on 9000"
  docker logs "$name" 2>&1 | tail -n 40
  exit 1
fi

failed=0
# expect <status> <code> <method> <path> [headers] [body]
expect() {
  local status="$1" code="$2"; shift 2
  local got
  got="$(request "$1" "$2" "${3:-}" "${4:-}" || true)"
  local line="${got%%$'\r'*}"
  if [[ "$line" == "HTTP/1.1 $status "* && "$got" == *"\"code\":\"$code\""* ]]; then
    echo "ok    $1 $2 -> $status $code"
  else
    echo "FAIL  $1 $2 -> '${line}', expected $status $code"
    failed=1
  fi
}

expect 404 FUNCTION_NOT_FOUND GET /nope
expect 404 FUNCTION_NOT_FOUND GET /_internal/health
expect 404 FUNCTION_NOT_FOUND POST /admin%2Dauth
# notify's worker starts from its bundle and its own check answers.
expect 401 INVOKE_SECRET_REFUSED POST /notify
expect 401 INVOKE_SECRET_REFUSED POST /notify 'Authorization: Bearer not-the-secret\r\n'
# admin-auth: refused by the router before its worker, with no bearer token.
expect 401 AUTHORIZATION_MISSING POST /admin-auth
expect 401 AUTHORIZATION_MISSING POST /admin-auth 'Authorization: Basic eA==\r\n'
# admin-auth: GoTrue (the stand-in) accepts the token, the worker starts from
# its bundle with its own variables, and the handler itself answers.
expect 400 PAYLOAD_INVALID POST /admin-auth \
  'Authorization: Bearer a.b.c\r\nOrigin: https://app.example.test\r\nContent-Type: application/json\r\n' \
  '{"operation":"resetPassword"}'

# GoTrue gone: a token must be refused 503, never passed.
docker rm -f "$gotrue" > /dev/null
expect 503 AUTHORIZATION_UNVERIFIED POST /admin-auth 'Authorization: Bearer a.b.c\r\n'

echo '--- container log'
docker logs "$name" 2>&1 | tail -n 20
exit "$failed"
