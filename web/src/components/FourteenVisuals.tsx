import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

// Animated pieces for Fourteen and Fantasy (pages/WheelBeta.tsx): the season
// wheel, the team slot reel, the week-by-week score bars, the verdict stamp
// and a short confetti burst. Everything respects prefers-reduced-motion.

const INKS = ["#193b48", "#324c42", "#603d46", "#3d4059", "#624830", "#202c30"];
const GOLD = "#c5a76a";

export function buzz(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* not supported */
  }
}

/** Point on a circle, 0 degrees at 12 o'clock, clockwise. */
function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

function WheelFace({ labels, size }: { labels: string[]; size: number }) {
  const n = Math.max(labels.length, 1);
  const step = 360 / n;
  const c = size / 2;
  const r = c - 4;
  return (
    <>
      {labels.map((label, i) => {
        const [x1, y1] = polar(c, c, r, i * step);
        const [x2, y2] = polar(c, c, r, (i + 1) * step);
        const [tx, ty] = polar(c, c, r * 0.68, (i + 0.5) * step);
        return (
          <g key={label}>
            <path
              d={`M${c},${c} L${x1},${y1} A${r},${r} 0 ${step > 180 ? 1 : 0} 1 ${x2},${y2} Z`}
              fill={INKS[i % INKS.length]}
              stroke={GOLD}
              strokeWidth={1}
            />
            {size >= 120 ? (
              <text
                x={tx}
                y={ty}
                fill="#eee9dd"
                fontSize={size * 0.085}
                fontWeight={700}
                textAnchor="middle"
                dominantBaseline="central"
                transform={`rotate(${(i + 0.5) * step} ${tx} ${ty})`}
                style={{ fontFamily: "var(--font-display)" }}
              >
                ’{label.slice(-2)}
              </text>
            ) : null}
          </g>
        );
      })}
      <circle cx={c} cy={c} r={r} fill="none" stroke={GOLD} strokeWidth={3} />
      <circle cx={c} cy={c} r={size * 0.14} fill="#eee9dd" stroke={GOLD} strokeWidth={2} />
      {size >= 120 ? (
        <text x={c} y={c} fontSize={size * 0.05} fontWeight={700} textAnchor="middle" dominantBaseline="central" fill="#202c30" letterSpacing="0.08em">
          FFBFFL
        </text>
      ) : null}
    </>
  );
}

/**
 * The season wheel. Spins while the season loads, decelerates onto `value`,
 * then folds into a compact header once it has settled.
 */
export function SeasonWheel({ years, value, caption, active, reduced, onSettled }: {
  years: string[]; value: string | null; caption: string; active: boolean; reduced: boolean; onSettled: () => void;
}) {
  const sorted = useMemo(() => [...years].sort(), [years]);
  const step = 360 / Math.max(sorted.length, 1);
  const [angle, setAngle] = useState(0);
  const [landed, setLanded] = useState(!active);
  const settle = useRef(onSettled);
  settle.current = onSettled;
  const startedLanding = useRef(false);
  const fallback = useRef(0);
  const onEndRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!active || value == null || startedLanding.current) return;
    startedLanding.current = true;
    const i = Math.max(0, sorted.indexOf(value));
    // Put the middle of the winning slice under the pointer at 12 o'clock,
    // with a little jitter inside the slice so it never looks canned.
    const jitter = (Math.random() - 0.5) * step * 0.5;
    const target = 360 * 6 - (i + 0.5) * step + jitter;
    if (reduced) {
      setAngle(target);
      setLanded(true);
      settle.current();
      return;
    }
    requestAnimationFrame(() => setAngle(target));
    // If the browser skips the transition (hidden tab), land anyway.
    fallback.current = window.setTimeout(() => onEndRef.current(), 3400);
  }, [active, value, reduced, sorted, step]);
  useEffect(() => () => window.clearTimeout(fallback.current), []);

  onEndRef.current = onEnd;
  function onEnd() {
    window.clearTimeout(fallback.current);
    if (landed || value == null) return;
    setLanded(true);
    buzz(15);
    window.setTimeout(() => settle.current(), 650);
  }

  if (!active && landed) {
    return (
      <div className="wheel-compact">
        <svg viewBox="0 0 56 56" width={56} height={56} aria-hidden="true" style={{ transform: `rotate(${angle}deg)` }}>
          <WheelFace labels={sorted} size={56} />
        </svg>
        <div>
          <span className="wheel-compact-year">{value}</span>
          <span className="wheel-compact-caption">{caption}</span>
        </div>
      </div>
    );
  }

  const spinning = value == null && !reduced;
  return (
    <div className={`wheel-stage${landed ? " is-landed" : ""}`} aria-live="polite">
      <div className="wheel-box">
        <svg className="wheel-pointer" viewBox="0 0 30 26" aria-hidden="true"><path d="M15 26 L0 0 H30 Z" fill={GOLD} stroke="#202c30" strokeWidth="2" /></svg>
        <svg
          className={`wheel-disc${spinning ? " is-idle" : ""}`}
          viewBox="0 0 240 240"
          aria-hidden="true"
          style={spinning ? undefined : { transform: `rotate(${angle}deg)`, transition: reduced ? "none" : "transform 3s cubic-bezier(.12,.72,.12,1)" }}
          onTransitionEnd={onEnd}
        >
          <WheelFace labels={sorted} size={240} />
        </svg>
      </div>
      <div className="wheel-readout">
        <span className="wheel-year">{landed ? value : "…"}</span>
        <span className="wheel-caption">{landed ? caption : "Spinning for a season"}</span>
      </div>
    </div>
  );
}

/** A one-line slot reel that rolls through team names and lands on `value`. */
export function SlotReel({ names, value, reduced, onLanded }: { names: string[]; value: string; reduced: boolean; onLanded: () => void }) {
  const strip = useMemo(() => {
    if (reduced) return [value];
    const pool = names.filter(Boolean);
    const out: string[] = [];
    for (let i = 0; i < 16; i++) out.push(pool[Math.floor(Math.random() * pool.length)] ?? value);
    out.push(value);
    return out;
  }, [names, value, reduced]);
  const [offset, setOffset] = useState(0);
  const landed = useRef(onLanded);
  landed.current = onLanded;
  const done = useRef(false);

  useLayoutEffect(() => {
    if (reduced || strip.length === 1) {
      done.current = true;
      landed.current();
      return;
    }
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setOffset(strip.length - 1)));
    const timer = window.setTimeout(() => finish(), 1500);
    return () => { cancelAnimationFrame(id); window.clearTimeout(timer); };
  }, [strip, reduced]);

  function finish() {
    if (done.current) return;
    done.current = true;
    buzz(8);
    landed.current();
  }

  return (
    <div className="reel" aria-label={value}>
      <div
        className="reel-strip"
        aria-hidden="true"
        style={{ transform: `translateY(calc(${-offset} * var(--reel-h)))`, transition: offset ? "transform 1.15s cubic-bezier(.2,.85,.22,1)" : "none" }}
        onTransitionEnd={finish}
      >
        {strip.map((name, i) => (
          <span key={i} className={i === strip.length - 1 ? "reel-final" : ""}>{name}</span>
        ))}
      </div>
    </div>
  );
}

/** Two racing bars for one week: you on top, the champ below, scores at the end. */
export function WeekBars({ you, champ, max, on, youText, champText }: {
  you: number; champ: number | null; max: number; on: boolean; youText: string; champText: string;
}) {
  const pct = (v: number | null) => (on && v != null && max > 0 ? Math.max(2, (v / max) * 100) : 0);
  return (
    <span className="bars">
      <span className="bar-line"><span className="bar-track"><span className="bar bar-you" style={{ width: `${pct(you)}%` }} /></span><b>{on ? youText : ""}</b></span>
      <span className="bar-line"><span className="bar-track"><span className="bar bar-champ" style={{ width: `${pct(champ)}%` }} /></span><span>{on ? champText : ""}</span></span>
    </span>
  );
}

/** The big rubber-stamp verdict at the top of the results. */
export function VerdictStamp({ wins, losses, weeks, reduced }: { wins: number; losses: number; weeks: number; reduced: boolean }) {
  const perfect = wins === weeks;
  const text = perfect ? "Perfect season" : wins > losses ? "Champ dethroned" : wins < losses ? "The champ holds" : "Dead even";
  const tone = perfect || wins > losses ? "win" : wins < losses ? "loss" : "even";
  return <div id="verdict" className={`stamp stamp-${tone}${reduced ? " stamp-still" : ""}`} role="status">{text}</div>;
}

/** A short burst of league-colored confetti. Unmounts itself. */
export function Confetti({ fire, reduced }: { fire: boolean; reduced: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    if (fire && !reduced) setLive(true);
  }, [fire, reduced]);

  useEffect(() => {
    if (!live) return;
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    el.width = w * dpr;
    el.height = h * dpr;
    ctx.scale(dpr, dpr);
    const colors = [GOLD, "#eee9dd", "#2f6b4f", "#a8453a", "#193b48", "#d8b975"];
    const bits = Array.from({ length: 150 }, (_, i) => ({
      x: w / 2 + (Math.random() - 0.5) * w * 0.3,
      y: h * 0.35,
      vx: (Math.random() - 0.5) * 13,
      vy: -Math.random() * 13 - 4,
      size: 5 + Math.random() * 6,
      spin: Math.random() * Math.PI,
      vs: (Math.random() - 0.5) * 0.3,
      color: colors[i % colors.length],
    }));
    const start = performance.now();
    let frame = 0;
    const draw = (now: number) => {
      const t = now - start;
      ctx.clearRect(0, 0, w, h);
      for (const b of bits) {
        b.vy += 0.32;
        b.vx *= 0.99;
        b.x += b.vx;
        b.y += b.vy;
        b.spin += b.vs;
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - t / 2600);
        ctx.translate(b.x, b.y);
        ctx.rotate(b.spin);
        ctx.fillStyle = b.color;
        ctx.fillRect(-b.size / 2, -b.size / 4, b.size, b.size / 2);
        ctx.restore();
      }
      if (t < 2600) frame = requestAnimationFrame(draw);
      else setLive(false);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [live]);

  return live ? <canvas ref={canvas} className="confetti" aria-hidden="true" /> : null;
}

export const visualsCss = `
  .wheel-stage { margin-top: 1.4rem; border-top: 3px solid var(--ink); padding-top: 1rem; display: flex; flex-direction: column; align-items: center; gap: 0.8rem; }
  .wheel-box { position: relative; width: min(72vw, 260px); aspect-ratio: 1; }
  .wheel-disc { width: 100%; height: 100%; display: block; filter: drop-shadow(0 6px 14px #0003); }
  .wheel-disc.is-idle { animation: wheel-idle 0.9s linear infinite; }
  @keyframes wheel-idle { to { transform: rotate(360deg); } }
  .wheel-pointer { position: absolute; top: -10px; left: 50%; width: 30px; transform: translateX(-50%); z-index: 2; filter: drop-shadow(0 2px 2px #0004); }
  .wheel-stage.is-landed .wheel-pointer { animation: pointer-tick 0.35s ease-out; }
  @keyframes pointer-tick { 30% { transform: translateX(-50%) rotate(-14deg); } }
  .wheel-readout { text-align: center; min-height: 5.5rem; }
  .wheel-year { display: block; font-family: var(--font-display); font-weight: 700; font-size: clamp(2.6rem, 12vw, 4rem); line-height: 1; font-variant-numeric: tabular-nums; }
  .wheel-stage.is-landed .wheel-year { animation: year-pop 0.45s cubic-bezier(.3,1.6,.5,1); }
  @keyframes year-pop { from { transform: scale(0.4); opacity: 0; } }
  .wheel-caption { display: block; font-size: 0.92rem; color: var(--ink-soft); max-width: 24rem; margin-top: 0.35rem; line-height: 1.35; }
  .wheel-compact { margin-top: 1.2rem; border-top: 3px solid var(--ink); padding-top: 0.7rem; display: flex; align-items: center; gap: 0.8rem; }
  .wheel-compact svg { flex: none; }
  .wheel-compact-year { display: block; font-family: var(--font-display); font-weight: 700; font-size: 1.9rem; line-height: 1; }
  .wheel-compact-caption { display: block; font-size: 0.82rem; color: var(--ink-soft); line-height: 1.3; margin-top: 0.15rem; }
  .reel { --reel-h: 2.7rem; height: var(--reel-h); overflow: hidden; position: relative;
    mask-image: linear-gradient(transparent, #000 22%, #000 78%, transparent); -webkit-mask-image: linear-gradient(transparent, #000 22%, #000 78%, transparent); }
  .reel-strip { display: flex; flex-direction: column; will-change: transform; }
  .reel-strip > span { height: var(--reel-h); line-height: var(--reel-h); font-family: var(--font-display); font-weight: 700;
    font-size: clamp(1.3rem, 5.6vw, 2rem); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--ink-faint); }
  .reel-strip > span.reel-final { color: var(--ink); }
  .lineup li.lineup-full { animation: slot-pop 0.5s cubic-bezier(.3,1.5,.5,1); }
  @keyframes slot-pop { 0% { transform: scale(0.85); background: ${GOLD}; } 60% { background: #e9d9b0; } }
  .bars { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .bar-line { display: grid; grid-template-columns: 1fr 3.6rem; gap: 0.5rem; align-items: center; font-size: 0.86rem; font-variant-numeric: tabular-nums; }
  .bar-line > :last-child { text-align: right; }
  .bar-line > span:last-child { color: var(--ink-soft); }
  .bar-track { display: block; min-width: 0; }
  .bar { display: block; height: 7px; width: 0; transition: width 0.55s cubic-bezier(.2,.8,.25,1); }
  .bar-you { background: var(--ink); }
  .bar-champ { background: ${GOLD}; transition-delay: 0.08s; }
  .tick-w .bar-you { background: var(--pos); }
  .record-bump { display: inline-block; animation: bump 0.3s ease-out; }
  @keyframes bump { 40% { transform: scale(1.12); } }
  .stamp { display: inline-block; margin: 0.4rem 0 0.6rem; padding: 0.35rem 0.8rem; border: 3px solid currentColor; font: 800 clamp(1.1rem, 5vw, 1.6rem) var(--font-body);
    text-transform: uppercase; letter-spacing: 0.08em; transform: rotate(-4deg); animation: stamp-in 0.5s cubic-bezier(.3,1.4,.5,1) both; }
  .stamp-win { color: var(--pos); } .stamp-loss { color: var(--neg); } .stamp-even { color: var(--ink-soft); }
  .stamp-still { animation: none; }
  @keyframes stamp-in { from { transform: rotate(-4deg) scale(2.4); opacity: 0; } 70% { opacity: 1; } }
  .confetti { position: fixed; inset: 0; width: 100vw; height: 100vh; pointer-events: none; z-index: 60; }
  @media (prefers-reduced-motion: reduce) {
    .wheel-disc.is-idle, .lineup li.lineup-full, .record-bump, .wheel-stage.is-landed .wheel-year, .wheel-stage.is-landed .wheel-pointer { animation: none; }
    .bar { transition: none; }
  }
`;
