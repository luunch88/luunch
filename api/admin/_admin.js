import { createClient } from '@supabase/supabase-js';

export function getSupabaseAdmin() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return null;
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

function adminEmails() {
  return String(process.env.ADMIN_EMAILS || '')
    .split(',')
    .map(email => email.trim().toLowerCase())
    .filter(Boolean);
}

function getBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || null;
}

export async function requireAdmin(req, supabase) {
  const configuredEmails = adminEmails();
  const adminSecret = process.env.ADMIN_SECRET;
  const providedSecret = req.headers['x-admin-secret'] || req.headers['X-Admin-Secret'];

  if (adminSecret && providedSecret === adminSecret) {
    return { ok: true, user: null, adminEmail: 'secret-admin' };
  }

  const token = getBearerToken(req);
  if (!token) {
    return { ok: false, status: 401, error: 'Admin-inloggning krävs' };
  }

  const { data, error } = await supabase.auth.getUser(token);
  const user = data?.user;
  const email = user?.email?.toLowerCase();

  if (error || !user || !email || !configuredEmails.includes(email)) {
    return { ok: false, status: 403, error: 'Du saknar adminbehörighet' };
  }

  return { ok: true, user, adminEmail: email };
}

export function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'restaurang';
}
