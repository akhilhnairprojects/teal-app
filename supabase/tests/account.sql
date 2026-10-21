-- Account deletion and the 180-day trace retention job (review S5; spec §6 "Delete my data", decision O2).
-- Run as postgres with MCP execute_sql; everything is rolled back. Loops are placed in the last hour, so the
-- test assumes it is not run in the first 3 hours of an ET month.
begin;

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values
  ('a0000000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'acct-a@teal-test.invalid', now(), now()),
  ('b0000000-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'acct-b@teal-test.invalid', now(), now());

create function public._test_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
-- A clockwise 400 m × 400 m loop at 4 m/s from (p_lat, p_lon), one point per second.
create function public._test_square(p_client uuid, p_started timestamptz, p_lat float8, p_lon float8) returns jsonb language sql as $$
  with pos as (
    select k, case when k <= 100 then 4.0 * k when k <= 200 then 400 when k <= 300 then 400 - 4.0 * (k - 200) else 0 end as n,
              case when k <= 100 then 0 when k <= 200 then 4.0 * (k - 100) when k <= 300 then 400 else 400 - 4.0 * (k - 300) end as e
      from generate_series(0, 400) k
  )
  select public.submit_activity(jsonb_build_object('client_id', p_client, 'kind', 'run', 'started_at', p_started,
    'ended_at', p_started + interval '400 seconds', 'share_route', true,
    'points', (select jsonb_agg(jsonb_build_array(k * 1000, round((p_lat + n / 6371000 * 180 / pi())::numeric, 6),
                 round((p_lon + e / (6371000 * cos(radians(p_lat))) * 180 / pi())::numeric, 6)) order by k) from pos)));
$$;
grant execute on function public._test_as(uuid), public._test_square(uuid, timestamptz, float8, float8) to authenticated;

-- A: a profile with every kind of owned row. B: a friend and a member of A's group.
set local role authenticated;
select public._test_as('b0000000-0000-4000-8000-00000000000b');
select public.claim_nickname('acct_bravo', true);
select public._test_as('a0000000-0000-4000-8000-00000000000a');
select public.claim_nickname('acct_alpha', true);

do $$
declare v_group uuid; v_code text; s jsonb;
begin
  perform public._test_as('a0000000-0000-4000-8000-00000000000a');
  perform public.set_my_settings('{"territory_notice_seen": true}');
  perform public.register_push_token('ExponentPushToken[acct-test-a]', 'ios');
  s := public._test_square('a1000000-0000-4000-8000-000000000001', now() - interval '40 minutes', 42.352, -71.07);
  assert public.get_activity_claim((s->>'id')::uuid) is not null, 'A claimed territory';
  v_group := public.create_group('Acct Club');
  select invite_code into v_code from public.list_my_groups() where id = v_group;
  perform public.create_group_session(v_group, 'Long run');

  perform public._test_as('b0000000-0000-4000-8000-00000000000b');
  assert public.join_group(v_code) = v_group, 'B joins A''s group';
  assert public.send_friend_request('acct_alpha') = 'requested', 'B asks A';          -- notification to A
  perform public._test_as('a0000000-0000-4000-8000-00000000000a');
  perform public.respond_friend_request('b0000000-0000-4000-8000-00000000000b', true);  -- notification to B, actor A
end $$;

-- Archived boards and champions referencing A (written by the cron jobs in production).
reset role;
insert into public.leaderboard_archive (period, period_start, board, rank, user_id, value)
values ('week', private.week_start(now() - interval '7 days'), 'run_distance', 1, 'a0000000-0000-4000-8000-00000000000a', 5000);
insert into public.territory_champions (month_start, rank, user_id, cells)
values ((private.month_start(now()) - interval '1 month')::date, 1, 'a0000000-0000-4000-8000-00000000000a', 40);

do $$
declare v_a constant uuid := 'a0000000-0000-4000-8000-00000000000a';
begin
  -- Setup sanity: A owns rows everywhere the deletion must reach.
  assert (select count(*) from public.profile_private where user_id = v_a) = 1, 'setup: profile_private';
  assert (select count(*) from public.push_tokens where user_id = v_a) = 1, 'setup: push token';
  assert (select count(*) from public.activities where user_id = v_a) = 1, 'setup: activity';
  assert (select count(*) from public.activity_traces where user_id = v_a) = 1, 'setup: trace';
  assert (select count(*) from public.activity_efforts where user_id = v_a) >= 1, 'setup: efforts';
  assert (select count(*) from public.territory_cells where owner_id = v_a) > 0, 'setup: cells';
  assert (select count(*) from public.territory_claims where user_id = v_a) = 1, 'setup: claim';
  assert (select count(*) from public.notifications where recipient_id = v_a) >= 1, 'setup: notification to A';
  assert (select count(*) from public.notifications where actor_id = v_a) >= 1, 'setup: notification from A';
  assert (select count(*) from public.friendships where v_a in (user_a, user_b)) = 1, 'setup: friendship';
  assert (select count(*) from public.group_members where user_id = v_a) = 1, 'setup: membership';
  assert (select count(*) from public.group_session_participants where user_id = v_a) = 1, 'setup: session participant';
  assert (select count(*) from private.rate_events where user_id = v_a) >= 1, 'setup: rate events';
end $$;

-- A deletes the account through the RPC (runs as its definer, as in production).
set local role authenticated;
select public._test_as('a0000000-0000-4000-8000-00000000000a');
select public.delete_my_account();

reset role;
do $$
declare v_a constant uuid := 'a0000000-0000-4000-8000-00000000000a'; v_group uuid;
begin
  assert not exists (select 1 from auth.users where id = v_a), 'auth user deleted';
  assert not exists (select 1 from public.profiles where id = v_a), 'profile deleted';
  assert not exists (select 1 from public.profile_private where user_id = v_a), 'profile_private deleted';
  assert not exists (select 1 from public.push_tokens where user_id = v_a), 'push tokens deleted';
  assert not exists (select 1 from public.notifications where recipient_id = v_a or actor_id = v_a), 'notifications deleted';
  assert not exists (select 1 from public.friendships where v_a in (user_a, user_b, requested_by)), 'friendships deleted';
  assert not exists (select 1 from public.blocks where v_a in (blocker_id, blocked_id)), 'blocks deleted';
  assert not exists (select 1 from public.group_members where user_id = v_a), 'memberships deleted';
  assert not exists (select 1 from public.group_session_participants where user_id = v_a), 'session participation deleted';
  assert not exists (select 1 from public.group_sessions where created_by = v_a), 'session creator cleared';
  assert not exists (select 1 from public.activities where user_id = v_a), 'activities deleted';
  assert not exists (select 1 from public.activity_traces where user_id = v_a), 'traces deleted';
  assert not exists (select 1 from public.activity_efforts where user_id = v_a), 'efforts deleted';
  assert not exists (select 1 from public.territory_cells where owner_id = v_a), 'territory cells deleted';
  assert not exists (select 1 from public.territory_claims where user_id = v_a), 'territory claims deleted';
  assert not exists (select 1 from public.territory_champions where user_id = v_a), 'champion rows deleted';
  assert not exists (select 1 from public.leaderboard_archive where user_id = v_a), 'archived board rows deleted';
  assert not exists (select 1 from private.rate_events where user_id = v_a), 'rate events deleted';
  -- The group was handed to B, the longest-standing remaining member, with its session kept.
  select id into v_group from public.groups where name = 'Acct Club';
  assert v_group is not null and (select owner_id from public.groups where id = v_group) = 'b0000000-0000-4000-8000-00000000000b',
    'group handed over to B';
  assert (select role from public.group_members where group_id = v_group and user_id = 'b0000000-0000-4000-8000-00000000000b') = 'owner',
    'B is the owner member';
  assert (select count(*) from public.group_sessions where group_id = v_group) = 1, 'the group session stays';
  assert exists (select 1 from public.profiles where id = 'b0000000-0000-4000-8000-00000000000b'), 'B is untouched';
end $$;

-- Retention (decision O2): raw traces older than 180 days are purged; summaries stay.
set local role authenticated;
select public._test_as('b0000000-0000-4000-8000-00000000000b');
select public._test_square('b1000000-0000-4000-8000-000000000001', now() - interval '50 minutes', 42.30, -71.10);
select public._test_square('b2000000-0000-4000-8000-000000000002', now() - interval '30 minutes', 42.30, -71.10);
reset role;
do $$
declare v_old uuid; v_new uuid;
begin
  select id into v_old from public.activities where client_id = 'b1000000-0000-4000-8000-000000000001';
  select id into v_new from public.activities where client_id = 'b2000000-0000-4000-8000-000000000002';
  update public.activity_traces set created_at = now() - interval '181 days' where activity_id = v_old;
  update public.activity_traces set created_at = now() - interval '179 days' where activity_id = v_new;
  perform private.apply_retention();
  assert not exists (select 1 from public.activity_traces where activity_id = v_old), '181-day trace purged';
  assert exists (select 1 from public.activity_traces where activity_id = v_new), '179-day trace kept';
  assert (select count(*) from public.activities where id in (v_old, v_new)) = 2, 'activity summaries kept';
  assert exists (select 1 from public.activities where id = v_old and public_path is not null), 'shared public route kept';
end $$;

select 'account.sql passed' as result;
rollback;
