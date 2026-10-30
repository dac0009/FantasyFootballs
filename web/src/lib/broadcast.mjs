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
export function buildBroadcast(plays, week, you, champ, totals) {
  if (!plays || !plays.weeks) return null;
  const byPlayer = plays.weeks[String(week)] ?? {};
  const events = [];
  const finals = [];
  const line = (side, player, text, pts) => ({ side, qtr: 6, clock: 0, game: '', text, pts, play: `final:${side}:${player.player_id}`, player });

  const addSide = (side, starters) => {
    for (const { player, points } of starters) {
      if (!player) continue;
      const list = byPlayer[String(player.player_id)] ?? [];
      let sum = 0;
      for (const [qtr, clock, game, text, pts, play] of list) {
        sum += pts;
        events.push({ side, qtr: Math.min(qtr, 5), clock, game: plays.games?.[game] ?? '', text, pts, play, player });
      }
      const rest = round2((points ?? 0) - sum);
      if (Math.abs(rest) < 0.05) continue;
      if (!list.length) {
        finals.push(line(side, player, `${player.name}: stat line`, rest));
      } else if (player.position === 'D/ST') {
        finals.push(line(side, player, `${player.name}: points and yards allowed`, rest));
      } else if (Math.abs(rest) >= 0.5) {
        finals.push(line(side, player, `${player.name}: ${rest > 0 ? 'yardage bonus' : 'stat correction'}`, rest));
      }
      // Smaller leftovers fold into one "scoring adjustments" line per side below.
    }
  };
  addSide('you', you);
  addSide('champ', champ);

  // Chronological across every game, as if all kicked off together.
  events.sort((a, b) => a.qtr - b.qtr || b.clock - a.clock || (a.side === b.side ? 0 : a.side === 'you' ? -1 : 1));

  // Merge one side's entries for the same play (a QB-to-WR touchdown on your team is one moment).
  const merged = [];
  for (const e of events) {
    const prev = merged[merged.length - 1];
    if (prev && prev.side === e.side && prev.play === e.play && !e.play.includes(':rec:') && !e.play.includes(':rush:') && !e.play.includes(':pass:')) {
      prev.pts = round2(prev.pts + e.pts);
      prev.players.push(e.player);
      prev.parts.push({ player: e.player, pts: e.pts, text: e.text });
      if (e.text.length > prev.text.length) prev.text = e.text;
      continue;
    }
    merged.push({ ...e, pts: round2(e.pts), players: [e.player], parts: [{ player: e.player, pts: e.pts, text: e.text }] });
  }
  for (const f of finals) merged.push({ ...f, players: [f.player], parts: [{ player: f.player, pts: f.pts, text: f.text }] });

  // Running score after each moment, and the quarter-by-quarter line score.
  let y = 0;
  let c = 0;
  const quarters = { you: [0, 0, 0, 0, 0], champ: [0, 0, 0, 0, 0] };
  for (const e of merged) {
    if (e.side === 'you') y += e.pts; else c += e.pts;
    const q = Math.min(e.qtr, 6) - 1;
    if (q < 5) quarters[e.side][q] = round2(quarters[e.side][q] + e.pts);
    e.score = { you: round2(y), champ: round2(c) };
    e.big = /TD|touchdown|two-point|intercept|fumble|safety|blocked|field goal/i.test(e.text) || Math.abs(e.pts) >= 6;
    e.touchdown = /TD|touchdown/i.test(e.text);
  }
  // Guarantee the exact real totals (rounding, or a starter missing from the plays file).
  const fix = (side, total) => {
    const got = side === 'you' ? y : c;
    const diff = round2(total - got);
    if (Math.abs(diff) >= 0.01) {
      merged.push({ side, qtr: 6, clock: 0, game: '', text: 'Scoring adjustments', pts: diff, play: `fix:${side}`, players: [], parts: [], big: false, touchdown: false,
        score: { you: round2(side === 'you' ? y + diff : y), champ: round2(side === 'champ' ? c + diff : c) } });
      if (side === 'you') y += diff; else c += diff;
    }
  };
  fix('you', totals.you ?? y);
  fix('champ', totals.champ ?? c);
  return { events: merged, quarters, final: { you: round2(y), champ: round2(c) } };
}

/** "Q2 7:55", "OT 3:10", "Final". */
export function clockLabel(qtr, clock) {
  if (qtr >= 6) return 'Final';
  const m = Math.floor(clock / 60);
  const s = String(clock % 60).padStart(2, '0');
  return `${qtr === 5 ? 'OT' : `Q${qtr}`} ${m}:${s}`;
}
