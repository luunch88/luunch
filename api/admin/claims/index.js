import { applyCors } from '../../_cors.js';
import { getSupabaseAdmin, requireAdmin } from '../_admin.js';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (!applyCors(req, res, 'GET, OPTIONS')) {
    return res.status(403).json({ ok: false, error: 'Origin not allowed' });
  }
  if (req.method === 'OPTIONS') return res.status(200).json({ ok: true });
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return res.status(500).json({ ok: false, error: 'Admin API är inte konfigurerat' });
    }

    const admin = await requireAdmin(req, supabase);
    if (!admin.ok) {
      return res.status(admin.status).json({ ok: false, error: admin.error });
    }

    const { data, error } = await supabase
      .from('claims')
      .select('id, user_id, email, restaurant_id, restaurant_name, address, postal_code, city, type, contact_person, phone, organization_number, message, status, created_at, reviewed_at, reviewed_by')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[admin claims] list failed', { message: error.message });
      return res.status(500).json({ ok: false, error: 'Kunde inte hämta ansökningar' });
    }

    return res.status(200).json({ ok: true, claims: data || [] });
  } catch (e) {
    console.error('[admin claims] handler error', { message: e.message, stack: e.stack });
    return res.status(500).json({ ok: false, error: 'Kunde inte hämta ansökningar' });
  }
}
