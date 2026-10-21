// Game logic for The Wheel: spin a real week from league history, set that
// roster's lineup, get scored with the points those players actually put up.
// Plain JavaScript so the tests in web/tests can run it with node:test.

const FLEX_POSITIONS = new Set(['RB', 'WR', 'TE']);
const SLOT_ORDER = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'D/ST', 'K'];
const NOT_A_SLOT = new Set(['BE', 'IR']);
const round2 = (n) => Math.round(n * 100) / 100;

/** FNV-1a, so the same text always gives the same 32-bit seed. */
export function hashSeed(text) {
  let h = 0x811c9dc5;
  for (const ch of String(text)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Small seeded PRNG. Same seed, same sequence, in every browser. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick(rng, list) {
  if (!list.length) throw new Error('Nothing to pick from.');
  return list[Math.floor(rng() * list.length)];
}

/** The league's day, as YYYY-MM-DD in Eastern time, so everyone's "today" agrees. */
export function dailyKey(date = new Date(), timeZone = 'America/New_York') {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function eligible(position, slot) {
  return slot === position || (slot === 'FLEX' && FLEX_POSITIONS.has(position));
}

/** Starter slots in use that week: the most of each slot any team started. */
export function slotTemplate(rows) {
  const perTeam = new Map();
  for (const r of rows) {
    if (!r.started || NOT_A_SLOT.has(r.lineup_slot)) continue;
    const counts = perTeam.get(r.team_id) ?? new Map();
    counts.set(r.lineup_slot, (counts.get(r.lineup_slot) ?? 0) + 1);
    perTeam.set(r.team_id, counts);
  }
  const template = {};
  for (const counts of perTeam.values()) {
    for (const [slot, n] of counts) template[slot] = Math.max(template[slot] ?? 0, n);
  }
  return template;
}

/** Ordered slot keys such as RB-1, RB-2, FLEX-1. */
export function slotKeys(template) {
  const extra = Object.keys(template).filter((s) => !SLOT_ORDER.includes(s)).sort();
  const keys = [];
  for (const slot of [...SLOT_ORDER, ...extra]) {
    for (let i = 1; i <= (template[slot] ?? 0); i++) keys.push({ key: `${slot}-${i}`, slot });
  }
  return keys;
}

/** Teams that both have a roster on file and a played game that week. */
export function teamCandidates(rows, matchups) {
  const rostered = new Set(rows.map((r) => r.team_id));
  const scored = new Set();
  for (const m of matchups) {
    if (m.is_bye || m.home_team_id == null || m.away_team_id == null) continue;
    if (typeof m.home_score !== 'number' || typeof m.away_score !== 'number') continue;
    if (m.home_score === 0 && m.away_score === 0) continue;
    scored.add(m.home_team_id);
    scored.add(m.away_team_id);
  }
  return [...scored].filter((id) => rostered.has(id)).sort((a, b) => a - b);
}

/** @param seasons [{season, weeks:number[]}] */
export function pickSeasonWeek(rng, seasons) {
  const usable = seasons.filter((s) => s.weeks.length > 0);
  const chosen = pick(rng, usable);
  return { season: chosen.season, week: pick(rng, [...chosen.weeks].sort((a, b) => a - b)) };
}

export function pickTeams(rng, candidates) {
  if (candidates.length < 2) throw new Error('Not enough teams played that week.');
  const teamId = pick(rng, candidates);
  const opponentId = pick(rng, candidates.filter((id) => id !== teamId));
  return { teamId, opponentId };
}

/** The lineup the real owner submitted, as slot key -> player id. */
export function actualLineup(roster, keys) {
  const lineup = Object.fromEntries(keys.map((k) => [k.key, null]));
  let points = 0;
  for (const p of roster) {
    if (!p.started) continue;
    const key = keys.find((k) => k.slot === p.slot && lineup[k.key] == null);
    if (!key) continue;
    lineup[key.key] = p.player_id;
    points += p.points ?? 0;
  }
  return { lineup, points: round2(points) };
}

/** Best lineup available from these players. Fixed slots first, then FLEX. */
export function optimalLineup(players, template) {
  const keys = slotKeys(template);
  const ranked = [...players].sort((a, b) => (b.points ?? 0) - (a.points ?? 0));
  const used = new Set();
  const lineup = {};
  let points = 0;
  const fill = ({ key, slot }) => {
    const found = ranked.find((p) => !used.has(p.player_id) && eligible(p.position, slot));
    lineup[key] = found ? found.player_id : null;
    if (found) {
      used.add(found.player_id);
      points += found.points ?? 0;
    }
  };
  keys.filter((k) => k.slot !== 'FLEX').forEach(fill);
  keys.filter((k) => k.slot === 'FLEX').forEach(fill);
  return { lineup, points: round2(points) };
}

export function lineupPoints(lineup, byId) {
  let total = 0;
  for (const id of Object.values(lineup)) {
    if (id != null && byId.has(id)) total += byId.get(id).points ?? 0;
  }
  return round2(total);
}

/** Problems with a lineup, or an empty list when it is legal. */
export function validateLineup(lineup, template, byId) {
  const errors = [];
  const seen = new Set();
  for (const { key, slot } of slotKeys(template)) {
    const id = lineup[key];
    if (id == null) continue;
    const player = byId.get(id);
    if (!player) errors.push(`${key}: unknown player`);
    else if (!eligible(player.position, slot)) errors.push(`${key}: ${player.name} is a ${player.position}`);
    if (seen.has(id)) errors.push(`${key}: ${player?.name ?? id} is in twice`);
    seen.add(id);
  }
  return errors;
}

/**
 * Everything the page needs for one game.
 * @param teams Map of team_id -> {name, owner_id} for that season.
 */
export function buildGame({ season, week, teamId, opponentId, rows, players, matchups, teams }) {
  const playerById = players instanceof Map ? players : new Map(players.map((p) => [p.player_id, p]));
  const weekRows = rows.filter((r) => r.week === week);
  const template = slotTemplate(weekRows);
  const keys = slotKeys(template);

  const decorate = (r) => {
    const p = playerById.get(r.player_id) ?? {};
    return {
      player_id: r.player_id,
      name: p.name ?? `Player ${r.player_id}`,
      position: p.position ?? '?',
      nfl_team: p.nfl_team ?? null,
      projected: r.projected,
      points: r.points ?? 0,
      started: !!r.started,
      slot: r.lineup_slot,
      team_id: r.team_id,
    };
  };

  const roster = weekRows
    .filter((r) => r.team_id === teamId && r.lineup_slot !== 'IR')
    .map(decorate);

  // Free agency, league style: anyone another team left on its bench that week.
  const pool = weekRows
    .filter((r) => r.team_id !== teamId && !r.started && r.lineup_slot !== 'IR' && r.points != null)
    .map((r) => {
      const from = teams.get(r.team_id);
      return { ...decorate(r), from_team: from?.name ?? `Team ${r.team_id}`, from_owner_id: from?.owner_id ?? null };
    })
    .sort((a, b) => (b.projected ?? 0) - (a.projected ?? 0));

  const scoreOf = (id) => {
    for (const m of matchups) {
      if (m.home_team_id === id) return m.home_score;
      if (m.away_team_id === id) return m.away_score;
    }
    return null;
  };

  const info = (id) => teams.get(id) ?? { name: `Team ${id}`, owner_id: null };
  return {
    season,
    week,
    you: { teamId, ...info(teamId), recorded: scoreOf(teamId) },
    opponent: { teamId: opponentId, ...info(opponentId), points: scoreOf(opponentId) ?? 0 },
    template,
    keys,
    roster,
    pool,
    actual: actualLineup(roster, keys),
    optimal: optimalLineup(roster, template),
  };
}
