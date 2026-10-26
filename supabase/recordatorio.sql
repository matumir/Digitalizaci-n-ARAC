-- ARAC Partidos — recordatorio de los sábados y domingos a las 22:00 (versión web / iPhone)
-- Requiere haber corrido antes supabase/setup.sql y supabase/sync.sql.
-- Pegar entero en Supabase › SQL Editor › New query › Run. Se puede correr más de una vez.
--
-- En el APK el recordatorio lo programa el propio teléfono y no usa nada de esto.
-- En la versión web el teléfono no puede programarlo: lo manda el servidor con Web Push.
-- Cada teléfono que lo activa deja acá su "suscripción"; la Edge Function "recordatorio"
-- (supabase/functions/recordatorio) le manda el aviso a todas.

-- =========================================================
-- 1. Suscripciones (una por teléfono/navegador)
-- =========================================================
create table if not exists public.push_suscripciones (
  endpoint text        primary key,
  user_id  uuid        not null references auth.users (id) on delete cascade,
  p256dh   text        not null,
  auth     text        not null,
  creado   timestamptz not null default now()
);
-- Desde la app no se toca la tabla directo: sólo con las dos funciones de abajo.
alter table public.push_suscripciones enable row level security;
revoke all on public.push_suscripciones from anon, authenticated;

-- Activar el recordatorio en este teléfono (si el teléfono era de otra cuenta, pasa a la actual)
create or replace function public.guardar_suscripcion(p_endpoint text, p_p256dh text, p_auth text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.es_autorizado() then
    raise exception 'Cuenta no autorizada';
  end if;
  insert into public.push_suscripciones (endpoint, user_id, p256dh, auth)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth)
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, creado = now();
end;
$$;

-- Desactivarlo
create or replace function public.borrar_suscripcion(p_endpoint text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_suscripciones where endpoint = p_endpoint and user_id = auth.uid();
$$;

revoke all on function public.guardar_suscripcion(text, text, text) from public, anon;
revoke all on function public.borrar_suscripcion(text) from public, anon;
grant execute on function public.guardar_suscripcion(text, text, text) to authenticated;
grant execute on function public.borrar_suscripcion(text) to authenticated;

-- A quiénes mandarle el aviso: sólo a cuentas que siguen en la whitelist.
-- La usa la Edge Function con la clave de servicio; la app no puede llamarla.
create or replace function public.push_destinos()
returns table (endpoint text, p256dh text, auth text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.endpoint, s.p256dh, s.auth
  from public.push_suscripciones s
  join auth.users u on u.id = s.user_id
  join public.whitelist w on w.email = lower(u.email);
$$;
revoke all on function public.push_destinos() from public, anon, authenticated;
grant execute on function public.push_destinos() to service_role;

-- =========================================================
-- 2. Envío: sábados y domingos a las 22:00 de Argentina (UTC-3),
--    o sea domingos y lunes a la 1:00 UTC
-- =========================================================
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.unschedule(jobid) from cron.job where jobname = 'arac-recordatorio';
select cron.schedule('arac-recordatorio', '0 1 * * 0,1', $$
  select net.http_post(
    url     := 'https://jvclrktwezisvuljemgi.supabase.co/functions/v1/recordatorio',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-arac-clave', (select decrypted_secret from vault.decrypted_secrets where name = 'arac_clave_push')
    ),
    body    := '{}'::jsonb
  );
$$);

-- =========================================================
-- 3. Clave compartida entre este cron y la Edge Function (UNA sola vez, en una consulta aparte).
--    Es la misma que se carga como secreto ARAC_CLAVE_PUSH de la función:
--
--    select vault.create_secret('LA_CLAVE', 'arac_clave_push');
--
--    Para probar el envío sin esperar al fin de semana, corré el select net.http_post(…) de arriba.
-- =========================================================
