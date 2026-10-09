import { useState } from "react";
import { Link } from "react-router-dom";
import { pct, points, signClass, signed, total } from "../lib/format";
import type { StandingsRow } from "../lib/types";
import { StatTable, type Column } from "./StatTable";
import { Metric, OwnerLink } from "./primitives";

type View = "standard" | "advanced" | "scoring";

const VIEWS: { id: View; label: string }[] = [
  { id: "standard", label: "Standings" },
  { id: "scoring", label: "Scoring" },
  { id: "advanced", label: "Advanced" },
];

export function StandingsTable({
  rows,
  season,
  compact,
  highlightOwner,
}: {
  rows: StandingsRow[];
  season: number;
  compact?: boolean;
  highlightOwner?: string;
}) {
  const [view, setView] = useState<View>("standard");

  const team: Column<StandingsRow> = {
    key: "team",
    header: "Team",
    align: "left",
    sortValue: (r) => r.team_name ?? "",
    cell: (r) => (
      <span style={{ display: "inline-flex", alignItems: "baseline", gap: "0.5rem" }}>
        <span style={{ color: "var(--color-low)", minWidth: "1.1rem", display: "inline-block" }}>
          {r.rank}
        </span>
        <OwnerLink ownerId={r.owner_id}>{r.team_name ?? r.owner_id}</OwnerLink>
        {r.is_champion ? <span className="tag tag-champ">Champion</span> : null}
        {r.is_runner_up ? <span className="tag">Runner-up</span> : null}
      </span>
    ),
  };

  const standard: Column<StandingsRow>[] = [
    team,
    { key: "record", header: "Record", sortValue: (r) => r.wins + 0.5 * r.ties, cell: (r) => r.record },
    { key: "pct", header: "Win %", sortValue: (r) => r.win_pct, cell: (r) => pct(r.win_pct) },
    {
      key: "pf",
      header: "PF",
      sortValue: (r) => r.points_for,
      bar: (r) => r.points_for,
      cell: (r) => total(r.points_for),
    },
    {
      key: "pa",
      header: "PA",
      sortValue: (r) => r.points_against,
      cell: (r) => total(r.points_against),
      secondary: true,
    },
    {
      key: "diff",
      header: "Diff",
      sortValue: (r) => r.point_diff,
      cell: (r) => <span className={signClass(r.point_diff)}>{signed(r.point_diff, 1)}</span>,
    },
    {
      key: "streak",
      header: "Streak",
      sortValue: (r) => r.current_streak ?? "",
      cell: (r) => r.current_streak ?? "\u2014",
      secondary: true,
    },
  ];

  const scoring: Column<StandingsRow>[] = [
    team,
    { key: "avg", header: "Avg", sortValue: (r) => r.avg_score, bar: (r) => r.avg_score, cell: (r) => points(r.avg_score, 1) },
    { key: "median", header: "Median", sortValue: (r) => r.median_score, cell: (r) => points(r.median_score, 1), secondary: true },
    { key: "high", header: "High", sortValue: (r) => r.high_score, cell: (r) => points(r.high_score, 1) },
    { key: "low", header: "Low", sortValue: (r) => r.low_score, cell: (r) => points(r.low_score, 1) },
    {
      key: "sd",
      header: <Metric name="consistency">Std dev</Metric>,
      sortValue: (r) => r.score_stdev,
      cell: (r) => points(r.score_stdev, 1),
      title: "Week-to-week standard deviation. Lower is steadier.",
    },
    { key: "150", header: "150+", sortValue: (r) => r.games_150_plus, cell: (r) => r.games_150_plus, secondary: true },
    { key: "sub100", header: "Sub-100", sortValue: (r) => r.games_under_100, cell: (r) => r.games_under_100, secondary: true },
  ];

  const advanced: Column<StandingsRow>[] = [
    team,
    {
      key: "allplay",
      header: <Metric name="all_play">All-play</Metric>,
      sortValue: (r) => r.all_play_win_pct,
      cell: (r) => (
        <span>
          {pct(r.all_play_win_pct)}
          <span style={{ color: "var(--color-low)", marginLeft: "0.4rem", fontSize: "0.78rem" }}>
            {r.all_play_record}
          </span>
        </span>
      ),
      bar: (r) => r.all_play_win_pct,
    },
    {
      key: "xw",
      header: <Metric name="expected_wins">Exp W</Metric>,
      sortValue: (r) => r.expected_wins,
      cell: (r) => points(r.expected_wins, 1),
    },
    {
      key: "luck",
      header: <Metric name="schedule_luck">Luck</Metric>,
      sortValue: (r) => r.schedule_luck,
      cell: (r) => <span className={signClass(r.schedule_luck)}>{signed(r.schedule_luck, 1)}</span>,
    },
    {
      key: "sos",
      header: <Metric name="sos_z">SOS</Metric>,
      sortValue: (r) => r.sos_z,
      cell: (r) => <span className={signClass(r.sos_z)}>{signed(r.sos_z, 2)}</span>,
    },
    {
      key: "dominance",
      header: <Metric name="dominance">Dominance</Metric>,
      sortValue: (r) => r.dominance,
      bar: (r) => r.dominance,
      cell: (r) => points(r.dominance, 1),
    },
    {
      key: "badbeat",
      header: <Metric name="bad_beat_index">Bad beats</Metric>,
      sortValue: (r) => r.bad_beat_index,
      cell: (r) => points(r.bad_beat_index, 2),
      secondary: true,
    },
    {
      key: "fortunate",
      header: <Metric name="fortunate_win_index">Fortunate</Metric>,
      sortValue: (r) => r.fortunate_win_index,
      cell: (r) => points(r.fortunate_win_index, 2),
      secondary: true,
    },
  ];

  const columns = view === "advanced" ? advanced : view === "scoring" ? scoring : standard;

  return (
    <div>
      {!compact ? (
        <div className="pill-row" style={{ margin: "0.9rem 0" }}>
          {VIEWS.map((option) => (
            <button
              key={option.id}
              type="button"
              className="pill"
              aria-pressed={view === option.id}
              onClick={() => setView(option.id)}
            >
              {option.label}
            </button>
          ))}
          <Link to={`/seasons/${season}`} className="pill" style={{ textDecoration: "none" }}>
            {season} season page
          </Link>
        </div>
      ) : null}
      <StatTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.owner_id}
        caption={`${season} standings`}
        rowClass={(r) => (r.owner_id === highlightOwner ? "row-highlight" : undefined)}
      />
      <style>{`.row-highlight td { background-color: var(--color-raised); }`}</style>
    </div>
  );
}
