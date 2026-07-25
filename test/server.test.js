import test from 'node:test';
import assert from 'node:assert/strict';
import { isPartialIsoDate, normalizeGame, mergeSteamLibrary } from '../server.js';

test('invalid dates are rejected without crashing', () => {
  assert.equal(isPartialIsoDate('2026-02-30'), false);
  assert.equal(isPartialIsoDate('2026-02-28'), true);
  assert.equal(normalizeGame({ title: 'X', releaseDate: 'nope' }).releaseDate, '');
});

test('custom statuses survive normalization', () => {
  assert.equal(normalizeGame({ title: 'X', status: 'Отложил' }).status, 'Отложил');
});

test('Wikidata date has priority over Steam date', () => {
  const merged = mergeSteamLibrary(
    [],
    [{ appid: 220, name: 'Half-Life 2', playtime_forever: 10 }],
    { '220': { release_date: { date: '1 Jan, 2020' }, genres: [] } },
    { '220': '2004-11-16' },
    {},
  );
  assert.equal(merged[0].releaseDate, '2004-11-16');
  assert.equal(merged[0].releaseDateSource, 'wikidata');
});

test('manual games remain after Steam synchronization', () => {
  const merged = mergeSteamLibrary(
    [normalizeGame({ id: 'manual', title: 'Manual', platform: 'GOG' })],
    [{ appid: 1, name: 'Steam game' }],
    {}, {}, {},
  );
  assert.deepEqual(merged.map(game => game.title).sort(), ['Manual', 'Steam game']);
});
