// ARAC Partidos — Edge Function "recordatorio": manda avisos a los teléfonos con la
// versión web que activaron las notificaciones (Web Push).
//
// Tres formas de llamarla:
// - El cron "arac-recordatorio" (supabase/recordatorio.sql), con la clave ARAC_CLAVE_PUSH:
//   manda el recordatorio de los fines de semana a todos.
// - El panel de administrador, con la sesión del administrador:
//   · { prueba: true }: el recordatorio, sólo a los teléfonos de esa cuenta;
//   · { tipo: 'version' | 'recordatorio' }: un aviso a todos. Además queda guardado en la
//     tabla avisos (supabase/admin.sql), que cada teléfono revisa al abrir la app: así les
//     llega también a los que usan el APK.
//
// Secretos (Supabase › Edge Functions › Secrets): VAPID_PUBLICA, VAPID_PRIVADA y ARAC_CLAVE_PUSH.
// Se despliega con "Verify JWT" desactivado: la protegen la clave y la revisión de administrador.
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

type Aviso = { title: string; body: string; url: string };
const AVISOS: Record<string, Aviso> = {
  recordatorio: {
    title: 'ARAC Partidos',
    body: '¿Dirigiste hoy? No te olvides de cargar los partidos de la jornada.',
    url: './#cargar',
  },
  version: {
    title: 'Nueva versión de ARAC Partidos',
    body: 'Hay una versión nueva de la app: actualizala para tener las últimas mejoras.',
    url: './',
  },
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
  let aviso = AVISOS.recordatorio;
  let avisoId: number | null = null;
  if (pedido.prueba || pedido.tipo) {
    // Desde el panel: sólo un administrador
    const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: u } = await sb.auth.getUser(token);
    const email = u?.user?.email?.toLowerCase();
    if (!email) return responder({ error: 'Sin sesión' }, 401);
    const { data: w } = await sb.from('whitelist').select('admin').eq('email', email).maybeSingle();
    if (!w?.admin) return responder({ error: 'Sólo para administradores' }, 403);

    if (pedido.prueba) {
      // Prueba: sólo a los teléfonos de esta cuenta
      const { data, error } = await sb.from('push_suscripciones').select('endpoint, p256dh, auth').eq('user_id', u!.user!.id);
      if (error) return responder({ error: error.message }, 500);
      destinos = data ?? [];
      aviso = { ...aviso, body: 'Notificación de prueba · ' + aviso.body };
    } else {
      // Aviso a todos: queda guardado para los que lo ven al abrir la app (APK)
      aviso = AVISOS[pedido.tipo];
      if (!aviso) return responder({ error: 'Tipo de aviso desconocido' }, 400);
      const { data: fila, error: e1 } = await sb.from('avisos')
        .insert({ tipo: pedido.tipo, titulo: aviso.title, cuerpo: aviso.body, autor: u!.user!.id })
        .select('id').single();
      if (e1) return responder({ error: e1.message }, 500);
      avisoId = fila.id;
      const { data, error } = await sb.rpc('push_destinos');
      if (error) return responder({ error: error.message }, 500);
      destinos = data ?? [];
    }
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
  return responder({ enviados, borradas: vencidas.length, aviso: avisoId });
});
