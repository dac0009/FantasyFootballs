import { EditableText } from "../components/Editorial";
import { useMemo, useState } from "react";
import { currentOwners, currentRivalries, type RivalrySort } from "../lib/rivalries";
import { useSearchParams } from "react-router-dom";
import { Band, Empty, ErrorState, Figure, Loading, Metric, OwnerLink, WeekLink } from "../components/primitives";
import { useHeadToHead, useOwnerIndex, pairKey } from "../lib/data";
import { gameTypeLabel, points, signed, total } from "../lib/format";
import type { H2HRecord, Meeting, ScopeRecord } from "../lib/types";

/**
 * The rivalry page. Both owners are chosen from the query string so a
 * specific matchup can be linked to directly from anywhere on the site.
 */
export default function HeadToHead() {
  const [params, setParams] = useSearchParams();
  const owners = useOwnerIndex();
  const pairs = useHeadToHead();
  const [sort, setSort] = useState<RivalrySort>("meetings");

  const a = params.get("a") ?? "";
  const b = params.get("b") ?? "";

  const record = useMemo<H2HRecord | null>(() => {
    if (pairs.state !== "ready" || !a || !b || a === b) return null;
    return pairs.data[pairKey(a, b)] ?? null;
  }, [pairs, a, b]);

  if (owners.state === "loading" || pairs.state === "loading") return <Loading what="rivalries" />;
  if (owners.state === "error") return <ErrorState error={owners.error} what="Owner records" />;
  if (pairs.state === "error") return <ErrorState error={pairs.error} what="Rivalry records" />;

  const ownerList = currentOwners(owners.data);
  const activeIds = new Set(ownerList.map((owner) => owner.owner_id));
  const archivedSelection = Boolean(record && (!activeIds.has(a) || !activeIds.has(b)));
  const sortedRivalries = currentRivalries(owners.data, Object.values(pairs.data), sort);
  // Preserve historical deep links without adding departed owners to the default picker.
  const selectedFormer = owners.data.filter((owner) =>
    !activeIds.has(owner.owner_id) && [a, b].includes(owner.owner_id));
  const pickerOwners = [...ownerList, ...selectedFormer];

  function choose(side: "a" | "b", value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(side, value);
    else next.delete(side);
    setParams(next, { replace: true });
  }

  // The stored record is keyed left/right by sorted owner id, so flip it to
  // match whichever owner the visitor put first.
  const flipped = record ? record.left_owner_id !== a : false;
  const left = record ? (flipped ? record.right_owner_id : record.left_owner_id) : a;
  const right = record ? (flipped ? record.left_owner_id : record.right_owner_id) : b;
  const leftName = record ? (flipped ? record.right_owner_name : record.left_owner_name) : "";
  const rightName = record ? (flipped ? record.left_owner_name : record.right_owner_name) : "";

  const scope = (s: ScopeRecord) => ({
    games: s.games,
    leftWins: flipped ? s.right_wins : s.left_wins,
    rightWins: flipped ? s.left_wins : s.right_wins,
    ties: s.ties,
  });

  const meeting = (m: Meeting) => ({
    ...m,
    leftTeam: flipped ? m.right_team_name : m.left_team_name,
    rightTeam: flipped ? m.left_team_name : m.right_team_name,
    leftScore: flipped ? m.right_score : m.left_score,
    rightScore: flipped ? m.left_score : m.right_score,
  });

  return (
    <div className="shell" style={{ paddingTop: "2.2rem" }}>
      <div className="section-kicker">The record book / Rivalries</div>
      <h1 style={{ fontSize: "clamp(2.4rem, 6vw, 3.7rem)" }}><EditableText id="site.head-to-head.c3d4740257" fallback="Head to head"/></h1>
      <p className="prose-narrow" style={{ marginTop: "0.6rem" }}><EditableText id="site.head-to-head.8e28804df6" fallback="Today’s owners, their entire shared history. Team names change; the series stays with the people who played it."/></p>

      <div className="h2h-picker">
        <label>
          <span>Owner A</span>
          <select className="select" value={a} onChange={(e) => choose("a", e.target.value)}>
            <option value="">Select an owner</option>
            {pickerOwners.map((owner) => (
              <option key={owner.owner_id} value={owner.owner_id}>
                {owner.name}{activeIds.has(owner.owner_id) ? "" : " (archive)"}
              </option>
            ))}
          </select>
        </label>
        <span style={{ color: "var(--color-low)", paddingBottom: "0.35rem" }}>against</span>
        <label>
          <span>Owner B</span>
          <select className="select" value={b} onChange={(e) => choose("b", e.target.value)}>
            <option value="">Select an owner</option>
            {pickerOwners.map((owner) => (
              <option key={owner.owner_id} value={owner.owner_id}>
                {owner.name}{activeIds.has(owner.owner_id) ? "" : " (archive)"}
              </option>
            ))}
          </select>
        </label>
      </div>

      {a && b && a === b ? <Empty>Pick two different owners.</Empty> : null}
      {a && b && a !== b && !record ? (
        <Empty>
          These two have never played each other. That is possible when their seasons in the
          league do not overlap.
        </Empty>
      ) : null}

      {archivedSelection ? <p className="prose-narrow">Archived series · Includes a former owner. <button className="sort-btn link-quiet" onClick={() => setParams({})}>Back to current rivalries</button></p> : null}

      {record ? (
        <>
          <div className="series-head">
            <div>
              <h2 style={{ fontSize: "clamp(1.3rem, 4vw, 2rem)" }}>
                <OwnerLink ownerId={left}>{leftName}</OwnerLink>
                <span style={{ color: "var(--color-low)", fontWeight: 500 }}> v </span>
                <OwnerLink ownerId={right}>{rightName}</OwnerLink>
              </h2>
              <p style={{ color: "var(--color-mid)", marginTop: "0.35rem", fontSize: "0.9rem" }}>
                {record.overall.games} meetings since {record.first_meeting.season}, most recently{" "}
                <WeekLink season={record.last_meeting.season} week={record.last_meeting.week}>
                  {record.last_meeting.season} week {record.last_meeting.week}
                </WeekLink>
                .{" "}
                {record.current_streak.length
                  ? `${record.current_streak.owner_id === left ? leftName : rightName} has won the last ${
                      record.current_streak.length
                    }.`
                  : ""}
              </p>
            </div>
            <div className="figure series-score">
              {scope(record.overall).leftWins}
              <span style={{ color: "var(--color-low)" }}>&ndash;</span>
              {scope(record.overall).rightWins}
              {record.overall.ties ? (
                <>
                  <span style={{ color: "var(--color-low)" }}>&ndash;</span>
                  {record.overall.ties}
                </>
              ) : null}
            </div>
          </div>

          <div className="h2h-figures">
            <Figure
              value={`${scope(record.regular).leftWins}\u2013${scope(record.regular).rightWins}`}
              label="Regular season"
              size="1.5rem"
            />
            <Figure
              value={
                record.playoff.games
                  ? `${scope(record.playoff).leftWins}\u2013${scope(record.playoff).rightWins}`
                  : "\u2014"
              }
              label="Playoffs"
              size="1.5rem"
            />
            <Figure
              value={total(flipped ? record.right_points : record.left_points)}
              label={`${leftName} points`}
              size="1.5rem"
            />
            <Figure
              value={total(flipped ? record.left_points : record.right_points)}
              label={`${rightName} points`}
              size="1.5rem"
            />
            <Figure
              value={points(flipped ? record.right_avg : record.left_avg, 1)}
              label={`${leftName} average`}
              size="1.5rem"
            />
            <Figure
              value={points(flipped ? record.left_avg : record.right_avg, 1)}
              label={`${rightName} average`}
              size="1.5rem"
            />
            <Figure
              value={signed(flipped ? -record.avg_margin : record.avg_margin, 1)}
              label="Average margin"
              size="1.5rem"
            />
            <Figure
              value={points(record.avg_abs_margin, 1)}
              label="Average winning margin"
              size="1.5rem"
              tone="var(--color-brass)"
            />
          </div>

          <Band title={<EditableText id="site.head-to-head.883f9c8353" fallback="How the series unfolded"/>}  note={`Margin from ${leftName}’s perspective`} />
          <div className="series-history" role="img" aria-label={`Chronological margins for ${leftName}; positive means a win, negative a loss`}>
            {[...record.meetings].sort((a,b)=>a.season-b.season||a.week-b.week).map(meeting).map((m,i)=>{
              const delta=m.leftScore-m.rightScore;
              const max=Math.max(1,...record.meetings.map(g=>Math.abs(g.left_score-g.right_score)));
              return <div key={`${m.season}-${m.week}-${i}`} className="series-game-bar" title={`${m.season} week ${m.week}: ${leftName} ${signed(delta,1)}`}>
                <span style={{height:60,display:"flex",alignItems:"flex-end"}}>{delta>=0?<i style={{height:Math.abs(delta)/max*55,background:"var(--ember)"}}/>:null}</span>
                <span style={{height:60,borderTop:"1px solid var(--rule)"}}>{delta<0?<i style={{height:Math.abs(delta)/max*55,background:"#a88572"}}/>:null}</span>
                <small>{String(m.season).slice(-2)}·{m.week}</small>
              </div>;
            })}
          </div>
          <p className="figure-label">Above: {leftName} · Below: {rightName} · Year/week · <Metric name="winning_margin">Point margin</Metric></p>
          <Band title={<EditableText id="site.head-to-head.b7196d1f5a" fallback="Defining games"/>}  />
          <div className="highlight-grid">
            <SeriesGame
              label={`Biggest ${leftName} win`}
              m={meeting(flipped ? record.biggest_right_win : record.biggest_left_win)}
            />
            <SeriesGame
              label={`Biggest ${rightName} win`}
              m={meeting(flipped ? record.biggest_left_win : record.biggest_right_win)}
            />
            <SeriesGame label="Closest meeting" m={meeting(record.closest_meeting)} />
            <SeriesGame label="Highest scoring" m={meeting(record.highest_scoring_meeting)} />
          </div>

          <Band title={<EditableText id="site.head-to-head.d6f5973c87" fallback="Every meeting"/>}  note={`${record.meetings.length} games`} />
          <div className="sheet">
            <table>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Game</th>
                  <th style={{ textAlign: "right" }}>{leftName}</th>
                  <th>Score</th>
                  <th>Score</th>
                  <th style={{ textAlign: "left" }}>{rightName}</th>
                  <th>Margin</th>
                  <th data-secondary="true">Type</th>
                </tr>
              </thead>
              <tbody>
                {[...record.meetings]
                  .map(meeting)
                  .sort((x, y) => y.season - x.season || y.week - x.week)
                  .map((m) => {
                    const leftWon = m.leftScore > m.rightScore;
                    return (
                      <tr key={`${m.season}-${m.week}`}>
                        <td style={{ textAlign: "left" }}>
                          <WeekLink season={m.season} week={m.week}>
                            {m.season} wk {m.week}
                          </WeekLink>
                        </td>
                        <td style={{ textAlign: "right", color: leftWon ? "var(--color-hi)" : "var(--color-mid)" }}>
                          {m.leftTeam}
                        </td>
                        <td style={{ fontWeight: leftWon ? 600 : 400 }}>{points(m.leftScore)}</td>
                        <td style={{ fontWeight: !leftWon ? 600 : 400 }}>{points(m.rightScore)}</td>
                        <td style={{ textAlign: "left", color: !leftWon ? "var(--color-hi)" : "var(--color-mid)" }}>
                          {m.rightTeam}
                        </td>
                        <td>{points(m.margin)}</td>
                        <td data-secondary="true">{gameTypeLabel(m.game_type)}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
          <Band title={<EditableText id="site.head-to-head.6aac22fb7c" fallback="The rivalry ledger"/>}  note={`${ownerList.length} current owners · Three meetings to qualify`} />
          <p className="prose-narrow" style={{ fontSize: "0.85rem" }}>
            <Metric name="rivalry_history">How series are compared</Metric>
          </p>
          <label className="figure-label" style={{display:"block",margin:"1rem 0"}}>Order series by{" "}
            <select className="select" value={sort} onChange={e=>setSort(e.target.value as RivalrySort)}>
              <option value="meetings">Most meetings</option><option value="balance">Most evenly split wins</option>
              <option value="margin">Smallest average winning margin</option><option value="playoffs">Most playoff meetings</option>
            </select>
          </label>
          {!sortedRivalries.length ? <Empty>No current-owner series has reached three meetings yet.</Empty> : null}
          <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {sortedRivalries.slice(0, 10).map((rivalry, index) => (
              <li key={rivalry.pair_key} className="rivalry-row">
                <span className="figure" style={{ fontSize: "1.1rem", color: "var(--color-brass)" }}>
                  {String(index + 1).padStart(2, "0")}
                </span>
                <button
                  type="button"
                  className="sort-btn"
                  onClick={() => {
                    const next = new URLSearchParams(params);
                    next.set("a", rivalry.left_owner_id);
                    next.set("b", rivalry.right_owner_id);
                    setParams(next);
                  }}
                  style={{ textAlign: "left" }}
                >
                  <span className="rivalry-title link-quiet">
                    {rivalry.left_owner_name} v {rivalry.right_owner_name}
                  </span>
                </button>
                <span style={{ color: "var(--color-mid)", fontSize: "0.85rem" }}>
                  <strong className="rivalry-record">{rivalry.overall.record}</strong>
                  <span>{rivalry.overall.games} meetings · {points(rivalry.avg_abs_margin, 1)} avg. margin · {rivalry.playoff.games} playoff games</span>
                </span>
              </li>
            ))}
          </ol>

        </>
      )}

      <style>{`
        .series-history {display:flex;gap:6px;margin-top:1.5rem;overflow-x:auto;padding-bottom:.5rem}
        .series-game-bar{flex:1;min-width:24px;text-align:center}.series-game-bar>span{display:block}.series-game-bar i{display:block;width:100%;min-height:1px}.series-game-bar small{font-size:.6rem;color:var(--ink-faint)}
        .h2h-picker {
          display: flex; flex-wrap: wrap; gap: 0.6rem 1rem; align-items: flex-end;
          margin: 1.5rem 0 0.5rem; padding-bottom: 1.2rem;
          border-bottom: 1px solid var(--color-line);
        }
        .h2h-picker label { display: grid; gap: 0.25rem; }
        .h2h-picker span { color: var(--color-low); font-size: 0.76rem; }
        .series-head {
          display: flex; flex-wrap: wrap; gap: 1rem 2rem; align-items: center;
          justify-content: space-between; margin-top: 1.8rem;
        }
        .series-score { font-size: clamp(2.4rem, 9vw, 4rem); letter-spacing: -0.04em; }
        .h2h-figures {
          display: grid; grid-template-columns: repeat(2, 1fr); gap: 1.2rem 1rem;
          margin-top: 1.6rem; padding-top: 1.3rem; border-top: 1px solid var(--color-line);
        }
        @media (min-width: 680px) { .h2h-figures { grid-template-columns: repeat(4, 1fr); } }
        .highlight-grid { display: grid; gap: 0 2.5rem; margin-top: 0.8rem; }
        @media (min-width: 760px) { .highlight-grid { grid-template-columns: 1fr 1fr; } }
        .rivalry-title { font-family: var(--font-display); font-size: 1.3rem; color: var(--ink); }
        .rivalry-record { display: block; font-size: 1rem; color: var(--ink); }
        .rivalry-row {
          display: grid; grid-template-columns: 2.6rem minmax(10rem, 1fr) 1fr; gap: 0.9rem;
          align-items: baseline; padding: 1rem 0;
          border-bottom: 1px solid var(--color-line-soft);
        }
        @media (max-width: 600px) {
          .rivalry-row { grid-template-columns: 1.8rem minmax(0, 1fr); gap: 0.3rem 0.7rem; }
          .rivalry-row > :last-child { grid-column: 2; }
          .rivalry-record { display: inline; margin-right: 0.8rem; }
          .h2h-picker label { flex: 1 1 100%; min-width: 0; }
          .h2h-picker > span { display: none; }
          .select { width: 100%; }
        }
      `}</style>
    </div>
  );
}

function SeriesGame({
  label,
  m,
}: {
  label: string;
  m: Meeting & { leftTeam: string | null; rightTeam: string | null; leftScore: number; rightScore: number };
}) {
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
          {m.leftTeam} {points(m.leftScore)} &ndash; {points(m.rightScore)} {m.rightTeam}
        </div>
        <div style={{ color: "var(--color-low)", fontSize: "0.8rem" }}>
          <WeekLink season={m.season} week={m.week}>
            {m.season} week {m.week}
          </WeekLink>
          {m.game_type !== "regular" ? `, ${gameTypeLabel(m.game_type)}` : ""}
        </div>
      </div>
      <div className="figure" style={{ fontSize: "1.2rem" }}>
        {points(m.margin, 1)}
      </div>
    </div>
  );
}
