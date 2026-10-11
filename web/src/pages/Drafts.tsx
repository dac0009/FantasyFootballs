import { useMemo, useState } from "react";
import { Band, Empty, Loading, OwnerLink } from "../components/primitives";
import { useDraft, usePlayers } from "../lib/data";
import type { Meta } from "../lib/types";

/**
 * The draft board. Rounds run down the page, owners across it, which is the
 * layout the draft actually happened in and makes snake order obvious.
 */
export default function Drafts({ meta }: { meta: Meta }) {
  const seasons = [...meta.seasons].sort((a, b) => b - a);
  const [season, setSeason] = useState(seasons[0]);
  const draft = useDraft(season);
  const players = usePlayers();

  const board = useMemo(() => {
    if (draft.state !== "ready") return null;
    const picks = draft.data;
    if (!picks.length) return null;
    const rounds = Array.from(new Set(picks.map((p) => p.round))).sort((a, b) => (a ?? 0) - (b ?? 0));
    // Column order follows round one, which is the draft order.
    const firstRound = picks
      .filter((p) => p.round === rounds[0])
      .sort((a, b) => (a.round_pick ?? 0) - (b.round_pick ?? 0));
    const columns = firstRound.map((p) => ({
      ownerId: p.owner_id,
      teamName: p.team_name,
    }));
    return { rounds, columns, picks };
  }, [draft]);

  const playerById = useMemo(() => {
    if (players.state !== "ready") return new Map<number, { name: string; position: string; nfl_team: string | null }>();
    return new Map(players.data.map((p) => [p.player_id, p]));
  }, [players]);

  return (
    <div className="shell" style={{ paddingTop: "2.2rem" }}>
      <h1 style={{ fontSize: "clamp(1.8rem, 5vw, 2.6rem)" }}>Draft archive</h1>
      <p className="prose-narrow" style={{ marginTop: "0.6rem" }}>
        Every pick ESPN still has on record, laid out as the board looked on draft day.
      </p>

      <div className="pill-row" style={{ marginTop: "1.3rem" }}>
        {seasons.map((year) => (
          <button
            key={year}
            type="button"
            className="pill"
            aria-pressed={season === year}
            onClick={() => setSeason(year)}
          >
            {year}
          </button>
        ))}
      </div>

      {draft.state === "loading" ? <Loading what={`the ${season} draft`} /> : null}
      {draft.state === "error" ? (
        <Empty>
          ESPN has no draft data for {season}. Draft history is one of the datasets ESPN does not
          serve consistently for older seasons; the glossary lists what is available.
        </Empty>
      ) : null}

      {board ? (
        <>
          <Band title={`${season} draft board`} note={`${board.picks.length} picks across ${board.rounds.length} rounds`} />
          <div className="sheet" style={{ marginTop: "0.4rem" }}>
            <table style={{ minWidth: `${Math.max(board.columns.length * 11, 44)}rem` }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Rd</th>
                  {board.columns.map((column, index) => (
                    <th key={`${column.ownerId}-${index}`} style={{ textAlign: "left" }}>
                      <OwnerLink ownerId={column.ownerId}>{column.teamName}</OwnerLink>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {board.rounds.map((round) => (
                  <tr key={round}>
                    <td style={{ textAlign: "left", color: "var(--color-low)" }}>{round}</td>
                    {board.columns.map((column, index) => {
                      const pick = board.picks.find(
                        (p) => p.round === round && p.owner_id === column.ownerId,
                      );
                      const player = pick?.player_id ? playerById.get(pick.player_id) : null;
                      return (
                        <td
                          key={`${round}-${column.ownerId}-${index}`}
                          style={{ textAlign: "left", verticalAlign: "top", whiteSpace: "normal" }}
                        >
                          {pick ? (
                            <>
                              <span style={{ display: "block" }}>
                                {player?.name ?? `Player ${pick.player_id}`}
                              </span>
                              <span style={{ color: "var(--color-low)", fontSize: "0.76rem" }}>
                                {player?.position ?? ""}
                                {player?.nfl_team ? `, ${player.nfl_team}` : ""}
                                {pick.overall_pick ? `, #${pick.overall_pick}` : ""}
                                {pick.keeper ? ", keeper" : ""}
                              </span>
                            </>
                          ) : (
                            <span style={{ color: "var(--color-low)" }}>&mdash;</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="prose-narrow" style={{ marginTop: "1rem", fontSize: "0.84rem" }}>
            Columns follow the first-round order. Later rounds are placed by owner, so a snake
            draft reads left to right and then right to left down the board.
          </p>
        </>
      ) : null}
    </div>
  );
}
