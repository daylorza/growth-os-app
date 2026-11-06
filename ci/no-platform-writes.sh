#!/usr/bin/env bash
# Guardrail: no code in this repo may write to X (or any social platform). Fails CI if a tracked file
# references a platform write API: posting, replying, liking, following, DMs, media upload.
# Reading X happens only inside the analyst agent's own connection, never in this codebase.
set -euo pipefail
cd "$(dirname "$0")/.."

PATTERN='api\.twitter\.com|api\.x\.com|upload\.twitter\.com|upload\.x\.com|/2/tweets|statuses/(update|retweet)|favorites/create|friendships/create|direct_messages|/2/dm_|/2/users/[^ ]*/(likes|following|retweets|bookmarks)|media/upload|(create|post|send)Tweet|graph\.facebook\.com|graph\.instagram\.com|open\.tiktokapis\.com|open-api\.tiktok\.com'

hits=$(git ls-files -z | grep -zv -e '^ci/no-platform-writes\.sh$' -e 'pnpm-lock\.yaml$' -e '\.png$' | xargs -0 grep -nIE "$PATTERN" || true)
if [ -n "$hits" ]; then
  echo "Platform write call found. Growth OS is draft-only: nothing in this repo posts, replies, likes, follows or messages." >&2
  echo "$hits" >&2
  exit 1
fi
echo "No platform write calls."
