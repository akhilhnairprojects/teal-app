-- Territory: the notice gate, claim, the 300 m start/end privacy zone, paging, steal, an earlier loop cannot steal,
-- opt-out (default on, Addendum D), small and out-of-box loops, and archive idempotency.
-- Run as postgres with MCP execute_sql; everything is rolled back.
-- Loops are placed in the last ~3 hours, so the test assumes it is not run in the first 3 hours of an ET month.
begin;

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values
  ('a0000000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'terr-a@teal-test.invalid', now(), now()),
  ('b0000000-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'terr-b@teal-test.invalid', now(), now());

create function public._test_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
-- A clockwise rectangle (north, east, south, west) at 4 m/s, one point per second, closing exactly.
create function public._test_rect(p_lat float8, p_lon float8, p_n float8, p_e float8) returns jsonb language sql as $$
  with legs(leg, dn, de, len) as (values (1, 1, 0, p_n), (2, 0, 1, p_e), (3, -1, 0, p_n), (4, 0, -1, p_e)),
  steps as (
    select leg, dn, de, k, len / round(len / 4.0) as step
      from legs, generate_series(1, round(len / 4.0)::int) k
  ),
  seq as (select row_number() over (order by leg, k) as idx, dn * step as sn, de * step as se from steps),
  pos as (
    select 0::bigint as idx, 0::float8 as n, 0::float8 as e
    union all
    select idx, sum(sn) over (order by idx), sum(se) over (order by idx) from seq
  )
  select jsonb_agg(jsonb_build_array(idx * 1000,
           round((p_lat + n / 6371000 * 180 / pi())::numeric, 6),
           round((p_lon + e / (6371000 * cos(radians(p_lat))) * 180 / pi())::numeric, 6)) order by idx)
    from pos;
$$;
create function public._test_loop(p_client uuid, p_started timestamptz, p_lat float8, p_lon float8, p_n float8, p_e float8)
returns jsonb language sql as $$
  with pts as (select public._test_rect(p_lat, p_lon, p_n, p_e) as p)
  select public.submit_activity(jsonb_build_object('client_id', p_client, 'kind', 'run', 'started_at', p_started,
    'ended_at', p_started + make_interval(secs => (p->-1->>0)::float8 / 1000), 'points', p)) from pts;
$$;
grant execute on function public._test_as(uuid), public._test_rect(float8, float8, float8, float8),
  public._test_loop(uuid, timestamptz, float8, float8, float8, float8) to authenticated;

set local role authenticated;
select public._test_as('a0000000-0000-4000-8000-00000000000a');
select public.claim_nickname('terr_alpha', true);
select public._test_as('b0000000-0000-4000-8000-00000000000b');
select public.claim_nickname('terr_bravo', true);

do $$
declare s jsonb; c jsonb; v_a_before int; v_b int; v_ids int[]; v_page1 int[]; v_page2 int[];
begin
  assert (public.get_my_profile()->>'territory_opt_in')::boolean, 'territory is on by default (Addendum D)';
  assert not (public.get_my_profile()->>'territory_notice_seen')::boolean, 'the notice starts unseen';

  -- Before the territory notice is acknowledged, a loop claims nothing (review B1).
  perform public._test_as('a0000000-0000-4000-8000-00000000000a');
  s := public._test_loop('a6000000-0000-4000-8000-000000000006', now() - interval '150 minutes', 42.352, -71.07, 400, 400);
  assert (s->>'is_loop')::boolean and public.get_activity_claim((s->>'id')::uuid) is null, 'no claim before the notice';
  assert (public.set_my_settings('{"territory_notice_seen": true}')->>'territory_notice_seen')::boolean, 'A acknowledges';
  assert (public.set_my_settings('{"territory_notice_seen": false}')->>'territory_notice_seen')::boolean, 'false does not un-see';
  perform public._test_as('b0000000-0000-4000-8000-00000000000b');
  perform public.set_my_settings('{"territory_notice_seen": true}');

  -- A: a 400 m × 400 m loop near Boston Common (1.6 km, 16 ha), starting at its south-west corner.
  -- Without the privacy zone it would claim ~64 cells; cells within 300 m of the start (a quarter disc,
  -- ~44 % of the square) are never claimed (review S4), leaving ~36.
  perform public._test_as('a0000000-0000-4000-8000-00000000000a');
  s := public._test_loop('a1000000-0000-4000-8000-000000000001', now() - interval '50 minutes', 42.352, -71.07, 400, 400);
  assert (s->>'is_loop')::boolean, 'is a loop: ' || s::text;
  c := public.get_activity_claim((s->>'id')::uuid);
  raise notice 'A claim: %', c;
  assert (c->>'cells_claimed')::int between 28 and 44 and (c->>'cells_stolen')::int = 0, 'A claims ~36 cells: ' || c::text;
  assert (c->>'area_m2')::float8 between 150000 and 170000, 'area';
  assert (select count(*) from public.get_territory(42.34, -71.09, 42.37, -71.05) where nickname = 'terr_alpha') = (c->>'cells_claimed')::int,
    'cells visible through get_territory';
  -- Privacy zone: no claimed centre within 300 m (haversine) of the start; some lie just beyond it.
  select array_agg(g.cell_id order by g.cell_id) into v_ids
    from public.get_territory(42.34, -71.09, 42.37, -71.05) g where g.nickname = 'terr_alpha';
  assert not exists (
    select 1 from unnest(v_ids) id,
      lateral (select 42.0 + (id % 10000 + 0.5) * 0.00045 as lat, -71.5 + (id / 10000 + 0.5) * 0.0006 as lon) ctr
     where 2 * 6371000 * asin(sqrt(power(sin(radians(ctr.lat - 42.352) / 2), 2)
             + cos(radians(42.352)) * cos(radians(ctr.lat)) * power(sin(radians(ctr.lon + 71.07) / 2), 2))) <= 300),
    'a claimed cell lies within 300 m of the start';
  -- Paging (review S1): pages are ordered by cell_id and resume after the cursor.
  select array_agg(g.cell_id order by g.cell_id) into v_page1
    from public.get_territory(42.34, -71.09, 42.37, -71.05, null, null, 10) g;
  select array_agg(g.cell_id order by g.cell_id) into v_page2
    from public.get_territory(42.34, -71.09, 42.37, -71.05, null, v_page1[10], 1000) g;
  assert cardinality(v_page1) = 10 and v_page1 || v_page2 = v_ids, 'pages join up to the whole set';
  assert (select count(*) from public.get_territory(42.34, -71.09, 42.37, -71.05, null, null, 5000)) = cardinality(v_ids),
    'a page never exceeds 1000 rows but returns all when fewer';
  v_a_before := (c->>'cells_claimed')::int;

  -- B: a later loop overlapping the east half steals those cells.
  perform public._test_as('b0000000-0000-4000-8000-00000000000b');
  s := public._test_loop('b1000000-0000-4000-8000-000000000001', now() - interval '30 minutes', 42.352, -71.0676, 400, 400);
  c := public.get_activity_claim((s->>'id')::uuid);
  raise notice 'B claim: %', c;
  assert (c->>'cells_stolen')::int between 5 and 40, 'B steals the overlap: ' || c::text;
  v_b := (select count(*) from public.get_territory(42.34, -71.09, 42.37, -71.05) where nickname = 'terr_bravo');
  assert v_b = (c->>'cells_claimed')::int, 'B owns what it claimed';
  assert (select cells from public.get_territory_standings() where is_me) = v_b, 'standings';

  -- A: an earlier loop (ended before B's) over the same area cannot steal back.
  perform public._test_as('a0000000-0000-4000-8000-00000000000a');
  s := public._test_loop('a2000000-0000-4000-8000-000000000002', now() - interval '110 minutes', 42.352, -71.0676, 400, 400);
  assert (select count(*) from public.get_territory(42.34, -71.09, 42.37, -71.05) where nickname = 'terr_bravo') = v_b,
    'an earlier loop does not steal';

  -- Too small: 520 m × 10 m is a 1 km+ loop but only 5 200 m².
  s := public._test_loop('a3000000-0000-4000-8000-000000000003', now() - interval '130 minutes', 42.30, -71.10, 520, 10);
  assert (s->>'is_loop')::boolean and public.get_activity_claim((s->>'id')::uuid) is null, 'too small: no claim';

  -- Outside the grid (Manhattan): no claim.
  s := public._test_loop('a4000000-0000-4000-8000-000000000004', now() - interval '170 minutes', 40.78, -73.97, 400, 400);
  assert public.get_activity_claim((s->>'id')::uuid) is null, 'out of the box: no claim';

  -- Opting out deletes A's cells at once and stops new claims.
  perform public.set_my_settings('{"territory_opt_in": false}');
  assert not exists (select 1 from public.get_territory(42.34, -71.09, 42.37, -71.05) where nickname = 'terr_alpha'), 'opt-out deletes cells';
  s := public._test_loop('a5000000-0000-4000-8000-000000000005', now() - interval '20 minutes', 42.36, -71.06, 300, 300);
  assert public.get_activity_claim((s->>'id')::uuid) is null, 'no claims while opted out';

  -- Deleting B's activity frees its cells (they are not restored to A).
  perform public._test_as('b0000000-0000-4000-8000-00000000000b');
  perform public.delete_activity((select id from public.activities where client_id = 'b1000000-0000-4000-8000-000000000001'));
  assert (select count(*) from public.get_territory(42.34, -71.09, 42.37, -71.05)) = 0, 'cells cascade with the activity';
end $$;

-- Archive idempotency (archives last month; running twice changes nothing).
reset role;
do $$
declare n1 int; n2 int; v_month date := (private.month_start(now() - interval '3 hours') - interval '1 month')::date;
begin
  delete from private.period_runs where job = 'territory' and period_start = v_month;   -- start clean inside this transaction
  insert into public.territory_cells (month_start, cell_id, owner_id, activity_id, claimed_at)
  select v_month, 7290791, a.user_id, a.id, a.ended_at
    from public.activities a where a.client_id = 'a2000000-0000-4000-8000-000000000002';
  perform private.archive_territory();
  select count(*) into n1 from public.territory_champions where month_start = v_month;
  perform private.archive_territory();
  select count(*) into n2 from public.territory_champions where month_start = v_month;
  assert n1 >= 1 and n1 = n2, 'archive_territory idempotent: ' || n1 || ' vs ' || n2;
end $$;

select 'territory.sql passed' as result;
rollback;
