import { Link } from "react-router-dom";
import type { GameOfWeek } from "../lib/types";
import { Metric, OwnerLink, RivalryLink } from "./primitives";

export function GameOfWeekPanel({data}: {data:GameOfWeek}) {
  const {pick, week} = data;
  const preview = pick.preview;
  const pct = (value:number)=>`${Math.round(value*100)}%`;
  return <section className="panel">
    <div className="section-kicker">Matchup to watch / Week {week}</div>
    <h3 style={{fontSize:'1.7rem'}}><OwnerLink ownerId={pick.away_owner_id}>{pick.away_team_name}</OwnerLink>
      <span style={{fontWeight:400}}> at </span><OwnerLink ownerId={pick.home_owner_id}>{pick.home_team_name}</OwnerLink></h3>
    {preview ? <>
      <p className="figure-label"><Metric name="game_of_week">Why this matchup?</Metric></p>
      <div style={{display:'flex',justifyContent:'space-between',gap:'1rem',fontSize:'.8rem'}}><span><Metric name="win_probability">Away win estimate</Metric> <b>{pct(preview.away_win_pct)}</b></span><span>Home <b>{pct(preview.home_win_pct)}</b></span></div>
      <div style={{height:8,background:'var(--ink-faint)',margin:'.5rem 0 1rem'}} role="img" aria-label={`Away win probability ${pct(preview.away_win_pct)}; home ${pct(preview.home_win_pct)}`}><div style={{width:pct(preview.away_win_pct),height:'100%',background:'var(--ember)'}}/></div>
      <div className="sheet"><table><caption className="sr-only">Playoff impact of winning or losing this matchup</caption><thead><tr><th style={{textAlign:'left'}}><Metric name="playoff_swing">Playoff chance</Metric></th><th>If win</th><th>If lose</th></tr></thead><tbody>
        <tr><td style={{textAlign:'left',whiteSpace:'normal'}}>{pick.away_team_name}</td><td>{pct(preview.away_swing.if_win)}</td><td>{pct(preview.away_swing.if_loss)}</td></tr>
        <tr><td style={{textAlign:'left',whiteSpace:'normal'}}>{pick.home_team_name}</td><td>{pct(preview.home_swing.if_win)}</td><td>{pct(preview.home_swing.if_loss)}</td></tr>
      </tbody></table></div>

    </> : <p className="prose-narrow">Detailed matchup estimates are unavailable in this snapshot.</p>}

    <p style={{fontSize:'.82rem',marginBottom:0}}><Link to="/playoffs" className="link-quiet">Try your own playoff scenario</Link> · <RivalryLink a={pick.home_owner_id} b={pick.away_owner_id}>Head-to-head history</RivalryLink></p>
  </section>;
}
