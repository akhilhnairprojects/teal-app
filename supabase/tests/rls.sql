-- RLS and privilege checks (spec §2.3, §7). Run as postgres with MCP execute_sql; everything is rolled back.
-- Test users use the reserved .invalid domain; no real addresses.
begin;

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values
  ('a0000000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-a@teal-test.invalid', now(), now()),
  ('b0000000-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-b@teal-test.invalid', now(), now());

-- A: profile + one shared activity (2 km due north at 4 m/s, ending 10 minutes ago).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
select public.claim_nickname('rls_alpha', true);
select public.submit_activity(jsonb_build_object(
  'client_id', 'a1000000-0000-4000-8000-000000000001', 'kind', 'run',
  'started_at', now() - interval '10 minutes' - interval '500 seconds', 'ended_at', now() - interval '10 minutes',
  'share_route', true,
  'points', (select jsonb_agg(jsonb_build_array(k * 1000, round((42.33 + (k * 4.0) / 6371000 * 180 / pi())::numeric, 6), -71.08) order by k)
               from generate_series(0, 500) k)));

do $$ begin
  assert (select count(*) from public.activities) = 1, 'A sees own activity';
  assert (select count(*) from public.activity_traces) = 1, 'A sees own trace';
  assert (select count(*) from public.activity_efforts) = 1, 'A sees own 1K effort';
  assert (select count(*) from public.profile_private) = 1, 'A sees own private profile';
end $$;

-- B: sees A's public profile (nickname, color) but nothing private.
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
select public.claim_nickname('rls_bravo', true);
do $$ begin
  assert (select count(*) from public.profiles) = 2, 'profiles are readable by signed-in users';
  assert (select count(*) from public.activities where user_id = 'a0000000-0000-4000-8000-00000000000a') = 0, 'B cannot read A activities';
  assert (select count(*) from public.activity_traces) = 0, 'B cannot read A traces';
  assert (select count(*) from public.activity_efforts) = 0, 'B cannot read A efforts';
  assert (select count(*) from public.profile_private where user_id = 'a0000000-0000-4000-8000-00000000000a') = 0, 'B cannot read A profile_private';
  assert (select count(*) from public.territory_cells) = 0, 'territory_cells has no select policy';
end $$;

-- Cross-user RPC checks (review S6). A's ids are read as postgres, so B passes real ids, not NULL.
-- Setup as postgres: a claim row for A's activity, and a group with a session that only A belongs to.
reset role;
insert into public.territory_claims (activity_id, user_id, month_start, cells_claimed, cells_stolen, area_m2)
select id, user_id, month_start, 12, 0, 50000 from public.activities where user_id = 'a0000000-0000-4000-8000-00000000000a';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
select public.create_group_session(public.create_group('Rls Club'), 'Tempo');

do $$
declare v_act uuid; v_group uuid; v_session uuid;
begin
  reset role;
  select id into v_act from public.activities where user_id = 'a0000000-0000-4000-8000-00000000000a';
  select id into v_group from public.groups where name = 'Rls Club';
  select id into v_session from public.group_sessions where group_id = v_group;
  set local role authenticated;
  assert v_act is not null and v_group is not null and v_session is not null, 'setup ids';

  -- Positive controls: A (owner, member) sees all of it, so the B checks below are not vacuous.
  perform set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
  assert public.get_my_activity_track(v_act) is not null, 'A reads own track';
  assert public.get_activity_claim(v_act) is not null, 'A reads own claim';
  assert (select count(*) from public.get_group_members(v_group)) = 1, 'A reads own group members';
  assert public.get_group_session(v_session) is not null, 'A reads own session';
  perform set_config('realtime.topic', 'session:' || v_session, true);
  assert private.session_topic_allowed(realtime.topic()), 'A may join the session channel';

  -- B is not a member and not A.
  perform set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
  assert public.get_my_activity_track(v_act) is null, 'B gets no track for A''s activity';
  assert public.get_activity_claim(v_act) is null, 'B gets no claim for A''s activity';
  assert (select count(*) from public.territory_claims) = 0, 'B cannot read A''s claims table rows';
  assert (select count(*) from public.groups) = 0 and (select count(*) from public.group_sessions) = 0
     and (select count(*) from public.group_members) = 0 and (select count(*) from public.group_session_participants) = 0,
    'B cannot read A''s group tables';
  begin
    perform public.get_group_members(v_group);
    raise exception 'expected not_member';
  exception when sqlstate 'P0001' then assert sqlerrm = 'not_member', sqlerrm;
  end;
  begin
    perform public.get_group_session(v_session);
    raise exception 'expected not_found (session)';
  exception when sqlstate 'P0001' then assert sqlerrm = 'not_found', sqlerrm;
  end;
  begin
    perform public.get_session_results(v_session);
    raise exception 'expected not_found (results)';
  exception when sqlstate 'P0001' then assert sqlerrm = 'not_found', sqlerrm;
  end;
  begin
    perform public.join_group_session(v_session);
    raise exception 'expected not_found (join session)';
  exception when sqlstate 'P0001' then assert sqlerrm = 'not_found', sqlerrm;
  end;
  begin
    perform public.set_group_session_status(v_session, 'ended');
    raise exception 'expected forbidden';
  exception when sqlstate 'P0001' then assert sqlerrm = 'forbidden', sqlerrm;
  end;

  -- Realtime: with A's session topic set, B's identity fails the channel predicate, and B reads no messages.
  -- (Inserting into realtime.messages cannot be exercised here: the table has no partition until the
  -- Realtime service creates one, and tuple routing fails before RLS. The policy wiring is checked below.)
  perform set_config('realtime.topic', 'session:' || v_session, true);
  assert not private.session_topic_allowed(realtime.topic()), 'B may not join A''s session channel';
  assert (select count(*) from realtime.messages) = 0, 'B reads no channel messages';
end $$;

-- The realtime policies are exactly the session predicate, for select and insert, for authenticated only.
reset role;
do $$ begin
  assert (select count(*) from pg_policies
           where schemaname = 'realtime' and tablename = 'messages' and policyname like 'teal_session_channel_%'
             and roles = '{authenticated}'
             and ((cmd = 'SELECT' and qual like '%session_topic_allowed%')
               or (cmd = 'INSERT' and with_check like '%session_topic_allowed%'))) = 2, 'realtime channel policies';
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);

-- Clients never write tables directly.
do $$ begin
  begin
    insert into public.profiles (id, nickname) values ('b0000000-0000-4000-8000-00000000000b', 'sneaky');
    raise exception 'direct insert should fail';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.profile_private set territory_opt_in = false;
    raise exception 'direct update should fail';
  exception when insufficient_privilege then null;
  end;
end $$;

-- B cannot delete or unshare A's activity through the RPCs.
do $$
declare v_a uuid;
begin
  reset role;
  select id into v_a from public.activities where user_id = 'a0000000-0000-4000-8000-00000000000a';
  set local role authenticated;
  begin
    perform public.delete_activity(v_a);
    raise exception 'expected not_found';
  exception when sqlstate 'P0001' then assert sqlerrm = 'not_found', sqlerrm;
  end;
  begin
    perform public.set_activity_sharing(v_a, false);
    raise exception 'expected not_found';
  exception when sqlstate 'P0001' then assert sqlerrm = 'not_found', sqlerrm;
  end;
end $$;

-- anon: no table access and no RPC execute.
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$ begin
  begin
    perform count(*) from public.profiles;
    raise exception 'anon read profiles';
  exception when insufficient_privilege then null;
  end;
  begin
    perform count(*) from public.activities;
    raise exception 'anon read activities';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.get_my_profile();
    raise exception 'anon executed get_my_profile';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.submit_activity('{}'::jsonb);
    raise exception 'anon executed submit_activity';
  exception when insufficient_privilege then null;
  end;
  begin
    perform private.ll_dist_m(0, 0, 0, 0);
    raise exception 'anon executed a private helper';
  exception when insufficient_privilege then null;
  end;
end $$;

-- authenticated cannot call private helpers other than the two RLS helpers.
reset role;
set local role authenticated;
do $$ begin
  begin
    perform private.archive_closed_periods();
    raise exception 'authenticated executed a private job';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Every function in public is SECURITY DEFINER with an empty search_path (advisor: function_search_path_mutable).
reset role;
do $$ begin
  assert not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private')
       and not coalesce(array_to_string(p.proconfig, ',') like '%search_path=""%', false)
  ), 'a public/private function lacks search_path = ''''';
  assert not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
  ), 'anon can execute a public function';
end $$;

select 'rls.sql passed' as result;
rollback;
