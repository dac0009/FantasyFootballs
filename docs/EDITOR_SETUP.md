# Owner accounts and the editing desk

The site stays on GitHub Pages. Supabase stores authenticated memberships, published profile/text overrides, and revision history. ESPN files remain the source of scores and records. This migration never alters them.

## One-time activation

1. Create a dedicated Supabase project under your account. Run `supabase/migrations/202610110001_editor.sql` once in its SQL editor.
2. In Authentication settings, disable new-user signups. Configure a production SMTP provider so sign-in emails can reach league owners; Supabase's default email service is restricted. Enable the Email provider. Set Site URL to `https://dac0009.github.io/FantasyFootballs/` and add `https://dac0009.github.io/FantasyFootballs/account` to the redirect allowlist. Keep localhost redirects only for development.
3. The default magic-link template works with this editor. If you prefer codes, change the Magic Link template to include `<p>Your FFBFFL sign-in code: {{ .Token }}</p>`. The account page supports both. The app requests `shouldCreateUser: false`.
4. Create each approved account through Authentication → Users → Add user → Create new user (no invitation email is required). Use a random password; owners will use email sign-in. Do not share or commit passwords. Copy its user UUID.
5. In SQL editor, assign each UUID to the exact owner ID from `data/owners.json` (or the owner's profile URL). Example, replace the placeholder UUID:

   ```sql
   insert into public.editor_memberships(user_id,owner_id,role)
   values ('REPLACE_WITH_USER_UUID','dominick-cifelli','commissioner');
   -- For each other account, use its owner ID and role 'owner'.
   ```

   Memberships can only be assigned by the project administrator. The browser cannot grant itself a role, change owner IDs, or view other memberships. Remove a membership to revoke editing immediately, including for an existing session. Delete the Auth user to remove the account entirely.
6. Under GitHub repository Settings → Secrets and variables → Actions → Variables, set:
   - `VITE_SUPABASE_URL`: project URL (`https://PROJECT.supabase.co`)
   - `VITE_SUPABASE_PUBLISHABLE_KEY`: the project's **publishable** key (or legacy **anon** key).

   These are intentionally public browser configuration. **Never use a secret/service-role key.** Database permissions are enforced independently of this key. No Supabase credentials have been committed.
7. Merge this PR and run the Deploy to GitHub Pages workflow if needed. Open `/account`, sign in, and verify the smoke checks below.

Without these variables the public site continues normally and `/account` clearly says sign-in is not set up. No pretend authentication or local-only publishing is enabled.

## What is editable

- Owners: their display name, short bio, league message, one of five card inks, and profile photo. Photos are center-cropped, resized to 480px and re-encoded as JPEG before being stored with their profile. This strips original metadata. Public profiles and photos are public content.
- Commissioner: every owner profile and five text areas: front-page headline, introduction, announcement, owner-directory introduction, and masthead motto. Use **Edit site text**, then the outlined area's edit button.
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

Security behavior is also covered by `web/tests/editor-database.test.mjs`, which runs this migration against embedded PostgreSQL with simulated Supabase auth roles. Actual email delivery and project configuration still need the live checks above.

References: https://supabase.com/docs/guides/auth/auth-email-passwordless · https://supabase.com/docs/guides/auth/auth-smtp · https://supabase.com/docs/guides/database/postgres/row-level-security

## Visual editor upgrade (PR #7)

For a project that already ran the initial setup, run **only** `supabase/migrations/202610110002_visual_editor.sql` in a new SQL query. It updates the publishing function's allowed text areas and display settings without replacing accounts, profiles, or history. New projects run both migration files in order. Merge the visual-editor PR after applying this migration.

Commissioners can open `/admin` (or the Admin link above the page) to search all editable text/section controls. The Visual editor button reveals controls directly on each page. Use **Hide text** to remove wording, **Use my text** to replace it, or **Use original text** to restore the default. Section controls offer Show/Hide. Hidden items remain findable in Admin and in visual edit mode. These settings are shared across instances of the same template, including owner profiles.

**Preview on page** closes the dialog and shows your unpublished change on the actual page. The toolbar labels it a private preview; Publish preview makes it public, and Discard preview reverts it. One page preview is supported at a time. Tab drafts and version history still work. Scores, calculated values, sign-in messages, metric definitions, and navigation behavior are not arbitrary editable HTML. This is a content/visibility editor, not a freeform drag-and-drop page builder.

Owners continue to authenticate with their registered email; persistent sessions and the My profile shortcut reduce repeat sign-ins. Selecting a name alone is not authentication and has not been enabled. Owners remain restricted by database permissions to their own profile.
