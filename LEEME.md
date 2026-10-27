# ARAC Partidos

App para que los árbitros de la ARAC San Francisco registren los partidos que dirigen:
liga, categoría, equipos, resultado, incidencias (tarjetas, goles y cambios), fotos de planillas y notas.
Los partidos se guardan en el teléfono y se sincronizan con la cuenta de cada árbitro:
inicia sesión en otro teléfono y aparecen ahí. La app funciona sin internet y sube los cambios cuando vuelve la conexión.

## Cómo obtener el APK

### En la computadora (una sola vez)
1. Descomprimí `arac-partidos.zip`.
2. Creá un repositorio nuevo en **github.com/new** (puede ser privado).
3. Subí la carpeta:
   ```
   cd arac-partidos
   git init && git add . && git commit -m "ARAC Partidos"
   git branch -M main
   git remote add origin https://github.com/matumir/arac-partidos.git
   git push -u origin main
   ```
   Sin git: en el repo vacío usá *uploading an existing file* y arrastrá la carpeta
   (el subidor web acepta hasta 100 archivos por vez: primero todo menos `android/` y `www/img/`,
   después esas dos carpetas).
4. Se compila sola en unos 5 minutos (pestaña **Actions**).

### En el celular
1. Entrá al repo → **Releases** → la última → tocá `arac-partidos.apk`.
2. Abrí el archivo. Si Android pide permiso: **Configuración → Permitir de esta fuente → Instalar**.
3. Si aparece Play Protect: **Instalar de todas formas** (pasa porque no viene de Play Store).

Para las versiones siguientes alcanza con `git push`: se compila sola y aparece un Release nuevo.

### En iPhone (versión web)
iPhone no instala APKs: se usa la versión web, que se publica sola en cada `git push`
(`.github/workflows/web.yml`) en **https://matumir.github.io/Digitalizaci-n-ARAC/app/**.
1. Abrila en **Safari**, tocá **Compartir** y después **Agregar a pantalla de inicio**.
2. Queda con su ícono, se abre a pantalla completa y funciona sin internet.
Cuando hay una versión nueva, la app muestra *Hay una versión nueva · Actualizar*.
También sirve en Android (Chrome → Instalar) y en la computadora.

## Dónde está cada cosa
- `www/` — la app (HTML, CSS y JavaScript).
- `www/datos-clubes.js` — lista de clubes por liga. Para corregir un nombre, editá el campo `nombre`.
- `www/img/escudos/` — escudos (`sf-` San Francisco, `sm-` San Martín, `rf-` Rafaelina).
- `www/img/ligas/` — logos de las ligas. `www/img/arac.png` — logo de la asociación.
- `www/auth.js` — inicio de sesión con Google y whitelist. `www/config.js` — datos del proyecto de Supabase.
- `www/vendor/` — Capacitor, sus plugins y supabase-js (copiados de `node_modules`, la app no usa bundler).
- `www/sync.js` — sincronización de partidos y fotos con Supabase.
- `supabase/setup.sql` — whitelist de cuentas. `supabase/sync.sql` — tablas, archivos y borrado de fotos a los 15 días.
- `www/admin.js` y `supabase/admin.sql` — panel de administrador (ver todos los árbitros y sus partidos).
- `www/recordatorio.js`, `supabase/recordatorio.sql` y `supabase/functions/recordatorio/` — aviso de los fines de semana.
- `www/manifest.webmanifest`, `www/sw.js`, `www/pwa.js`, `www/icons/` — versión web instalable (PWA).
- `scripts/preparar-web.mjs` — arma la versión web en `dist/` (lista de archivos para usar sin internet).
- `android/` — proyecto Android (Capacitor 7).

## Inicio de sesión (Supabase + Google)

Sólo pueden entrar las cuentas que estén en la whitelist. Se configura una vez:

1. **Supabase**: creá un proyecto en supabase.com. En *Project Settings → API* copiá la
   **Project URL** y la clave **anon / publishable** a `www/config.js`.
2. **Google Cloud** (console.cloud.google.com): creá un proyecto →
   *APIs y servicios → Pantalla de consentimiento de OAuth* (tipo **Externo**, con nombre y mail de soporte;
   después **Publicar la app**, si no sólo entran los "usuarios de prueba") →
   *Credenciales → Crear credenciales → ID de cliente de OAuth* → tipo **Aplicación web** →
   en *URIs de redireccionamiento autorizados* poné `https://<tu-proyecto>.supabase.co/auth/v1/callback`.
   Copiá el **ID de cliente** y el **secreto**.
3. **Supabase → Authentication → Sign In / Providers → Google**: activalo y pegá el ID y el secreto.
   En el mismo menú conviene **desactivar Email** (no se usa).
4. **Supabase → Authentication → URL Configuration**:
   - **Site URL**: `https://matumir.github.io/Digitalizaci-n-ARAC/app/` (si queda el `http://localhost:3000`
     que trae por defecto, en iPhone Safari dice *no pudo conectarse al servidor* después de elegir la cuenta).
   - **Redirect URLs**: agregá `com.arac.partidos://login` (APK) y
     `https://matumir.github.io/Digitalizaci-n-ARAC/app/**` (versión web). Tocá *Save* en cada una.
5. **Supabase → SQL Editor**: pegá `supabase/setup.sql`, cambiá `tu-mail@gmail.com` por los mails reales y tocá *Run*.

Para autorizar a alguien más: *SQL Editor* →
`insert into public.whitelist (email) values ('mail@gmail.com');` (en minúsculas).
Para quitarlo: `delete from public.whitelist where email = 'mail@gmail.com';`
(la próxima vez que abra la app con internet, se le cierra la sesión).

## Sincronización entre teléfonos

Se configura una vez, después del inicio de sesión:

1. **SQL Editor**: pegá `supabase/sync.sql` y tocá *Run*.
2. **Project Settings → API Keys → Secret keys**: copiá la clave `sb_secret_…` y, en una consulta nueva del SQL Editor, corré
   `select vault.create_secret('sb_secret_…', 'arac_clave_secreta');`
   (la clave queda cifrada en Supabase; no va en la app ni en este repositorio).
3. Para probar el borrado automático: `select public.limpiar_fotos_viejas(15);` (devuelve cuántas fotos borró).

Cómo funciona:
- Cada árbitro ve sólo sus partidos. Si se lo saca de la whitelist, deja de ver y de subir.
- Si el mismo partido se edita en dos teléfonos, queda el cambio más nuevo. Un partido o una foto borrados se borran en todos.
- **Fotos**: se guardan en la nube 15 días (una tarea diaria a las 4:00 UTC borra las más viejas) para pasarlas a los otros
  teléfonos. En los teléfonos que ya las tienen quedan siempre. Un teléfono nuevo recibe todos los partidos, pero sólo las
  fotos de los últimos 15 días.
- En un mismo teléfono, cada cuenta tiene sus partidos por separado.

## Panel de administrador

Las cuentas marcadas como administrador ven una pestaña más, **Árbitros**: la lista de todos los árbitros
(con cuántos partidos cargó cada uno y cuándo fue su último cambio), los partidos de cada uno y el detalle
completo de cada partido (resultado, fotos, incidencias, titulares y notas). Es sólo para ver: no se puede
cambiar ni borrar nada de otro árbitro. Necesita internet, porque lee directo de la nube.

Se configura una vez, después de la sincronización:
1. Primero actualizá la app en el teléfono del administrador (la versión nueva baja sólo tus propios partidos;
   una versión vieja, con el permiso de administrador, bajaría al teléfono los de todos).
2. **SQL Editor**: pegá `supabase/admin.sql` y tocá *Run*. Deja como administrador a `mateojmiranda04@gmail.com`.

Desde la misma pestaña el administrador también puede:
- **Añadir árbitro**: nombre y Gmail. Queda en la whitelist y ya puede entrar con esa cuenta de Google
  (si el mail ya estaba, sólo se actualiza el nombre).
- **Editar o quitar un árbitro**: desde su ficha (botón *Editar*), o tocándolo en la lista si todavía no entró.
  Se puede cambiar el nombre y el Gmail; si ya había entrado, con el mail nuevo es otra cuenta de Google y sus
  partidos quedan en la anterior (el panel lo avisa). *Quitar* lo saca de la whitelist: no puede volver a entrar,
  pero sus partidos no se borran y se siguen viendo en el panel (con *Volver a añadir* se lo autoriza de nuevo).
  El administrador no puede quitarse ni cambiarse el mail a sí mismo.
- **Notificaciones → Recordar cargar partidos / Avisar versión nueva**: un aviso a todos los árbitros
  (pide tocar dos veces para confirmar). En la versión web llega al instante como notificación a los que
  activaron el recordatorio; además, todos (también los del APK) lo ven en un cartel la próxima vez que abren
  la app. En el APK el cartel de versión nueva tiene un botón para descargar el último APK.
- **Probar en este teléfono**: manda el recordatorio sólo al teléfono del administrador.

Estas funciones necesitan haber corrido la versión actual de `supabase/admin.sql` (se puede volver a correr)
y la versión actual de la Edge Function `recordatorio` (si ya estaba creada, pegá el código nuevo y desplegala).

Para sumar otro administrador (tiene que estar en la whitelist):
`update public.whitelist set admin = true where email = 'mail@gmail.com';`
Para quitarlo: `update public.whitelist set admin = false where email = 'mail@gmail.com';`

## Recordatorio de los fines de semana

Los sábados y domingos a las 22:00 la app avisa: *¿Dirigiste hoy? No te olvides de cargar los partidos de la jornada.*
Al tocar el aviso se abre *Cargar partido*. Cada árbitro lo puede apagar o prender en **Ajustes → Recordatorio**.

- **APK**: lo programa el propio teléfono, a la hora del teléfono y sin internet. Se activa solo la primera vez
  que se entra (Android pide permiso para mostrar notificaciones). No necesita configurar nada.
- **Versión web (iPhone)**: un navegador no puede programar avisos, así que los manda el servidor (Web Push).
  El árbitro lo activa con un toque (aparece una invitación en la lista y en Ajustes). En iPhone sólo funciona
  con la app instalada en la pantalla de inicio (iOS 16.4 o más nuevo).

La parte del servidor se configura una vez. Las claves (`VAPID_PUBLICA`, `VAPID_PRIVADA` y `ARAC_CLAVE_PUSH`) se
generan una sola vez y no van en este repositorio; la pública también está en `www/config.js` (`vapidPublicKey`)
y tiene que ser la misma.
1. **SQL Editor**: pegá `supabase/recordatorio.sql` y tocá *Run* (crea la tabla de suscripciones y la tarea
   programada: domingos y lunes a la 1:00 UTC, que son sábados y domingos a las 22:00 de Argentina).
2. **Edge Functions → Deploy a new function → Via Editor**: nombrala `recordatorio`, pegá
   `supabase/functions/recordatorio/index.ts` y desplegala. En los ajustes de la función desactivá
   **Verify JWT / Enforce JWT verification** (la protege la clave `ARAC_CLAVE_PUSH`).
   Con la CLI: `npx supabase functions deploy recordatorio --no-verify-jwt`.
3. **Edge Functions → Secrets**: cargá `VAPID_PUBLICA`, `VAPID_PRIVADA` y `ARAC_CLAVE_PUSH`.
4. **SQL Editor**, en una consulta aparte: `select vault.create_secret('<ARAC_CLAVE_PUSH>', 'arac_clave_push');`
   (la misma clave del paso 3).
5. Para probarlo sin esperar al fin de semana: en el **panel de administrador → Notificaciones → Probar** se manda
   el aviso al teléfono del administrador (en la versión web, primero hay que activar el recordatorio en ese teléfono).
   Para mandárselo a todos, corré en el SQL Editor el `select net.http_post(…)` que está en `supabase/recordatorio.sql`.

## Importante
Los datos de los partidos quedan en la cuenta: si se pierde el teléfono, se recuperan iniciando sesión en otro.
Las fotos de más de 15 días están sólo en los teléfonos: si se pierde el teléfono, se pierden.
Para conservarlas, bajalas a la galería desde cada partido (botón *Descargar*).
