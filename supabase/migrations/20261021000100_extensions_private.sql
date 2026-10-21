-- Teal gamification (spec §2.1) 1/8: extensions, the `private` schema and shared helpers.
-- Conventions for every migration:
--   * Every table in `public` has RLS on. Clients only SELECT (owner- or membership-scoped); every write
--     goes through a SECURITY DEFINER RPC with `set search_path = ''` and fully qualified names.
--   * Expected failures raise SQLSTATE P0001 with a stable code in MESSAGE (spec §4 BackendErrorCode).
--   * `private` is not exposed by PostgREST. Only the two RLS helper functions are executable by clients.
--   * Distances in metres, durations in ms, ET = America/New_York. PostGIS lives in schema `extensions`.
--   * Grid, haversine and best-effort rules match src/territory/grid.ts and src/activity/metrics.ts.

create extension if not exists postgis with schema extensions;
create extension if not exists pgcrypto with schema extensions;     -- gen_random_bytes (on by default in Supabase)
create extension if not exists pg_net with schema extensions;       -- functions live in schema `net`
create extension if not exists pg_cron with schema pg_catalog;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;                    -- RLS helpers only; see the grants in 000800
alter default privileges in schema private revoke execute on functions from public;

create or replace function private.fail(p_code text) returns void
language plpgsql volatile set search_path = '' as $$          -- volatile: never constant-folded
begin
  raise exception using errcode = 'P0001', message = p_code;
end $$;

-- Haversine, R = 6 371 000 m (same formula as src/lib/geo.ts distanceMeters).
create or replace function private.ll_dist_m(lat1 float8, lon1 float8, lat2 float8, lon2 float8)
returns float8 language sql immutable parallel safe set search_path = '' as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lon2 - lon1) / 2), 2)));
$$;

create or replace function private.week_start(ts timestamptz) returns date
language sql stable set search_path = '' as $$
  select date_trunc('week', ts at time zone 'America/New_York')::date;   -- ISO week: Monday
$$;
create or replace function private.month_start(ts timestamptz) returns date
language sql stable set search_path = '' as $$
  select date_trunc('month', ts at time zone 'America/New_York')::date;
$$;
create or replace function private.period_end(p_period text, p_start date) returns timestamptz
language sql stable set search_path = '' as $$
  select ((p_start + case when p_period = 'week' then interval '7 days' else interval '1 month' end)::timestamp)
         at time zone 'America/New_York';
$$;

-- Territory grid (spec §2.7): ~50 m cells over Greater Boston. cell_id = i * 10000 + j.
create or replace function private.grid_i(lon float8) returns int
language sql immutable parallel safe set search_path = '' as $$
  select floor((lon - (-71.5)::float8) / 0.0006::float8)::int;
$$;
create or replace function private.grid_j(lat float8) returns int
language sql immutable parallel safe set search_path = '' as $$
  select floor((lat - 42.0::float8) / 0.00045::float8)::int;
$$;

create table private.rate_events (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  action text not null,
  at timestamptz not null default now()
);
create index rate_events_lookup on private.rate_events (user_id, action, at desc);

-- Counts only calls whose transaction commits: a call that later raises rolls its event back too.
create or replace function private.hit_rate_limit(p_action text, p_max int, p_window interval) returns void
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  select count(*) into n from private.rate_events
   where user_id = auth.uid() and action = p_action and at > now() - p_window;
  if n >= p_max then perform private.fail('rate_limited'); end if;
  insert into private.rate_events (user_id, action) values (auth.uid(), p_action);
end $$;

-- 8 chars from a 32-letter alphabet without 0/O/1/I (uniform: 256 % 32 = 0).
create or replace function private.new_code(p_len int default 8) returns text
language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  b bytea := extensions.gen_random_bytes(p_len);
  code text := '';
begin
  for k in 0 .. p_len - 1 loop
    code := code || substr(alphabet, (get_byte(b, k) % 32) + 1, 1);
  end loop;
  return code;
end $$;
