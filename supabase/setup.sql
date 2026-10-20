-- ARAC Partidos — lista de cuentas autorizadas (whitelist)
-- Pegar entero en Supabase › SQL Editor › New query › Run. Se puede correr más de una vez.

-- 1. La lista. Los mails se guardan siempre en minúsculas.
create table if not exists public.whitelist (
  email  text primary key check (email = lower(email)),
  nombre text,
  creado timestamptz not null default now()
);

-- Con RLS activado y sin políticas, nadie puede leer ni tocar la lista desde la app:
-- sólo se administra desde el panel de Supabase.
alter table public.whitelist enable row level security;

-- 2. La app pregunta "¿mi cuenta está autorizada?" y sólo recibe sí o no.
create or replace function public.es_autorizado()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.whitelist w
    where w.email = lower(auth.jwt() ->> 'email')
  );
$$;

revoke all on function public.es_autorizado() from public, anon;
grant execute on function public.es_autorizado() to authenticated;

-- 3. Un mail que no está en la lista ni siquiera puede crear su cuenta.
create or replace function public.bloquear_no_autorizados()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.whitelist w where w.email = lower(new.email)) then
    raise exception 'Cuenta no autorizada: %', new.email;
  end if;
  return new;
end;
$$;

drop trigger if exists antes_de_crear_usuario on auth.users;
create trigger antes_de_crear_usuario
  before insert on auth.users
  for each row execute function public.bloquear_no_autorizados();

-- 4. Cargar los mails autorizados (cambiá estos por los reales).
--    Para sumar más después, repetí este insert con los nuevos.
insert into public.whitelist (email, nombre) values
  ('tu-mail@gmail.com', 'Administrador')
on conflict (email) do nothing;

-- Para quitar a alguien:
--   delete from public.whitelist where email = 'mail@gmail.com';
-- La próxima vez que abra la app con internet, se le cierra la sesión.
