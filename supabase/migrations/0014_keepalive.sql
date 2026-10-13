-- 0014 keep-alive: a daily automatic visit (GitHub Actions) so the free Supabase project is never paused for inactivity.
-- keepalive() reads no table and returns only the word 'ok'. It is the ONLY public function a signed-out visitor may call.
create or replace function public.keepalive() returns text
language sql stable set search_path = public as $$ select 'ok'::text $$;

revoke execute on function public.keepalive() from public;
grant execute on function public.keepalive() to anon, authenticated;

select 'KEEPALIVE_OK' as result;
