-- Friends, blocks, groups, sessions, limits and the overtake notification (spec §5 G3 acceptance).
-- Run as postgres with MCP execute_sql; everything is rolled back. Assumes it is not run in the first 2 hours of an ET week.
begin;

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values
  ('a0000000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'social-a@teal-test.invalid', now(), now()),
  ('b0000000-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'social-b@teal-test.invalid', now(), now()),
  ('c0000000-0000-4000-8000-00000000000c', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'social-c@teal-test.invalid', now(), now());

create function public._test_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create function public._test_run(p_client uuid, p_started timestamptz, p_secs int) returns jsonb language sql as $$
  select public.submit_activity(jsonb_build_object('client_id', p_client, 'kind', 'run', 'started_at', p_started,
    'ended_at', p_started + make_interval(secs => p_secs),
    'points', (select jsonb_agg(jsonb_build_array(k * 1000, round((42.33 + (k * 4.0) / 6371000 * 180 / pi())::numeric, 6), -71.08) order by k)
                 from generate_series(0, p_secs) k)));
$$;
grant execute on function public._test_as(uuid), public._test_run(uuid, timestamptz, int) to authenticated;

set local role authenticated;
select public._test_as('a0000000-0000-4000-8000-00000000000a');
select public.claim_nickname('social_alpha', true);
select public._test_as('b0000000-0000-4000-8000-00000000000b');
select public.claim_nickname('social_bravo', true);
select public._test_as('c0000000-0000-4000-8000-00000000000c');

-- Nicknames: unique ignoring case, 13+ required, rename rules.
-- The uniqueness check runs on C's first claim: a rename inside the 7-day window reports nickname_too_soon
-- before availability is considered (the name cannot be changed at all yet).
do $$ begin
  begin
    perform public.claim_nickname('SOCIAL_ALPHA', true);
    raise exception 'expected nickname_taken';
  exception when sqlstate 'P0001' then assert sqlerrm = 'nickname_taken', sqlerrm;
  end;
  perform public.claim_nickname('social_charlie', true);
  assert public.claim_nickname('Social_Charlie', false)->>'nickname' = 'Social_Charlie', 'case-only rename is always allowed';
  begin
    perform public.claim_nickname('charlie_two', false);
    raise exception 'expected nickname_too_soon';
  exception when sqlstate 'P0001' then assert sqlerrm = 'nickname_too_soon', sqlerrm;
  end;
  begin
    perform public.claim_nickname('admin', false);
    raise exception 'expected nickname_invalid';
  exception when sqlstate 'P0001' then assert sqlerrm = 'nickname_invalid', sqlerrm;
  end;
end $$;

-- Friend requests: by nickname = pending; by code = accepted at once; responding accepts.
do $$
declare v_code text;
begin
  perform public._test_as('a0000000-0000-4000-8000-00000000000a');
  assert public.send_friend_request('social_bravo') = 'requested', 'nickname request is pending';
  assert public.send_friend_request('SOCIAL_BRAVO') = 'requested', 'repeat is idempotent';
  perform public._test_as('b0000000-0000-4000-8000-00000000000b');
  assert (select status from public.list_friends() where nickname = 'social_alpha') = 'incoming', 'B sees incoming';
  assert exists (select 1 from public.notifications where kind = 'friend_request'), 'B was notified';
  perform public.respond_friend_request('a0000000-0000-4000-8000-00000000000a', true);
  assert (select status from public.list_friends() where nickname = 'social_alpha') = 'friends', 'accepted';

  reset role;
  select invite_code into v_code from public.profile_private where user_id = 'b0000000-0000-4000-8000-00000000000b';
  set local role authenticated;
  perform public._test_as('c0000000-0000-4000-8000-00000000000c');
  assert public.send_friend_request(null, lower(v_code)) = 'accepted', 'a request by code auto-accepts';
  assert (select status from public.list_friends() where nickname = 'social_bravo') = 'friends', 'C and B are friends';
  -- Misses return 'not_found' as a value (not an error), so the attempt's rate event commits (review S2).
  assert public.send_friend_request('social_charlie') = 'not_found', 'not_found for myself';
end $$;

-- Blocking hides the blocker: a request to them looks like an unknown nickname, and the friendship ends.
do $$ begin
  perform public._test_as('a0000000-0000-4000-8000-00000000000a');
  perform public.block_user('c0000000-0000-4000-8000-00000000000c');
  perform public._test_as('c0000000-0000-4000-8000-00000000000c');
  assert public.send_friend_request('social_alpha') = 'not_found', 'not_found when blocked';
  perform public._test_as('a0000000-0000-4000-8000-00000000000a');
  assert not exists (select 1 from public.list_friends() where nickname ilike 'social_charlie'), 'no friendship with a blocked user';
end $$;

-- Groups and sessions: limits apply; only members see a session; going live notifies members who opted in.
do $$
declare v_group uuid; v_code text; v_s uuid;
begin
  perform public._test_as('b0000000-0000-4000-8000-00000000000b');
  v_group := public.create_group('Sunday Runners');
  select invite_code into v_code from public.list_my_groups() where id = v_group;
  perform public._test_as('a0000000-0000-4000-8000-00000000000a');
  perform public.join_group(v_code);
  perform public._test_as('b0000000-0000-4000-8000-00000000000b');
  perform public.create_group_session(v_group, 'One');
  perform public.create_group_session(v_group, 'Two');
  v_s := public.create_group_session(v_group, 'Three');
  begin
    perform public.create_group_session(v_group, 'Four');
    raise exception 'expected limit_reached (3 open sessions per group)';
  exception when sqlstate 'P0001' then assert sqlerrm = 'limit_reached', sqlerrm;
  end;
  perform public.set_group_session_status(v_s, 'live');
  perform public._test_as('a0000000-0000-4000-8000-00000000000a');
  assert exists (select 1 from public.notifications where kind = 'session_live' and payload->>'title' = 'Three'), 'A notified of live session';
  assert (public.get_group_session(v_s)->>'status') = 'live', 'member reads the session';
  perform public._test_as('c0000000-0000-4000-8000-00000000000c');
  begin
    perform public.get_group_session(v_s);
    raise exception 'expected not_found for a non-member';
  exception when sqlstate 'P0001' then assert sqlerrm = 'not_found', sqlerrm;
  end;
  begin
    perform public.set_group_session_status(v_s, 'ended');
    raise exception 'expected forbidden';
  exception when sqlstate 'P0001' then assert sqlerrm = 'forbidden', sqlerrm;
  end;
  -- Group creation is rate limited at 5 a day.
  perform public.create_group('C One');
  perform public.create_group('C Two');
  perform public.create_group('C Three');
  perform public.create_group('C Four');
  perform public.create_group('C Five');
  begin
    perform public.create_group('C Six');
    raise exception 'expected rate_limited';
  exception when sqlstate 'P0001' then assert sqlerrm = 'rate_limited', sqlerrm;
  end;
end $$;

-- Guessing codes is rate limited (review S2): misses count toward the 20-a-day limits. C has already made
-- 3 friend-request attempts (one by code, two misses), so the 18th guess here is the 21st attempt today.
-- A has joined one group, so the 20th bad group code is A's 21st join attempt. Code rotation: 5 a day (S8).
do $$
declare v_k int := 0; v_group uuid;
begin
  perform public._test_as('c0000000-0000-4000-8000-00000000000c');
  begin
    loop
      v_k := v_k + 1;
      exit when v_k > 30;
      assert public.send_friend_request(null, 'QQQQQQ' || chr(64 + v_k)) = 'not_found', 'a guessed code is not found';
    end loop;
    raise exception 'expected rate_limited for friend codes';
  exception when sqlstate 'P0001' then assert sqlerrm = 'rate_limited' and v_k = 18, sqlerrm || ' at guess ' || v_k;
  end;

  perform public._test_as('a0000000-0000-4000-8000-00000000000a');
  v_k := 0;
  begin
    loop
      v_k := v_k + 1;
      exit when v_k > 30;
      assert public.join_group('QQQQQQ' || chr(64 + v_k)) is null, 'a guessed group code is not found';
    end loop;
    raise exception 'expected rate_limited for group codes';
  exception when sqlstate 'P0001' then assert sqlerrm = 'rate_limited' and v_k = 20, sqlerrm || ' at guess ' || v_k;
  end;

  perform public._test_as('b0000000-0000-4000-8000-00000000000b');
  select id into v_group from public.list_my_groups() where name = 'Sunday Runners';
  perform public._test_as('a0000000-0000-4000-8000-00000000000a');
  begin
    perform public.rotate_group_code(v_group);
    raise exception 'expected forbidden for a non-owner';
  exception when sqlstate 'P0001' then assert sqlerrm = 'forbidden', sqlerrm;
  end;
  perform public._test_as('b0000000-0000-4000-8000-00000000000b');
  for k in 1 .. 5 loop
    assert length(public.rotate_group_code(v_group)) = 8, 'rotation';
  end loop;
  begin
    perform public.rotate_group_code(v_group);
    raise exception 'expected rate_limited for rotations';
  exception when sqlstate 'P0001' then assert sqlerrm = 'rate_limited', sqlerrm;
  end;
end $$;

-- Banned terms (review S7): the built-in seed rejects an obvious slur, including a leet-spelled one.
do $$ begin
  perform public._test_as('b0000000-0000-4000-8000-00000000000b');
  begin
    perform public.create_group('F4ggot Club');
    raise exception 'expected name_invalid';
  exception when sqlstate 'P0001' then assert sqlerrm = 'name_invalid', sqlerrm;
  end;
end $$;

-- Overtake: B runs 2 km this week; A (B's friend) passes B with a second run; one notification per pair per week.
do $$ begin
  perform public._test_as('b0000000-0000-4000-8000-00000000000b');
  perform public._test_run('b1000000-0000-4000-8000-000000000001', now() - interval '110 minutes', 500);   -- 2.0 km
  perform public._test_as('a0000000-0000-4000-8000-00000000000a');
  perform public._test_run('a1000000-0000-4000-8000-000000000001', now() - interval '100 minutes', 375);   -- 1.5 km: behind
  perform public._test_as('b0000000-0000-4000-8000-00000000000b');
  assert not exists (select 1 from public.notifications where kind = 'overtake'), 'no overtake yet';
  perform public._test_as('a0000000-0000-4000-8000-00000000000a');
  perform public._test_run('a2000000-0000-4000-8000-000000000002', now() - interval '80 minutes', 250);    -- +1.0 km: 2.5 > 2.0
  perform public._test_run('a3000000-0000-4000-8000-000000000003', now() - interval '60 minutes', 250);    -- +1.0 km again
  perform public._test_as('b0000000-0000-4000-8000-00000000000b');
  assert (select count(*) from public.notifications where kind = 'overtake') = 1, 'one overtake per pair per week';
  assert (select payload->>'actor_nickname' from public.notifications where kind = 'overtake') = 'social_alpha', 'payload nickname';
  assert (select (payload->>'their_m')::numeric > (payload->>'your_m')::numeric from public.notifications where kind = 'overtake'),
    'payload distances';
  assert (select payload::text from public.notifications where kind = 'overtake') !~ '(lat|lon)', 'no coordinates in payloads';
  assert (select week_run_m from public.list_friends() where nickname = 'social_alpha') > 3000, 'friends see weekly run distance';
end $$;

select 'social.sql passed' as result;
rollback;
