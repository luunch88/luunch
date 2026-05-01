import { applyCors } from '../../_cors.js';
import { getSupabaseAdmin, requireAdminSecret } from '../_admin.js';

const VALID_STATUSES = new Set(['pending', 'approved', 'rejected']);

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (!applyCors(req, res, 'GET, OPTIONS')) {
    return res.status(403).json({ ok: false, error: 'Origin not allowed' });
  }
  if (req.method === 'OPTIONS') return res.status(200).json({ ok: true });
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Endast GET stöds' });
  }

  try {
    const admin = requireAdminSecret(req);
    if (!admin.ok) return res.status(admin.status).json({ ok: false, error: admin.error });

    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return res.status(500).json({ ok: false, error: 'Supabase är inte konfigurerat' });
    }

    const status = String(req.query?.status || 'all');
    let query = supabase
      .from('claims')
      .select('id, restaurant_name, address, postal_code, city, restaurant_type, contact_person, email, phone, website, organization_number, message, status, created_at, reviewed_at, reviewed_by, admin_note')
      .order('created_at', { ascending: false });

    if (VALID_STATUSES.has(status)) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[admin claims] list failed', {
        message: error.message,
        details: error.details,
        hint: error.hint
      });
      return res.status(500).json({ ok: false, error: 'Kunde inte hämta ansökningar' });
    }

    return res.status(200).json({ ok: true, claims: data || [] });
  } catch (e) {
    console.error('[admin claims] handler error', { message: e.message, stack: e.stack });
    return res.status(500).json({ ok: false, error: 'Kunde inte hämta ansökningar' });
  }
}
