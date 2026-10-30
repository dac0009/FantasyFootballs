import { useEffect, useMemo, useRef, useState } from "react";
import { points as fmt } from "../lib/format";
import { clockLabel } from "../lib/broadcast.mjs";
import type { Broadcast } from "../lib/broadcast.mjs";
import type { WeekResult } from "../lib/gauntletEngine.mjs";
import { buzz, useCountUp } from "./FourteenVisuals";
import { PlayerFace } from "./PlayerFace";
import { shortName } from "./FourteenGameday";

// Kickoff, broadcast style: the real NFL plays that scored for your starters
// and the champion's, in game-clock order across every game, with a scorebug,
// a field where the ball swings toward whoever's ahead, touchdown calls, a
// line score by quarter and a play-by-play feed. Tap "Skip to final" anytime.

const QUARTERS = ["Q1", "Q2", "Q3", "Q4", "OT"];

export function BroadcastView({ week, result, broadcast, champLabel, onNext, onDone, last, nextLabel, reduced }: {
  week: number;
  result: WeekResult;
  broadcast: Broadcast;
  champLabel: string;
  onNext: () => void;
  onDone: () => void;
  last: boolean;
  nextLabel: string;
  reduced: boolean;
}) {
  const events = broadcast.events;
  const [shown, setShown] = useState(reduced ? events.length : 0);
  const [speed, setSpeed] = useState(1);
  const [flash, setFlash] = useState<{ text: string; side: "you" | "champ"; key: number } | null>(null);
  const finished = shown >= events.length;
  const current = shown > 0 ? events[shown - 1] : null;
  const score = finished ? broadcast.final : current?.score ?? { you: 0, champ: 0 };
  const you = useCountUp(score.you, reduced ? 0 : 380, reduced);
  const champ = useCountUp(score.champ, reduced ? 0 : 380, reduced);
  const doneOnce = useRef(false);

  const base = useMemo(() => Math.max(110, Math.min(420, 9000 / Math.max(events.length, 1))), [events.length]);

  useEffect(() => {
    if (finished) {
      if (!doneOnce.current) {
        doneOnce.current = true;
        buzz(result.result === "W" ? [30, 50, 30, 50, 60] : 40);
        onDone();
      }
      return;
    }
    const next = events[shown];
    const prev = events[shown - 1];
    const pause = prev?.touchdown ? 900 : prev?.big ? 380 : 0;
    const quarterBreak = prev && next && next.qtr !== prev.qtr ? 450 : 0;
    const id = window.setTimeout(() => {
      setShown((n) => n + 1);
      if (next?.touchdown && !reduced) {
        setFlash({ text: next.players.length ? shortName(next.players[next.players.length - 1].name) : "", side: next.side, key: shown });
        buzz(next.side === "you" ? [15, 30, 15] : 25);
      }
    }, (shown === 0 ? 500 : base + pause + quarterBreak) / speed);
    return () => window.clearTimeout(id);
  }, [shown, finished, events, base, speed, reduced, result.result, onDone]);

  useEffect(() => {
    if (!flash) return;
    const id = window.setTimeout(() => setFlash(null), 1300 / speed);
    return () => window.clearTimeout(id);
  }, [flash, speed]);

  // Ball position: 50 = midfield. Your lead pushes it toward the right end zone.
  const diff = score.you - score.champ;
  const ball = Math.max(6, Math.min(94, 50 + diff * 1.2));
  const qNow = finished ? "Final" : current ? clockLabel(current.qtr, current.clock) : "Kickoff";
  const feed = events.slice(0, shown).slice(-7).reverse();
  const lineQ = (side: "you" | "champ") => broadcast.quarters[side];
  const reachedQ = (q: number) => finished || (current != null && current.qtr > q);
  const playedOT = events.some((e) => e.qtr === 5);
  const left = (result.optimal ?? result.you) - result.you;
  const mvp = useMemo(() => [...result.rows].sort((a, b) => b.points - a.points)[0], [result.rows]);

  return (
    <section className={`bc${finished ? ` is-final bc-${result.result}` : ""}`} aria-label={`Week ${week} broadcast`}>
      <div className="bc-bug" aria-live="off">
        <div className="bc-team bc-you">
          <span className="bc-name">You</span>
          <b className="bc-score">{fmt(you, 1)}</b>
        </div>
        <div className="bc-clock">
          <span>{qNow}</span>
          {finished
            ? <strong className={`rv-stamp rv-${result.result}`}>{result.result === "W" ? "WIN" : result.result === "L" ? "LOSS" : "TIE"}</strong>
            : <em>LIVE</em>}
        </div>
        <div className="bc-team bc-champ">
          <span className="bc-name">{champLabel}</span>
          <b className="bc-score">{fmt(champ, 1)}</b>
        </div>
      </div>

      <div className="bc-field" aria-hidden="true">
        <span className="ez ez-champ">{champLabel.split(" ")[0].replace(/'s$/, "")}</span>
        <span className="ez ez-you">You</span>
        {[10, 20, 30, 40, 50, 60, 70, 80, 90].map((x) => <span key={x} className="bc-yard" style={{ left: `${x}%` }}><i>{x <= 50 ? x : 100 - x}</i></span>)}
        <span className="bc-ball" style={{ left: `${ball}%` }} />
        {flash ? (
          <span key={flash.key} className={`bc-td bc-td-${flash.side}`}>
            <b>Touchdown</b>
            <span>{flash.text}</span>
          </span>
        ) : null}
      </div>

      <table className="bc-line">
        <thead><tr><th />{QUARTERS.slice(0, playedOT ? 5 : 4).map((q) => <th key={q}>{q}</th>)}<th>Total</th></tr></thead>
        <tbody>
          {(["you", "champ"] as const).map((side) => (
            <tr key={side}>
              <td>{side === "you" ? "You" : "Champ"}</td>
              {lineQ(side).slice(0, playedOT ? 5 : 4).map((v, i) => <td key={i}>{reachedQ(i + 1) ? fmt(v, 1) : ""}</td>)}
              <td><b>{fmt(side === "you" ? you : champ, 1)}</b></td>
            </tr>
          ))}
        </tbody>
      </table>

      <ol className="bc-feed" aria-live="polite">
        {feed.map((e) => (
          <li key={`${e.play}:${e.side}`} className={`bc-play bc-${e.side}${e.touchdown ? " is-td" : e.big ? " is-big" : ""}`}>
            <span className="bc-faces">
              {e.players.slice(0, 2).map((p) => <PlayerFace key={p.player_id} player={p} size={30} showTeam={false} />)}
            </span>
            <span className="bc-text">
              <small>{clockLabel(e.qtr, e.clock)}{e.game ? ` · ${e.game}` : ""}{e.side === "champ" ? " · Champ" : ""}</small>
              {e.text}
            </span>
            <b className={e.pts >= 0 ? "up" : "down"}>{e.pts >= 0 ? "+" : ""}{fmt(e.pts, 1)}</b>
          </li>
        ))}
        {!feed.length ? <li className="bc-play bc-wait"><span className="bc-text">Kickoff in every game…</span></li> : null}
      </ol>

      {finished ? (
        <div className="rv-foot">
          <p>
            {mvp?.player && mvp.points > 0 ? <>Player of the game: <b>{mvp.player.name}</b> ({fmt(mvp.points, 1)}). </> : null}
            {left > 0.05 ? <>You left <b>{fmt(left, 1)}</b> points on your bench.</> : <>Perfect lineup this week.</>}
          </p>
          <button type="button" className="kickoff kickoff-gold" onClick={onNext} autoFocus>
            {last ? "See your season" : nextLabel} <span aria-hidden="true">▶</span>
          </button>
        </div>
      ) : (
        <div className="bc-controls">
          <button type="button" className="pill" onClick={() => setSpeed((s) => (s === 1 ? 2.5 : 1))}>{speed === 1 ? "Speed up" : "Normal speed"}</button>
          <button type="button" className="pill" onClick={() => setShown(events.length)}>Skip to final</button>
        </div>
      )}
      <p className="bc-note">Real plays from that week's NFL games, shown on one clock. Bonuses and points allowed land at the final whistle. Play-by-play data: nflverse.</p>
    </section>
  );
}

export const broadcastCss = `
  .bc { margin-top: 1rem; background: #141b1e; color: #eee9dd; padding: 0.7rem 0.7rem 0.9rem; border-top: 4px solid #c5a76a; animation: rise 0.3s ease-out; }
  .bc-bug { display: grid; grid-template-columns: 1fr auto 1fr; align-items: stretch; background: #0b1012; border: 1px solid #ffffff22; }
  .bc-team { padding: 0.45rem 0.6rem; display: flex; flex-direction: column; justify-content: center; min-width: 0; }
  .bc-you { border-left: 5px solid #6fc596; } .bc-champ { border-right: 5px solid #c5a76a; text-align: right; }
  .bc-name { font: 700 0.66rem var(--font-body); text-transform: uppercase; letter-spacing: 0.06em; color: #c4bcab; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bc-score { font-family: var(--font-display); font-size: clamp(1.9rem, 9vw, 2.7rem); line-height: 1; font-variant-numeric: tabular-nums; }
  .bc-champ .bc-score { color: #e3c98f; }
  .bc-clock { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; padding: 0 0.7rem; background: #1d272b; min-width: 5.6rem; }
  .bc-clock span { font: 700 0.86rem var(--font-body); font-variant-numeric: tabular-nums; }
  .bc-clock em { font: 800 0.62rem var(--font-body); font-style: normal; letter-spacing: 0.12em; color: #fff; background: #c0392b; padding: 1px 6px; border-radius: 2px; animation: now-pulse 1.2s infinite; }
  .bc-field { position: relative; height: 74px; margin-top: 0.6rem; background: repeating-linear-gradient(90deg, #2f6b3a 0 10%, #2b6335 10% 20%); overflow: hidden; border-radius: 4px; }
  .ez { position: absolute; top: 0; bottom: 0; width: 7%; display: grid; place-items: center; font: 800 0.55rem var(--font-body); letter-spacing: 0.08em;
    text-transform: uppercase; writing-mode: vertical-rl; color: #fff; }
  .ez-champ { left: 0; background: #8f7440; transform: rotate(180deg); } .ez-you { right: 0; background: #2f6b4f; }
  .bc-yard { position: absolute; top: 0; bottom: 0; width: 2px; background: #f1efe855; }
  .bc-yard i { position: absolute; bottom: 3px; left: 4px; font: 700 0.6rem var(--font-body); font-style: normal; color: #f1efe8aa; }
  .bc-ball { position: absolute; top: 50%; width: 22px; height: 13px; margin: -6px 0 0 -11px; background: #7a4a24; border-radius: 50%;
    box-shadow: 0 0 0 1.5px #fff, 0 3px 6px #0008; transition: left 0.6s cubic-bezier(.2,.8,.25,1); }
  .bc-ball::after { content: ""; position: absolute; left: 6px; right: 6px; top: 5px; height: 2px; background: #fff; }
  .bc-td { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
    animation: td-in 1.3s ease-out both; }
  .bc-td b { font: 900 clamp(1.3rem, 7vw, 2rem) var(--font-body); letter-spacing: 0.12em; text-transform: uppercase; color: #fff; text-shadow: 0 2px 0 #000, 0 0 18px #0008; }
  .bc-td span { font: 700 0.78rem var(--font-body); color: #fff; text-shadow: 0 1px 2px #000; }
  .bc-td-you { background: #2f6b4fcc; } .bc-td-champ { background: #8f7440cc; }
  @keyframes td-in { 0% { transform: scale(1.6); opacity: 0; } 15% { transform: scale(1); opacity: 1; } 80% { opacity: 1; } 100% { opacity: 0; } }
  .bc-line { width: 100%; margin-top: 0.6rem; border-collapse: collapse; font-size: 0.78rem; font-variant-numeric: tabular-nums; }
  .bc-line th { font-weight: 600; color: #c4bcab; font-size: 0.66rem; text-align: right; padding: 2px 4px; }
  .bc-line td { text-align: right; padding: 3px 4px; border-top: 1px solid #ffffff14; }
  .bc-line td:first-child { text-align: left; color: #c4bcab; }
  .bc-feed { list-style: none; padding: 0; margin: 0.6rem 0 0; min-height: 15rem; }
  .bc-play { display: grid; grid-template-columns: auto 1fr auto; gap: 0.55rem; align-items: center; padding: 0.4rem 0.4rem; border-bottom: 1px solid #ffffff12;
    border-left: 3px solid transparent; animation: feed-in 0.3s ease-out; }
  .bc-play:first-child { background: #ffffff0d; }
  .bc-you { border-left-color: #6fc596; } .bc-champ { border-left-color: #c5a76a; }
  .bc-play.bc-champ { border-right: 0; text-align: left; }
  .bc-play.is-td { background: #2f6b4f40; } .bc-play.bc-champ.is-td { background: #8f744040; }
  @keyframes feed-in { from { transform: translateY(-8px); opacity: 0; } }
  .bc-faces { display: flex; }
  .bc-faces .face + .face { margin-left: -10px; }
  .bc-faces .face { box-shadow: 0 0 0 2px #141b1e; }
  .bc-text { font-size: 0.86rem; line-height: 1.25; min-width: 0; }
  .bc-text small { display: block; font-size: 0.66rem; color: #c4bcab; }
  .bc-play b { font-variant-numeric: tabular-nums; font-size: 0.95rem; }
  .bc-play b.up { color: #6fc596; } .bc-champ b.up { color: #e3c98f; } .bc-play b.down { color: #e06a5a; }
  .bc-wait { color: #c4bcab; }
  .bc-controls { display: flex; gap: 0.5rem; margin-top: 0.7rem; }
  .bc-controls .pill { background: transparent; color: #eee9dd; border-color: #ffffff44; }
  .bc-note { margin: 0.7rem 0 0; font-size: 0.68rem; color: #9e978a; }
  .bc.is-final.bc-W { box-shadow: 0 0 0 2px #6fc59655; }
  .kickoff-gold { background: #c5a76a !important; color: #141b1e !important; }
  @media (prefers-reduced-motion: reduce) {
    .bc, .bc-play, .bc-td, .bc-clock em { animation: none; }
    .bc-ball { transition: none; }
  }
`;
