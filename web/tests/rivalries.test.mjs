import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/rivalries.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
const { currentOwners, currentRivalries } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const owners = [
  { owner_id: 'a', name: 'A', seasons: [2024, 2026] },
  { owner_id: 'b', name: 'B', seasons: [2026] },
  { owner_id: 'former', name: 'Former', seasons: [2024] },
  { owner_id: 'unlinked', name: 'Unknown', seasons: [2026], unlinked: true },
];
const pair = (a, b, games, score) => ({ pair_key: `${a}__${b}`, left_owner_id: a,
  right_owner_id: b, overall: { games }, rivalry_index: { score } });

test('older datasets use roster seasons, excluding departed and unlinked owners', () => {
  assert.deepEqual(currentOwners(owners).map(o => o.owner_id), ['a', 'b']);
});
test('explicit roster membership takes precedence over historical seasons', () => {
  assert.deepEqual(currentOwners(owners.map(o => ({ ...o, is_active: o.owner_id === 'former' })))
    .map(o => o.owner_id), ['former']);
});
test('a stronger departed series cannot enter the current-owner ranking', () => {
  const active = pair('a', 'b', 5, 20);
  assert.deepEqual(currentRivalries(owners, [pair('a', 'former', 20, 99), active,
    pair('a', 'unlinked', 10, 80)]), [active]);
});
test('new pairs are available to explore but need three games to rank', () => {
  assert.deepEqual(currentRivalries(owners, [pair('a', 'b', 2, 100)]), []);
  assert.equal(currentRivalries(owners, [pair('a', 'b', 3, 10)]).length, 1);
});
test('empty archive has no current members or rankings', () => {
  assert.deepEqual(currentOwners([]), []);
  assert.deepEqual(currentRivalries([], []), []);
});

test('ordering uses meetings instead of the retired composite score', () => {
  const longer=pair('a','b',10,1), shorter=pair('a','b',3,99);
  assert.deepEqual(currentRivalries(owners,[shorter,longer]),[longer,shorter]);
});
test('balance, winning margin and playoff sorting use their stated quantities', () => {
  const a={...pair('a','b',10,100),overall:{games:10,left_wins:5,right_wins:5},avg_abs_margin:20,playoff:{games:1}};
  const b={...pair('a','b',10,0),overall:{games:10,left_wins:8,right_wins:2},avg_abs_margin:5,playoff:{games:3}};
  assert.equal(currentRivalries(owners,[b,a],'balance')[0],a);
  assert.equal(currentRivalries(owners,[a,b],'margin')[0],b);
  assert.equal(currentRivalries(owners,[a,b],'playoffs')[0],b);
});
