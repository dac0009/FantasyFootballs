import { useState, type CSSProperties, type PointerEvent } from "react";
import { useEditorial } from "./Editorial";
import { ownerInk } from "../lib/ownerInk";
import { OwnerCareerAtlas } from "./OwnerCareerAtlas";
import { Metric, OwnerLink, WeekLink } from "./primitives";
import { gameTypeLabel, ordinal, pct, points, signed, total } from "../lib/format";
import type { OwnerPayload } from "../lib/types";
import "../styles/almanac.css";

export function OwnerAlmanac({ owner }: { owner: OwnerPayload }) {
  const { documents } = useEditorial();
  const profile = documents.find(d=>d.kind==='profile' && d.key===owner.owner_id)?.body;
  const displayName = profile?.display_name || owner.name;
  const games = [...owner.weekly_history].sort((a,b)=>a.season-b.season||a.week-b.week||a.matchup_id.localeCompare(b.matchup_id));
  const [year,setYear] = useState("all");
  const [selected,setSelected] = useState(games[games.length-1]?.matchup_id ?? "");
  const [back,setBack] = useState(false);
  const visible = games.filter(g=>year==='all'||String(g.season)===year);
  const active = visible.find(g=>g.matchup_id===selected) ?? visible[visible.length-1];
  const position = active ? visible.indexOf(active) : 0;
  const season = year === 'all' ? null : owner.seasons_detail.find(s=>String(s.season)===year);
  const summary = season ?? owner;
  const initials = displayName.split(/\s+/).filter(Boolean).map(s=>s[0]).slice(0,2).join('').toUpperCase();
  const titleYears = owner.seasons_detail.filter(s=>s.is_champion).map(s=>s.season);
  const traceMax = Math.max(1,...visible.map(g=>g.score));
  const trace = visible.map((g,i)=>`${12+i/Math.max(visible.length-1,1)*336},${162-g.score/traceMax*132}`).join(' ');
  function tilt(event: PointerEvent<HTMLDivElement>) {
    if(event.pointerType !== 'mouse' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const rect=event.currentTarget.getBoundingClientRect();
    const x=(event.clientX-rect.left)/rect.width, y=(event.clientY-rect.top)/rect.height;
    event.currentTarget.style.setProperty('--tilt-x',`${(0.5-y)*7}deg`);
    event.currentTarget.style.setProperty('--tilt-y',`${(x-0.5)*9}deg`);
    event.currentTarget.style.setProperty('--light-x',`${x*100}%`);
    event.currentTarget.style.setProperty('--light-y',`${y*100}%`);
  }
  const scoreMax = active ? Math.max(active.score,active.opponent_score,1) : 1;
  function chooseYear(value: string) {
    setYear(value);
    const next=games.filter(g=>value==='all'||String(g.season)===value);
    setSelected(next[next.length-1]?.matchup_id ?? '');
  }
  function scrub(event: PointerEvent<SVGSVGElement>) {
    const rect=event.currentTarget.getBoundingClientRect();
    const fraction=((event.clientX-rect.left)/rect.width*360-12)/336;
    chooseGame(Math.round(Math.max(0,Math.min(1,fraction))*(visible.length-1)));
  }
  function chooseGame(index: number) { const game=visible[index]; if(game)setSelected(game.matchup_id); }
  return <section style={{"--card-ink":profile?.ink || ownerInk(owner.owner_id)} as CSSProperties} className="owner-almanac" aria-label={`${owner.name} owner card`}>
    <div className="almanac-folio"><span>The owners’ collection</span><span>FFBFFL / Est. 2019</span></div>
    <div className="almanac-opening">
      <div className="owner-card-wrap" onPointerMove={tilt} onPointerLeave={e=>{e.currentTarget.style.setProperty('--tilt-x','0deg');e.currentTarget.style.setProperty('--tilt-y','0deg');}}>
        <div className="card-stage">
        <div className={`owner-card${back?' owner-card-back':''}`}>
          <div className="card-face card-front" ref={node=>{if(node)node.inert=back;}} aria-hidden={back}>
          <div className="card-topline"><span>FFBFFL / Owners</span><span>{year==='all'?'Career edition':`${year} edition`}</span></div>
            <div className="card-art">
              {profile?.photo && <img className="card-portrait" src={profile.photo} alt=""/>}
              <span className="card-art-label">THE LEAGUE / PLAYER ARCHIVE</span>
              <div className="card-monogram">{initials}</div>
              <svg className="card-signature" viewBox="0 0 360 180" preserveAspectRatio="none"
                role="slider" tabIndex={visible.length ? 0 : -1} aria-label="Scoring signature game" aria-valuemin={1} aria-valuemax={Math.max(1,visible.length)} aria-valuenow={position+1}
                aria-valuetext={active ? `${active.season}, week ${active.week}: ${points(active.score,2)} points` : 'No games'}
                onPointerDown={e=>{e.stopPropagation();e.currentTarget.setPointerCapture(e.pointerId);scrub(e);}}
                onPointerMove={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId)){e.stopPropagation();scrub(e);}}}
                onKeyDown={e=>{if(['ArrowLeft','ArrowDown','ArrowRight','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();chooseGame(e.key==='Home'?0:e.key==='End'?visible.length-1:Math.max(0,Math.min(visible.length-1,position+(['ArrowLeft','ArrowDown'].includes(e.key)?-1:1))));}}}><polyline points={trace} fill="none" stroke="currentColor" strokeWidth="1.5"/>{active && <circle cx={12+position/Math.max(visible.length-1,1)*336} cy={162-active.score/traceMax*132} r="4" fill="currentColor"/>}</svg>
              <span className="card-tenure">EST. {owner.first_season ?? '—'}</span><span className="card-seal">{owner.championships}<small>TITLES</small></span>
            </div>
            <div className="card-identity"><span>OWNER / {year==='all'?`${owner.seasons_played} SEASONS`:year}</span><h1>{displayName}</h1><p>{season?.team_name ?? owner.current_team_name ?? 'League archive'}</p></div>
            <div className="card-stats"><div><b>{summary.record}</b><span>Record</span></div><div><b>{pct(summary.win_pct)}</b><span>Win rate</span></div><div><b>{points(summary.avg_score,1)}</b><span>Pts / game</span></div></div>
            <div className="card-honors">{year==='all' ? (titleYears.length?`Champion · ${titleYears.join(' / ')}`:'The career collection') : season?.is_champion?'League champion':season?.final_rank?`${ordinal(season.final_rank)} finish`:'Season in progress'}<span>Regular-season statistics</span></div>
          </div><div className="card-face card-back" ref={node=>{if(node)node.inert=!back;}} aria-hidden={!back}><div className="card-topline"><span>FFBFFL / Record office</span><span>{year==='all'?'Career':year}</span></div><div className="card-reverse">
            <span className="card-overline">The back of the card</span><h2>{displayName}</h2><p>{year==='all'?'Career totals':`${year} season`} · Regular season</p>
            <dl><div><dt>Record</dt><dd>{summary.record}</dd></div><div><dt>Points for</dt><dd>{total(summary.points_for)}</dd></div><div><dt>Points against</dt><dd>{total(summary.points_against)}</dd></div><div><dt>Points / game</dt><dd>{points(summary.avg_score,1)}</dd></div><div><dt><Metric name="all_play">All-play</Metric></dt><dd>{pct(summary.all_play_win_pct)}</dd></div><div><dt>{season?'Finish':'Best finish'}</dt><dd>{ordinal(season?.final_rank ?? (year==='all'?owner.best_finish:null))}</dd></div></dl>
            <div className="card-reverse-note">{year==='all'?`${owner.championships} titles · ${owner.playoff_appearances} playoff appearances`:season?.is_champion?'League champion':season?.made_playoffs?'Playoff appearance':'Season record'}<span>{owner.first_season}–{owner.last_season}</span></div>
          </div></div>
        </div></div>
          <button className="card-flip" onClick={()=>setBack(value=>!value)} aria-pressed={back}>{back?'Front of card ↶':'Turn card over ↷'}</button>
        <div className="card-caption"><span>Scoring signature · {visible.length} games</span><span>Drag the gold line ↔</span></div>
      </div>
      <div className="almanac-story">
        <div className="almanac-story-heading"><span className="section-kicker">{year==='all'?'The complete career':`Chapter ${year}`}</span><h2>{year==='all'?'Every season has a story.':season?.team_name ?? `${year} season`}</h2></div>
        <div className="almanac-season-strip" role="group" aria-label="Choose career chapter">
          <button aria-pressed={year==='all'} onClick={()=>chooseYear('all')}><strong>Career</strong><span>{owner.record}</span><small>{owner.seasons_played} seasons</small></button>
          {owner.seasons_detail.map(s=><button key={s.season} aria-pressed={year===String(s.season)} onClick={()=>chooseYear(String(s.season))}><strong>{s.season}</strong><span>{s.record}</span><small>{s.is_champion?'Champion':s.final_rank?`${ordinal(s.final_rank)} place`:'In progress'}</small></button>)}
        </div>
        {active ? <section className="game-reel" aria-label="Game reel">
          <div className="reel-folio"><span>{active.season} / WEEK {active.week}</span><span>{gameTypeLabel(active.game_type)}</span></div>
          <div className="reel-result"><b>{active.result==='W'?'Victory':active.result==='L'?'Defeat':'A draw'}</b><span><Metric name="winning_margin">{signed(active.score-active.opponent_score,2)} pts</Metric></span></div>
          <div className="reel-team"><span>{active.team_name}</span><b>{points(active.score,2)}</b></div><div className="reel-bar"><span style={{width:`${active.score/scoreMax*100}%`}}/></div>
          <div className="reel-team reel-opponent"><OwnerLink ownerId={active.opponent_owner_id}>{active.opponent_team_name}</OwnerLink><b>{points(active.opponent_score,2)}</b></div><div className="reel-bar reel-bar-opponent"><span style={{width:`${active.opponent_score/scoreMax*100}%`}}/></div>
          <div className="reel-controls"><button className="pill" aria-label="Previous reel game" disabled={position===0} onClick={()=>chooseGame(position-1)}>←</button>
            <label><span className="sr-only">Game in selected chapter</span><input type="range" min="0" max={Math.max(0,visible.length-1)} value={position} disabled={visible.length<=1} onChange={e=>chooseGame(Number(e.target.value))}/></label>
            <button className="pill" aria-label="Next reel game" disabled={position>=visible.length-1} onClick={()=>chooseGame(position+1)}>→</button></div>
          <div className="reel-footer"><span>Game {position+1} of {visible.length}</span><WeekLink season={active.season} week={active.week}>Open the full week →</WeekLink></div>
        </section> : <p className="prose-narrow">No completed games in this chapter.</p>}
      </div>
    </div>
    <OwnerCareerAtlas owner={owner} year={year} setYear={chooseYear} selected={selected} setSelected={setSelected}/>
  </section>;
}
