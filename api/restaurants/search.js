import { applyCors } from '../_cors.js';
import { getSupabaseAdmin } from '../admin/_admin.js';

const NOMINATIM_TIMEOUT_MS = 6000;
const OVERPASS_TIMEOUT_MS = 8000;
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
];

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

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function flexibleNameRegex(value) {
  const compact = normalize(value).replace(/\s+/g, '');
  if (!compact) return '';
  return compact
    .split('')
    .map(char => escapeRegex(char))
    .join('\\s*');
}

function includesNormalized(source, needle) {
  if (!needle) return true;
  const sourceNorm = normalize(source);
  const needleNorm = normalize(needle);
  return sourceNorm.includes(needleNorm) ||
    sourceNorm.replace(/\s+/g, '').includes(needleNorm.replace(/\s+/g, ''));
}

function matchesExternalName(candidate, needle) {
  if (!needle) return true;
  return includesNormalized(candidate.name, needle) ||
    includesNormalized(candidate.display_name, needle);
}

function matchesExternalCity(candidate, city) {
  if (!city) return true;
  if (normalize(candidate.city) === normalize(city)) return true;
  if (!candidate.city && includesNormalized(candidate.display_name, 'sweden')) return true;
  return includesNormalized(candidate.city, city) ||
    includesNormalized(candidate.display_name, city);
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

function overpassAddress(tags = {}) {
  return [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' ');
}

function overpassCity(tags = {}, fallbackCity = '') {
  return tags['addr:city'] || tags['addr:town'] || tags['addr:municipality'] || fallbackCity || '';
}

function overpassSourceId(element) {
  return `${element.type}/${element.id}`;
}

async function fetchExternalCandidates(filters) {
  const query = [filters.q, filters.address, filters.city, 'Sweden'].filter(Boolean).join(' ');
  return fetchNominatimQuery(query, filters);
}

function nearbyRestaurantToCandidate(restaurant) {
  const sourceId = restaurant.osm_id || restaurant.id || restaurant.source_id || null;
  return {
    name: restaurant.name || '',
    address: restaurant.address || '',
    postal_code: restaurant.postal_code || null,
    city: restaurant.city || '',
    display_name: [restaurant.name, restaurant.address, restaurant.city].filter(Boolean).join(', '),
    category: restaurant.category || restaurant.type_label || 'restaurant',
    source: restaurant.source || 'osm',
    source_id: sourceId,
    osm_id: sourceId,
    lat: restaurant.lat === undefined || restaurant.lat === null ? null : Number(restaurant.lat),
    lon: restaurant.lon === undefined || restaurant.lon === null ? null : Number(restaurant.lon)
  };
}

async function fetchSnapshotCandidates(supabase, filters) {
  try {
    const { data, error } = await supabase
      .from('place_snapshots')
      .select('payload_json, updated_at, created_at')
      .order('updated_at', { ascending: false })
      .limit(30);

    if (error) {
      console.warn('[restaurants search] snapshot search skipped', {
        message: error.message,
        code: error.code
      });
      return [];
    }

    const seen = new Set();
    const candidates = [];
    for (const snapshot of data || []) {
      const restaurants = Array.isArray(snapshot.payload_json?.restaurants)
        ? snapshot.payload_json.restaurants
        : [];

      for (const restaurant of restaurants) {
        const candidate = nearbyRestaurantToCandidate(restaurant);
        if (!candidate.name || !matchesExternalName(candidate, filters.q)) continue;
        if (filters.city && candidate.city && !matchesExternalCity(candidate, filters.city)) continue;
        if (filters.address && candidate.address && !includesNormalized(candidate.address, filters.address)) continue;

        const key = candidate.source_id || `${candidate.name}|${candidate.address}|${candidate.city}`;
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push(candidate);
      }
    }

    console.log('[restaurants search] snapshot candidates', {
      query: filters.q,
      city: filters.city,
      count: candidates.length,
      names: candidates.map(candidate => candidate.name).slice(0, 5)
    });

    return candidates;
  } catch (error) {
    console.error('[restaurants search] snapshot search failed', {
      message: error.message,
      filters
    });
    return [];
  }
}

async function fetchNominatimQuery(query, filters) {
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
    const mapped = (Array.isArray(data) ? data : [])
      .map(candidate => ({
        name: externalName(candidate),
        address: externalAddress(candidate),
        postal_code: candidate.address?.postcode || null,
        city: externalCity(candidate),
        display_name: candidate.display_name || '',
        category: candidate.type || candidate.category || 'restaurant',
        source: 'osm',
        source_id: sourceIdFor(candidate),
        osm_id: sourceIdFor(candidate),
        lat: candidate.lat === undefined ? null : Number(candidate.lat),
        lon: candidate.lon === undefined ? null : Number(candidate.lon)
      }))
      .filter(candidate => candidate.name)
      .filter(candidate => matchesExternalName(candidate, filters.q))
      .filter(candidate => matchesExternalCity(candidate, filters.city));

    console.log('[restaurants search] external candidates', {
      query,
      raw: Array.isArray(data) ? data.length : 0,
      mapped: mapped.length,
      names: mapped.map(candidate => candidate.name).slice(0, 5)
    });

    return mapped;
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

async function fetchExternalCandidatesBroad(filters) {
  const queries = [
    [filters.q, filters.city, 'Sweden'].filter(Boolean).join(' '),
    [filters.q, 'Kävlinge', 'Sweden'].filter(Boolean).join(' '),
    [filters.q, 'Skåne', 'Sweden'].filter(Boolean).join(' ')
  ];
  const seen = new Set();
  const all = [];

  for (const query of queries) {
    if (!query || seen.has(query)) continue;
    seen.add(query);
    const results = await fetchNominatimQuery(query, filters);
    for (const result of results) {
      const key = result.source_id || `${result.name}|${result.address}|${result.city}`;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(result);
    }
    if (all.length > 0) break;
  }

  return all;
}

async function geocodeCity(city) {
  if (!city) return null;
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  url.searchParams.set('countrycodes', 'se');
  url.searchParams.set('q', [city, 'Sweden'].filter(Boolean).join(' '));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NOMINATIM_TIMEOUT_MS);
  let first = null;
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'luunch.se/1.0 contact@luunch.se'
      },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Nominatim city HTTP ${response.status}`);
    const data = await response.json();
    first = Array.isArray(data) ? data[0] : null;
  } catch (error) {
    console.error('[restaurants search] city geocode failed', {
      city,
      message: error.name === 'AbortError' ? 'Nominatim city timeout' : error.message
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!first || !Number.isFinite(first.lat) || !Number.isFinite(first.lon)) return null;
  return { lat: Number(first.lat), lon: Number(first.lon) };
}

async function fetchOverpassCandidates(filters) {
  const center = await geocodeCity(filters.city);
  if (!center) {
    console.warn('[restaurants search] overpass fallback skipped, city geocode failed', {
      city: filters.city
    });
    return [];
  }

  const safeName = flexibleNameRegex(filters.q);
  const query = `[out:json][timeout:20];(node["amenity"~"restaurant|cafe|fast_food|bar|bakery|pub"]["name"~"${safeName}",i](around:7000,${center.lat},${center.lon});way["amenity"~"restaurant|cafe|fast_food|bar|bakery|pub"]["name"~"${safeName}",i](around:7000,${center.lat},${center.lon}););out center tags;`;
  const errors = [];

  for (const endpoint of OVERPASS_ENDPOINTS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OVERPASS_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'User-Agent': 'luunch.se/1.0 contact@luunch.se'
        },
        body: 'data=' + encodeURIComponent(query),
        signal: controller.signal
      });

      if (!response.ok) throw new Error(`Overpass HTTP ${response.status}`);
      const data = await response.json();
      const candidates = (data.elements || [])
        .map(element => {
          const tags = element.tags || {};
          const lat = element.lat || element.center?.lat;
          const lon = element.lon || element.center?.lon;
          return {
            name: tags.name || '',
            address: overpassAddress(tags),
            postal_code: tags['addr:postcode'] || null,
            city: overpassCity(tags, filters.city),
            category: tags.cuisine || tags.amenity || 'restaurant',
            source: 'osm',
            source_id: overpassSourceId(element),
            osm_id: overpassSourceId(element),
            lat: lat === undefined ? null : Number(lat),
            lon: lon === undefined ? null : Number(lon)
          };
        })
        .filter(candidate => candidate.name)
        .filter(candidate => includesNormalized(candidate.name, filters.q));

      console.log('[restaurants search] overpass candidates', {
        endpoint,
        city: filters.city,
        query: filters.q,
        count: candidates.length,
        names: candidates.map(candidate => candidate.name).slice(0, 5)
      });

      return candidates;
    } catch (error) {
      const message = error.name === 'AbortError' ? 'Overpass timeout' : error.message;
      errors.push(message);
      console.error('[restaurants search] overpass fallback failed', {
        endpoint,
        message,
        filters
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  console.error('[restaurants search] all overpass fallback endpoints failed', {
    errors,
    filters
  });
  return [];
}

async function fetchOverpassCityCandidates(filters) {
  const center = await geocodeCity(filters.city);
  const cityRegex = escapeRegex(clean(filters.city));
  const areaQuery = `[out:json][timeout:20];area["name"~"^${cityRegex}",i]["boundary"="administrative"]->.cityArea;(node(area.cityArea)["amenity"~"restaurant|cafe|fast_food|bar|bakery|pub"];way(area.cityArea)["amenity"~"restaurant|cafe|fast_food|bar|bakery|pub"];);out center tags;`;
  const aroundQuery = center
    ? `[out:json][timeout:20];(node["amenity"~"restaurant|cafe|fast_food|bar|bakery|pub"](around:8000,${center.lat},${center.lon});way["amenity"~"restaurant|cafe|fast_food|bar|bakery|pub"](around:8000,${center.lat},${center.lon}););out center tags;`
    : null;
  const errors = [];

  for (const endpoint of OVERPASS_ENDPOINTS) {
    for (const [queryType, query] of [['area', areaQuery], ['around', aroundQuery]].filter(([, value]) => value)) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), OVERPASS_TIMEOUT_MS);
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            'User-Agent': 'luunch.se/1.0 contact@luunch.se'
          },
          body: 'data=' + encodeURIComponent(query),
          signal: controller.signal
        });

        if (!response.ok) throw new Error(`Overpass HTTP ${response.status}`);
        const data = await response.json();
        const candidates = (data.elements || [])
          .map(element => {
            const tags = element.tags || {};
            const lat = element.lat || element.center?.lat;
            const lon = element.lon || element.center?.lon;
            return {
              name: tags.name || '',
              address: overpassAddress(tags),
              postal_code: tags['addr:postcode'] || null,
              city: overpassCity(tags, filters.city),
              display_name: [tags.name, overpassAddress(tags), overpassCity(tags, filters.city)].filter(Boolean).join(', '),
              category: tags.cuisine || tags.amenity || 'restaurant',
              source: 'osm',
              source_id: overpassSourceId(element),
              osm_id: overpassSourceId(element),
              lat: lat === undefined ? null : Number(lat),
              lon: lon === undefined ? null : Number(lon)
            };
          })
          .filter(candidate => candidate.name)
          .filter(candidate => matchesExternalCity(candidate, filters.city))
          .filter(candidate => !filters.q || matchesExternalName(candidate, filters.q))
          .filter(candidate => !filters.address || includesNormalized(candidate.address, filters.address));

        console.log('[restaurants search] overpass city candidates', {
          endpoint,
          queryType,
          city: filters.city,
          query: filters.q,
          raw: data.elements?.length || 0,
          count: candidates.length,
          names: candidates.map(candidate => candidate.name).slice(0, 12)
        });

        if (candidates.length > 0) return candidates;
      } catch (error) {
        const message = error.name === 'AbortError' ? 'Overpass timeout' : error.message;
        errors.push(`${queryType}: ${message}`);
        console.error('[restaurants search] overpass city fallback failed', {
          endpoint,
          queryType,
          message,
          filters
        });
      } finally {
        clearTimeout(timeout);
      }
    }
  }

  console.error('[restaurants search] all overpass city fallback endpoints failed', {
    errors,
    filters
  });
  return [];
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

function restaurantKey(restaurant) {
  return [
    restaurant.id || restaurant.source_id || restaurant.osm_id || '',
    normalize(restaurant.name),
    normalize(restaurant.address),
    normalize(restaurant.city)
  ].join('|');
}

function mergeRestaurants(existing, imported) {
  const seen = new Set();
  const merged = [];
  for (const restaurant of [...existing, ...imported]) {
    const key = restaurantKey(restaurant);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({
      ...restaurant,
      status: restaurantStatus(restaurant)
    });
  }
  return merged;
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

    if (q || city) {
      let externalCandidates = await fetchSnapshotCandidates(supabase, { q, city, address });
      if (externalCandidates.length === 0 && restaurants.length === 0) {
        externalCandidates = q
          ? await fetchExternalCandidates({ q, city, address })
          : [];
      }
      if (externalCandidates.length === 0 && restaurants.length === 0) {
        externalCandidates = q
          ? await fetchExternalCandidatesBroad({ q, city, address })
          : [];
      }
      if (externalCandidates.length === 0 && q && restaurants.length === 0) {
        externalCandidates = q
          ? await fetchOverpassCandidates({ q, city, address })
          : [];
      }
      if (city) {
        const cityCandidates = await fetchOverpassCityCandidates({ q, city, address });
        externalCandidates = [...externalCandidates, ...cityCandidates];
      }
      const imported = await importExternalCandidates(supabase, externalCandidates);
      restaurants = mergeRestaurants(restaurants, imported);
      console.log('[restaurants search] external fallback imported', {
        query: q,
        city,
        externalCandidates: externalCandidates.length,
        imported: imported.length,
        final: restaurants.length
      });
    }

    return res.status(200).json({ ok: true, restaurants });
  } catch (e) {
    console.error('[restaurants search] handler error', { message: e.message, stack: e.stack });
    return res.status(500).json({ ok: false, error: e.message || 'Kunde inte söka restauranger' });
  }
}
