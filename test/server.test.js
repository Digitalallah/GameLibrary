import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isPartialIsoDate,
  normalizeGame,
  applyVerifiedReleaseDates,
  mergeSteamLibrary,
  normalizeIgnoredSteamAppIds,
} from '../server.js';

test('invalid dates are rejected without crashing', () => {
  assert.equal(isPartialIsoDate('2026-02-30'), false);
  assert.equal(isPartialIsoDate('2026-02-28'), true);
  assert.equal(normalizeGame({ title: 'X', releaseDate: 'nope' }).releaseDate, '');
});

test('custom statuses survive normalization', () => {
  assert.equal(normalizeGame({ title: 'X', status: 'Отложил' }).status, 'Отложил');
});

test('Fallout 2 legacy Steam date is replaced by the original release', () => {
  const [game] = applyVerifiedReleaseDates([
    normalizeGame({
      title: 'Fallout 2',
      steamAppId: '38410',
      releaseDate: '2009-08-19',
      releaseDateSource: 'legacy',
    }),
  ], { '38410': '1998-10-29' });

  assert.equal(game.releaseDate, '1998-10-29');
  assert.equal(game.releaseDateSource, 'wikidata');
});

test('Steam store date is never used as the release date', () => {
  const [game] = mergeSteamLibrary(
    [],
    [{ appid: 38410, name: 'Fallout 2', playtime_forever: 10 }],
    { '38410': { release_date: { date: '19 Aug, 2009' }, genres: [] } },
    {},
    {},
  );

  assert.equal(game.releaseDate, '');
  assert.equal(game.releaseDateSource, 'unknown');
});

test('manual date has priority over Wikidata and repository overrides', () => {
  const [game] = applyVerifiedReleaseDates([
    normalizeGame({
      title: 'X',
      steamAppId: '1',
      releaseDate: '2001-02-03',
      releaseDateSource: 'manual',
    }),
  ], { '1': '2002-03-04' }, { '1': { releaseDate: '2003-04-05' } });

  assert.equal(game.releaseDate, '2001-02-03');
  assert.equal(game.releaseDateSource, 'manual');
});

test('unverified dates are cleared when no trustworthy source exists', () => {
  const [game] = applyVerifiedReleaseDates([
    normalizeGame({
      title: 'X',
      steamAppId: '1',
      releaseDate: '2010-01-01',
      releaseDateSource: 'steam-fallback',
    }),
  ]);

  assert.equal(game.releaseDate, '');
  assert.equal(game.releaseDateSource, 'unknown');
});

test('manual games remain after Steam synchronization', () => {
  const merged = mergeSteamLibrary(
    [normalizeGame({ id: 'manual', title: 'Manual', platform: 'GOG' })],
    [{ appid: 1, name: 'Steam game' }],
    {}, {}, {},
  );
  assert.deepEqual(merged.map(game => game.title).sort(), ['Manual', 'Steam game']);
});

test('deleted Steam games stay excluded from later synchronization', () => {
  const merged = mergeSteamLibrary(
    [normalizeGame({ id: 'manual', title: 'Manual', platform: 'GOG' })],
    [
      { appid: 1, name: 'Deleted Steam game' },
      { appid: 2, name: 'Kept Steam game' },
    ],
    {}, {}, {}, ['1'],
  );

  assert.deepEqual(merged.map(game => game.title).sort(), ['Kept Steam game', 'Manual']);
});

test('ignored Steam ids are normalized and deduplicated', () => {
  assert.deepEqual(normalizeIgnoredSteamAppIds(['1', 1, 'bad', '2']), ['1', '2']);
});
