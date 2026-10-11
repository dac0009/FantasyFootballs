import { points } from "../lib/format";
import type { PlayoffPicture as Picture, PlayoffTeam } from "../lib/types";
import { Metric, OwnerLink } from "./primitives";

function pctLabel(value: number | null | undefined): string {
  if (value === null || value === undefined) return "\u2014";
  if (value >= 0.995) return ">99%";
  if (value <= 0.005) return "<1%";
  return `${Math.round(value * 100)}%`;
}

/**
 * The playoff picture as the agate page would print it: one ruled table,
 * serif percentages, a thin bar under each, and the ember rule where the
 * bracket ends. The win/lose columns are the decision: this week's game,
 * conditioned each way.
 */
export function PlayoffPicture({ picture }: { picture: Picture }) {
  const cut = picture.playoff_teams;
  return (
    <div>
      <div className="sheet">
        <table style={{ minWidth: "38rem" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Team</th>
              <th>Record</th>
              <th>Proj W</th>
              <th style={{ minWidth: "6.2rem" }}>
                <Metric name="playoff_odds">Playoffs</Metric>
              </th>
              {picture.byes ? <th data-secondary="true">Bye</th> : null}
              {picture.next_week ? (
                <th>
                  <Metric name="playoff_swing">Win / lose</Metric>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {picture.teams.map((team, index) => (
              <Row key={team.owner_id} team={team} picture={picture} isCut={index === cut - 1} />
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ color: "var(--ink-faint)", fontSize: "0.78rem", marginTop: "0.6rem" }}>
        {cut} make the playoffs{picture.byes ? `, top ${picture.byes} get a bye` : ""}; the ember
        rule is the cut. Odds from {picture.simulations.toLocaleString("en-US")} simulated finishes
        of the {picture.remaining_regular_season_games} remaining games.
      </p>
    </div>
  );
}

function Row({ team, picture, isCut }: { team: PlayoffTeam; picture: Picture; isCut: boolean }) {
  const swing = team.this_week;
  const settled = team.status !== "alive";
  return (
    <tr style={isCut ? { borderBottom: "3px solid var(--ember)" } : undefined}>
      <td style={{ textAlign: "left" }}>
        <OwnerLink ownerId={team.owner_id}>{team.team_name}</OwnerLink>
      </td>
      <td>{team.record}</td>
      <td>{points(team.expected_final_wins, 1)}</td>
      <td>
        <span
          className="figure"
          style={{
            fontSize: "1.05rem",
            color: settled ? "var(--ink-faint)" : "var(--ink)",
          }}
        >
          {team.status === "clinched" ? "In" : team.status === "eliminated" ? "Out" : pctLabel(team.playoff_pct)}
        </span>
        <span className="cell-bar" style={{ marginTop: "0.28rem" }}>
          <span
            style={{
              width: `${Math.max(team.playoff_pct * 100, 1)}%`,
              background: team.status === "clinched" ? "var(--ember)" : "var(--ink)",
              opacity: team.status === "eliminated" ? 0.25 : 0.85,
            }}
          />
        </span>
      </td>
      {picture.byes ? <td data-secondary="true">{pctLabel(team.bye_pct)}</td> : null}
      {picture.next_week ? (
        <td style={{ whiteSpace: "nowrap" }}>
          {swing && !settled ? (
            <>
              <span className="num-pos">{pctLabel(swing.if_win)}</span>
              <span style={{ color: "var(--ink-faint)" }}> / </span>
              <span className="num-neg">{pctLabel(swing.if_loss)}</span>
            </>
          ) : (
            <span style={{ color: "var(--ink-faint)" }}>{swing ? "settled" : "bye"}</span>
          )}
        </td>
      ) : null}
    </tr>
  );
}
