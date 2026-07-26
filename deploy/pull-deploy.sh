#!/usr/bin/env bash
set -u

REPO_DIR="${GAMELIBRARY_DEPLOY_REPO:-$HOME/.local/share/gamelibrary-deploy-repo}"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/gamelibrary-deploy"
MARKER="# gamelibrary-autodeploy"

# Удаляем cron раньше всего, чтобы скрипт больше не запускался.
{
  crontab -l 2>/dev/null | grep -Fv "$MARKER" || true
} | crontab - 2>/dev/null || true

# Пытаемся остановить и отключить системную службу без запроса пароля.
systemctl --no-ask-password stop gamelibrary.service 2>/dev/null || true
systemctl --no-ask-password disable gamelibrary.service 2>/dev/null || true
sudo -n systemctl disable --now gamelibrary.service 2>/dev/null || true

# Если служба ещё запущена от текущего пользователя — завершаем процесс.
PID="$(systemctl show gamelibrary.service -p MainPID --value 2>/dev/null || true)"
case "$PID" in
  ''|0) ;;
  *) kill -KILL "$PID" 2>/dev/null || true ;;
esac

# Удаляем только файлы и данные GameLibrary.
rm -rf /opt/GameLibrary 2>/dev/null || true
rm -rf /var/lib/gamelibrary 2>/dev/null || true
sudo -n rm -rf /opt/GameLibrary /var/lib/gamelibrary 2>/dev/null || true
sudo -n rm -f /etc/gamelibrary.env /etc/systemd/system/gamelibrary.service /lib/systemd/system/gamelibrary.service 2>/dev/null || true
sudo -n systemctl daemon-reload 2>/dev/null || true

# Удаляем правило порта, если оно когда-либо добавлялось через UFW.
sudo -n ufw --force delete allow 3210/tcp 2>/dev/null || true

# Удаляем автодеплой и его логи.
rm -rf "$STATE_DIR" 2>/dev/null || true
rm -rf "$REPO_DIR" 2>/dev/null || true

exit 0
