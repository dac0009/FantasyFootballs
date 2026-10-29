import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { EditableText, useEditorial } from "../components/Editorial";
import { Band, ErrorState, Loading, OwnerLink } from "../components/primitives";
import { useDraft, useOwnerIndex, usePlayers, useRoster, useSeasonIndex, useTeamWeeks } from "../lib/data";
import { points as fmt } from "../lib/format";
import { dailyKey, hashSeed, mulberry32 } from "../lib/wheelEngine.mjs";
import {
  buildSeason, dailySeason, nextUsableSpin, shareText, simulate, slotsFor, spinOptions, spinOrder,
} from "../lib/gauntletEngine.mjs";
import type { Board, DraftablePlayer, Picks, SeasonResult } from "../lib/gauntletEngine.mjs";
import { loadChampPlays, saveChampPlay, summarizeChamp, type ChampPlaysResult } from "../lib/champPlays";

// "Fourteen and Fantasy": the daily beat-the-champ game. Lives at /fourteen
// (old /wheel-beta links redirect there), alongside the original /wheel.

type Stage = "idle" | "season" | "draft" | "playing" | "done";
type Mode = "daily" | "practice";
interface Run { mode: Mode; key: string; season: number }

const REROLLS = 1;
const SLOT_LABEL: Record<string, string> = { "D/ST": "DEF" };

function useReducedMotion() {
  return useMemo(
    () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
    [],
  );
}

export default function WheelBeta() {
  const seasons = useSeasonIndex();
  const owners = useOwnerIndex();
  const players = usePlayers();
  const teamWeeks = useTeamWeeks();
  const { member, session } = useEditorial();
  const reduced = useReducedMotion();

  const [run, setRun] = useState<Run | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [picks, setPicks] = useState<Picks>({});
  const [history, setHistory] = useState<{ slot: string; spin: number }[]>([]);
  const [spin, setSpin] = useState(0);
  const [rerolls, setRerolls] = useState(REROLLS);
  const [choosing, setChoosing] = useState<number | null>(null);
  const [shown, setShown] = useState(0);
  const [plays, setPlays] = useState<ChampPlaysResult | null>(null);
  const [saved, setSaved] = useState<{ ok: boolean; message: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [landedSpin, setLandedSpin] = useState<number | null>(null);
  const saving = useRef(false);
  const spinRef = useRef<HTMLElement | null>(null);

  const roster = useRoster(run?.season ?? null);
  const draft = useDraft(run?.season ?? null);
  const today = dailyKey();
  const todayKey = `champ:${today}`;

  useEffect(() => {
    let live = true;
    loadChampPlays().then((r) => live && setPlays(r));
    return () => { live = false; };
  }, []);

  const pastSeasons = seasons.state === "ready" ? seasons.data.filter((s) => !s.is_current && s.champion) : [];
  const seasonRow = run ? pastSeasons.find((s) => s.season === run.season) ?? null : null;

  const board: Board | null = useMemo(() => {
    if (!run || !seasonRow || roster.state !== "ready" || players.state !== "ready" || teamWeeks.state !== "ready") return null;
    if (draft.state === "loading") return null;
    return buildSeason({
      season: run.season,
      regularSeasonWeeks: seasonRow.regular_season_weeks,
      rows: roster.data,
      players: players.data,
      teamWeeks: teamWeeks.data,
      draft: draft.state === "ready" ? draft.data : [],
      championOwnerId: seasonRow.champion!.owner_id,
    });
  }, [run, seasonRow, roster, draft, players, teamWeeks]);

  const order = useMemo(() => (board && run ? spinOrder(`${run.key}:spins`, board.spinTeams) : []), [board, run]);
  const keys = board?.keys ?? [];
  const filled = keys.filter((k) => picks[k.key]).length;
  const draftDone = keys.length > 0 && filled === keys.length;
  const currentTeam = order[spin] ?? null;
  const options = board && currentTeam != null && !draftDone ? spinOptions(board, currentTeam, keys, picks) : [];
  const result: SeasonResult | null = useMemo(
    () => (board && draftDone && (stage === "playing" || stage === "done") ? simulate(board, picks) : null),
    [board, draftDone, stage, picks],
  );

  // Land on the first usable spin whenever the board or picks change.
  useEffect(() => {
    if (!board || stage !== "draft" || draftDone) return;
    const next = nextUsableSpin(board, order, spin, keys, picks);
    if (next === -1) setSpin(order.length);
    else if (next !== spin) setSpin(next);
  }, [board, stage, order, spin, keys, picks, draftDone]);

  // After each pick, bring the next spin into view if it's scrolled off the top.
  useEffect(() => {
    const el = spinRef.current;
    if (!el || stage !== "draft" || filled === 0) return;
    if (el.getBoundingClientRect().top < 0) el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  }, [filled, stage, reduced]);

  // Reveal the season one week at a time.
  useEffect(() => {
    if (stage !== "playing" || !result) return;
    if (reduced || shown >= result.weeks.length) {
      if (shown < result.weeks.length) setShown(result.weeks.length);
      const id = window.setTimeout(() => setStage("done"), reduced ? 0 : 500);
      return () => window.clearTimeout(id);
    }
    const id = window.setTimeout(() => setShown((n) => n + 1), shown === 0 ? 250 : 420);
    return () => window.clearTimeout(id);
  }, [stage, result, shown, reduced]);

  // Post a daily result the moment the season starts playing, so reloading the
  // page after seeing the results can't produce a second try.
  useEffect(() => {
    if ((stage !== "playing" && stage !== "done") || !result || !board || !run || run.mode !== "daily" || saving.current) return;
    if (!session || !member?.owner_id) return;
    saving.current = true;
    saveChampPlay({
      game_key: todayKey, user_id: session.user.id, owner_id: member.owner_id,
      season: board.season, champion_owner_id: board.champion.owner_id,
      wins: result.wins, losses: result.losses, ties: result.ties,
      points_for: result.points_for, champion_points: result.champion.points_for,
      points_rank: result.rank, team_count: result.team_count,
      all_play_wins: result.all_play.wins, all_play_losses: result.all_play.losses,
      picks: keys.map((k) => ({ slot: k.key, player_id: picks[k.key]!.player_id })),
    }).then((r) => {
      setSaved(r.ok ? { ok: true, message: "Posted to today's board." } : { ok: false, message: r.message });
      if (r.ok || r.reason === "duplicate") loadChampPlays().then(setPlays);
    });
  }, [stage, result, board, run, session, member, todayKey, keys, picks]);

  for (const [state, what] of [[seasons, "The Wheel"], [owners, "The Wheel"], [players, "The player list"], [teamWeeks, "Weekly scores"], [roster, "That season's rosters"]] as const) {
    if (state.state === "error") return <ErrorState error={state.error} what={what} />;
  }
  if (seasons.state === "loading" || owners.state === "loading") return <Loading what="the wheel" />;

  const ownerName = (id: string | null | undefined) =>
    (id && owners.state === "ready" ? owners.data.find((o) => o.owner_id === id)?.name : null) ?? "Unknown owner";
  const first = (id: string | null | undefined) => ownerName(id).split(" ")[0];
  const possessive = (name: string) => (name.endsWith("s") ? `${name}'` : `${name}'s`);

  const todays = plays?.status === "ready"
    ? plays.plays.filter((p) => p.game_key === todayKey).sort((a, b) => b.wins - a.wins || b.points_for - a.points_for)
    : [];
  const mine = member?.owner_id ? todays.find((p) => p.owner_id === member.owner_id) : undefined;

  function start(mode: Mode) {
    if (!pastSeasons.length) return;
    const years = pastSeasons.map((s) => s.season);
    const key = mode === "daily" ? todayKey : `practice-${Date.now()}-${Math.random()}`;
    const season = mode === "daily" ? dailySeason(today, years) : years[Math.floor(mulberry32(hashSeed(key))() * years.length)];
    saving.current = false;
    setSaved(null); setCopied(false); setLandedSpin(null); setPicks({}); setHistory([]); setSpin(0); setRerolls(REROLLS); setChoosing(null); setShown(0);
    setRun({ mode, key, season });
    setStage("season");
  }

  function place(player: DraftablePlayer, slotKey: string) {
    setPicks((p) => ({ ...p, [slotKey]: player }));
    setHistory((h) => [...h, { slot: slotKey, spin }]);
    setChoosing(null);
    setSpin((s) => s + 1);
  }

  function choose(player: DraftablePlayer) {
    const open = slotsFor(player, keys, picks);
    if (open.length === 1 || new Set(open.map((k) => k.slot)).size === 1) place(player, open[0].key);
    else setChoosing(player.player_id);
  }

  function undo() {
    const last = history[history.length - 1];
    if (!last) return;
    setPicks((p) => ({ ...p, [last.slot]: null }));
    setHistory((h) => h.slice(0, -1));
    setSpin(last.spin);
    setChoosing(null);
  }

  function reroll() {
    if (rerolls <= 0) return;
    setRerolls((n) => n - 1);
    setChoosing(null);
    setSpin((s) => s + 1);
  }

  async function share() {
    if (!board || !result) return;
    const label = run?.mode === "daily" ? today : "practice";
    const text = shareText(board, result, label);
    try {
      if (navigator.share) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); setCopied(true); }
    } catch {
      /* the person closed the share sheet */
    }
  }

  const champ = board?.champion;
  const champLabel = champ ? `${possessive(first(champ.owner_id))} ${champ.name}` : "";
  const team = board && currentTeam != null ? board.teams.get(currentTeam) : null;

  return (
    <div className="shell champ" style={{ paddingTop: "2.2rem" }}>
      <p className="section-kicker" style={{ marginBottom: "0.4rem" }}>Daily game</p>
      <h1 style={{ fontSize: "clamp(1.8rem, 5vw, 2.6rem)" }}>
        <EditableText id="site.fourteen.title" fallback="Fourteen and Fantasy" />
      </h1>
      <p className="prose-narrow" style={{ marginTop: "0.6rem" }}>
        <EditableText
          id="site.fourteen.intro"
          fallback="The wheel picks a season. That year's champion is your opponent, and his whole roster is off limits. Spin for a team from that year, take one of its players for any open spot, and fill a lineup of nine. Then your players' real weekly points go head to head with the champ, week by week."
        />
      </p>

      {stage === "idle" ? (
        <div className="champ-start">
          {mine ? (
            <p className="notice" style={{ marginBottom: "0.9rem" }}>
              You played today: <b>{mine.wins}-{mine.losses}{mine.ties ? `-${mine.ties}` : ""}</b> against {possessive(first(mine.champion_owner_id))} {mine.season} team.
              Practice runs don't count.
            </p>
          ) : null}
          <div className="pill-row" style={{ marginTop: 0 }}>
            {session && member?.owner_id ? (
              <button type="button" className="pill publish-primary" disabled={!!mine} onClick={() => start("daily")}>Spin today's season</button>
            ) : (
              <Link to="/account" className="pill publish-primary" style={{ textDecoration: "none" }}>Sign in to play today's season</Link>
            )}
            <button type="button" className="pill" onClick={() => start("practice")}>Practice run</button>
          </div>
          <p className="champ-fine">
            Everyone gets the same season and the same spins each day. One daily run per owner, and it counts the moment you press Play the season.
            You get {REROLLS} reroll per run. Practice runs are unlimited and private.
          </p>
        </div>
      ) : null}

      {stage !== "idle" && run ? (
        <SeasonReel
          years={pastSeasons.map((s) => String(s.season))}
          value={board ? String(board.season) : null}
          caption={champ ? `Champion: ${champ.name}, ${ownerName(champ.owner_id)} (${seasonRow?.champion?.record ?? ""} in the regular season)` : "Loading that season…"}
          active={stage === "season"}
          reduced={reduced}
          onSettled={() => setStage((s) => (s === "season" ? "draft" : s))}
        />
      ) : null}

      {board && (stage === "draft" || stage === "playing" || stage === "done") ? (
        <ol className="lineup" aria-label="Your lineup">
          {keys.map((k) => {
            const p = picks[k.key];
            return (
              <li key={k.key} className={p ? "lineup-full" : ""}>
                <span className="lineup-slot">{SLOT_LABEL[k.slot] ?? k.slot}</span>
                <span className="lineup-name">{p ? p.name : "Open"}</span>
              </li>
            );
          })}
        </ol>
      ) : null}

      {board && stage === "draft" ? (
        draftDone ? (
          <div className="champ-ready">
            <p className="lede-line">Lineup set. {board.weeks.length} weeks against {champLabel}.</p>
            <div className="pill-row">
              <button type="button" className="pill publish-primary" onClick={() => { setShown(0); setStage("playing"); }}>Play the season</button>
              <button type="button" className="pill" onClick={undo}>Undo last pick</button>
            </div>
          </div>
        ) : currentTeam == null || !team ? (
          <p className="notice">The wheel ran out of teams with anyone left for your open spots. Start a practice run to try again.</p>
        ) : (
          <section className="spin" aria-live="polite" ref={spinRef}>
            <div className="spin-head">
              <span className="spin-count">Pick {filled + 1} of {keys.length}</span>
              <TeamReel key={`${spin}`} names={board.spinTeams.map((id) => board.teams.get(id)?.name ?? "")} value={team.name} reduced={reduced} onLanded={() => setLandedSpin(spin)} />
              <span className="spin-owner">{landedSpin === spin ? `${ownerName(team.owner_id)}, ${board.season}` : "\u00a0"}</span>
            </div>
            {landedSpin === spin ? (
            <ul className="options">
              {options.map((p) => {
                const open = slotsFor(p, keys, picks);
                return (
                  <li key={p.player_id}>
                    <button type="button" className="option" onClick={() => choose(p)} aria-expanded={choosing === p.player_id}>
                      <span className="option-pos">{SLOT_LABEL[p.position] ?? p.position}</span>
                      <span className="option-name">{p.name}</span>
                      <span className="option-meta">{p.draft_round ? `Round ${p.draft_round}` : "Undrafted"}</span>
                    </button>
                    {choosing === p.player_id ? (
                      <div className="option-slots">
                        <span>Put him at</span>
                        {[...new Map(open.map((k) => [k.slot, k])).values()].map((k) => (
                          <button key={k.key} type="button" className="pill" onClick={() => place(p, k.key)}>{SLOT_LABEL[k.slot] ?? k.slot}</button>
                        ))}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            ) : null}
            <div className="pill-row">
              <button type="button" className="pill" disabled={rerolls <= 0 || landedSpin !== spin} onClick={reroll}>
                {rerolls > 0 ? `Reroll this team (${rerolls} left)` : "No rerolls left"}
              </button>
              {history.length ? <button type="button" className="pill" onClick={undo}>Undo last pick</button> : null}
            </div>
            <p className="champ-fine">"Round" is where that player went in our draft that year. Teams with nobody for your open spots are skipped.</p>
          </section>
        )
      ) : null}

      {board && result && (stage === "playing" || stage === "done") ? (
        <section className="season">
          <div className="season-score">
            <span className="season-record">
              {result.weeks.slice(0, shown).filter((w) => w.result === "W").length}–{result.weeks.slice(0, shown).filter((w) => w.result === "L").length}
            </span>
            <span className="season-vs">against {champLabel}</span>
          </div>
          <div className="ticker-head" aria-hidden="true"><span /><span style={{ textAlign: "right" }}>You</span><span style={{ textAlign: "right" }}>{first(board.champion.owner_id)}</span><span /></div>
          <ol className="ticker">
            {result.weeks.map((w, i) => (
              <li key={w.week} className={`tick ${i < shown ? "tick-on" : ""} ${w.result === "W" ? "tick-w" : w.result === "L" ? "tick-l" : ""}`}>
                <span className="tick-week">Week {w.week}</span>
                <span className="tick-you">{i < shown ? fmt(w.you) : ""}</span>
                <span className="tick-champ">{i < shown ? fmt(w.champ) : ""}</span>
                <span className="tick-stamp" aria-label={i < shown ? (w.result === "W" ? "win" : w.result === "L" ? "loss" : "tie") : undefined}>{i < shown ? w.result : ""}</span>
              </li>
            ))}
          </ol>
          {stage === "playing" ? (
            <button type="button" className="pill" onClick={() => setShown(result.weeks.length)}>Skip to the end</button>
          ) : (
            <Summary board={board} result={result} champLabel={champLabel} ownerName={ownerName} first={first} />
          )}
          {stage === "done" ? (
            <>
              {run?.mode === "daily" ? (
                saved ? <p className={saved.ok ? "num-pos" : "num-neg"}>{saved.message}</p>
                  : <p className="champ-fine">Posting to today's board…</p>
              ) : <p className="champ-fine">Practice run. Not posted.</p>}
              <div className="pill-row">
                <button type="button" className="pill publish-primary" onClick={share}>{copied ? "Copied" : "Share result"}</button>
                <button type="button" className="pill" onClick={() => start("practice")}>Practice run</button>
                <a className="pill" href="#board">Today's board</a>
              </div>
            </>
          ) : null}
        </section>
      ) : null}

      <Band title="Today's board" note={today} id="board" />
      {plays?.status === "ready" ? (
        todays.length ? (
          <div className="sheet">
            <table>
              <thead><tr><th style={{ textAlign: "left" }}>Owner</th><th>Vs champ</th><th>Points</th><th data-secondary="true">Points rank</th></tr></thead>
              <tbody>
                {todays.map((p) => (
                  <tr key={p.owner_id}>
                    <td style={{ textAlign: "left" }}><OwnerLink ownerId={p.owner_id}>{ownerName(p.owner_id)}</OwnerLink></td>
                    <td className={p.wins > p.losses ? "num-pos" : p.wins < p.losses ? "num-neg" : ""}>{p.wins}–{p.losses}{p.ties ? `–${p.ties}` : ""}</td>
                    <td className="figure">{fmt(p.points_for, 1)}</td>
                    <td data-secondary="true">{p.points_rank} of {p.team_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="champ-fine">Nobody has played today's season yet.</p>
      ) : plays?.status === "unavailable" ? (
        <p className="champ-fine">{plays.message} Runs still work; they just aren't posted.</p>
      ) : plays?.status === "not-configured" ? (
        <p className="champ-fine">Scores aren't saved on this build.</p>
      ) : <p className="champ-fine">Loading the board…</p>}

      {plays?.status === "ready" && plays.plays.length ? (
        <>
          <Band title="All-time" note={`${plays.plays.length} daily ${plays.plays.length === 1 ? "run" : "runs"}`} />
          <div className="sheet">
            <table>
              <thead><tr><th style={{ textAlign: "left" }}>Owner</th><th>Runs</th><th>Champs beaten</th><th>Weeks won</th><th data-secondary="true">Led the league</th></tr></thead>
              <tbody>
                {summarizeChamp(plays.plays).map((r) => (
                  <tr key={r.owner_id}>
                    <td style={{ textAlign: "left" }}><OwnerLink ownerId={r.owner_id}>{ownerName(r.owner_id)}</OwnerLink></td>
                    <td>{r.plays}</td>
                    <td>{r.beatChamp}</td>
                    <td>{Math.round(r.pct * 100)}%</td>
                    <td data-secondary="true">{r.topScorer}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      <style>{`
        .champ-start { margin-top: 1.2rem; }
        .champ-fine { color: var(--color-low); font-size: 0.82rem; line-height: 1.5; max-width: 44rem; margin: 0.9rem 0 0; }
        .season-reel { margin-top: 1.4rem; border-top: 3px solid var(--ink); padding-top: 0.6rem; display: flex; align-items: baseline; gap: 1rem; flex-wrap: wrap; }
        .season-year { font-family: var(--font-display); font-weight: 700; font-size: clamp(3rem, 14vw, 5.2rem); line-height: 0.9; font-variant-numeric: tabular-nums; color: var(--ink-faint); }
        .season-reel.landed .season-year { color: var(--ink); }
        .season-caption { font-size: 0.92rem; color: var(--ink-soft); max-width: 26rem; line-height: 1.35; }
        .lineup { list-style: none; padding: 0; margin: 1.2rem 0 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.35rem; }
        .lineup li { border: 1px solid var(--rule); padding: 0.35rem 0.5rem; min-height: 3rem; display: flex; flex-direction: column; gap: 0.1rem; background: transparent; }
        .lineup li.lineup-full { background: var(--paper-deep); border-color: var(--ink-faint); }
        .lineup-slot { font: 700 0.62rem var(--font-body); letter-spacing: 0.06em; color: var(--ink-faint); }
        .lineup-name { font-size: 0.84rem; line-height: 1.15; color: var(--ink-faint); overflow-wrap: anywhere; }
        .lineup-full .lineup-name { color: var(--ink); font-weight: 600; }
        .spin { margin-top: 1.4rem; border-top: 3px double var(--ink); padding-top: 0.8rem; }
        .spin-head { display: flex; flex-direction: column; gap: 0.15rem; }
        .spin-count { font: 600 0.74rem var(--font-body); color: var(--ink-faint); }
        .spin-team { font-family: var(--font-display); font-weight: 700; font-size: clamp(1.5rem, 6vw, 2.1rem); line-height: 1.05; overflow-wrap: anywhere; }
        .spin-team.rolling { color: var(--ink-faint); }
        .spin-owner { color: var(--ink-soft); font-size: 0.9rem; }
        .options { list-style: none; padding: 0; margin: 0.8rem 0 0; border-top: 2px solid var(--ink); }
        .options li { border-bottom: 1px solid var(--rule-soft); }
        .option { display: grid; grid-template-columns: 2.6rem 1fr auto; gap: 0.7rem; align-items: center; width: 100%; min-height: 2.9rem;
          padding: 0.45rem 0.2rem; background: none; border: 0; font: inherit; color: inherit; text-align: left; cursor: pointer; }
        .option:hover, .option[aria-expanded="true"] { background: var(--paper-deep); }
        .option:focus-visible { outline: 2px solid var(--ember); outline-offset: -2px; }
        .option-pos { font: 700 0.64rem var(--font-body); letter-spacing: 0.05em; color: var(--paper-deep); background: var(--ink-soft); padding: 0.22rem 0; text-align: center; }
        .option-name { font-size: 0.98rem; }
        .option-meta { color: var(--ink-faint); font-size: 0.76rem; }
        .option-slots { display: flex; gap: 0.45rem; align-items: center; flex-wrap: wrap; padding: 0.2rem 0.2rem 0.7rem 3.3rem; background: var(--paper-deep); font-size: 0.82rem; color: var(--ink-soft); }
        .champ-ready { margin-top: 1.4rem; }
        .lede-line { font-family: var(--font-display); font-size: 1.25rem; font-weight: 600; margin: 0; }
        .season { margin-top: 1.6rem; border-top: 3px double var(--ink); padding-top: 0.8rem; }
        .season-score { display: flex; align-items: baseline; gap: 0.8rem; flex-wrap: wrap; }
        .season-record { font-family: var(--font-display); font-weight: 700; font-size: clamp(3rem, 13vw, 4.6rem); line-height: 1; font-variant-numeric: tabular-nums; }
        .season-vs { color: var(--ink-soft); font-size: 0.95rem; }
        .ticker { list-style: none; padding: 0; margin: 0.2rem 0 1rem; border-top: 2px solid var(--ink); }
        .tick { display: grid; grid-template-columns: 5rem 1fr 1fr 2rem; gap: 0.5rem; align-items: center; padding: 0.38rem 0.2rem; border-bottom: 1px solid var(--rule-soft);
          font-variant-numeric: tabular-nums; font-size: 0.92rem; color: var(--ink-faint); }
        .tick-on { color: var(--ink); }
        .tick-week { font-size: 0.8rem; color: var(--ink-faint); }
        .tick-you { font-weight: 700; text-align: right; }
        .tick-champ { text-align: right; color: var(--ink-soft); }
        .tick-stamp { font: 700 0.8rem var(--font-body); text-align: center; }
        .tick-on.tick-w .tick-stamp { color: var(--paper); background: var(--pos); }
        .tick-on.tick-l .tick-stamp { color: var(--paper); background: var(--neg); }
        .tick-on .tick-stamp { animation: stamp 0.28s ease-out; }
        @keyframes stamp { from { transform: scale(1.8); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        .ticker-head { margin-top: 0.8rem; display: grid; grid-template-columns: 5rem 1fr 1fr 2rem; gap: 0.5rem; font-size: 0.72rem; color: var(--ink-faint); padding: 0 0.2rem; }
        .verdict { max-width: 44rem; }
        .verdict p { margin: 0.4rem 0; line-height: 1.5; }
        .verdict .lede { font-family: var(--font-display); font-size: 1.25rem; font-weight: 600; }
        .stat-row { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0.6rem; margin: 1rem 0; border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule); padding: 0.6rem 0; }
        .stat-row div { display: flex; flex-direction: column-reverse; gap: 0.1rem; }
        .stat-row b { font-family: var(--font-display); font-size: 1.35rem; font-variant-numeric: tabular-nums; }
        .stat-row span { font-size: 0.74rem; color: var(--ink-faint); }
        .mini { width: 100%; border-collapse: collapse; font-size: 0.86rem; margin-top: 0.4rem; }
        .mini td { padding: 0.32rem 0.2rem; border-bottom: 1px solid var(--rule-soft); }
        .mini td:last-child { text-align: right; font-variant-numeric: tabular-nums; }
        .mini tr.you td { font-weight: 700; background: var(--paper-deep); }
        .mini-title { font-family: var(--font-display); font-size: 1.1rem; margin: 1.3rem 0 0.2rem; }
        @media (max-width: 640px) {
          .stat-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .tick { grid-template-columns: 3.6rem 1fr 1fr 1.8rem; }
          .ticker-head { grid-template-columns: 3.6rem 1fr 1fr 1.8rem; }
        }
        @media (prefers-reduced-motion: reduce) { .tick-on .tick-stamp { animation: none; } }
      `}</style>
    </div>
  );
}

function SeasonReel({ years, value, caption, active, reduced, onSettled }: {
  years: string[]; value: string | null; caption: string; active: boolean; reduced: boolean; onSettled: () => void;
}) {
  const [shown, setShown] = useState(years[0] ?? "—");
  const [landed, setLanded] = useState(!active);
  const settle = useRef(onSettled);
  settle.current = onSettled;

  useEffect(() => {
    if (!active) return;
    const random = () => years[Math.floor(Math.random() * years.length)] ?? "—";
    if (value == null) {
      const id = window.setInterval(() => setShown(random()), 80);
      return () => window.clearInterval(id);
    }
    if (reduced) { setShown(value); setLanded(true); settle.current(); return; }
    let step = 0;
    let timer = 0;
    const tick = () => {
      step += 1;
      if (step >= 12) { setShown(value); setLanded(true); timer = window.setTimeout(() => settle.current(), 500); return; }
      setShown(random());
      timer = window.setTimeout(tick, 40 + 2 * step * step);
    };
    timer = window.setTimeout(tick, 40);
    return () => window.clearTimeout(timer);
  }, [active, value, reduced, years]);

  return (
    <div className={`season-reel${landed ? " landed" : ""}`} aria-live="polite">
      <span className="season-year">{landed && value ? value : shown}</span>
      <span className="season-caption">{landed ? caption : "Spinning for a season…"}</span>
    </div>
  );
}

function TeamReel({ names, value, reduced, onLanded }: { names: string[]; value: string; reduced: boolean; onLanded: () => void }) {
  const [shown, setShown] = useState(reduced ? value : names[0] ?? value);
  const [rolling, setRolling] = useState(!reduced);
  const landed = useRef(onLanded);
  landed.current = onLanded;
  useEffect(() => {
    if (reduced) { landed.current(); return; }
    let step = 0;
    let timer = 0;
    const tick = () => {
      step += 1;
      if (step >= 9) { setShown(value); setRolling(false); landed.current(); return; }
      setShown(names[Math.floor(Math.random() * names.length)] ?? value);
      timer = window.setTimeout(tick, 35 + 4 * step * step);
    };
    timer = window.setTimeout(tick, 35);
    return () => window.clearTimeout(timer);
  }, [names, value, reduced]);
  return <span className={`spin-team${rolling ? " rolling" : ""}`}>{shown}</span>;
}

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

function Summary({ board, result, champLabel, ownerName, first }: {
  board: Board; result: SeasonResult; champLabel: string;
  ownerName: (id: string | null | undefined) => string; first: (id: string | null | undefined) => string;
}) {
  const record = `${result.wins}-${result.losses}${result.ties ? `-${result.ties}` : ""}`;
  const champFirst = first(board.champion.owner_id);
  const lede = result.wins > result.losses
    ? `You beat ${champLabel}, ${record}.`
    : result.wins < result.losses
      ? `${champLabel} had your number, ${result.losses}-${result.wins}.`
      : `Dead even with ${champLabel} at ${record}.`;
  const pointsLine = result.rank === 1
    ? `Your ${fmt(result.points_for, 1)} points would have led the whole league in ${board.season}.`
    : `Your ${fmt(result.points_for, 1)} points would have ranked ${ordinal(result.rank)} of ${result.team_count} in ${board.season}.`;
  const champLine = result.points_for > result.champion.points_for
    ? `That's ${fmt(result.points_for - result.champion.points_for, 1)} more than ${champFirst}'s title team scored.`
    : `${champFirst}'s title team scored ${fmt(result.champion.points_for - result.points_for, 1)} more.`;
  const blocked = board.championRoster.slice(0, 3);

  return (
    <div className="verdict">
      <p className="lede">{lede}</p>
      <p>{pointsLine} {champLine}</p>
      <div className="stat-row">
        <div><b>{result.all_play.wins}–{result.all_play.losses}</b><span>Against every team, every week</span></div>
        <div><b>{fmt(result.average, 1)}</b><span>Your weekly average (league {fmt(result.league_average, 1)})</span></div>
        <div><b>{result.best_week ? fmt(result.best_week.you, 1) : "—"}</b><span>Best week{result.best_week ? `, week ${result.best_week.week}` : ""}</span></div>
        <div><b>{result.champion.wins}–{result.champion.losses}</b><span>{champFirst}'s real record</span></div>
      </div>

      <p className="mini-title">Your lineup's season</p>
      <table className="mini">
        <tbody>
          {result.by_player.map((p, i) => (
            <tr key={p.player_id}>
              <td>{p.name}{i === 0 ? " (MVP)" : ""}</td>
              <td>{p.position}</td>
              <td>{fmt(p.total, 1)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {blocked.length ? (
        <p>Off limits on {champLabel}: {blocked.map((p) => `${p.name} (${fmt(p.season_points, 1)})`).join(", ")}.</p>
      ) : null}

      <p className="mini-title">Points for, {board.season}</p>
      <table className="mini">
        <tbody>
          {result.table.map((t, i) => (
            <tr key={t.team_id ?? "you"} className={t.you ? "you" : ""}>
              <td>{i + 1}. {t.you ? "You" : `${t.name} (${ownerName(t.owner_id)})`}{t.team_id === board.champion.team_id ? ", champion" : ""}</td>
              <td>{fmt(t.points_for, 1)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {result.missing_weeks ? (
        <p className="champ-fine">
          {result.missing_weeks} player-{result.missing_weeks === 1 ? "week" : "weeks"} had no score on file (the player wasn't on a league roster that week) and counted as zero.
        </p>
      ) : null}
    </div>
  );
}
