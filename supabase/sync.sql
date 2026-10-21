-- ARAC Partidos — sincronización de partidos y fotos entre dispositivos
-- Requiere haber corrido antes supabase/setup.sql (whitelist y es_autorizado).
-- Pegar entero en Supabase › SQL Editor › New query › Run. Se puede correr más de una vez.

-- =========================================================
-- 1. Partidos: una fila por partido y por árbitro
-- =========================================================
create table if not exists public.partidos (
  user_id     uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id          text        not null,
  datos       jsonb,                                   -- liga, equipos, resultado, incidencias, notas…
  mod         bigint      not null default 0,          -- momento del último cambio en el teléfono (ms)
  borrado     boolean     not null default false,      -- borrado en algún teléfono: se borra en todos
  actualizado timestamptz not null default now(),      -- lo pone el servidor; sirve para bajar sólo lo nuevo
  primary key (user_id, id)
);
create index if not exists partidos_actualizado on public.partidos (user_id, actualizado);

-- =========================================================
-- 2. Fotos: los datos de cada foto quedan para siempre;
--    el archivo se borra de la nube a los 15 días (punto 5)
-- =========================================================
create table if not exists public.fotos (
  user_id     uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id          text        not null,
  partido     text        not null,
  orden       int         not null default 0,
  ruta        text        not null,                    -- <user_id>/<partido>/<foto>.jpg en el bucket "fotos"
  mod         bigint      not null default 0,
  borrado     boolean     not null default false,
  subida      timestamptz not null default now(),      -- desde acá corren los 15 días
  actualizado timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists fotos_actualizado on public.fotos (user_id, actualizado);

-- Gana el cambio más nuevo: si llega una versión más vieja que la guardada, se ignora.
create or replace function public.sync_antes_de_guardar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.mod < old.mod then
      return old;
    end if;
    new.user_id := old.user_id;
    if tg_table_name = 'fotos' then
      new.subida := old.subida;
    end if;
  end if;
  new.actualizado := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists partidos_sync on public.partidos;
create trigger partidos_sync before insert or update on public.partidos
  for each row execute function public.sync_antes_de_guardar();
drop trigger if exists fotos_sync on public.fotos;
create trigger fotos_sync before insert or update on public.fotos
  for each row execute function public.sync_antes_de_guardar();

-- Cada árbitro ve y modifica sólo lo suyo, y sólo si sigue en la whitelist.
alter table public.partidos enable row level security;
alter table public.fotos    enable row level security;

drop policy if exists "partidos propios" on public.partidos;
create policy "partidos propios" on public.partidos for all to authenticated
  using      (user_id = (select auth.uid()) and (select public.es_autorizado()))
  with check (user_id = (select auth.uid()) and (select public.es_autorizado()));

drop policy if exists "fotos propias" on public.fotos;
create policy "fotos propias" on public.fotos for all to authenticated
  using      (user_id = (select auth.uid()) and (select public.es_autorizado()))
  with check (user_id = (select auth.uid()) and (select public.es_autorizado()));

-- Supabase da todos los permisos por defecto: se quitan y se dan sólo los necesarios
-- (nadie borra filas: un borrado es una marca, así llega a los otros teléfonos).
revoke all on public.partidos, public.fotos from anon, authenticated;
grant select, insert, update on public.partidos, public.fotos to authenticated;

-- =========================================================
-- 3. Archivos de las fotos: bucket privado, una carpeta por árbitro
-- =========================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos', 'fotos', false, 10485760, array['image/jpeg'])
on conflict (id) do nothing;

drop policy if exists "fotos: ver las propias"     on storage.objects;
drop policy if exists "fotos: subir las propias"   on storage.objects;
drop policy if exists "fotos: cambiar las propias" on storage.objects;
drop policy if exists "fotos: borrar las propias"  on storage.objects;

create policy "fotos: ver las propias" on storage.objects for select to authenticated
  using (bucket_id = 'fotos' and (storage.foldername(name))[1] = (select auth.uid())::text and (select public.es_autorizado()));
create policy "fotos: subir las propias" on storage.objects for insert to authenticated
  with check (bucket_id = 'fotos' and (storage.foldername(name))[1] = (select auth.uid())::text and (select public.es_autorizado()));
create policy "fotos: cambiar las propias" on storage.objects for update to authenticated
  using      (bucket_id = 'fotos' and (storage.foldername(name))[1] = (select auth.uid())::text and (select public.es_autorizado()))
  with check (bucket_id = 'fotos' and (storage.foldername(name))[1] = (select auth.uid())::text and (select public.es_autorizado()));
create policy "fotos: borrar las propias" on storage.objects for delete to authenticated
  using (bucket_id = 'fotos' and (storage.foldername(name))[1] = (select auth.uid())::text and (select public.es_autorizado()));

-- =========================================================
-- 4. Borrado automático: todos los días a las 4:00 (hora UTC)
--    se borran de la nube las fotos subidas hace más de 15 días.
--    En los teléfonos quedan; los datos del partido no se tocan.
-- =========================================================
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Los archivos se borran con la API de Storage (borrar filas de storage.objects
-- con SQL dejaría el archivo ocupando lugar). Para eso hace falta la clave secreta,
-- que se guarda cifrada en Vault (ver el paso 5).
create or replace function public.limpiar_fotos_viejas(dias int default 15)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  clave text;
  base  text := 'https://jvclrktwezisvuljemgi.supabase.co/storage/v1/object/fotos/';
  r     record;
  n     int := 0;
begin
  select decrypted_secret into clave from vault.decrypted_secrets where name = 'arac_clave_secreta';
  if clave is null then
    raise exception 'Falta guardar la clave secreta en Vault con el nombre arac_clave_secreta (paso 5).';
  end if;
  for r in
    select name from storage.objects
    where bucket_id = 'fotos' and created_at < now() - make_interval(days => dias)
    order by created_at
    limit 1000
  loop
    perform net.http_delete(
      url     := base || r.name,
      headers := jsonb_build_object('apikey', clave)
    );
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.limpiar_fotos_viejas(int) from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'arac-limpiar-fotos';
select cron.schedule('arac-limpiar-fotos', '0 4 * * *', $$ select public.limpiar_fotos_viejas(15); $$);

-- =========================================================
-- 5. Guardar la clave secreta (UNA sola vez, en una consulta aparte):
--    Project Settings › API Keys › Secret keys › copiá la clave sb_secret_… y corré:
--
--    select vault.create_secret('sb_secret_PEGALA_ACA', 'arac_clave_secreta');
--
--    Para probar que el borrado funciona (no borra nada si no hay fotos viejas):
--    select public.limpiar_fotos_viejas(15);
-- =========================================================
