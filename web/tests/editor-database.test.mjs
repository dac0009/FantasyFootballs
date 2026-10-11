import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const ownerA='00000000-0000-0000-0000-000000000001';
const ownerB='00000000-0000-0000-0000-000000000002';
const commissioner='00000000-0000-0000-0000-000000000003';
const stranger='00000000-0000-0000-0000-000000000004';
test('editor enforces ownership, public visibility, validation, conflict detection, and revision privacy', async()=>{
  const db=new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
      insert into auth.users values ('${ownerA}'),('${ownerB}'),('${commissioner}'),('${stranger}');`);
    await db.exec(readFileSync(new URL('../../supabase/migrations/202610110001_editor.sql',import.meta.url),'utf8'));
    await db.exec(readFileSync(new URL('../../supabase/migrations/202610110002_visual_editor.sql',import.meta.url),'utf8'));
    await db.exec(`insert into public.editor_memberships values ('${ownerA}','owner-a','owner'),('${ownerB}','owner-b','owner'),('${commissioner}',null,'commissioner');`);
    async function as(role,uid=''){await db.exec(`reset role; set role ${role};`);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);}
    async function publish(kind,key,body,version){return db.query('select * from public.publish_editor_document($1,$2,$3::jsonb,$4)',[kind,key,JSON.stringify(body),version]);}
    await as('anon');
    await assert.rejects(publish('profile','owner-a',{bio:'forged'},0),/permission denied/);
    await assert.rejects(db.query('select * from editor_memberships'),/permission denied/);
    await as('authenticated',stranger);
    await assert.rejects(publish('profile','owner-a',{bio:'forged'},0),/editing access/);
    await as('authenticated',ownerA);
    assert.equal((await db.query('select * from editor_memberships')).rows.length,1);
    await assert.rejects(db.query("update editor_memberships set role='commissioner'"),/permission denied/);
    await assert.rejects(db.query("insert into editor_documents values ('profile','owner-a','{}',1,now())"),/permission denied/);
    await assert.rejects(publish('profile','owner-b',{bio:'forged'},0),/only your own/);
    await assert.rejects(publish('copy','home.headline',{text:'forged'},0),/only your own/);
    await assert.rejects(publish('profile','owner-a',{wins:'900'},0),/Unsupported field/);
    await assert.rejects(publish('profile','owner-a',{bio:'x'.repeat(601)},0),/field limit/);
    await assert.rejects(publish('profile','owner-a',{photo:'https://example.com/x.svg'},0),/supported photo/);
    await assert.rejects(publish('profile','owner-a',{ink:'red'},0),/supported card ink/);
    const first=await publish('profile','owner-a',{display_name:'Owner A',bio:'Hello'},0);
    assert.equal(first.rows[0].version,1);
    await assert.rejects(publish('profile','owner-a',{bio:'stale'},0),/newer version/);
    await publish('profile','owner-a',{bio:'Updated'},1);
    await assert.rejects(publish('profile','owner-a',{bio:'stale'},1),/newer version/);
    assert.equal((await db.query('select * from editor_revisions')).rows.length,2);
    await as('authenticated',ownerB);
    assert.equal((await db.query('select * from editor_revisions')).rows.length,0);
    await as('authenticated',commissioner);
    await publish('profile','owner-a',{bio:'Commissioner correction'},2);
    await publish('copy','home.headline',{text:'The weekly edition'},0);
    await assert.rejects(publish('copy','unapproved',{text:'x'},0),/not editable/);
    await assert.rejects(publish('copy','home.headline',{text:'x'.repeat(161)},1),/field limit/);
    assert.equal((await db.query('select * from editor_revisions')).rows.length,4);
    await publish('copy','owner.overview',{display:'hidden',text:''},0);
    await publish('copy','owner.overview',{display:'default',text:''},1);
    await publish('copy','section.owner.atlas',{display:'hidden'},0);
    await assert.rejects(publish('copy','owner.overview',{display:'bogus'},2),/Invalid display mode/);
    await as('authenticated',ownerA);
    await assert.rejects(publish('copy','section.owner.atlas',{display:'hidden'},1),/only your own/);
    await assert.rejects(publish('profile','owner-a',{display:'hidden'},3),/Unsupported field/);
    await as('authenticated',commissioner);
    await publish('copy','section.owner.atlas',{display:'default'},1);

    await as('anon');assert.equal((await db.query('select * from editor_documents')).rows.length,4);
    await assert.rejects(db.query('select * from editor_revisions'),/permission denied/);
    await as('postgres');await db.query('delete from editor_memberships where user_id=$1',[ownerA]);
    await as('authenticated',ownerA);
    await assert.rejects(publish('profile','owner-a',{bio:'revoked'},3),/editing access/);
  } finally {await db.close();}
});
