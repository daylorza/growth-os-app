#!/usr/bin/env bash
# Guardrail: no code in this repo may write to X (or any social platform). Fails CI if a tracked file
# references a platform write API: posting, replying, liking, following, DMs, media upload.
# Reading X happens only inside the analyst agent's own connection, never in this codebase.
set -euo pipefail
cd "$(dirname "$0")/.."

PATTERN='api\.twitter\.com|api\.x\.com|upload\.twitter\.com|upload\.x\.com|/2/tweets|statuses/(update|retweet)|favorites/create|friendships/create|direct_messages|/2/dm_|/2/users/[^ ]*/(likes|following|retweets|bookmarks)|media/upload|(create|post|send)Tweet|graph\.facebook\.com|graph\.instagram\.com|open\.tiktokapis\.com|open-api\.tiktok\.com'

# The one exception: the read-only TikTok connector (and its tests) may name TikTok's OAuth token endpoint and
# Display API reads, nothing else. Every TikTok URL there must be on this list; every other platform stays banned.
TIKTOK_FILES=(server/src/worker/tiktok-connector.ts server/test/tiktok.spec.ts server/test/draft-only.spec.ts)
TIKTOK_ALLOWED='^https://(www\.tiktok\.com/v2/auth/authorize/|open\.tiktokapis\.com/v2/(oauth/token|user/info|video/list|video/query)/)$'
PATTERN_NO_TIKTOK_API="${PATTERN//|open\\.tiktokapis\\.com/}"

exclude=(-e '^ci/no-platform-writes\.sh$' -e 'pnpm-lock\.yaml$' -e '\.png$')
for f in "${TIKTOK_FILES[@]}"; do exclude+=(-e "^${f//./\\.}\$"); done
hits=$(git ls-files -z | grep -zv "${exclude[@]}" | xargs -0 grep -nIE "$PATTERN" || true)
for f in "${TIKTOK_FILES[@]}"; do
  [ -f "$f" ] || continue
  bad=$(grep -oE "https://(open\.tiktokapis\.com|[A-Za-z0-9.-]*tiktok\.com/v[0-9]+/)[^'\"\` ]*" "$f" | sort -u | grep -vE "$TIKTOK_ALLOWED" || true)
  other=$(grep -nIE "$PATTERN_NO_TIKTOK_API" "$f" | sed "s|^|$f:|" || true)
  [ -n "$bad" ] && hits="$hits"$'\n'"$f: TikTok URL not on the read-only list: $bad"
  [ -n "$other" ] && hits="$hits"$'\n'"$other"
done
hits=$(printf '%s' "$hits" | sed '/^$/d')
if [ -n "$hits" ]; then
  echo "Platform write call found. Growth OS is draft-only: nothing in this repo posts, replies, likes, follows or messages." >&2
  echo "$hits" >&2
  exit 1
fi
echo "No platform write calls (TikTok connector: read-only endpoints only)."
