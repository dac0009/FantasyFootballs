-- The Wheel, "Beat the Champ" version: one saved result per owner per day.
--
-- A separate table from wheel_plays, which is left exactly as it is, so the
-- original Wheel and its history keep working. Same rules as wheel_plays:
-- everyone can read the board, a signed-in owner can post only their own row,
-- only for today's board (Eastern time), and only once. Nothing may update or
-- delete a row: there are deliberately no such policies.
begin;
create table public.champ_plays (
  game_key text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  owner_id text not null,
  season integer not null,
  champion_owner_id text not null,
  wins integer not null,
  losses integer not null,
  ties integer not null default 0,
  points_for numeric(8,2) not null,
  champion_points numeric(8,2) not null,
  points_rank integer not null,
  team_count integer not null,
  all_play_wins integer not null,
  all_play_losses integer not null,
  picks jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  primary key (game_key, user_id)
);
create index champ_plays_owner on public.champ_plays(owner_id, created_at desc);
alter table public.champ_plays enable row level security;
grant select on public.champ_plays to anon, authenticated;
grant insert on public.champ_plays to authenticated;
create policy champ_plays_read on public.champ_plays
  for select to anon, authenticated using (true);
create policy champ_plays_post on public.champ_plays
  for insert to authenticated with check (
    user_id = (select auth.uid())
    and owner_id = (select m.owner_id from public.editor_memberships m where m.user_id = (select auth.uid()))
    and game_key = 'champ:' || to_char((now() at time zone 'America/New_York')::date, 'YYYY-MM-DD')
    and season between 2000 and 2100
    and wins between 0 and 25 and losses between 0 and 25 and ties between 0 and 25
    and wins + losses + ties between 1 and 25
    and points_for between 0 and 6000 and champion_points between 0 and 6000
    and team_count between 2 and 40 and points_rank between 1 and team_count
    and all_play_wins between 0 and 1000 and all_play_losses between 0 and 1000
    and octet_length(picks::text) < 4000
  );
commit;
