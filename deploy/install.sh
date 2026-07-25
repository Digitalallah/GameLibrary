#!/usr/bin/env bash
set -euo pipefail

APP_DIR=/opt/GameLibrary
DATA_DIR=/var/lib/gamelibrary
SERVICE_USER=gamelibrary

if [[ $EUID -ne 0 ]]; then
  echo "Запустите через sudo." >&2
  exit 1
fi

NODE_MAJOR=$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)
if (( NODE_MAJOR < 20 )); then
  echo "Нужен Node.js 20 или новее. Сейчас: $(node --version 2>/dev/null || echo 'не установлен')." >&2
  exit 1
fi

id -u "$SERVICE_USER" >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
mkdir -p "$APP_DIR" "$DATA_DIR"
rsync -a --delete --exclude='.git' --exclude='data' ./ "$APP_DIR"/
chown -R root:root "$APP_DIR"
chown -R "$SERVICE_USER:$SERVICE_USER" "$DATA_DIR"
install -m 0644 deploy/gamelibrary.service /etc/systemd/system/gamelibrary.service

if [[ ! -f /etc/gamelibrary.env ]]; then
  install -m 0600 .env.example /etc/gamelibrary.env
  echo "Создан /etc/gamelibrary.env. Заполните пароль, SteamID и API-ключ, затем запустите службу."
fi

systemctl daemon-reload
systemctl enable gamelibrary.service
