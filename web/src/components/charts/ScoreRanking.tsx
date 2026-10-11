import { OwnerLink } from "../primitives";
export function ScoreRanking({rows, mean, caption}: {rows: {id:string;name:string;score:number}[];mean:number;caption:string}) {
  const sorted=[...rows].sort((a,b)=>b.score-a.score);
  const max=Math.ceil(Math.max(mean,...rows.map(r=>r.score),1)/25)*25;
  return <figure style={{margin:'1rem 0'}}>
    <figcaption className="figure-label">{caption} · Vertical tick: league average ({mean.toFixed(1)}) · Scale: 0–{max} points</figcaption>
    {sorted.map(row=><div className="score-rank" key={row.id}>
      <OwnerLink ownerId={row.id}>{row.name}</OwnerLink>
      <div className="score-rank-track" role="img" aria-label={`${row.name}: ${row.score.toFixed(1)} points; league average ${mean.toFixed(1)}`}>
        <span style={{width:`${row.score/max*100}%`,background:row.score>=mean?'var(--ember)':'#a88572'}}/>
        <i style={{left:`${mean/max*100}%`}}/>
      </div><b>{row.score.toFixed(1)}</b>
    </div>)}
    <style>{`.score-rank{display:grid;grid-template-columns:minmax(10rem,16rem) minmax(0,1fr) 3.5rem;gap:1rem;align-items:center;padding:.65rem 0;border-bottom:1px solid var(--rule-soft);font-size:.82rem}.score-rank>a{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.score-rank>b{text-align:right;font-weight:500}.score-rank-track{height:10px;position:relative;background:var(--rule-soft)}.score-rank-track>span{display:block;height:100%}.score-rank-track>i{position:absolute;top:-4px;height:18px;width:1px;background:var(--ink)}@media(max-width:600px){.score-rank{grid-template-columns:minmax(7rem,1fr) minmax(0,1fr) 3rem;gap:.5rem;font-size:.73rem}}`}</style>
  </figure>;
}
