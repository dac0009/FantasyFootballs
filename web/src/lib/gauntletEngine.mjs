// Game logic for "Fourteen and Fantasy", the daily beat-the-champ game.
//
// The wheel lands on a past season. That year's champion is your opponent,
// and nobody who was ever on the champion's roster that regular season can
// be drafted. Each spin lands on one of the other teams from that year; you
// take one of its players for any open lineup slot. When the lineup is full,
// your nine players' real weekly points are played week by week against the
// champion's real weekly scores, and against the whole league.
//
// Fill-ins: the champion had a bench and the waiver wire; you have nine
// players and no bench. So any week one of your players didn't play (bye,
// injury, or simply no score on file), a fill-in takes the spot and scores
// what a typical player at that position scored that week in our league:
// the median of every league-rostered player at the position who played.
//
// Plain JavaScript so web/tests can run it with node:test. Nothing here
// touches the original Wheel, which keeps using wheelEngine.mjs.

import { eligible, hashSeed, mulberry32, slotKeys, slotTemplate } from './wheelEngine.mjs';

const round2 = (n) => Math.round(n * 100) / 100;
function median(list) {
  if (!list.length) return 0;
  const s = [...list].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE', 'D/ST', 'K'];

/** Days since 1970-01-01 for a YYYY-MM-DD key. Same answer in every time zone. */
export function dayNumber(dateKey) {
  const [y, m, d] = String(dateKey).split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

/** Seeded Fisher-Yates shuffle. Does not touch the input. */
export function shuffle(rng, list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * The season for a given day. Seasons come round in a shuffled cycle, so the
 * same year never repeats until every past year has had its day.
 */
export function dailySeason(dateKey, seasons) {
  const pool = [...seasons].sort((a, b) => a - b);
  if (!pool.length) throw new Error('No past seasons to play.');
  const day = dayNumber(dateKey);
  const cycle = Math.floor(day / pool.length);
  const order = shuffle(mulberry32(hashSeed(`ffbffl-champ-cycle-${cycle}`)), pool);
  return order[((day % pool.length) + pool.length) % pool.length];
}

/**
 * The order the wheel lands on teams. Every team comes up once before any
 * team repeats, and a team never comes up twice in a row.
 */
export function spinOrder(seed, teamIds, length = 60) {
  if (!teamIds.length) throw new Error('No teams to spin.');
  const rng = mulberry32(hashSeed(seed));
  const order = [];
  while (order.length < length) {
    let cycle = shuffle(rng, teamIds);
    if (order.length && cycle.length > 1 && cycle[0] === order[order.length - 1]) {
      cycle = [...cycle.slice(1), cycle[0]];
    }
    order.push(...cycle);
  }
  return order.slice(0, length);
}

/** Regular-season team_weeks rows for one season. */
export function regularWeeks(teamWeeks, season, regularSeasonWeeks) {
  return teamWeeks.filter(
    (t) => t.season === season && t.game_type === 'regular' && (regularSeasonWeeks == null || t.week <= regularSeasonWeeks),
  );
}

/**
 * Build one season's board.
 * @param rows        roster rows for the season (rosters/<season>.json)
 * @param players     players.json (array or Map)
 * @param teamWeeks   team_weeks.json (all seasons is fine)
 * @param draft       drafts/<season>.json, or [] if missing
 * @param championOwnerId owner_id of that year's champion
 */
export function buildSeason({ season, regularSeasonWeeks, rows, players, teamWeeks, draft = [], championOwnerId }) {
  const playerById = players instanceof Map ? players : new Map(players.map((p) => [p.player_id, p]));
  const games = regularWeeks(teamWeeks, season, regularSeasonWeeks);
  const weeks = [...new Set(games.map((g) => g.week))].sort((a, b) => a - b);
  const lastWeek = weeks[weeks.length - 1] ?? 0;
  const inSeason = rows.filter((r) => r.week >= 1 && r.week <= lastWeek);

  // Team names and owners, using each team's name in its final regular week.
  const teams = new Map();
  for (const g of [...games].sort((a, b) => a.week - b.week)) {
    teams.set(g.team_id, { team_id: g.team_id, owner_id: g.owner_id, name: g.team_name });
  }
  const champion = [...teams.values()].find((t) => t.owner_id === championOwnerId);
  if (!champion) throw new Error(`No champion team found for ${season}.`);

  // Every player's real points each week, whichever league team had him.
  // "Played" means he scored, or ESPN projected him to (a 0 / 0 week is a bye
  // or a scratch). A projected player who scored 0 still played.
  const weekly = new Map();
  const playedWeeks = new Map();
  const byPositionWeek = new Map();
  for (const r of inSeason) {
    if (r.points == null) continue;
    const byWeek = weekly.get(r.player_id) ?? {};
    byWeek[r.week] = r.points;
    weekly.set(r.player_id, byWeek);
    if (r.points !== 0 || (r.projected ?? 0) > 0) {
      const played = playedWeeks.get(r.player_id) ?? new Set();
      if (!played.has(r.week)) {
        played.add(r.week);
        const position = playerById.get(r.player_id)?.position ?? '?';
        const key = `${position}:${r.week}`;
        (byPositionWeek.get(key) ?? byPositionWeek.set(key, []).get(key)).push(r.points);
      }
      playedWeeks.set(r.player_id, played);
    }
  }
  const fillIns = {};
  for (const [key, list] of byPositionWeek) fillIns[key] = round2(median(list));

  const championPlayers = new Set(inSeason.filter((r) => r.team_id === champion.team_id).map((r) => r.player_id));
  const draftRound = new Map(draft.filter((d) => d.season === season).map((d) => [d.player_id, d.round]));

  const describe = (id) => {
    const p = playerById.get(id) ?? {};
    const byWeek = weekly.get(id) ?? {};
    return {
      player_id: id,
      name: p.name ?? `Player ${id}`,
      position: p.position ?? '?',
      draft_round: draftRound.get(id) ?? null,
      weekly: byWeek,
      played: Object.fromEntries(weeks.map((w) => [w, playedWeeks.get(id)?.has(w) ?? false])),
      season_points: round2(weeks.reduce((t, w) => t + (byWeek[w] ?? 0), 0)),
      weeks_with_data: weeks.filter((w) => byWeek[w] != null).length,
    };
  };

  const order = (a, b) =>
    POSITION_ORDER.indexOf(a.position) - POSITION_ORDER.indexOf(b.position)
    || (a.draft_round ?? 99) - (b.draft_round ?? 99)
    || a.name.localeCompare(b.name);

  // Who each other team rostered at any point in the regular season.
  const rosterOf = new Map();
  for (const r of inSeason) {
    if (r.team_id === champion.team_id || championPlayers.has(r.player_id)) continue;
    if (!teams.has(r.team_id)) continue;
    const set = rosterOf.get(r.team_id) ?? new Set();
    set.add(r.player_id);
    rosterOf.set(r.team_id, set);
  }
  const pools = new Map();
  for (const [teamId, ids] of rosterOf) pools.set(teamId, [...ids].map(describe).sort(order));

  const championRoster = [...championPlayers].map(describe).sort((a, b) => b.season_points - a.season_points);

  // slotTemplate reads one week; key by team and week so a season isn't summed.
  const template = slotTemplate(inSeason.map((r) => ({ ...r, team_id: `${r.team_id}:${r.week}` })));

  return {
    season,
    weeks,
    template,
    keys: slotKeys(template),
    teams,
    champion,
    championRoster,
    pools,
    spinTeams: [...pools.keys()].sort((a, b) => a - b),
    games,
    fillIns,
  };
}

/** Open slot keys a player could fill, fixed slots before FLEX. */
export function slotsFor(player, keys, picks) {
  return keys
    .filter((k) => picks[k.key] == null && eligible(player.position, k.slot))
    .sort((a, b) => (a.slot === 'FLEX') - (b.slot === 'FLEX'));
}

/** Players from one team that can still go in an open slot. */
export function spinOptions(board, teamId, keys, picks) {
  const taken = new Set(Object.values(picks).filter(Boolean).map((p) => p.player_id));
  return (board.pools.get(teamId) ?? []).filter((p) => !taken.has(p.player_id) && slotsFor(p, keys, picks).length > 0);
}

/**
 * Index of the next spin, from `from`, that has someone to draft. Spins with
 * nobody usable are skipped for free.
 */
export function nextUsableSpin(board, order, from, keys, picks) {
  for (let i = from; i < order.length; i++) {
    if (spinOptions(board, order[i], keys, picks).length) return i;
  }
  return -1;
}

/**
 * Play the season. `picks` maps slot key -> drafted player (from buildSeason).
 */
export function simulate(board, picks) {
  const lineup = Object.values(picks).filter(Boolean);
  const scoreOf = (teamId, week) => board.games.find((g) => g.team_id === teamId && g.week === week)?.score ?? null;

  /** What a lineup spot scored in a week, and whether a fill-in played it. */
  const spotScore = (p, week) => {
    if (p.played?.[week]) return { points: p.weekly[week] ?? 0, fillIn: false };
    return { points: board.fillIns?.[`${p.position}:${week}`] ?? 0, fillIn: true };
  };

  const weekRows = board.weeks.map((week) => {
    let you = 0;
    const fillIns = [];
    for (const p of lineup) {
      const spot = spotScore(p, week);
      you += spot.points;
      if (spot.fillIn) fillIns.push({ player_id: p.player_id, name: p.name, position: p.position, points: spot.points });
    }
    you = round2(you);
    const missing = fillIns.length;
    const champ = scoreOf(board.champion.team_id, week);
    const others = board.games.filter((g) => g.week === week).map((g) => g.score);
    const allWins = others.filter((s) => you > s).length;
    const allLosses = others.filter((s) => you < s).length;
    const result = champ == null ? null : you > champ ? 'W' : you < champ ? 'L' : 'T';
    return { week, you, champ, result, missing, fillIns, allWins, allLosses, allTies: others.length - allWins - allLosses };
  });

  const count = (r) => weekRows.filter((w) => w.result === r).length;
  const pointsFor = round2(weekRows.reduce((t, w) => t + w.you, 0));

  // Every real team's regular-season points for, plus yours, ranked.
  const totals = new Map();
  for (const g of board.games) totals.set(g.team_id, (totals.get(g.team_id) ?? 0) + g.score);
  const table = [...totals.entries()].map(([teamId, pf]) => ({ ...board.teams.get(teamId), points_for: round2(pf), you: false }));
  table.push({ team_id: null, owner_id: null, name: 'You', points_for: pointsFor, you: true });
  table.sort((a, b) => b.points_for - a.points_for || (a.you ? 1 : -1));
  const rank = table.findIndex((t) => t.you) + 1;

  const champRow = board.games.filter((g) => g.team_id === board.champion.team_id);
  const champRecord = {
    wins: champRow.filter((g) => g.result === 'W').length,
    losses: champRow.filter((g) => g.result === 'L').length,
    ties: champRow.filter((g) => g.result === 'T').length,
    points_for: round2(champRow.reduce((t, g) => t + g.score, 0)),
  };

  const scored = lineup.map((p) => ({
    ...p,
    total: round2(board.weeks.reduce((t, w) => t + (p.played?.[w] ? p.weekly[w] ?? 0 : 0), 0)),
    games: board.weeks.filter((w) => p.played?.[w]).length,
    fill_in_points: round2(board.weeks.reduce((t, w) => t + (p.played?.[w] ? 0 : spotScore(p, w).points), 0)),
  }));
  scored.sort((a, b) => b.total - a.total);
  const best = [...weekRows].sort((a, b) => b.you - a.you)[0] ?? null;
  const worst = [...weekRows].sort((a, b) => a.you - b.you)[0] ?? null;
  const leagueAvg = board.games.length ? round2(board.games.reduce((t, g) => t + g.score, 0) / board.games.length) : 0;

  return {
    weeks: weekRows,
    wins: count('W'),
    losses: count('L'),
    ties: count('T'),
    points_for: pointsFor,
    average: weekRows.length ? round2(pointsFor / weekRows.length) : 0,
    league_average: leagueAvg,
    rank,
    team_count: table.length,
    table,
    all_play: {
      wins: weekRows.reduce((t, w) => t + w.allWins, 0),
      losses: weekRows.reduce((t, w) => t + w.allLosses, 0),
      ties: weekRows.reduce((t, w) => t + w.allTies, 0),
    },
    champion: champRecord,
    best_week: best,
    worst_week: worst,
    mvp: scored[0] ?? null,
    dud: scored[scored.length - 1] ?? null,
    by_player: scored,
    missing_weeks: weekRows.reduce((t, w) => t + w.missing, 0),
    fill_in_points: round2(weekRows.reduce((t, w) => t + w.fillIns.reduce((a, f) => a + f.points, 0), 0)),
  };
}

/** One line for the group chat. */
export function shareText(board, result, label) {
  const squares = result.weeks.map((w) => (w.result === 'W' ? '🟩' : w.result === 'L' ? '🟥' : '⬜')).join('');
  const record = `${result.wins}-${result.losses}${result.ties ? `-${result.ties}` : ''}`;
  return [
    `Fourteen and Fantasy ${label}: vs the ${board.season} champ`,
    `${record} vs ${board.champion.name}`,
    squares,
    `${Math.round(result.points_for)} pts, #${result.rank} of ${result.team_count} in points`,
  ].join('\n');
}
