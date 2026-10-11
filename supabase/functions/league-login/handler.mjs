// Surname access is intentionally shared access, not proof of identity.
// This fixed roster, never caller-supplied IDs or roles, determines membership.
export const roster = Object.freeze({
  fidler: 'mikey-fidler', ripple: 'justin-ripple', williams: 'dylan-williams',
  campese: 'dom-campese', cameron: 'russell-cameron', frank: 'jakob-frank-2',
  patel: 'abhik-patel', turner: 'dylan-turner', hill: 'preston-hill',
  kuiken: 'tyler-kuiken', johnson: 'jack-johnson',
});
const commissionerOwner = 'dominick-cifelli';
const cors = { 'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store' };
const reply = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json' },
});
export function createLoginHandler({ admin, auth }) {
  const membership = async (owner) => {
    const result = await admin.from('editor_memberships').select('user_id,owner_id,role').eq('owner_id', owner).maybeSingle();
    if (result.error) throw new Error('Membership lookup failed');
    return result.data;
  };
  return async (request) => {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'POST') return reply(405, { error: 'Use POST.' });
    try {
      const raw = await request.text();
      if (raw.length > 2048) return reply(400, { error: 'Sign-in request is too long.' });
      let input;
      try { input = JSON.parse(raw); } catch { return reply(400, { error: 'Invalid sign-in request.' }); }
      if (!input || typeof input !== 'object') return reply(400, { error: 'Invalid sign-in request.' });
      let result;
      let expected;
      if (input.mode === 'commissioner') {
        if (typeof input.password !== 'string' || !input.password || input.password.length > 256)
          return reply(400, { error: 'Enter your commissioner password.' });
        expected = await membership(commissionerOwner);
        if (!expected || expected.role !== 'commissioner')
          return reply(403, { error: 'Commissioner access is not configured.' });
        const user = await admin.auth.admin.getUserById(expected.user_id);
        if (user.error || !user.data.user?.email) throw new Error('Commissioner account unavailable');
        result = await auth.auth.signInWithPassword({ email: user.data.user.email, password: input.password });
      } else if (input.mode === 'owner') {
        const surname = typeof input.surname === 'string' ? input.surname.trim().toLowerCase() : '';
        if (surname === 'cifelli') return reply(403, { error: 'Use Commissioner sign-in with your private password.' });
        if (!Object.hasOwn(roster, surname)) return reply(400, { error: 'Use the last name shown on your league profile.' });
        const owner = roster[surname];
        const email = `${owner}@owners.ffbffl.invalid`;
        expected = await membership(owner);
        if (!expected) {
          // createUser does not send an email. Existing Auth users are never
          // adopted: a removed membership therefore stays revoked on later logins.
          const created = await admin.auth.admin.createUser({ email, email_confirm: true });
          if (created.error || !created.data.user) {
            expected = await membership(owner); // another first login may have won
            if (!expected) return reply(403, { error: 'This profile needs commissioner setup. Please contact Dominick.' });
          } else {
            const inserted = await admin.from('editor_memberships').insert({
              user_id: created.data.user.id, owner_id: owner, role: 'owner',
            });
            if (inserted.error) throw new Error('Membership creation failed');
            expected = await membership(owner);
          }
        }
        if (!expected || expected.role !== 'owner') return reply(403, { error: 'This account cannot use owner sign-in.' });
        const user = await admin.auth.admin.getUserById(expected.user_id);
        if (user.error || user.data.user?.email !== email)
          return reply(403, { error: 'This profile needs commissioner setup. Please contact Dominick.' });
        // Generate and consume internally: no email delivery or email field in UI.
        const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
        if (link.error || !link.data.properties?.hashed_token) throw new Error('Session link failed');
        result = await auth.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: 'magiclink' });
      } else return reply(400, { error: 'Choose owner or commissioner sign-in.' });
      if (result.error || !result.data.session) return reply(401, { error: 'Sign-in failed. Check your password or try again shortly.' });
      const session = result.data.session;
      if (session.user.id !== expected.user_id) throw new Error('Session identity mismatch');
      // Recheck after session issuance; never return a session for an escalated role.
      const current = await membership(expected.owner_id);
      if (!current || current.user_id !== expected.user_id || current.role !== expected.role)
        return reply(403, { error: 'Editing access changed. Please contact the commissioner.' });
      return reply(200, { access_token: session.access_token, refresh_token: session.refresh_token });
    } catch {
      return reply(503, { error: 'Sign-in is unavailable. Ask the commissioner to check the league-login function setup.' });
    }
  };
}
