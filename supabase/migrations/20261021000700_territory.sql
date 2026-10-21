-- Teal gamification (spec §2.1) 7/8: monthly territory (grid cells captured by closed run loops).
create table public.territory_cells (
  month_start date not null,
  cell_id int not null,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  activity_id uuid not null references public.activities (id) on delete cascade,
  claimed_at timestamptz not null,                                   -- = activity ended_at ("later loop wins")
  primary key (month_start, cell_id)
);
create index territory_cells_owner on public.territory_cells (month_start, owner_id);
-- Foreign-key indexes: deleting an activity or an account cascades its cells and claims.
create index territory_cells_activity on public.territory_cells (activity_id);
create index territory_cells_owner_fk on public.territory_cells (owner_id);

create table public.territory_claims (
  activity_id uuid primary key references public.activities (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  month_start date not null,
  cells_claimed int not null,
  cells_stolen int not null,
  area_m2 real not null,
  created_at timestamptz not null default now()
);

create table public.territory_champions (
  month_start date not null,
  rank int not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  cells int not null,
  primary key (month_start, user_id)
);

alter table public.territory_cells enable row level security;      -- no policies: read via get_territory
alter table public.territory_claims enable row level security;
alter table public.territory_champions enable row level security;
create policy territory_claims_owner on public.territory_claims for select to authenticated using (user_id = (select auth.uid()));
create policy territory_champions_read on public.territory_champions for select to authenticated using (true);
create index territory_claims_user on public.territory_claims (user_id);
create index territory_champions_user on public.territory_champions (user_id);

-- Claim the cells whose centres lie inside a closed run loop. Skips silently when not applicable.
-- The owner's territory_opt_in (default on, Addendum D) is honored here, server-side.
-- Month check: the current ET month, or the previous one during the first 3 h of a month (late-sync grace).
create or replace function private.claim_territory(p_activity uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  a public.activities; v_line extensions.geometry; v_poly extensions.geometry; v_area float8;
  i0 int; i1 int; j0 int; j1 int; v_claimed int; v_stolen int;
begin
  select * into a from public.activities where id = p_activity;
  if a.kind <> 'run' or a.status <> 'valid' or not a.is_loop
     or a.month_start not in (private.month_start(now()), private.month_start(now() - interval '3 hours'))
     or not exists (select 1 from public.profile_private where user_id = a.user_id and territory_opt_in) then
    return;
  end if;
  select extensions.st_force2d(path) into v_line from public.activity_traces where activity_id = p_activity;
  begin
    v_poly := extensions.st_collectionextract(extensions.st_makevalid(
                extensions.st_makepolygon(extensions.st_addpoint(v_line, extensions.st_startpoint(v_line)))), 3);
  exception when others then return;
  end;
  v_area := extensions.st_area(v_poly::extensions.geography);
  if v_area is null or v_area < 20000 or v_area > 25e6 then return; end if;
  i0 := greatest(private.grid_i(extensions.st_xmin(v_poly)), 0);
  i1 := least(private.grid_i(extensions.st_xmax(v_poly)), 1500);
  j0 := greatest(private.grid_j(extensions.st_ymin(v_poly)), 0);
  j1 := least(private.grid_j(extensions.st_ymax(v_poly)), 1555);
  if i1 < i0 or j1 < j0 or (i1 - i0 + 1)::bigint * (j1 - j0 + 1) > 80000 then return; end if;

  -- Both CTEs read the pre-upsert snapshot, so `stolen` counts cells taken from others by this claim.
  with cells as (
    select gi * 10000 + gj as cell_id
      from generate_series(i0, i1) gi, generate_series(j0, j1) gj
     where extensions.st_intersects(v_poly, extensions.st_setsrid(extensions.st_makepoint(
             -71.5::float8 + (gi + 0.5) * 0.0006::float8, 42.0::float8 + (gj + 0.5) * 0.00045::float8), 4326))
  ), stolen as (
    select count(*)::int n from public.territory_cells c join cells using (cell_id)
     where c.month_start = a.month_start and c.owner_id <> a.user_id and c.claimed_at < a.ended_at
  ), up as (
    insert into public.territory_cells (month_start, cell_id, owner_id, activity_id, claimed_at)
    select a.month_start, cells.cell_id, a.user_id, a.id, a.ended_at from cells
    on conflict (month_start, cell_id) do update
       set owner_id = excluded.owner_id, activity_id = excluded.activity_id, claimed_at = excluded.claimed_at
     where public.territory_cells.claimed_at < excluded.claimed_at
    returning 1
  )
  select (select count(*)::int from up), (select n from stolen) into v_claimed, v_stolen;
  insert into public.territory_claims (activity_id, user_id, month_start, cells_claimed, cells_stolen, area_m2)
  values (a.id, a.user_id, a.month_start, v_claimed, v_stolen, v_area)
  on conflict (activity_id) do nothing;
end $$;

create or replace function private.on_trace_inserted() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.claim_territory(new.activity_id);
  return null;
end $$;
create trigger activity_traces_claim after insert on public.activity_traces
  for each row execute function private.on_trace_inserted();

create or replace function private.on_territory_opt_out() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.territory_opt_in and not new.territory_opt_in then
    delete from public.territory_cells where owner_id = new.user_id;
  end if;
  return null;
end $$;
create trigger profile_private_territory after update of territory_opt_in on public.profile_private
  for each row execute function private.on_territory_opt_out();

-- Cells in a bounding box for a month (default: current ET month). At most 20 000 rows.
create or replace function public.get_territory(p_south float8, p_west float8, p_north float8, p_east float8,
                                                p_month date default null)
returns table (cell_id int, owner_id uuid, nickname text, color smallint)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_month date := coalesce(p_month, private.month_start(now()));
        i0 int := greatest(private.grid_i(p_west), 0); i1 int := least(private.grid_i(p_east), 1500);
        j0 int := greatest(private.grid_j(p_south), 0); j1 int := least(private.grid_j(p_north), 1555);
begin
  if auth.uid() is null then perform private.fail('not_authenticated'); end if;
  if p_south is null or p_west is null or p_north is null or p_east is null then perform private.fail('invalid_payload'); end if;
  if i1 < i0 or j1 < j0 then return; end if;
  return query
    select c.cell_id, c.owner_id, p.nickname, p.color
      from public.territory_cells c join public.profiles p on p.id = c.owner_id
     where c.month_start = v_month and c.cell_id between i0 * 10000 + j0 and i1 * 10000 + j1
       and c.cell_id % 10000 between j0 and j1
     limit 20000;
end $$;

create or replace function public.get_territory_standings(p_month date default null, p_limit int default 50)
returns table (rank int, user_id uuid, nickname text, color smallint, cells int, is_me boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_month date := coalesce(p_month, private.month_start(now()));
begin
  if auth.uid() is null then perform private.fail('not_authenticated'); end if;
  return query
    with s as (select c.owner_id, count(*)::int n from public.territory_cells c where c.month_start = v_month group by c.owner_id),
         r as (select (rank() over (order by s.n desc))::int rk, s.* from s)
    select r.rk, r.owner_id, p.nickname, p.color, r.n, r.owner_id = auth.uid()
      from r join public.profiles p on p.id = r.owner_id
     where r.rk <= least(greatest(p_limit, 1), 100) or r.owner_id = auth.uid()
     order by r.rk;
end $$;

create or replace function public.get_activity_claim(p_activity uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('cells_claimed', cells_claimed, 'cells_stolen', cells_stolen, 'area_m2', area_m2,
                            'month_start', month_start)
    from public.territory_claims where activity_id = p_activity and user_id = auth.uid();
$$;

-- Monthly: archive top 10 of the closed month 3 h after it ends; keep that month's cells one more month.
create or replace function private.archive_territory() returns void
language plpgsql security definer set search_path = '' as $$
declare v_month date := (private.month_start(now() - interval '3 hours') - interval '1 month')::date;
begin
  insert into private.period_runs (job, period_start) values ('territory', v_month) on conflict do nothing;
  if not found then return; end if;
  insert into public.territory_champions (month_start, rank, user_id, cells)
  select v_month, rk, owner_id, n from (
    select owner_id, count(*)::int n, rank() over (order by count(*) desc)::int rk
      from public.territory_cells where month_start = v_month group by owner_id) x
   where rk <= 10;
  delete from public.territory_cells where month_start < v_month;
end $$;
