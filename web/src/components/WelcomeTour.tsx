import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { useEditorial } from './Editorial';
import { useOwnerIndex } from '../lib/data';

export default function WelcomeTour(){
  const {session,member,ready}=useEditorial();
  if(!ready||!session||!member)return null;
  return <Tour key={session.user.id} userId={session.user.id} ownerId={member.owner_id} commissioner={member.role==='commissioner'}/>;
}
function Tour({userId,ownerId,commissioner}:{userId:string;ownerId:string|null;commissioner:boolean}){
  const location=useLocation(),navigate=useNavigate(),owners=useOwnerIndex();
  const {savedDocuments}=useEditorial();
  const storageKey=`ffbffl:welcome:v1:${userId}`;
  const [dismissed,setDismissed]=useState(()=>{try{return localStorage.getItem(storageKey)==='done';}catch{return false;}});
  const [open,setOpen]=useState(false),[step,setStep]=useState(0);
  const dialog=useRef<HTMLDialogElement>(null),heading=useRef<HTMLHeadingElement>(null);
  const profile=ownerId?`/owners/${ownerId}`:'/admin';
  const canonical=owners.state==='ready'?owners.data.find(o=>o.owner_id===ownerId)?.name:'';
  const name=savedDocuments.find(d=>d.kind==='profile'&&d.key===ownerId)?.body.display_name||canonical||'Commissioner';
  const steps=[
    {title:`Welcome, ${name}`,text:'This is your league profile. Your career record, owner card, and season history all start here.',path:profile},
    {title:'Make your profile yours',text:'Choose Edit profile to change your photo, display name, bio, league message, or card color. Publish changes saves to the live site. A preview or tab draft stays private.',path:profile},
    {title:'Find your way around',text:'This week opens the league front page. Standings, Records, and Owners are in the navigation. On your phone, tap Menu for all pages. My profile always brings you back.',path:'/home'},
    {title:'Explore the league',text:'In Playoff explorer, try picking future game winners to see how the outlook changes. Head to head compares owners. The Glossary explains the metrics.',path:'/playoffs'},
    ...(commissioner?[{title:'Your commissioner desk',text:'Admin lets you edit every owner profile and site text. Visual editor reveals editable areas on each page. After publishing, Refresh saved content in Admin checks the saved versions in Supabase.',path:'/admin'}]:[]),
  ];
  useEffect(()=>{
    if(!dismissed&&location.pathname===profile&&owners.state==='ready')setOpen(true);
  },[dismissed,location.pathname,profile,owners.state]);
  useEffect(()=>{
    const launch=()=>{setStep(0);setOpen(true);navigate(profile);};
    window.addEventListener('ffbffl:tour',launch);
    return ()=>window.removeEventListener('ffbffl:tour',launch);
  },[navigate,profile]);
  useEffect(()=>{
    if(!open)return;
    const previous=document.activeElement as HTMLElement|null;
    dialog.current?.showModal();
    return ()=>{if(previous?.isConnected)previous.focus();};
  },[open]);
  useEffect(()=>{if(open)heading.current?.focus();},[open,step]);
  function finish(){
    setDismissed(true);setOpen(false);
    try{localStorage.setItem(storageKey,'done');}catch{/* Still dismissed for this session. */}
  }
  function move(next:number){setStep(next);navigate(steps[next].path);}
  if(!open)return null;
  const current=steps[step];
  return createPortal(<dialog ref={dialog} className="editor-dialog welcome-tour" aria-labelledby="welcome-title" aria-describedby="welcome-description" onCancel={e=>{e.preventDefault();finish();}}>
    <span className="section-kicker">The league guide · {step+1} of {steps.length}</span>
    <h2 id="welcome-title" tabIndex={-1} ref={heading}>{current.title}</h2>
    <p id="welcome-description">{current.text}</p>
    <p className="figure-label">Replay anytime with Site guide in the toolbar.</p>
    <div className="editor-actions"><button className="pill" onClick={finish}>Skip tour</button>{step>0&&<button className="pill" onClick={()=>move(step-1)}>Back</button>}{step<steps.length-1?<button className="pill publish-primary" onClick={()=>move(step+1)}>Next</button>:<button className="pill publish-primary" onClick={()=>{finish();navigate(profile);}}>Open my profile</button>}</div>
  </dialog>,document.body);
}
