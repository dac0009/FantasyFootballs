import { EditableText, useEditorial } from "../components/Editorial";
import { ownerInk } from "../lib/ownerInk";
import { useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import "../styles/almanac.css";
import { StatTable, type Column } from "../components/StatTable";
import { Band, ErrorState, Loading, Metric, OwnerLink } from "../components/primitives";
import { currentOwners } from "../lib/rivalries";
import { useOwnerIndex } from "../lib/data";
import { pct, points, signed, signClass, total } from "../lib/format";
import type { OwnerIndexRow } from "../lib/types";

export default function Owners() {
  const {documents}=useEditorial();
  const profileFor=(id:string)=>documents.find(d=>d.kind==='profile'&&d.key===id)?.body;
  const owners = useOwnerIndex();
  const [view,setView] = useState<"cards"|"table">("cards");
  if (owners.state === "loading") return <Loading what="owners" />;
  if (owners.state === "error") return <ErrorState error={owners.error} what="Owner records" />;

  const rows = owners.data;
  const active = currentOwners(rows);
  const currentIds = new Set(active.map((owner) => owner.owner_id));
  const former = rows.filter((owner) => !owner.unlinked && !currentIds.has(owner.owner_id));

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
        <EditableText id="owners.intro" fallback="Career records by owner · Regular season"/>
      </p>

      <Band title="Current owners" note={`${active.length} owners`} />
      <div className="pill-row" role="group" aria-label="Owner directory view" style={{marginBottom:"1.2rem"}}>
        <button className="pill" aria-pressed={view==='cards'} onClick={()=>setView('cards')}>Card collection</button>
        <button className="pill" aria-pressed={view==='table'} onClick={()=>setView('table')}>Records table</button>
      </div>
      {view === 'cards' ? <div className="owner-collection">{active.map(owner=><Link to={`/owners/${owner.owner_id}`} className="collection-card" style={{"--card-ink":profileFor(owner.owner_id)?.ink || ownerInk(owner.owner_id)} as CSSProperties} key={owner.owner_id}>
        <div className="collection-card-top"><span>FFBFFL</span><span>Since {owner.first_season}</span></div>
        <div className="collection-monogram" aria-hidden="true">{profileFor(owner.owner_id)?.photo && <img src={profileFor(owner.owner_id)?.photo} alt=""/>}{owner.name.split(/\s+/).filter(Boolean).map(s=>s[0]).slice(0,2).join('').toUpperCase()}</div>
        <h2>{profileFor(owner.owner_id)?.display_name || owner.name}</h2><p>{owner.current_team_name}</p>
        <div className="collection-record"><strong>{owner.record}</strong><span>{owner.championships?`${owner.championships} ${owner.championships===1?'title':'titles'}`:`${owner.seasons_played} seasons`}</span></div>
        <span className="collection-open">Open owner card →</span>
      </Link>)}</div> : <StatTable
        rows={active}
        columns={columns}
        rowKey={(r) => r.owner_id}
        initialSort={{ key: "pct", direction: "desc" }}
        caption="Career owner records"
      />}

      {former.length ? (
        <details style={{ marginTop: "2rem" }}>
          <summary className="link-quiet" style={{ cursor: "pointer" }}>Former owners · {former.length}</summary>
          <StatTable rows={former} columns={columns} rowKey={(r) => r.owner_id}
            initialSort={{ key: "pct", direction: "desc" }} caption="Former owner career records" />
        </details>
      ) : null}

      {rows.some((r) => r.unlinked) ? (
        <>
          <Band
            title="Unlinked teams"
            note="Teams ESPN did not attach to a member account"
          />
          <p className="prose-narrow" style={{ fontSize: "0.86rem" }}>
            These historical teams have no confirmed owner account. Their records stay separate
            until ownership can be verified.
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
