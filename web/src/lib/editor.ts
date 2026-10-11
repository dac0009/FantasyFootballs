import { editorialCatalog } from './editorCatalog';
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const editorClient = url && key ? createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
}) : null;
export type Profile = { display_name: string; bio: string; message: string; ink: string; photo: string };
export type DocumentBody = Partial<Profile> & { text?: string; display?: string };
export type PublishedDocument = { kind: 'profile' | 'copy'; key: string; body: DocumentBody; version: number; updated_at: string };
export type Membership = { user_id: string; owner_id: string | null; role: 'owner' | 'commissioner' };
export const profileDefaults: Profile = { display_name: '', bio: '', message: '', ink: '', photo: '' };
export const sectionLabels: Record<string,string> = {
  'section.home.playoffs':'Home · playoff picture', 'section.home.previews':'Home · matchup previews',
  'section.home.results':'Home · weekly results', 'section.home.milestones':'Home · milestones',
  'section.owner.atlas':'Owner profiles · career atlas', 'section.owner.reel':'Owner profiles · game reel',
};
export const copyLabels: Record<string, string> = {
  'home.headline': 'Front-page headline', 'home.intro': 'Front-page introduction',
  'home.announcement': 'League announcement', 'owners.intro': 'Owner directory introduction',
  'masthead.motto': 'Masthead motto',
  'owner.overview': 'Owner profile · career heading',
  'owner.collection': 'Owner profile · collection label',
  'masthead.title': 'Publication name',
  'masthead.folio': 'Publication description',
  ...Object.fromEntries(Object.entries(editorialCatalog).map(([key,value])=>[key,value.label])),
  ...Object.fromEntries(Object.entries(sectionLabels).map(([key,value])=>[key,value])),
};
export function canEdit(member: Membership | null, kind: string, key: string) {
  return !!member && (member.role === 'commissioner' || (kind === 'profile' && member.owner_id === key));
}
export async function preparePhoto(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024)
    throw new Error('Choose a JPG, PNG, or WebP under 8 MB.');
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 480;
    const context = canvas.getContext('2d'); if (!context) throw new Error('Photo processing is unavailable.');
    const edge = Math.min(bitmap.width, bitmap.height);
    context.fillStyle = '#eee6d5'; context.fillRect(0, 0, 480, 480);
    context.drawImage(bitmap, (bitmap.width-edge)/2, (bitmap.height-edge)/2, edge, edge, 0, 0, 480, 480);
    const value = canvas.toDataURL('image/jpeg', .8);
    if (value.length > 300000) throw new Error('This photo is too detailed. Choose a smaller image.');
    return value;
  } finally { bitmap.close(); }
}

export const copyDefaults: Record<string,string> = {
  'home.headline':'', 'home.intro':'', 'home.announcement':'', 'owners.intro':'Career records by owner · Regular season',
  'masthead.motto':'', 'owner.overview':'Career overview', 'owner.collection':'Owners',
  'masthead.title':'The Record', 'masthead.folio':'Fantasy football',
  ...Object.fromEntries(Object.entries(editorialCatalog).map(([key,value])=>[key,value.fallback])),
};
export function resolvedCopy(body: DocumentBody | undefined, fallback: string) {
  if(body?.display==='hidden')return '';
  if(body?.display==='default')return fallback;
  return body?.text || fallback;
}
