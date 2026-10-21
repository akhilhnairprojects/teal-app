-- SUPERSEDED: the applied schema is teal/supabase/migrations/ (000100–000800 split from this draft, plus
-- 20261021000900_review_fixes.sql). Notably territory_opt_in defaults to TRUE there (Addendum D, O3),
-- territory claims wait for the territory notice, and get_territory pages. Kept for history; do not apply.
--
-- Teal gamification: Postgres schema DRAFT (spec.md §2). Review before applying.
-- G0 splits this file at the "== migration:" markers into teal/supabase/migrations/<name>.sql; the lead
-- applies them in order with the Supabase MCP `apply_migration` (name = file name without .sql).
--
-- Conventions
--   * Every table in `public` has RLS on. Clients only SELECT (owner- or membership-scoped); every write
--     goes through a SECURITY DEFINER RPC with `set search_path = ''` and fully qualified names.
--   * Expected failures raise SQLSTATE P0001 with a stable code in MESSAGE (spec §4 BackendErrorCode).
--   * `private` is not exposed by PostgREST. Only the two RLS helper functions are executable by clients.
--   * Distances in metres, durations in ms, ET = America/New_York. PostGIS lives in schema `extensions`.
--   * Grid, haversine and best-effort rules must match src/territory/grid.ts and src/activity/metrics.ts
--     (parity tests in spec §7).

-- == migration: 20261021000100_extensions_private ==================================================
create extension if not exists postgis with schema extensions;
create extension if not exists pg_net with schema extensions;      -- functions live in schema `net`
create extension if not exists pg_cron with schema pg_catalog;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;                    -- RLS helpers only; see grants below
alter default privileges in schema private revoke execute on functions from public;

create or replace function private.fail(p_code text) returns void
language plpgsql volatile set search_path = '' as $$          -- volatile: never constant-folded
begin
  raise exception using errcode = 'P0001', message = p_code;
end $$;

-- Haversine, R = 6 371 000 m (same formula as src/lib/geo.ts distanceMeters).
create or replace function private.ll_dist_m(lat1 float8, lon1 float8, lat2 float8, lon2 float8)
returns float8 language sql immutable parallel safe set search_path = '' as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lon2 - lon1) / 2), 2)));
$$;

create or replace function private.week_start(ts timestamptz) returns date
language sql stable set search_path = '' as $$
  select date_trunc('week', ts at time zone 'America/New_York')::date;   -- ISO week: Monday
$$;
create or replace function private.month_start(ts timestamptz) returns date
language sql stable set search_path = '' as $$
  select date_trunc('month', ts at time zone 'America/New_York')::date;
$$;
create or replace function private.period_end(p_period text, p_start date) returns timestamptz
language sql stable set search_path = '' as $$
  select ((p_start + case when p_period = 'week' then interval '7 days' else interval '1 month' end)::timestamp)
         at time zone 'America/New_York';
$$;

-- Territory grid (spec §2.7): ~50 m cells over Greater Boston. cell_id = i * 10000 + j.
create or replace function private.grid_i(lon float8) returns int
language sql immutable parallel safe set search_path = '' as $$
  select floor((lon - (-71.5)::float8) / 0.0006::float8)::int;
$$;
create or replace function private.grid_j(lat float8) returns int
language sql immutable parallel safe set search_path = '' as $$
  select floor((lat - 42.0::float8) / 0.00045::float8)::int;
$$;

create table private.rate_events (
  user_id uuid not null,
  action text not null,
  at timestamptz not null default now()
);
create index rate_events_lookup on private.rate_events (user_id, action, at desc);

create or replace function private.hit_rate_limit(p_action text, p_max int, p_window interval) returns void
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  select count(*) into n from private.rate_events
   where user_id = auth.uid() and action = p_action and at > now() - p_window;
  if n >= p_max then perform private.fail('rate_limited'); end if;
  insert into private.rate_events (user_id, action) values (auth.uid(), p_action);
end $$;

-- 8 chars from a 32-letter alphabet without 0/O/1/I (uniform: 256 % 32 = 0).
create or replace function private.new_code(p_len int default 8) returns text
language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  b bytea := extensions.gen_random_bytes(p_len);
  code text := '';
begin
  for k in 0 .. p_len - 1 loop
    code := code || substr(alphabet, (get_byte(b, k) % 32) + 1, 1);
  end loop;
  return code;
end $$;

-- == migration: 20261021000200_profiles_notifications ==============================================
create type public.activity_kind as enum ('run', 'bike');
create type public.activity_status as enum ('valid', 'flagged');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nickname text not null check (char_length(nickname) between 3 and 20),
  color smallint not null default 0 check (color between 0 and 11),
  created_at timestamptz not null default now()
);
create unique index profiles_nickname_lower on public.profiles (lower(nickname));

create table public.profile_private (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  invite_code text not null unique,
  age_confirmed_at timestamptz not null,
  nickname_changed_at timestamptz not null default now(),
  territory_opt_in boolean not null default false,   -- superseded: the migration defaults to true (Addendum D)
  notify_overtake boolean not null default true,
  notify_sessions boolean not null default true,
  notify_friend_requests boolean not null default true
);

create table private.reserved_nicknames (name text primary key check (name = lower(name)));
insert into private.reserved_nicknames (name) values
  ('admin'), ('administrator'), ('teal'), ('support'), ('moderator'), ('mod'), ('staff'), ('system'),
  ('official'), ('mbta'), ('bluebikes'), ('null'), ('undefined'), ('anonymous'), ('deleted'), ('everyone')
on conflict do nothing;
-- Offensive-term list: loaded by the lead from a maintained list (spec §6); not committed here.
create table private.banned_terms (term text primary key check (term = lower(term) and term ~ '^[a-z]+$'));

create table public.push_tokens (
  token text primary key,                       -- ExponentPushToken[...]
  user_id uuid not null references public.profiles (id) on delete cascade,
  platform text not null check (platform in ('ios', 'android')),
  updated_at timestamptz not null default now()
);
create index push_tokens_user on public.push_tokens (user_id);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('overtake', 'session_live', 'friend_request', 'friend_accepted')),
  actor_id uuid references public.profiles (id) on delete cascade,
  dedupe_key text,
  payload jsonb not null default '{}'::jsonb,   -- nicknames and numbers only; never locations
  created_at timestamptz not null default now(),
  read_at timestamptz,
  push_state text not null default 'pending' check (push_state in ('pending', 'sent', 'no_token', 'failed', 'skipped')),
  push_attempts smallint not null default 0,
  unique (recipient_id, dedupe_key)
);
create index notifications_inbox on public.notifications (recipient_id, created_at desc);
create index notifications_pending on public.notifications (created_at) where push_state = 'pending';

alter table public.profiles enable row level security;
alter table public.profile_private enable row level security;
alter table public.push_tokens enable row level security;
alter table public.notifications enable row level security;
alter table private.rate_events enable row level security;
alter table private.reserved_nicknames enable row level security;
alter table private.banned_terms enable row level security;

create policy profiles_read on public.profiles for select to authenticated using (true);
create policy profile_private_owner on public.profile_private for select to authenticated
  using (user_id = (select auth.uid()));
create policy push_tokens_owner on public.push_tokens for select to authenticated
  using (user_id = (select auth.uid()));
create policy notifications_recipient on public.notifications for select to authenticated
  using (recipient_id = (select auth.uid()));

-- Null when acceptable, else the error code. Folds digits/symbols so "s3x" style evasions match.
create or replace function private.name_problem(p text, p_min int, p_max int, p_pattern text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare folded text;
begin
  if p is null or char_length(p) not between p_min and p_max or p !~ p_pattern then return 'name_invalid'; end if;
  if exists (select 1 from private.reserved_nicknames r where r.name = lower(p)) then return 'name_invalid'; end if;
  folded := regexp_replace(translate(lower(p), '013457@$!', 'oieastasi'), '[^a-z]', '', 'g');
  if exists (select 1 from private.banned_terms b where position(b.term in folded) > 0) then return 'name_invalid'; end if;
  return null;
end $$;

create or replace function public.get_my_profile() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p.id, 'nickname', p.nickname, 'color', p.color, 'created_at', p.created_at,
    'invite_code', pp.invite_code, 'territory_opt_in', pp.territory_opt_in,
    'notify_overtake', pp.notify_overtake, 'notify_sessions', pp.notify_sessions,
    'notify_friend_requests', pp.notify_friend_requests)
  from public.profiles p join public.profile_private pp on pp.user_id = p.id
  where p.id = auth.uid();
$$;

create or replace function public.claim_nickname(p_nickname text, p_age_confirmed boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(p_nickname);
  v_old public.profiles;
  v_changed timestamptz;
begin
  if v_uid is null then perform private.fail('not_authenticated'); end if;
  if private.name_problem(v_name, 3, 20, '^[A-Za-z0-9][A-Za-z0-9_.-]*$') is not null then
    perform private.fail('nickname_invalid');
  end if;
  perform private.hit_rate_limit('nickname', 10, interval '1 day');
  select * into v_old from public.profiles where id = v_uid;
  if not found then
    if not coalesce(p_age_confirmed, false) then perform private.fail('age_required'); end if;
    begin
      insert into public.profiles (id, nickname, color)
      values (v_uid, v_name, (hashtext(v_uid::text) & 2147483647) % 12);
    exception when unique_violation then perform private.fail('nickname_taken');
    end;
    insert into public.profile_private (user_id, invite_code, age_confirmed_at)
    values (v_uid, private.new_code(8), now());
  elsif v_old.nickname <> v_name then                               -- case-only edits skip the 7-day rule
    select nickname_changed_at into v_changed from public.profile_private where user_id = v_uid;
    if lower(v_old.nickname) <> lower(v_name) and v_changed > now() - interval '7 days' then
      perform private.fail('nickname_too_soon');
    end if;
    begin
      update public.profiles set nickname = v_name where id = v_uid;
    exception when unique_violation then perform private.fail('nickname_taken');
    end;
    update public.profile_private set nickname_changed_at = now() where user_id = v_uid;
  end if;
  return public.get_my_profile();
end $$;

-- p: {color?, territory_opt_in?, notify_overtake?, notify_sessions?, notify_friend_requests?}
create or replace function public.set_my_settings(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then perform private.fail('not_authenticated'); end if;
  if not exists (select 1 from public.profiles where id = v_uid) then perform private.fail('no_profile'); end if;
  if p ? 'color' then
    if (p->>'color')::int not between 0 and 11 then perform private.fail('invalid_payload'); end if;
    update public.profiles set color = (p->>'color')::smallint where id = v_uid;
  end if;
  update public.profile_private set
    territory_opt_in = coalesce((p->>'territory_opt_in')::boolean, territory_opt_in),
    notify_overtake = coalesce((p->>'notify_overtake')::boolean, notify_overtake),
    notify_sessions = coalesce((p->>'notify_sessions')::boolean, notify_sessions),
    notify_friend_requests = coalesce((p->>'notify_friend_requests')::boolean, notify_friend_requests)
  where user_id = v_uid;
  return public.get_my_profile();
end $$;

create or replace function public.register_push_token(p_token text, p_platform text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then perform private.fail('not_authenticated'); end if;
  if p_token !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$' or p_platform not in ('ios', 'android') then
    perform private.fail('invalid_payload');
  end if;
  perform private.hit_rate_limit('push_token', 20, interval '1 day');
  insert into public.push_tokens (token, user_id, platform) values (p_token, auth.uid(), p_platform)
  on conflict (token) do update set user_id = excluded.user_id, platform = excluded.platform, updated_at = now();
end $$;

create or replace function public.unregister_push_token(p_token text) returns void
language sql security definer set search_path = '' as $$
  delete from public.push_tokens where token = p_token and user_id = auth.uid();
$$;

create or replace function public.mark_notifications_read(p_ids uuid[]) returns void
language sql security definer set search_path = '' as $$
  update public.notifications set read_at = now()
   where recipient_id = auth.uid() and id = any(p_ids) and read_at is null;
$$;

-- Owner leaves: groups are handed to the longest-standing member, or deleted when empty.
-- Defined here, body references tables created in 000300 (plpgsql resolves at run time).
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); g record;
begin
  if v_uid is null then perform private.fail('not_authenticated'); end if;
  for g in select id from public.groups where owner_id = v_uid loop
    perform private.hand_over_group(g.id, v_uid);
  end loop;
  delete from auth.users where id = v_uid;            -- cascades through profiles to every owned row
end $$;

-- == migration: 20261021000300_social ============================================================
create table public.friendships (
  user_a uuid not null references public.profiles (id) on delete cascade,
  user_b uuid not null references public.profiles (id) on delete cascade,
  requested_by uuid not null,
  status text not null check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  primary key (user_a, user_b),
  check (user_a < user_b)
);
create index friendships_b on public.friendships (user_b);

create table public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 40),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  invite_code text not null unique,
  created_at timestamptz not null default now()
);

create table public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index group_members_user on public.group_members (user_id);

create table public.group_sessions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  created_by uuid references public.profiles (id) on delete set null,
  title text not null check (char_length(title) between 1 and 60),
  kind public.activity_kind not null default 'run',
  status text not null default 'open' check (status in ('open', 'live', 'ended')),
  starts_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);
create index group_sessions_group on public.group_sessions (group_id, created_at desc);

create table public.group_session_participants (
  session_id uuid not null references public.group_sessions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (session_id, user_id)
);

alter table public.friendships enable row level security;
alter table public.blocks enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.group_sessions enable row level security;
alter table public.group_session_participants enable row level security;

-- RLS helpers (SECURITY DEFINER so policies on group_members do not recurse).
create or replace function private.is_group_member(p_group uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.group_members where group_id = p_group and user_id = p_user);
$$;
create or replace function private.friend_ids(p_user uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select case when f.user_a = p_user then f.user_b else f.user_a end
    from public.friendships f
   where f.status = 'accepted' and (f.user_a = p_user or f.user_b = p_user);
$$;
create or replace function private.session_topic_allowed(p_topic text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_topic is null or p_topic not like 'session:%' then return false; end if;
  begin v_id := substr(p_topic, 9)::uuid; exception when others then return false; end;
  return exists (select 1 from public.group_sessions s
                   join public.group_members m on m.group_id = s.group_id
                  where s.id = v_id and m.user_id = auth.uid() and s.status <> 'ended');
end $$;

create policy friendships_party on public.friendships for select to authenticated
  using ((select auth.uid()) in (user_a, user_b));
create policy blocks_owner on public.blocks for select to authenticated
  using (blocker_id = (select auth.uid()));
create policy groups_member on public.groups for select to authenticated
  using (private.is_group_member(id, (select auth.uid())));
create policy group_members_member on public.group_members for select to authenticated
  using (private.is_group_member(group_id, (select auth.uid())));
create policy group_sessions_member on public.group_sessions for select to authenticated
  using (private.is_group_member(group_id, (select auth.uid())));
create policy group_session_participants_member on public.group_session_participants for select to authenticated
  using (exists (select 1 from public.group_sessions s
                  where s.id = session_id and private.is_group_member(s.group_id, (select auth.uid()))));

-- Realtime: private channels "session:<uuid>" for group members (broadcast + presence; no positions).
create policy teal_session_channel_read on realtime.messages for select to authenticated
  using (private.session_topic_allowed((select realtime.topic())));
create policy teal_session_channel_write on realtime.messages for insert to authenticated
  with check (private.session_topic_allowed((select realtime.topic())));

create or replace function private.notify(p_recipient uuid, p_kind text, p_actor uuid, p_dedupe text, p_payload jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications (recipient_id, kind, actor_id, dedupe_key, payload)
  values (p_recipient, p_kind, p_actor, p_dedupe, p_payload)
  on conflict (recipient_id, dedupe_key) do nothing;
end $$;

-- Friend request by exact nickname (pending) or by invite code (auto-accepted: sharing the code is consent).
create or replace function public.send_friend_request(p_nickname text default null, p_code text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid(); v_target uuid; v_by_code boolean := p_code is not null;
  v_a uuid; v_b uuid; v_row public.friendships; v_exists boolean; v_me text;
begin
  if v_uid is null then perform private.fail('not_authenticated'); end if;
  select nickname into v_me from public.profiles where id = v_uid;
  if v_me is null then perform private.fail('no_profile'); end if;
  perform private.hit_rate_limit('friend_request', 20, interval '1 day');
  if v_by_code then
    select user_id into v_target from public.profile_private where invite_code = upper(btrim(p_code));
  else
    select id into v_target from public.profiles where lower(nickname) = lower(btrim(p_nickname));
  end if;
  if v_target is null or v_target = v_uid
     or exists (select 1 from public.blocks where (blocker_id = v_target and blocked_id = v_uid)
                                             or (blocker_id = v_uid and blocked_id = v_target)) then
    perform private.fail('not_found');                -- blocked looks the same as unknown
  end if;
  v_a := least(v_uid, v_target); v_b := greatest(v_uid, v_target);
  select * into v_row from public.friendships where user_a = v_a and user_b = v_b;
  v_exists := found;
  if v_exists and v_row.status = 'accepted' then return 'accepted'; end if;
  if v_exists and v_row.requested_by = v_uid and not v_by_code then return 'requested'; end if;
  if (select count(*) from private.friend_ids(v_uid)) >= 200 then perform private.fail('limit_reached'); end if;
  if v_exists or v_by_code then                        -- they asked me earlier, or I hold their code
    insert into public.friendships (user_a, user_b, requested_by, status, responded_at)
    values (v_a, v_b, v_uid, 'accepted', now())
    on conflict (user_a, user_b) do update set status = 'accepted', responded_at = now();
    perform private.notify(v_target, 'friend_accepted', v_uid, 'friend_accepted:' || v_uid,
                           jsonb_build_object('actor_nickname', v_me));
    return 'accepted';
  end if;
  if (select count(*) from public.friendships where requested_by = v_uid and status = 'pending') >= 50 then
    perform private.fail('limit_reached');
  end if;
  insert into public.friendships (user_a, user_b, requested_by, status) values (v_a, v_b, v_uid, 'pending');
  if (select notify_friend_requests from public.profile_private where user_id = v_target) then
    perform private.notify(v_target, 'friend_request', v_uid, 'friend_request:' || v_uid,
                           jsonb_build_object('actor_nickname', v_me));
  end if;
  return 'requested';
end $$;

create or replace function public.respond_friend_request(p_other uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then perform private.fail('not_authenticated'); end if;
  if p_accept then
    update public.friendships set status = 'accepted', responded_at = now()
     where user_a = least(v_uid, p_other) and user_b = greatest(v_uid, p_other)
       and status = 'pending' and requested_by = p_other;
    if not found then perform private.fail('not_found'); end if;
    perform private.notify(p_other, 'friend_accepted', v_uid, 'friend_accepted:' || v_uid,
      jsonb_build_object('actor_nickname', (select nickname from public.profiles where id = v_uid)));
  else
    delete from public.friendships
     where user_a = least(v_uid, p_other) and user_b = greatest(v_uid, p_other) and status = 'pending';
  end if;
end $$;

create or replace function public.remove_friend(p_other uuid) returns void
language sql security definer set search_path = '' as $$
  delete from public.friendships
   where user_a = least(auth.uid(), p_other) and user_b = greatest(auth.uid(), p_other);
$$;

create or replace function public.block_user(p_other uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or p_other = auth.uid() then perform private.fail('invalid_payload'); end if;
  insert into public.blocks (blocker_id, blocked_id) values (auth.uid(), p_other) on conflict do nothing;
  delete from public.friendships
   where user_a = least(auth.uid(), p_other) and user_b = greatest(auth.uid(), p_other);
end $$;

create or replace function public.rotate_invite_code() returns text
language plpgsql security definer set search_path = '' as $$
declare v_code text := private.new_code(8);
begin
  perform private.hit_rate_limit('rotate_code', 5, interval '1 day');
  update public.profile_private set invite_code = v_code where user_id = auth.uid();
  if not found then perform private.fail('no_profile'); end if;
  return v_code;
end $$;

-- Friends with their eligible running distance this ET week (activities table: migration 000400).
create or replace function public.list_friends()
returns table (user_id uuid, nickname text, color smallint, status text, since timestamptz, week_run_m float8)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_uid uuid := auth.uid(); v_week date := private.week_start(now());
begin
  if v_uid is null then perform private.fail('not_authenticated'); end if;
  return query
  select p.id, p.nickname, p.color,
         case when f.status = 'accepted' then 'friends' when f.requested_by = v_uid then 'outgoing' else 'incoming' end,
         coalesce(f.responded_at, f.created_at),
         case when f.status = 'accepted' then
           (select coalesce(sum(a.distance_m), 0)::float8 from public.activities a
             where a.user_id = p.id and a.kind = 'run' and a.status = 'valid'
               and a.leaderboard_eligible and a.week_start = v_week)
         end
    from public.friendships f
    join public.profiles p on p.id = case when f.user_a = v_uid then f.user_b else f.user_a end
   where v_uid in (f.user_a, f.user_b)
   order by f.status, p.nickname;
end $$;

create or replace function private.hand_over_group(p_group uuid, p_leaving uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_next uuid;
begin
  select user_id into v_next from public.group_members
   where group_id = p_group and user_id <> p_leaving order by joined_at limit 1;
  if v_next is null then
    delete from public.groups where id = p_group;
  else
    update public.groups set owner_id = v_next where id = p_group;
    update public.group_members set role = 'owner' where group_id = p_group and user_id = v_next;
    delete from public.group_members where group_id = p_group and user_id = p_leaving;
  end if;
end $$;

create or replace function public.create_group(p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_id uuid; v_name text := btrim(p_name);
begin
  if v_uid is null then perform private.fail('not_authenticated'); end if;
  if not exists (select 1 from public.profiles where id = v_uid) then perform private.fail('no_profile'); end if;
  if private.name_problem(v_name, 2, 40, '^[A-Za-z0-9][A-Za-z0-9 _.''&-]*$') is not null then
    perform private.fail('name_invalid');
  end if;
  perform private.hit_rate_limit('create_group', 5, interval '1 day');
  if (select count(*) from public.group_members where user_id = v_uid) >= 10 then perform private.fail('limit_reached'); end if;
  insert into public.groups (name, owner_id, invite_code) values (v_name, v_uid, private.new_code(8)) returning id into v_id;
  insert into public.group_members (group_id, user_id, role) values (v_id, v_uid, 'owner');
  return v_id;
end $$;

create or replace function public.join_group(p_code text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_group uuid;
begin
  if v_uid is null then perform private.fail('not_authenticated'); end if;
  if not exists (select 1 from public.profiles where id = v_uid) then perform private.fail('no_profile'); end if;
  perform private.hit_rate_limit('join_group', 20, interval '1 day');
  select id into v_group from public.groups where invite_code = upper(btrim(p_code));
  if v_group is null then perform private.fail('not_found'); end if;
  if private.is_group_member(v_group, v_uid) then return v_group; end if;
  if (select count(*) from public.group_members where group_id = v_group) >= 50
     or (select count(*) from public.group_members where user_id = v_uid) >= 10 then
    perform private.fail('limit_reached');
  end if;
  insert into public.group_members (group_id, user_id) values (v_group, v_uid);
  return v_group;
end $$;

create or replace function public.leave_group(p_group uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.groups where id = p_group and owner_id = auth.uid()) then
    perform private.hand_over_group(p_group, auth.uid());
  else
    delete from public.group_members where group_id = p_group and user_id = auth.uid();
  end if;
end $$;

create or replace function public.remove_group_member(p_group uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.groups where id = p_group and owner_id = auth.uid()) or p_user = auth.uid() then
    perform private.fail('forbidden');
  end if;
  delete from public.group_members where group_id = p_group and user_id = p_user;
end $$;

create or replace function public.rotate_group_code(p_group uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v_code text := private.new_code(8);
begin
  update public.groups set invite_code = v_code where id = p_group and owner_id = auth.uid();
  if not found then perform private.fail('forbidden'); end if;
  return v_code;
end $$;

create or replace function public.list_my_groups()
returns table (id uuid, name text, role text, member_count int, invite_code text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select g.id, g.name, m.role, (select count(*)::int from public.group_members x where x.group_id = g.id),
         g.invite_code, g.created_at
    from public.group_members m join public.groups g on g.id = m.group_id
   where m.user_id = auth.uid()
   order by g.name;
$$;

create or replace function public.get_group_members(p_group uuid)
returns table (user_id uuid, nickname text, color smallint, role text, joined_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not private.is_group_member(p_group, auth.uid()) then perform private.fail('not_member'); end if;
  return query select p.id, p.nickname, p.color, m.role, m.joined_at
    from public.group_members m join public.profiles p on p.id = m.user_id
   where m.group_id = p_group order by m.joined_at;
end $$;

create or replace function public.create_group_session(p_group uuid, p_title text, p_kind public.activity_kind default 'run',
                                                       p_starts_at timestamptz default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not private.is_group_member(p_group, auth.uid()) then perform private.fail('not_member'); end if;
  if private.name_problem(btrim(p_title), 1, 60, '^.+$') is not null then perform private.fail('name_invalid'); end if;
  perform private.hit_rate_limit('create_session', 10, interval '1 day');
  if (select count(*) from public.group_sessions where group_id = p_group and status <> 'ended') >= 3 then
    perform private.fail('limit_reached');
  end if;
  insert into public.group_sessions (group_id, created_by, title, kind, starts_at)
  values (p_group, auth.uid(), btrim(p_title), p_kind, p_starts_at) returning id into v_id;
  insert into public.group_session_participants (session_id, user_id) values (v_id, auth.uid());
  return v_id;
end $$;

create or replace function public.join_group_session(p_session uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.group_sessions s where s.id = p_session and s.status <> 'ended'
                   and private.is_group_member(s.group_id, auth.uid())) then
    perform private.fail('not_found');
  end if;
  insert into public.group_session_participants (session_id, user_id) values (p_session, auth.uid())
  on conflict do nothing;
end $$;

-- Creator or group owner. 'live' notifies group members who opted in.
create or replace function public.set_group_session_status(p_session uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.group_sessions; v_uid uuid := auth.uid(); m record;
begin
  select * into s from public.group_sessions where id = p_session;
  if not found or not (s.created_by = v_uid or exists (select 1 from public.groups g where g.id = s.group_id and g.owner_id = v_uid)) then
    perform private.fail('forbidden');
  end if;
  if p_status = 'live' and s.status = 'open' then
    update public.group_sessions set status = 'live', started_at = now() where id = p_session;
    for m in select gm.user_id from public.group_members gm
               join public.profile_private pp on pp.user_id = gm.user_id and pp.notify_sessions
              where gm.group_id = s.group_id and gm.user_id <> v_uid loop
      perform private.notify(m.user_id, 'session_live', v_uid, 'session_live:' || p_session,
        jsonb_build_object('session_id', p_session, 'title', s.title,
                           'group_name', (select name from public.groups where id = s.group_id)));
    end loop;
  elsif p_status = 'ended' and s.status <> 'ended' then
    update public.group_sessions set status = 'ended', ended_at = now() where id = p_session;
  else
    perform private.fail('invalid_payload');
  end if;
end $$;

create or replace function public.get_group_session(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.group_sessions;
begin
  select * into s from public.group_sessions where id = p_session;
  if not found or not private.is_group_member(s.group_id, auth.uid()) then perform private.fail('not_found'); end if;
  return to_jsonb(s) || jsonb_build_object('participants', coalesce((
    select jsonb_agg(jsonb_build_object('user_id', p.id, 'nickname', p.nickname, 'color', p.color, 'joined_at', gp.joined_at)
                     order by gp.joined_at)
      from public.group_session_participants gp join public.profiles p on p.id = gp.user_id
     where gp.session_id = p_session), '[]'::jsonb));
end $$;

-- == migration: 20261021000400_activities =========================================================
create table public.activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  client_id uuid not null,
  kind public.activity_kind not null,
  status public.activity_status not null,
  flags text[] not null default '{}',
  started_at timestamptz not null,
  ended_at timestamptz not null,
  received_at timestamptz not null default now(),
  week_start date not null,
  month_start date not null,
  distance_m real not null,
  excluded_m real not null default 0,
  elapsed_ms int not null,
  moving_ms int not null,
  is_loop boolean not null default false,
  leaderboard_eligible boolean not null,
  share_route boolean not null default false,
  public_path extensions.geometry(LineString, 4326),          -- trimmed + simplified; only when shared
  group_session_id uuid references public.group_sessions (id) on delete set null,
  unique (user_id, client_id)
);
create index activities_user_time on public.activities (user_id, started_at desc);
create index activities_week on public.activities (week_start, kind, user_id) where status = 'valid' and leaderboard_eligible;
create index activities_month on public.activities (month_start, kind, user_id) where status = 'valid' and leaderboard_eligible;
create index activities_session on public.activities (group_session_id) where group_session_id is not null;

create table public.activity_traces (                          -- raw (client-filtered) trace: OWNER ONLY
  activity_id uuid primary key references public.activities (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  path extensions.geometry(LineStringM, 4326) not null,       -- M = ms since started_at
  created_at timestamptz not null default now()
);
create index activity_traces_created on public.activity_traces (created_at);

create table public.activity_efforts (                         -- runs only
  activity_id uuid not null references public.activities (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  distance_m int not null check (distance_m in (1000, 5000, 10000)),
  duration_ms int not null,
  start_offset_ms int not null,
  week_start date not null,
  month_start date not null,
  eligible boolean not null,
  primary key (activity_id, distance_m)
);
create index efforts_week on public.activity_efforts (distance_m, week_start, duration_ms) where eligible;
create index efforts_month on public.activity_efforts (distance_m, month_start, duration_ms) where eligible;

alter table public.activities enable row level security;
alter table public.activity_traces enable row level security;
alter table public.activity_efforts enable row level security;
create policy activities_owner on public.activities for select to authenticated using (user_id = (select auth.uid()));
create policy activity_traces_owner on public.activity_traces for select to authenticated using (user_id = (select auth.uid()));
create policy activity_efforts_owner on public.activity_efforts for select to authenticated using (user_id = (select auth.uid()));

create or replace function private.activity_summary(p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', a.id, 'client_id', a.client_id, 'kind', a.kind, 'status', a.status, 'flags', to_jsonb(a.flags),
    'started_at', a.started_at, 'ended_at', a.ended_at, 'week_start', a.week_start, 'month_start', a.month_start,
    'distance_m', a.distance_m, 'excluded_m', a.excluded_m, 'elapsed_ms', a.elapsed_ms, 'moving_ms', a.moving_ms,
    'is_loop', a.is_loop, 'leaderboard_eligible', a.leaderboard_eligible, 'share_route', a.share_route,
    'group_session_id', a.group_session_id,
    'efforts', coalesce((select jsonb_agg(jsonb_build_object('distance_m', e.distance_m, 'duration_ms', e.duration_ms,
                                                             'start_offset_ms', e.start_offset_ms) order by e.distance_m)
                           from public.activity_efforts e where e.activity_id = a.id), '[]'::jsonb))
  from public.activities a where a.id = p_id;
$$;

-- Public route = trace minus a random 200–300 m at each end, simplified (~2 m). Null if under 1 km.
create or replace function private.build_public_path(p_activity uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_total float8; v_trim_a float8 := 200 + random() * 100; v_trim_b float8 := 200 + random() * 100;
        v_path extensions.geometry;
begin
  with pts as (
    select ((d).path)[1] as k, extensions.st_y((d).geom) as lat, extensions.st_x((d).geom) as lon
      from (select extensions.st_dumppoints(t.path) as d from public.activity_traces t where t.activity_id = p_activity) x
  ), seg as (
    select k, lat, lon,
           coalesce(private.ll_dist_m(lag(lat) over w, lag(lon) over w, lat, lon), 0) as d
      from pts window w as (order by k)
  ), cum as (
    select k, lat, lon, sum(d) over (order by k) as c, sum(d) over () as total from seg
  )
  select max(total),
         extensions.st_simplifypreservetopology(extensions.st_setsrid(
           extensions.st_makeline(extensions.st_makepoint(lon, lat) order by k)
             filter (where c >= v_trim_a and c <= total - v_trim_b), 4326), 0.00002)
    into v_total, v_path
    from cum;
  if v_total is null or v_total < 1000 or v_path is null or extensions.st_npoints(v_path) < 2 then
    v_path := null;
  end if;
  update public.activities set public_path = v_path where id = p_activity;
end $$;

-- p = { client_id, kind, started_at, ended_at, share_route, group_session_id?, points: [[t_ms, lat, lon], ...] }
-- Points are the client's filtered, smoothed points rounded to 6 dp (spec §3.3). The server recomputes all
-- numbers with the same rules; its values are authoritative.
create or replace function public.submit_activity(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_client uuid; v_kind public.activity_kind; v_started timestamptz; v_ended timestamptz;
  v_share boolean; v_session uuid; v_id uuid;
  t int[]; la float8[]; lo float8[]; n int;
  v_cap float8; v_moving float8; c_gap constant int := 30000;
  ok boolean[]; cum float8[];
  v_dist float8 := 0; v_excl float8 := 0; v_moving_ms bigint := 0; d float8; dt int;
  v_flags text[] := '{}'; v_status public.activity_status := 'valid'; v_eligible boolean;
  v_median float8; v_loop boolean := false;
  dists int[] := array[1000, 5000, 10000]; floors int[] := array[150000, 810000, 1680000];
  v_best float8; v_best_start int; s int; frac float8; tt float8; dur float8;
  efforts jsonb := '[]'::jsonb;
begin
  if v_uid is null then perform private.fail('not_authenticated'); end if;
  if not exists (select 1 from public.profiles where id = v_uid) then perform private.fail('no_profile'); end if;
  begin
    v_client := (p->>'client_id')::uuid;
    v_kind := (p->>'kind')::public.activity_kind;
    v_started := (p->>'started_at')::timestamptz;
    v_ended := (p->>'ended_at')::timestamptz;
    v_share := coalesce((p->>'share_route')::boolean, false);
    v_session := nullif(p->>'group_session_id', '')::uuid;
  exception when others then perform private.fail('invalid_payload');
  end;
  if v_client is null or v_kind is null or v_started is null or v_ended is null then perform private.fail('invalid_payload'); end if;

  select a.id into v_id from public.activities a where a.user_id = v_uid and a.client_id = v_client;
  if found then return private.activity_summary(v_id); end if;          -- idempotent retry
  perform private.hit_rate_limit('submit_activity', 30, interval '1 day');

  begin
    select array_agg((e->>0)::int order by o), array_agg((e->>1)::float8 order by o), array_agg((e->>2)::float8 order by o)
      into t, la, lo
      from jsonb_array_elements(p->'points') with ordinality as x(e, o);
  exception when others then perform private.fail('invalid_payload');
  end;
  n := coalesce(array_length(t, 1), 0);
  if n < 2 or n > 20000 then perform private.fail('invalid_payload'); end if;

  -- Clock checks: no future data, nothing older than 30 days, samples consistent with the stated span.
  if t[1] <> 0 or t[n] > 6 * 3600 * 1000
     or v_ended > now() + interval '2 minutes' or v_started < now() - interval '30 days'
     or abs(extract(epoch from (v_ended - v_started)) * 1000 - t[n]) > 5000 then
    perform private.fail('invalid_time');
  end if;
  if exists (select 1 from public.activities a where a.user_id = v_uid
               and a.started_at < v_ended and a.ended_at > v_started) then
    perform private.fail('overlap');
  end if;
  if v_session is not null and not exists (
       select 1 from public.group_session_participants gp join public.group_sessions s on s.id = gp.session_id
        where gp.session_id = v_session and gp.user_id = v_uid
          and v_started >= coalesce(s.started_at, s.created_at) - interval '15 minutes'
          and v_started <= coalesce(s.ended_at, now())) then
    v_session := null;
    v_flags := v_flags || 'session_mismatch';
  end if;

  -- Segment rules (same as src/activity/metrics.ts SEGMENT_RULES).
  v_cap := case v_kind when 'run' then 7.5 else 17.0 end;
  v_moving := case v_kind when 'run' then 0.5 else 1.0 end;
  ok := array_fill(false, array[n]);
  cum := array_fill(0::float8, array[n]);
  for i in 2 .. n loop
    dt := t[i] - t[i - 1];
    if dt <= 0 or la[i] not between -90 and 90 or lo[i] not between -180 and 180 then
      perform private.fail('invalid_time');
    end if;
    d := private.ll_dist_m(la[i - 1], lo[i - 1], la[i], lo[i]);
    if dt <= c_gap and d / (dt / 1000.0) <= v_cap then
      ok[i] := true;
      v_dist := v_dist + d;
      if d / (dt / 1000.0) >= v_moving then v_moving_ms := v_moving_ms + dt; end if;
    elsif dt <= c_gap then
      v_excl := v_excl + d;                                            -- implausibly fast: vehicle
    end if;                                                            -- longer gaps: not counted
    cum[i] := v_dist;
  end loop;

  select percentile_cont(0.5) within group (order by t[k + 1] - t[k]) into v_median
    from generate_series(1, n - 1) k;

  if v_excl > 0.2 * (v_dist + v_excl) then v_status := 'flagged'; v_flags := v_flags || 'vehicle'; end if;
  if v_median > 5000 then v_flags := v_flags || 'sparse'; end if;
  if v_dist < 200 then v_flags := v_flags || 'too_short'; end if;

  -- Best efforts (runs only): for each start point s, the interpolated time at which counted distance
  -- first reaches cum[s] + D, never spanning an uncounted segment.
  if v_kind = 'run' then
    for di in 1 .. 3 loop
      continue when v_dist < dists[di];
      v_best := null; s := 1;
      for e in 2 .. n loop
        if not ok[e] then s := e; continue; end if;
        while s + 1 < e and cum[e] - cum[s + 1] >= dists[di] loop s := s + 1; end loop;
        if cum[e] - cum[s] >= dists[di] and cum[e - 1] - cum[s] < dists[di] then
          frac := (cum[s] + dists[di] - cum[e - 1]) / (cum[e] - cum[e - 1]);
          tt := t[e - 1] + frac * (t[e] - t[e - 1]);
          dur := tt - t[s];
          if v_best is null or dur < v_best then v_best := dur; v_best_start := t[s]; end if;
        end if;
      end loop;
      if v_best is not null then
        if v_best < floors[di] then
          v_status := 'flagged';
          v_flags := v_flags || 'implausible_effort';
        end if;
        efforts := efforts || jsonb_build_object('distance_m', dists[di], 'duration_ms', round(v_best)::int,
                                                 'start_offset_ms', v_best_start);
      end if;
    end loop;
    v_loop := private.ll_dist_m(la[1], lo[1], la[n], lo[n]) <= 75 and v_dist >= 1000;
  end if;

  -- Counts toward boards only if received before both its week and month close (+3 h grace).
  v_eligible := v_status = 'valid' and not (v_flags && array['sparse', 'too_short'])
    and now() <= least(private.period_end('week', private.week_start(v_started)),
                       private.period_end('month', private.month_start(v_started))) + interval '3 hours';

  insert into public.activities (user_id, client_id, kind, status, flags, started_at, ended_at, week_start, month_start,
                                 distance_m, excluded_m, elapsed_ms, moving_ms, is_loop, leaderboard_eligible,
                                 share_route, group_session_id)
  values (v_uid, v_client, v_kind, v_status, v_flags, v_started, v_ended,
          private.week_start(v_started), private.month_start(v_started),
          v_dist, v_excl, t[n], v_moving_ms, v_loop, v_eligible, v_share, v_session)
  returning id into v_id;

  insert into public.activity_efforts (activity_id, user_id, distance_m, duration_ms, start_offset_ms, week_start, month_start, eligible)
  select v_id, v_uid, (e->>'distance_m')::int, (e->>'duration_ms')::int, (e->>'start_offset_ms')::int,
         private.week_start(v_started), private.month_start(v_started), v_eligible
    from jsonb_array_elements(efforts) e;

  insert into public.activity_traces (activity_id, user_id, path)
  select v_id, v_uid, extensions.st_setsrid(extensions.st_makeline(
           extensions.st_makepointm(lo[k], la[k], t[k]) order by k), 4326)
    from generate_series(1, n) k;                                    -- trigger in 000700 claims territory

  if v_share then perform private.build_public_path(v_id); end if;
  return private.activity_summary(v_id);
end $$;

create or replace function public.set_activity_sharing(p_activity uuid, p_share boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.activities where id = p_activity and user_id = auth.uid()) then
    perform private.fail('not_found');
  end if;
  if p_share then
    if not exists (select 1 from public.activity_traces where activity_id = p_activity) then
      perform private.fail('trace_expired');
    end if;
    update public.activities set share_route = true where id = p_activity;
    perform private.build_public_path(p_activity);
  else
    update public.activities set share_route = false, public_path = null where id = p_activity;
  end if;
  return private.activity_summary(p_activity);
end $$;

create or replace function public.delete_activity(p_activity uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.activities where id = p_activity and user_id = auth.uid();   -- cascades efforts, trace, cells
  if not found then perform private.fail('not_found'); end if;
end $$;

create or replace function public.list_my_activities(p_before timestamptz default null, p_limit int default 50)
returns setof jsonb language sql stable security definer set search_path = '' as $$
  select private.activity_summary(a.id) from public.activities a
   where a.user_id = auth.uid() and (p_before is null or a.started_at < p_before)
   order by a.started_at desc limit least(greatest(p_limit, 1), 200);
$$;

-- Owner's full trace as an encoded polyline (precision 5), or null when expired/not found.
create or replace function public.get_my_activity_track(p_activity uuid) returns text
language sql stable security definer set search_path = '' as $$
  select extensions.st_asencodedpolyline(extensions.st_force2d(t.path), 5)
    from public.activity_traces t where t.activity_id = p_activity and t.user_id = auth.uid();
$$;

-- == migration: 20261021000500_leaderboards ======================================================
create table public.leaderboard_archive (
  period text not null check (period in ('week', 'month')),
  period_start date not null,
  board text not null,
  rank int not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  value bigint not null,
  primary key (period, period_start, board, user_id)
);
alter table public.leaderboard_archive enable row level security;
create policy leaderboard_archive_read on public.leaderboard_archive for select to authenticated using (true);

create table private.period_runs (job text not null, period_start date not null, ran_at timestamptz not null default now(),
                                  primary key (job, period_start));
alter table private.period_runs enable row level security;

-- Unranked board rows. p_users null = everyone. value: ms for efforts, whole metres for distance.
create or replace function private.board_rows(p_board text, p_period text, p_start date, p_users uuid[])
returns table (user_id uuid, value bigint, activity_id uuid, achieved_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_dist int;
begin
  if p_board in ('run_1k', 'run_5k', 'run_10k') then
    v_dist := case p_board when 'run_1k' then 1000 when 'run_5k' then 5000 else 10000 end;
    return query
      select distinct on (e.user_id) e.user_id, e.duration_ms::bigint, e.activity_id, a.started_at
        from public.activity_efforts e join public.activities a on a.id = e.activity_id
       where e.distance_m = v_dist and e.eligible
         and (case when p_period = 'week' then e.week_start else e.month_start end) = p_start
         and (p_users is null or e.user_id = any(p_users))
       order by e.user_id, e.duration_ms, a.started_at;
  elsif p_board in ('run_distance', 'bike_distance') then
    return query
      select a.user_id, round(sum(a.distance_m))::bigint, null::uuid, max(a.ended_at)
        from public.activities a
       where a.kind = (case p_board when 'run_distance' then 'run' else 'bike' end)::public.activity_kind
         and a.status = 'valid' and a.leaderboard_eligible
         and (case when p_period = 'week' then a.week_start else a.month_start end) = p_start
         and (p_users is null or a.user_id = any(p_users))
       group by a.user_id;
  else
    perform private.fail('invalid_payload');
  end if;
end $$;

create or replace function public.get_leaderboard(p_board text, p_period text, p_period_start date default null,
                                                  p_scope text default 'global', p_group_id uuid default null,
                                                  p_limit int default 50)
returns table (rank int, user_id uuid, nickname text, color smallint, value bigint, activity_id uuid,
               achieved_on date, is_me boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid(); v_start date; v_users uuid[];
  v_asc boolean := p_board in ('run_1k', 'run_5k', 'run_10k');
begin
  if v_uid is null then perform private.fail('not_authenticated'); end if;
  if p_period not in ('week', 'month') then perform private.fail('invalid_payload'); end if;
  v_start := coalesce(p_period_start, case when p_period = 'week' then private.week_start(now()) else private.month_start(now()) end);
  if p_scope = 'friends' then
    v_users := array(select private.friend_ids(v_uid)) || v_uid;
  elsif p_scope = 'group' then
    if not private.is_group_member(p_group_id, v_uid) then perform private.fail('not_member'); end if;
    v_users := array(select m.user_id from public.group_members m where m.group_id = p_group_id);
  elsif p_scope <> 'global' then
    perform private.fail('invalid_payload');
  end if;
  return query
    with r as (
      select (rank() over (order by case when v_asc then b.value else -b.value end, b.achieved_at))::int as rk, b.*
        from private.board_rows(p_board, p_period, v_start, v_users) b)
    select r.rk, r.user_id, p.nickname, p.color, r.value, r.activity_id,
           (r.achieved_at at time zone 'America/New_York')::date, r.user_id = v_uid
      from r join public.profiles p on p.id = r.user_id
     where r.rk <= least(greatest(p_limit, 1), 100) or r.user_id = v_uid
     order by r.rk, p.nickname;
end $$;

-- Featured runs: top 3 per standard distance (one per runner), one card per activity. Route only if shared.
create or replace function public.get_featured_runs(p_period text, p_period_start date default null, p_limit int default 10)
returns table (activity_id uuid, nickname text, color smallint, effort_m int, duration_ms int, total_m real,
               achieved_on date, route_polyline text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_start date;
begin
  if auth.uid() is null then perform private.fail('not_authenticated'); end if;
  v_start := coalesce(p_period_start, case when p_period = 'week' then private.week_start(now()) else private.month_start(now()) end);
  return query
    with best as (
      select distinct on (e.distance_m, e.user_id) e.*
        from public.activity_efforts e
       where e.eligible and (case when p_period = 'week' then e.week_start else e.month_start end) = v_start
       order by e.distance_m, e.user_id, e.duration_ms),
    top as (select b.*, row_number() over (partition by b.distance_m order by b.duration_ms) rn from best b),
    picked as (select distinct on (t.activity_id) t.* from top t where t.rn <= 3 order by t.activity_id, t.distance_m desc)
    select a.id, p.nickname, p.color, k.distance_m, k.duration_ms, a.distance_m,
           (a.started_at at time zone 'America/New_York')::date,
           case when a.share_route and a.public_path is not null
                then extensions.st_asencodedpolyline(a.public_path, 5) end
      from picked k join public.activities a on a.id = k.activity_id join public.profiles p on p.id = k.user_id
     order by k.distance_m desc, k.duration_ms
     limit least(greatest(p_limit, 1), 30);
end $$;

create or replace function public.get_champions(p_period text, p_period_start date)
returns table (board text, rank int, user_id uuid, nickname text, color smallint, value bigint)
language sql stable security definer set search_path = '' as $$
  select l.board, l.rank, l.user_id, p.nickname, p.color, l.value
    from public.leaderboard_archive l join public.profiles p on p.id = l.user_id
   where l.period = p_period and l.period_start = p_period_start and auth.uid() is not null
   order by l.board, l.rank;
$$;

create or replace function private.archive_board_period(p_period text, p_start date) returns void
language plpgsql security definer set search_path = '' as $$
declare b text;
begin
  insert into private.period_runs (job, period_start) values (p_period, p_start) on conflict do nothing;
  if not found then return; end if;                                   -- already archived
  foreach b in array array['run_1k', 'run_5k', 'run_10k', 'run_distance', 'bike_distance'] loop
    insert into public.leaderboard_archive (period, period_start, board, rank, user_id, value)
    select p_period, p_start, b, rk, x.user_id, x.value from (
      select rank() over (order by case when b in ('run_1k', 'run_5k', 'run_10k') then r.value else -r.value end,
                                   r.achieved_at)::int rk, r.*
        from private.board_rows(b, p_period, p_start, null) r) x
     where rk <= 10;
  end loop;
end $$;

-- Hourly (cron). A period is archived 3 h after it closes (late-sync grace, matches v_eligible).
create or replace function private.archive_closed_periods() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.archive_board_period('week', private.week_start(now() - interval '3 hours') - 7);
  perform private.archive_board_period('month', (private.month_start(now() - interval '3 hours') - interval '1 month')::date);
end $$;

-- Group session results: each participant's latest activity attached to the session.
create or replace function public.get_session_results(p_session uuid)
returns table (user_id uuid, nickname text, color smallint, activity_status text, distance_m real, moving_ms int,
               elapsed_ms int, best_1k_ms int, best_5k_ms int)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not exists (select 1 from public.group_sessions s where s.id = p_session
                   and private.is_group_member(s.group_id, auth.uid())) then
    perform private.fail('not_found');
  end if;
  return query
    select p.id, p.nickname, p.color, a.status::text, a.distance_m, a.moving_ms, a.elapsed_ms,
           (select e.duration_ms from public.activity_efforts e where e.activity_id = a.id and e.distance_m = 1000),
           (select e.duration_ms from public.activity_efforts e where e.activity_id = a.id and e.distance_m = 5000)
      from public.group_session_participants gp
      join public.profiles p on p.id = gp.user_id
      left join lateral (select * from public.activities x where x.group_session_id = p_session and x.user_id = gp.user_id
                          order by x.ended_at desc limit 1) a on true
     where gp.session_id = p_session
     order by a.distance_m desc nulls last;
end $$;

-- == migration: 20261021000600_push_and_overtake ==================================================
-- Delivery: notifications rows -> pg_net POST -> Edge Function `send-push` -> Expo push API.
-- Secrets live in Vault (created by the lead, never committed):
--   select vault.create_secret('https://mzjgdjlrlwfgaedweerc.supabase.co/functions/v1', 'teal_functions_url');
--   select vault.create_secret('<random 32+ chars>', 'teal_push_secret');   -- same value as function secret TEAL_PUSH_SECRET
create or replace function private.dispatch_push(p_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare v_url text; v_secret text;
begin
  if p_ids is null or cardinality(p_ids) = 0 then return; end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'teal_functions_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'teal_push_secret';
  if v_url is null or v_secret is null then return; end if;           -- push not configured: inbox only
  perform net.http_post(
    url := v_url || '/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-teal-push-secret', v_secret),
    body := jsonb_build_object('ids', to_jsonb(p_ids)),
    timeout_milliseconds := 5000);
end $$;

create or replace function private.on_notifications_inserted() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.dispatch_push(array(select id from inserted));
  return null;
end $$;
create trigger notifications_dispatch after insert on public.notifications
  referencing new table as inserted for each statement execute function private.on_notifications_inserted();

create or replace function private.push_sweep() returns void
language sql security definer set search_path = '' as $$
  select private.dispatch_push(array(
    select id from public.notifications
     where push_state = 'pending' and push_attempts < 5
       and created_at < now() - interval '1 minute' and created_at > now() - interval '1 day'
     order by created_at limit 500));
$$;

-- Overtake: when my eligible weekly running distance passes a friend's (current ET week only).
create or replace function private.on_activity_overtake() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_new float8; v_old float8; f record; v_nick text;
begin
  if new.kind <> 'run' or new.status <> 'valid' or not new.leaderboard_eligible
     or new.week_start <> private.week_start(now()) then
    return null;
  end if;
  select coalesce(sum(distance_m), 0) into v_new from public.activities
   where user_id = new.user_id and kind = 'run' and status = 'valid' and leaderboard_eligible and week_start = new.week_start;
  v_old := v_new - new.distance_m;
  select nickname into v_nick from public.profiles where id = new.user_id;
  for f in
    select fr.fid, (select coalesce(sum(a.distance_m), 0) from public.activities a
                     where a.user_id = fr.fid and a.kind = 'run' and a.status = 'valid'
                       and a.leaderboard_eligible and a.week_start = new.week_start) as total
      from private.friend_ids(new.user_id) as fr(fid)
      join public.profile_private pp on pp.user_id = fr.fid and pp.notify_overtake
  loop
    if f.total > 0 and v_old <= f.total and v_new > f.total then
      perform private.notify(f.fid, 'overtake', new.user_id, 'overtake:' || new.user_id || ':' || new.week_start,
        jsonb_build_object('actor_nickname', v_nick, 'their_m', round(v_new), 'your_m', round(f.total),
                           'week_start', new.week_start));
    end if;
  end loop;
  return null;
end $$;
create trigger activities_overtake after insert on public.activities
  for each row execute function private.on_activity_overtake();

alter publication supabase_realtime add table public.notifications;   -- in-app inbox (RLS applies)

-- == migration: 20261021000700_territory =========================================================
create table public.territory_cells (
  month_start date not null,
  cell_id int not null,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  activity_id uuid not null references public.activities (id) on delete cascade,
  claimed_at timestamptz not null,                                   -- = activity ended_at ("later loop wins")
  primary key (month_start, cell_id)
);
create index territory_cells_owner on public.territory_cells (month_start, owner_id);

create table public.territory_claims (
  activity_id uuid primary key references public.activities (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  month_start date not null,
  cells_claimed int not null,
  cells_stolen int not null,
  area_m2 real not null,
  created_at timestamptz not null default now()
);

create table public.territory_champions (
  month_start date not null,
  rank int not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  cells int not null,
  primary key (month_start, user_id)
);

alter table public.territory_cells enable row level security;      -- no policies: read via get_territory
alter table public.territory_claims enable row level security;
alter table public.territory_champions enable row level security;
create policy territory_claims_owner on public.territory_claims for select to authenticated using (user_id = (select auth.uid()));
create policy territory_champions_read on public.territory_champions for select to authenticated using (true);

-- Claim the cells whose centres lie inside a closed run loop. Skips silently when not applicable.
create or replace function private.claim_territory(p_activity uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  a public.activities; v_line extensions.geometry; v_poly extensions.geometry; v_area float8;
  i0 int; i1 int; j0 int; j1 int; v_claimed int; v_stolen int;
begin
  select * into a from public.activities where id = p_activity;
  if a.kind <> 'run' or a.status <> 'valid' or not a.is_loop
     or a.month_start <> private.month_start(now() - interval '3 hours')
     or not exists (select 1 from public.profile_private where user_id = a.user_id and territory_opt_in) then
    return;
  end if;
  select extensions.st_force2d(path) into v_line from public.activity_traces where activity_id = p_activity;
  begin
    v_poly := extensions.st_collectionextract(extensions.st_makevalid(
                extensions.st_makepolygon(extensions.st_addpoint(v_line, extensions.st_startpoint(v_line)))), 3);
  exception when others then return;
  end;
  v_area := extensions.st_area(v_poly::extensions.geography);
  if v_area is null or v_area < 20000 or v_area > 25e6 then return; end if;
  i0 := greatest(private.grid_i(extensions.st_xmin(v_poly)), 0);
  i1 := least(private.grid_i(extensions.st_xmax(v_poly)), 1500);
  j0 := greatest(private.grid_j(extensions.st_ymin(v_poly)), 0);
  j1 := least(private.grid_j(extensions.st_ymax(v_poly)), 1555);
  if i1 < i0 or j1 < j0 or (i1 - i0 + 1)::bigint * (j1 - j0 + 1) > 80000 then return; end if;

  -- Both CTEs read the pre-upsert snapshot, so `stolen` counts cells taken from others by this claim.
  with cells as (
    select gi * 10000 + gj as cell_id
      from generate_series(i0, i1) gi, generate_series(j0, j1) gj
     where extensions.st_intersects(v_poly, extensions.st_setsrid(extensions.st_makepoint(
             -71.5::float8 + (gi + 0.5) * 0.0006::float8, 42.0::float8 + (gj + 0.5) * 0.00045::float8), 4326))
  ), stolen as (
    select count(*)::int n from public.territory_cells c join cells using (cell_id)
     where c.month_start = a.month_start and c.owner_id <> a.user_id and c.claimed_at < a.ended_at
  ), up as (
    insert into public.territory_cells (month_start, cell_id, owner_id, activity_id, claimed_at)
    select a.month_start, cells.cell_id, a.user_id, a.id, a.ended_at from cells
    on conflict (month_start, cell_id) do update
       set owner_id = excluded.owner_id, activity_id = excluded.activity_id, claimed_at = excluded.claimed_at
     where public.territory_cells.claimed_at < excluded.claimed_at
    returning 1
  )
  select (select count(*)::int from up), (select n from stolen) into v_claimed, v_stolen;
  insert into public.territory_claims (activity_id, user_id, month_start, cells_claimed, cells_stolen, area_m2)
  values (a.id, a.user_id, a.month_start, v_claimed, v_stolen, v_area)
  on conflict (activity_id) do nothing;
end $$;

create or replace function private.on_trace_inserted() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.claim_territory(new.activity_id);
  return null;
end $$;
create trigger activity_traces_claim after insert on public.activity_traces
  for each row execute function private.on_trace_inserted();

create or replace function private.on_territory_opt_out() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.territory_opt_in and not new.territory_opt_in then
    delete from public.territory_cells where owner_id = new.user_id;
  end if;
  return null;
end $$;
create trigger profile_private_territory after update of territory_opt_in on public.profile_private
  for each row execute function private.on_territory_opt_out();

-- Cells in a bounding box for a month (default: current ET month). At most 20 000 rows.
create or replace function public.get_territory(p_south float8, p_west float8, p_north float8, p_east float8,
                                                p_month date default null)
returns table (cell_id int, owner_id uuid, nickname text, color smallint)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_month date := coalesce(p_month, private.month_start(now()));
        i0 int := greatest(private.grid_i(p_west), 0); i1 int := least(private.grid_i(p_east), 1500);
        j0 int := greatest(private.grid_j(p_south), 0); j1 int := least(private.grid_j(p_north), 1555);
begin
  if auth.uid() is null then perform private.fail('not_authenticated'); end if;
  if i1 < i0 or j1 < j0 then return; end if;
  return query
    select c.cell_id, c.owner_id, p.nickname, p.color
      from public.territory_cells c join public.profiles p on p.id = c.owner_id
     where c.month_start = v_month and c.cell_id between i0 * 10000 + j0 and i1 * 10000 + j1
       and c.cell_id % 10000 between j0 and j1
     limit 20000;
end $$;

create or replace function public.get_territory_standings(p_month date default null, p_limit int default 50)
returns table (rank int, user_id uuid, nickname text, color smallint, cells int, is_me boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_month date := coalesce(p_month, private.month_start(now()));
begin
  if auth.uid() is null then perform private.fail('not_authenticated'); end if;
  return query
    with s as (select c.owner_id, count(*)::int n from public.territory_cells c where c.month_start = v_month group by c.owner_id),
         r as (select (rank() over (order by s.n desc))::int rk, s.* from s)
    select r.rk, r.owner_id, p.nickname, p.color, r.n, r.owner_id = auth.uid()
      from r join public.profiles p on p.id = r.owner_id
     where r.rk <= least(greatest(p_limit, 1), 100) or r.owner_id = auth.uid()
     order by r.rk;
end $$;

create or replace function public.get_activity_claim(p_activity uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('cells_claimed', cells_claimed, 'cells_stolen', cells_stolen, 'area_m2', area_m2,
                            'month_start', month_start)
    from public.territory_claims where activity_id = p_activity and user_id = auth.uid();
$$;

-- Monthly: archive top 10 of the closed month 3 h after it ends; keep that month's cells one more month.
create or replace function private.archive_territory() returns void
language plpgsql security definer set search_path = '' as $$
declare v_month date := (private.month_start(now() - interval '3 hours') - interval '1 month')::date;
begin
  insert into private.period_runs (job, period_start) values ('territory', v_month) on conflict do nothing;
  if not found then return; end if;
  insert into public.territory_champions (month_start, rank, user_id, cells)
  select v_month, rk, owner_id, n from (
    select owner_id, count(*)::int n, rank() over (order by count(*) desc)::int rk
      from public.territory_cells where month_start = v_month group by owner_id) x
   where rk <= 10;
  delete from public.territory_cells where month_start < v_month;
end $$;

-- == migration: 20261021000800_cron_and_grants ====================================================
create or replace function private.apply_retention() returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.activity_traces where created_at < now() - interval '180 days';   -- raw traces (decision O2)
  delete from public.notifications where created_at < now() - interval '30 days';
  delete from private.rate_events where at < now() - interval '2 days';
  delete from public.friendships where status = 'pending' and created_at < now() - interval '30 days';
end $$;

create or replace function private.housekeeping() returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.group_sessions set status = 'ended', ended_at = now()
   where (status = 'live' and started_at < now() - interval '4 hours')
      or (status = 'open' and created_at < now() - interval '24 hours');
end $$;

select cron.schedule('teal-rollover', '7 * * * *',
  $$select private.archive_closed_periods(); select private.archive_territory();$$);
select cron.schedule('teal-retention', '17 7 * * *', $$select private.apply_retention();$$);
select cron.schedule('teal-housekeeping', '*/15 * * * *', $$select private.housekeeping();$$);
select cron.schedule('teal-push-sweep', '*/5 * * * *', $$select private.push_sweep();$$);

-- Grants (run last; re-run at the end of any later migration that adds functions or tables).
revoke all on all tables in schema public from anon;
revoke insert, update, delete, truncate on all tables in schema public from authenticated;
grant select on all tables in schema public to authenticated;        -- still filtered by RLS
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_group_member(uuid, uuid), private.session_topic_allowed(text) to authenticated;
