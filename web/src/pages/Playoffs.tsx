import { EditableText } from "../components/Editorial";
import { useMemo, useState } from "react";
import { Band, Empty, ErrorState, Loading, Metric, OwnerLink } from "../components/primitives";
import { useCurrent, useMatchups } from "../lib/data";
import { simulateScenario, type Picks } from "../lib/playoffScenario";
import type { CurrentPayload, Matchup, PlayoffPicture } from "../lib/types";

export default function Playoffs() {
  const current = useCurrent(), schedule = useMatchups();
  if (current.state === "error") return <ErrorState error={current.error} what="Playoff data" />;
  if (schedule.state === "error") return <ErrorState error={schedule.error} what="Schedule" />;
  if (current.state !== "ready" || schedule.state !== "ready") return <Loading what="playoff explorer" />;
  return <div className="shell" style={{ paddingTop: "2rem" }}>
    <div className="section-kicker">The postseason / Scenario explorer</div>
    <h1><EditableText id="site.playoffs.fd90ffab10" fallback="Playoff explorer"/></h1>
    {current.data.playoff_picture ? <Explorer current={current.data} games={schedule.data} picture={current.data.playoff_picture} /> :
      <Empty>Playoff estimates are unavailable for this data snapshot. The next analytics refresh will calculate them if a playoff format is configured.</Empty>}
  </div>;
}

function Explorer({current, games, picture}: {current: CurrentPayload; games: Matchup[]; picture: PlayoffPicture}) {
  const [picks, setPicks] = useState<Picks>({});
  const remaining = useMemo(() => games.filter(g => g.season === current.season && !g.completed &&
    !g.is_bye && g.game_type === "regular" && g.week <= (current.regular_season_weeks ?? Infinity)), [games,current]);
  const weeks = [...new Set(remaining.map(g => g.week))].sort((a,b)=>a-b);
  const [chosenWeek, setWeek] = useState(weeks[0] ?? 0);
  const [selectedOwner, selectOwner] = useState(current.standings[0]?.owner_id ?? "");
  const baseline = useMemo(() => simulateScenario(current.standings, remaining, picture, {}), [current,remaining,picture]);
  const result = useMemo(() => simulateScenario(current.standings, remaining, picture, picks), [current,remaining,picture,picks]);
  const base = new Map(baseline.map(row => [row.ownerId,row]));
  const selected = result.find(row => row.ownerId === selectedOwner);
  const pct = (n: number) => `${(100*n).toFixed(1)}%`;
  return <>
    <p className="prose-narrow">{picture.playoff_teams} playoff spots. Results through week {current.latest_completed_week ?? 0}.
      {" "}<Metric name="playoff_scenarios">Scenario methodology</Metric>.</p>
    <div className="scenario-layout">
      <section>
        <Band title={<EditableText id="site.playoffs.f8acd4ea8b" fallback="Your picks"/>}  note={`${Object.keys(picks).length} games picked`} />
        {remaining.length ? <>
          <div className="scenario-controls"><label>Week <select className="select" value={chosenWeek} onChange={e=>setWeek(Number(e.target.value))}>
            {weeks.map(week=><option key={week} value={week}>{week}{remaining.some(g=>g.week===week && picks[g.matchup_id]) ? " · picks saved" : ""}</option>)}
          </select></label><button className="pill" onClick={()=>setPicks({})} disabled={!Object.keys(picks).length}>Reset all picks</button></div>
          {remaining.filter(g=>g.week===chosenWeek).map(game=><fieldset className="scenario-game" key={game.matchup_id}>
            <legend>{game.away_team_name} at {game.home_team_name}</legend>
            <div className="pill-row">
              {([['HOME',game.home_team_name],['AWAY',game.away_team_name],['','Simulate']] as const).map(([value,label])=>
                <button className="pill" key={value} aria-pressed={(picks[game.matchup_id] ?? '') === value}
                  onClick={()=>setPicks(old=>{const next={...old}; if(value) next[game.matchup_id]=value; else delete next[game.matchup_id]; return next;})}>{label}</button>)}
            </div>
          </fieldset>)}
        </> : <p><EditableText id="site.playoffs.6d121109b5" fallback="The regular season is complete. No remaining games to pick."/></p>}
      </section>
      <section aria-live="polite" aria-atomic="true">
        <Band title={<EditableText id="site.playoffs.d2add6608b" fallback="Chance to make the playoffs"/>}  note={<EditableText id="site.playoffs.0f94899f7b" fallback="Blue bar: your scenario · Tick: baseline"/>}  />
        <p className="figure-label"><Metric name="playoff_scenarios">3,000 simulations · Change in pp</Metric></p>
        <div className="odds-axis"><span>0%</span><span>50%</span><span>100%</span></div>
        {result.map(row=>{const previous=base.get(row.ownerId)!;const delta=(row.odds-previous.odds)*100;return <div className="odds-row" key={row.ownerId}>
          <div className="odds-caption"><OwnerLink ownerId={row.ownerId}>{row.name}</OwnerLink><span>{pct(row.odds)} <small className={delta>0?'num-pos':delta<0?'num-neg':''}>({delta>0?'+':''}{delta.toFixed(1)} pp)</small></span></div>
          <div className="odds-track" role="img" aria-label={`${row.name}: baseline ${pct(previous.odds)}, scenario ${pct(row.odds)}`}>
            <span className="odds-fill" style={{width:pct(row.odds)}}/><span className="odds-baseline" style={{left:pct(previous.odds)}}/>
          </div>
        </div>})}
      </section>
    </div>
    <Band title={<EditableText id="site.playoffs.54e31d8091" fallback="Where could your team finish?"/>}  note={<EditableText id="site.playoffs.9c7763be1f" fallback="Final regular-season seed in your scenario"/>}  />
    <label className="scenario-controls">Team <select className="select" value={selectedOwner} onChange={e=>selectOwner(e.target.value)}>
      {current.standings.map(row=><option key={row.owner_id} value={row.owner_id}>{row.team_name}</option>)}
    </select></label>
    {selected ? <div className="seed-chart" role="img" aria-label={`${selected.name} seed probabilities: ${selected.seeds.map((p,i)=>`seed ${i+1}: ${pct(p)}`).join(', ')}`}>
      {selected.seeds.map((prob,i)=><div className="seed-column" key={i}><span>{Math.round(prob*100)}%</span><div style={{height:`${prob*160}px`,background:i<picture.playoff_teams?'var(--ember)':'var(--ink-faint)'}}/><span>#{i+1}</span></div>)}
    </div> : null}
    <p className="figure-label"><EditableText id="site.playoffs.e7033b9620" fallback="Blue: playoff seeds · Gray: out · Scale: 0–100%"/></p>

    <style>{`
      .scenario-layout {display:grid;gap:2.5rem;grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
      .scenario-controls {display:flex;gap:1rem;align-items:center;flex-wrap:wrap;margin:1rem 0}
      .scenario-game {border:0;border-bottom:1px solid var(--rule-soft);padding:1rem 0;margin:0;min-width:0}
      .scenario-game legend {font-weight:600;font-size:.86rem;padding-top:1rem}
      .scenario-game .pill {font-size:.75rem;text-align:left;white-space:normal}
      .odds-row {padding:.6rem 0;border-bottom:1px solid var(--rule-soft)}
      .odds-caption {display:flex;justify-content:space-between;gap:1rem;font-size:.8rem;margin-bottom:.4rem}
      .odds-caption>span {white-space:nowrap}.odds-caption small{font-size:.7rem}
      .odds-axis {display:flex;justify-content:space-between;color:var(--ink-faint);font-size:.7rem}
      .odds-track {height:7px;background:var(--rule-soft);position:relative}
      .odds-fill{display:block;height:100%;background:var(--ember)}
      .odds-baseline{position:absolute;width:2px;height:13px;background:var(--ink);top:-3px;transform:translateX(-1px)}
      .seed-chart{display:flex;gap:clamp(.2rem,2vw,1.5rem);align-items:flex-end;height:205px;border-bottom:1px solid var(--rule);max-width:48rem}
      .seed-column{flex:1;display:flex;flex-direction:column;gap:.35rem;text-align:center;font-size:.72rem}
      .seed-column>div{min-height:1px}.model-note{margin-top:2rem;max-width:48rem;color:var(--ink-soft);font-size:.85rem}
      @media(max-width:850px){.scenario-layout{grid-template-columns:1fr}.odds-caption{font-size:.76rem}}
    `}</style>
  </>;
}
