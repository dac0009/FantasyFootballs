import { Link } from "react-router-dom";
import type { GameOfWeek } from "../lib/types";
import { OwnerLink, RivalryLink } from "./primitives";

export function GameOfWeekPanel({data}: {data:GameOfWeek}) {
  const {pick, week} = data;
  const preview = pick.preview;
  const pct = (value:number)=>`${Math.round(value*100)}%`;
  return <section className="panel">
    <div className="section-kicker">Matchup to watch / Week {week}</div>
    <h3 style={{fontSize:'1.7rem'}}><OwnerLink ownerId={pick.away_owner_id}>{pick.away_team_name}</OwnerLink>
      <span style={{fontWeight:400}}> at </span><OwnerLink ownerId={pick.home_owner_id}>{pick.home_team_name}</OwnerLink></h3>
    {preview ? <>
      <p className="prose-narrow" style={{fontSize:'.85rem'}}>A model-selected matchup, based on playoff impact, how well both teams have scored this season, and how evenly matched they are.</p>
      <div style={{display:'flex',justifyContent:'space-between',gap:'1rem',fontSize:'.8rem'}}><span>Away win estimate <b>{pct(preview.away_win_pct)}</b></span><span>Home <b>{pct(preview.home_win_pct)}</b></span></div>
      <div style={{height:8,background:'var(--ink-faint)',margin:'.5rem 0 1rem'}} role="img" aria-label={`Away win probability ${pct(preview.away_win_pct)}; home ${pct(preview.home_win_pct)}`}><div style={{width:pct(preview.away_win_pct),height:'100%',background:'var(--ember)'}}/></div>
      <div className="sheet"><table><caption className="sr-only">Playoff impact of winning or losing this matchup</caption><thead><tr><th style={{textAlign:'left'}}>Playoff chance</th><th>If win</th><th>If lose</th></tr></thead><tbody>
        <tr><td style={{textAlign:'left',whiteSpace:'normal'}}>{pick.away_team_name}</td><td>{pct(preview.away_swing.if_win)}</td><td>{pct(preview.away_swing.if_loss)}</td></tr>
        <tr><td style={{textAlign:'left',whiteSpace:'normal'}}>{pick.home_team_name}</td><td>{pct(preview.home_swing.if_win)}</td><td>{pct(preview.home_swing.if_loss)}</td></tr>
      </tbody></table></div>
      <p className="figure-label">Estimates from season scoring, not ESPN projections. Early-season estimates are uncertain.</p>
    </> : <p className="prose-narrow">Detailed matchup estimates are unavailable in this snapshot.</p>}
    <details className="figure-label" style={{marginTop:'1rem'}}><summary>Why this game?</summary>
      <p>Selection weights: 45% playoff impact, 30% current-season all-play performance, 25% estimated competitiveness. These are ranking weights, not probabilities. Rivalry history is excluded.</p>
      <p>Playoff impact combines the change in both teams’ chances if they win rather than lose. All-play performance means how often their weekly score would beat the other teams in the league.</p>
    </details>
    <p style={{fontSize:'.82rem',marginBottom:0}}><Link to="/playoffs" className="link-quiet">Try your own playoff scenario</Link> · <RivalryLink a={pick.home_owner_id} b={pick.away_owner_id}>Head-to-head history</RivalryLink></p>
  </section>;
}
