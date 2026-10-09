import { StatTable, type Column } from "../components/StatTable";
import { Band, ErrorState, Loading, Metric, OwnerLink } from "../components/primitives";
import { useOwnerIndex } from "../lib/data";
import { pct, points, signed, signClass, total } from "../lib/format";
import type { OwnerIndexRow } from "../lib/types";

export default function Owners() {
  const owners = useOwnerIndex();
  if (owners.state === "loading") return <Loading what="owners" />;
  if (owners.state === "error") return <ErrorState error={owners.error} what="Owner records" />;

  const rows = owners.data;
  const active = rows.filter((r) => !r.unlinked);

  const columns: Column<OwnerIndexRow>[] = [
    {
      key: "owner",
      header: "Owner",
      align: "left",
      sortValue: (r) => r.name,
      cell: (r) => (
        <span>
          <OwnerLink ownerId={r.owner_id}>{r.name}</OwnerLink>
          <span style={{ color: "var(--color-low)", display: "block", fontSize: "0.78rem" }}>
            {r.current_team_name}
          </span>
        </span>
      ),
    },
    {
      key: "seasons",
      header: "Seasons",
      sortValue: (r) => r.seasons_played,
      cell: (r) => (
        <span>
          {r.seasons_played}
          <span style={{ color: "var(--color-low)", display: "block", fontSize: "0.76rem" }}>
            {r.first_season}&ndash;{r.last_season}
          </span>
        </span>
      ),
    },
    { key: "record", header: "Record", sortValue: (r) => r.wins + 0.5 * r.ties, cell: (r) => r.record },
    { key: "pct", header: "Win %", sortValue: (r) => r.win_pct, cell: (r) => pct(r.win_pct), bar: (r) => r.win_pct },
    { key: "titles", header: "Titles", sortValue: (r) => r.championships, cell: (r) => r.championships || "\u2014" },
    {
      key: "playoffs",
      header: "Playoffs",
      sortValue: (r) => r.playoff_appearances,
      cell: (r) => r.playoff_appearances || "\u2014",
      secondary: true,
    },
    { key: "pf", header: "Points for", sortValue: (r) => r.points_for, cell: (r) => total(r.points_for) },
    { key: "avg", header: "Avg", sortValue: (r) => r.avg_score, cell: (r) => points(r.avg_score, 1) },
    {
      key: "allplay",
      header: <Metric name="all_play">All-play</Metric>,
      sortValue: (r) => r.all_play_win_pct,
      cell: (r) => pct(r.all_play_win_pct),
      secondary: true,
    },
    {
      key: "diff",
      header: "Diff",
      sortValue: (r) => r.point_diff,
      cell: (r) => <span className={signClass(r.point_diff)}>{signed(r.point_diff, 1)}</span>,
      secondary: true,
    },
    {
      key: "finish",
      header: "Avg finish",
      sortValue: (r) => r.avg_finish,
      cell: (r) => points(r.avg_finish, 1),
      secondary: true,
      title: "Mean final standing in seasons where ESPN reported one. League size has changed over time.",
    },
  ];

  return (
    <div className="shell" style={{ paddingTop: "2.2rem" }}>
      <h1 style={{ fontSize: "clamp(1.8rem, 5vw, 2.6rem)" }}>Owners</h1>
      <p className="prose-narrow" style={{ marginTop: "0.6rem" }}>
        Careers are tracked by person, not by team name. Every rename, every franchise, every
        season belongs to whoever managed it. Regular-season games only; playoff records are on
        each owner's page.
      </p>

      <Band title="Career records" note={`${active.length} owners`} />
      <StatTable
        rows={active}
        columns={columns}
        rowKey={(r) => r.owner_id}
        initialSort={{ key: "pct", direction: "desc" }}
        caption="Career owner records"
      />

      {rows.length !== active.length ? (
        <>
          <Band
            title="Unlinked teams"
            note="Teams ESPN did not attach to a member account"
          />
          <p className="prose-narrow" style={{ fontSize: "0.86rem" }}>
            These appear as separate owners because ESPN returned no account for them. Merging
            them into a real owner is a two-line edit in <code>config/owners.yml</code>.
          </p>
          <StatTable
            rows={rows.filter((r) => r.unlinked)}
            columns={columns}
            rowKey={(r) => r.owner_id}
            caption="Unlinked teams"
          />
        </>
      ) : null}
    </div>
  );
}
