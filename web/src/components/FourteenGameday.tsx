import { useEffect, useMemo, useState } from "react";
import { points as fmt } from "../lib/format";
import { claimProblem, fits, outlook } from "../lib/gauntletEngine.mjs";
import type { Board, DraftablePlayer, Lineup, Status, WeekResult } from "../lib/gauntletEngine.mjs";
import { buzz, useCountUp } from "./FourteenVisuals";
import { PlayerFace } from "./PlayerFace";

// The weekly part of Fourteen and Fantasy: set the lineup from your roster
// with that week's ESPN projections, work the waiver wire, kick off, and
// watch the real points come in. All game state lives in the page; this file
// only draws it and reports taps.

export const SLOT_LABEL: Record<string, string> = { "D/ST": "DEF", BE: "BN" };
/** Short label for a slot or position. Bench spots ("BN-RB") read "BN". */
export const label = (slot: string) => (slot.startsWith("BN-") ? "BN" : SLOT_LABEL[slot] ?? slot);

type Pick = { kind: "slot"; key: string } | { kind: "bench"; id: number } | null;

const STATUS_TEXT: Record<Status, string> = { active: "", out: "OUT", nodata: "OUT", empty: "" };
const STATUS_HELP: Record<Status, string> = {
  active: "",
  out: "Not playing this week (bye or injury). He scores 0 if you start him.",
  nodata: "No game line for him this week. He scores 0 if you start him.",
  empty: "",
};

function StatusChip({ status }: { status: Status }) {
  if (status !== "out" && status !== "nodata") return null;
  return <span className={`chip chip-${status}`} title={STATUS_HELP[status]}>{STATUS_TEXT[status]}</span>;
}

export function SeasonStrip({ board, played, current }: { board: Board; played: WeekResult[]; current: number }) {
  return (
    <ol className="strip" aria-label="Your season so far">
      {board.weeks.map((w, i) => {
        const r = played[i]?.result;
        return (
          <li key={w} className={`${r === "W" ? "s-w" : r === "L" ? "s-l" : r === "T" ? "s-t" : ""}${i === current ? " s-now" : ""}`}>
            <span className="sr">Week {w}: {r === "W" ? "win" : r === "L" ? "loss" : r === "T" ? "tie" : i === current ? "this week" : "to come"}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function Gameday({
  board, week, weekIndex, roster, lineup, waivers, claimUsed, claimsLeftText, champLabel, error,
  onSwap, onAutoSet, onClaim, onKickoff, onSim,
}: {
  board: Board;
  week: number;
  weekIndex: number;
  roster: DraftablePlayer[];
  lineup: Lineup;
  waivers: DraftablePlayer[];
  claimUsed: boolean;
  claimsLeftText: string;
  champLabel: string;
  error: string | null;
  onSwap: (next: Lineup) => void;
  onAutoSet: () => void;
  onClaim: (add: DraftablePlayer, drop: DraftablePlayer) => void;
  onKickoff: () => void;
  onSim: () => void;
}) {
  const [pick, setPick] = useState<Pick>(null);
  const [claiming, setClaiming] = useState<DraftablePlayer | null>(null);
  const [nudge, setNudge] = useState<string | null>(null);
  const [confirmSim, setConfirmSim] = useState(false);

  useEffect(() => { setPick(null); setClaiming(null); setNudge(null); setConfirmSim(false); }, [week]);

  const starters = new Set(Object.values(lineup).filter(Boolean).map((p) => p!.player_id));
  const bench = roster.filter((p) => !starters.has(p.player_id));
  const projectedTotal = Object.values(lineup).reduce((t, p) => t + (p ? outlook(p, week).projected ?? 0 : 0), 0);

  // Starting someone who won't play while a healthy bench player could go there.
  const warnings = board.keys.flatMap((k) => {
    const p = lineup[k.key];
    if (!p) {
      const can = bench.some((b) => fits(b.position, k.slot));
      return can ? [`${label(k.slot)} is empty.`] : [];
    }
    const st = outlook(p, week).status;
    if (st === "active") return [];
    const better = bench.some((b) => fits(b.position, k.slot) && outlook(b, week).status === "active");
    return better ? [`${p.name} is ${st === "out" ? "out" : "not on a roster"} this week.`] : [];
  });

  function flash(text: string) {
    setNudge(text);
    buzz(25);
  }

  /** Drop `p` for the player being claimed, if the roster stays legal. */
  function dropFor(p: DraftablePlayer | undefined) {
    if (!claiming || !p) return;
    const problem = claimProblem(roster, claiming, p);
    if (problem) { flash(`Can't drop ${p.name}: ${problem.charAt(0).toLowerCase()}${problem.slice(1)}`); return; }
    onClaim(claiming, p);
    setClaiming(null);
    setNudge(null);
  }

  function tapSlot(key: string) {
    if (claiming) { dropFor(lineup[key]); return; }
    const slot = board.keys.find((k) => k.key === key)!;
    if (!pick) { setPick({ kind: "slot", key }); setNudge(null); return; }
    if (pick.kind === "slot") {
      if (pick.key === key) { setPick(null); return; }
      const from = board.keys.find((k) => k.key === pick.key)!;
      const a = lineup[pick.key];
      const b = lineup[key];
      if ((a && !fits(a.position, slot.slot)) || (b && !fits(b.position, from.slot))) {
        flash(`${(a ?? b)!.name} can't play ${label(a && !fits(a.position, slot.slot) ? slot.slot : from.slot)}.`);
        setPick(null);
        return;
      }
      onSwap({ ...lineup, [pick.key]: b, [key]: a });
      setPick(null);
      return;
    }
    const incoming = roster.find((p) => p.player_id === pick.id)!;
    if (!fits(incoming.position, slot.slot)) { flash(`${incoming.name} can't play ${label(slot.slot)}.`); setPick(null); return; }
    onSwap({ ...lineup, [key]: incoming });
    setPick(null);
  }

  function tapBench(id: number) {
    if (claiming) { dropFor(roster.find((x) => x.player_id === id)); return; }
    if (!pick) { setPick({ kind: "bench", id }); setNudge(null); return; }
    if (pick.kind === "bench") { setPick(pick.id === id ? null : { kind: "bench", id }); return; }
    benchIntoPicked(id);
  }

  // Slot selected, then a bench player tapped: move him into that slot.
  function benchIntoPicked(id: number) {
    if (!pick || pick.kind !== "slot") return tapBench(id);
    const slot = board.keys.find((k) => k.key === pick.key)!;
    const incoming = roster.find((p) => p.player_id === id)!;
    if (!fits(incoming.position, slot.slot)) { flash(`${incoming.name} can't play ${label(slot.slot)}.`); setPick(null); return; }
    onSwap({ ...lineup, [pick.key]: incoming });
    setPick(null);
  }

  const canTarget = (slotName: string, p: DraftablePlayer | undefined) => {
    if (claiming) return !!p && !claimProblem(roster, claiming, p);
    if (!pick) return false;
    if (pick.kind === "bench") {
      const incoming = roster.find((x) => x.player_id === pick.id);
      return !!incoming && fits(incoming.position, slotName);
    }
    const from = board.keys.find((k) => k.key === pick.key)!;
    const a = lineup[pick.key];
    return (!a || fits(a.position, slotName)) && (!p || fits(p.position, from.slot));
  };

  const benchTarget = (p: DraftablePlayer) => {
    if (claiming) return !claimProblem(roster, claiming, p);
    if (!pick || pick.kind !== "slot") return false;
    const slot = board.keys.find((k) => k.key === pick.key)!;
    return fits(p.position, slot.slot);
  };

  const row = ({ key, slotName, p, selected, target, onTap }: { key: string | number; slotName: string; p?: DraftablePlayer; selected: boolean; target: boolean; onTap: () => void }) => {
    const look = p ? outlook(p, week) : null;
    return (
      <li key={key}>
        <button
          type="button"
          className={`gd-row${selected ? " is-picked" : ""}${target ? " is-target" : ""}${claiming ? " is-drop" : ""}${look && look.status !== "active" ? " is-out" : ""}`}
          onClick={onTap}
          aria-pressed={selected}
        >
          <span className={`gd-slot slot-${slotName.replace("/", "")}`}>{label(slotName)}</span>
          {p ? <PlayerFace player={p} /> : <span className="face face-empty" />}
          <span className="gd-name">
            {p ? p.name : <em>Empty</em>}
            {p ? <small>{label(p.position)}{p.teams?.[week] ?? p.team ? ` · ${p.teams?.[week] ?? p.team}` : ""}</small> : null}
          </span>
          {look ? <StatusChip status={look.status} /> : <span />}
          <span className="gd-proj">{look?.projected != null && look.status === "active" ? fmt(look.projected, 1) : "—"}</span>
        </button>
      </li>
    );
  };

  return (
    <section className="gameday" aria-label={`Week ${week}`}>
      <div className="gd-head">
        <div>
          <span className="gd-kicker">Week {week} of {board.weeks.length}</span>
          <h2>You vs {champLabel}</h2>
        </div>
        <div className="gd-projected"><b>{fmt(projectedTotal, 1)}</b><span>projected</span></div>
      </div>

      {board.estimatedWeeks.includes(week) ? (
        <p className="gd-warn" style={{ marginTop: "0.6rem" }}>ESPN's projections for this week are missing, so each player shows his average projection from the rest of the season.</p>
      ) : null}
      <p className="gd-help">
        {claiming
          ? <>Tap a player to drop for <b>{claiming.name}</b>. You always keep a backup at QB, RB, WR, TE and DEF. <button type="button" className="linkish" onClick={() => { setClaiming(null); setNudge(null); }}>Cancel</button></>
          : pick
            ? "Now tap where he goes. Highlighted spots are legal."
            : "Tap a player, then tap where he should go. Real points stay hidden until kickoff."}
      </p>

      <ul className="gd-list" aria-label="Starters">
        {board.keys.map((k) => row({
          key: k.key,
          slotName: k.slot,
          p: lineup[k.key],
          selected: pick?.kind === "slot" && pick.key === k.key,
          target: canTarget(k.slot, lineup[k.key]),
          onTap: () => tapSlot(k.key),
        }))}
      </ul>
      <p className="gd-sub">Bench</p>
      <ul className="gd-list gd-bench" aria-label="Bench">
        {bench.length ? bench.map((p) => row({
          key: p.player_id,
          slotName: "BE",
          p,
          selected: pick?.kind === "bench" && pick.id === p.player_id,
          target: benchTarget(p),
          onTap: () => tapBench(p.player_id),
        })) : <li className="gd-empty">Nobody on the bench.</li>}
      </ul>

      {nudge ? <p className="gd-nudge" role="alert" key={nudge}>{nudge}</p> : null}
      {error ? <p className="gd-nudge" role="alert">{error}</p> : null}

      <div className="gd-waivers">
        <p className="gd-sub">Waiver wire <span>{claimUsed ? "claim used this week" : claimsLeftText}</span></p>
        <ul>
          {waivers.map((p) => {
            const look = outlook(p, week);
            return (
              <li key={p.player_id} className={claiming?.player_id === p.player_id ? "is-claiming" : ""}>
                <span className={`gd-slot slot-${p.position.replace("/", "")}`}>{label(p.position)}</span>
                <PlayerFace player={p} />
                <span className="gd-name">{p.name}<small>{p.teams?.[week] ?? p.team ? `${p.teams?.[week] ?? p.team} · ` : ""}{look.projected != null ? `proj ${fmt(look.projected, 1)}` : ""}</small></span>
                <button type="button" className="pill" disabled={claimUsed || !!claiming} onClick={() => { setPick(null); setClaiming(p); }}>Claim</button>
              </li>
            );
          })}
          {!waivers.length ? <li className="gd-empty">Nobody useful on waivers this week.</li> : null}
        </ul>
      </div>

      {warnings.length ? <p className="gd-warn">Heads up: {warnings.join(" ")}</p> : null}
      <div className="gd-actions">
        <button type="button" className="pill" onClick={() => { setPick(null); onAutoSet(); }}>Best by projection</button>
        <button type="button" className="kickoff" onClick={() => { setPick(null); onKickoff(); }}>
          {warnings.length ? "Kick off anyway" : "Kick off"} <span aria-hidden="true">▶</span>
        </button>
      </div>
      {weekIndex < board.weeks.length - 1 ? (
        confirmSim ? (
          <p className="gd-sim">
            Play every remaining week with the best lineup by projection and no more waiver moves?{" "}
            <button type="button" className="pill" onClick={onSim}>Yes, sim it</button>{" "}
            <button type="button" className="linkish" onClick={() => setConfirmSim(false)}>Keep managing</button>
          </p>
        ) : (
          <p className="gd-sim"><button type="button" className="linkish" onClick={() => setConfirmSim(true)}>Short on time? Sim the rest of the season</button></p>
        )
      ) : null}
    </section>
  );
}

/** Kickoff: real points arrive one player at a time while both totals climb. */
export function Reveal({ board, result, champLabel, onNext, onDone, last, reduced }: {
  board: Board; result: WeekResult; champLabel: string; onNext: () => void; onDone: () => void; last: boolean; reduced: boolean;
}) {
  const rows = result.rows;
  const [shown, setShown] = useState(reduced ? rows.length : 0);
  const finished = shown >= rows.length;
  const yourSoFar = rows.slice(0, shown).reduce((t, r) => t + r.points, 0);
  const champTarget = (result.champ ?? 0) * (rows.length ? shown / rows.length : 1);
  const you = useCountUp(yourSoFar, 260, reduced);
  const champ = useCountUp(champTarget, 260, reduced);

  useEffect(() => {
    if (finished) {
      buzz(result.result === "W" ? [20, 40, 20] : 35);
      onDone();
      return;
    }
    const id = window.setTimeout(() => setShown((n) => n + 1), shown === 0 ? 350 : 260);
    return () => window.clearTimeout(id);
  }, [shown, finished, result.result]);

  const left = (result.optimal ?? result.you) - result.you;
  const best = useMemo(() => [...rows].sort((a, b) => b.points - a.points)[0], [rows]);

  return (
    <section className={`reveal${finished ? ` is-final r-${result.result}` : ""}`} aria-live="polite" onClick={() => !finished && setShown(rows.length)}>
      <div className="rv-board">
        <div className="rv-side">
          <span>You</span>
          <b>{fmt(finished ? result.you : you, 1)}</b>
        </div>
        <div className="rv-mid">
          <span>Week {result.week}</span>
          {finished ? <strong className={`rv-stamp rv-${result.result}`}>{result.result === "W" ? "WIN" : result.result === "L" ? "LOSS" : "TIE"}</strong> : <em>LIVE</em>}
        </div>
        <div className="rv-side rv-champ">
          <span>{champLabel}</span>
          <b>{fmt(finished ? result.champ : champ, 1)}</b>
        </div>
      </div>
      <ul className="rv-rows">
        {rows.map((r, i) => {
          const on = i < shown;
          const diff = r.projected != null ? r.points - r.projected : null;
          return (
            <li key={r.key} className={on ? "on" : ""}>
              <span className={`gd-slot slot-${r.slot.replace("/", "")}`}>{label(r.slot)}</span>
              {r.player ? <PlayerFace player={r.player} size={30} showTeam={false} /> : <span className="face face-empty" />}
              <span className="gd-name">{r.player?.name ?? <em>Empty</em>}</span>
              <span className={`rv-diff ${diff == null ? "" : diff >= 0 ? "up" : "down"}`}>
                {on && diff != null && r.status === "active" ? `${diff >= 0 ? "+" : ""}${fmt(diff, 1)}` : ""}
              </span>
              <b className="rv-pts">{on ? fmt(r.points, 1) : ""}</b>
            </li>
          );
        })}
      </ul>
      {finished ? (
        <div className="rv-foot">
          <p>
            {best?.player && best.points > 0 ? <>Top scorer: <b>{best.player.name}</b> ({fmt(best.points, 1)}). </> : null}
            {left > 0.05 ? <>You left <b>{fmt(left, 1)}</b> points on your bench.</> : <>Perfect lineup this week.</>}
          </p>
          <button type="button" className="kickoff" onClick={(e) => { e.stopPropagation(); onNext(); }} autoFocus>
            {last ? "See your season" : `Week ${board.weeks[board.weeks.indexOf(result.week) + 1]}`} <span aria-hidden="true">▶</span>
          </button>
        </div>
      ) : (
        <p className="rv-skip">Tap to skip ahead</p>
      )}
    </section>
  );
}

export const gamedayCss = `
  .strip { list-style: none; padding: 0; margin: 1rem 0 0; display: grid; grid-template-columns: repeat(var(--weeks, 14), 1fr); gap: 3px; }
  .strip li { height: 10px; background: var(--rule-soft); }
  .strip li.s-w { background: var(--pos); } .strip li.s-l { background: var(--neg); } .strip li.s-t { background: var(--ink-faint); }
  .strip li.s-now { outline: 2px solid var(--ink); outline-offset: 1px; animation: now-pulse 1.4s ease-in-out infinite; }
  @keyframes now-pulse { 50% { opacity: 0.45; } }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  .record-line { display: flex; align-items: baseline; gap: 0.6rem; margin-top: 0.5rem; }
  .record-line b { font-family: var(--font-display); font-size: 2rem; font-variant-numeric: tabular-nums; }
  .record-line span { color: var(--ink-soft); font-size: 0.85rem; }
  .gameday { margin-top: 1rem; border-top: 3px double var(--ink); padding-top: 0.7rem; animation: rise 0.35s ease-out; }
  @keyframes rise { from { opacity: 0; transform: translateY(10px); } }
  .gd-head { display: flex; justify-content: space-between; align-items: end; gap: 1rem; }
  .gd-kicker { font: 600 0.72rem var(--font-body); color: var(--ink-faint); letter-spacing: 0.06em; text-transform: uppercase; }
  .gd-head h2 { font-size: clamp(1.2rem, 4.8vw, 1.6rem); line-height: 1.15; margin: 0.1rem 0 0; }
  .gd-projected { text-align: right; flex: none; }
  .gd-projected b { display: block; font-family: var(--font-display); font-size: 1.6rem; font-variant-numeric: tabular-nums; }
  .gd-projected span { font-size: 0.7rem; color: var(--ink-faint); }
  .gd-help { font-size: 0.82rem; color: var(--ink-soft); margin: 0.6rem 0 0.4rem; min-height: 1.2em; }
  .gd-list { list-style: none; padding: 0; margin: 0; border-top: 2px solid var(--ink); }
  .gd-row { display: grid; grid-template-columns: 2.7rem 36px 1fr auto 3.1rem; gap: 0.6rem; align-items: center; width: 100%; min-height: 2.8rem; padding: 0.3rem 0.25rem;
    background: none; border: 0; border-bottom: 1px solid var(--rule-soft); font: inherit; color: inherit; text-align: left; cursor: pointer;
    transition: background 0.15s, transform 0.15s; }
  .gd-row:hover { background: var(--paper-deep); }
  .gd-row:focus-visible { outline: 2px solid var(--ember); outline-offset: -2px; }
  .gd-row.is-picked { background: var(--ink); color: var(--paper); transform: scale(1.015); box-shadow: 0 4px 14px #0003; }
  .gd-row.is-picked .gd-proj, .gd-row.is-picked small { color: var(--paper); }
  .gd-row.is-target { background: #c5a76a33; box-shadow: inset 3px 0 0 #c5a76a; }
  .gd-row.is-drop { opacity: 0.45; }
  .gd-row.is-drop.is-target { opacity: 1; box-shadow: inset 3px 0 0 var(--neg); background: #a8453a12; }
  .gd-row.is-out .gd-name { color: var(--ink-faint); text-decoration: line-through; text-decoration-color: #a8453a88; }
  .gd-slot { font: 700 0.62rem var(--font-body); letter-spacing: 0.05em; color: #eee9dd; background: #45545a; padding: 0.24rem 0; text-align: center; }
  .slot-QB { background: #603d46; } .slot-RB { background: #324c42; } .slot-WR { background: #193b48; } .slot-TE { background: #624830; }
  .slot-FLEX { background: #3d4059; } .slot-DST { background: #202c30; } .slot-K { background: #6a6a5a; } .slot-BE { background: #8a8170; }
  .gd-name { font-size: 0.95rem; line-height: 1.2; min-width: 0; overflow-wrap: anywhere; }
  .gd-name small { display: block; font-size: 0.68rem; color: var(--ink-faint); }
  .gd-proj { text-align: right; font-variant-numeric: tabular-nums; font-size: 0.9rem; color: var(--ink-soft); }
  .chip { font: 700 0.6rem var(--font-body); letter-spacing: 0.05em; padding: 0.15rem 0.35rem; color: #fff; }
  .chip-out, .chip-nodata { background: var(--neg); }
  .face-empty { width: 36px; height: 36px; border: 1px dashed var(--rule); background: transparent; }
  .rv-rows .face-empty { width: 30px; height: 30px; border-color: #ffffff33; }
  .gd-row.is-picked .face > img { box-shadow: 0 0 0 2px var(--paper); }
  .gd-sub { font: 600 0.74rem var(--font-body); text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-faint); margin: 1rem 0 0.3rem; display: flex; justify-content: space-between; gap: 1rem; }
  .gd-sub span { text-transform: none; letter-spacing: 0; font-weight: 400; }
  .gd-empty { padding: 0.6rem 0.25rem; color: var(--ink-faint); font-size: 0.85rem; }
  .gd-nudge { color: var(--neg); font-size: 0.85rem; margin: 0.5rem 0 0; animation: shake 0.3s; }
  @keyframes shake { 25% { transform: translateX(-4px); } 75% { transform: translateX(4px); } }
  .gd-waivers ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 0.4rem; }
  .gd-waivers li { display: grid; grid-template-columns: 2.7rem 36px 1fr auto; gap: 0.6rem; align-items: center; padding: 0.4rem 0.4rem; border: 1px dashed var(--rule); }
  .gd-waivers li.is-claiming { border-style: solid; border-color: var(--ink); background: var(--paper-deep); }
  .gd-warn { margin: 0.9rem 0 0; padding: 0.5rem 0.6rem; background: #a8453a14; border-left: 3px solid var(--neg); font-size: 0.85rem; }
  .gd-actions { display: flex; gap: 0.6rem; align-items: center; justify-content: space-between; margin-top: 0.9rem; flex-wrap: wrap; }
  .kickoff { font: 700 1.02rem var(--font-body); letter-spacing: 0.04em; text-transform: uppercase; color: var(--paper); background: var(--ink);
    border: 0; padding: 0.85rem 1.4rem; cursor: pointer; box-shadow: 0 4px 0 #0005; transition: transform 0.1s, box-shadow 0.1s; }
  .kickoff:hover { background: #2e3f45; }
  .kickoff:active { transform: translateY(3px); box-shadow: 0 1px 0 #0005; }
  .kickoff:focus-visible { outline: 3px solid #c5a76a; outline-offset: 2px; }
  .gd-sim { font-size: 0.82rem; color: var(--ink-soft); margin-top: 0.9rem; }
  .linkish { background: none; border: 0; padding: 0; font: inherit; color: var(--ink); text-decoration: underline; cursor: pointer; }
  .reveal { margin-top: 1rem; background: #1d272b; color: #eee9dd; padding: 0.9rem 0.9rem 1rem; border-top: 4px solid #c5a76a; animation: rise 0.3s ease-out; cursor: pointer; }
  .reveal.is-final { cursor: default; }
  .rv-board { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 0.6rem; padding-bottom: 0.7rem; border-bottom: 1px solid #ffffff22; }
  .rv-side span { display: block; font-size: 0.72rem; color: #c4bcab; line-height: 1.2; overflow-wrap: anywhere; }
  .rv-side b { display: block; font-family: var(--font-display); font-size: clamp(2rem, 9vw, 2.8rem); line-height: 1.05; font-variant-numeric: tabular-nums; }
  .rv-champ { text-align: right; } .rv-champ b { color: #c5a76a; }
  .rv-mid { text-align: center; }
  .rv-mid span { display: block; font-size: 0.68rem; color: #c4bcab; text-transform: uppercase; letter-spacing: 0.08em; }
  .rv-mid em { font: 700 0.7rem var(--font-body); font-style: normal; color: #e06a5a; letter-spacing: 0.1em; animation: now-pulse 1s infinite; }
  .rv-stamp { display: inline-block; font: 800 1.05rem var(--font-body); letter-spacing: 0.08em; padding: 0.2rem 0.5rem; border: 2px solid currentColor; transform: rotate(-6deg);
    animation: stamp-in 0.45s cubic-bezier(.3,1.4,.5,1) both; }
  .rv-W { color: #6fc596; } .rv-L { color: #e06a5a; } .rv-T { color: #c4bcab; }
  .rv-rows { list-style: none; padding: 0; margin: 0.4rem 0 0; }
  .rv-rows li { display: grid; grid-template-columns: 2.7rem 30px 1fr auto 3.2rem; gap: 0.6rem; align-items: center; padding: 0.28rem 0; border-bottom: 1px solid #ffffff12; opacity: 0.35; transition: opacity 0.2s; }
  .rv-rows li.on { opacity: 1; }
  .rv-rows li.on .rv-pts { animation: pts-pop 0.35s cubic-bezier(.3,1.6,.5,1); }
  @keyframes pts-pop { from { transform: scale(1.7); color: #c5a76a; } }
  .rv-rows .gd-name { color: #eee9dd; }
  .rv-pts { text-align: right; font-variant-numeric: tabular-nums; font-size: 1rem; }
  .rv-diff { font-size: 0.72rem; font-variant-numeric: tabular-nums; }
  .rv-diff.up { color: #6fc596; } .rv-diff.down { color: #e06a5a; }
  .rv-foot { margin-top: 0.8rem; display: flex; flex-direction: column; gap: 0.7rem; align-items: flex-start; }
  .rv-foot p { margin: 0; font-size: 0.88rem; color: #e1d9c8; }
  .rv-foot .kickoff { background: #c5a76a; color: #1d272b; }
  .rv-skip { margin: 0.6rem 0 0; font-size: 0.72rem; color: #c4bcab; }
  .reveal.is-final.r-W { box-shadow: 0 0 0 2px #6fc59655, 0 10px 30px #2f6b4f44; }
  @media (prefers-reduced-motion: reduce) {
    .strip li.s-now, .gameday, .reveal, .rv-stamp, .rv-rows li.on .rv-pts, .gd-nudge, .rv-mid em { animation: none; }
  }
`;
