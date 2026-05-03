import { applyCors } from '../_cors.js';
import { getSupabaseAdmin } from '../admin/_admin.js';

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalize(value) {
  return clean(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function includesNormalized(source, needle) {
  if (!needle) return true;
  return normalize(source).includes(normalize(needle));
}

function restaurantStatus(restaurant) {
  if (restaurant.owner_user_id || restaurant.claimed === true || restaurant.status === 'claimed') return 'claimed';
  if (restaurant.status === 'pending_claim') return 'pending_claim';
  if (restaurant.verified === true) return restaurant.status || 'unclaimed';
  return restaurant.status || 'unclaimed';
}

function missingColumn(error) {
  const text = [error?.message, error?.details, error?.hint].filter(Boolean).join(' ');
  return text.match(/'([^']+)' column/)?.[1] || null;
}

async function runRestaurantSearch(supabase, filters, columns) {
  let query = supabase
    .from('restaurants')
    .select(columns.join(', '))
    .limit(50);

  if (filters.q) query = query.ilike('name', `%${filters.q}%`);
  if (filters.city) query = query.ilike('city', `%${filters.city}%`);
  if (filters.address) query = query.ilike('address', `%${filters.address}%`);

  return query;
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (!applyCors(req, res, 'GET, OPTIONS')) {
    return res.status(403).json({ ok: false, error: 'Origin not allowed' });
  }
  if (req.method === 'OPTIONS') return res.status(200).json({ ok: true });
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Endast GET stöds' });

  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) return res.status(500).json({ ok: false, error: 'Supabase är inte konfigurerat' });

    const q = clean(req.query?.q);
    const city = clean(req.query?.city);
    const address = clean(req.query?.address);
    if (!q && !city && !address) {
      return res.status(400).json({ ok: false, error: 'Söktext krävs' });
    }

    let columns = ['id', 'name', 'address', 'postal_code', 'city', 'category', 'status', 'owner_user_id', 'claimed', 'verified'];
    let { data, error } = await runRestaurantSearch(supabase, { q, city, address }, columns);
    for (let attempt = 0; error && attempt < 4; attempt += 1) {
      const column = missingColumn(error);
      if (error.code !== 'PGRST204' || !column || !columns.includes(column)) break;
      columns = columns.filter(item => item !== column);
      console.warn('[restaurants search] retrying without missing column', { column, columns });
      ({ data, error } = await runRestaurantSearch(supabase, { q, city, address }, columns));
    }

    if (error) {
      console.error('[restaurants search] failed', {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint
      });
      return res.status(500).json({ ok: false, error: error.message });
    }

    const restaurants = (data || [])
      .filter(restaurant => includesNormalized(restaurant.name, q))
      .filter(restaurant => includesNormalized(restaurant.city, city))
      .filter(restaurant => includesNormalized(restaurant.address, address))
      .map(restaurant => ({
        ...restaurant,
        status: restaurantStatus(restaurant)
      }));

    return res.status(200).json({ ok: true, restaurants });
  } catch (e) {
    console.error('[restaurants search] handler error', { message: e.message, stack: e.stack });
    return res.status(500).json({ ok: false, error: e.message || 'Kunde inte söka restauranger' });
  }
}
