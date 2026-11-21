#!/usr/bin/env bash
# Probes a built `shift-web` image (story 20.3) with no network at all.
#
#   bash scripts/ci/probe-web-image.sh <image> [<dist>]
#
# <dist> (default apps/web/dist) is the build the image was made from: the
# headers every response must carry are read from ITS `_headers` `/*` block,
# here on the runner, independently of the image's own rendering of it.
#
# The container runs with `--network none` and a read-only root (only /tmp is
# a tmpfs), so it can reach nothing and write nothing but its pid and temp
# files. Requests go through `docker exec` to the image's busybox `nc` on
# 127.0.0.1:8080, as raw HTTP/1.0 (busybox `wget` hides an error response's
# headers).
#
# CI only (job `web-image`). Never run it against a shared machine's Docker:
# it starts a container.
set -euo pipefail

image="${1:?usage: probe-web-image.sh <image> [<dist>]}"
dist="${2:-apps/web/dist}"
name="shift-web-probe-$$"

cleanup() { docker rm -f "$name" > /dev/null 2>&1 || true; }
trap cleanup EXIT

[ -f "$dist/_headers" ] || { echo "FAIL  $dist/_headers is missing"; exit 1; }

# The `/*` block's headers, `Name: value` per line, as the build wrote them.
mapfile -t expected < <(awk '
  /^[ \t]*$/ || /^[ \t]*#/ { next }
  !/^[ \t]/ { block = $0; sub(/[ \t]+$/, "", block); next }
  block == "/*" {
    line = $0; sub(/^[ \t]+/, "", line); sub(/[ \t\r]+$/, "", line)
    at = index(line, ":")
    name = substr(line, 1, at - 1); value = substr(line, at + 1)
    sub(/[ \t]+$/, "", name); sub(/^[ \t]+/, "", value)
    print name ": " value
  }
' "$dist/_headers")
if [ "${#expected[@]}" -lt 6 ]; then
  echo "FAIL  expected the five public/_headers headers and the build's CSP, found ${#expected[@]}"
  exit 1
fi
printf '%s\n' "${expected[@]}" | grep -q '^Content-Security-Policy-Report-Only: ' \
  || { echo "FAIL  $dist/_headers has no Content-Security-Policy-Report-Only line"; exit 1; }

asset="$(cd "$dist" && find assets -maxdepth 1 -name 'index-*.js' | head -n 1)"
[ -n "$asset" ] || { echo "FAIL  no assets/index-*.js in $dist"; exit 1; }
stylesheet="$(cd "$dist" && find assets -maxdepth 1 -name 'index-*.css' | head -n 1)"
[ -n "$stylesheet" ] || { echo "FAIL  no assets/index-*.css in $dist"; exit 1; }

docker run -d --name "$name" --network none --read-only --tmpfs /tmp "$image" > /dev/null

# One raw request, with a deadline: status line, headers, body.
#   request <method> <path> [<extra header lines, \r\n-terminated>] [<HTTP version>]
# HTTP/1.0 by default (the server closes after one answer); a 1.1 request
# says `Connection: close` (gzip answers 1.1 only).
request() {
  docker exec "$name" timeout 10 sh -c \
    'printf "%s %s HTTP/%s\r\nHost: probe\r\nConnection: close\r\n%b\r\n" "$1" "$2" "$4" "$3" | nc 127.0.0.1 8080' \
    probe "$1" "$2" "${3:-}" "${4:-1.0}"
}

ready=0
for _ in $(seq 1 30); do
  if request GET / 2> /dev/null | head -n 1 | grep -q '^HTTP/'; then ready=1; break; fi
  sleep 1
done
if [ "$ready" != 1 ]; then
  echo "FAIL  nginx never answered on 8080"
  docker logs "$name" 2>&1 | tail -n 40
  exit 1
fi

failed=0
fail() { echo "FAIL  $*"; failed=1; }

# expect <path> <status> <content-type prefix|-> <cache-control|-|none> [<body marker>]
# METHOD (default GET), EXTRA (header lines) and PROTO (default 1.0) shape the
# request; the last answer's headers are left in $last_head.
last_head=''
expect() {
  local path="$1" status="$2" type="$3" cache="$4" marker="${5:-}" method="${METHOD:-GET}"
  local got head line
  got="$( (request "$method" "$path" "${EXTRA:-}" "${PROTO:-1.0}" || true) | tr -d '\000')"
  head="${got%%$'\r\n\r\n'*}"
  head="${head//$'\r'/}"
  line="${head%%$'\n'*}"
  local ok=1
  [[ "$line" == "HTTP/1.1 $status "* ]] || { fail "$path -> '$line', expected $status"; ok=0; }
  # Every header of the /* block, exactly once, with its exact value.
  local header named exact
  for header in "${expected[@]}"; do
    exact="$(grep -cFx -- "$header" <<< "$head" || true)"
    named="$(grep -ci -- "^${header%%:*}:" <<< "$head" || true)"
    [ "$exact" = 1 ] && [ "$named" = 1 ] || { fail "$path: '${header%%:*}' is not the build's, exactly once"; ok=0; }
  done
  if [ "$type" != - ] && ! grep -qi "^Content-Type: $type" <<< "$head"; then
    fail "$path: Content-Type is not $type"; ok=0
  fi
  case "$cache" in
    -) ;;
    none) if grep -qi '^Cache-Control:' <<< "$head"; then fail "$path: has a Cache-Control"; ok=0; fi ;;
    *) if [ "$(grep -ciFx -- "Cache-Control: $cache" <<< "$head" || true)" != 1 ] \
         || [ "$(grep -ci '^Cache-Control:' <<< "$head" || true)" != 1 ]; then
         fail "$path: Cache-Control is not exactly '$cache'"; ok=0
       fi ;;
  esac
  if grep -qi '^Server: .*[0-9]' <<< "$head"; then fail "$path: the Server header names a version"; ok=0; fi
  if [ -n "$marker" ] && [[ "$got" != *"$marker"* ]]; then fail "$path: the body is not the expected one"; ok=0; fi
  last_head="$head"
  [ "$ok" = 1 ] && echo "ok    $method $path -> $status${type:+ $type} ${cache}"
  return 0
}

shell_marker='<div id="root">'
expect / 200 text/html no-cache "$shell_marker"
expect /kalendar/2026-09 200 text/html no-cache "$shell_marker"
expect /index.html 200 text/html no-cache "$shell_marker"
expect /sw.js 200 application/javascript no-cache
expect /push-sw.js 200 application/javascript no-cache
expect "/$asset" 200 application/javascript 'public, max-age=31536000, immutable'
expect "/$stylesheet" 200 text/css 'public, max-age=31536000, immutable'
expect /site.webmanifest 200 application/manifest+json no-cache
expect /favicon.svg 200 image/svg+xml no-cache
expect /pwa-192x192.png 200 image/png no-cache
# A missing asset is a plain 404, never index.html, and never immutable.
expect /assets/nope.js 404 text/plain no-cache
expect /assets/ 404 text/plain no-cache
expect /assets/x.js.map 404 text/plain no-cache
expect "/$asset.map" 404 text/plain no-cache
# Cloudflare's files are not in the image: the path is a client route.
expect /_headers 200 text/html no-cache "$shell_marker"
expect /_redirects 200 text/html no-cache "$shell_marker"
# An error nginx makes itself still carries every header; HEAD answers them too.
METHOD=POST EXTRA='Content-Length: 0\r\n' expect / 405 - no-cache
METHOD=HEAD expect / 200 text/html no-cache
# gzip (HTTP/1.1 only): the entry chunk compressed, and caches told it varies.
PROTO=1.1 EXTRA='Accept-Encoding: gzip\r\n' expect "/$asset" 200 application/javascript \
  'public, max-age=31536000, immutable'
grep -qix 'Content-Encoding: gzip' <<< "$last_head" || fail "/$asset: not gzipped for Accept-Encoding: gzip"
grep -qix 'Vary: Accept-Encoding' <<< "$last_head" || fail "/$asset: no Vary: Accept-Encoding"

# A missing asset's body must not be the shell.
if [[ "$(request GET /assets/nope.js || true)" == *"$shell_marker"* ]]; then fail '/assets/nope.js answered the shell'; fi

# The process runs as uid 101.
uid="$(docker exec "$name" awk '/^Uid:/ { print $2 }' /proc/1/status)"
[ "$uid" = 101 ] && echo "ok    nginx runs as uid 101" || fail "nginx runs as uid '$uid'"

# No source map in the image.
maps="$(docker exec "$name" find /usr/share/nginx/html -name '*.map' 2>&1 || echo 'find failed')"
[ -z "$maps" ] && echo "ok    no source map in the image" || fail "source maps in the image: $maps"

# Nothing outside /tmp is owned by, or writable by, uid 101 (the read-only
# root hides that from a write test, so it is read off the modes). Read as
# root, so a directory uid 101 cannot list is still checked.
writable="$(docker exec --user 0 "$name" find / -xdev -path /tmp -prune -o \
  \( -user 101 -o -group 101 -perm -0020 -o -perm -0002 \) ! -type l -print 2>&1 || echo 'find failed')"
[ -z "$writable" ] && echo "ok    no file outside /tmp is writable by uid 101" || fail "writable by uid 101: $writable"

echo '--- container log'
docker logs "$name" 2>&1 | tail -n 20
exit "$failed"
