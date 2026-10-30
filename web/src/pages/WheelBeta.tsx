import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { EditableText, useEditorial } from "../components/Editorial";
import { Band, ErrorState, Loading, OwnerLink } from "../components/primitives";
import { useDraft, useOwnerIndex, usePlayerWeeks, usePlayers, useRoster, useSeasonIndex, useTeamWeeks } from "../lib/data";
import { points as fmt } from "../lib/format";
import { dailyKey, hashSeed, mulberry32 } from "../lib/wheelEngine.mjs";
import {
  autoplay, bestLineup, buildSeason, checkLineup, claimProblem, dailySeason, fits, nextUsableSpin, optimalPoints, playWeek, shareText,
  slotsFor, spinOptions, spinOrder, summarize, waiverOptions,
} from "../lib/gauntletEngine.mjs";
import type { Board, DraftablePlayer, Lineup, Picks, PlayerWeeksFile, SeasonResult, WeekResult } from "../lib/gauntletEngine.mjs";
import {
  lineupIq, loadChampPlays, loadMyStart, recordStart, saveChampPlay, summarizeChamp, type ChampPlaysResult,
} from "../lib/champPlays";
import { Confetti, SeasonWheel, SlotReel, VerdictStamp, WeekBars, buzz, visualsCss } from "../components/FourteenVisuals";
import { Gameday, Reveal, SeasonStrip, gamedayCss, label } from "../components/FourteenGameday";
import { PlayerFace, TeamLogo, faceCss } from "../components/PlayerFace";

// "Fourteen and Fantasy": the daily beat-the-champ game. Lives at /fourteen
// (old /wheel-beta links redirect there), alongside the original /wheel.
//
// Flow: the wheel picks a season -> draft 9 starters and a 3-man bench by
// spinning other teams from that year -> manage the season week by week
// (lineup, one waiver claim a week, kickoff) -> season verdict.

type Stage = "idle" | "season" | "draft" | "week" | "reveal" | "done";
type Mode = "daily" | "practice";
interface Run { mode: Mode; key: string; season: number }
interface Claim { week: number; add: number; drop: number }

/** What a daily run keeps in this browser so a reload resumes it. */
interface Saved {
  v: 2;
  key: string;
  season: number;
  stage: Stage;
  picks: Record<string, number>;
  spin: number;
  rerolls: number;
  history: { slot: string; spin: number }[];
  roster: number[];
  lineup: Record<string, number>;
  played: { week: number; lineup: Record<string, number>; roster: number[] }[];
  claims: Claim[];
}

const REROLLS = 1;
const STORE = (key: string) => `ffbffl:fourteen:${key}`;

function useReducedMotion() {
  return useMemo(
    () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
    [],
  );
}

function readSaved(key: string): Saved | null {
  try {
    const raw = localStorage.getItem(STORE(key));
    const s = raw ? (JSON.parse(raw) as Saved) : null;
    return s && s.v === 2 && s.key === key ? s : null;
  } catch {
    return null;
  }
}

const ids = (lineup: Lineup) =>
  Object.fromEntries(Object.entries(lineup).filter(([, p]) => p).map(([k, p]) => [k, p!.player_id]));

export default function WheelBeta() {
  const seasons = useSeasonIndex();
  const owners = useOwnerIndex();
  const players = usePlayers();
  const teamWeeks = useTeamWeeks();
  const { member, session } = useEditorial();
  const reduced = useReducedMotion();

  const [run, setRun] = useState<Run | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  // Draft
  const [picks, setPicks] = useState<Picks>({});
  const [history, setHistory] = useState<{ slot: string; spin: number }[]>([]);
  const [spin, setSpin] = useState(0);
  const [rerolls, setRerolls] = useState(REROLLS);
  const [choosing, setChoosing] = useState<number | null>(null);
  const [landedSpin, setLandedSpin] = useState<number | null>(null);
  // Season
  const [roster, setRoster] = useState<DraftablePlayer[]>([]);
  const [lineup, setLineup] = useState<Lineup>({});
  const [played, setPlayed] = useState<WeekResult[]>([]);
  const [playedLog, setPlayedLog] = useState<Saved["played"]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [gameError, setGameError] = useState<string | null>(null);
  const [pendingResume, setPendingResume] = useState<Saved | null>(null);
  const [revealDone, setRevealDone] = useState(true);
  // Board and saving
  const [plays, setPlays] = useState<ChampPlaysResult | null>(null);
  const [startedElsewhere, setStartedElsewhere] = useState(false);
  const [saved, setSaved] = useState<{ ok: boolean; message: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const saving = useRef(false);
  const started = useRef(false);
  const spinRef = useRef<HTMLElement | null>(null);
  const gameRef = useRef<HTMLDivElement | null>(null);

  const rosterData = useRoster(run?.season ?? null);
  const draft = useDraft(run?.season ?? null);
  const playerWeeks = usePlayerWeeks<PlayerWeeksFile>(run?.season ?? null);
  const today = dailyKey();
  const todayKey = `champ:${today}`;

  useEffect(() => {
    let live = true;
    loadChampPlays().then((r) => live && setPlays(r));
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (!session) return;
    loadMyStart(todayKey, session.user.id).then((r) => setStartedElsewhere(!!r));
  }, [session, todayKey]);

  const pastSeasons = seasons.state === "ready" ? seasons.data.filter((s) => !s.is_current && s.champion) : [];
  const seasonRow = run ? pastSeasons.find((s) => s.season === run.season) ?? null : null;

  const board: Board | null = useMemo(() => {
    if (!run || !seasonRow || rosterData.state !== "ready" || players.state !== "ready" || teamWeeks.state !== "ready") return null;
    if (draft.state === "loading" || playerWeeks.state !== "ready") return null;
    return buildSeason({
      season: run.season,
      regularSeasonWeeks: seasonRow.regular_season_weeks,
      rows: rosterData.data,
      players: players.data,
      teamWeeks: teamWeeks.data,
      draft: draft.state === "ready" ? draft.data : [],
      championOwnerId: seasonRow.champion!.owner_id,
      playerWeeks: playerWeeks.data,
    });
  }, [run, seasonRow, rosterData, draft, players, teamWeeks, playerWeeks]);

  const order = useMemo(() => (board && run ? spinOrder(`${run.key}:spins`, board.spinTeams) : []), [board, run]);
  const draftKeys = board?.draftKeys ?? [];
  const filled = draftKeys.filter((k) => picks[k.key]).length;
  const draftDone = draftKeys.length > 0 && filled === draftKeys.length;
  const currentTeam = order[spin] ?? null;
  const options = board && currentTeam != null && !draftDone ? spinOptions(board, currentTeam, draftKeys, picks) : [];
  const weekIndex = played.length;
  const week = board?.weeks[weekIndex] ?? null;
  const lastReveal = stage === "reveal" ? played[played.length - 1] ?? null : null;
  const result: SeasonResult | null = useMemo(
    () => (board && stage === "done" && played.length ? summarize(board, played) : null),
    [board, stage, played],
  );
  const claimUsed = week != null && claims.some((c) => c.week === week);
  const waivers = useMemo(
    () => (board && run && week != null ? waiverOptions(board, run.key, week, roster.map((p) => p.player_id)) : []),
    [board, run, week, roster],
  );

  // Resume a daily run from this browser once its season's data is loaded.
  useEffect(() => {
    if (!pendingResume || !board || board.season !== pendingResume.season) return;
    const s = pendingResume;
    const get = (id: number) => board.describe(id);
    setPicks(Object.fromEntries(Object.entries(s.picks).map(([k, id]) => [k, get(id)])));
    setSpin(s.spin); setRerolls(s.rerolls); setHistory(s.history);
    setRoster(s.roster.map(get));
    setLineup(Object.fromEntries(Object.entries(s.lineup).map(([k, id]) => [k, get(id)])));
    setPlayedLog(s.played);
    setPlayed(s.played.map((p) => ({
      ...playWeek(board, p.week, Object.fromEntries(Object.entries(p.lineup).map(([k, id]) => [k, get(id)]))),
      optimal: optimalPoints(board, p.roster.map(get), p.week),
    })));
    setClaims(s.claims);
    started.current = s.played.length > 0;
    setStage(s.stage === "reveal" ? "week" : s.stage === "season" ? "draft" : s.stage);
    setPendingResume(null);
  }, [pendingResume, board]);

  // Keep a daily run in this browser after every change.
  useEffect(() => {
    if (!run || run.mode !== "daily" || stage === "idle" || pendingResume) return;
    const snap: Saved = {
      v: 2, key: run.key, season: run.season, stage,
      picks: Object.fromEntries(Object.entries(picks).filter(([, p]) => p).map(([k, p]) => [k, p!.player_id])),
      spin, rerolls, history,
      roster: roster.map((p) => p.player_id),
      lineup: ids(lineup),
      played: playedLog,
      claims,
    };
    try { localStorage.setItem(STORE(run.key), JSON.stringify(snap)); } catch { /* storage full or blocked */ }
  }, [run, stage, picks, spin, rerolls, history, roster, lineup, playedLog, claims, pendingResume]);

  // Land on the first usable spin whenever the board or picks change.
  useEffect(() => {
    if (!board || stage !== "draft" || draftDone || pendingResume) return;
    const next = nextUsableSpin(board, order, spin, draftKeys, picks);
    if (next === -1) setSpin(order.length);
    else if (next !== spin) setSpin(next);
  }, [board, stage, order, spin, draftKeys, picks, draftDone, pendingResume]);

  // After each pick, bring the next spin into view if it's scrolled off the top.
  useEffect(() => {
    const el = spinRef.current;
    if (!el || stage !== "draft" || filled === 0) return;
    if (el.getBoundingClientRect().top < 0) el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  }, [filled, stage, reduced]);

  // Each new week and each kickoff starts at the top of the game area.
  useEffect(() => {
    if (stage !== "week" && stage !== "reveal" && stage !== "done") return;
    const el = gameRef.current;
    if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  }, [stage, weekIndex, reduced]);

  // Post a finished daily run once.
  useEffect(() => {
    if (stage !== "done" || !result || !board || !run || run.mode !== "daily" || saving.current) return;
    if (!session || !member?.owner_id) return;
    saving.current = true;
    buzz(result.wins > result.losses ? [30, 50, 30, 50, 60] : 40);
    saveChampPlay({
      game_key: todayKey, user_id: session.user.id, owner_id: member.owner_id,
      season: board.season, champion_owner_id: board.champion.owner_id,
      wins: result.wins, losses: result.losses, ties: result.ties,
      points_for: result.points_for, champion_points: result.champion.points_for,
      points_rank: result.rank, team_count: result.team_count,
      all_play_wins: result.all_play.wins, all_play_losses: result.all_play.losses,
      optimal_points: result.optimal_points, claims: claims.length,
      picks: {
        draft: draftKeys.map((k) => ({ slot: k.key, player_id: picks[k.key]!.player_id })),
        claims: claims.map((c) => [c.week, c.add, c.drop]),
      },
    }).then((r) => {
      setSaved(r.ok ? { ok: true, message: "Posted to today's board." } : { ok: false, message: r.message });
      if (r.ok || r.reason === "duplicate") loadChampPlays().then(setPlays);
    });
  }, [stage, result, board, run, session, member, todayKey, draftKeys, picks, claims]);

  for (const [state, what] of [[seasons, "The game"], [owners, "The game"], [players, "The player list"], [teamWeeks, "Weekly scores"], [rosterData, "That season's rosters"]] as const) {
    if (state.state === "error") return <ErrorState error={state.error} what={what} />;
  }
  if (seasons.state === "loading" || owners.state === "loading") return <Loading what="the game" />;

  const ownerName = (id: string | null | undefined) =>
    (id && owners.state === "ready" ? owners.data.find((o) => o.owner_id === id)?.name : null) ?? "Unknown owner";
  const first = (id: string | null | undefined) => ownerName(id).split(" ")[0];
  const possessive = (name: string) => (name.endsWith("s") ? `${name}'` : `${name}'s`);

  const todays = plays?.status === "ready"
    ? plays.plays.filter((p) => p.game_key === todayKey).sort((a, b) => b.wins - a.wins || b.points_for - a.points_for)
    : [];
  const mine = member?.owner_id ? todays.find((p) => p.owner_id === member.owner_id) : undefined;
  const resumable = !mine ? readSaved(todayKey) : null;

  function reset() {
    saving.current = false;
    started.current = false;
    setSaved(null); setCopied(false); setLandedSpin(null); setPicks({}); setHistory([]); setSpin(0); setRerolls(REROLLS);
    setChoosing(null); setRoster([]); setLineup({}); setPlayed([]); setPlayedLog([]); setClaims([]); setGameError(null);
  }

  function start(mode: Mode) {
    if (!pastSeasons.length) return;
    const years = pastSeasons.map((s) => s.season);
    const key = mode === "daily" ? todayKey : `practice-${Date.now()}-${Math.random()}`;
    const season = mode === "daily" ? dailySeason(today, years) : years[Math.floor(mulberry32(hashSeed(key))() * years.length)];
    reset();
    setRun({ mode, key, season });
    setStage("season");
  }

  function resume(s: Saved) {
    reset();
    setRun({ mode: "daily", key: s.key, season: s.season });
    setPendingResume(s);
    setStage("draft");
  }

  function place(player: DraftablePlayer, slotKey: string) {
    setPicks((p) => ({ ...p, [slotKey]: player }));
    setHistory((h) => [...h, { slot: slotKey, spin }]);
    setChoosing(null);
    setSpin((s) => s + 1);
  }

  function choose(player: DraftablePlayer) {
    const open = slotsFor(player, draftKeys, picks);
    if (new Set(open.map((k) => k.slot)).size === 1) place(player, open[0].key);
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

  function startSeason() {
    if (!board) return;
    const team = draftKeys.map((k) => picks[k.key]!).filter(Boolean);
    setRoster(team);
    setLineup(Object.fromEntries(board.keys.map((k) => [k.key, picks[k.key] ?? undefined])));
    setStage("week");
  }

  /** A daily run counts the moment its first week kicks off. */
  async function lockDaily(): Promise<boolean> {
    if (!run || run.mode !== "daily" || started.current) return true;
    if (!session || !member?.owner_id) return true;
    const r = await recordStart(todayKey, session.user.id, member.owner_id);
    if (r === "duplicate") {
      setGameError("You already kicked off today's run, maybe on another device. Finish it there; practice runs are open anytime.");
      return false;
    }
    started.current = true;
    return true;
  }

  async function kickoff() {
    if (!board || week == null) return;
    const problem = checkLineup(board, roster, lineup);
    if (problem) { setGameError(problem); return; }
    if (!(await lockDaily())) return;
    setGameError(null);
    const res = { ...playWeek(board, week, lineup), optimal: optimalPoints(board, roster, week) };
    setPlayed((p) => [...p, res]);
    setPlayedLog((p) => [...p, { week, lineup: ids(lineup), roster: roster.map((x) => x.player_id) }]);
    setRevealDone(false);
    setStage("reveal");
  }

  function nextWeek() {
    if (!board) return;
    if (played.length >= board.weeks.length) { setStage("done"); return; }
    setStage("week");
  }

  async function simRest() {
    if (!board || week == null) return;
    if (!(await lockDaily())) return;
    const rest = autoplay(board, roster, weekIndex);
    setPlayed((p) => [...p, ...rest]);
    setPlayedLog((p) => [
      ...p,
      ...rest.map((r) => ({ week: r.week, lineup: Object.fromEntries(r.rows.filter((x) => x.player).map((x) => [x.key, x.player!.player_id])), roster: roster.map((x) => x.player_id) })),
    ]);
    setStage("done");
  }

  function claim(add: DraftablePlayer, drop: DraftablePlayer) {
    if (!board || week == null || claimUsed) return;
    const problem = claimProblem(roster, add, drop);
    if (problem) { setGameError(problem); return; }
    const slot = board.keys.find((k) => lineup[k.key]?.player_id === drop.player_id);
    const next: Lineup = { ...lineup };
    // He takes the dropped starter's spot if he can play it; otherwise that spot opens up.
    if (slot) next[slot.key] = fits(add.position, slot.slot) ? add : undefined;
    setRoster((r) => [...r.filter((p) => p.player_id !== drop.player_id), add]);
    setLineup(next);
    setClaims((c) => [...c, { week, add: add.player_id, drop: drop.player_id }]);
    buzz(12);
  }

  async function share() {
    if (!board || !result) return;
    const text = shareText(board, result, run?.mode === "daily" ? today : "practice");
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
  // While a week is still being revealed, keep its result off the record and strip.
  const counted = stage === "reveal" && !revealDone ? played.slice(0, -1) : played;
  const wins = counted.filter((w) => w.result === "W").length;
  const losses = counted.filter((w) => w.result === "L").length;
  const inSeason = stage === "week" || stage === "reveal" || stage === "done";
  const dailyBlocked = !!mine || (startedElsewhere && !resumable);

  return (
    <div className="shell champ" style={{ paddingTop: "2.2rem" }}>
      <p className="section-kicker" style={{ marginBottom: "0.4rem" }}>Daily game</p>
      <h1 style={{ fontSize: "clamp(1.8rem, 5vw, 2.6rem)" }}>
        <EditableText id="site.fourteen.title" fallback="Fourteen and Fantasy" />
      </h1>
      <p className="prose-narrow" style={{ marginTop: "0.6rem" }}>
        <EditableText
          id="site.fourteen.intro"
          fallback="The wheel picks a season. That year's champion is your opponent, and his whole roster is off limits. Spin for teams from that year to draft nine starters and a bench with a backup at every position. Then run the season week by week: set your lineup from ESPN's projections, work the waiver wire, and kick off against the champ's real scores."
        />
      </p>

      {stage === "idle" ? (
        <div className="champ-start">
          {mine ? (
            <p className="notice" style={{ marginBottom: "0.9rem" }}>
              You played today: <b>{mine.wins}-{mine.losses}{mine.ties ? `-${mine.ties}` : ""}</b> against {possessive(first(mine.champion_owner_id))} {mine.season} team.
              Practice runs don't count.
            </p>
          ) : startedElsewhere && !resumable ? (
            <p className="notice" style={{ marginBottom: "0.9rem" }}>You kicked off today's run on another device or browser. Finish it there.</p>
          ) : null}
          <div className="pill-row" style={{ marginTop: 0 }}>
            {session && member?.owner_id ? (
              resumable ? (
                <button type="button" className="kickoff" onClick={() => resume(resumable)}>
                  Resume today's run <span aria-hidden="true">▶</span>
                </button>
              ) : (
                <button type="button" className="kickoff" disabled={dailyBlocked} onClick={() => start("daily")}>
                  Spin today's season <span aria-hidden="true">▶</span>
                </button>
              )
            ) : (
              <Link to="/account" className="pill publish-primary" style={{ textDecoration: "none" }}>Sign in to play today's season</Link>
            )}
            <button type="button" className="pill" onClick={() => start("practice")}>Practice run</button>
          </div>
          <p className="champ-fine">
            Everyone gets the same season, the same spins and the same waiver wire each day. One daily run per owner,
            and it counts the moment you kick off Week 1. You get {REROLLS} reroll in the draft and one waiver claim a week.
            Practice runs are unlimited and private.
          </p>
        </div>
      ) : null}

      {stage !== "idle" && run ? (
        <SeasonWheel
          key={run.key}
          years={pastSeasons.map((s) => String(s.season))}
          value={board ? String(board.season) : null}
          caption={champ ? `Champion: ${champ.name}, ${ownerName(champ.owner_id)} (${seasonRow?.champion?.record ?? ""} in the regular season)` : "Loading that season…"}
          active={stage === "season"}
          reduced={reduced}
          onSettled={() => setStage((s) => (s === "season" ? "draft" : s))}
        />
      ) : null}

      {board && stage === "draft" ? (
        <>
          <ol className="lineup" aria-label="Your roster">
            {draftKeys.map((k) => {
              const p = picks[k.key];
              return (
                <li key={k.key} className={`${p ? "lineup-full" : ""}${k.slot.startsWith("BN-") ? " lineup-bench" : ""}`}>
                  <span className="lineup-slot">{k.slot.startsWith("BN-") ? `BENCH ${label(k.slot.slice(3))}` : label(k.slot)}</span>
                  <span className="lineup-name">{p ? p.name : "Open"}</span>
                </li>
              );
            })}
          </ol>
          {draftDone ? (
            <div className="champ-ready">
              <p className="lede-line">Roster set. {board.weeks.length} weeks against {champLabel}.</p>
              <div className="pill-row">
                <button type="button" className="kickoff" onClick={startSeason}>Start the season <span aria-hidden="true">▶</span></button>
                <button type="button" className="pill" onClick={undo}>Undo last pick</button>
              </div>
            </div>
          ) : currentTeam == null || !team ? (
            <p className="notice">The wheel ran out of teams with anyone left for your open spots. Start a practice run to try again.</p>
          ) : (
            <section className="spin" aria-live="polite" ref={spinRef}>
              <div className="spin-head">
                <span className="spin-count">Pick {filled + 1} of {draftKeys.length}{board.keys.every((k) => picks[k.key]) ? " · bench" : ""}</span>
                <SlotReel key={`${run?.key}:${spin}`} names={board.spinTeams.map((id) => board.teams.get(id)?.name ?? "")} value={team.name} reduced={reduced} onLanded={() => setLandedSpin(spin)} />
                <span className="spin-owner">{landedSpin === spin ? `${ownerName(team.owner_id)}, ${board.season}` : "\u00a0"}</span>
              </div>
              {landedSpin === spin ? (
                <ul className="options">
                  {options.map((p) => {
                    const open = slotsFor(p, draftKeys, picks);
                    return (
                      <li key={p.player_id}>
                        <button type="button" className="option" onClick={() => choose(p)} aria-expanded={choosing === p.player_id}>
                          <span className={`gd-slot slot-${p.position.replace("/", "")}`}>{label(p.position)}</span>
                          <PlayerFace player={p} showTeam={false} />
                          <span className="option-name">{p.name}{p.team && !p.position.includes("D/ST") ? <small><TeamLogo team={p.team} size={14} /> {p.team}</small> : null}</span>
                          <span className="option-meta">{p.draft_round ? `Round ${p.draft_round}` : "Undrafted"}</span>
                        </button>
                        {choosing === p.player_id ? (
                          <div className="option-slots">
                            <span>Put him at</span>
                            {[...new Map(open.map((k) => [k.slot, k])).values()].map((k) => (
                              <button key={k.key} type="button" className="pill" onClick={() => place(p, k.key)}>{label(k.slot)}</button>
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
              <p className="champ-fine">
                "Round" is where that player went in our draft that year. Teams with nobody for your open spots are skipped.
                Your bench holds one backup each at QB, RB, WR, TE and DEF, for byes and injuries.
              </p>
            </section>
          )}
        </>
      ) : null}

      {board && inSeason ? (
        <div className="game" ref={gameRef} style={{ ["--weeks" as string]: board.weeks.length }}>
          <SeasonStrip board={board} played={counted} current={stage === "done" ? -1 : stage === "reveal" ? weekIndex - 1 : weekIndex} />
          <div className="record-line">
            <b key={`${wins}-${losses}`} className={reduced ? "" : "record-bump"}>{wins}–{losses}</b>
            <span>against {champLabel}</span>
          </div>

          {stage === "week" && week != null ? (
            <Gameday
              board={board}
              week={week}
              weekIndex={weekIndex}
              roster={roster}
              lineup={lineup}
              waivers={waivers}
              claimUsed={claimUsed}
              claimsLeftText="1 claim this week"
              champLabel={champLabel}
              error={gameError}
              onSwap={(next) => { setLineup(next); setGameError(null); }}
              onAutoSet={() => setLineup(bestLineup(board, roster, week, "projected"))}
              onClaim={claim}
              onKickoff={kickoff}
              onSim={simRest}
            />
          ) : null}

          {stage === "reveal" && lastReveal ? (
            <Reveal
              key={lastReveal.week}
              board={board}
              result={lastReveal}
              champLabel={champLabel}
              onNext={nextWeek}
              onDone={() => setRevealDone(true)}
              last={played.length >= board.weeks.length}
              reduced={reduced}
            />
          ) : null}

          {stage === "done" && result ? (
            <section className="season">
              <VerdictStamp wins={result.wins} losses={result.losses} weeks={result.weeks.length} reduced={reduced} />
              <Confetti fire={result.wins > result.losses} reduced={reduced} />
              <Summary board={board} result={result} champLabel={champLabel} ownerName={ownerName} first={first} claims={claims.length} />
              {run?.mode === "daily" ? (
                saved ? <p className={saved.ok ? "num-pos" : "num-neg"}>{saved.message}</p>
                  : <p className="champ-fine">Posting to today's board…</p>
              ) : <p className="champ-fine">Practice run. Not posted.</p>}
              <div className="pill-row">
                <button type="button" className="pill publish-primary" onClick={share}>{copied ? "Copied" : "Share result"}</button>
                <button type="button" className="pill" onClick={() => start("practice")}>Practice run</button>
                <a className="pill" href="#board">Today's board</a>
              </div>
            </section>
          ) : null}
        </div>
      ) : null}

      <Band title="Today's board" note={today} id="board" />
      {plays?.status === "ready" ? (
        todays.length ? (
          <div className="sheet">
            <table>
              <thead><tr><th style={{ textAlign: "left" }}>Owner</th><th>Vs champ</th><th>Points</th><th>Lineup IQ</th><th data-secondary="true">Points rank</th></tr></thead>
              <tbody>
                {todays.map((p) => (
                  <tr key={p.owner_id}>
                    <td style={{ textAlign: "left" }}><OwnerLink ownerId={p.owner_id}>{ownerName(p.owner_id)}</OwnerLink></td>
                    <td className={p.wins > p.losses ? "num-pos" : p.wins < p.losses ? "num-neg" : ""}>{p.wins}–{p.losses}{p.ties ? `–${p.ties}` : ""}</td>
                    <td className="figure">{fmt(p.points_for, 1)}</td>
                    <td>{lineupIq(p) != null ? `${lineupIq(p)}%` : "—"}</td>
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
              <thead><tr><th style={{ textAlign: "left" }}>Owner</th><th>Runs</th><th>Champs beaten</th><th>Weeks won</th><th>Avg IQ</th></tr></thead>
              <tbody>
                {summarizeChamp(plays.plays).map((r) => (
                  <tr key={r.owner_id}>
                    <td style={{ textAlign: "left" }}><OwnerLink ownerId={r.owner_id}>{ownerName(r.owner_id)}</OwnerLink></td>
                    <td>{r.plays}</td>
                    <td>{r.beatChamp}</td>
                    <td>{Math.round(r.pct * 100)}%</td>
                    <td>{r.iq != null ? `${r.iq}%` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      <style>{visualsCss}</style>
      <style>{gamedayCss}</style>
      <style>{faceCss}</style>
      <style>{`
        .champ-start { margin-top: 1.2rem; }
        .champ-start .kickoff:disabled { opacity: 0.45; cursor: not-allowed; }
        .champ-fine { color: var(--color-low); font-size: 0.82rem; line-height: 1.5; max-width: 44rem; margin: 0.9rem 0 0; }
        .champ .shell, .game, .spin, .lineup, .champ-ready { max-width: 44rem; }
        .lineup { list-style: none; padding: 0; margin: 1.2rem 0 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.35rem; }
        .lineup li { border: 1px solid var(--rule); padding: 0.35rem 0.5rem; min-height: 3rem; display: flex; flex-direction: column; gap: 0.1rem; background: transparent; }
        .lineup li.lineup-bench { border-style: dashed; }
        .lineup li.lineup-full { background: var(--paper-deep); border-color: var(--ink-faint); border-style: solid; }
        .lineup-slot { font: 700 0.62rem var(--font-body); letter-spacing: 0.06em; color: var(--ink-faint); }
        .lineup-name { font-size: 0.84rem; line-height: 1.15; color: var(--ink-faint); overflow-wrap: anywhere; }
        .lineup-full .lineup-name { color: var(--ink); font-weight: 600; }
        .spin { margin-top: 1.4rem; border-top: 3px double var(--ink); padding-top: 0.8rem; }
        .spin-head { display: flex; flex-direction: column; gap: 0.15rem; }
        .spin-count { font: 600 0.74rem var(--font-body); color: var(--ink-faint); }
        .spin-owner { color: var(--ink-soft); font-size: 0.9rem; }
        .options { list-style: none; padding: 0; margin: 0.8rem 0 0; border-top: 2px solid var(--ink); }
        .options li { border-bottom: 1px solid var(--rule-soft); animation: rise 0.25s ease-out both; }
        .options li:nth-child(2) { animation-delay: 0.03s; } .options li:nth-child(3) { animation-delay: 0.06s; } .options li:nth-child(n+4) { animation-delay: 0.09s; }
        .option { display: grid; grid-template-columns: 2.7rem 36px 1fr auto; gap: 0.7rem; align-items: center; width: 100%; min-height: 2.9rem;
          padding: 0.45rem 0.2rem; background: none; border: 0; font: inherit; color: inherit; text-align: left; cursor: pointer; }
        .option:hover, .option[aria-expanded="true"] { background: var(--paper-deep); }
        .option:focus-visible { outline: 2px solid var(--ember); outline-offset: -2px; }
        .option-name { font-size: 0.98rem; line-height: 1.2; }
        .option-name small { display: flex; align-items: center; gap: 0.3rem; font-size: 0.7rem; color: var(--ink-faint); margin-top: 0.1rem; }
        .option-meta { color: var(--ink-faint); font-size: 0.76rem; }
        .option-slots { display: flex; gap: 0.45rem; align-items: center; flex-wrap: wrap; padding: 0.2rem 0.2rem 0.7rem 6rem; background: var(--paper-deep); font-size: 0.82rem; color: var(--ink-soft); }
        .champ-ready { margin-top: 1.4rem; }
        .lede-line { font-family: var(--font-display); font-size: 1.25rem; font-weight: 600; margin: 0; }
        .game { margin-top: 0.4rem; scroll-margin-top: 5rem; }
        .season { margin-top: 1rem; border-top: 3px double var(--ink); padding-top: 0.8rem; }
        .verdict p { margin: 0.4rem 0; line-height: 1.5; }
        .verdict .lede { font-family: var(--font-display); font-size: 1.25rem; font-weight: 600; }
        .stat-row { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0.6rem; margin: 1rem 0; border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule); padding: 0.6rem 0; }
        .stat-row div { display: flex; flex-direction: column-reverse; gap: 0.1rem; }
        .stat-row b { font-family: var(--font-display); font-size: 1.35rem; font-variant-numeric: tabular-nums; }
        .stat-row span { font-size: 0.74rem; color: var(--ink-faint); }
        .weeklist { list-style: none; padding: 0; margin: 0.4rem 0 0; border-top: 2px solid var(--ink); }
        .weeklist li { display: grid; grid-template-columns: 3rem 1fr 1.8rem; gap: 0.6rem; align-items: center; padding: 0.35rem 0.2rem; border-bottom: 1px solid var(--rule-soft); font-size: 0.85rem; }
        .weeklist .wl { font: 700 0.75rem var(--font-body); text-align: center; color: var(--paper); padding: 0.1rem 0; }
        .weeklist .wl-W { background: var(--pos); } .weeklist .wl-L { background: var(--neg); } .weeklist .wl-T { background: var(--ink-faint); }
        .tick-w .bar-you { background: var(--pos); }
        .mini { width: 100%; border-collapse: collapse; font-size: 0.86rem; margin-top: 0.4rem; }
        .mini td { padding: 0.32rem 0.2rem; border-bottom: 1px solid var(--rule-soft); }
        .mini td:last-child { text-align: right; font-variant-numeric: tabular-nums; }
        .mini tr.you td { font-weight: 700; background: var(--paper-deep); }
        .mini .who { display: flex; align-items: center; gap: 0.55rem; }
        .mini .games { display: block; font-size: 0.7rem; color: var(--ink-faint); }
        .mini-title { font-family: var(--font-display); font-size: 1.1rem; margin: 1.3rem 0 0.2rem; }
        @media (max-width: 640px) { .stat-row { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
        @media (prefers-reduced-motion: reduce) { .options li { animation: none; } }
      `}</style>
    </div>
  );
}

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

function Summary({ board, result, champLabel, ownerName, first, claims }: {
  board: Board; result: SeasonResult; champLabel: string;
  ownerName: (id: string | null | undefined) => string; first: (id: string | null | undefined) => string; claims: number;
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
  const max = Math.max(1, ...result.weeks.map((w) => Math.max(w.you, w.champ ?? 0)));
  const blocked = board.championRoster.slice(0, 3);

  return (
    <div className="verdict">
      <p className="lede">{lede}</p>
      <p>{pointsLine} {champLine}</p>
      <div className="stat-row">
        <div><b>{result.lineup_iq}%</b><span>Lineup IQ: {fmt(result.points_for, 0)} of a possible {fmt(result.optimal_points, 0)}</span></div>
        <div><b>{result.all_play.wins}–{result.all_play.losses}</b><span>Against every team, every week</span></div>
        <div><b>{result.best_week ? fmt(result.best_week.you, 1) : "—"}</b><span>Best week{result.best_week ? `, week ${result.best_week.week}` : ""}</span></div>
        <div><b>{claims}</b><span>Waiver {claims === 1 ? "claim" : "claims"} · {champFirst} went {result.champion.wins}–{result.champion.losses}</span></div>
      </div>

      <p className="mini-title">Week by week</p>
      <ol className="weeklist">
        {result.weeks.map((w) => (
          <li key={w.week} className={w.result === "W" ? "tick-w" : ""}>
            <span>Wk {w.week}</span>
            <WeekBars you={w.you} champ={w.champ} max={max} on youText={fmt(w.you, 1)} champText={fmt(w.champ, 1)} />
            <span className={`wl wl-${w.result}`}>{w.result}</span>
          </li>
        ))}
      </ol>

      <p className="mini-title">Who scored for you</p>
      <table className="mini">
        <tbody>
          {result.by_player.map((p, i) => (
            <tr key={p.player_id}>
              <td><span className="who"><PlayerFace player={p} size={30} showTeam={false} /><span>{p.name}{i === 0 ? " (MVP)" : ""}<span className="games">{p.starts} {p.starts === 1 ? "start" : "starts"}</span></span></span></td>
              <td>{label(p.position)}</td>
              <td>{fmt(p.total, 1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {result.benched_points > 0.05 ? <p className="champ-fine">You left {fmt(result.benched_points, 1)} points on your bench over the season.</p> : null}

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
    </div>
  );
}
