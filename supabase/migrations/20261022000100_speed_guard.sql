-- Teal speed guard: an activity that stays faster than running (6.7 m/s) or Bluebike (12.5 m/s) pace
-- for 20 s earns a warning; another 45 s too fast (counted only while too fast) voids it. submit_activity
-- rejects a void activity with 'too_fast', so nothing is stored and it never reaches leaderboards or
-- territory. Mirrors trackOverspeed() in src/activity/speedGuard.ts; keep the two in lockstep.

create or replace function private.track_overspeed(p_kind public.activity_kind, t int[], la float8[], lo float8[])
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  c_limit constant float8 := case p_kind when 'run' then 6.7 else 12.5 end;
  c_sustain constant int := 20000; c_grace constant int := 45000; c_gap constant int := 30000;
  v_run bigint := 0; v_post bigint := 0; v_before bigint; v_warned boolean := false; dt int;
begin
  for i in 2 .. coalesce(array_length(t, 1), 0) loop
    dt := t[i] - t[i - 1];
    if dt <= 0 or dt > c_gap then v_run := 0; continue; end if;           -- gaps reset the episode
    if private.ll_dist_m(la[i - 1], lo[i - 1], la[i], lo[i]) / (dt / 1000.0) > c_limit then
      v_before := v_run;
      v_run := v_run + dt;
      if not v_warned then
        if v_run >= c_sustain then
          v_warned := true;
          v_post := v_post + v_run - greatest(v_before, c_sustain);      -- the excess already counts as grace
        end if;
      else
        v_post := v_post + dt;
      end if;
      if v_post >= c_grace then return true; end if;
    else
      v_run := 0;
    end if;
  end loop;
  return false;
end $$;

revoke all on function private.track_overspeed(public.activity_kind, int[], float8[], float8[]) from public;

-- submit_activity from 20261021000400_activities.sql, unchanged except for the too_fast check after the
-- segment loop.
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
  v_best float8; v_best_start int; v_s int; v_e int; frac float8; tt float8; dur float8;
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
  if array_position(t, null) is not null or array_position(la, null) is not null
     or array_position(lo, null) is not null then
    perform private.fail('invalid_payload');
  end if;

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
       select 1 from public.group_session_participants gp join public.group_sessions gs on gs.id = gp.session_id
        where gp.session_id = v_session and gp.user_id = v_uid
          and v_started >= coalesce(gs.started_at, gs.created_at) - interval '15 minutes'
          and v_started <= coalesce(gs.ended_at, now())) then
    v_session := null;
    v_flags := array_append(v_flags, 'session_mismatch');
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

  -- Too fast for too long: the activity is deleted, not stored (src/activity/speedGuard.ts).
  if private.track_overspeed(v_kind, t, la, lo) then perform private.fail('too_fast'); end if;

  select percentile_cont(0.5) within group (order by t[k + 1] - t[k]) into v_median
    from generate_series(1, n - 1) k;

  if v_excl > 0.2 * (v_dist + v_excl) then v_status := 'flagged'; v_flags := array_append(v_flags, 'vehicle'); end if;
  if v_median > 5000 then v_flags := array_append(v_flags, 'sparse'); end if;
  if v_dist < 200 then v_flags := array_append(v_flags, 'too_short'); end if;

  -- Best efforts (runs only): the minimum, over start points v_s, of the interpolated time at which counted
  -- distance first reaches cum[v_s] + D, minus t[v_s]. A window never spans an uncounted segment. Two pointers:
  -- as v_s advances, its crossing segment v_e never moves back. Mirrors bestEffort() in src/activity/metrics.ts.
  if v_kind = 'run' then
    for di in 1 .. 3 loop
      continue when v_dist < dists[di];
      v_best := null; v_e := 2;
      for si in 1 .. n - 1 loop
        if v_e <= si then v_e := si + 1; end if;
        while v_e <= n and ok[v_e] and cum[v_e] - cum[si] < dists[di] loop v_e := v_e + 1; end loop;
        exit when v_e > n;                                             -- later starts reach even less far
        continue when not ok[v_e];                                     -- blocked by a gap or vehicle segment
        frac := (cum[si] + dists[di] - cum[v_e - 1]) / (cum[v_e] - cum[v_e - 1]);
        tt := t[v_e - 1] + frac * (t[v_e] - t[v_e - 1]);
        dur := tt - t[si];
        if v_best is null or dur < v_best then v_best := dur; v_best_start := t[si]; end if;
      end loop;
      if v_best is not null then
        if v_best < floors[di] then
          v_status := 'flagged';
          if not ('implausible_effort' = any(v_flags)) then v_flags := array_append(v_flags, 'implausible_effort'); end if;
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
