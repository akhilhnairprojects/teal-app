-- Teal gamification (spec §2.1) 5/8: leaderboards (computed live), featured runs, champions archive, session results.
create table public.leaderboard_archive (
  period text not null check (period in ('week', 'month')),
  period_start date not null,
  board text not null,
  rank int not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  value bigint not null,
  primary key (period, period_start, board, user_id)
);
alter table public.leaderboard_archive enable row level security;
create policy leaderboard_archive_read on public.leaderboard_archive for select to authenticated using (true);
create index leaderboard_archive_user on public.leaderboard_archive (user_id);   -- FK cascade

create table private.period_runs (job text not null, period_start date not null, ran_at timestamptz not null default now(),
                                  primary key (job, period_start));
alter table private.period_runs enable row level security;

-- Unranked board rows. p_users null = everyone. value: ms for efforts, whole metres for distance.
create or replace function private.board_rows(p_board text, p_period text, p_start date, p_users uuid[])
returns table (user_id uuid, value bigint, activity_id uuid, achieved_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_dist int;
begin
  if p_board in ('run_1k', 'run_5k', 'run_10k') then
    v_dist := case p_board when 'run_1k' then 1000 when 'run_5k' then 5000 else 10000 end;
    return query
      select distinct on (e.user_id) e.user_id, e.duration_ms::bigint, e.activity_id, a.started_at
        from public.activity_efforts e join public.activities a on a.id = e.activity_id
       where e.distance_m = v_dist and e.eligible
         and (case when p_period = 'week' then e.week_start else e.month_start end) = p_start
         and (p_users is null or e.user_id = any(p_users))
       order by e.user_id, e.duration_ms, a.started_at;
  elsif p_board in ('run_distance', 'bike_distance') then
    return query
      select a.user_id, round(sum(a.distance_m))::bigint, null::uuid, max(a.ended_at)
        from public.activities a
       where a.kind = (case p_board when 'run_distance' then 'run' else 'bike' end)::public.activity_kind
         and a.status = 'valid' and a.leaderboard_eligible
         and (case when p_period = 'week' then a.week_start else a.month_start end) = p_start
         and (p_users is null or a.user_id = any(p_users))
       group by a.user_id;
  else
    perform private.fail('invalid_payload');
  end if;
end $$;

create or replace function public.get_leaderboard(p_board text, p_period text, p_period_start date default null,
                                                  p_scope text default 'global', p_group_id uuid default null,
                                                  p_limit int default 50)
returns table (rank int, user_id uuid, nickname text, color smallint, value bigint, activity_id uuid,
               achieved_on date, is_me boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid(); v_start date; v_users uuid[];
  v_asc boolean := p_board in ('run_1k', 'run_5k', 'run_10k');
begin
  if v_uid is null then perform private.fail('not_authenticated'); end if;
  if p_period not in ('week', 'month') then perform private.fail('invalid_payload'); end if;
  v_start := coalesce(p_period_start, case when p_period = 'week' then private.week_start(now()) else private.month_start(now()) end);
  if p_scope = 'friends' then
    v_users := array(select private.friend_ids(v_uid)) || v_uid;
  elsif p_scope = 'group' then
    if not private.is_group_member(p_group_id, v_uid) then perform private.fail('not_member'); end if;
    v_users := array(select m.user_id from public.group_members m where m.group_id = p_group_id);
  elsif p_scope <> 'global' then
    perform private.fail('invalid_payload');
  end if;
  return query
    with r as (
      select (rank() over (order by case when v_asc then b.value else -b.value end, b.achieved_at))::int as rk, b.*
        from private.board_rows(p_board, p_period, v_start, v_users) b)
    select r.rk, r.user_id, p.nickname, p.color, r.value, r.activity_id,
           (r.achieved_at at time zone 'America/New_York')::date, r.user_id = v_uid
      from r join public.profiles p on p.id = r.user_id
     where r.rk <= least(greatest(p_limit, 1), 100) or r.user_id = v_uid
     order by r.rk, p.nickname;
end $$;

-- Featured runs: top 3 per standard distance (one per runner), one card per activity. Route only if shared.
create or replace function public.get_featured_runs(p_period text, p_period_start date default null, p_limit int default 10)
returns table (activity_id uuid, nickname text, color smallint, effort_m int, duration_ms int, total_m real,
               achieved_on date, route_polyline text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_start date;
begin
  if auth.uid() is null then perform private.fail('not_authenticated'); end if;
  v_start := coalesce(p_period_start, case when p_period = 'week' then private.week_start(now()) else private.month_start(now()) end);
  return query
    with best as (
      select distinct on (e.distance_m, e.user_id) e.*
        from public.activity_efforts e
       where e.eligible and (case when p_period = 'week' then e.week_start else e.month_start end) = v_start
       order by e.distance_m, e.user_id, e.duration_ms),
    top as (select b.*, row_number() over (partition by b.distance_m order by b.duration_ms) rn from best b),
    picked as (select distinct on (t.activity_id) t.* from top t where t.rn <= 3 order by t.activity_id, t.distance_m desc)
    select a.id, p.nickname, p.color, k.distance_m, k.duration_ms, a.distance_m,
           (a.started_at at time zone 'America/New_York')::date,
           case when a.share_route and a.public_path is not null
                then extensions.st_asencodedpolyline(a.public_path, 5) end
      from picked k join public.activities a on a.id = k.activity_id join public.profiles p on p.id = k.user_id
     order by k.distance_m desc, k.duration_ms
     limit least(greatest(p_limit, 1), 30);
end $$;

create or replace function public.get_champions(p_period text, p_period_start date)
returns table (board text, rank int, user_id uuid, nickname text, color smallint, value bigint)
language sql stable security definer set search_path = '' as $$
  select l.board, l.rank, l.user_id, p.nickname, p.color, l.value
    from public.leaderboard_archive l join public.profiles p on p.id = l.user_id
   where l.period = p_period and l.period_start = p_period_start and auth.uid() is not null
   order by l.board, l.rank;
$$;

create or replace function private.archive_board_period(p_period text, p_start date) returns void
language plpgsql security definer set search_path = '' as $$
declare b text;
begin
  insert into private.period_runs (job, period_start) values (p_period, p_start) on conflict do nothing;
  if not found then return; end if;                                   -- already archived
  foreach b in array array['run_1k', 'run_5k', 'run_10k', 'run_distance', 'bike_distance'] loop
    insert into public.leaderboard_archive (period, period_start, board, rank, user_id, value)
    select p_period, p_start, b, rk, x.user_id, x.value from (
      select rank() over (order by case when b in ('run_1k', 'run_5k', 'run_10k') then r.value else -r.value end,
                                   r.achieved_at)::int rk, r.*
        from private.board_rows(b, p_period, p_start, null) r) x
     where rk <= 10;
  end loop;
end $$;

-- Hourly (cron). A period is archived 3 h after it closes (late-sync grace, matches v_eligible).
create or replace function private.archive_closed_periods() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.archive_board_period('week', private.week_start(now() - interval '3 hours') - 7);
  perform private.archive_board_period('month', (private.month_start(now() - interval '3 hours') - interval '1 month')::date);
end $$;

-- Group session results: each participant's latest activity attached to the session.
create or replace function public.get_session_results(p_session uuid)
returns table (user_id uuid, nickname text, color smallint, activity_status text, distance_m real, moving_ms int,
               elapsed_ms int, best_1k_ms int, best_5k_ms int)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not exists (select 1 from public.group_sessions s where s.id = p_session
                   and private.is_group_member(s.group_id, auth.uid())) then
    perform private.fail('not_found');
  end if;
  return query
    select p.id, p.nickname, p.color, a.status::text, a.distance_m, a.moving_ms, a.elapsed_ms,
           (select e.duration_ms from public.activity_efforts e where e.activity_id = a.id and e.distance_m = 1000),
           (select e.duration_ms from public.activity_efforts e where e.activity_id = a.id and e.distance_m = 5000)
      from public.group_session_participants gp
      join public.profiles p on p.id = gp.user_id
      left join lateral (select * from public.activities x where x.group_session_id = p_session and x.user_id = gp.user_id
                          order by x.ended_at desc limit 1) a on true
     where gp.session_id = p_session
     order by a.distance_m desc nulls last;
end $$;
