import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
import { createLoginHandler } from './handler.mjs';

// Keep privileged credentials only in the Edge Function. Never in Vite variables.
Deno.serve((request: Request) => {
  const url = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  // Separate clients per request: password/OTP login must not replace admin auth.
  return createLoginHandler({
    admin: createClient(url, serviceKey, options),
    auth: createClient(url, anonKey, options),
  })(request);
});
