import { ScoreRanking } from "../components/charts/ScoreRanking";
import { StandingsTable } from "../components/StandingsTable";
import { AboveAverageGrid } from "../components/AboveAverage";
import { DivergingBars } from "../components/charts/DivergingBars";
import { QuadrantScatter } from "../components/charts/QuadrantScatter";
import { WeeklyLines, type WeeklyPoint } from "../components/charts/WeeklyLines";
import { Band, ErrorState, Loading, Metric, OwnerLink } from "../components/primitives";
import { useSeason } from "../lib/data";
import { points, signed, signClass } from "../lib/format";
import type { Meta, SeasonPayload } from "../lib/types";

export default function CurrentSeason({ meta }: { meta: Meta }) {
  const season = useSeason(meta.current_season);
  if (season.state === "loading") return <Loading what="the current season" />;
  if (season.state === "error") return <ErrorState error={season.error} what="The current season" />;
  return <SeasonAnalytics data={season.data} title={`${meta.current_season} season analytics`} />;
}

/** Shared by the current-season page and each archived season page. */
export function SeasonAnalytics({ data, title }: { data: SeasonPayload; title: string }) {
  const { standings, weekly_series, meta: seasonMeta } = data;
  const teams = standings.map((r) => r.team_name ?? r.owner_id);

  const weeks = Array.from(new Set(weekly_series.map((r) => r.week))).sort((a, b) => a - b);
  const nameByOwner = new Map(standings.map((r) => [r.owner_id, r.team_name ?? r.owner_id]));
  const lineData: WeeklyPoint[] = weeks.map((week) => {
    const row: WeeklyPoint = { week };
    for (const entry of weekly_series.filter((r) => r.week === week)) {
      const name = nameByOwner.get(entry.owner_id);
      if (name) row[name] = entry.score;
    }
    return row;
  });

  // For each team, each week: did they beat the league average that week, and
  // did they win? This is the "record against the league" that the
  // schedule-luck number summarises, shown game by game. Regular season only.
  const aboveAverage = standings.map((row) => {
    const weeksForTeam = weekly_series
      .filter((r) => r.owner_id === row.owner_id && r.game_type === "regular")
      .sort((a, b) => a.week - b.week)
      .map((r) => ({
        week: r.week,
        diff: r.score - (r.league_mean ?? r.score),
        beat: r.score >= (r.league_mean ?? r.score),
        won: r.result === "W",
        tied: r.result === "T",
      }));
    const beats = weeksForTeam.filter((w) => w.beat).length;
    return {
      ownerId: row.owner_id,
      name: row.team_name ?? row.owner_id,
      record: row.record,
      weeks: weeksForTeam,
      beats,
      total: weeksForTeam.length,
      aboveRecord: `${beats}-${weeksForTeam.length - beats}`,
    };
  });
  // Sort by how far their league-average record diverges from reality: the
  // teams whose luck story is most dramatic sit at the top.
  const realWins = new Map(standings.map((r) => [r.owner_id, r.wins + 0.5 * r.ties]));
  aboveAverage.sort(
    (a, b) =>
      Math.abs(b.beats - (realWins.get(b.ownerId) ?? 0)) -
      Math.abs(a.beats - (realWins.get(a.ownerId) ?? 0)),
  );

  return (
    <div className="shell" style={{ paddingTop: "2.2rem" }}>
      <h1 style={{ fontSize: "clamp(1.6rem, 4vw, 2.2rem)" }}>{title}</h1>
      <p className="prose-narrow" style={{ marginTop: "0.6rem" }}>
        {seasonMeta.team_count} teams, {seasonMeta.regular_season_weeks}-week regular season
        {seasonMeta.playoff_team_count ? `, ${seasonMeta.playoff_team_count}-team playoff` : ""}.
        Records and rate statistics below cover the regular season only; postseason games appear
        separately on the season page.
      </p>

      <Band title="Standings and advanced metrics" note="Switch views, or sort any column" />
      <StandingsTable rows={standings} season={data.season} />

      <Band title="The scoring race" note="Average points per game" />
      <ScoreRanking rows={standings.filter(r=>r.avg_score!==null).map(r=>({id:r.owner_id,name:r.team_name ?? r.owner_id,score:r.avg_score!}))} mean={data.league_scoring.mean ?? 0} caption="Regular-season scoring" />
      <Band
        title="Points for against points against"
        note="The quadrant a team sits in says more than its record"
      />
      <div style={{ marginTop: "1rem" }}>
        <QuadrantScatter rows={standings} />
      </div>

      <Band
        title="Record versus the league"
        note={
          <>
            <Metric name="schedule_luck">Schedule luck</Metric>, and every team's week-by-week
            record against the league average
          </>
        }
      />
      <div className="season-split" style={{ marginTop: "1rem" }}>
        <DivergingBars
          data={standings
            .filter((r) => r.schedule_luck !== null)
            .map((r) => ({
              name: r.team_name ?? r.owner_id,
              value: r.schedule_luck as number,
              detail: `${r.record}, expected ${points(r.expected_wins, 1)}`,
            }))}
          axisLabel="Wins above or below expected"
          negativeLabel="Unlucky"
          positiveLabel="Lucky"
        />

      </div>

      <Band title="Every team, every week" note="Points relative to the weekly league average" />
      <AboveAverageGrid rows={aboveAverage} />

      <Band title="Weekly scoring" note="Select a team to isolate its line" />
      <div style={{ marginTop: "1rem" }}>
        <WeeklyLines data={lineData} teams={teams} leagueMean={data.league_scoring.mean} />
      </div>

      <Band title="Season leaders" note="Top five in each category" />
      <div className="leader-grid">
        {data.leaders.map((board) => (
          <section key={board.id}>
            <h3 style={{ fontSize: "0.95rem", marginBottom: "0.5rem" }}>{board.label}</h3>
            <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {board.entries.map((entry, index) => (
                <li
                  key={entry.owner_id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "0.8rem",
                    padding: "0.3rem 0",
                    borderBottom: "1px solid var(--color-line-soft)",
                    fontSize: "0.85rem",
                  }}
                >
                  <span style={{ color: index === 0 ? "var(--color-hi)" : "var(--color-mid)" }}>
                    <OwnerLink ownerId={entry.owner_id}>{entry.team_name}</OwnerLink>
                  </span>
                  <span className={board.id.startsWith("schedule_luck") ? signClass(entry.value) : ""}>
                    {board.id.startsWith("schedule_luck") || board.id.startsWith("sos")
                      ? signed(entry.value, 2)
                      : points(entry.value, board.unit === "win %" ? 2 : 1)}
                  </span>
                </li>
              ))}
            </ol>
            <p style={{ color: "var(--color-low)", fontSize: "0.72rem", marginTop: "0.35rem" }}>
              {board.unit}
            </p>
          </section>
        ))}
      </div>

      <style>{`
        .season-split { display: grid; gap: 1.8rem; }
        @media (min-width: 1000px) { .season-split { grid-template-columns: 1fr; align-items: start; } }
        .leader-grid { display: grid; gap: 1.6rem 2rem; margin-top: 1.2rem; grid-template-columns: 1fr; }
        @media (min-width: 620px) { .leader-grid { grid-template-columns: repeat(2, 1fr); } }
        @media (min-width: 980px) { .leader-grid { grid-template-columns: repeat(4, 1fr); } }
      `}</style>
    </div>
  );
}
