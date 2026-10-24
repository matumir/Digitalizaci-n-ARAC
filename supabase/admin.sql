-- ARAC Partidos — panel de administrador
-- Requiere haber corrido antes supabase/setup.sql y supabase/sync.sql.
-- Pegar entero en Supabase › SQL Editor › New query › Run. Se puede correr más de una vez.
--
-- El administrador ve los partidos y las fotos de todos los árbitros, pero sólo para leer:
-- no puede cambiar ni borrar nada de otro árbitro.

-- =========================================================
-- 1. Quién es administrador: una marca en la whitelist
-- =========================================================
alter table public.whitelist add column if not exists admin boolean not null default false;

insert into public.whitelist (email, admin) values ('mateojmiranda04@gmail.com', true)
on conflict (email) do update set admin = true;

-- Para sumar otro administrador:
--   update public.whitelist set admin = true where email = 'mail@gmail.com';
-- Para quitarlo:
--   update public.whitelist set admin = false where email = 'mail@gmail.com';

create or replace function public.es_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.whitelist w
    where w.email = lower(auth.jwt() ->> 'email') and w.admin
  );
$$;

revoke all on function public.es_admin() from public, anon;
grant execute on function public.es_admin() to authenticated;

-- =========================================================
-- 2. Lista de árbitros: los de la whitelist (hayan entrado o no)
--    y los que ya no están pero tienen partidos cargados
-- =========================================================
create or replace function public.admin_arbitros()
returns table (
  email      text,
  nombre     text,
  user_id    uuid,
  autorizado boolean,
  admin      boolean,
  partidos   bigint,
  ultimo     timestamptz,                -- último partido cargado o modificado
  ingreso    timestamptz                 -- último inicio de sesión
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(w.email, lower(u.email)),
    coalesce(w.nombre, u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name'),
    u.id,
    w.email is not null,
    coalesce(w.admin, false),
    (select count(*) from public.partidos p where p.user_id = u.id and not p.borrado),
    (select max(p.actualizado) from public.partidos p where p.user_id = u.id and not p.borrado),
    u.last_sign_in_at
  from public.whitelist w
  full join auth.users u on lower(u.email) = w.email
  where public.es_admin()
    and (w.email is not null or exists (select 1 from public.partidos p where p.user_id = u.id and not p.borrado));
$$;

revoke all on function public.admin_arbitros() from public, anon;
grant execute on function public.admin_arbitros() to authenticated;

-- =========================================================
-- 3. Permiso de lectura sobre todo (se suma a "partidos propios" y "fotos propias")
-- =========================================================
drop policy if exists "admin ve todos los partidos" on public.partidos;
create policy "admin ve todos los partidos" on public.partidos for select to authenticated
  using ((select public.es_admin()));

drop policy if exists "admin ve todas las fotos" on public.fotos;
create policy "admin ve todas las fotos" on public.fotos for select to authenticated
  using ((select public.es_admin()));

drop policy if exists "fotos: el admin ve todas" on storage.objects;
create policy "fotos: el admin ve todas" on storage.objects for select to authenticated
  using (bucket_id = 'fotos' and (select public.es_admin()));
