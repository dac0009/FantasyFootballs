import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { EditableText, useEditorial } from "../components/Editorial";
import { Band, Empty, ErrorState, Loading, Metric, OwnerLink } from "../components/primitives";
import { canUseTradeAnalyzer } from "../lib/editor";
import { useCurrent, useMeta, usePlayers, useRoster, useTradeValues } from "../lib/data";
import { computeTradeValue, currentRosterByOwner, type TradeComponent, type TradeSide } from "../lib/tradeAnalyzer";
import type { Player, RosterRow, TradeValues } from "../lib/types";

export default function TradeAnalyzer() {
  const { member, ready } = useEditorial();
  const meta = useMeta();

  if (!ready || meta.state === "loading") return <div className="shell account-page">Checking access…</div>;
  if (!canUseTradeAnalyzer(member)) {
    return (
      <div className="shell account-page">
        <span className="section-kicker">Beta · Commissioner only</span>
        <h1>Trade Analyzer</h1>
        <p>Sign in with the commissioner account to use the trade analyzer.</p>
        <Link to="/account">Sign in</Link>
      </div>
    );
  }
  if (meta.state === "error") return <ErrorState error={meta.error} what="League data" />;

  return <Analyzer currentSeason={meta.data.current_season} />;
}

function Analyzer({ currentSeason }: { currentSeason: number }) {
  const current = useCurrent();
  const players = usePlayers();
  const roster = useRoster(currentSeason);
  const tradeValues = useTradeValues();

  if (current.state === "error") return <ErrorState error={current.error} what="Standings" />;
  if (players.state === "error") return <ErrorState error={players.error} what="Player index" />;
  if (roster.state === "error") return <ErrorState error={roster.error} what="Current rosters" />;
  if (tradeValues.state === "error") return <ErrorState error={tradeValues.error} what="Trade values" />;
  if (
    current.state !== "ready" ||
    players.state !== "ready" ||
    roster.state !== "ready" ||
    tradeValues.state !== "ready"
  ) {
    return <Loading what="the trade analyzer" />;
  }

  const trade = tradeValues.data;
  const teams = current.data.standings.filter((row) => row.team_name);

  return (
    <div className="shell" style={{ paddingTop: "2rem" }}>
      <div className="section-kicker">Beta · Commissioner only</div>
      <h1><EditableText id="site.trade-analyzer.a1c3e5f7b9" fallback="Trade Analyzer" /></h1>
      <p className="prose-narrow">
        <EditableText
          id="site.trade-analyzer.d2e4f6a8c0"
          fallback="Pick players going each direction and the composite Trade Value score updates live. This is this league's own metric, not an outside grade — the breakdown below shows exactly what drove every number."
        />{" "}
        <Metric name="trade_value">Trade Value methodology</Metric>.
      </p>
      {trade ? (
        <Explorer trade={trade} teams={teams} players={players.data} rosterRows={roster.data} />
      ) : (
        <Empty>
          Trade values are unavailable for this data snapshot — ESPN returned no lineup-level
          data for the current season. The next analytics refresh will calculate them once
          roster data is available.
        </Empty>
      )}
    </div>
  );
}

function Explorer({
  trade,
  teams,
  players,
  rosterRows,
}: {
  trade: TradeValues;
  teams: { owner_id: string; team_name: string | null }[];
  players: Player[];
  rosterRows: RosterRow[];
}) {
  const playersById = useMemo(() => new Map(players.map((p) => [p.player_id, p])), [players]);
  const rosterByOwner = useMemo(() => currentRosterByOwner(rosterRows), [rosterRows]);
  const rosterOf = (ownerId: string) =>
    (rosterByOwner.get(ownerId) ?? [])
      .map((id) => playersById.get(id))
      .filter((p): p is Player => !!p)
      .sort((a, b) => a.position.localeCompare(b.position) || a.name.localeCompare(b.name));

  const [teamAId, setTeamAId] = useState(teams[0]?.owner_id ?? "");
  const [teamBId, setTeamBId] = useState(teams[1]?.owner_id ?? teams[0]?.owner_id ?? "");
  const [aSends, setASends] = useState<number[]>([]);
  const [bSends, setBSends] = useState<number[]>([]);

  const teamAName = teams.find((t) => t.owner_id === teamAId)?.team_name ?? teamAId;
  const teamBName = teams.find((t) => t.owner_id === teamBId)?.team_name ?? teamBId;

  const result = useMemo(() => {
    if (!teamAId || !teamBId || teamAId === teamBId) return null;
    const aGives = aSends.map((id) => playersById.get(id)).filter((p): p is Player => !!p);
    const bGives = bSends.map((id) => playersById.get(id)).filter((p): p is Player => !!p);
    return computeTradeValue(trade, teamAId, teamBId, aGives, bGives);
  }, [trade, teamAId, teamBId, aSends, bSends, playersById]);

  function toggle(setter: typeof setASends, id: number) {
    setter((old) => (old.includes(id) ? old.filter((x) => x !== id) : [...old, id]));
  }

  function selectTeam(which: "a" | "b", ownerId: string) {
    if (which === "a") {
      setTeamAId(ownerId);
      setASends([]);
    } else {
      setTeamBId(ownerId);
      setBSends([]);
    }
  }

  return (
    <>
      <div className="trade-layout">
        <TeamPicker
          label="Team A sends"
          teams={teams}
          selected={teamAId}
          onSelect={(id) => selectTeam("a", id)}
          roster={rosterOf(teamAId)}
          sending={aSends}
          onToggle={(id) => toggle(setASends, id)}
        />
        <TeamPicker
          label="Team B sends"
          teams={teams}
          selected={teamBId}
          onSelect={(id) => selectTeam("b", id)}
          roster={rosterOf(teamBId)}
          sending={bSends}
          onToggle={(id) => toggle(setBSends, id)}
        />
      </div>

      {teamAId === teamBId ? (
        <Empty>Pick two different teams to analyze a trade.</Empty>
      ) : result ? (
        <div className="trade-layout">
          <TeamResult name={teamAName} side={result.teamA} />
          <TeamResult name={teamBName} side={result.teamB} />
        </div>
      ) : null}

      <p className="figure-label">
        <EditableText
          id="site.trade-analyzer.b3d5f7a9c1"
          fallback="Positive Trade Value means that team comes out ahead by this metric; negative means they lose the deal. Both sides are scored independently and are not required to sum to zero."
        />
      </p>

      <style>{`
        .trade-layout {display:grid;gap:2rem;grid-template-columns:minmax(0,1fr) minmax(0,1fr);margin-top:1.5rem}
        .trade-team-select {display:flex;flex-direction:column;gap:.5rem;margin-bottom:.9rem}
        .trade-roster {display:flex;flex-wrap:wrap;gap:.4rem}
        .trade-roster .pill {font-size:.78rem}
        .trade-score {font-family:var(--font-display);font-size:2.1rem;font-weight:700;line-height:1}
        .trade-breakdown {margin-top:.9rem}
        .trade-breakdown table {font-size:.78rem}
        .trade-empty-note {color:var(--ink-faint);font-size:.78rem;margin-top:.4rem}
        @media(max-width:850px){.trade-layout{grid-template-columns:1fr}}
      `}</style>
    </>
  );
}

function TeamPicker({
  label,
  teams,
  selected,
  onSelect,
  roster,
  sending,
  onToggle,
}: {
  label: string;
  teams: { owner_id: string; team_name: string | null }[];
  selected: string;
  onSelect: (ownerId: string) => void;
  roster: Player[];
  sending: number[];
  onToggle: (playerId: number) => void;
}) {
  return (
    <section>
      <Band title={label} note={`${sending.length} player${sending.length === 1 ? "" : "s"} selected`} />
      <label className="trade-team-select">
        Team
        <select className="select" value={selected} onChange={(e) => onSelect(e.target.value)}>
          {teams.map((t) => (
            <option key={t.owner_id} value={t.owner_id}>
              {t.team_name}
            </option>
          ))}
        </select>
      </label>
      {roster.length ? (
        <div className="trade-roster">
          {roster.map((p) => (
            <button
              key={p.player_id}
              type="button"
              className="pill"
              aria-pressed={sending.includes(p.player_id)}
              onClick={() => onToggle(p.player_id)}
            >
              {p.name} <small>{p.position}</small>
            </button>
          ))}
        </div>
      ) : (
        <p className="trade-empty-note">No current roster found for this team.</p>
      )}
    </section>
  );
}

function TeamResult({ name, side }: { name: string | null; side: TradeSide }) {
  const sign = side.score > 0 ? "+" : "";
  const toneClass = side.score > 0.05 ? "num-pos" : side.score < -0.05 ? "num-neg" : "";
  return (
    <section>
      <Band title={<OwnerLink ownerId={side.ownerId}>{name}</OwnerLink>} note="Trade Value" />
      <div className={`trade-score ${toneClass}`}>
        {sign}
        {side.score.toFixed(1)}
      </div>
      <ComponentTable title="Receives" rows={side.gains} sign={1} />
      <ComponentTable title="Gives up" rows={side.losses} sign={-1} />
    </section>
  );
}

function ComponentTable({ title, rows, sign }: { title: string; rows: TradeComponent[]; sign: 1 | -1 }) {
  if (!rows.length) return null;
  return (
    <div className="sheet trade-breakdown">
      <table>
        <caption className="figure-label" style={{ textAlign: "left" }}>
          {title}
        </caption>
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>Player</th>
            <th>Base</th>
            <th>Reliability</th>
            <th>Recent form</th>
            <th>Need fit</th>
            <th>Leverage</th>
            <th>Contribution</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.playerId}>
              <td style={{ textAlign: "left", whiteSpace: "normal" }}>
                {row.name} <small>{row.position}</small>
                {!row.hasHistory && (
                  <small className="trade-empty-note"> · no history, using position average</small>
                )}
              </td>
              <td>{row.valueBase.toFixed(1)}</td>
              <td>×{row.reliabilityFactor.toFixed(2)}</td>
              <td>×{row.recentFormFactor.toFixed(2)}</td>
              <td>×{row.needFitFactor.toFixed(2)}</td>
              <td>×{row.leverageFactor.toFixed(2)}</td>
              <td className={sign > 0 ? "num-pos" : "num-neg"}>
                {sign > 0 ? "+" : "−"}
                {row.contribution.toFixed(1)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
