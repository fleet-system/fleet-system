-- 0025: phone notifications (Web Push).
--  * push_subscriptions: one row per device that turned notifications on (owner = auth.uid()).
--    Turning a device off archives the row (is_active = false); nothing is deleted.
--  * push_private: the push keys and the daily-job key. Only the server (service_role) can read it.
--  * push_log: what was sent and when (also stops the daily summary being sent twice).
--  * push_targets(): which active devices should receive a message (server only).
--  * daily job (pg_cron + pg_net, only where available): 06:30 Riyadh calls the edge function "push".
-- No existing table, column or row changes. ASCII only. Safe to run more than once.
-- =====================================================================
create table if not exists push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid(),
  endpoint     text not null unique,
  p256dh       text not null,
  auth_key     text not null,
  device_label text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  last_sent_at timestamptz,
  last_error   text,
  fail_count   int not null default 0
);
alter table push_subscriptions enable row level security;
revoke all on push_subscriptions from anon, public;
revoke insert, update, delete, truncate, references, trigger on push_subscriptions from authenticated;
grant select on push_subscriptions to authenticated;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'push_subscriptions' and policyname = 'p_select_own') then
    create policy p_select_own on push_subscriptions for select to authenticated using (user_id = auth.uid());
  end if;
end $$;

create table if not exists push_private (
  id         int primary key default 1 check (id = 1),
  vapid_public  text,
  vapid_private text,
  cron_key   text not null,
  created_at timestamptz not null default now()
);
alter table push_private enable row level security;
revoke all on push_private from anon, authenticated, public;
insert into push_private (id, cron_key)
values (1, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (id) do nothing;

create table if not exists push_log (
  id      bigserial primary key,
  kind    text not null,
  ref     text,
  sent_at timestamptz not null default now(),
  sent    int not null default 0,
  failed  int not null default 0,
  info    text
);
alter table push_log enable row level security;
revoke all on push_log from anon, authenticated, public;

-- register / refresh this device for the signed-in user
create or replace function save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_label text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  if auth.uid() is null or not exists (select 1 from profiles where user_id = auth.uid() and is_active) then
    raise exception 'PERMISSION_DENIED' using errcode = '42501';
  end if;
  if coalesce(btrim(p_endpoint), '') = '' or p_endpoint not like 'https://%' or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'PUSH_BAD_SUBSCRIPTION' using errcode = '22023';
  end if;
  insert into push_subscriptions (user_id, endpoint, p256dh, auth_key, device_label)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_label, 120))
  on conflict (endpoint) do update
     set user_id = excluded.user_id, p256dh = excluded.p256dh, auth_key = excluded.auth_key,
         device_label = coalesce(excluded.device_label, push_subscriptions.device_label),
         is_active = true, fail_count = 0, last_error = null, updated_at = now()
  returning id into rid;
  return rid;
end $$;
revoke execute on function save_push_subscription(text, text, text, text) from public, anon;
grant execute on function save_push_subscription(text, text, text, text) to authenticated;

-- turn notifications off on this device (archive, not delete)
create or replace function disable_push_subscription(p_endpoint text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update push_subscriptions set is_active = false, updated_at = now()
   where endpoint = p_endpoint and user_id = auth.uid();
  return found;
end $$;
revoke execute on function disable_push_subscription(text) from public, anon;
grant execute on function disable_push_subscription(text) to authenticated;

-- devices that should receive a message (server only). p_perm null = every active user.
create or replace function push_targets(p_perm text default null)
returns setof push_subscriptions language sql stable security definer set search_path = public as $$
  select s.* from push_subscriptions s
  join profiles pr on pr.user_id = s.user_id and pr.is_active
  where s.is_active
    and (p_perm is null or pr.is_admin
         or exists (select 1 from user_permissions up where up.user_id = s.user_id and up.permission::text = p_perm))
$$;
revoke execute on function push_targets(text) from public, anon, authenticated;
grant execute on function push_targets(text) to service_role;

-- daily summary at 06:30 Riyadh (03:30 UTC). Skipped where pg_cron / pg_net are not available.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
    create extension if not exists pg_cron;
    perform cron.schedule('push-daily-alerts', '30 3 * * *', $job$
      select net.http_post(
        url := 'https://pemyrokrbqzwvtretawa.supabase.co/functions/v1/push',
        headers := jsonb_build_object('Content-Type', 'application/json',
                                      'x-cron-key', (select cron_key from public.push_private where id = 1)),
        body := '{"action":"daily"}'::jsonb)
    $job$);
  end if;
end $$;

select 'PUSH_NOTIFICATIONS_OK' as result;
