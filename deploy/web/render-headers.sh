#!/bin/sh
# Renders the `/*` block of a built `dist/_headers` (story 20.3) as nginx
# header lines, one per header, value unchanged:
#
#   sh deploy/web/render-headers.sh apps/web/dist/_headers > security-headers.conf
#
#   X-Frame-Options: DENY   ->   add_header X-Frame-Options "DENY" always;
#
# `always`: every response carries them, errors included. The image's nginx
# config includes the output in every location, and nothing else in the image
# sets a security header (deploy/web/default.conf).
#
# POSIX sh and awk only: it runs in the image's busybox at build time
# (deploy/web/Dockerfile) and under the host's sh in `test/web-image.test.ts`.
# It REFUSES, exiting non-zero with nothing on stdout, rather than render a
# file whose meaning nginx would not keep:
#   - a block other than `/*` (Cloudflare applies every matching block; this
#     image serves one set of headers on every path), a second `/*` block, or
#     a header before any;
#   - a `!` detach;
#   - a header line with no `:`, an empty or non-token name, or an empty value;
#   - a name given twice (case-insensitively);
#   - a header nginx sets itself (Cache-Control, Content-Type,
#     Content-Length, Server, Date, ETag, Last-Modified, Vary,
#     Content-Encoding): `add_header` would send it a second time;
#   - a value holding `"`, `$`, `\`, a control character (each would end or
#     rewrite nginx's quoted string) or a non-ASCII byte;
#   - a file with no header at all.
set -eu

file="${1:?usage: render-headers.sh <dist/_headers>}"
[ -r "$file" ] || { echo "render-headers: cannot read $file" >&2; exit 1; }

LC_ALL=C awk '
  function refuse(why) {
    printf "render-headers: line %d: %s\n", NR, why > "/dev/stderr"
    failed = 1
    exit 1
  }
  function trim(text) {
    sub(/^[ \t]+/, "", text)
    sub(/[ \t]+$/, "", text)
    return text
  }
  {
    line = $0
    # A CRLF file: the carriage return is a control character in the value.
    if (line ~ /^[ \t]*$/) next
    if (line ~ /^[ \t]*#/) next
    if (line !~ /^[ \t]/) {
      block = trim(line)
      if (block != "/*") refuse("a block other than /* (" block ")")
      if (++blocks > 1) refuse("a second /* block")
      next
    }
    if (block != "/*") refuse("a header outside a /* block")
    entry = trim(line)
    if (substr(entry, 1, 1) == "!") refuse("a ! detach")
    at = index(entry, ":")
    if (at == 0) refuse("a header line with no colon")
    name = trim(substr(entry, 1, at - 1))
    value = trim(substr(entry, at + 1))
    if (name !~ /^[A-Za-z0-9-]+$/) refuse("a header name that is not a token")
    if (value == "") refuse("an empty value for " name)
    if (value ~ /["$\\]/) refuse("a value with a quote, dollar or backslash for " name)
    if (value ~ /[\001-\037\177]/) refuse("a value with a control character for " name)
    # Printable ASCII only (space to tilde): no byte above 127.
    if (value !~ /^[ -~]+$/) refuse("a value with a non-ASCII character for " name)
    key = tolower(name)
    if (key ~ /^(cache-control|content-type|content-length|server|date|etag|last-modified|vary|content-encoding)$/) {
      refuse("a header nginx sets itself: " name)
    }
    if (key in seen) refuse("a header named twice: " name)
    seen[key] = 1
    out[++count] = "add_header " name " \"" value "\" always;"
  }
  END {
    if (failed) exit 1
    if (count == 0) {
      print "render-headers: no header in a /* block" > "/dev/stderr"
      exit 1
    }
    for (i = 1; i <= count; i++) print out[i]
  }
' "$file"
