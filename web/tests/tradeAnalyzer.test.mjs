import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const source=readFileSync(new URL('../src/lib/tradeAnalyzer.ts',import.meta.url),'utf8');
const {outputText}=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext}});
const {computeTradeValue,valueToTeam,currentRosterByOwner}=await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

const player=(id,name,position)=>({player_id:id,name,position,nfl_team:'KC'});
const trade={
  season:2026,
  players:{
    '1':{player_id:1,name:'RB One',position:'RB',nfl_team:'KC',value_base:10,season_games:4,career_rate:10,reliability_factor:1.1,reliability_games:20,recent_form_factor:1.05,recent_form_games:3},
    '4':{player_id:4,name:'WR Four',position:'WR',nfl_team:'DAL',value_base:12,season_games:4,career_rate:12,reliability_factor:0.9,reliability_games:15,recent_form_factor:0.95,recent_form_games:3},
  },
  teams:{
    a:{owner_id:'a',need_fit:{RB:{team_avg:10,league_avg:12,started_weeks:5,need_fit_factor:1.1}},leverage_factor:1.05,playoff_pct:0.4},
    b:{owner_id:'b',need_fit:{},leverage_factor:0.95,playoff_pct:0.8},
  },
  positions:{RB:{reliability_baseline:1.0,value_rate:8}},
  model:{value_base_shrinkage_games:4,reliability_shrinkage_games:8,reliability_clamp:[0.75,1.25],need_fit_shrinkage_games:3,need_fit_clamp:[0.85,1.15],leverage_span:0.1,recent_form_window:3,recent_form_clamp:[0.9,1.1],notes:''},
};

test('valueToTeam multiplies every component for a known player',()=>{
  const result=valueToTeam(trade,player(1,'RB One','RB'),trade.teams.a);
  const expected=10*1.1*1.05*1.1*1.05;
  assert.ok(Math.abs(result.contribution-expected)<1e-9);
  assert.equal(result.hasHistory,true);
});

test('valueToTeam falls back to the position rate and neutral factors for an unknown player',()=>{
  const result=valueToTeam(trade,player(2,'Rookie RB','RB'),trade.teams.a);
  // no trade.players entry -> valueBase falls back to positions.RB.value_rate (8);
  // reliability and recent form default to neutral (1); need_fit and leverage still come from the team.
  const expected=8*1*1*1.1*1.05;
  assert.ok(Math.abs(result.contribution-expected)<1e-9);
  assert.equal(result.hasHistory,false);
});

test('valueToTeam defaults need_fit and leverage to neutral when no team is given',()=>{
  const result=valueToTeam(trade,player(1,'RB One','RB'),undefined);
  assert.equal(result.needFitFactor,1);
  assert.equal(result.leverageFactor,1);
});

test('valueToTeam is zero for a player with no history and no position rate on record',()=>{
  const result=valueToTeam(trade,player(5,'Mystery WR','WR'),trade.teams.a);
  // WR is not in trade.positions in this fixture, so there is truly nothing to value from.
  assert.equal(result.valueBase,0);
  assert.equal(result.contribution,0);
});

test('computeTradeValue scores each side independently using its own need_fit and leverage',()=>{
  const result=computeTradeValue(trade,'a','b',[player(1,'RB One','RB')],[player(4,'WR Four','WR')]);
  // Team A receives player 4 (valued to A: no WR need_fit entry -> neutral 1) and gives up player 1.
  const aGain=12*0.9*0.95*1*1.05;
  const aLoss=10*1.1*1.05*1.1*1.05;
  assert.ok(Math.abs(result.teamA.score-(aGain-aLoss))<1e-9);
  // Team B receives player 1 (valued to B: no RB need_fit entry -> neutral 1) and gives up player 4.
  const bGain=10*1.1*1.05*1*0.95;
  const bLoss=12*0.9*0.95*1*0.95;
  assert.ok(Math.abs(result.teamB.score-(bGain-bLoss))<1e-9);
  assert.equal(result.teamA.gains.length,1);
  assert.equal(result.teamA.losses.length,1);
});

test('computeTradeValue returns zero scores and empty rows for an empty trade',()=>{
  const result=computeTradeValue(trade,'a','b',[],[]);
  assert.equal(result.teamA.score,0);
  assert.equal(result.teamB.score,0);
  assert.deepEqual(result.teamA.gains,[]);
  assert.deepEqual(result.teamA.losses,[]);
});

test('currentRosterByOwner keeps only the most recent week, grouped by owner',()=>{
  const rows=[
    {season:2026,week:3,team_id:1,owner_id:'a',player_id:1,lineup_slot_id:2,lineup_slot:'RB',started:true,points:10,projected:9},
    {season:2026,week:4,team_id:1,owner_id:'a',player_id:2,lineup_slot_id:2,lineup_slot:'RB',started:true,points:8,projected:9},
    {season:2026,week:4,team_id:2,owner_id:'b',player_id:3,lineup_slot_id:4,lineup_slot:'WR',started:true,points:14,projected:11},
    {season:2026,week:4,team_id:3,owner_id:null,player_id:9,lineup_slot_id:2,lineup_slot:'RB',started:true,points:1,projected:1},
  ];
  const roster=currentRosterByOwner(rows);
  assert.deepEqual(roster.get('a'),[2]);
  assert.deepEqual(roster.get('b'),[3]);
  assert.equal(roster.has(null),false);
});
