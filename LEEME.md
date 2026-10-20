# ARAC Partidos

App para que los árbitros de la ARAC San Francisco registren los partidos que dirigen:
liga, categoría, equipos, fecha, fotos de planillas y tarjetas, y anotaciones.
Todo queda guardado en el teléfono; no usa internet.

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

## Dónde está cada cosa
- `www/` — la app (HTML, CSS y JavaScript).
- `www/datos-clubes.js` — lista de clubes por liga. Para corregir un nombre, editá el campo `nombre`.
- `www/img/escudos/` — escudos (`sf-` San Francisco, `sm-` San Martín, `rf-` Rafaelina).
- `www/img/ligas/` — logos de las ligas. `www/img/arac.png` — logo de la asociación.
- `android/` — proyecto Android (Capacitor 7).

## Importante
Los datos viven solo en el teléfono: si se desinstala la app o se borran sus datos, se pierden.
