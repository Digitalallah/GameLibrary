#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${GAMELIBRARY_DEPLOY_REPO:-$HOME/.local/share/gamelibrary-deploy-repo}"
DATA_FILE="${GAMELIBRARY_DATA_FILE:-/var/lib/gamelibrary/library.json}"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/gamelibrary-deploy"
STATE_FILE="$STATE_DIR/non-steam.sha256"
FORCE="${1:-}"

mkdir -p "$STATE_DIR"

if [[ ! -d "$REPO_DIR/.git" ]]; then
  echo "ОШИБКА: не найден клон репозитория: $REPO_DIR" >&2
  exit 20
fi

git -C "$REPO_DIR" fetch --quiet origin main
git -C "$REPO_DIR" reset --quiet --hard origin/main

DEPLOY_HASH="$(
  sha256sum \
    "$REPO_DIR/deploy/non-steam-games.json" \
    "$REPO_DIR/deploy/merge-non-steam.py" \
    "$REPO_DIR/release-overrides.json" \
  | sha256sum \
  | awk '{print $1}'
)"

if [[ "$FORCE" != "--force" ]] && [[ -f "$STATE_FILE" ]] && [[ "$(cat "$STATE_FILE")" == "$DEPLOY_HASH" ]]; then
  exit 0
fi

if [[ ! -f "$DATA_FILE" ]]; then
  echo "ОШИБКА: не найдена серверная библиотека: $DATA_FILE" >&2
  exit 21
fi

if [[ ! -w "$DATA_FILE" ]] || [[ ! -w "$(dirname "$DATA_FILE")" ]]; then
  echo "ОШИБКА: нет прав на запись в $DATA_FILE" >&2
  ls -ld "$DATA_FILE" "$(dirname "$DATA_FILE")" >&2 || true
  exit 22
fi

python3 "$REPO_DIR/deploy/merge-non-steam.py" \
  --library "$DATA_FILE" \
  --incoming "$REPO_DIR/deploy/non-steam-games.json" \
  --overrides "$REPO_DIR/release-overrides.json"

printf '%s\n' "$DEPLOY_HASH" > "$STATE_FILE"

if curl -fsS http://127.0.0.1:3210/healthz >/dev/null; then
  echo "GameLibrary отвечает: http://127.0.0.1:3210/healthz"
else
  echo "ПРЕДУПРЕЖДЕНИЕ: данные записаны, но /healthz не ответил" >&2
fi
