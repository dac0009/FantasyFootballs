import { useState } from 'react';
import { Link } from 'react-router-dom';
import { DocumentEditor, useEditorial } from '../components/Editorial';
import { copyDefaults, copyLabels, sectionLabels } from '../lib/editor';
import { useOwnerIndex } from '../lib/data';
export default function Admin(){
  const {member,ready,documents,setEditMode,savedDocuments,checkedAt,refreshSaved,pagePreview}=useEditorial();
  const owners=useOwnerIndex();
  const [profile,setProfile]=useState<{id:string;name:string}|null>(null);
  const [checking,setChecking]=useState(false),[checkStatus,setCheckStatus]=useState('');
  async function checkSaved(){setChecking(true);setCheckStatus('');try{await refreshSaved();setCheckStatus('Saved content refreshed directly from Supabase.');}catch(error){setCheckStatus((error as Error).message);}finally{setChecking(false);}}
  const [search,setSearch]=useState(''),[selected,setSelected]=useState<string|null>(null);
  if(!ready)return <div className="shell account-page">Checking access…</div>;
  if(member?.role!=='commissioner')return <div className="shell account-page"><h1>Commissioner access</h1><p>Sign in with your commissioner account to edit site content.</p><Link to="/account">Sign in</Link></div>;
  const latest=[...savedDocuments].sort((a,b)=>b.updated_at.localeCompare(a.updated_at));
  const currentOwners=owners.state==='ready'?owners.data.filter(o=>o.last_season===Math.max(...owners.data.map(row=>row.last_season??0))):[];
  const signInUrl=window.location.origin+import.meta.env.BASE_URL+'account';
  const shareText=`League profile editor: ${signInUrl}\nChoose Owner sign-in and enter your last name:\n`+currentOwners.filter(o=>o.owner_id!=='dominick-cifelli').map(o=>`${o.name}: ${o.name.trim().split(/\s+/).at(-1)!.toLowerCase()}`).join('\n');
  const rows=Object.entries(copyLabels).filter(([key,label])=>`${label} ${copyDefaults[key]??''}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="shell admin-page"><span className="section-kicker">Commissioner</span><h1>Site editor</h1>
    <p>Change text, hide sections, or restore the originals. Shared headings apply across the same page template.</p>
    <section className="admin-panel" aria-label="Saved content status"><h2>Saved on the live site</h2>
      <p>{checkedAt?`${savedDocuments.length} saved areas · last checked ${new Date(checkedAt).toLocaleString()}`:'Saved content has not been confirmed yet.'}</p>
      <p>Publish changes saves directly to Supabase. Visitors see the update when they reload. GitHub deployment is only needed for code changes.</p>
      {pagePreview&&<p><strong>You have a private preview that has not been published.</strong></p>}
      <button className="pill" disabled={checking} onClick={()=>void checkSaved()}>{checking?'Checking Supabase…':'Refresh saved content'}</button>
      <p role="status">{checkStatus}</p>
      {latest.length>0?<ul className="save-activity">{latest.slice(0,8).map(d=><li key={`${d.kind}:${d.key}`}><strong>{copyLabels[d.key]??d.key}</strong><span>Version {d.version} · {new Date(d.updated_at).toLocaleString()}</span></li>)}</ul>:<p>No saved publications loaded.</p>}
    </section>
    <section className="admin-panel" aria-label="Owner access"><h2>Owners &amp; sign-in</h2>
      <p>Owners use the last names below; there are no separate owner passwords. Your commissioner password remains private.</p>
      <p>This list shows sign-in names and profile publications, not login history. Accounts are created on first sign-in.</p>
      <div className="admin-list">{currentOwners.map(o=>{const saved=savedDocuments.find(d=>d.kind==='profile'&&d.key===o.owner_id);return <button key={o.owner_id} onClick={()=>setProfile({id:o.owner_id,name:o.name})}><strong>{o.name}</strong><span>{o.owner_id==='dominick-cifelli'?'Commissioner · private password':`Sign-in: ${o.name.trim().split(/\s+/).at(-1)!.toLowerCase()}`}</span><span>{saved?`Profile saved ${new Date(saved.updated_at).toLocaleString()}`:'No profile edits published yet'}</span><span>Edit profile</span></button>;})}</div>
      {owners.state!=='ready'&&<p>Owner list is unavailable while league data loads. Reload if it does not appear.</p>}
      <label className="share-access">Copy this for the league<textarea readOnly value={shareText} rows={8} onFocus={e=>e.target.select()}/></label>
    </section>
    <div className="admin-links">{[['/home','Home'],['/owners','Owners'],['/owners/dominick-cifelli','My profile'],['/season','Standings'],['/head-to-head','Head to head'],['/playoffs','Playoffs'],['/records','Records'],['/seasons','Seasons'],['/drafts','Drafts']].map(([to,label])=><Link key={to} className="pill" to={to} onClick={()=>setEditMode(true)}>{label}</Link>)}</div>
    <label className="admin-search">Find text or sections<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search a phrase or page name"/></label>
    <p className="figure-label">{rows.length} editable areas</p>
    <div className="admin-list">{rows.map(([key,label])=>{const body=documents.find(d=>d.kind==='copy'&&d.key===key)?.body;return <button key={key} onClick={()=>setSelected(key)}><strong>{label}</strong><span>{body?.display==='hidden'?'Hidden':body?.display==='default'?'Original':body?.text?'Custom':sectionLabels[key]?'Visible':'Original'}</span></button>;})}</div>
    {profile&&<DocumentEditor key={profile.id} kind="profile" documentKey={profile.id} label={`${profile.name} · Owner profile`} fallback={profile.name} onClose={()=>setProfile(null)}/>}
    {selected&&<DocumentEditor key={selected} kind="copy" documentKey={selected} label={copyLabels[selected]} fallback={copyDefaults[selected]??''} onClose={()=>setSelected(null)}/>}
  </div>;
}
