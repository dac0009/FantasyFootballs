-- Fourteen and Fantasy, weekly-lineup version.
--
-- 1. Two optional columns on champ_plays: the best possible points with the
--    roster you had (for Lineup IQ) and how many waiver claims you made.
-- 2. champ_starts: a run "counts" the moment its first week kicks off, so
--    reloading after seeing real points can't buy a second try. A signed-in
--    owner can record only their own start, only for today, only once, and
--    can read only their own starts. Nothing may update or delete a row.
begin;
alter table public.champ_plays add column optimal_points numeric(8,2);
alter table public.champ_plays add column claims integer;
alter table public.champ_plays add constraint champ_plays_optimal_range check (optimal_points is null or optimal_points between 0 and 8000);
alter table public.champ_plays add constraint champ_plays_claims_range check (claims is null or claims between 0 and 25);

create table public.champ_starts (
  game_key text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  owner_id text not null,
  created_at timestamptz not null default now(),
  primary key (game_key, user_id)
);
alter table public.champ_starts enable row level security;
revoke all on public.champ_starts from anon, authenticated;
grant select, insert on public.champ_starts to authenticated;
create policy champ_starts_read_own on public.champ_starts
  for select to authenticated using (user_id = (select auth.uid()));
create policy champ_starts_post on public.champ_starts
  for insert to authenticated with check (
    user_id = (select auth.uid())
    and owner_id = (select m.owner_id from public.editor_memberships m where m.user_id = (select auth.uid()))
    and game_key = 'champ:' || to_char((now() at time zone 'America/New_York')::date, 'YYYY-MM-DD')
  );
commit;
