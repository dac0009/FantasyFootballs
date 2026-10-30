import { useEffect, useMemo, useRef, useState } from "react";
import type { PlayField as Field } from "../lib/broadcast.mjs";
import { downLabel, spotLabel } from "../lib/broadcast.mjs";

// Replays one real NFL snap on a field: the ball starts at the real line of
// scrimmage and travels the real distance (in the air for the real air
// yards on a pass, then after the catch). The offense always attacks to the
// right. The trail is green for your players and gold for the champion's.

const W = 120; // yards, end line to end line
const H = 53.3; // field width in yards
const MID = H / 2;

type Seg = { from: [number, number]; to: [number, number]; h: number; ms: number; fall?: boolean };

const clampX = (x: number) => Math.max(1, Math.min(W - 1, x));

/** The ball's flight for one play, in field yards. */
export function playPath(field: Field, seed: number): Seg[] {
  const [, yl, yards, kind, air, , , td, ret] = field;
  const los = 110 - yl;
  const lane = seed % 2 ? -1 : 1;
  const wide = MID + lane * (8 + (seed % 7) * 1.6);
  const end = (x: number) => (td ? Math.max(x, 112) : x);
  switch (kind) {
    case "P": {
      const a = air ?? yards;
      const catchX = clampX(los + a);
      const segs: Seg[] = [
        { from: [los - 1, MID], to: [los - 6, MID], h: 0, ms: 260 },
        { from: [los - 6, MID], to: [catchX, wide], h: Math.min(12, 3 + Math.abs(a) * 0.28), ms: 420 + Math.abs(a) * 9 },
      ];
      const after = clampX(end(los + yards));
      if (Math.abs(after - catchX) > 0.5) segs.push({ from: [catchX, wide], to: [after, wide + lane * -3], h: 0, ms: 200 + Math.abs(after - catchX) * 16 });
      return segs;
    }
    case "p":
      return [
        { from: [los - 1, MID], to: [los - 6, MID], h: 0, ms: 260 },
        { from: [los - 6, MID], to: [clampX(los + (air ?? 10)), wide], h: 6, ms: 520, fall: true },
      ];
    case "I": {
      const a = air ?? 12;
      const pick = clampX(los + a);
      const back = clampX(td ? 7 : pick - Math.max(ret, 2));
      return [
        { from: [los - 1, MID], to: [los - 6, MID], h: 0, ms: 260 },
        { from: [los - 6, MID], to: [pick, wide], h: Math.min(12, 3 + Math.abs(a) * 0.28), ms: 420 + Math.abs(a) * 9 },
        { from: [pick, wide], to: [back, wide - lane * 4], h: 0, ms: 260 + Math.abs(pick - back) * 14 },
      ];
    }
    case "S":
      return [
        { from: [los - 1, MID], to: [los - 6, MID], h: 0, ms: 280 },
        { from: [los - 6, MID], to: [clampX(los + Math.min(yards, -1)), MID + lane * 2], h: 0, ms: 360 },
      ];
    case "F":
      return [
        { from: [los - 2, MID], to: [clampX(los + yards), MID + lane * 3], h: 0, ms: 260 + Math.abs(yards) * 14 },
        { from: [clampX(los + yards), MID + lane * 3], to: [clampX(los + yards - 2), MID + lane * 7], h: 2, ms: 300 },
      ];
    case "G": case "g": case "X": case "x": {
      const spot = los - 7;
      const miss = kind === "g" || kind === "x";
      return [
        { from: [los, MID], to: [spot, MID], h: 0, ms: 220 },
        { from: [spot, MID], to: [miss ? W - 1 : W - 0.5, miss ? MID + lane * 9 : MID], h: 14, ms: 650 + yl * 6 },
      ];
    }
    case "B":
      return [
        { from: [los, MID], to: [los - 7, MID], h: 0, ms: 220 },
        { from: [los - 7, MID], to: [clampX(los - 2), MID + lane * 4], h: 3, ms: 300, fall: true },
      ];
    case "K":
      return [
        { from: [clampX(los), MID], to: [104, MID + lane * 6], h: 16, ms: 700 },
        { from: [104, MID + lane * 6], to: [7, MID - lane * 5], h: 0, ms: 1100 },
      ];
    case "Y":
      return [{ from: [los - 2, MID], to: [6, MID + lane * 3], h: 0, ms: 520 }];
    case "2":
      return [{ from: [los - 3, MID], to: [112, MID + lane * 4], h: 0, ms: 520 }];
    default: // "R"
      return [{ from: [los - 3, MID], to: [clampX(end(los + yards)), MID + lane * (2 + (seed % 5))], h: 0, ms: 260 + Math.abs(yards) * 16 }];
  }
}

/** How long a play's replay takes, before speed-up. */
export function playDuration(field: Field) {
  return playPath(field, 0).reduce((t, s) => t + s.ms, 0);
}

export function callFor(field: Field): string | null {
  const [, , yards, kind, , , , td] = field;
  if (kind === "I") return td ? "Pick six" : "Interception";
  if (kind === "K") return "Return TD";
  if (td) return "Touchdown";
  if (kind === "F") return "Fumble";
  if (kind === "G" || kind === "X") return "It's good";
  if (kind === "g" || kind === "x") return "No good";
  if (kind === "B") return "Blocked";
  if (kind === "Y") return "Safety";
  if (kind === "2") return "Two-point";
  if (kind === "S") return "Sack";
  if (Math.abs(yards) >= 25) return `${yards}-yard gain`;
  return null;
}

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export function PlayFieldView({ field, game, side, playKey, speed, reduced, onLanded }: {
  field: Field | null;
  game: string;
  side: "you" | "champ";
  playKey: string;
  speed: number;
  reduced: boolean;
  onLanded?: (playKey: string) => void;
}) {
  const [ball, setBall] = useState<{ x: number; y: number; h: number; gone: boolean }>({ x: 60, y: MID, h: 0, gone: false });
  const [trail, setTrail] = useState<[number, number][]>([]);
  const [call, setCall] = useState<string | null>(null);
  const frame = useRef(0);
  const landed = useRef(onLanded);
  landed.current = onLanded;
  const seed = useMemo(() => [...playKey].reduce((t, ch) => (t * 31 + ch.charCodeAt(0)) >>> 0, 7), [playKey]);

  useEffect(() => {
    cancelAnimationFrame(frame.current);
    setCall(null);
    if (!field) return;
    const segs = playPath(field, seed);
    const total = segs.reduce((t, s) => t + s.ms, 0);
    const finish = () => {
      const last = segs[segs.length - 1];
      setBall({ x: last.to[0], y: last.to[1], h: 0, gone: !!last.fall });
      setTrail(segs.map((s) => s.to));
      setCall(callFor(field));
      landed.current?.(playKey);
    };
    if (reduced) { finish(); return; }
    setTrail([segs[0].from]);
    const start = performance.now();
    const tick = (now: number) => {
      let t = (now - start) * speed;
      if (t >= total) { finish(); return; }
      let i = 0;
      while (i < segs.length - 1 && t > segs[i].ms) { t -= segs[i].ms; i++; }
      const s = segs[i];
      const k = ease(Math.min(1, t / s.ms));
      const x = s.from[0] + (s.to[0] - s.from[0]) * k;
      const y = s.from[1] + (s.to[1] - s.from[1]) * k;
      const h = s.h * 4 * k * (1 - k);
      setBall({ x, y, h, gone: !!s.fall && k > 0.9 });
      setTrail((tr) => (tr.length && Math.hypot(tr[tr.length - 1][0] - x, tr[tr.length - 1][1] - y) < 1.2 ? tr : [...tr, [x, y]]));
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [field, seed, speed, reduced, playKey]);

  if (!field) return null;
  const [offense, yl, , kind, , down, togo] = field;
  const [away, home] = game.split("@");
  const defense = offense === away ? home : away;
  const los = 110 - yl;
  const firstDown = togo && !"GgXxKB".includes(kind) && los + togo < 110 ? los + togo : null;
  const color = side === "you" ? "#6fc596" : "#e3c98f";
  const situation = "GgXx".includes(kind)
    ? `${offense} kicking${"Gg".includes(kind) ? ` · ${yl + 17}-yard try` : ""}`
    : `${offense} ball · ${downLabel(down, togo, yl)}${down ? " at " : ""}${spotLabel(offense, defense ?? "", yl)}`;

  return (
    <div className="pf">
      <div className="pf-head">
        <span>{game}</span>
        <b>{situation}</b>
      </div>
      <svg className="pf-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <rect x="0" y="0" width={W} height={H} fill="#2f6b3a" />
        {Array.from({ length: 10 }, (_, i) => <rect key={i} x={10 + i * 10} y="0" width="5" height={H} fill="#2b6335" />)}
        <rect x="0" y="0" width="10" height={H} fill="#24452c" />
        <rect x="110" y="0" width="10" height={H} fill="#24452c" />
        {Array.from({ length: 21 }, (_, i) => <line key={i} x1={10 + i * 5} x2={10 + i * 5} y1="0" y2={H} stroke="#f1efe8" strokeOpacity={i % 2 ? 0.25 : 0.5} strokeWidth="0.35" />)}
        {[10, 20, 30, 40, 50, 40, 30, 20, 10].map((n, i) => (
          <text key={i} x={20 + i * 10} y={H - 4} fill="#f1efe8" fillOpacity="0.55" fontSize="4" textAnchor="middle" fontWeight="700">{n}</text>
        ))}
        <text x="5" y={MID} fill="#f1efe8" fillOpacity="0.7" fontSize="4.2" fontWeight="800" textAnchor="middle" transform={`rotate(-90 5 ${MID})`} letterSpacing="0.6">{offense}</text>
        <text x="115" y={MID} fill="#f1efe8" fillOpacity="0.7" fontSize="4.2" fontWeight="800" textAnchor="middle" transform={`rotate(90 115 ${MID})`} letterSpacing="0.6">{defense}</text>
        <line x1={W - 0.6} x2={W - 0.6} y1={MID - 9} y2={MID + 9} stroke="#f2d24b" strokeWidth="0.9" />
        <line x1={los} x2={los} y1="0" y2={H} stroke="#5aa9ff" strokeWidth="0.7" />
        {firstDown ? <line x1={firstDown} x2={firstDown} y1="0" y2={H} stroke="#f2d24b" strokeWidth="0.7" /> : null}
        {trail.length > 1 ? (
          <polyline points={trail.map((p) => p.join(",")).join(" ")} fill="none" stroke={color} strokeWidth="0.9" strokeDasharray="1.6 1.2" strokeLinecap="round" />
        ) : null}
        <ellipse cx={ball.x} cy={ball.y + 0.6} rx={1.6 - Math.min(ball.h, 12) * 0.06} ry={0.8} fill="#000" opacity={ball.gone ? 0 : 0.35} />
        <g transform={`translate(${ball.x} ${ball.y - ball.h * 0.45})`} opacity={ball.gone ? 0.25 : 1}>
          <ellipse rx={1.9 + ball.h * 0.04} ry={1.15 + ball.h * 0.025} fill="#7a4a24" stroke="#fff" strokeWidth="0.3" />
          <line x1="-0.8" x2="0.8" y1="0" y2="0" stroke="#fff" strokeWidth="0.25" />
        </g>
      </svg>
      {call ? <span key={playKey} className={`pf-call pf-call-${side}${/Touchdown|Pick six|Return TD/.test(call) ? " is-td" : ""}`}>{call}</span> : null}
    </div>
  );
}

export const playFieldCss = `
  .pf { position: relative; margin-top: 0.6rem; }
  .pf-head { display: flex; justify-content: space-between; gap: 0.6rem; font-size: 0.72rem; color: #c4bcab; margin-bottom: 4px; }
  .pf-head b { color: #eee9dd; font-weight: 700; text-align: right; }
  .pf-svg { display: block; width: 100%; aspect-ratio: 120 / 53.3; border-radius: 4px; }
  .pf-call { position: absolute; left: 50%; top: 58%; transform: translate(-50%, -50%); font: 900 clamp(1rem, 5.5vw, 1.6rem) var(--font-body);
    letter-spacing: 0.1em; text-transform: uppercase; color: #fff; padding: 0.15rem 0.7rem; white-space: nowrap; text-shadow: 0 2px 0 #0008;
    animation: call-in 1.2s ease-out both; pointer-events: none; }
  .pf-call-you { background: #2f6b4fd9; } .pf-call-champ { background: #8f7440d9; }
  .pf-call.is-td { font-size: clamp(1.3rem, 7.5vw, 2.1rem); }
  @keyframes call-in { 0% { transform: translate(-50%, -50%) scale(1.7); opacity: 0; } 18% { transform: translate(-50%, -50%) scale(1); opacity: 1; } 78% { opacity: 1; } 100% { opacity: 0; } }
  @media (prefers-reduced-motion: reduce) { .pf-call { animation: none; } }
`;
