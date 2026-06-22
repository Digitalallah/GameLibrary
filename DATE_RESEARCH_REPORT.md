# Date research report

## HTTP preflight

Real HTTP requests were made before collecting dates:

| URL | HTTP status |
| --- | ---: |
| `https://store.steampowered.com` | 200 |
| `https://steamdb.info` | 403 |
| `https://en.wikipedia.org` | 200 |

SteamDB was reachable but returned HTTP 403 to the non-browser `curl` preflight, so the automated batch did not depend on SteamDB pages.

## Source library extraction

- Source Steam library HTML/HTM file found: `Сообщество Steam __ Параметры __ Игры.htm`.
- Steam store links extracted from that file: 949.
- Unique Steam App IDs extracted: 316.
- Application records matched by Steam App ID: 316 / 316.

## Batch collection method

- Primary automated source: Steam Store appdetails API and Steam app pages, queried by Steam App ID.
- The updater saved progress after each 25 records while collecting data.
- Manual follow-up was used for Steam entries whose appdetails response did not include a usable release date, with URLs saved in the affected records' `sources` arrays.

## Results

| Metric | Count |
| --- | ---: |
| Games processed | 316 |
| Full release dates found | 310 |
| Early access dates found | 11 |
| Games still without full release dates | 6 |

## Domains actually used

- `store.steampowered.com`
- `en.wikipedia.org`
- `www.residentevil.com`
- `serioussam.fandom.com`

## Failed or limited HTTP requests

- `https://steamdb.info` returned HTTP 403 during preflight.
- Steam appdetails returned `success:false` for several retired/delisted/helper apps; those are listed below for manual review where still unresolved.

## Records requiring manual verification

These records remain without a full release date because the Steam entry is unavailable, delisted, a beta/helper app, unreleased, or otherwise does not expose a reliable full-release date through the automated Steam lookup:

| Steam App ID | Title | Current source |
| --- | --- | --- |
| 22490 | Fallout: New Vegas PCR | `https://store.steampowered.com/app/22490/` |
| 41010 | Serious Sam HD: The Second Encounter | `https://store.steampowered.com/app/41010/` |
| 43160 | Metro: Last Light Complete Edition | `https://store.steampowered.com/app/43160/` |
| 367540 | Starbound - Unstable | `https://store.steampowered.com/app/367540/` |
| 1422450 | Deadlock | `https://store.steampowered.com/app/1422450/` |
| 1537710 | The Dark Pictures Anthology: Little Hope - Friend's Pass | `https://store.steampowered.com/app/1537710/` |

## Spot checks

- Oldest populated records after sorting by `releaseDate`: Deus Ex: Game of the Year Edition, Half-Life 2, Half-Life: Source.
- Newest populated records after sorting by `releaseDate`: Resident Evil Requiem, Where Winds Meet, Forza Horizon 6.
- Date sorting was checked programmatically by parsing `games.json` and sorting populated `releaseDate` values lexicographically; the stored `YYYY-MM-DD` / `YYYY-MM` / `YYYY` forms preserve chronological order for available precision.
