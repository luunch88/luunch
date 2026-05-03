import { applyCors } from '../../_cors.js';
import { getSupabaseAdmin, requireAdminSecret } from '../_admin.js';

const VALID_STATUSES = new Set(['pending', 'approved', 'rejected']);

function missingColumn(error) {
  const text = [error?.message, error?.details, error?.hint].filter(Boolean).join(' ');
  return text.match(/'([^']+)' column/)?.[1] || null;
}

async function fetchRestaurants(supabase, restaurantIds) {
  let columns = ['id', 'name', 'address', 'postal_code', 'city', 'category', 'status', 'owner_user_id', 'claimed', 'verified'];
  let result = await supabase
    .from('restaurants')
    .select(columns.join(', '))
    .in('id', restaurantIds);

  for (let attempt = 0; result.error && attempt < 4; attempt += 1) {
    const column = missingColumn(result.error);
    if (result.error.code !== 'PGRST204' || !column || !columns.includes(column)) break;
    columns = columns.filter(item => item !== column);
    console.warn('[admin restaurant claims] retrying restaurant lookup without missing column', { column });
    result = await supabase
      .from('restaurants')
      .select(columns.join(', '))
      .in('id', restaurantIds);
  }

  return result;
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

    const status = String(req.query?.status || 'pending');
    let query = supabase
      .from('restaurant_claims')
      .select('id, restaurant_id, user_id, contact_name, role, phone, email, org_number, message, status, created_at, reviewed_at, reviewed_by')
      .order('created_at', { ascending: false });

    if (VALID_STATUSES.has(status)) query = query.eq('status', status);

    const { data: claims, error } = await query;
    if (error) {
      console.error('[admin restaurant claims] list failed', {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint
      });
      return res.status(500).json({ ok: false, error: error.message });
    }

    const restaurantIds = [...new Set((claims || []).map(claim => claim.restaurant_id).filter(Boolean))];
    let restaurantsById = new Map();
    if (restaurantIds.length) {
      const { data: restaurants, error: restaurantsError } = await fetchRestaurants(supabase, restaurantIds);

      if (restaurantsError) {
        console.error('[admin restaurant claims] restaurant lookup failed', {
          message: restaurantsError.message,
          code: restaurantsError.code
        });
      } else {
        restaurantsById = new Map((restaurants || []).map(restaurant => [restaurant.id, restaurant]));
      }
    }

    return res.status(200).json({
      ok: true,
      claims: (claims || []).map(claim => ({
        ...claim,
        restaurant: restaurantsById.get(claim.restaurant_id) || null
      }))
    });
  } catch (e) {
    console.error('[admin restaurant claims] handler error', { message: e.message, stack: e.stack });
    return res.status(500).json({ ok: false, error: e.message || 'Kunde inte hämta anspråk' });
  }
}
