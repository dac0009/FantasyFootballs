import test from 'node:test';
import assert from 'node:assert/strict';
import { createLoginHandler, roster } from '../../supabase/functions/league-login/handler.mjs';
import { readFileSync } from 'node:fs';

function fixture() {
  const members=new Map(),users=new Map();
  let nextId=0, grants=0;
  const admin={
    from(){return {
      select(){return {eq(_key,owner){return {async maybeSingle(){return {data:members.get(owner)||null,error:null};}};}};},
      async insert(value){members.set(value.owner_id,{...value});return {error:null};},
    };},
    auth:{admin:{
      async createUser({email}){if([...users.values()].some(u=>u.email===email))return {error:new Error('Exists'),data:{}};
        const user={id:String(++nextId),email};users.set(user.id,user);return {data:{user},error:null};},
      async getUserById(id){return {data:{user:users.get(id)},error:null};},
      async generateLink({email}){grants++;return {data:{properties:{hashed_token:email}},error:null};},
    }},
  };
  const session=user=>({data:{session:{user,access_token:'access-'+user.id,refresh_token:'refresh-'+user.id}},error:null});
  const auth={auth:{
    async verifyOtp({token_hash}){return session([...users.values()].find(u=>u.email===token_hash));},
    async signInWithPassword({email,password}){if(password!=='private-password')return {data:{},error:new Error('Wrong')};return session([...users.values()].find(u=>u.email===email));},
  }};
  const handler=createLoginHandler({admin,auth});
  async function login(body){const response=await handler(new Request('https://example.test',{method:'POST',body:JSON.stringify(body)}));return {status:response.status,body:await response.json(),headers:response.headers};}
  return {members,users,admin,auth,handler,login,grants:()=>grants};
}
test('surname login creates a scoped owner, normalizes case, reuses account, and ignores caller role',async()=>{
  const f=fixture();
  const first=await f.login({mode:'owner',surname:'  FrAnK ',role:'commissioner',owner_id:'dominick-cifelli'});
  assert.equal(first.status,200);assert.equal(first.headers.get('cache-control'),'no-store');
  assert.deepEqual(f.members.get('jakob-frank'),{user_id:'1',owner_id:'jakob-frank',role:'owner'});
  assert.deepEqual(Object.keys(first.body).sort(),['access_token','refresh_token']);
  assert.equal((await f.login({mode:'owner',surname:'frank'})).status,200);
  assert.equal(f.users.size,1);
});
test('unknown/prototype names and commissioner surname cannot create sessions',async()=>{
  const f=fixture();
  for(const surname of ['unknown','__proto__','constructor','toString','','dominick-cifelli'])
    assert.equal((await f.login({mode:'owner',surname})).status,400);
  assert.equal((await f.login({mode:'owner',surname:' CIFELLI '})).status,403);
  assert.equal(f.users.size,0);assert.equal(f.grants(),0);
});
test('commissioner uses private password with no caller-controlled email or UUID',async()=>{
  const f=fixture();f.users.set('admin',{id:'admin',email:'private@example.test'});
  f.members.set('dominick-cifelli',{user_id:'admin',owner_id:'dominick-cifelli',role:'commissioner'});
  assert.equal((await f.login({mode:'commissioner',password:'cifelli'})).status,401);
  const result=await f.login({mode:'commissioner',password:'private-password',email:'attacker@example.test'});
  assert.equal(result.status,200);assert.equal(result.body.access_token,'access-admin');
  assert.equal(f.grants(),0);
});
test('removed membership stays revoked; owner endpoint cannot issue elevated or mismatched sessions',async()=>{
  const f=fixture();await f.login({mode:'owner',surname:'hill'});
  const original=f.members.get('preston-hill');f.members.delete('preston-hill');
  assert.equal((await f.login({mode:'owner',surname:'hill'})).status,403);
  f.members.set('preston-hill',{...original,role:'commissioner'});
  assert.equal((await f.login({mode:'owner',surname:'hill'})).status,403);
  f.members.set('preston-hill',original);
  f.auth.auth.verifyOtp=async()=>({data:{session:{user:{id:'admin'},access_token:'bad',refresh_token:'bad'}}});
  const result=await f.login({mode:'owner',surname:'hill'});
  assert.equal(result.status,503);assert.equal(result.body.access_token,undefined);
});
test('existing email accounts are not silently converted; malformed requests fail cleanly',async()=>{
  const f=fixture();f.users.set('old',{id:'old',email:'personal@example.test'});
  f.members.set('preston-hill',{user_id:'old',owner_id:'preston-hill',role:'owner'});
  assert.equal((await f.login({mode:'owner',surname:'hill'})).status,403);
  assert.equal(f.grants(),0);
  assert.equal((await f.login(null)).status,400);
  assert.equal((await f.login({mode:'owner',surname:'x'.repeat(2100)})).status,400);
  assert.equal((await f.handler(new Request('https://example.test'))).status,405);
  assert.equal((await f.handler(new Request('https://example.test',{method:'OPTIONS'}))).status,200);
});
test('surname roster matches current canonical owner profiles (including Frank suffix)',()=>{
  const owners=JSON.parse(readFileSync(new URL('../../data/owners.json',import.meta.url),'utf8'));
  const season=Math.max(...owners.map(o=>o.last_season));
  const expected=Object.fromEntries(owners.filter(o=>o.last_season===season&&o.owner_id!=='dominick-cifelli').map(o=>[o.name.split(' ').at(-1).toLowerCase(),o.owner_id]));
  assert.deepEqual({...roster},expected);
});
test('membership changes during token issuance prevent returning the session',async()=>{
  const f=fixture();await f.login({mode:'owner',surname:'ripple'});
  const verify=f.auth.auth.verifyOtp;
  f.auth.auth.verifyOtp=async args=>{const result=await verify(args);f.members.set('justin-ripple',{...f.members.get('justin-ripple'),role:'commissioner'});return result;};
  const result=await f.login({mode:'owner',surname:'ripple'});
  assert.equal(result.status,403);assert.equal(result.body.access_token,undefined);
});
