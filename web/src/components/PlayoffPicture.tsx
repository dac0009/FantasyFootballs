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
 * The playoff picture as a drive chart: each team's odds of making the
 * bracket drawn as field position, yard lines every 10, the end zone at
 * 100%. "How close am I to in", in the one chart every football fan
 * already knows how to read.
 */
export function PlayoffPicture({ picture }: { picture: Picture }) {
  return (
    <div>
      <div className="drive-wrap">
        <div className="drive-names" aria-hidden="true">
          <div className="drive-yard-row" />
          {picture.teams.map((team, index) => (
            <div key={team.owner_id} className="drive-name" data-cut={index === picture.playoff_teams - 1}>
              <OwnerLink ownerId={team.owner_id}>{team.team_name}</OwnerLink>
              <span className="drive-record">{team.record}</span>
            </div>
          ))}
        </div>
        <div className="drive-field-col">
          <div className="drive-yard-row">
            {[20, 40, 60, 80].map((yard) => (
              <span key={yard} className="drive-yard" style={{ left: `${yard}%` }}>
                {yard}
              </span>
            ))}
            <span className="drive-yard drive-yard-goal" style={{ left: "100%" }}>
              IN
            </span>
          </div>
          <div className="drive-field">
            {picture.teams.map((team, index) => (
              <DriveRow
                key={team.owner_id}
                team={team}
                isCut={index === picture.playoff_teams - 1}
              />
            ))}
          </div>
        </div>
      </div>

      <SwingTable picture={picture} />

      <p style={{ color: "var(--chalk-faint)", fontSize: "0.78rem", marginTop: "0.7rem" }}>
        {picture.playoff_teams} make it{picture.byes ? `, top ${picture.byes} get a bye` : ""}. Field
        position is each team's <Metric name="playoff_odds">playoff odds</Metric>; the orange line is
        the cut.
      </p>

      <style>{`
        .drive-wrap {
          display: grid;
          grid-template-columns: minmax(7.5rem, 13rem) 1fr;
          gap: 0 0.8rem;
          margin-top: 1rem;
        }
        .drive-names { display: flex; flex-direction: column; }
        .drive-names .drive-yard-row { visibility: hidden; }
        .drive-field-col { min-width: 0; }
        .drive-field {
          position: relative;
          background: repeating-linear-gradient(
            90deg,
            rgba(237, 241, 230, 0.16) 0 1px,
            transparent 1px 10%
          );
          border-left: 2px solid rgba(237, 241, 230, 0.4);
          border-right: 2px solid var(--chalk);
        }
        .drive-bar { position: absolute; inset: 0 auto 0 0; min-width: 2px; }
        .drive-yard-row { position: relative; height: 1.1rem; }
        .drive-yard {
          position: absolute;
          transform: translateX(-50%);
          font-family: var(--font-display);
          font-weight: 700;
          font-size: 0.72rem;
          color: var(--chalk-faint);
          letter-spacing: 0.06em;
        }
        .drive-yard-goal { color: var(--chalk); transform: translateX(-100%); }
        .drive-name {
          display: flex;
          flex-direction: column;
          justify-content: center;
          height: 2.35rem;
          border-bottom: 1px solid var(--color-line-soft);
          overflow: hidden;
          font-size: 0.86rem;
          line-height: 1.2;
        }
        .drive-name a { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .drive-record { color: var(--chalk-faint); font-size: 0.74rem; }
        .drive-name[data-cut="true"], .drive-row[data-cut="true"] {
          border-bottom: 2px solid var(--chain);
        }
        .drive-row {
          position: relative;
          height: 2.35rem;
          border-bottom: 1px solid var(--color-line-soft);
        }
        .drive-track { position: absolute; inset: 0.55rem 0; }
        .drive-pct {
          position: absolute;
          top: 50%;
          transform: translateY(-50%);
          font-family: var(--font-display);
          font-weight: 700;
          font-size: 0.95rem;
          padding-left: 0.4rem;
          color: var(--chalk);
        }
        @media (max-width: 640px) {
          .drive-wrap { grid-template-columns: minmax(6rem, 8.5rem) 1fr; gap: 0 0.5rem; }
          .drive-name { font-size: 0.78rem; }
        }
      `}</style>
    </div>
  );
}

function DriveRow({ team, isCut }: { team: PlayoffTeam; isCut: boolean }) {
  const pct = Math.max(0, Math.min(1, team.playoff_pct));
  const label = pctLabel(team.playoff_pct);
  // Put the number outside the bar until the bar is long enough to hold it.
  const labelInside = pct > 0.18;
  const tone =
    team.status === "clinched" || pct >= 0.995
      ? "var(--pos)"
      : team.status === "eliminated"
        ? "rgba(237,241,230,0.25)"
        : pct >= 0.5
          ? "rgba(237,241,230,0.75)"
          : "rgba(237,241,230,0.45)";
  return (
    <div className="drive-row" data-cut={isCut}>
      <div className="drive-track">
        <div
          className="drive-bar"
          style={{ width: `${pct * 100}%`, background: tone }}
          role="img"
          aria-label={`${team.team_name}: ${label} to make the playoffs`}
        />
        <span
          className="drive-pct"
          style={{
            left: labelInside ? undefined : `${pct * 100}%`,
            right: labelInside ? `${100 - pct * 100}%` : undefined,
            color: labelInside ? "var(--turf-deep)" : "var(--chalk)",
            paddingRight: labelInside ? "0.4rem" : 0,
            textAlign: labelInside ? ("right" as const) : ("left" as const),
          }}
        >
          {team.status === "clinched" ? "IN" : team.status === "eliminated" ? "OUT" : label}
        </span>
      </div>
    </div>
  );
}

/** The decision table under the field: what this week does to each team. */
function SwingTable({ picture }: { picture: Picture }) {
  if (!picture.next_week) return null;
  const withGames = picture.teams.filter((t) => t.this_week && t.status === "alive");
  if (!withGames.length) return null;
  // Most at stake first.
  const rows = [...withGames].sort(
    (a, b) =>
      (b.this_week!.if_win - b.this_week!.if_loss) - (a.this_week!.if_win - a.this_week!.if_loss),
  );
  return (
    <div className="sheet" style={{ marginTop: "1.4rem" }}>
      <table style={{ maxWidth: "46rem" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>
              This week decides the most for
            </th>
            <th>Now</th>
            <th>Win</th>
            <th>Lose</th>
            <th>Swing</th>
            <th data-secondary="true">Proj wins</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 6).map((team) => {
            const swing = team.this_week!;
            return (
              <tr key={team.owner_id}>
                <td style={{ textAlign: "left" }}>
                  <OwnerLink ownerId={team.owner_id}>{team.team_name}</OwnerLink>
                </td>
                <td>{pctLabel(team.playoff_pct)}</td>
                <td className="num-pos">{pctLabel(swing.if_win)}</td>
                <td className="num-neg">{pctLabel(swing.if_loss)}</td>
                <td style={{ fontWeight: 600 }}>
                  {Math.round((swing.if_win - swing.if_loss) * 100)}
                  <span style={{ color: "var(--chalk-faint)", fontWeight: 400 }}> pts</span>
                </td>
                <td data-secondary="true">{points(team.expected_final_wins, 1)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p style={{ color: "var(--chalk-faint)", fontSize: "0.78rem", margin: "0.5rem 0 0" }}>
        <Metric name="playoff_swing">Swing</Metric>, in percentage points of playoff odds.
      </p>
    </div>
  );
}
