import { createClient } from '@supabase/supabase-js';

export function getSupabaseAdmin() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!process.env.SUPABASE_URL || !key) return null;
  return createClient(process.env.SUPABASE_URL, key);
}

export function requireAdminSecret(req) {
  const configured = process.env.ADMIN_SECRET;
  const provided = req.headers['x-admin-secret'] || req.headers['X-Admin-Secret'];

  if (!configured) {
    return { ok: false, status: 500, error: 'ADMIN_SECRET saknas på servern' };
  }

  if (!provided || provided !== configured) {
    return { ok: false, status: 401, error: 'Fel eller saknad adminnyckel' };
  }

  return { ok: true };
}

export function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}
