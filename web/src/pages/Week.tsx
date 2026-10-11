import { Link, useParams } from "react-router-dom";
import { Scoreboard } from "../components/Scoreboard";
import { StatTable, type Column } from "../components/StatTable";
import { Band, Empty, ErrorState, Figure, Loading, OwnerLink, WeekLink } from "../components/primitives";
import { useRoster, useSeason, usePlayers } from "../lib/data";
import { gameTypeLabel, points, signClass, signed } from "../lib/format";
import type { WeekLeaderboardRow, WeekPayload } from "../lib/types";

export default function Week() {
  const { year, week } = useParams();
  const season = useSeason(year ?? null);
  const weekNumber = Number(week);

  if (season.state === "loading") return <Loading what="that week" />;
  if (season.state === "error") return <ErrorState error={season.error} what="That week" />;

  const data = season.data;
  const payload = data.weeks.find((w) => w.week === weekNumber);
  if (!payload) {
    return (
      <div className="shell" style={{ paddingTop: "2.5rem" }}>
        <h1 style={{ fontSize: "1.5rem" }}>Week {week} was not played in {year}</h1>
        <p className="prose-narrow" style={{ marginTop: "0.6rem" }}>
          This season ran {data.scheduled_weeks[0]} to{" "}
          {data.scheduled_weeks[data.scheduled_weeks.length - 1]}.{" "}
          <Link to={`/seasons/${year}`} className="link-quiet">
            Back to {year}
          </Link>
        </p>
      </div>
    );
  }

  const index = data.scheduled_weeks.indexOf(weekNumber);
  const previous = index > 0 ? data.scheduled_weeks[index - 1] : null;
  const next = index >= 0 && index < data.scheduled_weeks.length - 1 ? data.scheduled_weeks[index + 1] : null;

  return (
    <div className="shell" style={{ paddingTop: "2.2rem" }}>
      <p style={{ color: "var(--color-brass)", fontSize: "0.82rem", fontWeight: 600, margin: 0 }}>
        <Link to={`/seasons/${data.season}`} className="link-quiet">
          {data.season} season
        </Link>
      </p>
      <div style={{ display: "flex", alignItems: "baseline", gap: "1.2rem", flexWrap: "wrap" }}>
        <h1 style={{ fontSize: "clamp(1.8rem, 6vw, 2.8rem)", marginTop: "0.3rem" }}>
          Week {payload.week}
        </h1>
        <nav className="pill-row" aria-label="Week navigation">
          {previous ? (
            <WeekLink season={data.season} week={previous}>
              <span className="pill">Week {previous}</span>
            </WeekLink>
          ) : null}
          {next ? (
            <WeekLink season={data.season} week={next}>
              <span className="pill">Week {next}</span>
            </WeekLink>
          ) : null}
        </nav>
      </div>

      {!payload.has_results ? (
        <Empty>These games have not been played yet.</Empty>
      ) : (
        <div className="week-figures">
          <Figure value={points(payload.summary.league_mean, 1)} label="League average" size="1.5rem" />
          <Figure value={points(payload.summary.league_median, 1)} label="Median score" size="1.5rem" />
          <Figure value={points(payload.summary.league_stdev, 1)} label="Standard deviation" size="1.5rem" />
          <Figure value={payload.summary.teams_played} label="Teams played" size="1.5rem" />
        </div>
      )}

      <Band title="Matchups" note={payload.has_results ? undefined : "Scheduled"} />
      <Scoreboard matchups={payload.matchups} showType />

      {payload.has_results ? (
        <>
          <Band title="Week rankings" note="Every team, by score" />
          <WeekLeaderboard payload={payload} season={data.season} />

          <Band title="Week extremes" />
          <div className="extreme-grid">
            <Extreme
              label="Highest score"
              primary={payload.summary.high?.team_name}
              ownerId={payload.summary.high?.owner_id}
              value={points(payload.summary.high?.score, 2)}
              detail={`beat ${payload.summary.high?.opponent_team_name}`}
            />
            <Extreme
              label="Lowest score"
              primary={payload.summary.low?.team_name}
              ownerId={payload.summary.low?.owner_id}
              value={points(payload.summary.low?.score, 2)}
              detail={`against ${payload.summary.low?.opponent_team_name}`}
            />
            <Extreme
              label="Highest score in a loss"
              primary={payload.summary.highest_score_in_loss?.team_name}
              value={points(payload.summary.highest_score_in_loss?.score, 2)}
              detail={`lost to ${payload.summary.highest_score_in_loss?.opponent_team_name} (${points(
                payload.summary.highest_score_in_loss?.opponent_score,
                2,
              )})`}
            />
            <Extreme
              label="Lowest score in a win"
              primary={payload.summary.lowest_score_in_win?.team_name}
              value={points(payload.summary.lowest_score_in_win?.score, 2)}
              detail={`beat ${payload.summary.lowest_score_in_win?.opponent_team_name} (${points(
                payload.summary.lowest_score_in_win?.opponent_score,
                2,
              )})`}
            />
            <Extreme
              label="Biggest blowout"
              primary={`${payload.summary.biggest_blowout?.home_team_name} v ${payload.summary.biggest_blowout?.away_team_name}`}
              value={points(payload.summary.biggest_blowout?.margin, 2)}
              detail="point margin"
            />
            <Extreme
              label="Closest matchup"
              primary={`${payload.summary.closest_game?.home_team_name} v ${payload.summary.closest_game?.away_team_name}`}
              value={points(payload.summary.closest_game?.margin, 2)}
              detail="point margin"
            />
            <Extreme
              label="Highest-scoring matchup"
              primary={`${payload.summary.highest_combined?.home_team_name} v ${payload.summary.highest_combined?.away_team_name}`}
              value={points(payload.summary.highest_combined?.combined, 2)}
              detail="combined points"
            />
            <Extreme
              label="Lowest-scoring matchup"
              primary={`${payload.summary.lowest_combined?.home_team_name} v ${payload.summary.lowest_combined?.away_team_name}`}
              value={points(payload.summary.lowest_combined?.combined, 2)}
              detail="combined points"
            />
          </div>

          <WeekRosterHighlights season={data.season} week={payload.week} />
        </>
      ) : null}

      <style>{`
        .week-figures {
          display: grid; grid-template-columns: repeat(2, 1fr); gap: 1.2rem 1rem;
          margin-top: 1.6rem; padding-top: 1.3rem; border-top: 1px solid var(--color-line);
        }
        @media (min-width: 720px) { .week-figures { grid-template-columns: repeat(4, 1fr); } }
        .extreme-grid { display: grid; gap: 0; margin-top: 0.8rem; }
        @media (min-width: 760px) { .extreme-grid { grid-template-columns: 1fr 1fr; gap: 0 2.5rem; } }
      `}</style>
    </div>
  );
}

function Extreme({
  label,
  primary,
  ownerId,
  value,
  detail,
}: {
  label: string;
  primary?: string | null;
  ownerId?: string | null;
  value: string;
  detail?: string;
}) {
  if (!primary) return null;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto",
        gap: "0.3rem 1rem",
        padding: "0.65rem 0",
        borderBottom: "1px solid var(--color-line-soft)",
        alignItems: "baseline",
      }}
    >
      <div>
        <div style={{ color: "var(--color-low)", fontSize: "0.74rem" }}>{label}</div>
        <div>{ownerId ? <OwnerLink ownerId={ownerId}>{primary}</OwnerLink> : primary}</div>
        {detail ? (
          <div style={{ color: "var(--color-low)", fontSize: "0.78rem" }}>{detail}</div>
        ) : null}
      </div>
      <div className="figure" style={{ fontSize: "1.2rem" }}>
        {value}
      </div>
    </div>
  );
}

function WeekLeaderboard({ payload, season }: { payload: WeekPayload; season: number }) {
  const columns: Column<WeekLeaderboardRow>[] = [
    {
      key: "team",
      header: "Team",
      align: "left",
      sortValue: (r) => r.rank,
      cell: (r) => (
        <span style={{ display: "inline-flex", gap: "0.5rem", alignItems: "baseline" }}>
          <span style={{ color: "var(--color-low)", minWidth: "1.1rem" }}>{r.rank}</span>
          <OwnerLink ownerId={r.owner_id}>{r.team_name}</OwnerLink>
        </span>
      ),
    },
    { key: "score", header: "Score", sortValue: (r) => r.score, bar: (r) => r.score, cell: (r) => points(r.score) },
    { key: "result", header: "Result", sortValue: (r) => r.result, cell: (r) => r.result },
    {
      key: "opp",
      header: "Opponent",
      align: "right",
      sortValue: (r) => r.opponent_team_name,
      cell: (r) => <OwnerLink ownerId={r.opponent_owner_id}>{r.opponent_team_name}</OwnerLink>,
    },
    { key: "oppScore", header: "Opp score", sortValue: (r) => r.opponent_score, cell: (r) => points(r.opponent_score) },
    {
      key: "diff",
      header: "Margin",
      sortValue: (r) => r.score - r.opponent_score,
      cell: (r) => (
        <span className={signClass(r.score - r.opponent_score)}>{signed(r.score - r.opponent_score)}</span>
      ),
    },
    {
      key: "type",
      header: "Type",
      sortValue: (r) => r.game_type,
      cell: (r) => gameTypeLabel(r.game_type),
      secondary: true,
    },
  ];
  return (
    <StatTable
      rows={payload.leaderboard}
      columns={columns}
      rowKey={(r) => r.owner_id}
      caption={`${season} week ${payload.week} rankings`}
    />
  );
}

/** Lineup-level highlights, only rendered when ESPN gave us roster data. */
function WeekRosterHighlights({ season, week }: { season: number; week: number }) {
  const roster = useRoster(season);
  const players = usePlayers();
  if (roster.state !== "ready" || players.state !== "ready") return null;

  const rows = roster.data.filter((r) => r.week === week && r.points !== null);
  if (!rows.length) return null;

  const byId = new Map(players.data.map((p) => [p.player_id, p]));
  const starters = rows.filter((r) => r.started).sort((a, b) => (b.points ?? 0) - (a.points ?? 0));
  const bench = rows.filter((r) => !r.started).sort((a, b) => (b.points ?? 0) - (a.points ?? 0));

  const render = (list: typeof rows, title: string, note: string) => (
    <section>
      <h3 style={{ fontSize: "0.95rem", marginBottom: "0.5rem" }}>{title}</h3>
      <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {list.slice(0, 6).map((row) => {
          const player = byId.get(row.player_id);
          return (
            <li
              key={`${row.team_id}-${row.player_id}`}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: "1rem",
                padding: "0.4rem 0",
                borderBottom: "1px solid var(--color-line-soft)",
                fontSize: "0.86rem",
              }}
            >
              <span>
                {player?.name ?? `Player ${row.player_id}`}
                <span style={{ color: "var(--color-low)" }}>
                  {" "}
                  {player?.position}
                  {player?.nfl_team ? `, ${player.nfl_team}` : ""}
                </span>
                <span style={{ color: "var(--color-low)", display: "block", fontSize: "0.78rem" }}>
                  <OwnerLink ownerId={row.owner_id}>roster</OwnerLink>, {row.lineup_slot}
                </span>
              </span>
              <span className="figure" style={{ fontSize: "1rem" }}>
                {points(row.points)}
              </span>
            </li>
          );
        })}
      </ol>
      <p style={{ color: "var(--color-low)", fontSize: "0.74rem", marginTop: "0.4rem" }}>{note}</p>
    </section>
  );

  return (
    <>
      <Band title="Player highlights" note="From ESPN lineup data for this week" />
      <div className="roster-split">
        {render(starters, "Best starters", "Highest-scoring started players")}
        {render(bench, "Best bench performances", "Points that never made it into a lineup")}
      </div>
      <style>{`
        .roster-split { display: grid; gap: 1.6rem 2.5rem; margin-top: 1rem; }
        @media (min-width: 760px) { .roster-split { grid-template-columns: 1fr 1fr; } }
      `}</style>
    </>
  );
}
