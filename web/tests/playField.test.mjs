import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import ts from 'typescript';

// PlayField.tsx is TypeScript + JSX; compile just its geometry functions for node.
const src = readFileSync(new URL('../src/components/PlayField.tsx', import.meta.url), 'utf8');
const geometry = src.slice(src.indexOf('const W = 120'), src.indexOf('const ease ='));
const js = ts.transpileModule(`${geometry}\nexport { playPath, playDuration, callFor };`, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const { playPath, playDuration, callFor } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

const last = (segs) => segs[segs.length - 1].to;

test('a pass starts at the real line, flies the real air yards, and ends at the real spot', () => {
  // Offense at its own 33 (67 to go), 26-yard completion with 18 air yards.
  const segs = playPath(['BAL', 67, 26, 'P', 18, 3, 2, 0, 0], 2);
  const los = 110 - 67;
  assert.equal(segs[0].from[0], los - 1);
  assert.equal(segs[1].to[0], los + 18);
  assert.ok(segs[1].h > 0, 'the throw is in the air');
  assert.equal(last(segs)[0], los + 26);
});

test('touchdowns reach the end zone; picks and safeties go the other way', () => {
  assert.ok(last(playPath(['KC', 12, 12, 'R', null, 2, 5, 1, 0], 1))[0] >= 110);
  assert.ok(last(playPath(['KC', 41, 41, 'P', 30, 1, 10, 1, 0], 1))[0] >= 110);
  const pick = playPath(['NYJ', 70, 0, 'I', 15, 2, 8, 0, 22], 3);
  assert.ok(last(pick)[0] < pick[1].to[0], 'the interception return heads back');
  assert.ok(last(playPath(['NYJ', 70, 0, 'I', 15, 2, 8, 1, 60], 3))[0] < 10, 'pick six ends in the other end zone');
  assert.ok(last(playPath(['CLE', 97, -4, 'Y', null, 3, 12, 0, 0], 1))[0] < 10);
});

test('kicks fly to the uprights; sacks lose ground', () => {
  const fg = playPath(['BAL', 30, 0, 'G', null, 4, 6, 0, 0], 4);
  assert.ok(last(fg)[0] > 118);
  assert.equal(fg[1].from[0], 110 - 30 - 7);
  const sack = playPath(['BAL', 60, -7, 'S', null, 3, 8, 0, 0], 4);
  assert.ok(last(sack)[0] < 110 - 60);
  assert.equal(callFor(['BAL', 30, 0, 'G', null, 4, 6, 0, 0]), "It's good");
  assert.equal(callFor(['BAL', 30, 0, 'g', null, 4, 6, 0, 0]), 'No good');
  assert.equal(callFor(['KC', 12, 12, 'R', null, 2, 5, 1, 0]), 'Touchdown');
  assert.equal(callFor(['NYJ', 70, 0, 'I', 15, 2, 8, 1, 60]), 'Pick six');
});

const plays = new URL('../../data/plays/2023.json', import.meta.url);
test('every real play in a season has a sane replay on the field', { skip: !existsSync(plays) }, () => {
  const data = JSON.parse(readFileSync(plays, 'utf8'));
  let n = 0;
  for (const week of Object.values(data.weeks)) {
    for (const list of Object.values(week)) {
      for (const e of list) {
        const field = e[6];
        if (!field) continue;
        n++;
        for (const seg of playPath(field, n)) {
          for (const [x, y] of [seg.from, seg.to]) {
            assert.ok(x >= 0 && x <= 120 && y >= 0 && y <= 53.3, `${e[3]} leaves the field: ${x},${y}`);
          }
        }
        const ms = playDuration(field);
        assert.ok(ms > 200 && ms < 3500, `${e[3]} replay takes ${ms}ms`);
      }
    }
  }
  assert.ok(n > 5000);
});
