#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import shutil
import tempfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def game_list(payload: Any, label: str) -> list[dict[str, Any]]:
    games = payload if isinstance(payload, list) else payload.get("games")
    if not isinstance(games, list):
        raise SystemExit(f"ОШИБКА: {label} не содержит массив games")
    if not all(isinstance(game, dict) for game in games):
        raise SystemExit(f"ОШИБКА: {label} содержит некорректные записи")
    return games


def is_steam(game: dict[str, Any]) -> bool:
    return str(game.get("platform") or "").strip().casefold() == "steam"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Заменить только сторонние игры, сохранив текущий Steam-список."
    )
    parser.add_argument("--library", required=True, type=Path)
    parser.add_argument("--incoming", required=True, type=Path)
    parser.add_argument("--overrides", required=True, type=Path)
    args = parser.parse_args()

    current = load_json(args.library)
    incoming_payload = load_json(args.incoming)
    overrides = load_json(args.overrides)

    current_games = game_list(current, "серверная библиотека")
    incoming_games = game_list(incoming_payload, "файл сторонних игр")

    if any(is_steam(game) for game in incoming_games):
        raise SystemExit("ОШИБКА: файл сторонних игр содержит Steam-позиции")

    incoming_ids = [str(game.get("id") or "") for game in incoming_games]
    if not all(incoming_ids) or len(incoming_ids) != len(set(incoming_ids)):
        raise SystemExit("ОШИБКА: у сторонних игр отсутствуют или повторяются ID")

    platforms = Counter(str(game.get("platform") or "").strip() for game in incoming_games)
    expected = Counter({
        "Epic": 14,
        "GOG": 2,
        "Другое": 2,
        "Пиратка": 1,
        "PS": 1,
    })
    if len(incoming_games) != 20 or platforms != expected:
        raise SystemExit(
            "ОШИБКА: ожидалось 20 сторонних игр "
            f"{dict(expected)}, найдено {len(incoming_games)} {dict(platforms)}"
        )

    steam_games = [dict(game) for game in current_games if is_steam(game)]
    if not steam_games:
        raise SystemExit("ОШИБКА: на сервере не найден текущий Steam-список")

    applied_overrides: dict[str, str] = {}
    for game in steam_games:
        app_id = str(game.get("steamAppId") or "")
        override = overrides.get(app_id)
        if not isinstance(override, dict):
            continue
        release_date = str(override.get("releaseDate") or "").strip()
        if not release_date:
            continue
        game["releaseDate"] = release_date
        game["releaseDateStatus"] = "exact"
        game["releaseDatePrecision"] = "day"
        game["releaseDateSource"] = "override"
        applied_overrides[app_id] = release_date

    required_overrides = {
        "38400": "1997-10-10",
        "38410": "1998-10-29",
    }
    for app_id, expected_date in required_overrides.items():
        if applied_overrides.get(app_id) != expected_date:
            raise SystemExit(
                f"ОШИБКА: не применена дата {expected_date} для Steam App ID {app_id}"
            )

    result = dict(current) if isinstance(current, dict) else {"version": 2}
    result["games"] = incoming_games + steam_games
    result["updatedAt"] = datetime.now(timezone.utc).isoformat()

    backup_dir = args.library.parent / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    backup_path = backup_dir / f"before-non-steam-{stamp}.json"
    shutil.copy2(args.library, backup_path)

    fd, temp_name = tempfile.mkstemp(
        prefix=f"{args.library.name}.",
        suffix=".tmp",
        dir=args.library.parent,
    )
    os.close(fd)
    temp_path = Path(temp_name)

    try:
        temp_path.write_text(
            json.dumps(result, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        os.chmod(temp_path, 0o600)
        os.replace(temp_path, args.library)
    finally:
        temp_path.unlink(missing_ok=True)

    backups = sorted(
        backup_dir.glob("before-non-steam-*.json"),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    for old_backup in backups[10:]:
        old_backup.unlink(missing_ok=True)

    print("УСПЕШНО")
    print(f"Steam-игр сохранено: {len(steam_games)}")
    print(f"Сторонних игр записано: {len(incoming_games)}")
    print(f"Всего игр: {len(result['games'])}")
    print(f"Платформы: {dict(platforms)}")
    print(f"Fallout: {required_overrides['38400']}")
    print(f"Fallout 2: {required_overrides['38410']}")
    print(f"Резервная копия: {backup_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
