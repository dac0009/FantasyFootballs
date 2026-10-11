import { Metric, OwnerLink } from "./primitives";
interface Week { week: number; diff: number; beat: boolean; won: boolean; tied: boolean }
interface TeamRow { ownerId: string; name: string; record: string; weeks: Week[]; beats: number; total: number; aboveRecord: string }

/** Small multiples use one shared scale; no expanding tiles or hidden result ticks. */
export function AboveAverageGrid({rows}: {rows: TeamRow[]}) {
  const weeks = [...new Set(rows.flatMap(row=>row.weeks.map(w=>w.week)))].sort((a,b)=>a-b);
  if (!weeks.length) return <p>No completed weeks yet.</p>;
  const limit = Math.ceil(Math.max(10,...rows.flatMap(row=>row.weeks.map(w=>Math.abs(w.diff))))/10)*10;
  const step = 264/weeks.length;
  return <div>
    <p className="figure-label"><Metric name="weekly_scoring">Versus weekly average</Metric> · Scale: ±{limit} pts · W/L/T: result</p>
    <div className="weekly-multiples">{rows.map(row=><section className="weekly-mini" key={row.ownerId}>
      <div className="weekly-mini-head"><OwnerLink ownerId={row.ownerId}>{row.name}</OwnerLink><span>{row.record}</span></div>
      <svg viewBox="0 0 300 150" role="img" aria-label={`${row.name}: ${row.weeks.map(w=>`week ${w.week}, ${w.diff.toFixed(1)} points versus average, ${w.won?'won':w.tied?'tied':'lost'}`).join('; ')}`}>
        <line x1="28" x2="296" y1="66" y2="66" stroke="var(--rule)"/>
        <text x="0" y="69" fontSize="9" fill="var(--ink-faint)">0</text>
        {row.weeks.map(w=>{const x=30+weeks.indexOf(w.week)*step, height=Math.abs(w.diff)/limit*43;
          return <g key={w.week}><rect x={x+step*.2} y={w.diff>=0?66-height:66} width={step*.6} height={Math.max(height,1)} fill={w.diff>=0?'var(--ember)':'#a88572'}/>
            <text x={x+step*.5} y={w.diff>=0?60-height:78+height} textAnchor="middle" fontSize="9" fill="var(--ink)">{w.diff>0?'+':''}{w.diff.toFixed(0)}</text>
            <text x={x+step*.5} y="135" textAnchor="middle" fontSize="9" fill="var(--ink-faint)">{w.week}</text>
            <text x={x+step*.5} y="147" textAnchor="middle" fontSize="9" fill="var(--ink)">{w.won?'W':w.tied?'T':'L'}</text></g>})}
      </svg>
    </section>)}</div>
    <style>{`.weekly-multiples{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1.2rem 2rem;margin-top:1rem}.weekly-mini{border-top:1px solid var(--rule);padding-top:.6rem;min-width:0}.weekly-mini-head{display:flex;justify-content:space-between;gap:.5rem;font-size:.8rem}.weekly-mini-head>a{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.weekly-mini-head>span{white-space:nowrap;color:var(--ink-faint)}.weekly-mini svg{display:block;width:100%;height:auto;max-height:160px}@media(max-width:800px){.weekly-multiples{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:480px){.weekly-multiples{grid-template-columns:1fr}.weekly-mini svg{max-height:145px}}`}</style>
  </div>;
}
