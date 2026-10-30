// Turns one locked week into a live "broadcast" for Fourteen and Fantasy:
// the real NFL plays (data/plays/<season>.json, from nflverse play-by-play)
// that scored points for your starters and for the champion's starters,
// merged into one RedZone-style timeline by quarter and game clock.
//
// At the final whistle, whatever the plays don't explain lands as closing
// lines (a defense's points-allowed score, 100-yard bonuses, stat
// corrections), so the broadcast always ends on the exact real totals.
//
// Plain JavaScript so web/tests can run it with node:test.

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * @param plays      the season's plays file (or null)
 * @param week       week number
 * @param you        [{ player, points }] your starters
 * @param champ      [{ player, points }] the champion's starters
 * @param totals     { you, champ } real final scores
 * @returns { events, quarters } or null when there's no plays file
 */
export const MAX_HIGHLIGHTS = 8;
const BIG_KINDS = new Set(['I', 'F', 'G', 'g', '2', 'K', 'Y', 'B']);
const LONG_GAIN = 25;

/** A play worth replaying on the field: scores, turnovers, kicks, and long gains. */
export function isHighlight(field) {
  if (!field) return false;
  const [, , yards, kind, , , , td] = field;
  return td === 1 || BIG_KINDS.has(kind) || ((kind === 'P' || kind === 'R') && Math.abs(yards) >= LONG_GAIN);
}

export function buildBroadcast(plays, week, you, champ, totals) {
  if (!plays || !plays.weeks) return null;
  const byPlayer = plays.weeks[String(week)] ?? {};
  const raw = [];
  const finals = [];
  const line = (side, player, text, pts) => ({ side, qtr: 6, clock: 0, game: '', text, pts, play: `final:${side}:${player.player_id}`, player, field: null });

  const addSide = (side, starters) => {
    for (const { player, points } of starters) {
      if (!player) continue;
      const list = byPlayer[String(player.player_id)] ?? [];
      let sum = 0;
      for (const [qtr, clock, game, text, pts, play, field] of list) {
        sum += pts;
        raw.push({ side, qtr: Math.min(qtr, 5), clock, gameId: game, game: plays.games?.[game] ?? '', text, pts, play, player, field: field ?? null });
      }
      const rest = round2((points ?? 0) - sum);
      if (Math.abs(rest) < 0.05) continue;
      if (!list.length) finals.push(line(side, player, `${player.name}: stat line`, rest));
      else if (player.position === 'D/ST') finals.push(line(side, player, `${player.name}: points and yards allowed`, rest));
      else if (Math.abs(rest) >= 0.5) finals.push(line(side, player, `${player.name}: ${rest > 0 ? 'yardage bonus' : 'stat correction'}`, rest));
      // Smaller leftovers land in one "scoring adjustments" line per side below.
    }
  };
  addSide('you', you);
  addSide('champ', champ);

  // Highlights get replayed on the field; keep the biggest few each week so
  // a broadcast stays quick. Everything else folds into one line per player
  // per half ("Chubb · 7 carries, 41 yds · 1 catch, 6 yds").
  const ranked = raw.filter((e) => isHighlight(e.field)).sort((a, b) => Math.abs(b.pts) - Math.abs(a.pts));
  const keep = new Set(ranked.slice(0, MAX_HIGHLIGHTS).map((e) => `${e.side}|${e.play}`));
  // A shared play (QB to WR) stays a highlight for both players if either made the cut.
  const highlights = raw.filter((e) => keep.has(`${e.side}|${e.play}`));
  const folded = new Map();
  for (const e of raw) {
    if (keep.has(`${e.side}|${e.play}`)) continue;
    const half = e.qtr <= 2 ? 1 : 2;
    const key = `${e.side}|${e.player.player_id}|${half}`;
    const f = folded.get(key) ?? { side: e.side, qtr: e.qtr, clock: e.clock, gameId: e.gameId, game: e.game, parts: [], pts: 0, play: `fold:${key}`, player: e.player, field: null };
    f.parts.push(e.text);
    f.pts += e.pts;
    // The folded line lands at the time of the player's last play in that half.
    if (e.qtr > f.qtr || (e.qtr === f.qtr && e.clock < f.clock)) { f.qtr = e.qtr; f.clock = e.clock; }
    folded.set(key, f);
  }
  const foldText = (f) => {
    const name = f.player.position === 'D/ST' ? f.player.name.replace(' D/ST', '') : lastName(f.player.name);
    return `${name} · ${summarize(f.parts, name)}`;
  };
  const events = [
    ...highlights.map((e) => ({ ...e, highlight: true })),
    ...[...folded.values()].map((f) => ({ ...f, text: foldText(f), pts: round2(f.pts), highlight: false })),
  ];

  // Chronological across every game, as if all kicked off together.
  events.sort((a, b) => a.qtr - b.qtr || b.clock - a.clock || (a.side === b.side ? 0 : a.side === 'you' ? -1 : 1));

  // One side's entries for the same snap (a QB-to-WR touchdown on your team) are one moment.
  const merged = [];
  for (const e of events) {
    const prev = merged[merged.length - 1];
    if (prev && e.highlight && prev.highlight && prev.side === e.side && prev.play === e.play) {
      prev.pts = round2(prev.pts + e.pts);
      if (!prev.players.some((p) => p.player_id === e.player.player_id)) prev.players.push(e.player);
      prev.parts.push({ player: e.player, pts: e.pts, text: e.text });
      if (e.text.length > prev.text.length) prev.text = e.text;
      continue;
    }
    merged.push({ ...e, pts: round2(e.pts), players: [e.player], parts: [{ player: e.player, pts: e.pts, text: e.text }] });
  }
  for (const f of finals) merged.push({ ...f, highlight: false, players: [f.player], parts: [{ player: f.player, pts: f.pts, text: f.text }] });

  // Running score after each moment, and the quarter-by-quarter line score.
  let y = 0;
  let c = 0;
  const quarters = { you: [0, 0, 0, 0, 0], champ: [0, 0, 0, 0, 0] };
  for (const e of merged) {
    if (e.side === 'you') y += e.pts; else c += e.pts;
    const q = Math.min(e.qtr, 6) - 1;
    if (q < 5) quarters[e.side][q] = round2(quarters[e.side][q] + e.pts);
    e.score = { you: round2(y), champ: round2(c) };
    e.touchdown = e.highlight && (e.field?.[7] === 1 || /TD|touchdown/i.test(e.text));
    e.big = e.highlight;
  }
  // Guarantee the exact real totals (rounding, or a starter missing from the plays file).
  const fix = (side, total) => {
    const got = side === 'you' ? y : c;
    const diff = round2(total - got);
    if (Math.abs(diff) >= 0.01) {
      merged.push({ side, qtr: 6, clock: 0, game: '', text: 'Scoring adjustments', pts: diff, play: `fix:${side}`, players: [], parts: [], big: false, touchdown: false,
        highlight: false, field: null, score: { you: round2(side === 'you' ? y + diff : y), champ: round2(side === 'champ' ? c + diff : c) } });
      if (side === 'you') y += diff; else c += diff;
    }
  };
  fix('you', totals.you ?? y);
  fix('champ', totals.champ ?? c);
  return { events: merged, quarters, final: { you: round2(y), champ: round2(c) } };
}

/** One readable stat line from a player's folded plays: "7 carries, 41 yds · 2 catches, 18 yds". */
export function summarize(parts, name = '') {
  const t = { catches: 0, recYds: 0, carries: 0, rushYds: 0, passYds: 0 };
  const other = new Map();
  const count = (label) => other.set(label, (other.get(label) ?? 0) + 1);
  for (const text of parts) {
    let m;
    if ((m = text.match(/(\d+) catch(?:es)?, (-?\d+) yds/))) { t.catches += +m[1]; t.recYds += +m[2]; }
    else if ((m = text.match(/(\d+) carr(?:y|ies), (-?\d+) yds/))) { t.carries += +m[1]; t.rushYds += +m[2]; }
    else if ((m = text.match(/(-?\d+) passing yds/))) t.passYds += +m[1];
    else if ((m = text.match(/(-?\d+)-yd catch/))) { t.catches += 1; t.recYds += +m[1]; }
    else if ((m = text.match(/(-?\d+)-yd run/))) { t.carries += 1; t.rushYds += +m[1]; }
    else if ((m = text.match(/(-?\d+)-yd completion/))) t.passYds += +m[1];
    else if (/sack$/.test(text)) count('sack');
    else if (/extra point missed/.test(text)) count('missed PAT');
    else if (/extra point/.test(text)) count('PAT');
    else if (/interception$/.test(text)) count('INT');
    else if (/fumble recovery/.test(text)) count('fumble recovery');
    else count(name && text.startsWith(`${name} `) ? text.slice(name.length + 1) : text);
  }
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const bits = [];
  if (t.passYds) bits.push(`${t.passYds} passing yds`);
  if (t.carries) bits.push(`${plural(t.carries, 'carry', 'carries')}, ${t.rushYds} yds`);
  if (t.catches) bits.push(`${plural(t.catches, 'catch', 'catches')}, ${t.recYds} yds`);
  for (const [label, n] of other) bits.push(n > 1 ? `${n} ${label === 'sack' ? 'sacks' : label === 'PAT' ? 'PATs' : label}` : label);
  return bits.join(' · ');
}

function lastName(name) {
  const parts = name.split(' ').filter((p) => !/^(Jr\.?|Sr\.?|II|III|IV|V)$/.test(p));
  return parts[parts.length - 1] ?? name;
}

/** "BAL 33" / "PIT 33" / "50": where the ball is, NFL style. */
export function spotLabel(offense, defense, yardline100) {
  if (yardline100 === 50) return '50';
  return yardline100 > 50 ? `${offense} ${100 - yardline100}` : `${defense} ${yardline100}`;
}

/** "3rd & 2", "1st & Goal". */
export function downLabel(down, togo, yardline100) {
  if (!down) return '';
  const nth = ['', '1st', '2nd', '3rd', '4th'][down] ?? `${down}th`;
  return `${nth} & ${togo != null && togo >= yardline100 ? 'Goal' : togo ?? ''}`;
}

/** "Q2 7:55", "OT 3:10", "Final". */
export function clockLabel(qtr, clock) {
  if (qtr >= 6) return 'Final';
  const m = Math.floor(clock / 60);
  const s = String(clock % 60).padStart(2, '0');
  return `${qtr === 5 ? 'OT' : `Q${qtr}`} ${m}:${s}`;
}
