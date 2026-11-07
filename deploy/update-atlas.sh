#!/usr/bin/env bash
# Pull-based deploy, run as root by growth-os-deploy.timer (every 5 minutes) or by hand.
# Deploys origin/main only when every GitHub check on that commit passed, then rebuilds and re-runs
# install-atlas.sh (which keeps all secrets and webhook settings). Nothing is pushed anywhere and
# atlas needs no inbound access. A commit that failed to deploy is skipped until a newer one lands.
#
#   sudo APP_DIR=/home/<user>/growth-os APP_USER=<user> BIND_HOST=<tailnet IP> CREATOR_USER=<login> ./deploy/update-atlas.sh
#   FORCE=1 redeploys the current commit.
set -euo pipefail

main() {
  : "${APP_DIR:?set APP_DIR}" "${APP_USER:?set APP_USER}" "${BIND_HOST:?set BIND_HOST}" "${CREATOR_USER:?set CREATOR_USER}"
  [ "$(id -u)" = 0 ] || { echo "Run as root." >&2; exit 1; }
  local state=/var/lib/growth-os/deploy
  mkdir -p "$state"
  as_app() { sudo -u "$APP_USER" -H bash -c "cd '$APP_DIR' && $1"; }

  as_app 'git fetch -q origin main'
  local sha deployed failed
  sha="$(as_app 'git rev-parse origin/main')"
  deployed="$(cat "$state/deployed-sha" 2>/dev/null || true)"
  failed="$(cat "$state/failed-sha" 2>/dev/null || true)"
  if [ "${FORCE:-0}" != 1 ]; then
    [ "$sha" = "$deployed" ] && exit 0
    [ "$sha" = "$failed" ] && exit 0
  fi

  local repo checks
  repo="$(as_app 'git remote get-url origin' | sed -E 's#^(https://github\.com/|git@github\.com:)##; s#\.git$##')"
  checks="$(curl -fsS -H 'Accept: application/vnd.github+json' "https://api.github.com/repos/$repo/commits/$sha/check-runs")"
  # green | pending | red
  local ci
  ci="$(node -e '
    const r = JSON.parse(process.argv[1]).check_runs ?? []
    if (!r.length || r.some((c) => c.status !== "completed")) console.log("pending")
    else console.log(r.every((c) => ["success", "skipped", "neutral"].includes(c.conclusion)) ? "green" : "red")
  ' "$checks")"
  if [ "$ci" = pending ]; then echo "CI not finished for ${sha:0:7}; waiting."; exit 0; fi
  if [ "$ci" = red ]; then echo "CI failed for ${sha:0:7}; not deploying."; echo "$sha" > "$state/failed-sha"; exit 0; fi

  echo "Deploying ${sha:0:7} (was ${deployed:0:7})."
  if ! as_app "git switch -q main 2>/dev/null || git switch -q -c main --track origin/main; git merge -q --ff-only $sha && corepack pnpm install --frozen-lockfile && GROWTH_OS_IGNORE_PRIVATE=1 corepack pnpm -r build" \
    || ! bash "$APP_DIR/deploy/install-atlas.sh"; then
    echo "$sha" > "$state/failed-sha"
    echo "Deploy of ${sha:0:7} failed. The previous build may still be serving; check the log above." >&2
    exit 1
  fi

  local api="${API_PORT:-8767}" web="${WEB_PORT:-8766}" ok=0
  for _ in $(seq 1 30); do
    if curl -fsS -o /dev/null "http://127.0.0.1:$api/health" && curl -fsS -o /dev/null "http://$BIND_HOST:$web/health"; then ok=1; break; fi
    sleep 2
  done 2>/dev/null
  if [ "$ok" != 1 ]; then echo "$sha" > "$state/failed-sha"; echo "Deployed ${sha:0:7} but health checks fail." >&2; exit 1; fi
  echo "$sha" > "$state/deployed-sha"
  rm -f "$state/failed-sha"
  echo "Deployed ${sha:0:7}."
}

# Everything runs inside main() so bash has read the whole script before git updates this file.
main "$@"
exit
