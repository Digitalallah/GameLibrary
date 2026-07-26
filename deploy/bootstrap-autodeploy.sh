#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/Digitalallah/GameLibrary.git"
REPO_DIR="${GAMELIBRARY_DEPLOY_REPO:-$HOME/.local/share/gamelibrary-deploy-repo}"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/gamelibrary-deploy"
LOG_FILE="$STATE_DIR/autodeploy.log"
MARKER="# gamelibrary-autodeploy"

for command_name in git python3 curl crontab flock sha256sum; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "ОШИБКА: на сервере нет команды $command_name" >&2
    exit 10
  fi
done

mkdir -p "$(dirname "$REPO_DIR")" "$STATE_DIR"

if [[ -d "$REPO_DIR/.git" ]]; then
  git -C "$REPO_DIR" fetch --quiet origin main
  git -C "$REPO_DIR" reset --quiet --hard origin/main
else
  rm -rf "$REPO_DIR"
  git clone --quiet --depth 1 --branch main "$REPO_URL" "$REPO_DIR"
fi

chmod +x \
  "$REPO_DIR/deploy/pull-deploy.sh" \
  "$REPO_DIR/deploy/bootstrap-autodeploy.sh" \
  "$REPO_DIR/deploy/merge-non-steam.py"

FLOCK="$(command -v flock)"
CRON_LINE="* * * * * $FLOCK -n /tmp/gamelibrary-autodeploy.lock $REPO_DIR/deploy/pull-deploy.sh >>$LOG_FILE 2>&1 $MARKER"

{
  crontab -l 2>/dev/null | grep -Fv "$MARKER" || true
  printf '%s\n' "$CRON_LINE"
} | crontab -

echo "Автодеплой установлен. Сейчас выполняю первый перенос..."
"$REPO_DIR/deploy/pull-deploy.sh" --force

echo
echo "ГОТОВО"
echo "Сервер будет проверять GitHub раз в минуту."
echo "Лог: $LOG_FILE"
echo "Адрес: http://37.143.11.231:3210"
