-- Leaderboards: ranking, tie-breaks, friends/group scopes, the caller's appended row, featured runs and
-- archive idempotency. Run as postgres with MCP execute_sql; everything is rolled back.
-- Activities are placed in the last 2 hours, so the test assumes it is not run in the first 2 hours of an ET week.
begin;

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values
  ('a0000000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'boards-a@teal-test.invalid', now(), now()),
  ('b0000000-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'boards-b@teal-test.invalid', now(), now()),
  ('c0000000-0000-4000-8000-00000000000c', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'boards-c@teal-test.invalid', now(), now());

create function public._test_line(p_lat float8, p_secs int, p_mps float8) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_array(k * 1000, round((p_lat + (k * p_mps) / 6371000 * 180 / pi())::numeric, 6), -71.08) order by k)
    from generate_series(0, p_secs) k;
$$;
create function public._test_submit(p_client uuid, p_started timestamptz, p_secs int, p_mps float8, p_kind text default 'run', p_share boolean default false)
returns jsonb language sql as $$
  select public.submit_activity(jsonb_build_object('client_id', p_client, 'kind', p_kind, 'started_at', p_started,
    'ended_at', p_started + make_interval(secs => p_secs), 'share_route', p_share, 'points', public._test_line(42.33, p_secs, p_mps)));
$$;
create function public._test_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
grant execute on function public._test_line(float8, int, float8), public._test_submit(uuid, timestamptz, int, float8, text, boolean),
  public._test_as(uuid) to authenticated;

set local role authenticated;
select public._test_as('a0000000-0000-4000-8000-00000000000a');
select public.claim_nickname('board_alpha', true);
-- A: 1.2 km at 4 m/s (1K 250 s), shared.
select public._test_submit('a1000000-0000-4000-8000-000000000001', now() - interval '100 minutes', 300, 4, 'run', true);
select public._test_as('b0000000-0000-4000-8000-00000000000b');
select public.claim_nickname('board_bravo', true);
-- B: the same 1.2 km as A (an exact 1K tie, achieved later), 1.6 km more, and a 6 km Bluebike ride.
select public._test_submit('b1000000-0000-4000-8000-000000000001', now() - interval '90 minutes', 300, 4);
select public._test_submit('b3000000-0000-4000-8000-000000000003', now() - interval '75 minutes', 400, 4);
select public._test_submit('b2000000-0000-4000-8000-000000000002', now() - interval '60 minutes', 1000, 6, 'bike');
select public._test_as('c0000000-0000-4000-8000-00000000000c');
select public.claim_nickname('board_charlie', true);
-- C: 1.5 km at 3 m/s (1K 333 s).
select public._test_submit('c1000000-0000-4000-8000-000000000001', now() - interval '80 minutes', 500, 3);

do $$
declare r record; n int; v_a bigint;
begin
  -- Fastest 1K: A and B tie on time; the earlier achiever ranks first. C is third.
  n := 0;
  for r in select * from public.get_leaderboard('run_1k', 'week') loop
    n := n + 1;
    assert r.rank = n, 'ranks are 1..n';
    if n = 1 then v_a := r.value; end if;
    -- 6-dp rounding of the points moves the best 1K by a few ms at most.
    assert (n = 1 and r.nickname = 'board_alpha' and abs(r.value - 250000) <= 50)
        or (n = 2 and r.nickname = 'board_bravo' and r.value = v_a)
        or (n = 3 and r.nickname = 'board_charlie' and abs(r.value - 333333) <= 50), 'run_1k row ' || n || ': ' || r::text;
    assert r.is_me = (r.nickname = 'board_charlie'), 'is_me';
    assert r.achieved_on is not null, 'ET date';
  end loop;
  assert n = 3, 'three runners';

  -- Running distance is descending; bike distance is its own board and never a speed board.
  assert (select nickname from public.get_leaderboard('run_distance', 'month') where rank = 1) = 'board_bravo', 'distance leader';
  assert (select value from public.get_leaderboard('run_distance', 'week') where nickname = 'board_bravo') = 2800, 'run distance excludes the ride';
  assert (select value from public.get_leaderboard('bike_distance', 'week') where rank = 1) = 6000, 'bike distance';

  -- The caller's row is appended when outside the limit.
  assert (select count(*) from public.get_leaderboard('run_1k', 'week', null, 'global', null, 1)) = 2, 'top 1 + me';
  assert (select rank from public.get_leaderboard('run_1k', 'week', null, 'global', null, 1) where is_me) = 3, 'my rank';
end $$;

-- Friends scope: C adds A by invite code (auto-accepted); B is not a friend.
do $$
declare v_code text;
begin
  reset role;
  select invite_code into v_code from public.profile_private where user_id = 'a0000000-0000-4000-8000-00000000000a';
  set local role authenticated;
  assert public.send_friend_request(null, v_code) = 'accepted', 'code request auto-accepts';
  assert (select array_agg(nickname order by rank) from public.get_leaderboard('run_1k', 'week', null, 'friends'))
         = array['board_alpha', 'board_charlie'], 'friends board';
end $$;

-- Group scope: B creates a group, C joins; A is outside it. Non-members are refused.
do $$
declare v_group uuid; v_code text;
begin
  perform public._test_as('b0000000-0000-4000-8000-00000000000b');
  v_group := public.create_group('Board Club');
  select invite_code into v_code from public.list_my_groups() where id = v_group;
  perform public._test_as('c0000000-0000-4000-8000-00000000000c');
  assert public.join_group(lower(v_code)) = v_group, 'join by code (case-insensitive)';
  assert (select array_agg(nickname order by rank) from public.get_leaderboard('run_1k', 'week', null, 'group', v_group))
         = array['board_bravo', 'board_charlie'], 'group board';
  perform public._test_as('a0000000-0000-4000-8000-00000000000a');
  begin
    perform * from public.get_leaderboard('run_1k', 'week', null, 'group', v_group);
    raise exception 'expected not_member';
  exception when sqlstate 'P0001' then assert sqlerrm = 'not_member', sqlerrm;
  end;
end $$;

-- Featured runs: one card per activity; only A's shared route has a polyline; no time of day anywhere.
do $$
declare r record;
begin
  for r in select * from public.get_featured_runs('week') loop
    assert (r.route_polyline is not null) = (r.nickname = 'board_alpha'), 'route only when shared: ' || r.nickname;
  end loop;
  assert (select count(*) from public.get_featured_runs('week')) = 3, 'three 1K cards';
end $$;

-- Archive idempotency: archiving the same period twice gives one set of rows.
reset role;
do $$
declare v_week date := private.week_start(now()); n1 int; n2 int;
begin
  perform private.archive_board_period('week', v_week);
  select count(*) into n1 from public.leaderboard_archive where period = 'week' and period_start = v_week;
  perform private.archive_board_period('week', v_week);
  select count(*) into n2 from public.leaderboard_archive where period = 'week' and period_start = v_week;
  assert n1 > 0 and n1 = n2, 'archive idempotent: ' || n1 || ' vs ' || n2;
  assert (select count(*) from public.leaderboard_archive where period = 'week' and period_start = v_week and board = 'run_1k') = 3, 'run_1k archived';
end $$;
set local role authenticated;
select public._test_as('a0000000-0000-4000-8000-00000000000a');
do $$
declare v_week date;
begin
  select period_start into v_week from public.leaderboard_archive where period = 'week' limit 1;
  assert (select count(*) from public.get_champions('week', v_week) where board = 'run_1k') = 3, 'champions readable';
end $$;

select 'boards.sql passed' as result;
rollback;
