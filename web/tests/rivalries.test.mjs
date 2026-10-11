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
