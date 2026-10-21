-- Teal gamification (spec §2.1) 3/8: friendships, blocks, groups, run-together sessions, realtime channel policies.
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

-- Foreign-key indexes (cascading deletes on account deletion; advisor `unindexed_foreign_keys`).
create index blocks_blocked on public.blocks (blocked_id);
create index groups_owner on public.groups (owner_id);
create index group_sessions_created_by on public.group_sessions (created_by) where created_by is not null;
create index group_session_participants_user on public.group_session_participants (user_id);

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
  -- coalesce: a deleted creator leaves created_by null, which must not slip past the check as "unknown".
  if not found or v_uid is null
     or not (coalesce(s.created_by = v_uid, false)
             or exists (select 1 from public.groups g where g.id = s.group_id and g.owner_id = v_uid)) then
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
