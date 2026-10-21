-- Teal gamification (spec §2.1) 8/8: retention, housekeeping, cron jobs and the final grant/revoke sweep.
create or replace function private.apply_retention() returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.activity_traces where created_at < now() - interval '180 days';   -- raw traces (decision O2)
  delete from public.notifications where created_at < now() - interval '30 days';
  delete from private.rate_events where at < now() - interval '2 days';
  delete from public.friendships where status = 'pending' and created_at < now() - interval '30 days';
end $$;

create or replace function private.housekeeping() returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.group_sessions set status = 'ended', ended_at = now()
   where (status = 'live' and started_at < now() - interval '4 hours')
      or (status = 'open' and created_at < now() - interval '24 hours');
end $$;

select cron.schedule('teal-rollover', '7 * * * *',
  $$select private.archive_closed_periods(); select private.archive_territory();$$);
select cron.schedule('teal-retention', '17 7 * * *', $$select private.apply_retention();$$);
select cron.schedule('teal-housekeeping', '*/15 * * * *', $$select private.housekeeping();$$);
select cron.schedule('teal-push-sweep', '*/5 * * * *', $$select private.push_sweep();$$);

-- Grants (run last; re-run at the end of any later migration that adds functions or tables).
revoke all on all tables in schema public from anon;
revoke insert, update, delete, truncate on all tables in schema public from authenticated;
grant select on all tables in schema public to authenticated;        -- still filtered by RLS
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_group_member(uuid, uuid), private.session_topic_allowed(text) to authenticated;
