import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { buildBroadcast, clockLabel, downLabel, isHighlight, spotLabel, summarize } from '../src/lib/broadcast.mjs';
import { buildSeason, playWeek, bestLineup } from '../src/lib/gauntletEngine.mjs';

const p = (id, name, position) => ({ player_id: id, name, position });
const plays = {
  season: 2030,
  games: { g1: 'CIN@BAL', g2: 'KC@DEN' },
  weeks: {
    1: {
      10: [[1, 600, 'g1', 'Burrow 41-yd TD pass to Chase', 9.64, 'g1:55', ['CIN', 41, 41, 'P', 30, 1, 10, 1, 0]], [3, 100, 'g1', '120 passing yds', 4.8, 'g1:pass:3:10', null]],
      11: [[1, 600, 'g1', 'Chase 41-yd TD catch from Burrow', 12.1, 'g1:55', ['CIN', 41, 41, 'P', 30, 1, 10, 1, 0]], [2, 30, 'g1', '3 catches, 22 yds', 5.2, 'g1:rec:2:11', null]],
      20: [[1, 800, 'g2', 'Henry 12-yd TD run', 7.2, 'g2:9', ['KC', 12, 12, 'R', null, 2, 5, 1, 0]]],
      '-16004': [[4, 200, 'g1', 'Bengals sack', 1, 'g1:90', ['BAL', 60, -7, 'S', null, 3, 8, 0, 0]], [4, 100, 'g1', 'Bengals sack', 1, 'g1:95', ['BAL', 70, -5, 'S', null, 2, 6, 0, 0]]],
    },
  },
};
const qb = p(10, 'Joe Burrow', 'QB');
const wr = p(11, "Ja'Marr Chase", 'WR');
const rb = p(20, 'Derrick Henry', 'RB');
const dst = p(-16004, 'Bengals D/ST', 'D/ST');
const k = p(30, 'Some Kicker', 'K');

test('a broadcast merges both teams by quarter and clock, combining one side\'s shared play', () => {
  const b = buildBroadcast(plays, 1,
    [{ player: qb, points: 16 }, { player: wr, points: 18 }, { player: dst, points: 5 }, { player: k, points: 7 }],
    [{ player: rb, points: 7.2 }],
    { you: 46, champ: 7.2 });
  const order = b.events.map((e) => `${e.side}:${clockLabel(e.qtr, e.clock)}:${e.text}`);
  // Touchdowns are highlights with field data; routine plays fold per player per half,
  // and the two Bengals sacks in the second half fold into one line.
  assert.deepEqual(order.slice(0, 5), [
    'champ:Q1 13:20:Henry 12-yd TD run',
    "you:Q1 10:00:Chase 41-yd TD catch from Burrow",
    "you:Q2 0:30:Chase · 3 catches, 22 yds",
    'you:Q3 1:40:Burrow · 120 passing yds',
    'you:Q4 1:40:Bengals · 2 sacks',
  ]);
  const td = b.events[1];
  assert.equal(td.pts, 21.74);
  assert.equal(td.players.length, 2);
  assert.ok(td.touchdown && td.highlight);
  assert.deepEqual(td.field, ['CIN', 41, 41, 'P', 30, 1, 10, 1, 0]);
  assert.equal(b.events[4].pts, 2);
  assert.equal(b.events[4].field, null);
  // Final lines carry each player's leftover so totals are exact.
  const finals = b.events.filter((e) => e.qtr === 6).map((e) => [e.text, e.pts]);
  assert.deepEqual(finals, [
    ['Joe Burrow: yardage bonus', 1.56],
    ["Ja'Marr Chase: yardage bonus", 0.7],
    ['Bengals D/ST: points and yards allowed', 3],
    ['Some Kicker: stat line', 7],
  ]);
  assert.deepEqual(b.final, { you: 46, champ: 7.2 });
  assert.deepEqual(b.events[b.events.length - 1].score, { you: 46, champ: 7.2 });
  assert.equal(b.quarters.you[0], 21.74);
  assert.equal(b.quarters.champ[0], 7.2);
});

test('small leftovers fold into one closing adjustment per side', () => {
  const b = buildBroadcast(plays, 1, [{ player: rb, points: 7.4 }], [], { you: 7.4, champ: 0 });
  assert.deepEqual(b.events.map((e) => [e.text, e.pts]), [['Henry 12-yd TD run', 7.2], ['Scoring adjustments', 0.2]]);
});

test('highlights: scores, turnovers, kicks and long gains; field labels read like TV', () => {
  assert.equal(isHighlight(['CIN', 41, 41, 'P', 30, 1, 10, 1, 0]), true);
  assert.equal(isHighlight(['CIN', 60, 26, 'R', null, 1, 10, 0, 0]), true);
  assert.equal(isHighlight(['CIN', 60, 12, 'P', 8, 1, 10, 0, 0]), false);
  assert.equal(isHighlight(['CIN', 30, 0, 'G', null, 4, 5, 0, 0]), true);
  assert.equal(isHighlight(['BAL', 60, -7, 'S', null, 3, 8, 0, 0]), false);
  assert.equal(isHighlight(null), false);
  assert.equal(spotLabel('BAL', 'PIT', 67), 'BAL 33');
  assert.equal(spotLabel('BAL', 'PIT', 12), 'PIT 12');
  assert.equal(downLabel(3, 2, 67), '3rd & 2');
  assert.equal(downLabel(1, 5, 5), '1st & Goal');
});

test('folded plays read as one stat line', () => {
  assert.equal(summarize(['3 carries, 8 yds', '1 catch, 2 yds', '2 carries, 8 yds', 'Jones 22-yd catch from Rodgers']), '5 carries, 16 yds · 2 catches, 24 yds');
  assert.equal(summarize(['61 passing yds', 'Jackson 21-yd completion to Andrews', '2 carries, 14 yds']), '82 passing yds · 2 carries, 14 yds');
  assert.equal(summarize(['Tucker extra point', 'Tucker extra point', 'Tucker extra point missed']), '2 PATs · missed PAT');
  assert.equal(summarize(['88 passing yds', 'Wilson 10-yd TD pass to Carson'], 'Wilson'), '88 passing yds · 10-yd TD pass to Carson');
});

test('no plays file means no broadcast; labels read like a game clock', () => {
  assert.equal(buildBroadcast(null, 1, [], [], { you: 0, champ: 0 }), null);
  assert.equal(clockLabel(2, 475), 'Q2 7:55');
  assert.equal(clockLabel(5, 190), 'OT 3:10');
  assert.equal(clockLabel(6, 0), 'Final');
});

const dataDir = new URL('../../data/', import.meta.url);
test('real weeks: every broadcast ends exactly on the real scores', { skip: !existsSync(new URL('plays/2023.json', dataDir)) }, () => {
  const read = (f) => JSON.parse(readFileSync(new URL(f, dataDir), 'utf8'));
  const seasons = read('seasons.json').filter((s) => !s.is_current && s.champion);
  const players = read('players.json');
  const teamWeeks = read('team_weeks.json');
  for (const s of seasons) {
    if (!existsSync(new URL(`plays/${s.season}.json`, dataDir))) continue;
    const pf = read(`plays/${s.season}.json`);
    const b = buildSeason({ season: s.season, regularSeasonWeeks: s.regular_season_weeks, rows: read(`rosters/${s.season}.json`), players, teamWeeks, championOwnerId: s.champion.owner_id });
    const roster = [...b.pools.values()].flat().slice(0, 60);
    for (const w of b.weeks) {
      const lineup = bestLineup(b, roster, w, 'projected');
      const res = playWeek(b, w, lineup);
      const champ = b.championLineups[w];
      const bc = buildBroadcast(pf, w, res.rows.map((r) => ({ player: r.player, points: r.points })), champ, { you: res.you, champ: res.champ });
      assert.equal(bc.final.you, res.you, `${s.season} w${w} you`);
      assert.equal(bc.final.champ, res.champ, `${s.season} w${w} champ`);
      // Most of the score comes from real plays, not the closing adjustment lines.
      const fromPlays = bc.events.filter((e) => e.qtr <= 5 && e.side === 'champ').reduce((t, e) => t + e.pts, 0);
      assert.ok(fromPlays > res.champ * 0.6, `${s.season} w${w}: only ${fromPlays} of ${res.champ} from plays`);
      for (let i = 1; i < bc.events.length; i++) {
        const a = bc.events[i - 1];
        const c = bc.events[i];
        assert.ok(a.qtr < c.qtr || (a.qtr === c.qtr && a.clock >= c.clock), `${s.season} w${w} out of order`);
      }
    }
  }
});
