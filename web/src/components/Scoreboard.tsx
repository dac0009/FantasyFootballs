import { Link } from "react-router-dom";
import { gameTypeLabel, points } from "../lib/format";
import type { Matchup } from "../lib/types";
import { OwnerLink, RivalryLink } from "./primitives";

function Side({
  name,
  ownerId,
  score,
  winner,
  seed,
}: {
  name: string | null;
  ownerId: string | null;
  score: number | null;
  winner: boolean;
  seed?: number | null;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: "0.8rem",
        alignItems: "baseline",
        color: winner ? "var(--color-hi)" : "var(--color-mid)",
        fontWeight: winner ? 600 : 400,
      }}
    >
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {seed ? (
          <span style={{ color: "var(--color-low)", marginRight: "0.4rem", fontSize: "0.78rem" }}>
            {seed}
          </span>
        ) : null}
        <OwnerLink ownerId={ownerId}>{name ?? "TBD"}</OwnerLink>
      </span>
      <span style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
        {score === null ? "\u2014" : points(score)}
      </span>
    </div>
  );
}

/** One matchup, rendered as a two-line scoreline. */
export function ScoreboardRow({ matchup, showType }: { matchup: Matchup; showType?: boolean }) {
  if (matchup.is_bye) {
    return (
      <div className="scoreline">
        <div>
          <Side
            name={matchup.home_team_name}
            ownerId={matchup.home_owner_id}
            score={null}
            winner
            seed={matchup.home_seed}
          />
          <p style={{ color: "var(--color-low)", fontSize: "0.78rem", margin: "0.25rem 0 0" }}>
            First-round bye
          </p>
        </div>
        <span />
      </div>
    );
  }

  const homeWon = matchup.winner === "HOME";
  const awayWon = matchup.winner === "AWAY";
  const tied = matchup.winner === "TIE";

  return (
    <div className="scoreline">
      <div style={{ minWidth: 0 }}>
        <Side
          name={matchup.away_team_name}
          ownerId={matchup.away_owner_id}
          score={matchup.away_score}
          winner={awayWon || tied}
          seed={matchup.away_seed}
        />
        <Side
          name={matchup.home_team_name}
          ownerId={matchup.home_owner_id}
          score={matchup.home_score}
          winner={homeWon || tied}
          seed={matchup.home_seed}
        />
      </div>
      <div style={{ textAlign: "right", fontSize: "0.76rem", color: "var(--color-low)" }}>
        {matchup.completed ? (
          <RivalryLink a={matchup.home_owner_id} b={matchup.away_owner_id}>
            {tied ? "Tie" : `by ${points(matchup.margin, 1)}`}
          </RivalryLink>
        ) : (
          <RivalryLink a={matchup.home_owner_id} b={matchup.away_owner_id}>
            Preview
          </RivalryLink>
        )}
        {showType && matchup.game_type !== "regular" ? (
          <div style={{ marginTop: "0.2rem" }}>{gameTypeLabel(matchup.game_type)}</div>
        ) : null}
      </div>
    </div>
  );
}

export function Scoreboard({
  matchups,
  season,
  week,
  showType,
}: {
  matchups: Matchup[];
  season?: number;
  week?: number | null;
  showType?: boolean;
}) {
  if (!matchups.length) {
    return (
      <p style={{ color: "var(--color-low)", padding: "1.2rem 0", fontSize: "0.9rem" }}>
        No games scheduled.
      </p>
    );
  }
  return (
    <div>
      <div className="score-grid">
        {matchups.map((matchup) => (
          <ScoreboardRow key={matchup.matchup_id} matchup={matchup} showType={showType} />
        ))}
      </div>
      {season && week ? (
        <p style={{ marginTop: "0.9rem", fontSize: "0.84rem" }}>
          <Link to={`/seasons/${season}/weeks/${week}`} className="link-quiet">
            Full week {week} breakdown
          </Link>
        </p>
      ) : null}
      <style>{`
        .score-grid { display: grid; gap: 0 2.5rem; }
        @media (min-width: 760px) { .score-grid { grid-template-columns: 1fr 1fr; } }
      `}</style>
    </div>
  );
}
