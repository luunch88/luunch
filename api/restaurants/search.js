import { applyCors } from '../_cors.js';
import { getSupabaseAdmin } from '../admin/_admin.js';

const NOMINATIM_TIMEOUT_MS = 6000;

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
  const sourceNorm = normalize(source);
  const needleNorm = normalize(needle);
  return sourceNorm.includes(needleNorm) ||
    sourceNorm.replace(/\s+/g, '').includes(needleNorm.replace(/\s+/g, ''));
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

function sourceIdFor(candidate) {
  if (!candidate.osm_type || !candidate.osm_id) return null;
  return `${String(candidate.osm_type).toLowerCase()}/${candidate.osm_id}`;
}

function externalAddress(candidate) {
  const address = candidate.address || {};
  return [address.road || address.pedestrian || address.street, address.house_number].filter(Boolean).join(' ');
}

function externalCity(candidate) {
  const address = candidate.address || {};
  return address.city || address.town || address.village || address.municipality || address.county || '';
}

function externalName(candidate) {
  return candidate.namedetails?.name ||
    candidate.name ||
    String(candidate.display_name || '').split(',')[0].trim();
}

async function fetchExternalCandidates(filters) {
  const query = [filters.q, filters.address, filters.city, 'Sverige'].filter(Boolean).join(' ');
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('namedetails', '1');
  url.searchParams.set('limit', '8');
  url.searchParams.set('countrycodes', 'se');
  url.searchParams.set('q', query);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NOMINATIM_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'luunch.se/1.0 contact@luunch.se'
      },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Nominatim HTTP ${response.status}`);
    const data = await response.json();
    return (Array.isArray(data) ? data : [])
      .map(candidate => ({
        name: externalName(candidate),
        address: externalAddress(candidate),
        postal_code: candidate.address?.postcode || null,
        city: externalCity(candidate),
        category: candidate.type || candidate.category || 'restaurant',
        source: 'osm',
        source_id: sourceIdFor(candidate),
        osm_id: sourceIdFor(candidate),
        lat: candidate.lat === undefined ? null : Number(candidate.lat),
        lon: candidate.lon === undefined ? null : Number(candidate.lon)
      }))
      .filter(candidate => candidate.name)
      .filter(candidate => includesNormalized(candidate.name, filters.q))
      .filter(candidate => includesNormalized(candidate.city, filters.city));
  } catch (error) {
    console.error('[restaurants search] external search failed', {
      message: error.name === 'AbortError' ? 'Nominatim timeout' : error.message,
      filters
    });
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function writeRestaurantWithFallback(supabase, payload) {
  let nextPayload = { ...payload };

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { data, error } = await supabase
      .from('restaurants')
      .insert(nextPayload)
      .select('id, name, address, postal_code, city, category')
      .single();

    if (!error) return { ...nextPayload, ...data };

    const column = missingColumn(error);
    if (error.code !== 'PGRST204' || !column || !(column in nextPayload)) {
      console.error('[restaurants search] external import failed', {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
        payload: nextPayload
      });
      return null;
    }

    delete nextPayload[column];
    console.warn('[restaurants search] retrying external import without missing column', { column });
  }

  return null;
}

async function findBySourceId(supabase, sourceId) {
  if (!sourceId) return null;
  const { data, error } = await supabase
    .from('restaurants')
    .select('id, name, address, postal_code, city, category, status, owner_user_id, claimed, verified')
    .or(`source_id.eq.${sourceId},osm_id.eq.${sourceId}`)
    .limit(1)
    .maybeSingle();

  if (error) return null;
  return data || null;
}

async function importExternalCandidates(supabase, candidates) {
  const imported = [];
  for (const candidate of candidates) {
    const existing = await findBySourceId(supabase, candidate.source_id);
    if (existing) {
      imported.push(existing);
      continue;
    }

    const now = new Date().toISOString();
    const restaurant = await writeRestaurantWithFallback(supabase, {
      name: candidate.name,
      address: candidate.address || null,
      postal_code: candidate.postal_code,
      city: candidate.city || null,
      category: candidate.category || 'restaurant',
      source: candidate.source,
      source_id: candidate.source_id,
      osm_id: candidate.osm_id,
      lat: candidate.lat,
      lon: candidate.lon,
      status: 'unclaimed',
      claimed: false,
      verified: false,
      visible: true,
      created_at: now,
      updated_at: now
    });
    if (restaurant) imported.push(restaurant);
  }
  return imported;
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

    let restaurants = (data || [])
      .filter(restaurant => includesNormalized(restaurant.name, q))
      .filter(restaurant => includesNormalized(restaurant.city, city))
      .filter(restaurant => includesNormalized(restaurant.address, address))
      .map(restaurant => ({
        ...restaurant,
        status: restaurantStatus(restaurant)
      }));

    if (restaurants.length === 0 && q) {
      const externalCandidates = await fetchExternalCandidates({ q, city, address });
      const imported = await importExternalCandidates(supabase, externalCandidates);
      restaurants = imported.map(restaurant => ({
        ...restaurant,
        status: restaurantStatus(restaurant)
      }));
      console.log('[restaurants search] external fallback imported', {
        query: q,
        city,
        externalCandidates: externalCandidates.length,
        imported: imported.length
      });
    }

    return res.status(200).json({ ok: true, restaurants });
  } catch (e) {
    console.error('[restaurants search] handler error', { message: e.message, stack: e.stack });
    return res.status(500).json({ ok: false, error: e.message || 'Kunde inte söka restauranger' });
  }
}
