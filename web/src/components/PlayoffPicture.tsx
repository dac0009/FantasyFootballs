import { Link } from "react-router-dom";
import { points } from "../lib/format";
import type { PlayoffPicture as Picture, PlayoffTeam } from "../lib/types";
import { Metric, OwnerLink } from "./primitives";

function pctLabel(value: number | null | undefined): string {
  if (value === null || value === undefined) return "\u2014";
  if (value >= 0.995) return ">99%";
  if (value <= 0.005) return "<1%";
  return `${Math.round(value * 100)}%`;
}

function Bar({ value, tone }: { value: number; tone: string }) {
  return (
    <span className="cell-bar" aria-hidden="true" style={{ marginTop: "0.28rem" }}>
      <span style={{ width: `${Math.max(value * 100, 1)}%`, background: tone }} />
    </span>
  );
}

/**
 * The practical centre of the site: where every team stands relative to the
 * cut line, and what this week's game does to that. One row per team, the
 * line drawn where the bracket ends.
 */
export function PlayoffPicture({ picture, compact }: { picture: Picture; compact?: boolean }) {
  const cut = picture.playoff_teams;
  return (
    <div>
      <div className="sheet">
        <table style={{ minWidth: compact ? "32rem" : "40rem" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Team</th>
              <th>Record</th>
              <th title="Projected final regular-season wins">Proj W</th>
              <th>
                <Metric name="playoff_odds">Playoffs</Metric>
              </th>
              {picture.byes ? <th data-secondary="true">Bye</th> : null}
              {picture.next_week ? (
                <th>
                  <Metric name="playoff_swing">Win / Lose</Metric>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {picture.teams.map((team, index) => (
              <Row key={team.owner_id} team={team} picture={picture} isCutLine={index === cut - 1} />
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ color: "var(--color-low)", fontSize: "0.78rem", marginTop: "0.6rem" }}>
        {cut} teams make the playoffs{picture.byes ? `, top ${picture.byes} get a bye` : ""}.{" "}
        {picture.remaining_regular_season_games} regular-season games left, simulated{" "}
        {picture.simulations.toLocaleString("en-US")} times from each team's scoring so far.{" "}
        <Link to="/methodology#playoff-odds" className="link-quiet">
          How this works
        </Link>
      </p>
    </div>
  );
}

function Row({ team, picture, isCutLine }: { team: PlayoffTeam; picture: Picture; isCutLine: boolean }) {
  const tone =
    team.status === "clinched"
      ? "var(--color-pos)"
      : team.status === "eliminated"
        ? "var(--color-low)"
        : team.playoff_pct >= 0.5
          ? "var(--color-steel)"
          : "var(--color-neg)";
  const swing = team.this_week;
  return (
    <tr style={isCutLine ? { borderBottom: "2px solid var(--color-brass)" } : undefined}>
      <td style={{ textAlign: "left" }}>
        <span style={{ display: "inline-flex", gap: "0.5rem", alignItems: "baseline" }}>
          <OwnerLink ownerId={team.owner_id}>{team.team_name}</OwnerLink>
          {team.status === "clinched" ? <span className="tag tag-champ">Clinched</span> : null}
          {team.status === "eliminated" ? <span className="tag">Out</span> : null}
        </span>
      </td>
      <td>{team.record}</td>
      <td>{points(team.expected_final_wins, 1)}</td>
      <td style={{ minWidth: "5.5rem" }}>
        <span style={{ color: tone, fontWeight: 600 }}>{pctLabel(team.playoff_pct)}</span>
        <Bar value={team.playoff_pct} tone={tone} />
      </td>
      {picture.byes ? <td data-secondary="true">{pctLabel(team.bye_pct)}</td> : null}
      {picture.next_week ? (
        <td style={{ whiteSpace: "nowrap" }}>
          {swing ? (
            <>
              <span className="num-pos">{pctLabel(swing.if_win)}</span>
              <span style={{ color: "var(--color-low)" }}> / </span>
              <span className="num-neg">{pctLabel(swing.if_loss)}</span>
            </>
          ) : (
            <span style={{ color: "var(--color-low)" }}>bye</span>
          )}
        </td>
      ) : null}
    </tr>
  );
}
