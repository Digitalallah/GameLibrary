const DATA_VERSION = 3;
const PREF_KEY = 'gameLibraryPrefs.v3';
const LEGACY_DATA_KEY = 'gameLibraryData.v1';
const LEGACY_IMPORT_MARKER = 'gameLibraryLegacyImport.v3';
const DEFAULT_PREFS = {
  sort: 'title', dir: 'asc', view: 'table', theme: 'dark', q: '',
  earlyAccessOnly: false, unknown: false, decade: '', platform: '', statusTab: 'all',
};
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
let games = [];
let prefs = loadPrefs();

function loadPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
    const next = { ...DEFAULT_PREFS, ...(raw && typeof raw === 'object' ? raw : {}) };
    if (!['title', 'releaseDate', 'platform', 'status'].includes(next.sort)) next.sort = 'title';
    if (!['asc', 'desc'].includes(next.dir)) next.dir = 'asc';
    if (!['table', 'cards'].includes(next.view)) next.view = 'table';
    if (!['dark', 'light'].includes(next.theme)) next.theme = 'dark';
    return next;
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function savePrefs() {
  localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
  document.documentElement.dataset.theme = prefs.theme;
}

async function api(path, options = {}) {
  const headers = { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) };
  if (options.method && options.method !== 'GET') headers['X-Game-Library'] = '1';
  const response = await fetch(path, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

function node(tag, options = {}, children = []) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(options)) {
    if (key === 'className') element.className = value;
    else if (key === 'text') element.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') element.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value !== undefined && value !== null) element.setAttribute(key, String(value));
  }
  for (const child of [].concat(children)) {
    if (child instanceof Node) element.append(child);
    else if (child !== undefined && child !== null) element.append(document.createTextNode(String(child)));
  }
  return element;
}

function showNotice(message, type = 'ok') {
  const box = $('#notice');
  box.textContent = message;
  box.className = `notice ${type}`;
  clearTimeout(showNotice.timer);
  showNotice.timer = setTimeout(() => box.classList.add('hidden'), 7000);
}

function formatDate(value) {
  if (!value) return '—';
  if (/^\d{4}$/.test(value)) return value;
  if (/^\d{4}-\d{2}$/.test(value)) {
    const [year, month] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, 1));
    return new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'Некорректная дата';
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return 'Некорректная дата';
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function earlyAccessTooltip(game) {
  if (!game.isEarlyAccess) return '';
  if (game.expectedFullReleaseDate) return `Ожидаемый полный релиз: ${formatDate(game.expectedFullReleaseDate)}`;
  return game.expectedFullReleaseText || 'Дата полного релиза не объявлена';
}

function titleContent(game) {
  const fragment = document.createDocumentFragment();
  fragment.append(document.createTextNode(game.title));
  if (game.isEarlyAccess) {
    fragment.append(document.createTextNode(' '));
    fragment.append(node('span', {
      className: 'ea-badge', text: 'EA', tabindex: '0',
      'aria-label': `Ранний доступ. ${earlyAccessTooltip(game)}`,
      'data-tooltip': earlyAccessTooltip(game),
    }));
  }
  return fragment;
}

function isUnknown(game) {
  return !game.releaseDate;
}

function matchesStatus(game) {
  return prefs.statusTab === 'all' || (prefs.statusTab === 'empty' ? !game.status : game.status === prefs.statusTab);
}

function compareGames(a, b) {
  const av = String(a[prefs.sort] || '');
  const bv = String(b[prefs.sort] || '');
  if (!av && bv) return 1;
  if (av && !bv) return -1;
  const result = prefs.sort === 'title'
    ? av.localeCompare(bv, 'ru', { sensitivity: 'base' })
    : av.localeCompare(bv, 'ru');
  return prefs.dir === 'asc' ? result : -result;
}

function filteredGames() {
  const query = prefs.q.toLocaleLowerCase('ru');
  return games.filter(game =>
    (!query || game.title.toLocaleLowerCase('ru').includes(query))
    && (!prefs.earlyAccessOnly || game.isEarlyAccess)
    && (!prefs.unknown || isUnknown(game))
    && (!prefs.decade || (game.releaseDate && Math.floor(Number(game.releaseDate.slice(0, 4)) / 10) * 10 === Number(prefs.decade)))
    && (!prefs.platform || (prefs.platform === '__empty__' ? !game.platform : game.platform === prefs.platform))
    && matchesStatus(game)
  ).sort(compareGames);
}

function renderStats() {
  const stats = $('#stats');
  stats.textContent = '';
  const dated = games.filter(game => game.releaseDate).sort((a, b) => a.releaseDate.localeCompare(b.releaseDate));
  const values = [
    ['Всего', games.length],
    ['С датой', dated.length],
    ['Без даты', games.length - dated.length],
    ['В раннем доступе', games.filter(game => game.isEarlyAccess).length],
    ['Прошёл', games.filter(game => game.status === 'Прошёл').length],
    ['Дропнул', games.filter(game => game.status === 'Дропнул').length],
    ['Самая старая', dated[0]?.title || '—'],
    ['Самая новая', dated.at(-1)?.title || '—'],
  ];
  for (const [label, value] of values) {
    stats.append(node('div', {}, [node('span', { text: label }), node('strong', { text: value })]));
  }
}

function renderFilters() {
  $('#search').value = prefs.q;
  $('#earlyAccessOnly').checked = prefs.earlyAccessOnly;
  $('#unknown').checked = prefs.unknown;
  $('#themeBtn').textContent = prefs.theme === 'dark' ? 'Светлая тема' : 'Тёмная тема';
  $('#viewBtn').textContent = prefs.view === 'table' ? 'Карточки' : 'Таблица';

  const decades = [...new Set(games.map(game => game.releaseDate?.slice(0, 4)).filter(Boolean).map(year => Math.floor(Number(year) / 10) * 10))].sort((a, b) => a - b);
  const decade = $('#decade');
  decade.textContent = '';
  decade.append(node('option', { value: '', text: 'Все десятилетия' }));
  for (const value of decades) decade.append(node('option', { value, text: `${value}-е годы` }));
  decade.value = prefs.decade;

  const platforms = [...new Set(games.map(game => game.platform).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
  const platform = $('#platformFilter');
  platform.textContent = '';
  platform.append(node('option', { value: '', text: 'Все платформы' }), node('option', { value: '__empty__', text: 'Платформа не указана' }));
  for (const value of platforms) platform.append(node('option', { value, text: value }));
  platform.value = prefs.platform;
}

function renderStatusTabs() {
  const counts = {
    all: games.length,
    empty: games.filter(game => !game.status).length,
    'Прошёл': games.filter(game => game.status === 'Прошёл').length,
    'Дропнул': games.filter(game => game.status === 'Дропнул').length,
  };
  const tabs = $('#statusTabs');
  tabs.textContent = '';
  for (const item of [
    ['all', 'Все'], ['empty', 'Без статуса'], ['Прошёл', 'Прошёл'], ['Дропнул', 'Дропнул'],
  ]) {
    tabs.append(node('button', {
      className: `status-tab${prefs.statusTab === item[0] ? ' active' : ''}`,
      text: `${item[1]} ${counts[item[0]]}`,
      type: 'button',
      'aria-pressed': prefs.statusTab === item[0],
      onclick: () => { prefs.statusTab = item[0]; render(); },
    }));
  }
}

function makeSelect(game, field, defaults) {
  const select = node('select', { className: 'inline-select', 'aria-label': field === 'platform' ? 'Платформа' : 'Статус' });
  const values = [...new Set(['', ...defaults, game[field] || ''])];
  for (const value of values) select.append(node('option', { value, text: value || (field === 'platform' ? 'не указана' : 'без статуса') }));
  select.value = game[field] || '';
  select.addEventListener('change', async () => {
    try {
      const updated = await api(`/api/games/${encodeURIComponent(game.id)}`, { method: 'PUT', body: JSON.stringify({ [field]: select.value }) });
      games = games.map(item => item.id === game.id ? updated : item);
      render();
    } catch (error) {
      showNotice(error.message, 'error');
      render();
    }
  });
  return select;
}

function actions(game) {
  return node('div', { className: 'row-actions' }, [
    node('button', { text: 'Изменить', type: 'button', onclick: () => openForm(game) }),
    node('button', { text: 'Удалить', type: 'button', className: 'danger-quiet', onclick: () => removeGame(game) }),
  ]);
}

function renderTable(rows) {
  const body = $('#gamesTable tbody');
  body.textContent = '';
  for (const game of rows) {
    const tr = node('tr', { className: `platform-${platformSlug(game.platform)}` });
    const title = node('td'); title.append(titleContent(game));
    const date = node('td', { text: formatDate(game.releaseDate) });
    if (game.releaseDateSource === 'steam-fallback') date.append(node('span', { className: 'uncertain', text: 'нужна проверка', title: 'Wikidata не вернула дату; временно используется дата Steam' }));
    tr.append(
      title,
      date,
      node('td', {}, makeSelect(game, 'platform', ['Steam', 'Epic', 'GOG', 'PS', 'Пиратка', 'Другое'])),
      node('td', {}, makeSelect(game, 'status', ['Прошёл', 'Дропнул'])),
      node('td', {}, actions(game)),
    );
    body.append(tr);
  }
}

function renderCards(rows) {
  const cards = $('#cards');
  cards.textContent = '';
  for (const game of rows) {
    const heading = node('h2'); heading.append(titleContent(game));
    cards.append(node('article', { className: `card platform-${platformSlug(game.platform)}` }, [
      heading,
      node('p', { text: `Реальный выход: ${formatDate(game.releaseDate)}` }),
      node('label', { className: 'card-field' }, [node('span', { text: 'Платформа' }), makeSelect(game, 'platform', ['Steam', 'Epic', 'GOG', 'PS', 'Пиратка', 'Другое'])]),
      node('label', { className: 'card-field' }, [node('span', { text: 'Статус' }), makeSelect(game, 'status', ['Прошёл', 'Дропнул'])]),
      actions(game),
    ]));
  }
}

function platformSlug(value) {
  return ({ Steam: 'steam', Epic: 'epic', GOG: 'gog', PS: 'ps', 'Пиратка': 'pirate', 'Другое': 'other' })[value] || 'empty';
}

function renderSort() {
  $$('.sort-button').forEach(button => {
    const active = button.dataset.sort === prefs.sort;
    const base = { title: 'Название', releaseDate: 'Реальный выход', platform: 'Платформа', status: 'Статус' }[button.dataset.sort];
    button.textContent = `${base}${active ? (prefs.dir === 'asc' ? ' ▲' : ' ▼') : ''}`;
    button.closest('th').setAttribute('aria-sort', active ? (prefs.dir === 'asc' ? 'ascending' : 'descending') : 'none');
  });
}

function render() {
  savePrefs();
  renderFilters();
  renderStatusTabs();
  renderStats();
  renderSort();
  const rows = filteredGames();
  $('#counter').textContent = `Найдено ${rows.length} из ${games.length} игр`;
  const cardMode = prefs.view === 'cards';
  $('.table-wrap').classList.toggle('hidden', cardMode);
  $('#cards').classList.toggle('hidden', !cardMode);
  if (cardMode) renderCards(rows); else renderTable(rows);
}

function openForm(game = null) {
  $('#gameForm').reset();
  $('#editId').value = game?.id || '';
  $('#formTitle').textContent = game ? 'Редактировать игру' : 'Добавить игру';
  $('#titleInput').value = game?.title || '';
  $('#releaseInput').value = game?.releaseDate?.length === 10 ? game.releaseDate : '';
  $('#releaseSource').value = ['manual', 'wikidata', 'steam-fallback', 'legacy'].includes(game?.releaseDateSource) ? game.releaseDateSource : 'manual';
  $('#earlyAccessInput').checked = Boolean(game?.isEarlyAccess);
  $('#expectedReleaseInput').value = game?.expectedFullReleaseDate?.length === 10 ? game.expectedFullReleaseDate : '';
  $('#platformInput').value = game?.platform || '';
  $('#statusInput').value = game?.status || '';
  $('#sourceInput').value = game?.sourceUrl || '';
  $('#editor').showModal();
}

async function saveForm(event) {
  event.preventDefault();
  const id = $('#editId').value;
  const payload = {
    title: $('#titleInput').value,
    releaseDate: $('#releaseInput').value,
    releaseDatePrecision: $('#releaseInput').value ? 'day' : 'unknown',
    releaseDateSource: $('#releaseSource').value,
    isEarlyAccess: $('#earlyAccessInput').checked,
    expectedFullReleaseDate: $('#expectedReleaseInput').value,
    expectedFullReleaseText: $('#earlyAccessInput').checked && !$('#expectedReleaseInput').value ? 'Дата полного релиза не объявлена' : '',
    platform: $('#platformInput').value,
    status: $('#statusInput').value,
    sourceUrl: $('#sourceInput').value,
  };
  try {
    const saved = id
      ? await api(`/api/games/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(payload) })
      : await api('/api/games', { method: 'POST', body: JSON.stringify(payload) });
    games = id ? games.map(game => game.id === id ? saved : game) : [saved, ...games];
    $('#editor').close();
    render();
  } catch (error) {
    showNotice(error.message, 'error');
  }
}

async function removeGame(game) {
  if (!confirm(`Удалить «${game.title}»?`)) return;
  try {
    await api(`/api/games/${encodeURIComponent(game.id)}`, { method: 'DELETE' });
    games = games.filter(item => item.id !== game.id);
    render();
  } catch (error) {
    showNotice(error.message, 'error');
  }
}

function download(filename, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = node('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

async function syncSteam() {
  const button = $('#syncBtn');
  button.disabled = true;
  button.textContent = 'Синхронизация…';
  try {
    const result = await api('/api/sync', { method: 'POST', body: '{}' });
    games = result.games;
    render();
    showNotice(`Steam синхронизирован: ${result.totalSteam} игр, добавлено ${result.added}, удалено ${result.removed}. Реальные даты найдены через Wikidata для ${result.wikidataDates} игр.`);
  } catch (error) {
    showNotice(error.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Синхронизировать Steam';
  }
}

async function importJson(event) {
  const input = event.currentTarget;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (!confirm('Импорт полностью заменит текущую библиотеку. Продолжить?')) return;
    await api('/api/import', { method: 'POST', body: JSON.stringify(parsed) });
    games = (await api('/api/state')).games;
    render();
    showNotice(`Импортировано ${games.length} игр.`);
  } catch (error) {
    showNotice(error.message || 'JSON повреждён', 'error');
  } finally {
    input.value = '';
  }
}

function bindEvents() {
  $$('.sort-button').forEach(button => button.addEventListener('click', () => {
    prefs.dir = prefs.sort === button.dataset.sort && prefs.dir === 'asc' ? 'desc' : 'asc';
    prefs.sort = button.dataset.sort;
    render();
  }));
  const map = { search: 'q', earlyAccessOnly: 'earlyAccessOnly', unknown: 'unknown', decade: 'decade', platformFilter: 'platform' };
  for (const id of Object.keys(map)) $(`#${id}`).addEventListener('input', event => {
    prefs[map[id]] = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    render();
  });
  $('#resetFilters').addEventListener('click', () => { Object.assign(prefs, { q: '', earlyAccessOnly: false, unknown: false, decade: '', platform: '', statusTab: 'all' }); render(); });
  $('#themeBtn').addEventListener('click', () => { prefs.theme = prefs.theme === 'dark' ? 'light' : 'dark'; render(); });
  $('#viewBtn').addEventListener('click', () => { prefs.view = prefs.view === 'table' ? 'cards' : 'table'; render(); });
  $('#randomBtn').addEventListener('click', () => {
    const rows = filteredGames();
    const box = $('#randomBox');
    box.classList.remove('hidden');
    box.textContent = rows.length ? `Случайная игра: ${rows[Math.floor(Math.random() * rows.length)].title}` : 'По текущим фильтрам игр нет.';
  });
  $('#syncBtn').addEventListener('click', syncSteam);
  $('#addBtn').addEventListener('click', () => openForm());
  $('#cancelBtn').addEventListener('click', () => $('#editor').close());
  $('#gameForm').addEventListener('submit', saveForm);
  $('#exportJson').addEventListener('click', () => download('game-library.json', JSON.stringify({ version: DATA_VERSION, games }, null, 2), 'application/json'));
  $('#exportCsv').addEventListener('click', () => {
    const header = ['Название', 'Реальный выход', 'Ранний доступ', 'Ожидаемый полный релиз', 'Платформа', 'Статус'];
    const rows = filteredGames().map(game => [game.title, game.releaseDate, game.isEarlyAccess ? 'да' : 'нет', game.expectedFullReleaseDate, game.platform, game.status]);
    download('game-library.csv', '\uFEFF' + [header, ...rows].map(row => row.map(csvCell).join(',')).join('\n'), 'text/csv;charset=utf-8');
  });
  $('#importJson').addEventListener('change', importJson);
  $('#restoreBtn').addEventListener('click', async () => {
    if (!confirm('Заменить данные исходным списком? Перед заменой сервер создаст резервную копию.')) return;
    try {
      await api('/api/reset', { method: 'POST', body: '{}' });
      games = (await api('/api/state')).games;
      render();
      showNotice('Исходный список восстановлен.');
    } catch (error) {
      showNotice(error.message, 'error');
    }
  });
}

async function migrateLegacyLocalData() {
  if (localStorage.getItem(LEGACY_IMPORT_MARKER)) return false;
  const stored = localStorage.getItem(LEGACY_DATA_KEY);
  if (!stored) {
    localStorage.setItem(LEGACY_IMPORT_MARKER, 'none');
    return false;
  }
  try {
    const raw = JSON.parse(stored);
    const legacyGames = Array.isArray(raw) ? raw : raw?.games;
    if (!Array.isArray(legacyGames) || !legacyGames.length) throw new Error();
    const transfer = confirm(`Найдены локальные данные старой версии: ${legacyGames.length} игр. Перенести их на сервер, сохранив статусы и правки?`);
    if (!transfer) {
      localStorage.setItem(LEGACY_IMPORT_MARKER, 'declined');
      return false;
    }
    await api('/api/import', { method: 'POST', body: JSON.stringify({ version: 2, games: legacyGames }) });
    localStorage.setItem(LEGACY_IMPORT_MARKER, 'imported');
    showNotice('Локальные данные старой версии перенесены на сервер.');
    return true;
  } catch {
    localStorage.setItem(LEGACY_IMPORT_MARKER, 'invalid');
    showNotice('Старое локальное хранилище повреждено и не было импортировано.', 'error');
    return false;
  }
}

async function initialize() {
  bindEvents();
  try {
    await migrateLegacyLocalData();
    games = (await api('/api/state')).games;
    render();
  } catch (error) {
    $('#counter').textContent = 'Не удалось загрузить библиотеку';
    showNotice(error.message, 'error');
  }
}

initialize();
