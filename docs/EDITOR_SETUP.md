# Owner accounts and the editing desk

The site stays on GitHub Pages. Supabase stores authenticated memberships, published profile/text overrides, and revision history. ESPN files remain the source of scores and records. This migration never alters them.

## Last-name sign-in upgrade

Owners enter their last name at `/account`. Capitalization and surrounding spaces do not matter. First sign-in creates a profile-only account automatically; no invitation, email delivery, or owner setup is needed. This deliberately allows anyone who knows a listed surname to edit that owner's public profile. It is shared profile access, not identity verification.

Dominick uses **Commissioner sign-in** and the private password on his existing Supabase Auth user. Typing Cifelli in the owner form never grants commissioner access. His password is not a Supabase dashboard / GitHub password unless he deliberately used the same one when creating that separate Auth user.

### Activate on the existing project

The two SQL migrations already applied are sufficient. Do not rerun the first migration or replace existing memberships.

1. Deploy `supabase/functions/league-login` to the existing Supabase project **before merging the frontend PR**. From a checkout of this branch in a terminal with Node installed:

   ```sh
   npx supabase login
   npx supabase functions deploy league-login --project-ref yrqytwfpoksuefnvlwwp --no-verify-jwt
   ```

   No Docker is needed for hosted deployment. Alternatively, open [the project's Edge Functions](https://supabase.com/dashboard/project/yrqytwfpoksuefnvlwwp/functions), choose **Deploy a new function → Via Editor**, name it **league-login**, replace `index.ts` with the repository's `index.ts`, and add `handler.mjs` alongside it with the repository's contents. Deploy, then turn **Verify JWT with legacy secret** off for this function. It accepts signed-out visitors; the handler checks access before issuing a session. `supabase/config.toml` configures this for CLI deployment.
2. Keep Supabase's **Email provider enabled**, because the backend uses Supabase Auth internally. No emails are sent and no SMTP setup is needed for this login flow. Keep public new-user signups disabled. Hosted functions already receive `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. Do not paste a service-role key into GitHub variables, browser code, or chat.
3. Use the password set when creating Dominick's Auth user (`3e52108b-bc6e-4aa1-9c5a-04c48b5cc0c5`). If forgotten, reset that existing user's password through Supabase administration; do not create a replacement commissioner user. The function looks up the commissioner through the existing database membership and never changes its password.
4. Merge the PR and wait for [GitHub Actions](https://github.com/dac0009/FantasyFootballs/actions) to finish. The existing `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` repository variables stay as they are.
5. Open [Owner account](https://dac0009.github.io/FantasyFootballs/account). Check owner sign-in with `Frank`, then sign out and check **Commissioner sign-in** with your private password. Owner sessions should expose only their own profile editor; commissioner sessions should expose **Open editing desk** and **Visual editor**. Share the account-page link with the league after both checks work.

The frontend PR alone does not deploy an Edge Function. A “sign-in unavailable” message usually means the function has not been deployed, its JWT verification is still enabled, or the Email provider is disabled. Inspect the function logs without sharing tokens or passwords.

### Membership maintenance

The surname roster is explicitly allowlisted in `supabase/functions/league-login/handler.mjs`. It covers the 11 current owners other than Dominick, including `frank → jakob-frank-2`. Update and redeploy it when league membership changes; changing a profile display name does not change sign-in.

New owner Auth users have an internal address ending `@owners.ffbffl.invalid`; it is not a mailbox. All editing still goes through the existing row permissions and publishing function. The frontend cannot choose its owner ID or role. The login function only creates role `owner`, never promotes anyone, and never sends privileged credentials to the browser.

If an owner already has a manually provisioned personal-email membership, the function stops with a setup message instead of silently taking over that account. To transition that owner, use the Supabase SQL editor to remove only their old `editor_memberships` row, leaving the old Auth user and revision history intact; then use surname sign-in to create their new profile-only account. This does not delete their published profile.

To revoke a surname account, remove its membership **and leave its Auth user in place**. Repeat login will fail instead of recreating the membership. To permanently retire the owner, also remove their surname from the function roster and redeploy. Deleting both Auth user and membership while keeping the surname allowlisted enables first-time provisioning again. Restore a revoked account by restoring its original owner membership through the SQL editor.

For a fresh project, run migrations `202610110001_editor.sql` and `202610110002_visual_editor.sql` in order, create the commissioner Auth user with a private password, assign its membership to `dominick-cifelli` with role `commissioner`, and set the two public GitHub variables before following the steps above.

## What is editable

- Owners: their display name, short bio, league message, one of five card inks, and profile photo. Photos are center-cropped, resized to 480px and re-encoded as JPEG before being stored with their profile. This strips original metadata. Public profiles and photos are public content.
- Commissioner: every owner profile and the text/section controls listed in `/admin`. Use **Visual editor**, then the outlined area's edit button.
- Display names are presentation overrides on profile cards and the card directory; canonical names in historical tables and owner IDs remain intact.
- Blank text/name/ink restores the original default. A custom homepage headline stays in place across weekly updates until you clear it.
- Preview before Publish. Drafts are saved explicitly in the current browser tab's session storage, scoped to your account. They are not shared drafts and disappear when that tab's session is cleared. Close without saving discards unsaved work.
- Version history offers the latest ten publications. Loading an old version only previews it; Publish creates a new version. Simultaneous edits are rejected rather than silently overwriting a newer publication. After a conflict, save/copy your changes, close, refresh, and reapply them to the latest version. Restoring an old tab draft preserves its version and can still conflict.
- Readers see publications on next page load; the publishing user's page updates immediately. If Supabase is unavailable the static ESPN archive continues to work.

## Activation smoke checks

1. Anonymous visitor: reads published content, sees no edit controls, cannot call the publish RPC, and cannot read memberships or revisions.
2. Owner A: can publish their profile. Direct API attempts to edit Owner B, league text, or memberships must fail. Only their own revisions are readable.
3. Commissioner: edits both profile and copy; reload shows publication. Restore an earlier version and check the new history entry.
4. Verify a second stale editor cannot overwrite a newer version; image upload, phone layout, keyboard controls, and sign-out work.
5. An authenticated user without a membership must receive no editing access.

Security behavior is also covered by `web/tests/editor-database.test.mjs`, which runs this migration against embedded PostgreSQL with simulated Supabase auth roles. Hosted function deployment and real sessions still need the live checks above. The login handler also has tests for surname mapping, commissioner isolation, revocation, and malformed requests.

References: https://supabase.com/docs/reference/javascript/auth-admin-generatelink · https://supabase.com/docs/reference/javascript/auth-signinwithpassword · https://supabase.com/docs/guides/functions/quickstart-dashboard · https://supabase.com/docs/guides/database/postgres/row-level-security

## Visual editor upgrade (PR #7)

For a project that already ran the initial setup, run **only** `supabase/migrations/202610110002_visual_editor.sql` in a new SQL query. It updates the publishing function's allowed text areas and display settings without replacing accounts, profiles, or history. New projects run both migration files in order. Merge the visual-editor PR after applying this migration.

Commissioners can open `/admin` (or the Admin link above the page) to search all editable text/section controls. The Visual editor button reveals controls directly on each page. Use **Hide text** to remove wording, **Use my text** to replace it, or **Use original text** to restore the default. Section controls offer Show/Hide. Hidden items remain findable in Admin and in visual edit mode. These settings are shared across instances of the same template, including owner profiles.

**Preview on page** closes the dialog and shows your unpublished change on the actual page. The toolbar labels it a private preview; Publish preview makes it public, and Discard preview reverts it. One page preview is supported at a time. Tab drafts and version history still work. Scores, calculated values, sign-in messages, metric definitions, and navigation behavior are not arbitrary editable HTML. This is a content/visibility editor, not a freeform drag-and-drop page builder.

Owners now use the surname entry described above; persistent sessions and the My profile shortcut reduce repeat sign-ins. Owners remain restricted by database permissions to their own profile.

## Confirming publication and managing profiles

Open `/admin` as commissioner. **Saved on the live site** lists saved document versions and publication timestamps, separate from private previews. **Refresh saved content** reads the current records directly from Supabase and reports failures. The list is publication activity, not a login audit or editor attribution log.

**Owners & sign-in** lists each current owner, their surname entry, and the last published profile edit. Click an owner to edit their profile; select the share text to copy all owner sign-in names and the account link. There are no separate owner passwords to retrieve. Commissioner access uses the existing private Auth password; the site does not reveal or reset it. Disabling accounts still requires the Supabase membership procedure above.

**Publish changes** is available directly in the editor. It writes to Supabase and reads the record back before displaying a verified save with timestamp/version. If the write is acknowledged but read-back fails, the editor preserves the acknowledged version and tells you to verify in Admin. It never treats a failed write as saved. **Save tab draft** stores only a private draft in the current browser tab. **Preview on page** also remains private until published. No GitHub push is needed for content publications.

Live verification: publish one intended change, note the saved version/time, close the dialog, click Refresh saved content in Admin, and open the public page in a private/incognito window. The same published content should appear there. If publication errors, keep the editor open and copy the exact error. Never send your commissioner password.

## Phone icon, app entrance, and welcome guide

The approved football/FFBFFL wordmark is packaged in `web/public/branding/` as the iPhone touch icon, browser favicon, and 192/512px manifest icons. Icon links include the deployment base path, including on nested profile URLs. The manifest opens the root entrance in standalone mode. No offline behavior is promised; login and publishing need a connection.

Opening the site root now sends signed-out visitors to `/account?entry=1`. After successful sign-in and membership lookup, owners and the commissioner go to their own profile. Remembered sessions skip re-entering credentials. `/account` remains available through My account for signing out. The league front page is now `/home`; This week and masthead links lead there. Shared archive and profile URLs remain public.

A personalized modal guide opens on the owner's first profile visit after sign-in. Next/Back move between the relevant real pages. It explains profile publishing, navigation, playoffs, and the glossary, plus Admin/Visual editor for the commissioner. Skip, Escape, or completion dismisses it. Completion is stored per Auth user in this device/browser's local storage, not in Supabase; a new device or cleared storage can show the guide again. Site guide in the toolbar replays it. The guide never edits or publishes content.

After merging and a successful Pages deployment, open the site in Safari on iPhone, choose Share → Add to Home Screen, and add FFBFFL. Remove an old home-screen shortcut and add it again if it retains the old icon/start page. A home-screen app may maintain a separate session from the browser. A resumed app can retain its last screen; a fresh launch follows the start URL.
