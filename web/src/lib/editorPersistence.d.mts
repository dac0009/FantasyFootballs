import type { SupabaseClient } from '@supabase/supabase-js';
import type { DocumentBody, PublishedDocument } from './editor';
export function publishAndVerify(client: SupabaseClient, kind: string, key: string, body: DocumentBody, version: number): Promise<{document: PublishedDocument; verified: boolean}>;
