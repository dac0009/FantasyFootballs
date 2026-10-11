import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMeta } from '../lib/data';
import type { Session } from '@supabase/supabase-js';
import { canEdit, copyLabels, editorClient, preparePhoto, profileDefaults, type DocumentBody, type Membership, type PublishedDocument, resolvedCopy, sectionLabels } from '../lib/editor';
import '../styles/editor.css';

type PagePreview = {kind: 'copy' | 'profile'; key: string; body: DocumentBody; version: number};
type EditorContext = {
  pagePreview: PagePreview | null; setPagePreview: (value: PagePreview | null) => void;
  session: Session | null; member: Membership | null; ready: boolean; editMode: boolean;
  setEditMode: (value: boolean) => void; documents: PublishedDocument[]; error: string;
  replace: (doc: PublishedDocument) => void;
};
const Context = createContext<EditorContext>({ pagePreview:null, setPagePreview:()=>{}, session:null, member:null, ready:false, editMode:false, setEditMode:()=>{}, documents:[], error:'', replace:()=>{} });
export const useEditorial = () => useContext(Context);
export function EditorialProvider({ children }: { children: ReactNode }) {
  const sessionUser=useRef<string|null>(null);
  const [pagePreview,setPagePreview]=useState<PagePreview|null>(null);
  const [session,setSession]=useState<Session|null>(null), [member,setMember]=useState<Membership|null>(null);
  const [ready,setReady]=useState(!editorClient), [editMode,setEditMode]=useState(false);
  const [documents,setDocuments]=useState<PublishedDocument[]>([]), [error,setError]=useState('');
  useEffect(()=>{
    if(!editorClient)return;
    let alive=true;
    editorClient.from('editor_documents').select('*').then(({data,error})=>{
      if(!alive)return;
      if(error)setError('Custom content is temporarily unavailable. The league archive is still available.');
      else setDocuments(data ?? []);
    });
    const {data:{subscription}}=editorClient.auth.onAuthStateChange((_event,next)=>{
      if(alive){
        setSession(next);
        if(sessionUser.current!==(next?.user.id??null)){
          sessionUser.current=next?.user.id??null;setMember(null);setReady(!next);setEditMode(false);setPagePreview(null);
        } else if(!next)setReady(true);
      }
    });
    return ()=>{alive=false;subscription.unsubscribe();};
  },[]);
  useEffect(()=>{
    if(!editorClient || !session)return;
    let alive=true;
    editorClient.from('editor_memberships').select('*').eq('user_id',session.user.id).maybeSingle().then(({data,error})=>{
      if(alive){setMember(error?null:data);setReady(true);if(error)setError('Unable to check editing permissions. Please sign out and try again.');}
    });
    return ()=>{alive=false;};
  },[session]);
  return <Context.Provider value={{pagePreview,setPagePreview,session,member,ready,editMode,setEditMode,documents:pagePreview ? [...documents.filter(d=>d.kind!==pagePreview.kind||d.key!==pagePreview.key),{...pagePreview,updated_at:''}] : documents,error,replace:doc=>setDocuments(old=>[...old.filter(d=>d.kind!==doc.kind||d.key!==doc.key),doc])}}>{children}</Context.Provider>;
}
export function EditorToolbar(){
  const {member,editMode,setEditMode,pagePreview,setPagePreview,replace}=useEditorial();
  const [status,setStatus]=useState(''),[busy,setBusy]=useState(false);
  async function publishPreview(){
    if(!editorClient||!pagePreview||!canEdit(member,pagePreview.kind,pagePreview.key))return;
    setBusy(true);setStatus('');
    try{
      const {data,error}=await editorClient.rpc('publish_editor_document',{p_kind:pagePreview.kind,p_key:pagePreview.key,p_body:pagePreview.body,p_expected_version:pagePreview.version});
      if(error)throw error;
      const doc=Array.isArray(data)?data[0]:data;
      if(!doc?.version)throw new Error('Publication was not confirmed. Your preview is still here.');
      replace(doc);setPagePreview(null);setStatus('Published.');
    }catch(error){setStatus((error as {message?:string}).message??'Could not publish. Your preview is still here.');}finally{setBusy(false);}
  }
  return <div className="editor-toolbar shell"><Link to="/account">{member?'My account':'Owner sign in'}</Link>{member?.owner_id&&<Link to={`/owners/${member.owner_id}`}>My profile</Link>}{member?.role==='commissioner' && <><Link to="/admin">Admin</Link><button className="pill" aria-pressed={editMode} onClick={()=>setEditMode(!editMode)}>{editMode?'Finish editing':'Visual editor'}</button></>}
    {pagePreview&&<div className="page-preview-bar"><strong>Private preview · not published</strong><button className="pill" disabled={busy} onClick={()=>void publishPreview()}>Publish preview</button><button className="pill" disabled={busy} onClick={()=>{setPagePreview(null);setStatus('Preview discarded.');}}>Discard preview</button></div>}
    {status&&<span role="status">{status}</span>}
  </div>;
}
export function EditableText({id,fallback,as:Tag='span'}:{id:string;fallback:string;as?:'span'|'p'|'div'}){
  const {documents,member,editMode}=useEditorial();const [open,setOpen]=useState(false);
  const body=documents.find(d=>d.kind==='copy'&&d.key===id)?.body;
  const text=resolvedCopy(body,fallback);
  const editable=editMode&&member?.role==='commissioner';
  if(!text&&!editable)return null;
  return <Tag className={editable?'editable-text':''}>{text}{editable&&!text&&<span className="hidden-copy-label">{body?.display==='hidden'?'Hidden text':'Empty text'}</span>}{editable&&<button className="edit-text-button" onClick={e=>{e.preventDefault();e.stopPropagation();setOpen(true);}}>Edit {copyLabels[id]}</button>}{open&&<DocumentEditor kind="copy" documentKey={id} label={copyLabels[id]} fallback={fallback} onClose={()=>setOpen(false)}/>}</Tag>;
}
export function EditableSection({id,children}:{id:string;children:ReactNode}){
  const {documents,member,editMode}=useEditorial();const [open,setOpen]=useState(false);
  const hidden=documents.find(d=>d.kind==='copy'&&d.key===id)?.body.display==='hidden';
  const editing=member?.role==='commissioner'&&editMode;
  if(hidden&&!editing)return null;
  return <section className={editing?'editable-section':''} data-editor-section={id}>
    {editing&&<button className="pill section-edit-button" onClick={()=>setOpen(true)}>{hidden?'Hidden · ':'Section · '}{sectionLabels[id]}</button>}
    {hidden?<p className="hidden-copy-label">Hidden from visitors</p>:children}
    {open&&<DocumentEditor kind="copy" documentKey={id} label={sectionLabels[id]} fallback="" onClose={()=>setOpen(false)}/>}
  </section>;
}
export function ProfileEditorial({ownerId,name}:{ownerId:string;name:string}){
  const {documents,member}=useEditorial();const [open,setOpen]=useState(false);
  const body=documents.find(d=>d.kind==='profile'&&d.key===ownerId)?.body;
  return <section className="profile-editorial" aria-label="Owner introduction">
    {body?.bio&&<p>{body.bio}</p>}{body?.message&&<blockquote>{body.message}</blockquote>}
    {canEdit(member,'profile',ownerId)&&<button className="pill" onClick={()=>setOpen(true)}>Edit profile</button>}
    {open&&<DocumentEditor kind="profile" documentKey={ownerId} label={`${name} · Owner profile`} fallback={name} onClose={()=>setOpen(false)}/>}
  </section>;
}
export function DocumentEditor({kind,documentKey,label,fallback,onClose}:{kind:'profile'|'copy';documentKey:string;label:string;fallback:string;onClose:()=>void}){
  const {documents,member,session,replace,pagePreview,setPagePreview}=useEditorial();
  const location=useLocation(), navigate=useNavigate(), meta=useMeta();
  const isSection=documentKey.startsWith('section.');
  const conflictingPreview=!!pagePreview&&(pagePreview.kind!==kind||pagePreview.key!==documentKey);
  const current=documents.find(d=>d.kind===kind&&d.key===documentKey);
  const [version,setVersion]=useState(current?.version??0);
  const [body,setBody]=useState<DocumentBody>(current?.body??(kind==='profile'?{...profileDefaults}:{text:fallback,display:'default'}));
  const [status,setStatus]=useState(''),[busy,setBusy]=useState(false),[preview,setPreview]=useState(false);
  const [history,setHistory]=useState<PublishedDocument[]>([]);
  const dialog=useRef<HTMLDialogElement>(null);
  const previewRef=useRef<HTMLElement>(null);
  const titleId=useId();
  useEffect(()=>{if(preview)previewRef.current?.scrollIntoView({block:'nearest'});},[preview]);
  const draftKey=`ffbffl:draft:${session?.user.id}:${kind}:${documentKey}`;
  useEffect(()=>{const previous=document.activeElement as HTMLElement|null;dialog.current?.showModal();return ()=>previous?.focus();},[]);
  function previewOnPage(){
    setPagePreview({kind,key:documentKey,body,version});onClose();
    if(location.pathname!=='/admin')return;
    const page=documentKey.split('.')[0]==='site'?documentKey.split('.')[1]:documentKey.split('.')[0]==='section'?documentKey.split('.')[1]:documentKey.split('.')[0];
    const profile=`/owners/${member?.owner_id??'dominick-cifelli'}`;
    const routes:Record<string,string>={owner:profile,'owner-almanac':profile,'owner-career-atlas':profile,owners:'/owners','current-season':'/season',records:'/records','season-index':'/seasons','head-to-head':'/head-to-head',playoffs:'/playoffs',drafts:'/drafts'};
    const year=meta.state==='ready'?meta.data.current_season:null;
    if(year){routes.season=`/seasons/${year}`;routes.week=`/seasons/${year}/weeks/${meta.state==='ready'?(meta.data.current_week??1):1}`;}
    navigate(routes[page]??'/');
  }
  const allowed=canEdit(member,kind,documentKey);
  function field(key:string,value:string){setBody(old=>({...old,[key]:value,...(key==='text'?{display:'custom'}:{})}));setStatus('');}
  async function publish(){
    if(!editorClient||!allowed||conflictingPreview)return;setBusy(true);setStatus('');
    try{
      const {data,error}=await editorClient.rpc('publish_editor_document',{p_kind:kind,p_key:documentKey,p_body:body,p_expected_version:version});
      if(error)throw error;
      const published=(Array.isArray(data)?data[0]:data) as PublishedDocument;
      if(!published?.version)throw new Error('The server did not confirm publication. Refresh to check the latest version.');
      replace(published);setVersion(published.version);setPagePreview(null);
      try{sessionStorage.removeItem(draftKey);}catch{/* Publishing does not depend on browser storage. */}
      setStatus('Published. Your changes are now visible on the site.');setPreview(false);
    }catch(error){setStatus(error instanceof Error?error.message:(error as {message?:string}).message??'Publishing failed. Your edits are still here.');}
    finally{setBusy(false);}
  }
  function saveDraft(){try{sessionStorage.setItem(draftKey,JSON.stringify({body,version}));setStatus('Draft saved in this browser tab. It is not public.');}catch{setStatus('Draft could not be saved. Keep this editor open to preserve your changes.');}}
  function restoreDraft(){try{const value=JSON.parse(sessionStorage.getItem(draftKey)??'null');if(!value){setStatus('No draft saved in this tab.');return;}setBody(value.body);setVersion(value.version);setStatus('Draft restored. Preview before publishing.');}catch{setStatus('Unable to restore this draft.');}}
  async function loadHistory(){if(!editorClient)return;const {data,error}=await editorClient.from('editor_revisions').select('kind,key,body,version,updated_at').eq('kind',kind).eq('key',documentKey).order('version',{ascending:false}).limit(10);if(error)setStatus('History is unavailable. Try again.');else{setHistory(data??[]);if(!data?.length)setStatus('No published versions yet.');}}
  return createPortal(<dialog ref={dialog} aria-labelledby={titleId} className="editor-dialog" onCancel={e=>{if(busy)e.preventDefault();else onClose();}}>
    <div className="editor-heading"><div><span className="section-kicker">The editing desk</span><h2 id={titleId}>{label}</h2></div><button className="pill" disabled={busy} onClick={onClose} aria-label="Close editor">Close</button></div>
    <form onSubmit={e=>{e.preventDefault();setPreview(true);}}>
      {conflictingPreview&&<p role="status">Publish or discard your current page preview before editing another area.</p>}
      <fieldset disabled={busy||!allowed||conflictingPreview}>
        {kind==='profile'?<div className="editor-fields">
          <label>Display name<input maxLength={60} value={body.display_name??''} placeholder={fallback} onChange={e=>field('display_name',e.target.value)}/></label>
          <label>Short bio<textarea maxLength={600} value={body.bio??''} onChange={e=>field('bio',e.target.value)}/></label>
          <label>Message to the league<textarea maxLength={180} value={body.message??''} onChange={e=>field('message',e.target.value)}/></label>
          <label>Card ink<select value={body.ink??''} onChange={e=>field('ink',e.target.value)}><option value="">Original ink</option>{[['#193b48','Navy'],['#324c42','Forest'],['#603d46','Burgundy'],['#3d4059','Indigo'],['#624830','Bronze']].map(([value,name])=><option key={value} value={value}>{name}</option>)}</select></label>
          <label>Profile photo<input type="file" accept="image/jpeg,image/png,image/webp" onChange={async e=>{const file=e.target.files?.[0];if(!file)return;setBusy(true);try{field('photo',await preparePhoto(file));}catch(error){setStatus((error as Error).message);}finally{setBusy(false);}}}/><small>Square crop · JPG, PNG, or WebP · up to 8 MB</small></label>
          {body.photo&&<div><img className="editor-photo" src={body.photo} alt="Profile preview"/><button type="button" className="pill" onClick={()=>field('photo','')}>Remove photo</button></div>}
        </div>:<><label>Display<select aria-label="Display" value={body.display??'custom'} onChange={e=>field('display',e.target.value)}><option value="default">{isSection?'Show section':'Use original text'}</option>{!isSection&&<option value="custom">Use my text</option>}<option value="hidden">{isSection?'Hide section':'Hide text'}</option></select></label>{!isSection&&<label>Text<textarea aria-label="Text" maxLength={documentKey==='home.headline'?160:1200} value={body.text??''} placeholder={fallback||'Add an announcement'} onChange={e=>field('text',e.target.value)}/><small>Choose Hide text to remove it. Use original text restores the default.</small></label>}</>}
        <div className="editor-actions"><button className="pill" type="submit">Preview changes</button><button className="pill" type="button" disabled={!!pagePreview&&(pagePreview.kind!==kind||pagePreview.key!==documentKey)} onClick={previewOnPage}>Preview on page</button><button className="pill" type="button" onClick={saveDraft}>Save draft</button><button className="pill" type="button" onClick={restoreDraft}>Restore draft</button><button className="pill" type="button" onClick={()=>{void loadHistory();}}>Version history</button></div>
        {preview&&<section ref={previewRef} className="editor-preview" aria-label="Preview"><span className="section-kicker">Preview · not published</span>{kind==='profile'?<div style={{color:body.ink||'var(--ink)'}}>{body.photo&&<img className="editor-photo" src={body.photo} alt=""/>}<h3>{body.display_name||fallback}</h3><p>{body.bio}</p><blockquote>{body.message}</blockquote></div>:<p>{body.display==='hidden'?(isSection?'This section will be hidden.':'This text will be hidden.'):isSection?'This section will be shown.':resolvedCopy(body,fallback)||'No text'}</p>}<button className="pill" type="button" onClick={()=>{void publish();}}>Publish changes</button></section>}
        {history.length>0&&<section className="editor-history"><h3>Published versions</h3>{history.map(row=><button className="pill" type="button" key={row.version} onClick={()=>{setBody(row.body);setPreview(true);setStatus('Previous version loaded into preview. Publish to restore it.');}}>Version {row.version} · {new Date(row.updated_at).toLocaleString()}</button>)}</section>}
      </fieldset>
    </form>
    <p role="status">{busy?'Saving…':status}</p>
  </dialog>, document.body);
}
