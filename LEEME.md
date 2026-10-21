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
4. **Supabase → Authentication → URL Configuration → Redirect URLs**: agregá `com.arac.partidos://login`
   (APK) y `https://matumir.github.io/Digitalizaci-n-ARAC/app/**` (versión web).
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

## Importante
Los datos de los partidos quedan en la cuenta: si se pierde el teléfono, se recuperan iniciando sesión en otro.
Las fotos de más de 15 días están sólo en los teléfonos: si se pierde el teléfono, se pierden.
Para conservarlas, bajalas a la galería desde cada partido (botón *Descargar*).
