import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useEditorial } from '../components/Editorial';
import { editorClient } from '../lib/editor';
export default function Account(){
  const {session,member,ready,error}=useEditorial();
  const [mode,setMode]=useState<'owner'|'commissioner'>('owner');
  const [surname,setSurname]=useState(''),[password,setPassword]=useState('');
  const [busy,setBusy]=useState(false),[status,setStatus]=useState('');
  async function login(){
    if(!editorClient)return;
    setBusy(true);setStatus('');
    try{
      const result=await editorClient.functions.invoke('league-login',{body:mode==='owner'?{mode,surname:surname.trim()}:{mode,password}});
      if(result.error){
        let message='Sign-in is unavailable. Ask Dominick to check that league-login is deployed.';
        try{const body=await result.error.context?.json();if(body?.error)message=body.error;}catch{/* Network failure has no JSON body. */}
        throw new Error(message);
      }
      if(!result.data?.access_token||!result.data?.refresh_token)throw new Error('No session was returned. Please try again.');
      const signedIn=await editorClient.auth.setSession(result.data);
      if(signedIn.error)throw signedIn.error;
      setPassword('');setStatus('Signed in.');
    }catch(error){setStatus((error as Error).message);}finally{setBusy(false);}
  }
  return <div className="shell account-page"><span className="section-kicker">The owners’ entrance</span><h1>Owner account</h1>
    {!editorClient?<p>Owner sign-in is being set up. The public league archive remains available.</p>:!ready?<p>Checking your account…</p>:session?<>
      <p>{member?.role==='commissioner'?'Commissioner access':member?'Owner access':'Checking editing access…'}</p>
      {member?<><p>{member.role==='commissioner'?'Open the editing desk or use “Visual editor” above.':'You can edit your profile’s photo, name, bio, message, and card color.'}</p>
        {member.owner_id&&<Link className="pill" to={`/owners/${member.owner_id}`}>Open my profile</Link>} {' '}
        {member.role==='commissioner'&&<Link className="pill" to="/admin">Open editing desk</Link>}
      </>:<p>Your account has no editing membership. Ask the commissioner to check your access.</p>}
      <p><button className="pill" disabled={busy} onClick={async()=>{setBusy(true);try{const {error}=await editorClient!.auth.signOut();if(error)throw error;setPassword('');setStatus('');}catch(error){setStatus((error as Error).message);}finally{setBusy(false);}}}>Sign out</button></p>
    </>:<>
      <div className="editor-actions" aria-label="Sign-in options">
        <button className="pill" aria-pressed={mode==='owner'} disabled={busy} onClick={()=>{setMode('owner');setPassword('');setStatus('');}}>Owner sign-in</button>
        <button className="pill" aria-pressed={mode==='commissioner'} disabled={busy} onClick={()=>{setMode('commissioner');setStatus('');}}>Commissioner sign-in</button>
      </div>
      <form onSubmit={e=>{e.preventDefault();void login();}}>
        {mode==='owner'?<><p>Your last name opens your profile editor. No email or account setup.</p><label>Last name<input autoComplete="family-name" autoCapitalize="none" spellCheck={false} required maxLength={80} value={surname} disabled={busy} onChange={e=>setSurname(e.target.value)}/></label></>:<><p>Use your private commissioner password to open the editing desk.</p><input type="text" name="username" autoComplete="username" value="commissioner" hidden readOnly/><label>Commissioner password<input type="password" autoComplete="current-password" required maxLength={256} value={password} disabled={busy} onChange={e=>setPassword(e.target.value)}/></label></>}
        <div className="editor-actions"><button className="pill" disabled={busy}>{busy?'Signing in…':'Sign in'}</button></div>
      </form>
    </>}
    <p role="status">{status||error}</p><p><Link to="/">Back to the league</Link></p>
  </div>;
}
