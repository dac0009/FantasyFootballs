import test from 'node:test';
import assert from 'node:assert/strict';
import {
  actualLineup, buildGame, dailyKey, hashSeed, lineupPoints, mulberry32, optimalLineup,
  pickSeasonWeek, pickTeams, slotKeys, slotTemplate, teamCandidates, validateLineup,
} from '../src/lib/wheelEngine.mjs';

const P = (id, name, position, points, { started = false, slot = 'BE', team_id = 1, projected = null } = {}) =>
  ({ player_id: id, name, position, nfl_team: null, points, started, slot, team_id, projected });

// Twelve players: a full nine-slot lineup plus three bench pieces, with the
// owner leaving points on the bench the way owners do.
const roster = [
  P(1, 'QB Starter', 'QB', 18, { started: true, slot: 'QB' }),
  P(2, 'RB One', 'RB', 15, { started: true, slot: 'RB' }),
  P(3, 'RB Two', 'RB', 9, { started: true, slot: 'RB' }),
  P(4, 'WR One', 'WR', 12, { started: true, slot: 'WR' }),
  P(5, 'WR Two', 'WR', 4, { started: true, slot: 'WR' }),
  P(6, 'TE Starter', 'TE', 6, { started: true, slot: 'TE' }),
  P(7, 'Flex RB', 'RB', 7, { started: true, slot: 'FLEX' }),
  P(8, 'Defense', 'D/ST', 10, { started: true, slot: 'D/ST' }),
  P(9, 'Kicker', 'K', 8, { started: true, slot: 'K' }),
  P(10, 'Bench WR', 'WR', 22),
  P(11, 'Bench TE', 'TE', 20),
  P(12, 'Bench QB', 'QB', 30),
];
const template = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, 'D/ST': 1, K: 1 };
const byId = new Map(roster.map((p) => [p.player_id, p]));

test('seeded spins are reproducible and distinct across seeds', () => {
  const a = mulberry32(hashSeed('ffbffl-wheel-2026-10-21'));
  const b = mulberry32(hashSeed('ffbffl-wheel-2026-10-21'));
  const c = mulberry32(hashSeed('ffbffl-wheel-2026-10-22'));
  const seq = (rng) => [rng(), rng(), rng()];
  assert.deepEqual(seq(a), seq(b));
  assert.notDeepEqual(seq(mulberry32(hashSeed('ffbffl-wheel-2026-10-21'))), seq(c));
});

test('the daily key follows Eastern time, not UTC', () => {
  assert.equal(dailyKey(new Date('2026-10-21T03:30:00Z')), '2026-10-20');
  assert.equal(dailyKey(new Date('2026-10-21T04:30:00Z')), '2026-10-21');
});

test('slot template is the most of each slot any team started, ignoring bench and IR', () => {
  const rows = [
    ...roster.map((p) => ({ team_id: 1, started: p.started, lineup_slot: p.slot })),
    { team_id: 2, started: true, lineup_slot: 'QB' },
    { team_id: 2, started: false, lineup_slot: 'IR' },
    { team_id: 2, started: true, lineup_slot: 'RB' },
  ];
  assert.deepEqual(slotTemplate(rows), template);
  assert.deepEqual(slotKeys(template).map((k) => k.key),
    ['QB-1', 'RB-1', 'RB-2', 'WR-1', 'WR-2', 'TE-1', 'FLEX-1', 'D/ST-1', 'K-1']);
});

test('the owner’s actual lineup scores exactly what the starters scored', () => {
  const actual = actualLineup(roster, slotKeys(template));
  assert.equal(actual.points, 18 + 15 + 9 + 12 + 4 + 6 + 7 + 10 + 8);
  assert.equal(actual.lineup['FLEX-1'], 7);
  assert.equal(actual.lineup['QB-1'], 1);
});

test('the optimal lineup promotes the bench and uses FLEX on the best leftover RB/WR/TE', () => {
  const best = optimalLineup(roster, template);
  // QB 30, RB 15+9, WR 22+12, TE 20, FLEX next best of RB7/WR4/TE6 = RB 7, D/ST 10, K 8
  assert.equal(best.points, 30 + 15 + 9 + 22 + 12 + 20 + 7 + 10 + 8);
  assert.equal(best.lineup['QB-1'], 12);
  assert.equal(best.lineup['TE-1'], 11);
  assert.equal(best.lineup['FLEX-1'], 7);
  assert.deepEqual(validateLineup(best.lineup, template, byId), []);
  assert.equal(lineupPoints(best.lineup, byId), best.points);
});

test('illegal lineups are named specifically', () => {
  const bad = { ...optimalLineup(roster, template).lineup, 'RB-2': 1, 'WR-2': 10 };
  const errors = validateLineup(bad, template, byId);
  assert.ok(errors.some((e) => e.includes('RB-2') && e.includes('QB')));
  assert.ok(errors.some((e) => e.includes('twice')));
});

test('a kicker never qualifies for FLEX', () => {
  assert.deepEqual(validateLineup({ 'FLEX-1': 9 }, template, byId).length, 1);
});

test('team picking only uses teams with a roster and a played game, and never picks itself', () => {
  const rows = [{ team_id: 1 }, { team_id: 2 }, { team_id: 3 }, { team_id: 4 }];
  const matchups = [
    { home_team_id: 1, away_team_id: 2, home_score: 101.2, away_score: 99.4, is_bye: false },
    { home_team_id: 3, away_team_id: 5, home_score: 88, away_score: 90, is_bye: false },
    { home_team_id: 4, away_team_id: null, home_score: 0, away_score: 0, is_bye: true },
    { home_team_id: 6, away_team_id: 7, home_score: 0, away_score: 0, is_bye: false },
  ];
  const candidates = teamCandidates(rows, matchups);
  assert.deepEqual(candidates, [1, 2, 3]);
  for (let seed = 0; seed < 50; seed++) {
    const { teamId, opponentId } = pickTeams(mulberry32(seed), candidates);
    assert.notEqual(teamId, opponentId);
    assert.ok(candidates.includes(teamId) && candidates.includes(opponentId));
  }
});

test('season and week come only from completed weeks, deterministically', () => {
  const seasons = [{ season: 2024, weeks: [1, 2, 3] }, { season: 2025, weeks: [] }];
  const one = pickSeasonWeek(mulberry32(7), seasons);
  const two = pickSeasonWeek(mulberry32(7), seasons);
  assert.deepEqual(one, two);
  assert.equal(one.season, 2024);
  assert.ok([1, 2, 3].includes(one.week));
});

test('buildGame assembles roster, bench pool, opponent score, actual and optimal', () => {
  const rows = [
    ...roster.map((p) => ({ season: 2024, week: 8, team_id: 1, player_id: p.player_id, lineup_slot: p.slot, started: p.started, points: p.points, projected: 5 })),
    { season: 2024, week: 8, team_id: 2, player_id: 20, lineup_slot: 'BE', started: false, points: 31, projected: 9 },
    { season: 2024, week: 8, team_id: 2, player_id: 21, lineup_slot: 'QB', started: true, points: 25, projected: 20 },
    { season: 2024, week: 8, team_id: 2, player_id: 22, lineup_slot: 'IR', started: false, points: 0, projected: 0 },
    { season: 2024, week: 7, team_id: 1, player_id: 99, lineup_slot: 'QB', started: true, points: 50, projected: 1 },
  ];
  const players = [...roster, P(20, 'Their Bench RB', 'RB', 31), P(21, 'Their QB', 'QB', 25), P(22, 'Hurt Guy', 'WR', 0), P(99, 'Last Week', 'QB', 50)];
  const matchups = [{ home_team_id: 1, away_team_id: 2, home_score: 89, away_score: 25, is_bye: false }];
  const teams = new Map([[1, { name: 'Cruise Control', owner_id: 'mikey-fidler' }], [2, { name: 'Yes Chef!!', owner_id: 'preston-hill' }]]);
  const game = buildGame({ season: 2024, week: 8, teamId: 1, opponentId: 2, rows, players, matchups, teams });
  assert.equal(game.roster.length, 12, 'other weeks and other teams stay out of the roster');
  assert.deepEqual(game.pool.map((p) => p.player_id), [20], 'only benched, non-IR players from other teams');
  assert.equal(game.pool[0].from_team, 'Yes Chef!!');
  assert.equal(game.opponent.points, 25);
  assert.equal(game.actual.points, 89);
  assert.equal(game.you.recorded, 89);
  assert.ok(game.optimal.points > game.actual.points);
});
