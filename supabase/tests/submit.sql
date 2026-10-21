-- submit_activity: rejections, idempotency, server metrics parity with src/activity/metrics.ts, and route trimming.
-- Parity values come from src/activity/__tests__/metrics.test.ts (PARITY) on __fixtures__/tracks.ts parityTrack():
--   distance 10205.359 m, excluded 900.012 m, moving 2 900 000 ms, 1K 276 269 ms @ 36 000, 5K 1 422 412 ms @ 44 000.
-- Run as postgres with MCP execute_sql; everything is rolled back. Record the server numbers printed by the NOTICE.
begin;

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values
  ('a0000000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'submit-a@teal-test.invalid', now(), now());

-- The parity track, built with the same closed form as parityTrack() (k = 0..3000, gap 1500 < k < 1540).
create function public._test_parity_points() returns jsonb language sql as $$
  with v as (
    select k, case when k = 0 then 0::float8
                   when k > 2000 and k <= 2060 then 15::float8
                   else 3.5::float8 + 0.8::float8 * sin(k::float8 / 37::float8) end as speed
      from generate_series(0, 3000) k
  ), s as (select k, sum(speed) over (order by k) as dist from v)
  select jsonb_agg(jsonb_build_array(k * 1000, round((42.3::float8 + dist / 6371000::float8 * (180::float8 / pi()))::numeric, 6), -71.1)
                   order by k)
    from s where not (k > 1500 and k < 1540);
$$;

-- A straight run due north at `mps` for `secs` seconds from a start latitude.
create function public._test_line(p_lat float8, p_secs int, p_mps float8 default 4) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_array(k * 1000, round((p_lat + (k * p_mps) / 6371000 * 180 / pi())::numeric, 6), -71.08) order by k)
    from generate_series(0, p_secs) k;
$$;

create function public._test_payload(p_client uuid, p_started timestamptz, p_points jsonb, p_share boolean default false)
returns jsonb language sql as $$
  select jsonb_build_object('client_id', p_client, 'kind', 'run', 'started_at', p_started,
                            'ended_at', p_started + make_interval(secs => (p_points->-1->>0)::float8 / 1000),
                            'share_route', p_share, 'points', p_points);
$$;
grant execute on function public._test_parity_points(), public._test_line(float8, int, float8),
  public._test_payload(uuid, timestamptz, jsonb, boolean) to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
select public.claim_nickname('submit_alpha', true);

-- Parity: the server recomputes everything from the points.
do $$
declare s jsonb; e1 jsonb; e5 jsonb;
begin
  assert jsonb_array_length(public._test_parity_points()) = 2962, 'parity track length';
  assert public._test_parity_points()->1 = '[1000, 42.300032, -71.1]'::jsonb, 'parity point 1';
  s := public.submit_activity(public._test_payload('c1000000-0000-4000-8000-000000000001', now() - interval '60 minutes',
                                                   public._test_parity_points()));
  select e into e1 from jsonb_array_elements(s->'efforts') e where (e->>'distance_m')::int = 1000;
  select e into e5 from jsonb_array_elements(s->'efforts') e where (e->>'distance_m')::int = 5000;
  raise notice 'server parity: distance % excluded % moving % 1K % @ % 5K % @ %',
    s->>'distance_m', s->>'excluded_m', s->>'moving_ms', e1->>'duration_ms', e1->>'start_offset_ms', e5->>'duration_ms', e5->>'start_offset_ms';
  assert abs((s->>'distance_m')::float8 - 10205.359) <= 1, 'distance parity: ' || (s->>'distance_m');
  assert abs((s->>'excluded_m')::float8 - 900.012) <= 1, 'excluded parity: ' || (s->>'excluded_m');
  assert (s->>'moving_ms')::int = 2900000, 'moving parity: ' || (s->>'moving_ms');
  assert (s->>'elapsed_ms')::int = 3000000, 'elapsed';
  assert abs((e1->>'duration_ms')::int - 276269) <= 50 and (e1->>'start_offset_ms')::int = 36000, '1K parity: ' || e1::text;
  assert abs((e5->>'duration_ms')::int - 1422412) <= 50 and (e5->>'start_offset_ms')::int = 44000, '5K parity: ' || e5::text;
  assert jsonb_array_length(s->'efforts') = 2, 'no 10K across the gap or the car';
  assert s->>'status' = 'valid' and s->'flags' = '[]'::jsonb, 'valid, no flags: ' || (s->'flags')::text;
  assert (s->>'leaderboard_eligible')::boolean, 'eligible';

  -- Idempotent retry: same client_id returns the stored summary.
  assert (public.submit_activity(public._test_payload('c1000000-0000-4000-8000-000000000001', now() - interval '60 minutes',
                                                      public._test_parity_points()))->>'id') = s->>'id', 'idempotent retry';
end $$;

-- Rejections store nothing.
do $$
declare before int := (select count(*) from public.activities);
begin
  begin  -- timestamps not strictly increasing
    perform public.submit_activity(public._test_payload('c2000000-0000-4000-8000-000000000002', now() - interval '6 hours',
      '[[0, 42.3, -71.1], [2000, 42.30001, -71.1], [2000, 42.30002, -71.1]]'::jsonb));
    raise exception 'expected invalid_time (non-monotonic)';
  exception when sqlstate 'P0001' then assert sqlerrm = 'invalid_time', sqlerrm;
  end;
  begin  -- ends in the future
    perform public.submit_activity(public._test_payload('c3000000-0000-4000-8000-000000000003', now() + interval '10 minutes',
      public._test_line(42.31, 300)));
    raise exception 'expected invalid_time (future)';
  exception when sqlstate 'P0001' then assert sqlerrm = 'invalid_time', sqlerrm;
  end;
  begin  -- stated span disagrees with the samples
    perform public.submit_activity(jsonb_build_object('client_id', 'c4000000-0000-4000-8000-000000000004', 'kind', 'run',
      'started_at', now() - interval '5 hours', 'ended_at', now() - interval '4 hours', 'points', public._test_line(42.31, 300)));
    raise exception 'expected invalid_time (span)';
  exception when sqlstate 'P0001' then assert sqlerrm = 'invalid_time', sqlerrm;
  end;
  begin  -- overlaps the parity run
    perform public.submit_activity(public._test_payload('c5000000-0000-4000-8000-000000000005', now() - interval '40 minutes',
      public._test_line(42.31, 300)));
    raise exception 'expected overlap';
  exception when sqlstate 'P0001' then assert sqlerrm = 'overlap', sqlerrm;
  end;
  begin  -- one point
    perform public.submit_activity(public._test_payload('c6000000-0000-4000-8000-000000000006', now() - interval '7 hours', '[[0, 42.3, -71.1]]'::jsonb));
    raise exception 'expected invalid_payload';
  exception when sqlstate 'P0001' then assert sqlerrm = 'invalid_payload', sqlerrm;
  end;
  begin  -- malformed point
    perform public.submit_activity(public._test_payload('c7000000-0000-4000-8000-000000000007', now() - interval '7 hours',
      '[[0, 42.3, -71.1], [1000, null, -71.1]]'::jsonb));
    raise exception 'expected invalid_payload (null)';
  exception when sqlstate 'P0001' then assert sqlerrm = 'invalid_payload', sqlerrm;
  end;
  assert (select count(*) from public.activities) = before, 'rejections stored nothing';
end $$;

-- Flags: a 40 s run is too short and sparse sampling is not eligible.
do $$
declare s jsonb;
begin
  s := public.submit_activity(public._test_payload('c8000000-0000-4000-8000-000000000008', now() - interval '8 hours', public._test_line(42.32, 40)));
  assert s->'flags' ? 'too_short' and s->>'status' = 'valid' and not (s->>'leaderboard_eligible')::boolean, 'too_short: ' || s::text;
  s := public.submit_activity(public._test_payload('c9000000-0000-4000-8000-000000000009', now() - interval '9 hours',
    (select jsonb_agg(e) from jsonb_array_elements(public._test_line(42.33, 1200)) with ordinality x(e, i) where (i - 1) % 6 = 0)));
  assert s->'flags' ? 'sparse' and not (s->>'leaderboard_eligible')::boolean, 'sparse: ' || s::text;
end $$;

-- Shared route: each end trimmed by 200-300 m along the route, the rest simplified; unsharing nulls it.
do $$
declare s jsonb; v_start float8; v_end float8;
begin
  s := public.submit_activity(public._test_payload('ca000000-0000-4000-8000-00000000000a', now() - interval '12 hours',
                                                   public._test_line(42.34, 750), true));   -- 3 km due north
  reset role;
  select extensions.st_distance(extensions.st_startpoint(a.public_path)::extensions.geography,
                                extensions.st_startpoint(extensions.st_force2d(t.path))::extensions.geography),
         extensions.st_distance(extensions.st_endpoint(a.public_path)::extensions.geography,
                                extensions.st_endpoint(extensions.st_force2d(t.path))::extensions.geography)
    into v_start, v_end
    from public.activities a join public.activity_traces t on t.activity_id = a.id
   where a.id = (s->>'id')::uuid;
  raise notice 'trimmed: start % m, end % m', round(v_start::numeric, 1), round(v_end::numeric, 1);
  assert v_start between 199 and 305 and v_end between 199 and 305, 'trim lengths';
  set local role authenticated;
  perform public.set_activity_sharing((s->>'id')::uuid, false);
  reset role;
  assert (select public_path is null and not share_route from public.activities where id = (s->>'id')::uuid), 'unshare nulls the path';
  -- After retention purges the trace, re-sharing is refused.
  delete from public.activity_traces where activity_id = (s->>'id')::uuid;
  set local role authenticated;
  begin
    perform public.set_activity_sharing((s->>'id')::uuid, true);
    raise exception 'expected trace_expired';
  exception when sqlstate 'P0001' then assert sqlerrm = 'trace_expired', sqlerrm;
  end;
end $$;

-- A shared run under 1 km gets no public path.
do $$
declare s jsonb;
begin
  s := public.submit_activity(public._test_payload('cb000000-0000-4000-8000-00000000000b', now() - interval '14 hours', public._test_line(42.35, 200), true));
  reset role;
  assert (select public_path is null from public.activities where id = (s->>'id')::uuid), 'under 1 km: no public path';
end $$;

-- Speed guard (src/activity/speedGuard.ts): 20 s too fast warns, 45 s more deletes. A void run is rejected and
-- nothing is stored; one that slowed down after the warning is kept. (The parity track's 60 s car stretch is
-- 20 s of warning plus 40 s of grace, so it stays valid above.)
do $$
declare s jsonb;
begin
  set local role authenticated;
  begin
    perform public.submit_activity(public._test_payload('cc000000-0000-4000-8000-00000000000c', now() - interval '16 hours',
                                                        public._test_line(42.36, 120, 9)));
    assert false, 'too fast for 120 s should be rejected';
  exception when sqlstate 'P0001' then assert sqlerrm = 'too_fast', sqlerrm;
  end;
  s := public.submit_activity(public._test_payload('cd000000-0000-4000-8000-00000000000d', now() - interval '18 hours',
                                                   public._test_line(42.37, 50, 9)));
  assert s->>'id' is not null, 'warned but slowed down: kept';
  reset role;
  assert not exists (select 1 from public.activities where client_id = 'cc000000-0000-4000-8000-00000000000c'), 'nothing stored';
  assert not private.track_overspeed('run', array[0, 1000], array[42.3, 42.4], array[-71.1, -71.1]), 'one jump is not sustained';
  assert not private.track_overspeed('bike', (select array_agg(k * 1000) from generate_series(0, 300) k),
    (select array_agg(42.3 + k * 9 / 111195.0) from generate_series(0, 300) k), array_fill(-71.1::float8, array[301])), '9 m/s is fine on a bike';
end $$;

select 'submit.sql passed' as result;
rollback;
