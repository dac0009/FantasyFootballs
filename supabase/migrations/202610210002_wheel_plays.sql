-- The Wheel: one saved result per owner per day, readable by everyone.
--
-- Rows are written by the site after a daily spin. The primary key makes a
-- second attempt on the same day fail cleanly, the insert policy ties the row
-- to the signed-in owner's own membership, and the game_key check only admits
-- today's board (Eastern time), so a stale tab cannot post into yesterday.
-- Nothing may update or delete a row: there are deliberately no such policies.
begin;
create table public.wheel_plays (
  game_key text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  owner_id text not null,
  season integer not null,
  week integer not null,
  team_id integer not null,
  opponent_team_id integer not null,
  points numeric(7,2) not null,
  opponent_points numeric(7,2) not null,
  actual_points numeric(7,2) not null,
  optimal_points numeric(7,2) not null,
  lineup jsonb not null default '{}'::jsonb,
  pickups jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  primary key (game_key, user_id)
);
create index wheel_plays_owner on public.wheel_plays(owner_id, created_at desc);
alter table public.wheel_plays enable row level security;
grant select on public.wheel_plays to anon, authenticated;
grant insert on public.wheel_plays to authenticated;
create policy wheel_plays_read on public.wheel_plays
  for select to anon, authenticated using (true);
create policy wheel_plays_post on public.wheel_plays
  for insert to authenticated with check (
    user_id = (select auth.uid())
    and owner_id = (select m.owner_id from public.editor_memberships m where m.user_id = (select auth.uid()))
    and game_key = 'daily:' || to_char((now() at time zone 'America/New_York')::date, 'YYYY-MM-DD')
    and season between 2000 and 2100 and week between 1 and 25
    and points between 0 and 400 and opponent_points between 0 and 400
    and actual_points between 0 and 400 and optimal_points between 0 and 400
    and octet_length(lineup::text) < 4000 and octet_length(pickups::text) < 1000
  );
commit;
