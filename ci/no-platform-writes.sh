#!/usr/bin/env bash
# Guardrail: no code in this repo may write to X (or any social platform) directly. Fails CI if a tracked file
# references a platform write API: posting, replying, liking, following, DMs, media upload.
# Reading X happens only inside the analyst agent's own connection, never in this codebase.
# The one publish path is the Buffer connector, which schedules creator-approved platform versions through Buffer.
set -euo pipefail
cd "$(dirname "$0")/.."

PATTERN='api\.twitter\.com|api\.x\.com|upload\.twitter\.com|upload\.x\.com|/2/tweets|statuses/(update|retweet)|favorites/create|friendships/create|direct_messages|/2/dm_|/2/users/[^ ]*/(likes|following|retweets|bookmarks)|media/upload|(create|post|send)Tweet|graph\.facebook\.com|graph\.instagram\.com|open\.tiktokapis\.com|open-api\.tiktok\.com|api\.buffer\.com|api\.bufferapp\.com|graph\.threads\.(com|net)|threads\.(com|net)/oauth|threads_publish|manage_reply|manage_pending_reply'

# Exception 1: the read-only TikTok connector (and its tests) may name TikTok's OAuth token endpoint and
# Display API reads, nothing else. Every TikTok URL there must be on this list; every other platform stays banned.
TIKTOK_FILES=(server/src/worker/tiktok-connector.ts server/test/tiktok.spec.ts server/test/draft-only.spec.ts)
TIKTOK_ALLOWED='^https://(www\.tiktok\.com/v2/auth/authorize/|open\.tiktokapis\.com/v2/(oauth/token|user/info|video/list|video/query)/)$'

# Exception 2: the Buffer connector (and its tests) may name Buffer's GraphQL endpoint, nothing else.
# Which mutations it may send is pinned in server/test/draft-only.spec.ts.
BUFFER_FILES=(server/src/worker/buffer-connector.ts server/test/buffer.spec.ts server/test/draft-only.spec.ts)
BUFFER_ALLOWED='^https://api\.buffer\.com/?$'

# Exception 3: the read-only Threads connector (and its tests) may name the Threads OAuth endpoints, the creator's own
# post list and the media node prefix (read for /conversation only). Threads write endpoints stay banned even there.
THREADS_FILES=(server/src/worker/threads-connector.ts server/test/threads.spec.ts server/test/draft-only.spec.ts)
THREADS_ALLOWED='^https://(threads\.com/oauth/authorize|graph\.threads\.com/(oauth/access_token|access_token|refresh_access_token|v1\.0/me/threads|v1\.0/))$'

without() { local p="$PATTERN"; for alt in "$@"; do p="${p//|$alt/}"; done; printf '%s' "$p"; }

exclude=(-e '^ci/no-platform-writes\.sh$' -e 'pnpm-lock\.yaml$' -e '\.png$')
for f in "${TIKTOK_FILES[@]}" "${BUFFER_FILES[@]}" "${THREADS_FILES[@]}"; do exclude+=(-e "^${f//./\\.}\$"); done
hits=$(git ls-files -z | grep -zv "${exclude[@]}" | xargs -0 grep -nIE "$PATTERN" || true)

check() { # file, allowed-URL regex, URL extractor, pattern without this file's exceptions
  local f=$1 allowed=$2 urls=$3 rest=$4 bad other
  [ -f "$f" ] || return 0
  bad=$(grep -oE "$urls" "$f" | sort -u | grep -vE "$allowed" || true)
  other=$(grep -nIE "$rest" "$f" | sed "s|^|$f:|" || true)
  [ -n "$bad" ] && hits="$hits"$'\n'"$f: platform URL not on the allowed list: $bad"
  [ -n "$other" ] && hits="$hits"$'\n'"$other"
  return 0
}
TIKTOK_URLS="https://(open\.tiktokapis\.com|[A-Za-z0-9.-]*tiktok\.com/v[0-9]+/)[^'\"\` ]*"
BUFFER_URLS="https?://[A-Za-z0-9.-]*buffer(app)?\.com[^'\"\` ]*"
THREADS_URLS="https?://([A-Za-z0-9.-]*\.)?threads\.(com|net)[^'\"\`? ]*"
THREADS_WITHOUT=$(without 'graph\\.threads\\.(com|net)' 'threads\\.(com|net)/oauth')
for f in "${TIKTOK_FILES[@]}"; do
  if [ "$f" = server/test/draft-only.spec.ts ]; then continue; fi
  check "$f" "$TIKTOK_ALLOWED" "$TIKTOK_URLS" "$(without 'open\\.tiktokapis\\.com')"
done
for f in "${BUFFER_FILES[@]}"; do
  if [ "$f" = server/test/draft-only.spec.ts ]; then continue; fi
  check "$f" "$BUFFER_ALLOWED" "$BUFFER_URLS" "$(without 'api\\.buffer\\.com')"
done
for f in "${THREADS_FILES[@]}"; do
  if [ "$f" = server/test/draft-only.spec.ts ]; then continue; fi
  check "$f" "$THREADS_ALLOWED" "$THREADS_URLS" "$THREADS_WITHOUT"
done
# The draft-only spec pins the connectors' URLs, so it may name their hosts and nothing else.
check server/test/draft-only.spec.ts "$TIKTOK_ALLOWED|$BUFFER_ALLOWED|$THREADS_ALLOWED" "$TIKTOK_URLS|$BUFFER_URLS|$THREADS_URLS" "$(without 'open\\.tiktokapis\\.com' 'api\\.buffer\\.com' 'graph\\.threads\\.(com|net)' 'threads\\.(com|net)/oauth')"

hits=$(printf '%s' "$hits" | sed '/^$/d')
if [ -n "$hits" ]; then
  echo "Platform write call found. Nothing in this repo posts, replies, likes, follows or messages; publishing goes only through the Buffer connector." >&2
  echo "$hits" >&2
  exit 1
fi
echo "No platform write calls (TikTok and Threads connectors: read-only endpoints; Buffer connector: api.buffer.com only)."
