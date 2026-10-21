-- Jakob Frank signed in under jakob-frank-2 before the sign-in roster was
-- corrected to jakob-frank (his owner ID in the league data since the 2019
-- account was merged). If a membership or profile was created under the old
-- ID, move it to the current one so his edits follow him.
--
-- Every statement is guarded: nothing moves if the current ID already has a
-- row, and nothing happens at all if the old ID was never used. Safe to run
-- more than once.
begin;
update public.editor_memberships set owner_id = 'jakob-frank'
  where owner_id = 'jakob-frank-2'
    and not exists (select 1 from public.editor_memberships where owner_id = 'jakob-frank');
update public.editor_documents set key = 'jakob-frank'
  where kind = 'profile' and key = 'jakob-frank-2'
    and not exists (select 1 from public.editor_documents where kind = 'profile' and key = 'jakob-frank');
update public.editor_revisions set key = 'jakob-frank'
  where kind = 'profile' and key = 'jakob-frank-2'
    and not exists (select 1 from public.editor_revisions where kind = 'profile' and key = 'jakob-frank');
commit;
