// ARAC Partidos — Edge Function "recordatorio": manda el aviso de los fines de semana
// a todos los teléfonos con la versión web que lo activaron (Web Push).
//
// Dos formas de llamarla:
// - El cron "arac-recordatorio" (supabase/recordatorio.sql), con la clave ARAC_CLAVE_PUSH:
//   manda el aviso a todos.
// - El panel de administrador ("Probar notificaciones"), con la sesión del administrador
//   y { prueba: true }: lo manda sólo a los teléfonos de esa cuenta.
//
// Secretos (Supabase › Edge Functions › Secrets): VAPID_PUBLICA, VAPID_PRIVADA y ARAC_CLAVE_PUSH.
// Se despliega con "Verify JWT" desactivado: la protegen la clave y la revisión de administrador.
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

const AVISO = {
  title: 'ARAC Partidos',
  body: '¿Dirigiste hoy? No te olvides de cargar los partidos de la jornada.',
};
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const responder = (cuerpo: unknown, status = 200) => Response.json(cuerpo, { status, headers: CORS });

type Destino = { endpoint: string; p256dh: string; auth: string };

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const pedido = await req.json().catch(() => ({}));

  let destinos: Destino[] = [];
  let aviso = AVISO;
  if (pedido.prueba) {
    // Prueba desde el panel: sólo un administrador, y sólo a sus propios teléfonos
    const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: u } = await sb.auth.getUser(token);
    const email = u?.user?.email?.toLowerCase();
    if (!email) return responder({ error: 'Sin sesión' }, 401);
    const { data: w } = await sb.from('whitelist').select('admin').eq('email', email).maybeSingle();
    if (!w?.admin) return responder({ error: 'Sólo para administradores' }, 403);
    const { data, error } = await sb.from('push_suscripciones').select('endpoint, p256dh, auth').eq('user_id', u!.user!.id);
    if (error) return responder({ error: error.message }, 500);
    destinos = data ?? [];
    aviso = { ...AVISO, body: 'Notificación de prueba · ' + AVISO.body };
  } else {
    const clave = Deno.env.get('ARAC_CLAVE_PUSH');
    if (!clave || req.headers.get('x-arac-clave') !== clave) return responder({ error: 'No autorizado' }, 401);
    const { data, error } = await sb.rpc('push_destinos');
    if (error) return responder({ error: error.message }, 500);
    destinos = data ?? [];
  }

  webpush.setVapidDetails(
    'https://matumir.github.io/Digitalizaci-n-ARAC/app/',
    Deno.env.get('VAPID_PUBLICA')!,
    Deno.env.get('VAPID_PRIVADA')!,
  );
  let enviados = 0;
  const vencidas: string[] = [];
  await Promise.all(destinos.map(async s => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(aviso),
        { TTL: 6 * 3600, urgency: 'normal' },
      );
      enviados++;
    } catch (e) {
      // 404 / 410: el teléfono desinstaló la app o quitó el permiso
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) vencidas.push(s.endpoint);
    }
  }));
  if (vencidas.length) await sb.from('push_suscripciones').delete().in('endpoint', vencidas);
  return responder({ enviados, borradas: vencidas.length });
});
