import test from 'node:test';
import assert from 'node:assert/strict';
import { publishAndVerify } from '../src/lib/editorPersistence.mjs';
const document={kind:'copy',key:'home.headline',body:{text:'Saved text',display:'custom'},version:2,updated_at:'2026-10-11T16:00:00Z'};
function client(write,read){return {rpc:async()=>write,from(){return {select(){return {eq(){return {eq(){return {single:async()=>{if(read instanceof Error)throw read;return read;}};}};}};}};}};}
test('publication verifies saved content with a separate database read',async()=>{
  const result=await publishAndVerify(client({data:[document]},{data:{...document,body:{display:'custom',text:'Saved text'}}}),'copy','home.headline',document.body,1);
  assert.equal(result.verified,true);assert.equal(result.document.version,2);
});
test('failed writes never report successful publication',async()=>{
  await assert.rejects(publishAndVerify(client({error:new Error('Permission denied')},{}),'copy','home.headline',{},1),/Permission denied/);
});
test('missing or wrong RPC results never report successful publication',async()=>{
  for(const data of [null,[],{...document,key:'wrong'}])await assert.rejects(publishAndVerify(client({data},{}),'copy','home.headline',{},1),/did not confirm/);
});
test('read failures or conflicting content preserve acknowledged version without claiming verification',async()=>{
  for(const read of [{error:new Error('Offline')},new Error('Network'),{data:{...document,version:3}},{data:{...document,body:{text:'Different'}}}]){
    const result=await publishAndVerify(client({data:document},read),'copy','home.headline',{},1);
    assert.equal(result.verified,false);assert.equal(result.document.version,2);
  }
});
