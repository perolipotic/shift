# shift-functions (story 20.2; AD-14 and AD-17 as amended): the stack's
# `supabase-edge-functions` image.
#
# Build from the repository root (CI's `functions-image` job does; nothing
# pushes it before story 20.6):
#
#   docker build -f deploy/functions/Dockerfile -t shift-functions:<sha> .
#
# The base is the edge-runtime Supabase CLI 2.116.0 runs locally, the same pin
# as the compose had (`test/functions-router.test.ts` holds it to the CLI's).
# The router is the main service; each function in its table is copied in and
# bundled into an eszip HERE, with its npm dependencies inside, so a cold start
# reads a local file and fetches nothing from the network.
#
# The image holds code only: no key, no secret, no address. Every value comes
# from the container's environment in Coolify (AD-17 as amended).

FROM supabase/edge-runtime:v1.74.3

COPY deploy/functions/main/router.ts deploy/functions/main/workers.ts deploy/functions/main/index.ts /home/deno/functions/main/
COPY supabase/functions/admin-auth/ /home/deno/functions/admin-auth/
COPY supabase/functions/notify/ /home/deno/functions/notify/

RUN edge-runtime bundle --entrypoint /home/deno/functions/admin-auth/index.ts \
      --output /home/deno/functions/admin-auth/bundle.eszip \
 && edge-runtime bundle --entrypoint /home/deno/functions/notify/index.ts \
      --output /home/deno/functions/notify/bundle.eszip

EXPOSE 9000

CMD ["start", "--main-service", "/home/deno/functions/main"]
