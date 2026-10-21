-- Teal gamification (spec §2.1) 4/8: activities, raw traces (owner only), best efforts, submit_activity.
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
-- Foreign-key indexes (cascading deletes on account deletion; advisor `unindexed_foreign_keys`).
create index activity_traces_user on public.activity_traces (user_id);
create index activity_efforts_user on public.activity_efforts (user_id);

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
