import { applyCors } from '../../_cors.js';
import { getSupabaseAdmin, requireAdminSecret } from '../_admin.js';

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function missingColumn(error) {
  const text = [error?.message, error?.details, error?.hint].filter(Boolean).join(' ');
  return text.match(/'([^']+)' column/)?.[1] || null;
}

async function listRestaurants(supabase, q) {
  let columns = ['id', 'name', 'address', 'postal_code', 'city', 'category', 'status', 'claimed', 'verified', 'owner_user_id', 'claimed_by_user_id', 'source', 'osm_id', 'lat', 'lon', 'created_at'];

  for (let attempt = 0; attempt < 8; attempt += 1) {
    let query = supabase
      .from('restaurants')
      .select(columns.join(', '))
      .order('name', { ascending: true })
      .limit(200);

    if (q) {
      query = query.or(`name.ilike.%${q}%,city.ilike.%${q}%,address.ilike.%${q}%`);
    }

    const { data, error } = await query;
    if (!error) return data || [];

    const column = missingColumn(error);
    if (error.code !== 'PGRST204' || !column || !columns.includes(column)) {
      console.error('[admin restaurants] list failed', {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint
      });
      throw new Error(error.message);
    }

    columns = columns.filter(item => item !== column);
  }

  throw new Error('Kunde inte hämta restauranger.');
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (!applyCors(req, res, 'GET, OPTIONS')) {
    return res.status(403).json({ ok: false, error: 'Origin not allowed' });
  }
  if (req.method === 'OPTIONS') return res.status(200).json({ ok: true });
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Endast GET stöds' });

  try {
    const admin = requireAdminSecret(req);
    if (!admin.ok) return res.status(admin.status).json({ ok: false, error: admin.error });

    const supabase = getSupabaseAdmin();
    if (!supabase) return res.status(500).json({ ok: false, error: 'Supabase är inte konfigurerat' });

    const q = clean(req.query?.q);
    const restaurants = await listRestaurants(supabase, q);
    return res.status(200).json({ ok: true, restaurants });
  } catch (error) {
    console.error('[admin restaurants] handler error', { message: error.message, stack: error.stack });
    return res.status(500).json({ ok: false, error: error.message || 'Kunde inte hämta restauranger' });
  }
}
