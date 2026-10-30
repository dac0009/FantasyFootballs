// Game logic for "Fourteen and Fantasy", the daily beat-the-champ game.
//
// The wheel lands on a past season. That year's champion is your opponent,
// and nobody who was ever on the champion's roster that regular season can
// be drafted. Each spin lands on one of the other teams from that year; you
// take one of its players for any open spot: nine starters, then a bench.
//
// Then you manage the season like a real owner, one week at a time: set the
// lineup from your roster using that week's ESPN projections, pick up one
// player a week off the waiver wire, and kick off. Real points are revealed
// only after the lineup locks. A player on a bye or out is projected 0 and
// scores 0 if you start him. Your weekly score goes head to head with the
// champion's real score that week, and against the whole league.
//
// Plain JavaScript so web/tests can run it with node:test. Nothing here
// touches the original Wheel, which keeps using wheelEngine.mjs.

import { eligible, hashSeed, mulberry32, slotKeys, slotTemplate } from './wheelEngine.mjs';

const round2 = (n) => Math.round(n * 100) / 100;
export const BENCH_SIZE = 3;
export const WAIVER_CHOICES = 3;
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

  // Every player's real points and ESPN projection each week, whichever
  // league team had him. A week with no row means he wasn't on a league
  // roster, so we have no projection and no score for him.
  const weekly = new Map();
  const projected = new Map();
  for (const r of inSeason) {
    const pts = weekly.get(r.player_id) ?? {};
    const proj = projected.get(r.player_id) ?? {};
    if (r.points != null) pts[r.week] = r.points;
    proj[r.week] = r.projected ?? 0;
    weekly.set(r.player_id, pts);
    projected.set(r.player_id, proj);
  }

  // ESPN occasionally lost a whole week of projections (2023 week 1 is all
  // zeros). If most players who scored that week were projected 0, the week's
  // projections are missing, not a league-wide bye: stand in each player's
  // average projection from the rest of the season, and flag it as estimated.
  const scoredRows = new Map();
  const zeroRows = new Map();
  for (const r of inSeason) {
    if (!((r.points ?? 0) > 0)) continue;
    scoredRows.set(r.week, (scoredRows.get(r.week) ?? 0) + 1);
    if (!((r.projected ?? 0) > 0)) zeroRows.set(r.week, (zeroRows.get(r.week) ?? 0) + 1);
  }
  const estimatedWeeks = weeks.filter((w) => (scoredRows.get(w) ?? 0) > 0 && (zeroRows.get(w) ?? 0) / scoredRows.get(w) > 0.5);
  const estimated = new Map();
  if (estimatedWeeks.length) {
    for (const [id, proj] of projected) {
      const real = Object.entries(proj).filter(([w, v]) => !estimatedWeeks.includes(Number(w)) && v > 0).map(([, v]) => v);
      const avg = real.length ? round2(real.reduce((t, v) => t + v, 0) / real.length) : 0;
      for (const w of estimatedWeeks) {
        if (proj[w] == null) continue;
        proj[w] = avg;
        (estimated.get(id) ?? estimated.set(id, {}).get(id))[w] = true;
      }
    }
  }

  const championPlayers = new Set(inSeason.filter((r) => r.team_id === champion.team_id).map((r) => r.player_id));
  const draftRound = new Map(draft.filter((d) => d.season === season).map((d) => [d.player_id, d.round]));

  const cache = new Map();
  const describe = (id) => {
    if (cache.has(id)) return cache.get(id);
    const p = playerById.get(id) ?? {};
    const byWeek = weekly.get(id) ?? {};
    const out = {
      player_id: id,
      name: p.name ?? `Player ${id}`,
      position: p.position ?? '?',
      draft_round: draftRound.get(id) ?? null,
      weekly: byWeek,
      projected: projected.get(id) ?? {},
      estimated: estimated.get(id) ?? {},
      season_points: round2(weeks.reduce((t, w) => t + (byWeek[w] ?? 0), 0)),
    };
    cache.set(id, out);
    return out;
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

  // The waiver wire each week: players sitting on a league bench that week
  // (not started by anyone), expected to play, and never on the champion.
  const waiverPool = {};
  for (const r of inSeason) {
    if (r.started || r.lineup_slot !== 'BE' || championPlayers.has(r.player_id)) continue;
    if (!((projected.get(r.player_id)?.[r.week] ?? 0) > 0)) continue;
    (waiverPool[r.week] ??= []).push(r.player_id);
  }
  for (const w of Object.keys(waiverPool)) waiverPool[w] = [...new Set(waiverPool[w])].sort((a, b) => a - b);

  const championRoster = [...championPlayers].map(describe).sort((a, b) => b.season_points - a.season_points);

  // slotTemplate reads one week; key by team and week so a season isn't summed.
  const template = slotTemplate(inSeason.map((r) => ({ ...r, team_id: `${r.team_id}:${r.week}` })));
  const keys = slotKeys(template);
  const benchKeys = Array.from({ length: BENCH_SIZE }, (_, i) => ({ key: `BE-${i + 1}`, slot: 'BE' }));

  return {
    season,
    weeks,
    template,
    keys,
    benchKeys,
    draftKeys: [...keys, ...benchKeys],
    teams,
    champion,
    championRoster,
    pools,
    spinTeams: [...pools.keys()].sort((a, b) => a - b),
    games,
    waiverPool,
    estimatedWeeks,
    describe,
  };
}

/** Can this position go in this slot? The bench takes anyone. */
export function fits(position, slot) {
  return slot === 'BE' || eligible(position, slot);
}

/** Open draft spots a player could fill: his position, then FLEX, then the bench. */
export function slotsFor(player, keys, picks) {
  const rank = (slot) => (slot === 'BE' ? 2 : slot === 'FLEX' ? 1 : 0);
  return keys
    .filter((k) => picks[k.key] == null && fits(player.position, k.slot))
    .sort((a, b) => rank(a.slot) - rank(b.slot));
}

/** Players from one team that can still go in an open spot. */
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
 * What we know about a player before a week kicks off: his ESPN projection,
 * and whether he's out (bye or injury, projected 0) or off every league
 * roster that week (no data; he scores 0 if started).
 */
export function outlook(player, week) {
  const proj = player.projected?.[week];
  if (proj == null) return { projected: null, status: 'nodata' };
  if (proj <= 0) return { projected: 0, status: 'out' };
  return { projected: round2(proj), status: 'active', estimated: !!player.estimated?.[week] };
}

/** Real points a player scored in a week (0 if out or no data). */
export function actualPoints(player, week) {
  return player.weekly?.[week] ?? 0;
}

/**
 * Best legal lineup from a roster for one week, by projection or by real
 * points. Fixed slots are filled first, then FLEX from what's left, which is
 * optimal for a lineup made of single-position slots plus FLEX.
 * Returns { slotKey: player }.
 */
export function bestLineup(board, roster, week, by = 'projected') {
  const value = (p) => (by === 'actual' ? actualPoints(p, week) : outlook(p, week).projected ?? -1);
  const pool = [...roster].sort((a, b) => value(b) - value(a) || a.player_id - b.player_id);
  const used = new Set();
  const lineup = {};
  const fixed = board.keys.filter((k) => k.slot !== 'FLEX');
  const flex = board.keys.filter((k) => k.slot === 'FLEX');
  for (const k of [...fixed, ...flex]) {
    const p = pool.find((x) => !used.has(x.player_id) && eligible(x.position, k.slot));
    if (p) { lineup[k.key] = p; used.add(p.player_id); }
  }
  return lineup;
}

/** Is this a legal lineup from this roster? Returns an error string or null. */
export function checkLineup(board, roster, lineup) {
  const ids = new Set(roster.map((p) => p.player_id));
  const seen = new Set();
  for (const k of board.keys) {
    const p = lineup[k.key];
    if (!p) continue;
    if (!ids.has(p.player_id)) return `${p.name} isn't on your roster.`;
    if (seen.has(p.player_id)) return `${p.name} is in two spots.`;
    if (!eligible(p.position, k.slot)) return `${p.name} can't play ${k.slot}.`;
    seen.add(p.player_id);
  }
  return null;
}

/**
 * The three waiver-wire players offered in a week. The same three for
 * everyone playing the same run (seeded), never someone already on your
 * roster, and spread across positions where possible.
 */
export function waiverOptions(board, seed, week, rosterIds = []) {
  const taken = new Set(rosterIds);
  const ids = (board.waiverPool[week] ?? []).filter((id) => !taken.has(id));
  const order = shuffle(mulberry32(hashSeed(`${seed}:waivers:${week}`)), ids).map(board.describe);
  const out = [];
  const positions = new Set();
  for (const p of order) {
    if (out.length >= WAIVER_CHOICES) break;
    if (!positions.has(p.position)) { out.push(p); positions.add(p.position); }
  }
  for (const p of order) {
    if (out.length >= WAIVER_CHOICES) break;
    if (!out.includes(p)) out.push(p);
  }
  return out;
}

/** Score one locked week against the champion and the league. */
export function playWeek(board, week, lineup) {
  const rows = board.keys.map((k) => {
    const p = lineup[k.key] ?? null;
    const look = p ? outlook(p, week) : { projected: null, status: 'empty' };
    return { key: k.key, slot: k.slot, player: p, points: p ? round2(actualPoints(p, week)) : 0, projected: look.projected, status: look.status };
  });
  const you = round2(rows.reduce((t, r) => t + r.points, 0));
  const champGame = board.games.find((g) => g.team_id === board.champion.team_id && g.week === week);
  const champ = champGame?.score ?? null;
  const others = board.games.filter((g) => g.week === week).map((g) => g.score);
  const allWins = others.filter((s) => you > s).length;
  const allLosses = others.filter((s) => you < s).length;
  const result = champ == null ? null : you > champ ? 'W' : you < champ ? 'L' : 'T';
  return { week, you, champ, result, rows, allWins, allLosses, allTies: others.length - allWins - allLosses };
}

/** The best you could have scored that week with the roster you had. */
export function optimalPoints(board, roster, week) {
  const best = bestLineup(board, roster, week, 'actual');
  return round2(Object.values(best).reduce((t, p) => t + actualPoints(p, week), 0));
}

/**
 * Season totals from the weeks you played.
 * @param played  [{ ...playWeek(), optimal }] in week order
 */
export function summarize(board, played) {
  const count = (r) => played.filter((w) => w.result === r).length;
  const pointsFor = round2(played.reduce((t, w) => t + w.you, 0));
  const optimal = round2(played.reduce((t, w) => t + (w.optimal ?? w.you), 0));

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

  // Points each player actually put on your scoreboard, and his starts.
  const byPlayer = new Map();
  for (const w of played) {
    for (const r of w.rows) {
      if (!r.player) continue;
      const row = byPlayer.get(r.player.player_id) ?? { ...r.player, total: 0, starts: 0 };
      row.total = round2(row.total + r.points);
      row.starts += 1;
      byPlayer.set(r.player.player_id, row);
    }
  }
  const scored = [...byPlayer.values()].sort((a, b) => b.total - a.total);
  const best = [...played].sort((a, b) => b.you - a.you)[0] ?? null;
  const worst = [...played].sort((a, b) => a.you - b.you)[0] ?? null;
  const leagueAvg = board.games.length ? round2(board.games.reduce((t, g) => t + g.score, 0) / board.games.length) : 0;

  return {
    weeks: played,
    wins: count('W'),
    losses: count('L'),
    ties: count('T'),
    points_for: pointsFor,
    optimal_points: optimal,
    lineup_iq: optimal > 0 ? Math.round((pointsFor / optimal) * 100) : 100,
    average: played.length ? round2(pointsFor / played.length) : 0,
    league_average: leagueAvg,
    rank,
    team_count: table.length,
    table,
    all_play: {
      wins: played.reduce((t, w) => t + w.allWins, 0),
      losses: played.reduce((t, w) => t + w.allLosses, 0),
      ties: played.reduce((t, w) => t + w.allTies, 0),
    },
    champion: champRecord,
    best_week: best,
    worst_week: worst,
    mvp: scored[0] ?? null,
    by_player: scored,
    benched_points: round2(optimal - pointsFor),
  };
}

/**
 * Autopilot: play every remaining week with the best lineup by projection
 * and no waiver moves. Used by "Sim to the end" and by the tests.
 */
export function autoplay(board, roster, fromWeekIndex = 0) {
  return board.weeks.slice(fromWeekIndex).map((week) => {
    const lineup = bestLineup(board, roster, week, 'projected');
    return { ...playWeek(board, week, lineup), optimal: optimalPoints(board, roster, week) };
  });
}

/** One line for the group chat. */
export function shareText(board, result, label) {
  const squares = result.weeks.map((w) => (w.result === 'W' ? '🟩' : w.result === 'L' ? '🟥' : '⬜')).join('');
  const record = `${result.wins}-${result.losses}${result.ties ? `-${result.ties}` : ''}`;
  return [
    `Fourteen and Fantasy ${label}: vs the ${board.season} champ`,
    `${record} vs ${board.champion.name}`,
    squares,
    `${Math.round(result.points_for)} pts, #${result.rank} of ${result.team_count} · Lineup IQ ${result.lineup_iq}%`,
  ].join('\n');
}
