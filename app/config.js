// Datos del proyecto de Supabase (Settings › API).
// Son públicos por diseño: la seguridad la da la whitelist del servidor (supabase/setup.sql).
window.ARAC_CONFIG = {
  supabaseUrl: 'https://jvclrktwezisvuljemgi.supabase.co',
  supabaseAnonKey: 'sb_publishable_LV1XIiUzH0GGPu8q0uHj1w_2qnqXcty',
  // Clave pública de Web Push (recordatorio en la versión web). La privada va sólo en los
  // secretos de la Edge Function "recordatorio" (ver supabase/recordatorio.sql).
  vapidPublicKey: 'BCoRm7tqXD1JGjAqpUXzyqYY6yMDkkiz1FEg_y5oUs4W73vSzde23B0WdbUJdpwROeAzQJMTAu7dN7CD2tc_wbg',
};
