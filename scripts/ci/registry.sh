#!/usr/bin/env bash
# Story 20.6: the image registry steps of a deploy, by digest.
#
#   registry.sh push   <local image> <repository> <tag>...   pushes the LOCAL image (the one
#                                                            just probed) under each tag;
#                                                            prints <repository>@sha256:…
#   registry.sh digest <repository>:<tag>                    prints the tag's digest, or
#                                                            nothing when the tag does not exist
#   registry.sh point  <repository>@sha256:… <tag>           moves <repository>:<tag> to that
#                                                            digest, server side, and verifies it
#
# The caller has logged in to the registry (`docker login --password-stdin`
# with the job's GITHUB_TOKEN). Nothing here reads a credential, and nothing
# rebuilds: `push` sends the image that was probed, and `point` copies a
# manifest the registry already holds, so the channel tag Coolify pulls names
# exactly the probed digest. CI only (the deploy jobs): it pushes.
set -euo pipefail

usage() {
  echo "usage: registry.sh push <local image> <repository> <tag>... | digest <ref> | point <repository>@<digest> <tag>" >&2
  exit 2
}

DIGEST_RE='^sha256:[0-9a-f]{64}$'
# A repository without a tag or digest: lowercase path segments.
REPOSITORY_RE='^[a-z0-9.-]+(/[a-z0-9._-]+)+$'
TAG_RE='^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$'

# The digest of a reference in the registry, or empty if the registry says it
# does not exist. Any other failure (an expired login, a rate limit, the
# network) fails the caller: "absent" would trigger a rebuild, an overwrite or
# a needless stack restart.
digest_of() {
  local ref="$1" out err
  err="$(mktemp)"
  if ! out="$(docker buildx imagetools inspect --format '{{json .Manifest}}' "$ref" 2> "$err")"; then
    if grep -qiE 'not found|manifest unknown|name unknown' "$err"; then
      rm -f "$err"
      return 0
    fi
    echo "registry: cannot read $ref: $(head -c 300 "$err")" >&2
    rm -f "$err"
    return 1
  fi
  rm -f "$err"
  jq -r '.digest // empty' <<< "$out"
}

command="${1:-}"
shift || true
case "$command" in
  push)
    [ "$#" -ge 3 ] || usage
    image="$1" repository="$2"
    shift 2
    [[ "$repository" =~ $REPOSITORY_RE ]] || { echo "registry: not a repository: $repository" >&2; exit 2; }
    digest=''
    for tag in "$@"; do
      [[ "$tag" =~ $TAG_RE ]] || { echo "registry: not a tag: $tag" >&2; exit 2; }
      docker tag "$image" "$repository:$tag"
      log="$(docker push "$repository:$tag")"
      printf '%s\n' "$log" >&2
      pushed="$(grep -oE 'digest: sha256:[0-9a-f]{64}' <<< "$log" | tail -n 1 | cut -d' ' -f2 || true)"
      [[ "$pushed" =~ $DIGEST_RE ]] || { echo "registry: no digest in the push of $repository:$tag" >&2; exit 1; }
      # Every tag of one local image must be one digest.
      if [ -n "$digest" ] && [ "$digest" != "$pushed" ]; then
        echo "registry: $repository:$tag was pushed as $pushed, not $digest" >&2
        exit 1
      fi
      digest="$pushed"
    done
    # The registry must agree with what the push reported.
    for tag in "$@"; do
      [ "$(digest_of "$repository:$tag")" = "$digest" ] \
        || { echo "registry: $repository:$tag does not resolve to $digest" >&2; exit 1; }
    done
    echo "$repository@$digest"
    ;;
  digest)
    [ "$#" -eq 1 ] || usage
    digest_of "$1"
    ;;
  point)
    [ "$#" -eq 2 ] || usage
    ref="$1" tag="$2"
    repository="${ref%@*}" digest="${ref#*@}"
    [[ "$repository" =~ $REPOSITORY_RE ]] && [[ "$digest" =~ $DIGEST_RE ]] \
      || { echo "registry: not a <repository>@sha256:<digest> reference: $ref" >&2; exit 2; }
    [[ "$tag" =~ $TAG_RE ]] || { echo "registry: not a tag: $tag" >&2; exit 2; }
    # A carbon copy of the one source manifest (no new index wrapped around
    # it), so the tag names the very digest that was probed.
    docker buildx imagetools create --prefer-index=false --tag "$repository:$tag" "$ref"
    now="$(digest_of "$repository:$tag")"
    [ "$now" = "$digest" ] || { echo "registry: $repository:$tag resolves to ${now:-nothing}, not $digest" >&2; exit 1; }
    echo "$repository:$tag -> $digest"
    ;;
  *)
    usage
    ;;
esac
