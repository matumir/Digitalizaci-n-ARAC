// Arma la versión web (PWA) en dist/: copia www/ y completa en sw.js la versión
// y la lista de archivos que el teléfono guarda para funcionar sin internet.
// Uso: node scripts/preparar-web.mjs   (lo corre .github/workflows/web.yml)
import fs from 'node:fs';
import path from 'node:path';

const WWW = 'www', DIST = 'dist';
fs.rmSync(DIST, { recursive: true, force: true });
fs.cpSync(WWW, DIST, { recursive: true });

const archivos = [];
(function recorrer(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) recorrer(p);
    else archivos.push(path.relative(DIST, p).split(path.sep).join('/'));
  }
})(DIST);
const precache = archivos.filter(f => f !== 'sw.js' && !f.endsWith('.map')).sort();

const version = (process.env.GITHUB_SHA || Date.now().toString(36)).slice(0, 10);
const swPath = path.join(DIST, 'sw.js');
let sw = fs.readFileSync(swPath, 'utf8');
if (!sw.includes("'__VERSION__'") || !sw.includes('[/*PRECACHE*/]')) throw new Error('sw.js no tiene los marcadores esperados');
sw = sw.replace("'__VERSION__'", JSON.stringify(version))
       .replace('[/*PRECACHE*/]', JSON.stringify(precache.map(f => encodeURI(f)), null, 1));
fs.writeFileSync(swPath, sw);
console.log(`Versión web ${version}: ${precache.length} archivos para usar sin internet.`);
