#!/usr/bin/env bash
# Additive install of Growth OS on a Linux host with systemd and Docker. Run as root (sudo).
#
#   sudo APP_DIR=/home/<user>/growth-os APP_USER=<user> BIND_HOST=<tailnet IP> CREATOR_USER=<login> \
#        ANALYST_NAME=<analyst agent name> CREATIVE_NAME=<creative agent name> WORKER_NAME=<scheduler name> ./deploy/install-atlas.sh
#
# Units (nothing else on the host is touched):
#   growth-os-mongo.service          MongoDB in Docker, 127.0.0.1:27017 only, data in /var/lib/growth-os/mongo
#   growth-os-api.service            NestJS API, 127.0.0.1:8767 only
#   growth-os-web.service            Next.js dashboard + /api pass-through, BIND_HOST:8766 (tailnet only)
#   growth-os-dispatch-daily.timer   daily_audit to the analyst       (installed, NOT enabled)
#   growth-os-dispatch-measure.timer measure_request at 24h / 72h     (installed, NOT enabled)
#   growth-os-xai-fallback.service   disabled fallback, needs XAI_API_KEY (no timer)
# Secrets (passwords, per-role keys) are generated on first run, written only into the root-owned unit
# files (chmod 600) and never printed. Re-running keeps existing secrets and any webhook / xAI values
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
ANALYST_NAME="$(keep growth-os-api.service GROWTH_OS_ANALYST_NAME "${ANALYST_NAME:-analyst}")"
CREATIVE_NAME="$(keep growth-os-api.service GROWTH_OS_CREATIVE_NAME "${CREATIVE_NAME:-creative}")"
WORKER_NAME="$(keep growth-os-api.service GROWTH_OS_WORKER_NAME "${WORKER_NAME:-scheduler}")"
ANALYST_WEBHOOK_URL="$(keep growth-os-api.service ANALYST_WEBHOOK_URL)"
ANALYST_WEBHOOK_KEY="$(keep growth-os-api.service ANALYST_WEBHOOK_KEY)"
CREATIVE_WEBHOOK_URL="$(keep growth-os-api.service CREATIVE_WEBHOOK_URL)"
CREATIVE_WEBHOOK_KEY="$(keep growth-os-api.service CREATIVE_WEBHOOK_KEY)"
XAI_API_KEY="$(keep growth-os-xai-fallback.service XAI_API_KEY)"
XAI_MODEL="$(keep growth-os-xai-fallback.service XAI_MODEL)"
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

for mode in daily measure; do
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

cat > "$UNITS/growth-os-xai-fallback.service" <<EOF
[Unit]
Description=Growth OS xAI fallback audit (disabled; needs the creator's XAI_API_KEY on this host)
After=network-online.target growth-os-api.service

[Service]
Type=oneshot
User=$APP_USER
WorkingDirectory=$APP_DIR/server
Environment=GROWTH_OS_API=http://127.0.0.1:$API_PORT
Environment=GROWTH_OS_ANALYST_KEY=$ANALYST_KEY
Environment=XAI_API_KEY=$XAI_API_KEY
Environment=XAI_MODEL=$XAI_MODEL
ExecStart=$NODE dist/worker/xai-fallback.js
EOF

chown root:root "$UNITS"/growth-os-*
chmod 600 "$UNITS"/growth-os-*
systemctl daemon-reload
systemctl enable --now growth-os-mongo.service growth-os-api.service growth-os-web.service
systemctl restart growth-os-api.service growth-os-web.service
echo "Installed. Web: http://$BIND_HOST:$WEB_PORT  API (local): 127.0.0.1:$API_PORT"
echo "Timers installed, not enabled: growth-os-dispatch-daily.timer, growth-os-dispatch-measure.timer"
echo "Creator login: user $CREATOR_USER. Password and per-role keys are in $UNITS/growth-os-api.service (root only)."
