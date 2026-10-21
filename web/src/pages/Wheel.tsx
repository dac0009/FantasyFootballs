import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { EditableText, useEditorial } from "../components/Editorial";
import { Band, ErrorState, Loading, OwnerLink } from "../components/primitives";
import { useOwnerIndex, usePlayers, useRoster, useSeason, useSeasonIndex } from "../lib/data";
import { points as fmt } from "../lib/format";
import type { Matchup } from "../lib/types";
import {
  buildGame, dailyKey, hashSeed, lineupPoints, mulberry32, pickSeasonWeek, pickTeams,
  teamCandidates, validateLineup,
} from "../lib/wheelEngine.mjs";
import type { Game, GamePlayer, Lineup, PoolPlayer } from "../lib/wheelEngine.mjs";
import { loadPlays, savePlay, summarize, type PlaysResult } from "../lib/wheelPlays";

const MAX_PICKUPS = 2;
const WEEK_CHOICES = Array.from({ length: 17 }, (_, i) => `Week ${i + 1}`);

type Stage = "idle" | "spinning" | "lineup" | "reveal";
type Mode = "daily" | "practice";
interface Spin { mode: Mode; key: string; season: number; week: number }

function useReducedMotion() {
  return useMemo(
    () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
    [],
  );
}

export default function Wheel() {
  const seasons = useSeasonIndex();
  const owners = useOwnerIndex();
  const players = usePlayers();
  const { member, session } = useEditorial();

  const [spin, setSpin] = useState<Spin | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [game, setGame] = useState<Game | null>(null);
  const [lineup, setLineup] = useState<Lineup>({});
  const [openSlot, setOpenSlot] = useState<string | null>(null);
  const [yearDone, setYearDone] = useState(false);
  const [weekDone, setWeekDone] = useState(false);
  const [plays, setPlays] = useState<PlaysResult | null>(null);
  const [saved, setSaved] = useState<{ ok: boolean; message: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const saving = useRef(false);

  const season = useSeason(spin?.season ?? null);
  const roster = useRoster(spin?.season ?? null);
  const todayKey = `daily:${dailyKey()}`;

  useEffect(() => {
    let live = true;
    loadPlays().then((r) => live && setPlays(r));
    return () => { live = false; };
  }, []);

  // Build the game once the season and its rosters are in. Picks are seeded
  // from the spin key, never from a shared random stream, so re-running this
  // (React does, in development) cannot change the outcome.
  useEffect(() => {
    if (!spin || game || season.state !== "ready" || roster.state !== "ready" || players.state !== "ready") return;
    const payload = season.data;
    const rowsFor = (w: number) => roster.data.filter((r) => r.week === w);
    const matchupsFor = (w: number): Matchup[] => payload.weeks.find((x) => x.week === w)?.matchups ?? [];

    let week = spin.week;
    let candidates = teamCandidates(rowsFor(week), matchupsFor(week));
    if (candidates.length < 2) {
      const alternatives = payload.weeks.filter((w) => w.has_results && w.week !== week).map((w) => w.week).sort((a, b) => a - b);
      const start = Math.floor(mulberry32(hashSeed(`${spin.key}:week`))() * Math.max(1, alternatives.length));
      for (let k = 0; k < alternatives.length && candidates.length < 2; k++) {
        week = alternatives[(start + k) % alternatives.length];
        candidates = teamCandidates(rowsFor(week), matchupsFor(week));
      }
    }
    if (candidates.length < 2) {
      setProblem(`No playable week with rosters on file for ${spin.season}.`);
      setStage("idle");
      setSpin(null);
      return;
    }

    const teams = new Map<number, { name: string; owner_id: string | null }>();
    for (const m of matchupsFor(week)) {
      if (m.home_team_id != null) teams.set(m.home_team_id, { name: m.home_team_name ?? `Team ${m.home_team_id}`, owner_id: m.home_owner_id });
      if (m.away_team_id != null) teams.set(m.away_team_id, { name: m.away_team_name ?? `Team ${m.away_team_id}`, owner_id: m.away_owner_id });
    }
    const { teamId, opponentId } = pickTeams(mulberry32(hashSeed(`${spin.key}:${spin.season}:${week}:teams`)), candidates);
    const built = buildGame({ season: spin.season, week, teamId, opponentId, rows: roster.data, players: players.data, matchups: matchupsFor(week), teams });
    setGame(built);
    setLineup(built.actual.lineup);
    if (week !== spin.week) setSpin({ ...spin, week });
  }, [spin, game, season, roster, players]);

  const ownerName = (id: string | null | undefined) =>
    (id && owners.state === "ready" ? owners.data.find((o) => o.owner_id === id)?.name : null) ?? "Unknown owner";
  const first = (id: string | null | undefined) => (id ? ownerName(id).split(" ")[0] : "The owner");

  function start(mode: Mode) {
    if (seasons.state !== "ready") return;
    const pool = seasons.data
      .filter((s) => mode === "practice" || !s.is_current)
      .map((s) => ({ season: s.season, weeks: s.completed_weeks }));
    const key = mode === "daily" ? `ffbffl-wheel-${dailyKey()}` : `practice-${Date.now()}-${Math.random()}`;
    const picked = pickSeasonWeek(mulberry32(hashSeed(key)), pool);
    setProblem(null); setSaved(null); saving.current = false;
    setGame(null); setLineup({}); setOpenSlot(null); setYearDone(false); setWeekDone(false);
    setSpin({ mode, key, ...picked });
    setStage("spinning");
  }

  const byId = useMemo(() => {
    const map = new Map<number, GamePlayer | PoolPlayer>();
    for (const p of game?.roster ?? []) map.set(p.player_id, p);
    for (const p of game?.pool ?? []) map.set(p.player_id, p);
    return map;
  }, [game]);
  const poolIds = useMemo(() => new Set((game?.pool ?? []).map((p) => p.player_id)), [game]);
  const inLineup = new Set(Object.values(lineup).filter((v): v is number => v != null));
  const pickups = [...inLineup].filter((id) => poolIds.has(id));

  const yours = game ? lineupPoints(lineup, byId) : 0;
  const projected = [...inLineup].reduce((t, id) => t + (byId.get(id)?.projected ?? 0), 0);

  // Post a daily result exactly once, after the reveal.
  useEffect(() => {
    if (stage !== "reveal" || !game || !spin || spin.mode !== "daily" || saving.current) return;
    if (!session || !member?.owner_id) return;
    saving.current = true;
    savePlay({
      game_key: todayKey, user_id: session.user.id, owner_id: member.owner_id,
      season: game.season, week: game.week, team_id: game.you.teamId, opponent_team_id: game.opponent.teamId,
      points: yours, opponent_points: game.opponent.points, actual_points: game.actual.points, optimal_points: game.optimal.points,
      lineup, pickups,
    }).then((result) => {
      setSaved(result.ok ? { ok: true, message: "Posted to today's board." } : { ok: false, message: result.message });
      if (result.ok || result.reason === "duplicate") loadPlays().then(setPlays);
    });
  }, [stage, game, spin, session, member, todayKey, yours, lineup, pickups]);

  if (seasons.state === "loading" || owners.state === "loading") return <Loading what="the wheel" />;
  if (seasons.state === "error") return <ErrorState error={seasons.error} what="The Wheel" />;
  if (owners.state === "error") return <ErrorState error={owners.error} what="The Wheel" />;
  if (season.state === "error") return <ErrorState error={season.error} what="That season" />;
  if (roster.state === "error") return <ErrorState error={roster.error} what="Those rosters" />;
  if (players.state === "error") return <ErrorState error={players.error} what="The player list" />;

  const todays = plays?.status === "ready" ? plays.plays.filter((p) => p.game_key === todayKey).sort((a, b) => b.points - a.points) : [];
  const mine = member?.owner_id ? todays.find((p) => p.owner_id === member.owner_id) : undefined;
  const yearChoices = seasons.data.map((s) => String(s.season));
  const teamChoices = season.state === "ready" && game
    ? [...new Set(season.data.weeks.flatMap((w) => w.matchups.flatMap((m) => [m.home_team_name, m.away_team_name])))].filter((n): n is string => !!n)
    : ["…"];

  return (
    <div className="shell wheel" style={{ paddingTop: "2.2rem" }}>
      <p className="section-kicker" style={{ marginBottom: "0.4rem" }}>Wayback lineup machine</p>
      <h1 style={{ fontSize: "clamp(1.8rem, 5vw, 2.6rem)" }}>
        <EditableText id="site.wheel.title" fallback="The Wheel" />
      </h1>
      <p className="prose-narrow" style={{ marginTop: "0.6rem" }}>
        <EditableText
          id="site.wheel.intro"
          fallback="A real week from league history, a real roster, and the points those players actually scored. Set the lineup better than the man who owned it."
        />
      </p>

      <div className="reels" aria-live="polite">
        <Reel key={`y-${spin?.key ?? "idle"}`} label="Season" choices={yearChoices} active={stage === "spinning"} value={spin ? String(spin.season) : null} onSettled={() => setYearDone(true)} />
        <Reel key={`w-${spin?.key ?? "idle"}`} label="Week" choices={WEEK_CHOICES} active={stage === "spinning"} value={yearDone && game ? `Week ${game.week}` : null} onSettled={() => setWeekDone(true)} />
        <Reel key={`t-${spin?.key ?? "idle"}`} label="Your team" choices={teamChoices} active={stage === "spinning"} value={weekDone && game ? game.you.name : null} steps={14} onSettled={() => setStage("lineup")} wide />
      </div>

      {stage === "idle" ? (
        <div className="wheel-start">
          {mine ? (
            <p className="notice" style={{ marginBottom: "0.9rem" }}>
              You already spun today: <b>{fmt(mine.points)}</b> with {mine.season} Week {mine.week}
              {mine.points > mine.opponent_points ? ", a win" : ", a loss"}. Today's board is below; practice spins don't count.
            </p>
          ) : null}
          <div className="pill-row" style={{ marginTop: 0 }}>
            <button type="button" className="pill publish-primary" disabled={!!mine} onClick={() => start("daily")}>
              Spin today's wheel
            </button>
            <button type="button" className="pill" onClick={() => start("practice")}>Practice spin</button>
          </div>
          <p className="wheel-fine">
            Everyone gets the same daily spin, one per owner, scored to the board. Practice spins are unlimited and private.
            Free agency is league style: anyone another team left on its bench that week, up to {MAX_PICKUPS} pickups.
          </p>
          {problem ? <p className="notice">{problem}</p> : null}
        </div>
      ) : null}

      {stage === "spinning" && (season.state === "loading" || roster.state === "loading") ? (
        <p className="wheel-fine">Pulling {spin?.season} rosters…</p>
      ) : null}

      {(stage === "lineup" || stage === "reveal") && game && spin ? (
        <section className="board">
          <div className="board-head">
            <div>
              <p className="issue-kicker">{game.season} · Week {game.week} · {spin.mode === "daily" ? "Today's spin" : "Practice"}</p>
              <h2 className="board-title">{game.you.name}</h2>
              <p className="board-note">
                <OwnerLink ownerId={game.you.owner_id}>{ownerName(game.you.owner_id)}</OwnerLink>'s roster, exactly as it stood that week.
                {stage === "lineup"
                  ? " Projections are what he saw. Real points stay hidden until you lock it in. Your opponent is a mystery team from the same week."
                  : ""}
              </p>
            </div>
            {stage === "lineup" ? (
              <div className="board-meter">
                <span><small>Projected</small>{fmt(projected, 1)}</span>
                <span><small>Pickups</small>{pickups.length}/{MAX_PICKUPS}</span>
              </div>
            ) : null}
          </div>

          <ol className="slots">
            {game.keys.map(({ key, slot }) => {
              const id = lineup[key];
              const p = id != null ? byId.get(id) : undefined;
              const open = openSlot === key;
              const actualId = game.actual.lineup[key];
              return (
                <li key={key} className={`slot${open ? " slot-open" : ""}`}>
                  <button type="button" className="slot-row" disabled={stage !== "lineup"} aria-expanded={open} onClick={() => setOpenSlot(open ? null : key)}>
                    <span className="slot-tag">{slot}</span>
                    <span className="slot-player">
                      {p ? (
                        <>
                          {p.name}
                          <small>
                            {p.position}
                            {poolIds.has(p.player_id) ? ` · pickup from ${(p as PoolPlayer).from_team}` : ""}
                            {stage === "reveal" && actualId !== p.player_id ? " · your change" : ""}
                          </small>
                        </>
                      ) : (
                        <em>Empty slot</em>
                      )}
                    </span>
                    {stage === "reveal" ? (
                      <span className="slot-pts figure">{p ? fmt(p.points) : "0.00"}</span>
                    ) : (
                      <span className="slot-proj">{p?.projected != null ? fmt(p.projected, 1) : "—"}<small>proj</small></span>
                    )}
                  </button>
                  {open && stage === "lineup" ? (
                    <Picker
                      slot={slot}
                      current={p ?? null}
                      bench={game.roster.filter((r) => !inLineup.has(r.player_id) && eligibleFor(r.position, slot))}
                      pool={game.pool.filter((r) => !inLineup.has(r.player_id) && eligibleFor(r.position, slot))}
                      pickupsLeft={MAX_PICKUPS - pickups.length + (p && poolIds.has(p.player_id) ? 1 : 0)}
                      onPick={(pid) => { setLineup({ ...lineup, [key]: pid }); setOpenSlot(null); }}
                    />
                  ) : null}
                </li>
              );
            })}
          </ol>

          {stage === "lineup" ? (
            <div className="board-foot">
              <button
                type="button"
                className="pill publish-primary"
                onClick={() => {
                  const errors = validateLineup(lineup, game.template, byId);
                  if (errors.length) { setProblem(errors.join(" · ")); return; }
                  setProblem(null); setOpenSlot(null); setStage("reveal");
                }}
              >
                Lock it in
              </button>
              <button type="button" className="pill" onClick={() => setLineup(game.actual.lineup)}>Reset to {first(game.you.owner_id)}'s lineup</button>
              {problem ? <span className="wheel-problem">{problem}</span> : null}
            </div>
          ) : null}

          {stage === "reveal" ? (
            <Reveal
              game={game}
              yours={yours}
              pickups={pickups.map((id) => byId.get(id)!).filter(Boolean)}
              first={first}
              ownerName={ownerName}
              saved={saved}
              signedIn={!!session && !!member?.owner_id}
              daily={spin.mode === "daily"}
              onAgain={() => start("practice")}
            />
          ) : null}
        </section>
      ) : null}

      <Band title="Today's board" note={dailyKey()} id="board" />
      {plays?.status === "ready" ? (
        todays.length ? (
          <div className="sheet">
            <table>
              <thead><tr><th style={{ textAlign: "left" }}>Owner</th><th>Points</th><th>Opponent</th><th>Result</th><th>vs owner's real lineup</th><th data-secondary="true">Of best possible</th></tr></thead>
              <tbody>
                {todays.map((p, i) => (
                  <tr key={p.owner_id} style={member?.owner_id === p.owner_id ? { fontWeight: 600 } : undefined}>
                    <td style={{ textAlign: "left" }}><span style={{ color: "var(--color-low)", marginRight: ".5rem" }}>{i + 1}</span><OwnerLink ownerId={p.owner_id}>{ownerName(p.owner_id)}</OwnerLink></td>
                    <td className="figure">{fmt(p.points)}</td>
                    <td>{fmt(p.opponent_points)}</td>
                    <td className={p.points > p.opponent_points ? "num-pos" : p.points < p.opponent_points ? "num-neg" : ""}>{p.points > p.opponent_points ? "W" : p.points < p.opponent_points ? "L" : "T"}</td>
                    <td className={p.points > p.actual_points ? "num-pos" : p.points < p.actual_points ? "num-neg" : ""}>{signedDiff(p.points - p.actual_points)}</td>
                    <td data-secondary="true">{p.optimal_points ? `${Math.round((p.points / p.optimal_points) * 100)}%` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="wheel-fine">Nobody has spun yet today. {member ? "" : "Sign in to put your name on it."}</p>
        )
      ) : plays?.status === "unavailable" ? (
        member?.role === "commissioner" ? (
          <p className="notice">Scores aren't being saved yet: the <code>wheel_plays</code> table is missing. Run <code>supabase/migrations/202610210002_wheel_plays.sql</code> in the Supabase SQL editor.</p>
        ) : (
          <p className="wheel-fine">The board is warming up. Spins still work.</p>
        )
      ) : plays?.status === "not-configured" ? (
        <p className="wheel-fine">Scores aren't saved on this build.</p>
      ) : (
        <p className="wheel-fine">Loading the board…</p>
      )}

      {plays?.status === "ready" && plays.plays.length ? (
        <>
          <Band title="All-time" note={`${plays.plays.length} daily ${plays.plays.length === 1 ? "spin" : "spins"} on record`} />
          <div className="sheet">
            <table>
              <thead><tr><th style={{ textAlign: "left" }}>Owner</th><th>Spins</th><th>Record</th><th>Beat the real owner</th><th>Average</th><th data-secondary="true">Best</th></tr></thead>
              <tbody>
                {summarize(plays.plays).map((r) => (
                  <tr key={r.owner_id}>
                    <td style={{ textAlign: "left" }}><OwnerLink ownerId={r.owner_id}>{ownerName(r.owner_id)}</OwnerLink></td>
                    <td>{r.plays}</td>
                    <td>{r.wins}–{r.plays - r.wins}</td>
                    <td>{r.beatOwner} of {r.plays}</td>
                    <td className="figure">{fmt(r.avg)}</td>
                    <td data-secondary="true">{fmt(r.best)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      <style>{`
        .reels { display: grid; grid-template-columns: 1fr 1fr 2fr; gap: 0.6rem; margin-top: 1.4rem; }
        .reel {
          border: 1px solid var(--rule); border-top: 3px solid var(--ink); background: var(--paper-deep);
          padding: 0.7rem 0.85rem 0.8rem; min-height: 5.2rem; display: flex; flex-direction: column; justify-content: space-between;
        }
        .reel-label { font: 600 0.66rem var(--font-body); letter-spacing: 0.12em; text-transform: uppercase; color: var(--ink-faint); }
        .reel-value { font-family: var(--font-display); font-weight: 700; font-size: clamp(1.4rem, 4.5vw, 2rem); line-height: 1.05; color: var(--ink-soft); overflow-wrap: anywhere; }
        .reel-spinning .reel-value { color: var(--ink-faint); }
        .reel-done .reel-value { color: var(--ink); }
        .reel-done { border-top-color: var(--ember); }
        .wheel-start { margin-top: 1.2rem; }
        .wheel-fine { color: var(--color-low); font-size: 0.82rem; line-height: 1.5; max-width: 44rem; margin: 0.9rem 0 0; }
        .wheel-problem { color: var(--neg); font-size: 0.84rem; }
        .board { margin-top: 1.6rem; border-top: 3px double var(--ink); padding-top: 1rem; }
        .board-head { display: flex; justify-content: space-between; gap: 1rem; flex-wrap: wrap; align-items: flex-start; }
        .board-title { font-size: clamp(1.5rem, 4.5vw, 2.1rem); margin-top: 0.3rem; }
        .board-note { margin: 0.5rem 0 0; color: var(--color-mid); font-size: 0.9rem; max-width: 40rem; line-height: 1.45; }
        .board-meter { display: flex; gap: 1.4rem; font-family: var(--font-display); font-weight: 700; font-size: 1.3rem; }
        .board-meter small { display: block; font: 600 0.64rem var(--font-body); letter-spacing: 0.1em; text-transform: uppercase; color: var(--ink-faint); }
        .slots { list-style: none; padding: 0; margin: 1rem 0 0; border-top: 2px solid var(--ink); }
        .slot { border-bottom: 1px solid var(--rule-soft); }
        .slot-row {
          display: grid; grid-template-columns: 3.4rem 1fr auto; gap: 0.8rem; align-items: center; width: 100%;
          padding: 0.6rem 0.2rem; background: none; border: 0; font: inherit; color: inherit; text-align: left; cursor: pointer;
        }
        .slot-row:disabled { cursor: default; }
        .slot-open .slot-row { background: var(--paper-deep); }
        .slot-tag { font: 700 0.66rem var(--font-body); letter-spacing: 0.08em; color: var(--paper-deep); background: var(--ink-soft); padding: 0.2rem 0; text-align: center; }
        .slot-player { font-size: 0.95rem; line-height: 1.2; }
        .slot-player small { display: block; color: var(--color-low); font-size: 0.74rem; margin-top: 0.1rem; }
        .slot-player em { color: var(--ink-faint); }
        .slot-proj { font-family: var(--font-display); font-weight: 700; font-size: 1.05rem; text-align: right; }
        .slot-proj small { display: block; font: 600 0.58rem var(--font-body); letter-spacing: 0.1em; text-transform: uppercase; color: var(--ink-faint); }
        .slot-pts { font-size: 1.15rem; }
        .picker { padding: 0.4rem 0.2rem 0.9rem; background: var(--paper-deep); }
        .picker h4 { margin: 0.7rem 0 0.3rem; font: 600 0.64rem var(--font-body); letter-spacing: 0.12em; text-transform: uppercase; color: var(--ink-faint); }
        .picker-row { display: grid; grid-template-columns: 1fr auto auto; gap: 0.6rem; align-items: center; padding: 0.35rem 0; border-bottom: 1px solid var(--rule-soft); font-size: 0.88rem; }
        .picker-row small { display: block; color: var(--color-low); font-size: 0.72rem; }
        .picker-row .figure { font-size: 0.95rem; }
        .picker-empty { color: var(--ink-faint); font-size: 0.82rem; margin: 0.3rem 0; }
        .board-foot { display: flex; gap: 0.6rem; flex-wrap: wrap; align-items: center; margin-top: 1rem; }
        .reveal { margin-top: 1.4rem; }
        .scoreline-big { display: grid; grid-template-columns: 1fr auto 1fr; gap: 1rem; align-items: baseline; text-align: center; margin: 0.4rem 0 1rem; }
        .scoreline-big .n { font-family: var(--font-display); font-weight: 700; font-size: clamp(2.4rem, 9vw, 4rem); line-height: 1; }
        .scoreline-big .vs { color: var(--ink-faint); font: 600 0.7rem var(--font-body); letter-spacing: 0.14em; text-transform: uppercase; }
        .scoreline-big small { display: block; font: 600 0.66rem var(--font-body); letter-spacing: 0.1em; text-transform: uppercase; color: var(--ink-faint); margin-top: 0.3rem; }
        .bars { margin-top: 0.6rem; }
        .bar { display: grid; grid-template-columns: 11rem 1fr auto; gap: 0.7rem; align-items: center; padding: 0.42rem 0; border-bottom: 1px solid var(--rule-soft); font-size: 0.86rem; }
        .bar-track { height: 10px; background: rgba(32,32,32,0.08); overflow: hidden; }
        .bar-fill { height: 100%; width: 0; background: var(--ink-soft); transition: width 1.1s cubic-bezier(.2,.7,.2,1); }
        .bar-you .bar-fill { background: var(--ember); }
        .bar-best .bar-fill { background: var(--rule); }
        .bar .figure { font-size: 1rem; min-width: 4.2rem; text-align: right; }
        .verdict { margin-top: 1rem; max-width: 44rem; }
        .verdict p { margin: 0.35rem 0; line-height: 1.5; }
        .verdict .lede { font-family: var(--font-display); font-size: 1.2rem; font-weight: 600; }
        @media (max-width: 640px) {
          .reels { grid-template-columns: 1fr 1fr; }
          .reel-wide { grid-column: 1 / -1; }
          .bar { grid-template-columns: 1fr auto; }
          .bar-track { grid-column: 1 / -1; order: 3; }
          .slot-row { grid-template-columns: 2.9rem 1fr auto; gap: 0.6rem; }
        }
      `}</style>
    </div>
  );
}

function eligibleFor(position: string, slot: string) {
  return slot === position || (slot === "FLEX" && (position === "RB" || position === "WR" || position === "TE"));
}

function signedDiff(n: number) {
  const r = Math.round(n * 100) / 100;
  return r > 0 ? `+${fmt(r)}` : fmt(r);
}

function possessive(name: string) {
  return name.endsWith("s") ? `${name}'` : `${name}'s`;
}

function Reel({ label, choices, value, active, onSettled, steps = 12, wide = false }: {
  label: string; choices: string[]; value: string | null; active: boolean; onSettled: () => void; steps?: number; wide?: boolean;
}) {
  const [shown, setShown] = useState("—");
  const [done, setDone] = useState(false);
  const settle = useRef(onSettled);
  settle.current = onSettled;
  const pool = useRef(choices);
  pool.current = choices;
  const reduced = useReducedMotion();

  useEffect(() => {
    if (!active || done) return;
    const random = () => pool.current[Math.floor(Math.random() * pool.current.length)] ?? "…";
    if (value == null) {
      const id = window.setInterval(() => setShown(random()), 75);
      return () => window.clearInterval(id);
    }
    if (reduced) { setShown(value); setDone(true); settle.current(); return; }
    // Background tabs throttle timers to about one a second, so a wall-clock
    // budget makes the reel land instead of crawling through every tick.
    const deadline = performance.now() + 1.25 * (35 * steps + (1.3 * steps ** 3) / 3) + 400;
    let step = 0;
    let timer = 0;
    const tick = () => {
      step += 1;
      if (step >= steps || performance.now() >= deadline) { setShown(value); setDone(true); settle.current(); return; }
      setShown(random());
      timer = window.setTimeout(tick, 35 + 1.3 * step * step);
    };
    timer = window.setTimeout(tick, 35);
    return () => window.clearTimeout(timer);
  }, [active, value, done, reduced, steps]);

  return (
    <div className={`reel${wide ? " reel-wide" : ""}${done ? " reel-done" : active ? " reel-spinning" : ""}`}>
      <span className="reel-label">{label}</span>
      <span className="reel-value">{active || done ? shown : "—"}</span>
    </div>
  );
}

function Picker({ slot, current, bench, pool, pickupsLeft, onPick }: {
  slot: string; current: GamePlayer | PoolPlayer | null; bench: GamePlayer[]; pool: PoolPlayer[]; pickupsLeft: number;
  onPick: (id: number | null) => void;
}) {
  const sortByProj = <T extends GamePlayer>(list: T[]) => [...list].sort((a, b) => (b.projected ?? 0) - (a.projected ?? 0));
  return (
    <div className="picker">
      <h4>Your bench for {slot}</h4>
      {bench.length ? sortByProj(bench).map((p) => (
        <div key={p.player_id} className="picker-row">
          <span>{p.name}<small>{p.position}</small></span>
          <span className="figure">{p.projected != null ? fmt(p.projected, 1) : "—"}</span>
          <button type="button" className="pill" onClick={() => onPick(p.player_id)}>Start</button>
        </div>
      )) : <p className="picker-empty">Nobody eligible on the bench.</p>}
      <h4>Around the league · benched that week{pickupsLeft <= 0 ? " · no pickups left" : ""}</h4>
      {pool.length ? sortByProj(pool).slice(0, 25).map((p) => (
        <div key={p.player_id} className="picker-row">
          <span>{p.name}<small>{p.position} · on {p.from_team}</small></span>
          <span className="figure">{p.projected != null ? fmt(p.projected, 1) : "—"}</span>
          <button type="button" className="pill" disabled={pickupsLeft <= 0} onClick={() => onPick(p.player_id)}>Pick up</button>
        </div>
      )) : <p className="picker-empty">Nobody eligible was benched that week.</p>}
      {current ? (
        <p style={{ marginTop: "0.6rem" }}>
          <button type="button" className="pill" onClick={() => onPick(null)}>Leave {slot} empty</button>
        </p>
      ) : null}
    </div>
  );
}

function useCountUp(target: number, run: boolean, ms = 1400) {
  const [value, setValue] = useState(0);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!run) { setValue(0); return; }
    if (reduced) { setValue(target); return; }
    let raf = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      setValue(target * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, run, ms, reduced]);
  return value;
}

function Reveal({ game, yours, pickups, first, ownerName, saved, signedIn, daily, onAgain }: {
  game: Game; yours: number; pickups: (GamePlayer | PoolPlayer)[]; first: (id: string | null) => string;
  ownerName: (id: string | null) => string; saved: { ok: boolean; message: string } | null; signedIn: boolean; daily: boolean;
  onAgain: () => void;
}) {
  const opp = game.opponent.points;
  const actual = game.actual.points;
  const best = game.optimal.points;
  const shownYou = useCountUp(yours, true);
  const shownOpp = useCountUp(opp, true);
  const [grown, setGrown] = useState(false);
  useEffect(() => { const id = window.setTimeout(() => setGrown(true), 60); return () => window.clearTimeout(id); }, []);
  const max = Math.max(yours, opp, actual, best, 1);
  const width = (v: number) => (grown ? `${(v / max) * 100}%` : "0%");
  const you = first(game.you.owner_id);
  const oppOwner = first(game.opponent.owner_id);
  const eff = best > 0 ? Math.round((yours / best) * 100) : 0;

  const lede = yours > opp
    ? `You beat ${game.opponent.name}, ${fmt(yours)} to ${fmt(opp)}.`
    : yours < opp
      ? `${game.opponent.name} had you, ${fmt(opp)} to ${fmt(yours)}.`
      : `Dead even with ${game.opponent.name} at ${fmt(opp)}.`;
  const owner = yours > actual
    ? `${you} actually scored ${fmt(actual)} with this roster. You out-coached him by ${fmt(yours - actual)}.`
    : yours < actual
      ? `${you} actually scored ${fmt(actual)} with this roster. He had you by ${fmt(actual - yours)}, and he will bring it up.`
      : `${you} scored exactly this. You set his lineup for him.`;

  return (
    <div className="reveal">
      <div className="scoreline-big">
        <div><span className="n">{fmt(shownYou)}</span><small>You, as {game.you.name}</small></div>
        <span className="vs">against</span>
        <div><span className="n">{fmt(shownOpp)}</span><small>{game.opponent.name} · {oppOwner}</small></div>
      </div>
      <div className="bars">
        {[
          ["You", yours, "bar-you"],
          [`${game.opponent.name} (${ownerName(game.opponent.owner_id)})`, opp, ""],
          [`${you}'s real lineup`, actual, ""],
          ["Best possible from this roster", best, "bar-best"],
        ].map(([label, v, cls]) => (
          <div key={label as string} className={`bar ${cls}`}>
            <span>{label as string}</span>
            <div className="bar-track"><div className="bar-fill" style={{ width: width(v as number) }} /></div>
            <span className="figure">{fmt(v as number)}</span>
          </div>
        ))}
      </div>
      <div className="verdict">
        <p className="lede">{lede}</p>
        <p>{owner}</p>
        <p>Best possible was {fmt(best)}. You found {eff}% of it.</p>
        {pickups.length ? (
          <p>Your pickups: {pickups.map((p) => `${p.name} (${fmt(p.points)}${"from_team" in p ? `, off ${possessive(p.from_team)} bench` : ""})`).join("; ")}.</p>
        ) : null}
        {daily ? (
          saved ? <p className={saved.ok ? "num-pos" : "num-neg"}>{saved.message}</p>
            : signedIn ? <p className="wheel-fine">Posting to today's board…</p>
              : <p className="wheel-fine"><Link to="/account" className="link-quiet">Sign in</Link> to put this on today's board.</p>
        ) : null}
      </div>
      <p className="pill-row">
        <button type="button" className="pill" onClick={onAgain}>Practice spin</button>
        <a className="pill" href="#board">Today's board</a>
      </p>
    </div>
  );
}
