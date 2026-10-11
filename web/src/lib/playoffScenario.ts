import type { Matchup, PlayoffPicture, StandingsRow } from "./types";

export type Picks = Record<string, "HOME" | "AWAY">;
export interface ScenarioRow { ownerId: string; name: string; odds: number; wins: number; seeds: number[] }

/** Seeded, paired draws keep comparisons stable when one pick changes. */
export function simulateScenario(standings: StandingsRow[], games: Matchup[], picture: PlayoffPicture,
  picks: Picks, iterations = 3000): ScenarioRow[] {
  if (iterations < 1) throw new Error("At least one simulation is required");
  let seed = 24681357;
  const random = () => { seed = (Math.imul(1664525, seed) + 1013904223) >>> 0; return (seed + 1) / 4294967297; };
  const normal = () => Math.sqrt(-2 * Math.log(random())) * Math.cos(2 * Math.PI * random());
  const ids = new Map(standings.map((row, i) => [row.owner_id, i]));
  const models = new Map(picture.teams.map(team => [team.owner_id, team.model]));
  const schedule = games.filter(g => !g.completed && !g.is_bye && g.game_type === "regular" &&
    g.season === picture.season && ids.has(g.home_owner_id ?? "") && ids.has(g.away_owner_id ?? ""));
  const results = standings.map(row => ({ ownerId: row.owner_id, name: row.team_name ?? row.owner_id,
    odds: 0, wins: 0, seeds: Array(standings.length).fill(0) as number[] }));
  for (let run = 0; run < iterations; run++) {
    const wins = standings.map(row => row.wins + row.ties * 0.5);
    const pf = standings.map(row => row.points_for ?? 0);
    for (const game of schedule) {
      const h = ids.get(game.home_owner_id!)!, a = ids.get(game.away_owner_id!)!;
      const hm = models.get(game.home_owner_id!)!, am = models.get(game.away_owner_id!)!;
      if (!hm || !am) throw new Error("Scoring model missing for a scheduled owner");
      const hs = hm.mean + hm.sd * normal(), as = am.mean + am.sd * normal();
      const forced = picks[game.matchup_id];
      // A picked winner changes the result; expected scores stand in for unknown PF.
      pf[h] += forced ? hm.mean : hs; pf[a] += forced ? am.mean : as;
      if (forced === "HOME" || (!forced && hs > as)) wins[h]++;
      else if (forced === "AWAY" || (!forced && as > hs)) wins[a]++;
      else { wins[h] += 0.5; wins[a] += 0.5; }
    }
    const order = standings.map((_, i) => i).sort((a, b) => wins[b] - wins[a] || pf[b] - pf[a] ||
      standings[a].owner_id.localeCompare(standings[b].owner_id));
    order.forEach((i, rank) => {
      if (rank < picture.playoff_teams) results[i].odds++;
      results[i].wins += wins[i]; results[i].seeds[rank]++;
    });
  }
  return results.map(row => ({ ...row, odds: row.odds / iterations, wins: row.wins / iterations,
    seeds: row.seeds.map(n => n / iterations) })).sort((a,b) => b.odds-a.odds || b.wins-a.wins);
}
