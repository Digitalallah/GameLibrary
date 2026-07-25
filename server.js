import { createServer } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, readdir, rename, stat, writeFile, copyFile, unlink } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_VERSION = 3;
const PORT = Number(process.env.PORT || 3210);
const HOST = process.env.HOST || '127.0.0.1';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const LIBRARY_FILE = path.join(DATA_DIR, 'library.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const INITIAL_FILE = path.join(ROOT, 'games.json');
const OVERRIDES_FILE = path.join(ROOT, 'release-overrides.json');
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const STATIC_FILES = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
]);
const rateBuckets = new Map();

function cleanText(value, max = 300) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export function isPartialIsoDate(value) {
  if (value === '') return true;
  if (typeof value !== 'string' || !/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(value)) return false;
  const [year, month = '01', day = '01'] = value.split('-').map(Number);
  if (year < 1970 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function inferPrecision(value) {
  if (!value) return 'unknown';
  return value.length === 4 ? 'year' : value.length === 7 ? 'month' : 'day';
}

function safeUrl(value) {
  const text = cleanText(value, 500);
  if (!text) return '';
  try {
    const url = new URL(text);
    return url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

export function normalizeGame(input = {}) {
  const steamAppId = /^\d+$/.test(String(input.steamAppId ?? '')) ? String(input.steamAppId) : '';
  const releaseDate = isPartialIsoDate(input.releaseDate) ? input.releaseDate : '';
  const expectedFullReleaseDate = isPartialIsoDate(input.expectedFullReleaseDate) ? input.expectedFullReleaseDate : '';
  const sources = Array.isArray(input.sources)
    ? [...new Set(input.sources.map(safeUrl).filter(Boolean))].slice(0, 12)
    : [];
  const status = cleanText(input.status, 50);
  const platform = cleanText(input.platform, 50) || (steamAppId ? 'Steam' : 'Другое');
  const id = cleanText(input.id, 100) || (steamAppId ? `steam:${steamAppId}` : randomUUID());

  return {
    id,
    steamAppId,
    title: cleanText(input.title, 240) || 'Без названия',
    releaseDate,
    releaseDatePrecision: ['day', 'month', 'year', 'unknown'].includes(input.releaseDatePrecision)
      ? input.releaseDatePrecision
      : inferPrecision(releaseDate),
    releaseDateSource: ['manual', 'override', 'wikidata', 'steam-fallback', 'legacy', 'imported'].includes(input.releaseDateSource)
      ? input.releaseDateSource
      : 'legacy',
    isEarlyAccess: Boolean(input.isEarlyAccess),
    expectedFullReleaseDate,
    expectedFullReleaseText: cleanText(input.expectedFullReleaseText, 400),
    platform,
    status,
    sourceUrl: safeUrl(input.sourceUrl),
    sources,
    addedAt: isPartialIsoDate(input.addedAt) && input.addedAt.length === 10
      ? input.addedAt
      : new Date().toISOString().slice(0, 10),
    playtimeForever: Number.isFinite(Number(input.playtimeForever)) ? Math.max(0, Math.round(Number(input.playtimeForever))) : 0,
    lastSyncedAt: typeof input.lastSyncedAt === 'string' ? input.lastSyncedAt : '',
  };
}

function normalizeLibrary(raw) {
  const list = Array.isArray(raw) ? raw : raw?.games;
  if (!Array.isArray(list)) throw new Error('Ожидался массив games');
  if (list.length > 10000) throw new Error('Слишком много записей');
  for (const item of list) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.title !== 'string' || !item.title.trim()) {
      throw new Error('Каждая запись должна быть объектом с непустым строковым title');
    }
  }
  return list.map(normalizeGame);
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function latestValidBackup() {
  try {
    const names = (await readdir(BACKUP_DIR)).filter(name => name.endsWith('.json')).sort().reverse();
    for (const name of names) {
      try {
        return normalizeLibrary(await readJson(path.join(BACKUP_DIR, name)));
      } catch {
        // Пробуем следующую резервную копию.
      }
    }
  } catch {
    // Папки резервных копий ещё нет.
  }
  return null;
}

async function initialLibrary() {
  return normalizeLibrary(await readJson(INITIAL_FILE));
}

async function loadLibrary() {
  await mkdir(BACKUP_DIR, { recursive: true });
  try {
    return normalizeLibrary(await readJson(LIBRARY_FILE));
  } catch (error) {
    const backup = await latestValidBackup();
    if (backup) return backup;
    const initial = await initialLibrary();
    if (error?.code !== 'ENOENT') console.error('Повреждено основное хранилище, загружен исходный список:', error.message);
    return initial;
  }
}

async function pruneBackups(limit = 10) {
  const names = (await readdir(BACKUP_DIR)).filter(name => name.endsWith('.json')).sort().reverse();
  await Promise.all(names.slice(limit).map(name => unlink(path.join(BACKUP_DIR, name)).catch(() => {})));
}

async function saveLibrary(games, { backup = true } = {}) {
  await mkdir(BACKUP_DIR, { recursive: true });
  if (backup) {
    try {
      await stat(LIBRARY_FILE);
      const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
      await copyFile(LIBRARY_FILE, path.join(BACKUP_DIR, `${stamp}.json`));
    } catch {
      // Первый запуск: резервировать пока нечего.
    }
  }
  const payload = JSON.stringify({ version: DATA_VERSION, updatedAt: new Date().toISOString(), games }, null, 2);
  const temp = `${LIBRARY_FILE}.${process.pid}.tmp`;
  await writeFile(temp, payload, 'utf8');
  await rename(temp, LIBRARY_FILE);
  await pruneBackups();
}

function secureEqual(actual, expected) {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function authorized(req) {
  const username = process.env.APP_USERNAME;
  const password = process.env.APP_PASSWORD;
  if (!username || !password) return false;
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) return false;
  try {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    if (separator < 0) return false;
    return secureEqual(decoded.slice(0, separator), username) && secureEqual(decoded.slice(separator + 1), password);
  } catch {
    return false;
  }
}

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://cdn.cloudflare.steamstatic.com https://avatars.akamai.steamstatic.com; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  res.setHeader('Cache-Control', 'no-store');
}

function json(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

async function readBody(req, maxBytes = 1_000_000) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw Object.assign(new Error('Тело запроса слишком велико'), { statusCode: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('Некорректный JSON'), { statusCode: 400 });
  }
}

function rateLimited(req, windowMs = 15 * 60_000, max = 180) {
  const now = Date.now();
  const key = `${req.socket.remoteAddress}:${Math.floor(now / windowMs)}`;
  const count = (rateBuckets.get(key) || 0) + 1;
  rateBuckets.set(key, count);
  if (rateBuckets.size > 5000) {
    for (const bucket of rateBuckets.keys()) if (!bucket.endsWith(String(Math.floor(now / windowMs)))) rateBuckets.delete(bucket);
  }
  return count > max;
}

function parseSteamDate(text) {
  const value = cleanText(text, 100);
  if (!value) return '';
  if (/^\d{4}$/.test(value)) return value;
  const parsed = new Date(`${value} UTC`);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}

async function steamFetch(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'GameLibrary/3.0' } });
    if (!response.ok) throw new Error(`Steam API: HTTP ${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchOwnedGames() {
  const key = process.env.STEAM_API_KEY;
  const steamId = process.env.STEAM_ID;
  if (!key || !steamId) throw Object.assign(new Error('На сервере не заданы STEAM_API_KEY и STEAM_ID'), { statusCode: 503 });
  const url = new URL('https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/');
  url.search = new URLSearchParams({
    key,
    steamid: steamId,
    include_appinfo: 'true',
    include_played_free_games: 'true',
    format: 'json',
  });
  const data = await steamFetch(url);
  if (!Array.isArray(data?.response?.games)) throw new Error('Steam не вернул список игр. Проверьте SteamID, API-ключ и видимость библиотеки.');
  return data.response.games;
}

async function mapLimit(items, limit, worker) {
  const result = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      result[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return result;
}

async function fetchSteamDetails(appIds) {
  const entries = await mapLimit(appIds, 5, async appId => {
    try {
      const data = await steamFetch(`https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(appId)}&l=english`);
      return [appId, data?.[appId]?.success ? data[appId].data : null];
    } catch (error) {
      console.warn(`Не удалось получить Steam metadata для ${appId}:`, error.message);
      return [appId, null];
    }
  });
  return Object.fromEntries(entries);
}

async function fetchWikidataDates(appIds) {
  const result = {};
  for (let offset = 0; offset < appIds.length; offset += 50) {
    const batch = appIds.slice(offset, offset + 50);
    const values = batch.map(id => `"${id}"`).join(' ');
    const query = `SELECT ?steamId (MIN(?date) AS ?releaseDate) WHERE { VALUES ?steamId { ${values} } ?item wdt:P1733 ?steamId; wdt:P577 ?date. } GROUP BY ?steamId`;
    try {
      const response = await fetch('https://query.wikidata.org/sparql', {
        method: 'POST',
        headers: {
          Accept: 'application/sparql-results+json',
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'User-Agent': 'GameLibrary/3.0 (personal library synchronizer)',
        },
        body: new URLSearchParams({ query }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      for (const row of data?.results?.bindings || []) {
        const id = row.steamId?.value;
        const date = row.releaseDate?.value?.slice(0, 10);
        if (id && isPartialIsoDate(date)) result[id] = date;
      }
    } catch (error) {
      console.warn('Wikidata недоступна, даты этого пакета останутся без обновления:', error.message);
    }
  }
  return result;
}

async function loadOverrides() {
  try {
    const raw = await readJson(OVERRIDES_FILE);
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

function steamGenresContainEarlyAccess(details) {
  return Array.isArray(details?.genres) && details.genres.some(genre => String(genre?.description).toLowerCase() === 'early access');
}

export function mergeSteamLibrary(current, owned, detailsById = {}, wikidataDates = {}, overrides = {}) {
  const existingByAppId = new Map(current.filter(game => game.steamAppId).map(game => [game.steamAppId, game]));
  const manualGames = current.filter(game => !game.steamAppId);
  const now = new Date().toISOString();

  const steamGames = owned.map(item => {
    const appId = String(item.appid);
    const previous = existingByAppId.get(appId) || {};
    const details = detailsById[appId] || {};
    const override = overrides[appId] || {};
    const overrideDate = isPartialIsoDate(override.releaseDate) ? override.releaseDate : '';
    const wikidataDate = isPartialIsoDate(wikidataDates[appId]) ? wikidataDates[appId] : '';
    const steamDate = parseSteamDate(details?.release_date?.date);
    const trustworthyPrevious = ['manual', 'override', 'wikidata'].includes(previous.releaseDateSource) ? previous.releaseDate : '';
    const releaseDate = overrideDate || wikidataDate || trustworthyPrevious || steamDate || previous.releaseDate || '';
    const releaseDateSource = overrideDate
      ? 'override'
      : wikidataDate
        ? 'wikidata'
        : trustworthyPrevious
          ? previous.releaseDateSource
          : steamDate
            ? 'steam-fallback'
            : previous.releaseDateSource || 'legacy';
    const isEarlyAccess = typeof override.isEarlyAccess === 'boolean'
      ? override.isEarlyAccess
      : steamGenresContainEarlyAccess(details) || Boolean(previous.isEarlyAccess);
    const expectedFullReleaseDate = isPartialIsoDate(override.expectedFullReleaseDate)
      ? override.expectedFullReleaseDate
      : previous.expectedFullReleaseDate || '';
    const expectedFullReleaseText = cleanText(override.expectedFullReleaseText, 400)
      || previous.expectedFullReleaseText
      || (isEarlyAccess && !expectedFullReleaseDate ? 'Дата полного релиза не объявлена' : '');

    return normalizeGame({
      ...previous,
      id: previous.id || `steam:${appId}`,
      steamAppId: appId,
      title: item.name || details?.name || previous.title,
      platform: 'Steam',
      releaseDate,
      releaseDatePrecision: inferPrecision(releaseDate),
      releaseDateSource,
      isEarlyAccess,
      expectedFullReleaseDate,
      expectedFullReleaseText,
      sourceUrl: `https://store.steampowered.com/app/${appId}/`,
      sources: [...(previous.sources || []), `https://store.steampowered.com/app/${appId}/`],
      playtimeForever: item.playtime_forever,
      lastSyncedAt: now,
    });
  });

  return [...steamGames, ...manualGames].sort((a, b) => a.title.localeCompare(b.title, 'ru', { sensitivity: 'base' }));
}

async function synchronize(games) {
  const owned = await fetchOwnedGames();
  const appIds = owned.map(game => String(game.appid));
  const [detailsById, wikidataDates, overrides] = await Promise.all([
    fetchSteamDetails(appIds),
    fetchWikidataDates(appIds),
    loadOverrides(),
  ]);
  const merged = mergeSteamLibrary(games, owned, detailsById, wikidataDates, overrides);
  const previousIds = new Set(games.filter(g => g.steamAppId).map(g => g.steamAppId));
  const nextIds = new Set(appIds);
  return {
    games: merged,
    added: appIds.filter(id => !previousIds.has(id)).length,
    removed: [...previousIds].filter(id => !nextIds.has(id)).length,
    totalSteam: appIds.length,
    wikidataDates: Object.keys(wikidataDates).length,
  };
}

function findGameIndex(games, id) {
  return games.findIndex(game => game.id === id);
}

async function apiHandler(req, res, url, state) {
  if (req.method === 'GET' && url.pathname === '/api/state') {
    return json(res, 200, { version: DATA_VERSION, updatedAt: state.updatedAt, games: state.games });
  }

  if (MUTATING_METHODS.has(req.method) && req.headers['x-game-library'] !== '1') {
    return json(res, 403, { error: 'Запрос отклонён защитой от CSRF' });
  }

  if (req.method === 'POST' && url.pathname === '/api/games') {
    const game = normalizeGame(await readBody(req));
    if (state.games.some(item => item.id === game.id)) game.id = randomUUID();
    state.games.unshift(game);
    await state.persist();
    return json(res, 201, game);
  }

  const gameMatch = url.pathname.match(/^\/api\/games\/([^/]+)$/);
  if (gameMatch && req.method === 'PUT') {
    const id = decodeURIComponent(gameMatch[1]);
    const index = findGameIndex(state.games, id);
    if (index < 0) return json(res, 404, { error: 'Игра не найдена' });
    const body = await readBody(req);
    state.games[index] = normalizeGame({ ...state.games[index], ...body, id });
    await state.persist();
    return json(res, 200, state.games[index]);
  }
  if (gameMatch && req.method === 'DELETE') {
    const id = decodeURIComponent(gameMatch[1]);
    const index = findGameIndex(state.games, id);
    if (index < 0) return json(res, 404, { error: 'Игра не найдена' });
    state.games.splice(index, 1);
    await state.persist();
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/import') {
    const body = await readBody(req);
    if (Number(body?.version || 1) > DATA_VERSION) return json(res, 400, { error: 'Файл создан более новой версией приложения' });
    const imported = normalizeLibrary(body);
    state.games = imported;
    await state.persist();
    return json(res, 200, { ok: true, count: state.games.length });
  }

  if (req.method === 'POST' && url.pathname === '/api/reset') {
    state.games = await initialLibrary();
    await state.persist();
    return json(res, 200, { ok: true, count: state.games.length });
  }

  if (req.method === 'POST' && url.pathname === '/api/sync') {
    if (rateLimited(req, 60 * 60_000, 5)) return json(res, 429, { error: 'Синхронизацию можно запускать не чаще пяти раз в час' });
    const result = await synchronize(state.games);
    state.games = result.games;
    await state.persist();
    return json(res, 200, result);
  }

  return json(res, 404, { error: 'Маршрут не найден' });
}

async function serveStatic(res, pathname) {
  const entry = STATIC_FILES.get(pathname);
  if (!entry) return false;
  const [filename, contentType] = entry;
  const file = path.join(ROOT, filename);
  res.statusCode = 200;
  res.setHeader('Content-Type', contentType);
  createReadStream(file).pipe(res);
  return true;
}

export async function startServer() {
  if (!process.env.APP_USERNAME || !process.env.APP_PASSWORD) {
    throw new Error('Задайте APP_USERNAME и APP_PASSWORD. Сервер не запускается без авторизации.');
  }
  const state = {
    games: await loadLibrary(),
    updatedAt: new Date().toISOString(),
    async persist() {
      await saveLibrary(this.games);
      this.updatedAt = new Date().toISOString();
    },
  };
  await saveLibrary(state.games, { backup: false });

  const server = createServer(async (req, res) => {
    setSecurityHeaders(res);
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/healthz') return json(res, 200, { ok: true });
    if (rateLimited(req)) return json(res, 429, { error: 'Слишком много запросов' });
    if (!authorized(req)) {
      res.statusCode = 401;
      res.setHeader('WWW-Authenticate', 'Basic realm="GameLibrary", charset="UTF-8"');
      return res.end('Требуется авторизация');
    }

    try {
      if (url.pathname.startsWith('/api/')) return await apiHandler(req, res, url, state);
      if (req.method === 'GET' && await serveStatic(res, url.pathname)) return;
      json(res, 404, { error: 'Страница не найдена' });
    } catch (error) {
      console.error(error);
      json(res, error.statusCode || 500, { error: error.statusCode ? error.message : 'Внутренняя ошибка сервера' });
    }
  });

  server.listen(PORT, HOST, () => console.log(`GameLibrary: http://${HOST}:${PORT}`));
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startServer().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
