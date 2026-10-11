import { Link, useParams } from "react-router-dom";
import { StatTable, type Column } from "../components/StatTable";
import { WeeklyLines, type WeeklyPoint } from "../components/charts/WeeklyLines";
import {
  Band,
  Empty,
  ErrorState,
  Figure,
  Loading,
  Metric,
  OwnerLink,
  RivalryLink,
  WeekLink,
} from "../components/primitives";
import { useOwner } from "../lib/data";
import { gameTypeLabel, ordinal, pct, points, signClass, signed, total } from "../lib/format";
import type { OpponentRow, OwnerSeasonRow, WeekRef } from "../lib/types";

export default function Owner() {
  const { ownerId } = useParams();
  const owner = useOwner(ownerId ?? null);

  if (owner.state === "loading") return <Loading what="this owner" />;
  if (owner.state === "error") return <ErrorState error={owner.error} what="This owner" />;

  const data = owner.data;

  const seasonColumns: Column<OwnerSeasonRow>[] = [
    {
      key: "season",
      header: "Season",
      align: "left",
      sortValue: (r) => r.season,
      cell: (r) => (
        <span>
          <Link to={`/seasons/${r.season}`} className="link-quiet">
            {r.season}
          </Link>
          <span style={{ color: "var(--color-low)", display: "block", fontSize: "0.78rem" }}>
            {r.team_name}
          </span>
        </span>
      ),
    },
    { key: "record", header: "Record", sortValue: (r) => r.wins + 0.5 * r.ties, cell: (r) => r.record },
    { key: "pct", header: "Win %", sortValue: (r) => r.win_pct, cell: (r) => pct(r.win_pct) },
    { key: "pf", header: "PF", sortValue: (r) => r.points_for, cell: (r) => total(r.points_for), bar: (r) => r.points_for },
    { key: "pa", header: "PA", sortValue: (r) => r.points_against, cell: (r) => total(r.points_against), secondary: true },
    { key: "avg", header: "Avg", sortValue: (r) => r.avg_score, cell: (r) => points(r.avg_score, 1) },
    {
      key: "allplay",
      header: <Metric name="all_play">All-play</Metric>,
      sortValue: (r) => r.all_play_win_pct,
      cell: (r) => pct(r.all_play_win_pct),
      secondary: true,
    },
    {
      key: "luck",
      header: <Metric name="schedule_luck">Luck</Metric>,
      sortValue: (r) => r.schedule_luck,
      cell: (r) => <span className={signClass(r.schedule_luck)}>{signed(r.schedule_luck, 1)}</span>,
    },
    {
      key: "finish",
      header: "Finish",
      sortValue: (r) => r.final_rank,
      cell: (r) => (
        <span>
          {ordinal(r.final_rank)}
          {r.is_champion ? <span className="tag tag-champ" style={{ marginLeft: "0.4rem" }}>Title</span> : null}
        </span>
      ),
    },
  ];

  const opponentColumns: Column<OpponentRow>[] = [
    {
      key: "opponent",
      header: "Opponent",
      align: "left",
      sortValue: (r) => r.opponent_name,
      cell: (r) => <OwnerLink ownerId={r.opponent_owner_id}>{r.opponent_name}</OwnerLink>,
    },
    { key: "games", header: "Meetings", sortValue: (r) => r.games, cell: (r) => r.games },
    { key: "record", header: "Record", sortValue: (r) => r.win_pct, cell: (r) => r.record },
    { key: "pct", header: "Win %", sortValue: (r) => r.win_pct, cell: (r) => pct(r.win_pct), bar: (r) => r.win_pct },
    {
      key: "rivalry",
      header: <Metric name="rivalry_index">Rivalry</Metric>,
      sortValue: (r) => r.rivalry_index,
      cell: (r) => points(r.rivalry_index, 1),
      secondary: true,
    },
    {
      key: "open",
      header: "",
      align: "right",
      cell: (r) => (
        <RivalryLink a={data.owner_id} b={r.opponent_owner_id}>
          History
        </RivalryLink>
      ),
    },
  ];

  const seasonsPlayed = data.seasons ?? [];
  const lineData: WeeklyPoint[] = seasonsPlayed.map((season) => {
    const rows = data.weekly_history.filter((r) => r.season === season && r.game_type === "regular");
    const avg = rows.length ? rows.reduce((sum, r) => sum + r.score, 0) / rows.length : null;
    return { week: season, [data.name]: avg };
  });

  return (
    <div className="shell" style={{ paddingTop: "2.2rem" }}>
      <p style={{ color: "var(--color-brass)", fontSize: "0.82rem", fontWeight: 600, margin: 0 }}>
        Owner profile
      </p>
      <h1 style={{ fontSize: "clamp(1.9rem, 6vw, 3rem)", marginTop: "0.35rem" }}>{data.name}</h1>
      <p style={{ color: "var(--color-mid)", marginTop: "0.4rem" }}>
        {data.current_team_name}
        {data.seasons_played ? `, ${data.seasons_played} seasons, ${data.first_season}\u2013${data.last_season}` : ""}
      </p>
      {data.rival ? (
        <div className="rival-plate">
          <span className="rival-label">
            {data.rival.reciprocal ? "Rivalry" : "Chief rival"}
          </span>
          <span className="rival-name">
            <RivalryLink a={data.owner_id} b={data.rival.rival_owner_id}>
              {data.rival.rival_name}
            </RivalryLink>
          </span>
          <span className="rival-series">
            {data.rival.record} all-time
            {data.rival.current_streak.length
              ? data.rival.current_streak.owner_id === data.owner_id
                ? `, won last ${data.rival.current_streak.length}`
                : `, lost last ${data.rival.current_streak.length}`
              : ""}
            {!data.rival.reciprocal ? ", though they'd name someone else" : ""}
          </span>
        </div>
      ) : null}
      {data.note ? <p className="notice" style={{ marginTop: "0.9rem" }}>{data.note}</p> : null}
      {data.unlinked ? (
        <p className="notice" style={{ marginTop: "0.9rem" }}>
          ESPN did not link this team to a member account, so this profile covers only the seasons
          where that team id appeared. Merge it with a real owner in <code>config/owners.yml</code>.
        </p>
      ) : null}

      <div className="owner-figures">
        <Figure value={data.record} label="Career record (regular season)" size="1.7rem" />
        <Figure value={pct(data.win_pct)} label="Win percentage" size="1.7rem" />
        <Figure
          value={data.championships || "\u2014"}
          label={data.championships === 1 ? "Championship" : "Championships"}
          size="1.7rem"
          tone={data.championships ? "var(--color-brass)" : undefined}
        />
        <Figure value={data.playoff_appearances || "\u2014"} label="Playoff appearances" size="1.7rem" />
        <Figure value={total(data.points_for)} label="Career points for" size="1.7rem" />
        <Figure value={points(data.avg_score, 1)} label="Points per game" size="1.7rem" />
        <Figure value={ordinal(data.best_finish)} label="Best finish" size="1.7rem" />
        <Figure value={points(data.avg_finish, 1)} label="Average finish" size="1.7rem" />
      </div>

      <Band title="Team names" note="The same owner, every franchise identity" />
      <ol className="timeline">
        {data.team_name_timeline.map((row, index) => {
          const previous = data.team_name_timeline[index - 1];
          const renamed = previous && previous.team_name !== row.team_name;
          return (
            <li key={`${row.season}-${row.team_id}`}>
              <Link to={`/seasons/${row.season}`} className="timeline-year">
                {row.season}
              </Link>
              <span style={{ color: renamed || index === 0 ? "var(--color-hi)" : "var(--color-mid)" }}>
                {row.team_name}
              </span>
              {renamed ? <span className="tag">Renamed</span> : <span />}
            </li>
          );
        })}
      </ol>

      <Band title="Season by season" />
      <StatTable
        rows={data.seasons_detail}
        columns={seasonColumns}
        rowKey={(r) => String(r.season)}
        initialSort={{ key: "season", direction: "desc" }}
        caption={`${data.name} season by season`}
      />

      <Band title="Career highs and lows" />
      <div className="highlight-grid">
        <Highlight label="Best week" week={data.best_week} />
        <Highlight label="Worst week" week={data.worst_week} />
        <Highlight label="Biggest win" week={data.biggest_win} />
        <Highlight label="Worst loss" week={data.worst_loss} />
      </div>

      <div className="owner-split" style={{ marginTop: "1.6rem" }}>
        <div>
          <h3 style={{ fontSize: "0.95rem", marginBottom: "0.5rem" }}>Best season</h3>
          {data.best_season ? (
            <p style={{ color: "var(--color-mid)", fontSize: "0.9rem", margin: 0 }}>
              <Link to={`/seasons/${data.best_season.season}`} className="link-quiet">
                {data.best_season.season}
              </Link>{" "}
              as {data.best_season.team_name} &mdash; {data.best_season.record},{" "}
              {total(data.best_season.points_for)} points, finished{" "}
              {ordinal(data.best_season.final_rank)}
            </p>
          ) : (
            <Empty>No seasons on record.</Empty>
          )}
        </div>
        <div>
          <h3 style={{ fontSize: "0.95rem", marginBottom: "0.5rem" }}>Worst season</h3>
          {data.worst_season ? (
            <p style={{ color: "var(--color-mid)", fontSize: "0.9rem", margin: 0 }}>
              <Link to={`/seasons/${data.worst_season.season}`} className="link-quiet">
                {data.worst_season.season}
              </Link>{" "}
              as {data.worst_season.team_name} &mdash; {data.worst_season.record},{" "}
              {total(data.worst_season.points_for)} points, finished{" "}
              {ordinal(data.worst_season.final_rank)}
            </p>
          ) : null}
        </div>
        <div>
          <h3 style={{ fontSize: "0.95rem", marginBottom: "0.5rem" }}>Postseason</h3>
          <p style={{ color: "var(--color-mid)", fontSize: "0.9rem", margin: 0 }}>
            {data.playoff_record.games
              ? `${data.playoff_record.record} in ${data.playoff_record.games} playoff games, ${points(
                  data.playoff_record.avg_score,
                  1,
                )} per game`
              : "No playoff games on record."}
          </p>
        </div>
        {data.efficiency ? (
          <div>
            <h3 style={{ fontSize: "0.95rem", marginBottom: "0.5rem" }}>
              <Metric name="manager_efficiency">Lineup management</Metric>
            </h3>
            <p style={{ color: "var(--color-mid)", fontSize: "0.9rem", margin: 0 }}>
              Started {pct(data.efficiency.manager_efficiency)} of the points available across{" "}
              {data.efficiency.weeks_measured} weeks, leaving{" "}
              {points(data.efficiency.bench_regret_per_week, 1)} per week on the bench.
              {data.efficiency.biggest_bench_performance ? (
                <>
                  {" "}
                  The worst miss was {data.efficiency.biggest_bench_performance.player} scoring{" "}
                  {points(data.efficiency.biggest_bench_performance.points)} from the bench in{" "}
                  <WeekLink
                    season={data.efficiency.biggest_bench_performance.season}
                    week={data.efficiency.biggest_bench_performance.week}
                  >
                    {data.efficiency.biggest_bench_performance.season} week{" "}
                    {data.efficiency.biggest_bench_performance.week}
                  </WeekLink>
                  .
                </>
              ) : null}
            </p>
          </div>
        ) : null}
      </div>

      <Band title="Against the league" note={`Minimum ${data.head_to_head.min_meetings} meetings for the labels below`} />
      <div className="owner-split">
        {data.head_to_head.favorite_victim ? (
          <p style={{ margin: 0, fontSize: "0.92rem" }}>
            <span style={{ color: "var(--color-low)", display: "block", fontSize: "0.76rem" }}>
              Favourite victim
            </span>
            <RivalryLink a={data.owner_id} b={data.head_to_head.favorite_victim.opponent_owner_id}>
              {data.head_to_head.favorite_victim.opponent_name}
            </RivalryLink>{" "}
            <span style={{ color: "var(--color-mid)" }}>
              ({data.head_to_head.favorite_victim.record})
            </span>
          </p>
        ) : null}
        {data.head_to_head.nemesis ? (
          <p style={{ margin: 0, fontSize: "0.92rem" }}>
            <span style={{ color: "var(--color-low)", display: "block", fontSize: "0.76rem" }}>
              Nemesis
            </span>
            <RivalryLink a={data.owner_id} b={data.head_to_head.nemesis.opponent_owner_id}>
              {data.head_to_head.nemesis.opponent_name}
            </RivalryLink>{" "}
            <span style={{ color: "var(--color-mid)" }}>({data.head_to_head.nemesis.record})</span>
          </p>
        ) : null}
      </div>
      <div style={{ marginTop: "1rem" }}>
        <StatTable
          rows={data.head_to_head.opponents}
          columns={opponentColumns}
          rowKey={(r) => r.opponent_owner_id}
          initialSort={{ key: "games", direction: "desc" }}
          caption={`${data.name} head-to-head records`}
        />
      </div>

      <Band title="Scoring by season" note="Average points per game, regular season" />
      <div style={{ marginTop: "1rem" }}>
        <WeeklyLines
          data={lineData}
          teams={[data.name]}
          xLabel="Season"
          tooltipLabel={(value) => `${value} season`}
        />
      </div>

      <Band title="Every game" note={`${data.weekly_history.length} games on record`} />
      <div className="sheet">
        <table>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Game</th>
              <th>Score</th>
              <th>Result</th>
              <th style={{ textAlign: "right" }}>Opponent</th>
              <th>Opp</th>
              <th data-secondary="true">Type</th>
            </tr>
          </thead>
          <tbody>
            {[...data.weekly_history]
              .sort((a, b) => b.season - a.season || b.week - a.week)
              .map((row) => (
                <tr key={row.matchup_id}>
                  <td style={{ textAlign: "left" }}>
                    <WeekLink season={row.season} week={row.week}>
                      {row.season} wk {row.week}
                    </WeekLink>
                  </td>
                  <td>{points(row.score)}</td>
                  <td className={row.result === "W" ? "num-pos" : row.result === "L" ? "num-neg" : ""}>
                    {row.result}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <OwnerLink ownerId={row.opponent_owner_id}>{row.opponent_team_name}</OwnerLink>
                  </td>
                  <td>{points(row.opponent_score)}</td>
                  <td data-secondary="true">{gameTypeLabel(row.game_type)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <style>{`
        .rival-plate {
          display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.35rem 0.8rem;
          margin-top: 1rem; padding: 0.6rem 0 0.6rem 0.9rem;
          border-left: 3px solid var(--ember);
        }
        .rival-label {
          font-family: var(--font-display); font-style: italic; font-size: 0.82rem;
          color: var(--ink-faint);
        }
        .rival-name { font-family: var(--font-display); font-weight: 700; font-size: 1.3rem; }
        .rival-series { color: var(--ink-soft); font-size: 0.85rem; }

        .owner-figures {
          display: grid; grid-template-columns: repeat(2, 1fr); gap: 1.3rem 1rem;
          margin-top: 1.7rem; padding-top: 1.4rem; border-top: 1px solid var(--color-line);
        }
        @media (min-width: 680px) { .owner-figures { grid-template-columns: repeat(4, 1fr); } }
        .timeline { list-style: none; padding: 0; margin: 0.8rem 0 0; }
        .timeline li {
          display: grid; grid-template-columns: 3.4rem 1fr auto; gap: 0.9rem;
          align-items: baseline; padding: 0.38rem 0;
          border-bottom: 1px solid var(--color-line-soft);
        }
        .timeline-year { color: var(--color-low); font-size: 0.85rem; }
        .timeline-year:hover { color: var(--color-brass); }
        .highlight-grid { display: grid; gap: 0 2.5rem; margin-top: 0.8rem; }
        @media (min-width: 760px) { .highlight-grid { grid-template-columns: 1fr 1fr; } }
        .owner-split { display: grid; gap: 1.3rem 2.5rem; margin-top: 1rem; }
        @media (min-width: 760px) { .owner-split { grid-template-columns: 1fr 1fr; } }
      `}</style>
    </div>
  );
}

function Highlight({ label, week }: { label: string; week: WeekRef | null }) {
  if (!week) return null;
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
        <div style={{ fontSize: "0.9rem" }}>
          <WeekLink season={week.season} week={week.week}>
            {week.season} week {week.week}
          </WeekLink>{" "}
          <span style={{ color: "var(--color-low)" }}>as {week.team_name}</span>
        </div>
        <div style={{ color: "var(--color-mid)", fontSize: "0.83rem" }}>
          {week.result === "W" ? "beat" : week.result === "L" ? "lost to" : "tied"}{" "}
          <OwnerLink ownerId={week.opponent_owner_id}>{week.opponent_team_name}</OwnerLink>{" "}
          ({points(week.opponent_score)})
        </div>
      </div>
      <div className="figure" style={{ fontSize: "1.25rem" }}>
        {points(week.score)}
      </div>
    </div>
  );
}
