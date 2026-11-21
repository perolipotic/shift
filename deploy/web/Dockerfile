# shift-web (story 20.3; AD-14 as amended): the SPA, served by a static
# server that runs as uid 101 and never as root.
#
# Build from the repository root, after `pnpm build` has written
# `apps/web/dist` (CI's `web-image` job downloads the `build` job's; nothing
# pushes it before story 20.6, which builds it per environment from that
# environment's own build):
#
#   docker build -f deploy/web/Dockerfile -t shift-web:<sha> .
#
# The base is nginx-unprivileged's stable line on Alpine (F5's image: uid 101,
# listens on 8080, pid and temp paths in /tmp), pinned by tag AND digest
# (the index digest, 2026-10-19), the same in both stages.
# Its header lines are rendered HERE from the built `dist/_headers`' `/*`
# block (`render-headers.sh`, which refuses anything nginx would not keep), so
# the image serves exactly the headers the build wrote, the
# Content-Security-Policy-Report-Only line the build derived from
# VITE_SUPABASE_URL included. The image holds the built files only: no source
# map (`.dockerignore` keeps them out of the context, and the build fails if
# one is left), no `_headers`/`_redirects` (Cloudflare's files), no key, no
# address.

# ---- render: dist/_headers -> nginx header lines (the base's busybox sh/awk)
FROM nginxinc/nginx-unprivileged:1.30.6-alpine3.24@sha256:f5116ed4606f3eb015dd4a8e28cb9b351476dc0ad4bc6e9f93b19cec130cdf03 AS render

COPY deploy/web/render-headers.sh apps/web/dist/_headers /tmp/render/
# A dist built before the CSP plugin, or stale, has no policy line: refused,
# so no image ships without a Content-Security-Policy.
RUN grep -Eq '^[[:space:]]+Content-Security-Policy(-Report-Only)?:' /tmp/render/_headers \
 || { echo 'shift-web: dist/_headers has no Content-Security-Policy line' >&2; exit 1; }
RUN sh /tmp/render/render-headers.sh /tmp/render/_headers > /tmp/security-headers.conf

# ---- the image
FROM nginxinc/nginx-unprivileged:1.30.6-alpine3.24@sha256:f5116ed4606f3eb015dd4a8e28cb9b351476dc0ad4bc6e9f93b19cec130cdf03

USER root

# The base's sample server and pages go; its nginx.conf stays.
RUN rm -rf /etc/nginx/conf.d/* /usr/share/nginx/html/*

COPY --chown=root:root deploy/web/default.conf /etc/nginx/conf.d/default.conf
COPY --from=render --chown=root:root /tmp/security-headers.conf /etc/nginx/shift/security-headers.conf
COPY --chown=root:root apps/web/dist/ /usr/share/nginx/html/

# Root-owned and not writable by uid 101: the base leaves /etc/nginx and
# /var/cache/nginx to uid 101 (group-writable), which a compromised worker
# could use to rewrite its own config, and /var/tmp world-writable, which
# nothing here uses. Writes go to /tmp alone.
RUN rm -f /usr/share/nginx/html/_headers /usr/share/nginx/html/_redirects \
 && if [ -n "$(find /usr/share/nginx/html -name '*.map')" ]; then \
      echo 'shift-web: a source map is in the image' >&2; exit 1; \
    fi \
 && test -f /usr/share/nginx/html/index.html \
 && chown -R root:root /etc/nginx /var/cache/nginx /usr/share/nginx/html \
 && chmod -R go-w /etc/nginx /var/cache/nginx /usr/share/nginx/html \
 && chmod -R a+rX /usr/share/nginx/html /etc/nginx/shift \
 && chmod 0755 /var/tmp

# The config is checked at build. As root, because a build step's stderr is
# root's, and nginx opens its error log (a link to /dev/stderr) to check; the
# temp directories `-t` makes in /tmp go with it, so uid 101 makes its own at
# start. The CI probe starts the image as uid 101.
RUN nginx -t && rm -rf /tmp/*

USER 101

EXPOSE 8080

# The base's busybox wget, on the container's own loopback: no curl needed.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
