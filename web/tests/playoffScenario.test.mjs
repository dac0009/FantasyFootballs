import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const source=readFileSync(new URL('../src/lib/playoffScenario.ts',import.meta.url),'utf8');
const {outputText}=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext}});
const {simulateScenario}=await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const standings=['a','b','c','d'].map((id,i)=>({owner_id:id,team_name:id,wins:0,ties:0,points_for:4-i}));
const game=(id,h,a)=>({matchup_id:id,home_owner_id:h,away_owner_id:a,season:2026,game_type:'regular',completed:false,is_bye:false});
const games=[game('ab','a','b'),game('cd','c','d')];
const picture={season:2026,playoff_teams:2,teams:standings.map(s=>({owner_id:s.owner_id,model:{mean:100,sd:20}}))};
test('every run assigns all seeds and exactly the available playoff places',()=>{
 const rows=simulateScenario(standings,games,picture,{});
 assert.ok(Math.abs(rows.reduce((s,r)=>s+r.odds,0)-2)<1e-10);
 for(const row of rows){assert.ok(Math.abs(row.seeds.reduce((a,b)=>a+b,0)-1)<1e-10); assert.ok(row.odds>=0 && row.odds<=1);}
 for(let seed=0;seed<4;seed++)assert.ok(Math.abs(rows.reduce((s,r)=>s+r.seeds[seed],0)-1)<1e-10);
});
test('forcing the two final games makes both winners qualify',()=>{
 const rows=simulateScenario(standings,games,picture,{ab:'HOME',cd:'AWAY'});
 assert.equal(rows.find(r=>r.ownerId==='a').odds,1);
 assert.equal(rows.find(r=>r.ownerId==='d').odds,1);
 assert.equal(rows.find(r=>r.ownerId==='b').odds,0);
 assert.equal(rows.find(r=>r.ownerId==='c').odds,0);
});
test('repeat runs and resetting picks reproduce baseline exactly',()=>{
 const first=simulateScenario(standings,games,picture,{});
 simulateScenario(standings,games,picture,{ab:'AWAY'});
 assert.deepEqual(simulateScenario(standings,games,picture,{}),first);
});
test('completed, postseason, bye and other-season games do not count',()=>{
 const invalid=[{...games[0],completed:true},{...games[0],game_type:'playoff'},{...games[0],is_bye:true},{...games[0],season:2025}];
 assert.deepEqual(simulateScenario(standings,invalid,picture,{}),simulateScenario(standings,[],picture,{}));
});
test('a missing scoring model raises an error instead of fabricated odds',()=>{
 assert.throws(()=>simulateScenario(standings,games,{...picture,teams:[]},{}),/model missing/);
});
test('zero simulations is rejected',()=>assert.throws(()=>simulateScenario(standings,games,picture,{},0)));
