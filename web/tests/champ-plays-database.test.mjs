import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const ownerA = '00000000-0000-0000-0000-000000000001';
const ownerB = '00000000-0000-0000-0000-000000000002';
const stranger = '00000000-0000-0000-0000-000000000004';
const migration = (name) => readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');

test('champ_plays: public board, own row only, today only, once a day, no edits', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
      insert into auth.users values ('${ownerA}'),('${ownerB}'),('${stranger}');`);
    await db.exec(migration('202610110001_editor.sql'));
    await db.exec(migration('202610110002_visual_editor.sql'));
    await db.exec(migration('202610210002_wheel_plays.sql'));
    await db.exec(migration('202610290001_champ_plays.sql'));
    await db.exec(migration('202610300001_champ_weekly.sql'));
    await db.exec(`insert into public.editor_memberships values ('${ownerA}','owner-a','owner'),('${ownerB}','owner-b','owner');`);

    const today = (await db.query(`select 'champ:' || to_char((now() at time zone 'America/New_York')::date, 'YYYY-MM-DD') as k`)).rows[0].k;
    async function as(role, uid = '') {
      await db.exec(`reset role; set role ${role};`);
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [uid]);
    }
    const post = (o) => db.query(
      `insert into public.champ_plays (game_key,user_id,owner_id,season,champion_owner_id,wins,losses,ties,points_for,champion_points,points_rank,team_count,all_play_wins,all_play_losses,picks)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)`,
      [o.key ?? today, o.uid, o.owner, o.season ?? 2023, 'champ', o.wins ?? 9, o.losses ?? 5, 0, o.pf ?? 1650.5, 1580.2,
        o.rank ?? 2, 13, 100, 68, JSON.stringify(o.picks ?? [{ slot: 'QB-1', player_id: 1 }])],
    );

    await as('anon');
    await assert.rejects(post({ uid: ownerA, owner: 'owner-a' }), /permission denied|row-level security/);

    await as('authenticated', stranger);
    await assert.rejects(post({ uid: stranger, owner: 'owner-a' }), /row-level security/);

    await as('authenticated', ownerA);
    await assert.rejects(post({ uid: ownerB, owner: 'owner-b' }), /row-level security/);
    await assert.rejects(post({ uid: ownerA, owner: 'owner-b' }), /row-level security/);
    await assert.rejects(post({ uid: ownerA, owner: 'owner-a', key: 'champ:2001-01-01' }), /row-level security/);
    await assert.rejects(post({ uid: ownerA, owner: 'owner-a', wins: 30 }), /row-level security/);
    await assert.rejects(post({ uid: ownerA, owner: 'owner-a', rank: 14 }), /row-level security/);
    await assert.rejects(post({ uid: ownerA, owner: 'owner-a', pf: 9000 }), /row-level security/);
    await post({ uid: ownerA, owner: 'owner-a' });
    await assert.rejects(post({ uid: ownerA, owner: 'owner-a' }), /duplicate key/);
    await assert.rejects(db.exec(`update public.champ_plays set wins = 14`), /permission denied/);
    await assert.rejects(db.exec(`delete from public.champ_plays`), /permission denied/);
    await as('anon');
    const rows = (await db.query('select owner_id, wins from public.champ_plays')).rows;
    assert.deepEqual(rows, [{ owner_id: 'owner-a', wins: 9 }]);

    // New columns: optional, but range-checked.
    await as('authenticated', ownerB);
    await assert.rejects(db.query(
      `insert into public.champ_plays (game_key,user_id,owner_id,season,champion_owner_id,wins,losses,points_for,champion_points,points_rank,team_count,all_play_wins,all_play_losses,optimal_points)
       values ($1,$2,'owner-b',2023,'champ',7,7,1500,1600,3,13,90,80,99999)`, [today, ownerB]), /check constraint/);
    await db.query(
      `insert into public.champ_plays (game_key,user_id,owner_id,season,champion_owner_id,wins,losses,points_for,champion_points,points_rank,team_count,all_play_wins,all_play_losses,optimal_points,claims)
       values ($1,$2,'owner-b',2023,'champ',7,7,1500,1600,3,13,90,80,1700,4)`, [today, ownerB]);

    // Starts: own row, today, once; private to the owner; never edited.
    const start = (uid, owner, key = today) => db.query(
      'insert into public.champ_starts (game_key,user_id,owner_id) values ($1,$2,$3)', [key, uid, owner]);
    await as('anon');
    await assert.rejects(start(ownerA, 'owner-a'), /permission denied/);
    await as('authenticated', ownerA);
    await assert.rejects(start(ownerB, 'owner-b'), /row-level security/);
    await assert.rejects(start(ownerA, 'owner-a', 'champ:2001-01-01'), /row-level security/);
    await start(ownerA, 'owner-a');
    await assert.rejects(start(ownerA, 'owner-a'), /duplicate key/);
    await assert.rejects(db.exec('delete from public.champ_starts'), /permission denied/);
    await as('authenticated', ownerB);
    assert.equal((await db.query('select count(*)::int as n from public.champ_starts')).rows[0].n, 0);
    await as('anon');
    await assert.rejects(db.query('select * from public.champ_starts'), /permission denied/);

    // The original Wheel table is untouched and still accepts its own rows.
    await as('authenticated', ownerB);
    const wheelKey = today.replace('champ:', 'daily:');
    await db.query(
      `insert into public.wheel_plays (game_key,user_id,owner_id,season,week,team_id,opponent_team_id,points,opponent_points,actual_points,optimal_points)
       values ($1,$2,'owner-b',2023,3,1,2,100,90,95,120)`, [wheelKey, ownerB],
    );
  } finally {
    await db.close();
  }
});
