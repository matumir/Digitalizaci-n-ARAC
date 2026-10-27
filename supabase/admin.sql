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

-- =========================================================
-- 4. Añadir árbitros a la whitelist desde el panel
--    Devuelve true si era nuevo, false si ya estaba (entonces sólo actualiza el nombre).
-- =========================================================
create or replace function public.admin_agregar_arbitro(p_email text, p_nombre text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  mail text := lower(trim(p_email));
  nuevo boolean;
begin
  if not public.es_admin() then
    raise exception 'Sólo para administradores';
  end if;
  if mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Mail inválido: %', p_email;
  end if;
  nuevo := not exists (select 1 from public.whitelist w where w.email = mail);
  insert into public.whitelist as wl (email, nombre) values (mail, nullif(trim(p_nombre), ''))
  on conflict (email) do update set nombre = coalesce(excluded.nombre, wl.nombre);
  return nuevo;
end;
$$;

revoke all on function public.admin_agregar_arbitro(text, text) from public, anon;
grant execute on function public.admin_agregar_arbitro(text, text) to authenticated;

-- Cambiar el mail o el nombre. Ojo: si ya había entrado, con el mail nuevo es otra cuenta de
-- Google, así que sus partidos quedan en la cuenta anterior (el panel lo avisa).
create or replace function public.admin_editar_arbitro(p_email_actual text, p_email_nuevo text, p_nombre text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actual text := lower(trim(p_email_actual));
  nuevo  text := lower(trim(p_email_nuevo));
begin
  if not public.es_admin() then
    raise exception 'Sólo para administradores';
  end if;
  if nuevo !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Mail inválido: %', p_email_nuevo;
  end if;
  if nuevo <> actual and actual = lower(auth.jwt() ->> 'email') then
    raise exception 'No podés cambiar tu propio mail: perderías el acceso de administrador';
  end if;
  if nuevo <> actual and exists (select 1 from public.whitelist w where w.email = nuevo) then
    raise exception 'Ya hay un árbitro con el mail %', nuevo;
  end if;
  update public.whitelist set email = nuevo, nombre = nullif(trim(p_nombre), '') where email = actual;
  if not found then
    raise exception 'No está en la lista: %', actual;
  end if;
end;
$$;

-- Quitar de la whitelist: no puede volver a entrar (si tenía la app abierta, se le cierra la
-- sesión al conectarse). Sus partidos no se borran: el panel los sigue mostrando.
create or replace function public.admin_quitar_arbitro(p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  mail text := lower(trim(p_email));
begin
  if not public.es_admin() then
    raise exception 'Sólo para administradores';
  end if;
  if mail = lower(auth.jwt() ->> 'email') then
    raise exception 'No podés quitarte a vos mismo';
  end if;
  delete from public.whitelist where email = mail;
end;
$$;

revoke all on function public.admin_editar_arbitro(text, text, text) from public, anon;
revoke all on function public.admin_quitar_arbitro(text) from public, anon;
grant execute on function public.admin_editar_arbitro(text, text, text) to authenticated;
grant execute on function public.admin_quitar_arbitro(text) to authenticated;

-- =========================================================
-- 5. Avisos que el administrador manda a todos (versión nueva, recordatorio).
--    Los guarda la Edge Function "recordatorio"; cada teléfono los muestra al abrir la app
--    (en el APK es la única forma de que lleguen), y la versión web además los recibe al instante.
-- =========================================================
create table if not exists public.avisos (
  id     bigint      generated always as identity primary key,
  tipo   text        not null check (tipo in ('version', 'recordatorio')),
  titulo text        not null,
  cuerpo text        not null,
  autor  uuid        references auth.users (id) on delete set null,
  creado timestamptz not null default now()
);
alter table public.avisos enable row level security;
revoke all on public.avisos from anon, authenticated;
grant select on public.avisos to authenticated;

drop policy if exists "avisos: los ven los autorizados" on public.avisos;
create policy "avisos: los ven los autorizados" on public.avisos for select to authenticated
  using ((select public.es_autorizado()));
