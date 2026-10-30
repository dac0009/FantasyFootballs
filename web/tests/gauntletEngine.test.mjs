import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import {
  autoplay, bestLineup, buildSeason, checkLineup, claimProblem, defenseTeam, rosterProblem, dailySeason, dayNumber, nextUsableSpin, optimalPoints, outlook,
  playWeek, shareText, slotsFor, spinOptions, spinOrder, summarize, waiverOptions,
} from '../src/lib/gauntletEngine.mjs';

// A tiny three-team, two-week league. Team 1 is the champion.
const players = [
  [1, 'Champ QB', 'QB'], [2, 'Champ RB', 'RB'],
  [10, 'QB Ten', 'QB'], [11, 'RB Eleven', 'RB'], [12, 'RB Twelve', 'RB'], [13, 'WR Thirteen', 'WR'],
  [14, 'WR Fourteen', 'WR'], [15, 'TE Fifteen', 'TE'], [16, 'Def Sixteen', 'D/ST'], [17, 'K Seventeen', 'K'],
  [20, 'TE Twenty', 'TE'], [21, 'WR Twentyone', 'WR'], [22, 'Traded RB', 'RB'],
].map(([player_id, name, position]) => ({ player_id, name, position, nfl_team: null }));

const row = (week, team_id, player_id, slot, points, started = true) =>
  ({ season: 2030, week, team_id, owner_id: null, player_id, lineup_slot_id: 0, lineup_slot: slot, started, points, projected: 10 });

const rows = [];
for (const w of [1, 2]) {
  rows.push(row(w, 1, 1, 'QB', 20), row(w, 1, 2, 'RB', 15));
  rows.push(row(w, 2, 10, 'QB', 18), row(w, 2, 11, 'RB', 12), row(w, 2, 12, 'RB', 9), row(w, 2, 13, 'WR', 11), row(w, 2, 16, 'D/ST', 6));
  rows.push(row(w, 3, 14, 'WR', 10), row(w, 3, 15, 'TE', 7), row(w, 3, 17, 'K', 8), row(w, 3, 20, 'FLEX', 3), row(w, 3, 21, 'WR', 5));
}
// Player 22 was on the champion in week 1, then traded to team 2: never draftable.
rows.push(row(1, 1, 22, 'BE', 4, false), row(2, 2, 22, 'BE', 30, false));
// Player 13 has no row in week 2 (dropped and missing data).
rows.splice(rows.findIndex((r) => r.week === 2 && r.player_id === 13), 1);

const tw = (week, team_id, owner_id, team_name, score, result) =>
  ({ season: 2030, week, matchup_id: 'x', game_type: 'regular', team_id, owner_id, team_name, score, opponent_team_id: 0,
    opponent_owner_id: '', opponent_team_name: '', opponent_score: 0, differential: 0, result, is_home: true });
const teamWeeks = [
  tw(1, 1, 'champ', 'Champs', 100, 'W'), tw(1, 2, 'two', 'Twos', 90, 'L'), tw(1, 3, 'three', 'Threes', 80, 'L'),
  tw(2, 1, 'champ', 'Champs', 70, 'L'), tw(2, 2, 'two', 'Twos Renamed', 95, 'W'), tw(2, 3, 'three', 'Threes', 60, 'L'),
  tw(15, 1, 'champ', 'Champs', 200, 'W'), // playoffs: ignored
  { ...tw(1, 1, 'champ', 'Champs', 999, 'W'), season: 2029 }, // other season: ignored
];

const board = () => buildSeason({
  season: 2030, regularSeasonWeeks: 2, rows, players, teamWeeks,
  draft: [{ season: 2030, player_id: 10, round: 1 }], championOwnerId: 'champ',
});

test('the champion and everyone he ever rostered are off the board', () => {
  const b = board();
  assert.equal(b.champion.team_id, 1);
  assert.deepEqual(b.spinTeams, [2, 3]);
  const all = [...b.pools.values()].flat().map((p) => p.player_id);
  for (const id of [1, 2, 22]) assert.ok(!all.includes(id), `player ${id} should be excluded`);
  assert.equal(b.teams.get(2).name, 'Twos Renamed');
  assert.deepEqual(b.weeks, [1, 2]);
  assert.equal(b.pools.get(2).find((p) => p.player_id === 10).draft_round, 1);
});

test('player lists never leak results: ordered by position, then draft round', () => {
  const names = board().pools.get(2).map((p) => p.name);
  assert.deepEqual(names, ['QB Ten', 'RB Eleven', 'RB Twelve', 'WR Thirteen', 'Def Sixteen']);
});

test('draft spots: his position, then FLEX, then the bench spot for his position only', () => {
  const b = board();
  assert.deepEqual(b.draftKeys.map((k) => k.key).slice(-5), ['BN-QB', 'BN-RB', 'BN-WR', 'BN-TE', 'BN-D/ST']);
  assert.equal(b.draftKeys.length, 14);
  const rb = b.pools.get(2).find((p) => p.player_id === 11);
  assert.deepEqual(slotsFor(rb, b.draftKeys, {}).map((k) => k.key), ['RB-1', 'RB-2', 'FLEX-1', 'BN-RB']);
  const picks = { 'RB-1': rb, 'RB-2': b.pools.get(2).find((p) => p.player_id === 12) };
  assert.deepEqual(slotsFor({ position: 'RB' }, b.keys, picks).map((k) => k.key), ['FLEX-1']);
  assert.deepEqual(slotsFor({ position: 'K' }, b.draftKeys, { 'K-1': rb }).map((k) => k.key), []);
  assert.deepEqual(slotsFor({ position: 'D/ST' }, b.draftKeys, {}).map((k) => k.key), ['D/ST-1', 'BN-D/ST']);
});

test('roster rule: always a backup at QB, RB, WR, TE and D/ST', () => {
  const mk = (id, position) => ({ player_id: id, position });
  const full = [
    mk(1, 'QB'), mk(2, 'QB'), mk(3, 'RB'), mk(4, 'RB'), mk(5, 'RB'), mk(6, 'WR'), mk(7, 'WR'), mk(8, 'WR'),
    mk(9, 'TE'), mk(10, 'TE'), mk(11, 'RB'), mk(12, 'D/ST'), mk(13, 'D/ST'), mk(14, 'K'),
  ];
  assert.equal(rosterProblem(full), null);
  assert.match(claimProblem(full, mk(20, 'RB'), full[1]), /2 QBs/);
  assert.equal(claimProblem(full, mk(20, 'QB'), full[1]), null);
  assert.match(claimProblem(full, mk(20, 'K'), full[12]), /2 defenses/);
  assert.equal(claimProblem(full, mk(20, 'WR'), full[10]), null); // RB 4 -> 3 still fine
  assert.match(claimProblem(full, mk(20, 'QB'), full[13]), /1 kicker/);
  assert.equal(defenseTeam(-16017), 'NE');
  assert.equal(defenseTeam(15847), null);
});

test('spins skip teams with nobody usable, and drafted players disappear', () => {
  const b = board();
  const team3 = b.pools.get(3);
  const picks = {
    'WR-1': team3.find((p) => p.player_id === 14), 'WR-2': team3.find((p) => p.player_id === 21),
    'TE-1': team3.find((p) => p.player_id === 15), 'K-1': team3.find((p) => p.player_id === 17),
    'FLEX-1': team3.find((p) => p.player_id === 20),
  };
  assert.equal(spinOptions(b, 3, b.keys, picks).length, 0);
  assert.equal(nextUsableSpin(b, [3, 3, 2], 0, b.keys, picks), 2);
  assert.equal(nextUsableSpin(b, [3], 0, b.keys, picks), -1);
});

const all = (b) => new Map([...b.pools.values()].flat().map((p) => [p.player_id, p]));

test('outlook: projection before kickoff, out on a bye, no data off every roster', () => {
  const edited = rows.map((r) => (r.week === 1 && r.player_id === 12 ? { ...r, points: 0, projected: 0 } : r));
  const b = buildSeason({ season: 2030, regularSeasonWeeks: 2, rows: edited, players, teamWeeks, championOwnerId: 'champ' });
  const get = (id) => all(b).get(id);
  assert.deepEqual(outlook(get(11), 1), { projected: 10, status: 'active', estimated: false });
  assert.deepEqual(outlook(get(12), 1), { projected: 0, status: 'out' });
  assert.deepEqual(outlook(get(13), 2), { projected: null, status: 'nodata' });
});

test('a week with missing ESPN projections uses each player\'s season average, flagged', () => {
  // Everyone projected 0 in week 1 while scoring: ESPN lost the week.
  const edited = rows.map((r) => (r.week === 1 ? { ...r, projected: 0 } : { ...r, projected: r.player_id === 11 ? 14 : r.projected }));
  const b = buildSeason({ season: 2030, regularSeasonWeeks: 2, rows: edited, players, teamWeeks, championOwnerId: 'champ' });
  assert.deepEqual(b.estimatedWeeks, [1]);
  const rb = all(b).get(11);
  assert.deepEqual(outlook(rb, 1), { projected: 14, status: 'active', estimated: true });
  assert.deepEqual(outlook(rb, 2), { projected: 14, status: 'active', estimated: false });
});

test('complete weekly data: fills roster gaps, marks byes out (never "no data"), real free agents on waivers', () => {
  // Pipeline file: WR13 scored 6 in week 2 while off every roster; RB12 had a bye in week 2.
  const playerWeeks = {
    season: 2030,
    weeks: [1, 2],
    players: {
      13: [[11, 6], [10, 9], ['NE', 'NE']],
      12: [[9, null], [10, null], ['KC', null]],
      11: [[12, 12], [10, 10], ['KC', 'KC']],
    },
  };
  // RB12 was cut before week 2 (no roster row), so only the pipeline knows he had a bye.
  const cut = rows.filter((r) => !(r.player_id === 12 && r.week === 2));
  const b = buildSeason({ season: 2030, regularSeasonWeeks: 2, rows: cut, players, teamWeeks, championOwnerId: 'champ', playerWeeks });
  const get = (id) => all(b).get(id);
  assert.equal(b.hasCompleteData, true);
  assert.deepEqual(outlook(get(13), 2), { projected: 9, status: 'active', estimated: false });
  assert.deepEqual(outlook(get(12), 2), { projected: 0, status: 'out', estimated: false });
  assert.equal(get(13).team, 'NE');
  assert.equal(get(16).team, null);
  const w2 = playWeek(b, 2, { 'WR-1': get(13), 'RB-1': get(12) });
  assert.equal(w2.you, 6);
  assert.ok(!w2.rows.some((r) => r.status === 'nodata'));
  // WR13 was off every league roster in week 2: he's a real free agent then (RB12 was on a bye).
  assert.deepEqual(b.waiverPool[2][0], [13]);
  // Where the pipeline has no line but a roster row does, the roster row still counts.
  const merged = buildSeason({ season: 2030, regularSeasonWeeks: 2, rows, players, teamWeeks, championOwnerId: 'champ', playerWeeks });
  assert.equal(all(merged).get(12).weekly[2], 9);
  assert.equal(waiverOptions(b, 'x', 2).find((p) => p.position === 'WR').player_id, 13);
});

test('weeks ESPN kept points but not a projection get a pre-kickoff estimate, flagged', () => {
  // WR13: off every roster in week 2, ESPN card has his 6 points but no projection.
  const playerWeeks = { season: 2030, weeks: [1, 2], players: { 13: [[11, 6], [null, null], ['NE', 'NE']] } };
  const b = buildSeason({ season: 2030, regularSeasonWeeks: 2, rows, players, teamWeeks, championOwnerId: 'champ', playerWeeks });
  const wr = all(b).get(13);
  // His week-1 roster projection (10) is the only projection we have: that's the estimate.
  assert.deepEqual(outlook(wr, 2), { projected: 10, status: 'active', estimated: true });
  assert.deepEqual(outlook(wr, 1), { projected: 10, status: 'active', estimated: false });
  assert.equal(playWeek(b, 2, { 'WR-1': wr }).you, 6);
});

test('a locked week scores real points against the champion and the league', () => {
  const b = board();
  const get = (id) => all(b).get(id);
  const lineup = {
    'QB-1': get(10), 'RB-1': get(11), 'RB-2': get(12), 'WR-1': get(13), 'WR-2': get(14),
    'TE-1': get(15), 'FLEX-1': get(21), 'D/ST-1': get(16), 'K-1': get(17),
  };
  const w1 = playWeek(b, 1, lineup);
  // 18+12+9+11+10+7+5+6+8 = 86 vs champ 100; beats only Threes (80).
  assert.equal(w1.you, 86); assert.equal(w1.champ, 100); assert.equal(w1.result, 'L');
  assert.deepEqual([w1.allWins, w1.allLosses], [1, 2]);
  // Week 2: WR13 has no score on file and scores 0. 75 vs 70.
  const w2 = playWeek(b, 2, lineup);
  assert.equal(w2.you, 75); assert.equal(w2.result, 'W');
  assert.equal(w2.rows.find((r) => r.key === 'WR-1').status, 'nodata');
  const empty = playWeek(b, 1, { 'QB-1': get(10) });
  assert.equal(empty.you, 18);
  assert.equal(empty.rows.find((r) => r.key === 'K-1').status, 'empty');
});

test('best lineup by projection or by real points, and lineup checks', () => {
  const b = board();
  const get = (id) => all(b).get(id);
  const roster = [10, 11, 12, 13, 14, 15, 16, 17, 20, 21].map(get);
  const byProj = bestLineup(b, roster, 1, 'projected');
  assert.equal(Object.keys(byProj).length, 9);
  assert.equal(checkLineup(b, roster, byProj), null);
  // Real points: the 9 best legal starters are everyone but TE20 (3).
  assert.ok(!Object.values(bestLineup(b, roster, 1, 'actual')).some((p) => p.player_id === 20));
  assert.equal(optimalPoints(b, roster, 1), 86);
  assert.match(checkLineup(b, roster, { 'QB-1': get(11) }), /can't play QB/);
  assert.match(checkLineup(b, roster, { 'RB-1': get(11), 'FLEX-1': get(11) }), /two spots/);
  assert.match(checkLineup(b, roster.slice(1), { 'QB-1': get(10) }), /isn't on your roster/);
});

test('waiver wire: free agents first, then league benches, then anyone, one per position, seeded', () => {
  const benchRows = rows.map((r) => (r.player_id === 20 ? { ...r, lineup_slot: 'BE', started: false } : r));
  const b = buildSeason({ season: 2030, regularSeasonWeeks: 2, rows: benchRows, players, teamWeeks, championOwnerId: 'champ' });
  // Week 1 tiers without complete data: no free agents; TE20 on a bench; everyone else last resort.
  // The champion's players (1, 2, 22) are never offered.
  const [t1, t2, t3] = b.waiverPool[1];
  assert.deepEqual(t1, []);
  assert.deepEqual(t2, [20]);
  assert.ok(![1, 2, 22].some((id) => t3.includes(id)));
  const offers = waiverOptions(b, 'seed', 1);
  // The TE comes from the bench tier; every other position from the last-resort tier.
  assert.equal(offers.find((p) => p.position === 'TE').player_id, 20);
  assert.deepEqual(offers.map((p) => p.position), ['QB', 'RB', 'WR', 'TE', 'D/ST', 'K']);
  assert.deepEqual(waiverOptions(b, 'seed', 1), offers);
  // Never someone already on your roster: with TE20 and TE15 taken there's no TE left to offer.
  assert.ok(!waiverOptions(b, 'seed', 1, [20, 15]).some((p) => p.position === 'TE'));
});

test('season summary: record, points rank, all-play and lineup IQ', () => {
  const b = board();
  const get = (id) => all(b).get(id);
  const roster = [10, 11, 12, 13, 14, 15, 16, 17, 20, 21].map(get);
  const played = autoplay(b, roster);
  const r = summarize(b, played);
  assert.equal(r.weeks.length, 2);
  assert.equal(r.wins + r.losses + r.ties, 2);
  assert.ok(r.lineup_iq > 0 && r.lineup_iq <= 100);
  assert.equal(r.points_for, played[0].you + played[1].you);
  assert.equal(r.team_count, 4);
  assert.deepEqual(r.champion, { wins: 1, losses: 1, ties: 0, points_for: 170 });
  const text = shareText(b, r, 'Oct 29');
  assert.match(text, /^Fourteen and Fantasy Oct 29: vs the 2030 champ/);
  assert.match(text, /Lineup IQ \d+%/);
});

test('spin order is seeded, covers every team before repeating, and never doubles up', () => {
  const a = spinOrder('seed-1', [2, 3, 4, 5], 40);
  assert.deepEqual(a, spinOrder('seed-1', [2, 3, 4, 5], 40));
  assert.notDeepEqual(a, spinOrder('seed-2', [2, 3, 4, 5], 40));
  for (let i = 0; i < 40; i += 4) assert.deepEqual([...a.slice(i, i + 4)].sort(), [2, 3, 4, 5]);
  for (let i = 1; i < 40; i++) assert.notEqual(a[i], a[i - 1]);
});

test('daily seasons rotate through every year before any repeats', () => {
  const seasons = [2019, 2020, 2021, 2022, 2023, 2024, 2025];
  assert.equal(dayNumber('1970-01-02'), 1);
  const start = dayNumber('2026-10-29');
  const cycleStart = start - (start % 7);
  const seen = [];
  for (let d = cycleStart; d < cycleStart + 7; d++) {
    const key = new Date(d * 86400000).toISOString().slice(0, 10);
    seen.push(dailySeason(key, seasons));
  }
  assert.deepEqual([...seen].sort(), seasons);
  assert.equal(dailySeason('2026-10-29', seasons), dailySeason('2026-10-29', [...seasons].reverse()));
});

// The real league files: every past season must produce a playable game.
const dataDir = new URL('../../data/', import.meta.url);
test('every completed season in the league data is playable', { skip: !existsSync(new URL('seasons.json', dataDir)) }, () => {
  const read = (p) => JSON.parse(readFileSync(new URL(p, dataDir), 'utf8'));
  const seasons = read('seasons.json').filter((s) => !s.is_current && s.champion);
  const allPlayers = read('players.json');
  const teamWeeks = read('team_weeks.json');
  assert.ok(seasons.length > 0);
  for (const s of seasons) {
    const draftPath = new URL(`drafts/${s.season}.json`, dataDir);
    const b = buildSeason({
      season: s.season, regularSeasonWeeks: s.regular_season_weeks, rows: read(`rosters/${s.season}.json`),
      players: allPlayers, teamWeeks, draft: existsSync(draftPath) ? read(`drafts/${s.season}.json`) : [],
      championOwnerId: s.champion.owner_id,
    });
    assert.equal(b.keys.length, 9, `${s.season} lineup`);
    assert.equal(b.draftKeys.length, 14, `${s.season} roster`);
    assert.ok(b.spinTeams.length >= 5, `${s.season} teams`);
    // Draft greedily (best season total) through the seeded spins; it must fill every spot.
    const order = spinOrder(`test-${s.season}`, b.spinTeams);
    const picks = {};
    let i = 0;
    while (Object.keys(picks).length < b.draftKeys.length) {
      i = nextUsableSpin(b, order, i, b.draftKeys, picks);
      assert.ok(i >= 0, `${s.season} ran out of spins`);
      const [best] = [...spinOptions(b, order[i], b.draftKeys, picks)].sort((x, y) => y.season_points - x.season_points);
      picks[slotsFor(best, b.draftKeys, picks)[0].key] = best;
      i += 1;
    }
    const roster = Object.values(picks);
    assert.equal(rosterProblem(roster), null, `${s.season} drafted roster breaks the backup rule`);
    const played = autoplay(b, roster);
    const r = summarize(b, played);
    assert.equal(r.weeks.length, b.weeks.length);
    assert.equal(r.wins + r.losses + r.ties, b.weeks.length);
    assert.equal(r.team_count, b.teams.size + 1);
    for (const w of played) assert.ok(w.you <= w.optimal + 1e-9, `${s.season} week ${w.week} beat the optimal lineup`);
    // Every week the wire offers someone who'll play at every position (a kicker
    // on a bye is always replaceable), and none of them is on the champion.
    const champIds = new Set(b.championRoster.map((p) => p.player_id));
    for (const w of b.weeks) {
      const offers = waiverOptions(b, 'test', w, roster.map((p) => p.player_id));
      assert.deepEqual(offers.map((p) => p.position), ['QB', 'RB', 'WR', 'TE', 'D/ST', 'K'], `${s.season} week ${w}`);
      for (const p of offers) {
        assert.ok(!champIds.has(p.player_id));
        assert.equal(outlook(p, w).status, 'active', `${s.season} week ${w} offered ${p.name}, who isn't playing`);
        // Swapping any same-position starter for him keeps the roster legal.
        const same = roster.find((r) => r.position === p.position);
        if (same) assert.equal(claimProblem(roster, p, same), null);
      }
    }
  }
});
