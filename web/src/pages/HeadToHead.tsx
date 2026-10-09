import { useMemo } from "react";
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

  const a = params.get("a") ?? "";
  const b = params.get("b") ?? "";

  const record = useMemo<H2HRecord | null>(() => {
    if (pairs.state !== "ready" || !a || !b || a === b) return null;
    return pairs.data[pairKey(a, b)] ?? null;
  }, [pairs, a, b]);

  if (owners.state === "loading" || pairs.state === "loading") return <Loading what="rivalries" />;
  if (owners.state === "error") return <ErrorState error={owners.error} what="Owner records" />;
  if (pairs.state === "error") return <ErrorState error={pairs.error} what="Rivalry records" />;

  const ownerList = owners.data.filter((o) => !o.unlinked);
  const sortedRivalries = Object.values(pairs.data).sort(
    (x, y) => (y.rivalry_index.score ?? 0) - (x.rivalry_index.score ?? 0),
  );

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
      <h1 style={{ fontSize: "clamp(1.8rem, 5vw, 2.6rem)" }}>Head to head</h1>
      <p className="prose-narrow" style={{ marginTop: "0.6rem" }}>
        Pick any two owners. Every meeting since {owners.data.reduce((min, o) => Math.min(min, o.first_season ?? 9999), 9999)}{" "}
        counts, through every team name either of them has used.
      </p>

      <div className="h2h-picker">
        <label>
          <span>Owner A</span>
          <select className="select" value={a} onChange={(e) => choose("a", e.target.value)}>
            <option value="">Select an owner</option>
            {ownerList.map((owner) => (
              <option key={owner.owner_id} value={owner.owner_id}>
                {owner.name}
              </option>
            ))}
          </select>
        </label>
        <span style={{ color: "var(--color-low)", paddingBottom: "0.35rem" }}>against</span>
        <label>
          <span>Owner B</span>
          <select className="select" value={b} onChange={(e) => choose("b", e.target.value)}>
            <option value="">Select an owner</option>
            {ownerList.map((owner) => (
              <option key={owner.owner_id} value={owner.owner_id}>
                {owner.name}
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
              value={points(record.rivalry_index.score, 1)}
              label={<Metric name="rivalry_index">Rivalry index</Metric>}
              size="1.5rem"
              tone="var(--color-brass)"
            />
          </div>

          <Band title="Defining games" />
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

          <Band title="Every meeting" note={`${record.meetings.length} games`} />
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
          <Band title="Best rivalries in the league" note="Ranked by rivalry index" />
          <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {sortedRivalries.slice(0, 12).map((rivalry) => (
              <li key={rivalry.pair_key} className="rivalry-row">
                <span className="figure" style={{ fontSize: "1.1rem", color: "var(--color-brass)" }}>
                  {points(rivalry.rivalry_index.score, 0)}
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
                  <span className="link-quiet">
                    {rivalry.left_owner_name} v {rivalry.right_owner_name}
                  </span>
                </button>
                <span style={{ color: "var(--color-mid)", fontSize: "0.85rem" }}>
                  {rivalry.overall.record} &middot; {rivalry.overall.games} meetings &middot; avg
                  margin {points(rivalry.avg_abs_margin, 1)}
                  {rivalry.playoff.games ? ` \u00b7 ${rivalry.playoff.games} in the playoffs` : ""}
                </span>
              </li>
            ))}
          </ol>
          <p className="prose-narrow" style={{ marginTop: "1rem", fontSize: "0.85rem" }}>
            <Metric name="rivalry_index">Rivalry index</Metric> weights meetings played, how even
            the series is, how close the games have been, and playoff history equally. It is a
            sorting convenience, not a measurement.
          </p>
        </>
      )}

      <style>{`
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
        .rivalry-row {
          display: grid; grid-template-columns: 2.6rem minmax(10rem, 1fr) 1fr; gap: 0.9rem;
          align-items: baseline; padding: 0.5rem 0;
          border-bottom: 1px solid var(--color-line-soft);
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
          {m.game_type !== "regular" ? ` \u00b7 ${gameTypeLabel(m.game_type)}` : ""}
        </div>
      </div>
      <div className="figure" style={{ fontSize: "1.2rem" }}>
        {points(m.margin, 1)}
      </div>
    </div>
  );
}
