-- Teal gamification (spec §2.1) 2/8: profiles, private settings, push tokens and the notifications inbox/outbox.
create type public.activity_kind as enum ('run', 'bike');
create type public.activity_status as enum ('valid', 'flagged');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nickname text not null check (char_length(nickname) between 3 and 20),
  color smallint not null default 0 check (color between 0 and 11),
  created_at timestamptz not null default now()
);
create unique index profiles_nickname_lower on public.profiles (lower(nickname));

-- territory_opt_in defaults to true: Addendum D (O3) puts everyone on the map with a server-honored opt-out.
create table public.profile_private (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  invite_code text not null unique,
  age_confirmed_at timestamptz not null,
  nickname_changed_at timestamptz not null default now(),
  territory_opt_in boolean not null default true,
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
create index notifications_actor on public.notifications (actor_id) where actor_id is not null;   -- FK cascade

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
declare v_uid uuid := auth.uid(); k text;
begin
  if v_uid is null then perform private.fail('not_authenticated'); end if;
  if not exists (select 1 from public.profiles where id = v_uid) then perform private.fail('no_profile'); end if;
  if p is null or jsonb_typeof(p) <> 'object' then perform private.fail('invalid_payload'); end if;
  foreach k in array array['territory_opt_in', 'notify_overtake', 'notify_sessions', 'notify_friend_requests'] loop
    if p ? k and jsonb_typeof(p->k) <> 'boolean' then perform private.fail('invalid_payload'); end if;
  end loop;
  if p ? 'color' then
    if jsonb_typeof(p->'color') <> 'number' or (p->>'color')::numeric not in (0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11) then
      perform private.fail('invalid_payload');
    end if;
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
  if not exists (select 1 from public.profiles where id = auth.uid()) then perform private.fail('no_profile'); end if;
  if p_token is null or p_token !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$'
     or p_platform is null or p_platform not in ('ios', 'android') then
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
-- private.hand_over_group is created in 000300 (plpgsql resolves names at run time).
-- `delete from auth.users` from a definer function must be verified on this project (spec §6).
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
