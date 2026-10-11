import { useState } from 'react';
import { Link } from 'react-router-dom';
import { DocumentEditor, useEditorial } from '../components/Editorial';
import { copyDefaults, copyLabels, sectionLabels } from '../lib/editor';
export default function Admin(){
  const {member,ready,documents,setEditMode}=useEditorial();
  const [search,setSearch]=useState(''),[selected,setSelected]=useState<string|null>(null);
  if(!ready)return <div className="shell account-page">Checking access…</div>;
  if(member?.role!=='commissioner')return <div className="shell account-page"><h1>Commissioner access</h1><p>Sign in with your commissioner account to edit site content.</p><Link to="/account">Sign in</Link></div>;
  const rows=Object.entries(copyLabels).filter(([key,label])=>`${label} ${copyDefaults[key]??''}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="shell admin-page"><span className="section-kicker">Commissioner</span><h1>Site editor</h1>
    <p>Change text, hide sections, or restore the originals. Shared headings apply across the same page template.</p>
    <div className="admin-links">{[['/','Home'],['/owners','Owners'],['/owners/dominick-cifelli','My profile'],['/season','Standings'],['/head-to-head','Head to head'],['/playoffs','Playoffs'],['/records','Records'],['/seasons','Seasons'],['/drafts','Drafts']].map(([to,label])=><Link key={to} className="pill" to={to} onClick={()=>setEditMode(true)}>{label}</Link>)}</div>
    <label className="admin-search">Find text or sections<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search a phrase or page name"/></label>
    <p className="figure-label">{rows.length} editable areas</p>
    <div className="admin-list">{rows.map(([key,label])=>{const body=documents.find(d=>d.kind==='copy'&&d.key===key)?.body;return <button key={key} onClick={()=>setSelected(key)}><strong>{label}</strong><span>{body?.display==='hidden'?'Hidden':body?.display==='default'?'Original':body?.text?'Custom':sectionLabels[key]?'Visible':'Original'}</span></button>;})}</div>
    {selected&&<DocumentEditor key={selected} kind="copy" documentKey={selected} label={copyLabels[selected]} fallback={copyDefaults[selected]??''} onClose={()=>setSelected(null)}/>}
  </div>;
}
