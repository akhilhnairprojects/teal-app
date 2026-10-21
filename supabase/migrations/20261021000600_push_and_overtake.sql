-- Teal gamification (spec §2.1) 6/8: push dispatch through pg_net, the push sweep and the overtake trigger.
-- Delivery: notifications rows -> pg_net POST -> Edge Function `send-push` -> Expo push API.
-- Secrets live in Vault (created by the lead, never committed):
--   select vault.create_secret('https://mzjgdjlrlwfgaedweerc.supabase.co/functions/v1', 'teal_functions_url');
--   select vault.create_secret('<random 32+ chars>', 'teal_push_secret');   -- same value as function secret TEAL_PUSH_SECRET
create or replace function private.dispatch_push(p_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare v_url text; v_secret text;
begin
  if p_ids is null or cardinality(p_ids) = 0 then return; end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'teal_functions_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'teal_push_secret';
  if v_url is null or v_secret is null then return; end if;           -- push not configured: inbox only
  perform net.http_post(
    url := v_url || '/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-teal-push-secret', v_secret),
    body := jsonb_build_object('ids', to_jsonb(p_ids)),
    timeout_milliseconds := 5000);
end $$;

create or replace function private.on_notifications_inserted() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.dispatch_push(array(select id from inserted));
  return null;
end $$;
create trigger notifications_dispatch after insert on public.notifications
  referencing new table as inserted for each statement execute function private.on_notifications_inserted();

create or replace function private.push_sweep() returns void
language sql security definer set search_path = '' as $$
  select private.dispatch_push(array(
    select id from public.notifications
     where push_state = 'pending' and push_attempts < 5
       and created_at < now() - interval '1 minute' and created_at > now() - interval '1 day'
     order by created_at limit 500));
$$;

-- Overtake: when my eligible weekly running distance passes a friend's (current ET week only).
create or replace function private.on_activity_overtake() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_new float8; v_old float8; f record; v_nick text;
begin
  if new.kind <> 'run' or new.status <> 'valid' or not new.leaderboard_eligible
     or new.week_start <> private.week_start(now()) then
    return null;
  end if;
  select coalesce(sum(distance_m), 0) into v_new from public.activities
   where user_id = new.user_id and kind = 'run' and status = 'valid' and leaderboard_eligible and week_start = new.week_start;
  v_old := v_new - new.distance_m;
  select nickname into v_nick from public.profiles where id = new.user_id;
  for f in
    select fr.fid, (select coalesce(sum(a.distance_m), 0) from public.activities a
                     where a.user_id = fr.fid and a.kind = 'run' and a.status = 'valid'
                       and a.leaderboard_eligible and a.week_start = new.week_start) as total
      from private.friend_ids(new.user_id) as fr(fid)
      join public.profile_private pp on pp.user_id = fr.fid and pp.notify_overtake
  loop
    if f.total > 0 and v_old <= f.total and v_new > f.total then
      perform private.notify(f.fid, 'overtake', new.user_id, 'overtake:' || new.user_id || ':' || new.week_start,
        jsonb_build_object('actor_nickname', v_nick, 'their_m', round(v_new), 'your_m', round(f.total),
                           'week_start', new.week_start));
    end if;
  end loop;
  return null;
end $$;
create trigger activities_overtake after insert on public.activities
  for each row execute function private.on_activity_overtake();

alter publication supabase_realtime add table public.notifications;   -- in-app inbox (RLS applies)
