import { useState } from "react";
import { Band, Metric, OwnerLink, WeekLink } from "./primitives";
import { gameTypeLabel, points, signed } from "../lib/format";
import type { OwnerPayload } from "../lib/types";

type Game = OwnerPayload["weekly_history"][number];
const key = (game: Game) => game.matchup_id || `${game.season}-${game.week}`;
const ink = (game: Game) => game.result === "W" ? "var(--ember)" : game.result === "L" ? "#a88572" : "var(--ink-faint)";

/** Each season is a trace of actual games, with a shared week axis and value scale. */
export function OwnerCareerAtlas({ owner, year, setYear, selected, setSelected }: {
  owner: OwnerPayload; year: string; setYear: (year: string) => void;
  selected: string; setSelected: (game: string) => void;
}) {
  const games = [...owner.weekly_history].sort((a,b)=>a.season-b.season || a.week-b.week || key(a).localeCompare(key(b)));
  const seasons = [...new Set(games.map(g=>g.season))];
  const [mode,setMode] = useState<"margin"|"score">("margin");
  const visible = games.filter(g=>year === "all" || String(g.season) === year);
  const active = visible.find(g=>key(g)===selected) ?? visible[visible.length-1];
  if (!games.length || !active) return null;
  const maxWeek = Math.max(1,...visible.map(g=>g.week));
  const limit = mode === "margin"
    ? Math.max(10,Math.ceil(Math.max(...games.map(g=>Math.abs(g.score-g.opponent_score)))/10)*10)
    : Math.max(50,Math.ceil(Math.max(...games.map(g=>g.score))/50)*50);
  const x = (g: Game) => 30+(g.week-1)*620/Math.max(1,maxWeek-1);
  const y = (g: Game) => mode === "margin" ? 43-(g.score-g.opponent_score)/limit*32 : 77-g.score/limit*64;
  const seasonGames = games.filter(g=>g.season===active.season);
  const wins = seasonGames.filter(g=>g.result==='W').length;
  const losses = seasonGames.filter(g=>g.result==='L').length;
  const ties = seasonGames.length-wins-losses;
  const avg = seasonGames.reduce((sum,g)=>sum+g.score,0)/seasonGames.length;
  const position = visible.indexOf(active);
  function move(offset:number) { const next=visible[Math.max(0,Math.min(visible.length-1,position+offset))]; setSelected(key(next)); }
  return <section className="career-atlas" aria-label={`${owner.name} interactive career atlas`}>
    <Band title="Career atlas" note={<Metric name="career_atlas">Explore every game</Metric>} />
    <div className="atlas-controls">
      <div className="pill-row" role="group" aria-label="Chart measure">
        <button className="pill" aria-pressed={mode==='margin'} onClick={()=>setMode('margin')}>Winning margin</button>
        <button className="pill" aria-pressed={mode==='score'} onClick={()=>setMode('score')}>Points scored</button>
      </div>
      <label>Season <select className="select" value={year} onChange={e=>{setYear(e.target.value);const filtered=games.filter(g=>e.target.value==='all'||String(g.season)===e.target.value);setSelected(key(filtered[filtered.length-1]));}}>
        <option value="all">Full career</option>{seasons.map(s=><option key={s} value={s}>{s}</option>)}
      </select></label>
    </div>
    <div className="atlas-key"><span><i style={{background:'var(--ember)'}}/> Win</span><span><i style={{background:'#a88572'}}/> Loss</span><span>Ring: playoff game</span><span>{mode==='margin'?`Scale: −${limit} to +${limit}`:`Scale: 0–${limit}`} pts</span></div>
    <div className="atlas-layout">
      <div className={`atlas-traces${maxWeek>10?" atlas-traces-wide":""}`}>
        <div className="atlas-axis"><span>Week</span><svg viewBox="0 0 680 18" aria-hidden="true">{Array.from({length:maxWeek},(_,i)=><text key={i} x={30+i*620/Math.max(1,maxWeek-1)} y="12" textAnchor="middle">{i+1}</text>)}</svg></div>
        {seasons.filter(s=>year==='all'||String(s)===year).map(season=>{
          const row=games.filter(g=>g.season===season);
          const title=owner.seasons_detail.find(s=>s.season===season)?.is_champion;
          return <div className={`atlas-season${season===active.season?' atlas-season-active':''}`} key={season}>
            <button className="atlas-year" onClick={()=>setSelected(key(row[row.length-1]))} aria-label={`Select ${season} season`} aria-pressed={season===active.season}>{season}{title?<small>CHAMPION</small>:null}</button>
            <svg viewBox="0 0 680 88" className="atlas-lane" aria-label={`${season} games`}>
              <line x1="20" x2="660" y1={mode==='margin'?43:77} y2={mode==='margin'?43:77} stroke="var(--rule)" strokeDasharray="2 4"/>
              {row.map((g,i)=>i && g.week-row[i-1].week===1?<line key={`line-${key(g)}`} x1={x(row[i-1])} y1={y(row[i-1])} x2={x(g)} y2={y(g)} stroke="var(--rule)" strokeWidth="1.5"/>:null)}
              {row.map(g=><g key={key(g)}>
                {key(g)===key(active)?<line x1={x(g)} x2={x(g)} y1="6" y2="82" stroke="var(--ink)" opacity=".2"/>:null}
                <circle cx={x(g)} cy={y(g)} r={key(g)===key(active)?8: g.game_type==='playoff'?6:4} fill={ink(g)} stroke={g.game_type==='playoff'?'var(--ink)':'var(--paper)'} strokeWidth={g.game_type==='playoff'?2:1}/>
                <circle className="atlas-hit" cx={x(g)} cy={y(g)} r="13" fill="transparent" role="button" tabIndex={0}
                  aria-label={`${season} week ${g.week}: ${g.result}, ${points(g.score)} to ${points(g.opponent_score)} against ${g.opponent_team_name}`}
                  aria-pressed={key(g)===key(active)} onClick={()=>setSelected(key(g))} onFocus={()=>setSelected(key(g))}
                  onKeyDown={e=>{if(['ArrowLeft','ArrowRight','Enter',' '].includes(e.key)){e.preventDefault();if(e.key==='ArrowLeft')move(-1);else if(e.key==='ArrowRight')move(1);else setSelected(key(g));}}}/>
              </g>)}
            </svg>
          </div>;
        })}
      </div>
      <aside className="atlas-detail" aria-live="polite" aria-atomic="true">
        <div className="section-kicker">{active.season} / Week {active.week} / {gameTypeLabel(active.game_type)}</div>
        <h3>{active.team_name}</h3>
        <div className="atlas-score"><span style={{color:ink(active)}}>{points(active.score,1)}</span><span>–</span><span>{points(active.opponent_score,1)}</span></div>
        <p className="atlas-opponent">{active.result==='W'?'Beat':active.result==='L'?'Lost to':'Tied'} <OwnerLink ownerId={active.opponent_owner_id}>{active.opponent_team_name}</OwnerLink></p>
        <div className="atlas-margin"><span>{signed(active.score-active.opponent_score,2)}</span><Metric name="winning_margin">point margin</Metric></div>
        <div className="atlas-season-stats"><div><b>{wins}–{losses}{ties?`–${ties}`:''}</b><span>{active.season} record</span></div><div><b>{points(avg,1)}</b><span>Points / game</span></div></div>
        <div className="figure-label">All recorded games in this season</div>
        <div className="atlas-detail-nav"><button className="pill" aria-label="Previous game" disabled={position===0} onClick={()=>move(-1)}>←</button><WeekLink season={active.season} week={active.week}>Open week</WeekLink><button className="pill" aria-label="Next game" disabled={position===visible.length-1} onClick={()=>move(1)}>→</button></div>
      </aside>
    </div>
    <style>{`
      .atlas-controls{display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap;margin:1.1rem 0}.atlas-controls .pill-row{margin:0}.atlas-controls label{font-size:.8rem;display:flex;gap:.6rem;align-items:center}
      .atlas-key{display:flex;gap:1.1rem;flex-wrap:wrap;color:var(--ink-faint);font-size:.7rem;margin-bottom:1rem}.atlas-key span{display:flex;align-items:center;gap:.3rem}.atlas-key i{width:6px;height:6px;border-radius:50%}
      .atlas-layout{display:grid;grid-template-columns:minmax(0,1fr) 17rem;gap:2rem;align-items:start}.atlas-traces{min-width:0}.atlas-axis,.atlas-season{display:grid;grid-template-columns:4.4rem minmax(0,1fr);align-items:center}.atlas-axis{color:var(--ink-faint);font-size:.65rem}.atlas-axis svg{width:100%;fill:var(--ink-faint);font-size:10px}.atlas-season{border-bottom:1px solid var(--rule-soft)}.atlas-season-active{background:var(--paper-deep)}
      .atlas-year{background:none;border:0;text-align:left;color:var(--ink-faint);font:600 1rem var(--font-display);cursor:pointer;padding:.4rem}.atlas-season-active .atlas-year{color:var(--ink)}.atlas-year small{display:block;font:600 .45rem var(--font-body);letter-spacing:.06em;color:var(--ember);margin-top:.3rem}.atlas-lane{width:100%;display:block;overflow:visible}.atlas-hit{cursor:pointer}.atlas-hit:focus-visible{outline:none;stroke:var(--ink);stroke-width:1.5}
      .atlas-detail{border-top:3px solid var(--ink);background:var(--paper-deep);padding:1rem;position:sticky;top:6rem}.atlas-detail .section-kicker{font-size:.6rem}.atlas-detail h3{font-size:1.4rem;line-height:1.15;overflow-wrap:anywhere}.atlas-score{display:flex;align-items:baseline;gap:.6rem;font:600 2.2rem var(--font-display);margin:1.2rem 0 .4rem}.atlas-score>span:nth-child(2){font-size:1.3rem;color:var(--ink-faint)}.atlas-opponent{font-size:.8rem;min-height:2.5rem}.atlas-margin{display:flex;align-items:baseline;gap:.5rem;border-top:1px solid var(--rule);padding-top:.8rem}.atlas-margin>span{font:600 1.7rem var(--font-display)}.atlas-margin>a{font-size:.7rem;color:var(--ink-faint)}
      .atlas-season-stats{display:grid;grid-template-columns:1fr 1fr;gap:.5rem;margin:1.1rem 0 .5rem}.atlas-season-stats b{font:600 1.25rem var(--font-display)}.atlas-season-stats span{display:block;font-size:.68rem;color:var(--ink-faint)}.atlas-detail>.figure-label{font-size:.62rem}.atlas-detail-nav{display:flex;justify-content:space-between;align-items:center;gap:.5rem;margin-top:1.1rem;font-size:.75rem}.atlas-detail-nav button:disabled{opacity:.35;cursor:default}
      @media(max-width:760px){.atlas-traces:not(.atlas-traces-wide) .atlas-axis svg{font-size:20px}.atlas-traces-wide{overflow-x:auto}.atlas-traces-wide>.atlas-axis,.atlas-traces-wide>.atlas-season{min-width:680px}.atlas-layout{grid-template-columns:1fr;gap:1rem}.atlas-detail{position:static}.atlas-lane{min-height:55px}.atlas-axis,.atlas-season{grid-template-columns:3.2rem minmax(0,1fr)}.atlas-year{font-size:.85rem}.atlas-detail h3{font-size:1.2rem}.atlas-score{margin:.6rem 0}.atlas-opponent{min-height:0}.atlas-key{gap:.65rem}}
    `}</style>
  </section>;
}
