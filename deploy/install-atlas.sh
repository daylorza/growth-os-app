#!/usr/bin/env bash
# Additive install of Growth OS on a Linux host with systemd and Docker. Run as root (sudo).
#
#   sudo APP_DIR=/home/<user>/growth-os APP_USER=<user> BIND_HOST=<tailnet IP> CREATOR_USER=<login> \
#        ANALYST_NAME=<analyst agent name> CREATIVE_NAME=<creative agent name> WORKER_NAME=<scheduler name> CONNECTOR_NAME=<connector name> ./deploy/install-atlas.sh
#
# Units (nothing else on the host is touched):
#   growth-os-mongo.service          MongoDB in Docker, 127.0.0.1:27017 only, data in /var/lib/growth-os/mongo
#   growth-os-api.service            NestJS API, 127.0.0.1:8767 only
#   growth-os-web.service            Next.js dashboard + /api pass-through, BIND_HOST:8766 (tailnet only)
#   growth-os-dispatch-daily.timer   daily_audit to the analyst       (installed, NOT enabled)
#   growth-os-dispatch-measure.timer measure_request at 24h / 72h     (installed, NOT enabled)
#   growth-os-dispatch-x.timer       x_refresh every 4 to 6 hours     (installed, NOT enabled)
#   growth-os-dispatch-weekly.timer  weekly_refresh Sun 8 PM ET       (installed, NOT enabled)
#   growth-os-dispatch-sweep.timer   engagement_sweep every 4 to 6 hours (installed, NOT enabled)
#   growth-os-tiktok.service         TikTok authorization page, 127.0.0.1:8768 (installed, NOT enabled)
#   growth-os-tiktok-pull.timer      read-only TikTok pull, daily 07:30 UTC (installed, NOT enabled)
#   growth-os-deploy.timer           deploy/update-atlas.sh every 5 min: CI-green origin/main only (installed, NOT enabled)
# Secrets (passwords, per-role keys) are generated on first run, written only into the root-owned unit
# files (chmod 600) and never printed. Re-running keeps existing secrets and any webhook values
# added on the host.
set -euo pipefail

: "${APP_DIR:?set APP_DIR}" "${APP_USER:?set APP_USER}" "${BIND_HOST:?set BIND_HOST}" "${CREATOR_USER:?set CREATOR_USER}"
WEB_PORT="${WEB_PORT:-8766}"
API_PORT="${API_PORT:-8767}"
MONGO_PORT="${MONGO_PORT:-27017}"
# MongoDB 8.x ships a tcmalloc that crashes or refuses to start on Linux 6.19+ / 7.0 kernels (SERVER-121912).
# 7.0 runs cleanly there; move to 8.x once the kernel check is fixed upstream (SERVER-136848).
MONGO_IMAGE="${MONGO_IMAGE:-mongo:7.0}"
UNITS=/etc/systemd/system
DATA=/var/lib/growth-os/mongo

[ "$(id -u)" = 0 ] || { echo "Run as root." >&2; exit 1; }
# First install only: refuse ports that something else already uses.
if [ ! -f "$UNITS/growth-os-api.service" ]; then
  for p in "$WEB_PORT" "$API_PORT" "$MONGO_PORT"; do
    if ss -ltnH "sport = :$p" | grep -q .; then echo "Port $p is already in use. Pick another and record it in the README." >&2; exit 1; fi
  done
fi

secret() { openssl rand -hex 24; }
# Reads a value back from an existing unit so re-runs keep the same secrets.
existing() { [ -f "$UNITS/$1" ] && sed -n "s/^Environment=$2=//p" "$UNITS/$1" | head -n1 || true; }
keep() { local v; v="$(existing "$1" "$2")"; echo "${v:-${3:-}}"; }

MONGO_USER=growth_os
MONGO_PASS="$(keep growth-os-mongo.service MONGO_INITDB_ROOT_PASSWORD "$(secret)")"
CREATOR_PASS="$(keep growth-os-api.service GROWTH_OS_PASS "$(secret)")"
ANALYST_KEY="$(keep growth-os-api.service GROWTH_OS_ANALYST_KEY "$(secret)")"
CREATIVE_KEY="$(keep growth-os-api.service GROWTH_OS_CREATIVE_KEY "$(secret)")"
CREATOR_KEY="$(keep growth-os-api.service GROWTH_OS_CREATOR_KEY "$(secret)")"
WORKER_KEY="$(keep growth-os-api.service GROWTH_OS_WORKER_KEY "$(secret)")"
# Analyst connector key: /mcp only, may be sent as ?key=. Rotate it alone with ROTATE_CONNECTOR_KEY=1.
CONNECTOR_KEY="$(keep growth-os-api.service GROWTH_OS_CONNECTOR_KEY "$(openssl rand -hex 32)")"
[ "${ROTATE_CONNECTOR_KEY:-0}" = 1 ] && CONNECTOR_KEY="$(openssl rand -hex 32)"
CONNECTOR_NAME="$(keep growth-os-api.service GROWTH_OS_CONNECTOR_NAME "${CONNECTOR_NAME:-analyst-connector}")"
ANALYST_NAME="$(keep growth-os-api.service GROWTH_OS_ANALYST_NAME "${ANALYST_NAME:-analyst}")"
CREATIVE_NAME="$(keep growth-os-api.service GROWTH_OS_CREATIVE_NAME "${CREATIVE_NAME:-creative}")"
WORKER_NAME="$(keep growth-os-api.service GROWTH_OS_WORKER_NAME "${WORKER_NAME:-scheduler}")"
ANALYST_WEBHOOK_URL="$(keep growth-os-api.service ANALYST_WEBHOOK_URL)"
ANALYST_WEBHOOK_KEY="$(keep growth-os-api.service ANALYST_WEBHOOK_KEY)"
CREATIVE_WEBHOOK_URL="$(keep growth-os-api.service CREATIVE_WEBHOOK_URL)"
CREATIVE_WEBHOOK_KEY="$(keep growth-os-api.service CREATIVE_WEBHOOK_KEY)"
TIKTOK_PORT="${TIKTOK_PORT:-8768}"
# Registered in the TikTok app's Login Kit settings. The client key and secret live in /etc/growth-os/tiktok.env
# (root only, written on the host by the creator); this script never reads or prints them.
TIKTOK_REDIRECT_URI="$(keep growth-os-tiktok.service TIKTOK_REDIRECT_URI "${TIKTOK_REDIRECT_URI:-}")"
TIKTOK_TOKEN_FILE=/var/lib/growth-os/tiktok/token.json
NODE="$(command -v node)"

mkdir -p "$DATA"
umask 077

cat > "$UNITS/growth-os-mongo.service" <<EOF
[Unit]
Description=Growth OS MongoDB (Docker, localhost only)
After=docker.service network-online.target
Requires=docker.service

[Service]
Environment=MONGO_INITDB_ROOT_USERNAME=$MONGO_USER
Environment=MONGO_INITDB_ROOT_PASSWORD=$MONGO_PASS
ExecStartPre=-/usr/bin/docker rm -f growth-os-mongo
ExecStart=/usr/bin/docker run --rm --name growth-os-mongo -p 127.0.0.1:$MONGO_PORT:27017 -v $DATA:/data/db -e MONGO_INITDB_ROOT_USERNAME -e MONGO_INITDB_ROOT_PASSWORD $MONGO_IMAGE --bind_ip_all
ExecStop=/usr/bin/docker stop growth-os-mongo
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

cat > "$UNITS/growth-os-api.service" <<EOF
[Unit]
Description=Growth OS API (NestJS, draft-only)
After=network-online.target growth-os-mongo.service
Requires=growth-os-mongo.service

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR/server
Environment=NODE_ENV=production
Environment=GROWTH_OS_HOST=127.0.0.1
Environment=GROWTH_OS_PORT=$API_PORT
Environment=GROWTH_OS_MONGO_URL=mongodb://$MONGO_USER:$MONGO_PASS@127.0.0.1:$MONGO_PORT/?authSource=admin
Environment=GROWTH_OS_MONGO_DB=growth_os
Environment=GROWTH_OS_USER=$CREATOR_USER
Environment=GROWTH_OS_PASS=$CREATOR_PASS
Environment=GROWTH_OS_ANALYST_KEY=$ANALYST_KEY
Environment=GROWTH_OS_ANALYST_NAME=$ANALYST_NAME
Environment=GROWTH_OS_CREATIVE_KEY=$CREATIVE_KEY
Environment=GROWTH_OS_CREATIVE_NAME=$CREATIVE_NAME
Environment=GROWTH_OS_CREATOR_KEY=$CREATOR_KEY
Environment=GROWTH_OS_WORKER_KEY=$WORKER_KEY
Environment=GROWTH_OS_WORKER_NAME=$WORKER_NAME
Environment=GROWTH_OS_CONNECTOR_KEY=$CONNECTOR_KEY
Environment=GROWTH_OS_CONNECTOR_NAME=$CONNECTOR_NAME
# The analyst's listener (URL and sender key from its routine panel), added on the host only.
Environment=ANALYST_WEBHOOK_URL=$ANALYST_WEBHOOK_URL
Environment=ANALYST_WEBHOOK_KEY=$ANALYST_WEBHOOK_KEY
Environment=CREATIVE_WEBHOOK_URL=$CREATIVE_WEBHOOK_URL
Environment=CREATIVE_WEBHOOK_KEY=$CREATIVE_WEBHOOK_KEY
ExecStart=$NODE dist/main.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

cat > "$UNITS/growth-os-web.service" <<EOF
[Unit]
Description=Growth OS dashboard (Next.js, tailnet only)
After=network-online.target tailscaled.service growth-os-api.service
Wants=growth-os-api.service

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR/app
Environment=NODE_ENV=production
Environment=GROWTH_OS_API=http://127.0.0.1:$API_PORT
Environment=GROWTH_OS_IGNORE_PRIVATE=1
ExecStart=$NODE node_modules/next/dist/bin/next start -H $BIND_HOST -p $WEB_PORT
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

for mode in daily measure x weekly sweep; do
cat > "$UNITS/growth-os-dispatch-$mode.service" <<EOF
[Unit]
Description=Growth OS scheduler: dispatch $mode events (no LLM call, no platform call)
After=network-online.target growth-os-api.service

[Service]
Type=oneshot
User=$APP_USER
WorkingDirectory=$APP_DIR/server
Environment=GROWTH_OS_API=http://127.0.0.1:$API_PORT
Environment=GROWTH_OS_WORKER_KEY=$WORKER_KEY
ExecStart=$NODE dist/worker/dispatch-worker.js $mode
EOF
done

cat > "$UNITS/growth-os-dispatch-daily.timer" <<EOF
[Unit]
Description=Growth OS daily_audit schedule (enable only after the creator approves it)

[Timer]
# Placeholder until the schedule is approved; see README.
OnCalendar=*-*-* 08:00:00
Persistent=true

[Install]
WantedBy=timers.target
EOF

cat > "$UNITS/growth-os-dispatch-measure.timer" <<EOF
[Unit]
Description=Growth OS measure_request check (24h and 72h after a post is published)

[Timer]
OnCalendar=hourly
Persistent=true

[Install]
WantedBy=timers.target
EOF

cat > "$UNITS/growth-os-dispatch-x.timer" <<EOF
[Unit]
Description=Growth OS x_refresh to the analyst, every 4 to 6 hours

[Timer]
OnBootSec=10min
OnUnitActiveSec=4h
RandomizedDelaySec=2h

[Install]
WantedBy=timers.target
EOF

cat > "$UNITS/growth-os-dispatch-weekly.timer" <<EOF
[Unit]
Description=Growth OS weekly_refresh to the creative agent (TikTok and Threads), Sunday 8 PM US Eastern

[Timer]
OnCalendar=Sun *-*-* 20:00:00 America/New_York
Persistent=true

[Install]
WantedBy=timers.target
EOF

cat > "$UNITS/growth-os-dispatch-sweep.timer" <<EOF
[Unit]
Description=Growth OS engagement_sweep to the creative agent, every 4 to 6 hours

[Timer]
OnBootSec=15min
OnUnitActiveSec=4h
RandomizedDelaySec=2h

[Install]
WantedBy=timers.target
EOF

cat > "$UNITS/growth-os-deploy.service" <<EOF
[Unit]
Description=Growth OS deploy: pull origin/main once its CI passed, rebuild, re-run the installer
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
Environment=APP_DIR=$APP_DIR
Environment=APP_USER=$APP_USER
Environment=BIND_HOST=$BIND_HOST
Environment=CREATOR_USER=$CREATOR_USER
Environment=WEB_PORT=$WEB_PORT
Environment=API_PORT=$API_PORT
Environment=MONGO_PORT=$MONGO_PORT
ExecStart=/bin/bash $APP_DIR/deploy/update-atlas.sh
TimeoutStartSec=30min
EOF

cat > "$UNITS/growth-os-deploy.timer" <<EOF
[Unit]
Description=Growth OS deploy check every 5 minutes

[Timer]
OnCalendar=*:0/5

[Install]
WantedBy=timers.target
EOF

mkdir -p /etc/growth-os "$(dirname "$TIKTOK_TOKEN_FILE")"
chmod 700 /etc/growth-os
chown "$APP_USER" "$(dirname "$TIKTOK_TOKEN_FILE")"
chmod 700 "$(dirname "$TIKTOK_TOKEN_FILE")"

cat > "$UNITS/growth-os-tiktok.service" <<EOF
[Unit]
Description=Growth OS TikTok connector: authorization page on 127.0.0.1 (read-only; enable to authorize)
After=network-online.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR/server
EnvironmentFile=-/etc/growth-os/tiktok.env
Environment=TIKTOK_REDIRECT_URI=$TIKTOK_REDIRECT_URI
Environment=TIKTOK_TOKEN_FILE=$TIKTOK_TOKEN_FILE
Environment=TIKTOK_CONNECTOR_PORT=$TIKTOK_PORT
ExecStart=$NODE dist/worker/tiktok-connector.js serve
Restart=on-failure
RestartSec=10
EOF

cat > "$UNITS/growth-os-tiktok-pull.service" <<EOF
[Unit]
Description=Growth OS TikTok connector: daily read-only pull of account and video stats
After=network-online.target growth-os-api.service

[Service]
Type=oneshot
User=$APP_USER
WorkingDirectory=$APP_DIR/server
EnvironmentFile=-/etc/growth-os/tiktok.env
Environment=TIKTOK_REDIRECT_URI=$TIKTOK_REDIRECT_URI
Environment=TIKTOK_TOKEN_FILE=$TIKTOK_TOKEN_FILE
Environment=GROWTH_OS_API=http://127.0.0.1:$API_PORT
Environment=GROWTH_OS_CREATOR_KEY=$CREATOR_KEY
ExecStart=$NODE dist/worker/tiktok-connector.js pull
EOF

cat > "$UNITS/growth-os-tiktok-pull.timer" <<EOF
[Unit]
Description=Growth OS TikTok pull, daily before the 08:00 UTC audit

[Timer]
OnCalendar=*-*-* 07:30:00 UTC
Persistent=true

[Install]
WantedBy=timers.target
EOF

# The xAI fallback was removed: the analyst agent is the only path that reads X.
rm -f "$UNITS/growth-os-xai-fallback.service"

chown root:root "$UNITS"/growth-os-*
chmod 600 "$UNITS"/growth-os-*
systemctl daemon-reload
systemctl enable --now growth-os-mongo.service growth-os-api.service growth-os-web.service
systemctl restart growth-os-api.service growth-os-web.service
echo "Installed. Web: http://$BIND_HOST:$WEB_PORT  API (local): 127.0.0.1:$API_PORT"
echo "Timers installed, not enabled: growth-os-dispatch-daily.timer, growth-os-dispatch-measure.timer, growth-os-dispatch-x.timer, growth-os-dispatch-weekly.timer, growth-os-dispatch-sweep.timer, growth-os-tiktok-pull.timer, growth-os-deploy.timer"
echo "Creator login: user $CREATOR_USER. Password and per-role keys are in $UNITS/growth-os-api.service (root only)."
