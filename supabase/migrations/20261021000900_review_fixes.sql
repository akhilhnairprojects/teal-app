-- Teal gamification: fixes from the pre-ship review (investigations/gamification/review.md, "Fix pass").
-- Earlier migrations are already applied and stay unchanged; everything here replaces or adds to them.
--   B1  territory notice: a server-recorded acknowledgement; no loop claims cells before the user has seen it.
--   S1  get_territory pages by cell_id (≤ 1000 rows a page, PostgREST's default "Max rows").
--   S2  failed invite/group-code lookups return a value, so their rate event commits.
--   S4  no cell within 300 m of a loop's start or end is claimed (mirrors src/territory/preview.ts).
--   S5  delete_my_account also removes the caller's rate events.
--   S7  a small built-in banned-terms seed (original list; see spec §6 for loading a maintained list).
--   S8  rotate_group_code is rate limited (5 a day).
--   N10 the two rollover jobs run as separate cron jobs.

-- B1 ------------------------------------------------------------------------------------------------
-- Territory stays ON by default (Addendum D, O3). The notice (what is shown, and a "Turn off" action) is
-- acknowledged once per account; claim_territory skips loops until then, so nothing is published unseen.
alter table public.profile_private add column if not exists territory_notice_at timestamptz;

create or replace function public.get_my_profile() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p.id, 'nickname', p.nickname, 'color', p.color, 'created_at', p.created_at,
    'invite_code', pp.invite_code, 'territory_opt_in', pp.territory_opt_in,
    'territory_notice_seen', pp.territory_notice_at is not null,
    'notify_overtake', pp.notify_overtake, 'notify_sessions', pp.notify_sessions,
    'notify_friend_requests', pp.notify_friend_requests)
  from public.profiles p join public.profile_private pp on pp.user_id = p.id
  where p.id = auth.uid();
$$;

-- p: {color?, territory_opt_in?, territory_notice_seen?, notify_overtake?, notify_sessions?, notify_friend_requests?}
-- territory_notice_seen: true records the acknowledgement (once); false leaves it unchanged.
create or replace function public.set_my_settings(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); k text;
begin
  if v_uid is null then perform private.fail('not_authenticated'); end if;
  if not exists (select 1 from public.profiles where id = v_uid) then perform private.fail('no_profile'); end if;
  if p is null or jsonb_typeof(p) <> 'object' then perform private.fail('invalid_payload'); end if;
  foreach k in array array['territory_opt_in', 'territory_notice_seen', 'notify_overtake', 'notify_sessions',
                           'notify_friend_requests'] loop
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
    territory_notice_at = case when coalesce((p->>'territory_notice_seen')::boolean, false)
                               then coalesce(territory_notice_at, now()) else territory_notice_at end,
    notify_overtake = coalesce((p->>'notify_overtake')::boolean, notify_overtake),
    notify_sessions = coalesce((p->>'notify_sessions')::boolean, notify_sessions),
    notify_friend_requests = coalesce((p->>'notify_friend_requests')::boolean, notify_friend_requests)
  where user_id = v_uid;
  return public.get_my_profile();
end $$;

-- B1 + S4 ---------------------------------------------------------------------------------------------
-- Claim the cells whose centres lie inside a closed run loop, except those within 300 m (haversine, the
-- same formula as src/lib/geo.ts) of the trace's first or last point: a privacy zone around the start, so
-- the squares do not undo the 200–300 m endpoint trimming of shared routes. Skips silently when not
-- applicable, including before the owner has acknowledged the territory notice.
create or replace function private.claim_territory(p_activity uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  a public.activities; v_line extensions.geometry; v_poly extensions.geometry; v_area float8;
  i0 int; i1 int; j0 int; j1 int; v_claimed int; v_stolen int;
  s_lat float8; s_lon float8; e_lat float8; e_lon float8;
  c_zone constant float8 := 300;
begin
  select * into a from public.activities where id = p_activity;
  if a.kind <> 'run' or a.status <> 'valid' or not a.is_loop
     or a.month_start not in (private.month_start(now()), private.month_start(now() - interval '3 hours'))
     or not exists (select 1 from public.profile_private
                     where user_id = a.user_id and territory_opt_in and territory_notice_at is not null) then
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
  s_lat := extensions.st_y(extensions.st_startpoint(v_line)); s_lon := extensions.st_x(extensions.st_startpoint(v_line));
  e_lat := extensions.st_y(extensions.st_endpoint(v_line));   e_lon := extensions.st_x(extensions.st_endpoint(v_line));
  i0 := greatest(private.grid_i(extensions.st_xmin(v_poly)), 0);
  i1 := least(private.grid_i(extensions.st_xmax(v_poly)), 1500);
  j0 := greatest(private.grid_j(extensions.st_ymin(v_poly)), 0);
  j1 := least(private.grid_j(extensions.st_ymax(v_poly)), 1555);
  if i1 < i0 or j1 < j0 or (i1 - i0 + 1)::bigint * (j1 - j0 + 1) > 80000 then return; end if;

  -- Both CTEs read the pre-upsert snapshot, so `stolen` counts cells taken from others by this claim.
  with centres as (
    select gi * 10000 + gj as cell_id,
           -71.5::float8 + (gi + 0.5) * 0.0006::float8 as lon, 42.0::float8 + (gj + 0.5) * 0.00045::float8 as lat
      from generate_series(i0, i1) gi, generate_series(j0, j1) gj
  ), cells as (
    select cell_id from centres
     where private.ll_dist_m(lat, lon, s_lat, s_lon) > c_zone
       and private.ll_dist_m(lat, lon, e_lat, e_lon) > c_zone
       and extensions.st_intersects(v_poly, extensions.st_setsrid(extensions.st_makepoint(lon, lat), 4326))
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

-- S1 --------------------------------------------------------------------------------------------------
-- One page of cells in a bounding box, ordered by cell_id, after the cursor `p_after` (exclusive).
-- Pages hold at most 1000 rows, PostgREST's default "Max rows", so a full page means "ask again".
-- The client (src/territory/api.ts TERRITORY_PAGE_SIZE) pages up to its own cap and reports truncation.
drop function if exists public.get_territory(float8, float8, float8, float8, date);
create function public.get_territory(p_south float8, p_west float8, p_north float8, p_east float8,
                                     p_month date default null, p_after int default null, p_limit int default 1000)
returns table (cell_id int, owner_id uuid, nickname text, color smallint)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_month date := coalesce(p_month, private.month_start(now()));
        i0 int := greatest(private.grid_i(p_west), 0); i1 int := least(private.grid_i(p_east), 1500);
        j0 int := greatest(private.grid_j(p_south), 0); j1 int := least(private.grid_j(p_north), 1555);
        v_limit int := least(greatest(coalesce(p_limit, 1000), 1), 1000);
begin
  if auth.uid() is null then perform private.fail('not_authenticated'); end if;
  if p_south is null or p_west is null or p_north is null or p_east is null then perform private.fail('invalid_payload'); end if;
  if i1 < i0 or j1 < j0 then return; end if;
  return query
    select c.cell_id, c.owner_id, p.nickname, p.color
      from public.territory_cells c join public.profiles p on p.id = c.owner_id
     where c.month_start = v_month
       and c.cell_id between greatest(i0 * 10000 + j0, coalesce(p_after, -1) + 1) and i1 * 10000 + j1
       and c.cell_id % 10000 between j0 and j1
     order by c.cell_id
     limit v_limit;
end $$;

-- S2 --------------------------------------------------------------------------------------------------
-- An unknown, blocked or own code/nickname returns 'not_found' instead of raising, so the rate event of
-- the attempt commits and guessing is capped at 20 attempts a day. A request by invite code still
-- auto-accepts (spec §5 G3: sharing the code is consent).
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
    return 'not_found';                                -- blocked looks the same as unknown; the attempt counts
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

-- An unknown group code returns null (the client maps it to not_found), so the attempt's rate event commits.
create or replace function public.join_group(p_code text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_group uuid;
begin
  if v_uid is null then perform private.fail('not_authenticated'); end if;
  if not exists (select 1 from public.profiles where id = v_uid) then perform private.fail('no_profile'); end if;
  perform private.hit_rate_limit('join_group', 20, interval '1 day');
  select id into v_group from public.groups where invite_code = upper(btrim(p_code));
  if v_group is null then return null; end if;
  if private.is_group_member(v_group, v_uid) then return v_group; end if;
  if (select count(*) from public.group_members where group_id = v_group) >= 50
     or (select count(*) from public.group_members where user_id = v_uid) >= 10 then
    perform private.fail('limit_reached');
  end if;
  insert into public.group_members (group_id, user_id) values (v_group, v_uid);
  return v_group;
end $$;

-- S8 --------------------------------------------------------------------------------------------------
create or replace function public.rotate_group_code(p_group uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v_code text := private.new_code(8);
begin
  if not exists (select 1 from public.groups where id = p_group and owner_id = auth.uid()) then
    perform private.fail('forbidden');
  end if;
  perform private.hit_rate_limit('rotate_group_code', 5, interval '1 day');
  update public.groups set invite_code = v_code where id = p_group and owner_id = auth.uid();
  return v_code;
end $$;

-- S5 --------------------------------------------------------------------------------------------------
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); g record;
begin
  if v_uid is null then perform private.fail('not_authenticated'); end if;
  for g in select id from public.groups where owner_id = v_uid loop
    perform private.hand_over_group(g.id, v_uid);
  end loop;
  delete from private.rate_events where user_id = v_uid;   -- no FK; would otherwise linger up to 2 days
  delete from auth.users where id = v_uid;                 -- cascades through profiles to every owned row
end $$;

-- S7 --------------------------------------------------------------------------------------------------
-- A small, original, deliberately conservative seed (substring match after leet folding, so short or
-- common fragments are left out to avoid blocking ordinary names: "ass" (class), "cum" (cucumber),
-- "rape" (grape), "shit" (Yoshito), "coon" (raccoon), "nazi" (Nazir), "dick", "cock", "anal", "pedo").
-- The lead may load a maintained list on top of it (spec §6); a third-party list needs attribution in
-- THIRD_PARTY_NOTICES.md.
insert into private.banned_terms (term) values
  ('fuck'), ('shithead'), ('bullshit'), ('cunt'), ('bitch'), ('whore'), ('slut'), ('twat'), ('wanker'), ('bastard'),
  ('asshole'), ('nigger'), ('nigga'), ('faggot'), ('fagot'), ('retard'), ('tranny'), ('kike'), ('wetback'), ('chink'),
  ('raghead'), ('towelhead'), ('beaner'),
  ('hitler'), ('kkk'), ('rapist'), ('pedophile'), ('paedophile'), ('molester'),
  ('porn'), ('jizz'), ('blowjob'), ('handjob'), ('dildo')
on conflict do nothing;

-- N10 -------------------------------------------------------------------------------------------------
-- One failing archive no longer skips the other: each runs as its own job.
select cron.unschedule('teal-rollover') where exists (select 1 from cron.job where jobname = 'teal-rollover');
select cron.schedule('teal-rollover-boards', '7 * * * *', $$select private.archive_closed_periods();$$);
select cron.schedule('teal-rollover-territory', '8 * * * *', $$select private.archive_territory();$$);

-- Grants (same sweep as 000800; the recreated get_territory needs it) ---------------------------------
revoke all on all tables in schema public from anon;
revoke insert, update, delete, truncate on all tables in schema public from authenticated;
grant select on all tables in schema public to authenticated;        -- still filtered by RLS
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_group_member(uuid, uuid), private.session_topic_allowed(text) to authenticated;
