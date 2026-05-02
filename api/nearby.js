import { createClient } from '@supabase/supabase-js';
import { applyCors } from './_cors.js';

const TTL_MS = 6 * 60 * 60 * 1000;
const GRID_SIZE = 0.005;
const DEFAULT_RADIUS_METERS = 800;
const MAX_RESULTS = 30;
const CACHE_VERSION = 5;
const OVERPASS_TIMEOUT_MS = 8000;
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
];

const memoryCache = globalThis.__luunchNearbyCache || new Map();
globalThis.__luunchNearbyCache = memoryCache;

let supabase = null;
try {
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  supabase = process.env.SUPABASE_URL && supabaseKey
    ? createClient(process.env.SUPABASE_URL, supabaseKey)
    : null;
} catch (e) {
  console.error('[nearby] Supabase init error', {
    message: e.message,
    stack: e.stack,
    hasSupabaseUrl: Boolean(process.env.SUPABASE_URL),
    hasSupabaseServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    hasSupabaseServiceKey: Boolean(process.env.SUPABASE_SERVICE_KEY),
    hasSupabaseAnonKey: Boolean(process.env.SUPABASE_ANON_KEY)
  });
}

if (!supabase) {
  console.warn('[nearby] Supabase env saknas eller kunde inte initieras. Kör med in-memory cache fallback.', {
    hasSupabaseUrl: Boolean(process.env.SUPABASE_URL),
    hasSupabaseServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    hasSupabaseServiceKey: Boolean(process.env.SUPABASE_SERVICE_KEY),
    hasSupabaseAnonKey: Boolean(process.env.SUPABASE_ANON_KEY)
  });
}

const filterRx = {
  asiatiskt: /kines|japan|asian|wok|thai|vietnam|korea|noodle|ramen/i,
  burgare: /burger|hamburgare|grill|bbq/i,
  pizza: /pizza|pizzeria/i,
  sushi: /sushi|maki|japan/i,
  vegetariskt: /vegan|vegetar|sallad|bowl/i,
  thai: /thai|bangkok/i,
  indiskt: /india|indisk|curry|tandoor/i
};

function roundCoord(value) {
  return (Math.round(value / GRID_SIZE) * GRID_SIZE).toFixed(3);
}

function gridKey(lat, lon) {
  return `${roundCoord(lat)},${roundCoord(lon)}`;
}

function cacheKeyFor(grid, category, radiusMeters) {
  return `nearby:v${CACHE_VERSION}:${grid}:${category}:${radiusMeters}`;
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
      Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getEmoji(tags = {}) {
  const c = (tags.name || '') + (tags.cuisine || '');
  if (/sushi|maki|japan/i.test(c)) return '🍣';
  if (/pizza/i.test(c)) return '🍕';
  if (/burger|hamburgare/i.test(c)) return '🍔';
  if (/thai|vietnam|wok|noodle|ramen/i.test(c)) return '🍜';
  if (/india|curry|tandoor/i.test(c)) return '🫓';
  if (/vegan|vegetar|sallad|bowl/i.test(c)) return '🥗';
  if (tags.amenity === 'cafe' || tags.amenity === 'bakery') return '☕';
  if (tags.amenity === 'bar' || tags.amenity === 'pub') return '🍺';
  return '🍽️';
}

function getTypeLabel(tags = {}) {
  if (tags.cuisine) return tags.cuisine.replace(/_/g, ' ').split(';')[0];
  return {
    restaurant: 'Restaurang',
    cafe: 'Café',
    fast_food: 'Fast food',
    bar: 'Bar & mat',
    bakery: 'Bageri',
    pub: 'Pub'
  }[tags.amenity] || 'Restaurang';
}

function getAddress(tags = {}) {
  return [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' ');
}

function matchesCategory(restaurant, category) {
  if (!category || category === 'alla') return true;
  const haystack = [
    restaurant.name,
    restaurant.category,
    restaurant.type_label,
    restaurant.tags?.name,
    restaurant.tags?.cuisine,
    restaurant.tags?.amenity
  ].filter(Boolean).join(' ');
  return filterRx[category]?.test(haystack) ?? true;
}

function swedenNowParts() {
  const now = new Date();
  const swedenNow = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Stockholm' }));
  return {
    today: new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Stockholm' }).format(now),
    dayIndex: (swedenNow.getDay() + 6) % 7,
    currentTime: swedenNow.getHours() * 60 + swedenNow.getMinutes()
  };
}

function timeToMinutes(value) {
  if (!/^\d{2}:\d{2}$/.test(String(value || ''))) return null;
  const [hours, minutes] = value.split(':').map(Number);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function isWithinTimeRange(opens, closes, currentTime) {
  const openMin = timeToMinutes(opens);
  const closeMin = timeToMinutes(closes);
  if (openMin === null || closeMin === null) return null;
  if (closeMin < openMin) {
    return currentTime >= openMin || currentTime < closeMin;
  }
  return currentTime >= openMin && currentTime < closeMin;
}

function getLuunchHoursStatus(hours, currentTime) {
  if (!hours) {
    return {
      today_hours: null,
      is_open_now: null,
      open_status: 'unknown'
    };
  }

  const opens = hours.lunch_opens || hours.opens;
  const closes = hours.lunch_closes || hours.closes;
  const isOpen = isWithinTimeRange(opens, closes, currentTime);
  if (isOpen === null) {
    return {
      today_hours: null,
      is_open_now: null,
      open_status: 'unknown'
    };
  }

  return {
    today_hours: `${opens}-${closes}`,
    is_open_now: isOpen,
    open_status: isOpen ? 'open' : 'closed'
  };
}

function getOsmOpeningStatus(openingHoursRaw, currentTime) {
  if (!openingHoursRaw) {
    return {
      today_hours: null,
      is_open_now: null,
      open_status: 'unknown'
    };
  }

  const raw = String(openingHoursRaw).trim();
  if (/^24\/7$/i.test(raw)) {
    return {
      today_hours: '00:00-24:00',
      is_open_now: true,
      open_status: 'open'
    };
  }

  // Conservative parser: only plain daily ranges like "11:00-14:00".
  const simpleRange = raw.match(/^(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})$/);
  if (simpleRange) {
    const [, opens, closes] = simpleRange;
    const isOpen = isWithinTimeRange(opens, closes, currentTime);
    if (isOpen !== null) {
      return {
        today_hours: `${opens}-${closes}`,
        is_open_now: isOpen,
        open_status: isOpen ? 'open' : 'closed'
      };
    }
  }

  return {
    today_hours: null,
    is_open_now: null,
    open_status: 'unknown'
  };
}

async function fetchOpeningHours(restaurantIds, dayIndex) {
  const withLunchColumns = await supabase
    .from('opening_hours')
    .select('restaurant_id, opens, closes, lunch_opens, lunch_closes')
    .in('restaurant_id', restaurantIds)
    .eq('day_of_week', dayIndex);

  if (!withLunchColumns.error) return withLunchColumns.data || [];

  console.warn('[nearby] opening_hours lunch columns saknas eller kunde inte läsas. Faller tillbaka.', {
    message: withLunchColumns.error.message
  });

  const fallback = await supabase
    .from('opening_hours')
    .select('restaurant_id, opens, closes')
    .in('restaurant_id', restaurantIds)
    .eq('day_of_week', dayIndex);

  return fallback.data || [];
}

function isFreshSnapshot(snapshot) {
  return snapshot?.expiresAt && snapshot.expiresAt > Date.now();
}

async function readDbSnapshot(cacheKey) {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('place_snapshots')
      .select('payload_json, created_at, updated_at, expires_at')
      .eq('cache_key', cacheKey)
      .single();
    if (error || !data?.payload_json) {
      if (error && error.code !== 'PGRST116') {
        console.error('[nearby] DB cache read failed', { cacheKey, message: error.message });
      }
      return null;
    }

    return {
      payload: {
        ...data.payload_json,
        cached_at: data.payload_json.cached_at || data.updated_at || data.created_at
      },
      expiresAt: new Date(data.expires_at).getTime()
    };
  } catch (e) {
    console.error('[nearby] DB cache read crashed', { cacheKey, message: e.message });
    return null;
  }
}

async function writeDbSnapshot(cacheKey, grid, category, payload) {
  if (!supabase) return;
  try {
    await supabase.from('place_snapshots').upsert({
      cache_key: cacheKey,
      grid_key: grid,
      category,
      payload_json: payload,
      expires_at: new Date(Date.now() + TTL_MS).toISOString(),
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'cache_key'
    });
  } catch (e) {
    console.error('[nearby] DB cache write failed', { cacheKey, message: e.message });
  }
}

async function fetchOverpass(lat, lon) {
  const q = `[out:json][timeout:20];(node["amenity"~"restaurant|cafe|fast_food|bar|bakery|pub"](around:800,${lat},${lon});way["amenity"~"restaurant|cafe|fast_food|bar|bakery|pub"](around:800,${lat},${lon}););out center tags;`;
  const errors = [];

  for (const endpoint of OVERPASS_ENDPOINTS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OVERPASS_TIMEOUT_MS);

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'User-Agent': 'luunch.se/1.0 contact@luunch.se'
        },
        body: 'data=' + encodeURIComponent(q),
        signal: controller.signal
      });

      if (!res.ok) {
        throw new Error(`${endpoint} svarade med HTTP ${res.status}`);
      }

      const data = await res.json();
      return data.elements || [];
    } catch (e) {
      const message = e.name === 'AbortError'
        ? `${endpoint} timeout efter ${OVERPASS_TIMEOUT_MS}ms`
        : e.message;
      errors.push(message);
      console.error('[nearby] Overpass endpoint failed', {
        endpoint,
        message,
        lat,
        lon
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(`Overpass-fel: ${errors.join(' | ')}`);
}

async function getClaimedData(osmIds) {
  if (!supabase || osmIds.length === 0) return new Map();
  const claimed = new Map();
  const { today, dayIndex, currentTime } = swedenNowParts();

  try {
    const { data: restaurants } = await supabase
      .from('restaurants')
      .select('id, osm_id, phone, address, verified')
      .in('osm_id', osmIds);

    if (!restaurants?.length) return claimed;

    const restaurantIds = restaurants.map(r => r.id);
    const [hours, { data: menus }] = await Promise.all([
      fetchOpeningHours(restaurantIds, dayIndex),
      supabase
        .from('menus')
        .select('restaurant_id, description, price')
        .in('restaurant_id', restaurantIds)
        .eq('date', today)
    ]);

    const hoursByRestaurant = new Map((hours || []).map(h => [h.restaurant_id, h]));
    const menusByRestaurant = new Map();
    for (const dish of menus || []) {
      const dishes = menusByRestaurant.get(dish.restaurant_id) || [];
      dishes.push({ description: dish.description, price: dish.price });
      menusByRestaurant.set(dish.restaurant_id, dishes);
    }

    for (const restaurant of restaurants) {
      const todayHours = hoursByRestaurant.get(restaurant.id);
      const hoursStatus = getLuunchHoursStatus(todayHours, currentTime);
      const claimedRestaurant = {
        claimed: true,
        verified: restaurant.verified,
        phone: restaurant.phone,
        address: restaurant.address,
        has_luunch_hours: false,
        opening_hours_source: null,
        is_open_now: null,
        open_status: 'unknown',
        today_hours: null,
        today_opens: null,
        today_closes: null,
        dishes: menusByRestaurant.get(restaurant.id) || []
      };

      if (todayHours) {
        claimedRestaurant.has_luunch_hours = true;
        claimedRestaurant.opening_hours_source = 'luunch';
        claimedRestaurant.is_open_now = hoursStatus.is_open_now;
        claimedRestaurant.open_status = hoursStatus.open_status;
        claimedRestaurant.today_hours = hoursStatus.today_hours;
        claimedRestaurant.today_opens = todayHours?.lunch_opens || todayHours?.opens || null;
        claimedRestaurant.today_closes = todayHours?.lunch_closes || todayHours?.closes || null;
      }

      claimed.set(restaurant.osm_id, claimedRestaurant);
    }
  } catch (e) {
    return claimed;
  }

  return claimed;
}

function normalizeDedupeKey(restaurant) {
  return [
    restaurant.name,
    restaurant.address,
    restaurant.city
  ]
    .filter(Boolean)
    .join('|')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function getVerifiedManualRestaurants(lat, lon, category, radiusMeters) {
  if (!supabase) return [];
  const { today, dayIndex, currentTime } = swedenNowParts();

  try {
    const { data: restaurants, error } = await supabase
      .from('restaurants')
      .select('id, osm_id, source, source_id, name, phone, address, postal_code, city, category, type, lat, lon, verified, claimed, claimed_by_user_id')
      .eq('verified', true)
      .not('lat', 'is', null)
      .not('lon', 'is', null);

    if (error) {
      console.error('[nearby] Manual restaurants read failed', { message: error.message });
      return [];
    }

    if (!restaurants?.length) return [];

    const nearbyRestaurants = restaurants
      .map(restaurant => {
        const distance = Math.round(haversine(lat, lon, Number(restaurant.lat), Number(restaurant.lon)));
        return { ...restaurant, distance_m: distance };
      })
      .filter(restaurant => restaurant.distance_m <= radiusMeters);

    if (!nearbyRestaurants.length) return [];

    const restaurantIds = nearbyRestaurants.map(r => r.id);
    const [hours, { data: menus }] = await Promise.all([
      fetchOpeningHours(restaurantIds, dayIndex),
      supabase
        .from('menus')
        .select('restaurant_id, description, price')
        .in('restaurant_id', restaurantIds)
        .eq('date', today)
    ]);

    const hoursByRestaurant = new Map((hours || []).map(h => [h.restaurant_id, h]));
    const menusByRestaurant = new Map();
    for (const dish of menus || []) {
      const dishes = menusByRestaurant.get(dish.restaurant_id) || [];
      dishes.push({ description: dish.description, price: dish.price });
      menusByRestaurant.set(dish.restaurant_id, dishes);
    }

    return nearbyRestaurants
      .map(restaurant => {
        const todayHours = hoursByRestaurant.get(restaurant.id);
        const hoursStatus = getLuunchHoursStatus(todayHours, currentTime);
        const tags = {
          name: restaurant.name,
          cuisine: restaurant.category || restaurant.type,
          amenity: 'restaurant'
        };

        return {
          id: restaurant.osm_id || restaurant.source_id || restaurant.id,
          restaurant_id: restaurant.id,
          osm_id: restaurant.osm_id || restaurant.source_id || restaurant.id,
          source: restaurant.source || 'manual',
          priority: 0,
          name: restaurant.name,
          lat: Number(restaurant.lat),
          lon: Number(restaurant.lon),
          address: restaurant.address || '',
          postal_code: restaurant.postal_code || null,
          city: restaurant.city || null,
          category: restaurant.category || restaurant.type || 'Restaurang',
          type_label: restaurant.type || restaurant.category || 'Restaurang',
          emoji: getEmoji(tags),
          distance_m: restaurant.distance_m,
          opening_hours_raw: null,
          external_today_hours: null,
          external_is_open_now: null,
          external_open_status: 'unknown',
          has_luunch_hours: Boolean(todayHours),
          opening_hours_source: todayHours ? 'luunch' : null,
          today_hours: todayHours ? hoursStatus.today_hours : null,
          is_open_now: todayHours ? hoursStatus.is_open_now : null,
          open_status: todayHours ? hoursStatus.open_status : 'unknown',
          claimed: Boolean(restaurant.claimed || restaurant.claimed_by_user_id),
          verified: Boolean(restaurant.verified),
          phone: restaurant.phone || null,
          today_opens: todayHours?.lunch_opens || todayHours?.opens || null,
          today_closes: todayHours?.lunch_closes || todayHours?.closes || null,
          dishes: menusByRestaurant.get(restaurant.id) || [],
          tags
        };
      })
      .filter(restaurant => matchesCategory(restaurant, category));
  } catch (e) {
    console.error('[nearby] Manual restaurants crashed', { message: e.message, stack: e.stack });
    return [];
  }
}

function mergeVerifiedRestaurants(externalRestaurants, manualRestaurants) {
  const merged = [...externalRestaurants];

  for (const manualRestaurant of manualRestaurants) {
    const manualKey = normalizeDedupeKey(manualRestaurant);
    const existingIndex = merged.findIndex(restaurant => {
      return restaurant.osm_id === manualRestaurant.osm_id ||
        restaurant.restaurant_id === manualRestaurant.restaurant_id ||
        (manualKey && normalizeDedupeKey(restaurant) === manualKey);
    });

    if (existingIndex >= 0) {
      merged[existingIndex] = {
        ...merged[existingIndex],
        ...manualRestaurant
      };
    } else {
      merged.push(manualRestaurant);
    }
  }

  return merged;
}

function sortRestaurants(a, b) {
  const aClaimed = Boolean(a.claimed || a.verified || a.priority === 0);
  const bClaimed = Boolean(b.claimed || b.verified || b.priority === 0);

  if (aClaimed !== bClaimed) {
    return Number(bClaimed) - Number(aClaimed);
  }

  return a.distance_m - b.distance_m;
}

async function mergeManualRestaurantsIntoPayload(payload, lat, lon, category, radiusMeters) {
  const cachedExternalRestaurants = (payload.restaurants || [])
    .filter(restaurant => restaurant.source !== 'manual')
    .filter(restaurant => restaurant.distance_m <= radiusMeters)
    .filter(restaurant => matchesCategory(restaurant, category));
  const manualRestaurants = await getVerifiedManualRestaurants(lat, lon, category, radiusMeters);

  return {
    ...payload,
    restaurants: mergeVerifiedRestaurants(cachedExternalRestaurants, manualRestaurants)
      .sort(sortRestaurants)
      .slice(0, MAX_RESULTS)
  };
}

async function buildPayload(lat, lon, category, radiusMeters) {
  const elements = await fetchOverpass(lat, lon);
  const { currentTime } = swedenNowParts();
  const baseRestaurants = elements
    .filter(e => e.tags?.name)
    .map(e => {
      const itemLat = e.lat || e.center?.lat;
      const itemLon = e.lon || e.center?.lon;
      const tags = e.tags || {};
      const id = `${e.type}/${e.id}`;
      const openingStatus = getOsmOpeningStatus(tags.opening_hours, currentTime);
      return {
        id,
        osm_id: id,
        priority: 1,
        name: tags.name,
        lat: itemLat,
        lon: itemLon,
        address: getAddress(tags),
        category: tags.cuisine || tags.amenity || 'restaurant',
        type_label: getTypeLabel(tags),
        emoji: getEmoji(tags),
        distance_m: itemLat && itemLon ? Math.round(haversine(lat, lon, itemLat, itemLon)) : 999999,
        opening_hours_raw: tags.opening_hours || null,
        external_today_hours: openingStatus.today_hours,
        external_is_open_now: openingStatus.is_open_now,
        external_open_status: openingStatus.open_status,
        has_luunch_hours: false,
        opening_hours_source: null,
        today_hours: null,
        is_open_now: null,
        open_status: 'unknown',
        claimed: false,
        verified: false,
        today_opens: null,
        today_closes: null,
        dishes: [],
        tags
      };
    });

  const claimedData = await getClaimedData(baseRestaurants.map(r => r.osm_id));
  const externalRestaurants = baseRestaurants
    .map(restaurant => ({ ...restaurant, ...(claimedData.get(restaurant.osm_id) || {}) }))
    .filter(restaurant => restaurant.distance_m <= radiusMeters)
    .filter(restaurant => matchesCategory(restaurant, category));
  const manualRestaurants = await getVerifiedManualRestaurants(lat, lon, category, radiusMeters);
  const restaurants = mergeVerifiedRestaurants(externalRestaurants, manualRestaurants)
    .sort(sortRestaurants)
    .slice(0, MAX_RESULTS);

  return {
    restaurants,
    cached_at: new Date().toISOString(),
    source: 'fresh'
  };
}

export default async function handler(req, res) {
  try {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    if (!applyCors(req, res, 'GET, OPTIONS')) {
      return res.status(403).json({ ok: false, error: 'Origin not allowed' });
    }

    if (req.method === 'OPTIONS') {
      return res.status(200).json({ ok: true });
    }

    if (req.method !== 'GET') {
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    const rawLat = req.query?.lat;
    const rawLon = req.query?.lon;
    const rawCategory = req.query?.category;
    const rawRadius = req.query?.radius;
    const lat = Number(rawLat);
    const lon = Number(rawLon);
    const category = String(rawCategory || 'alla').toLowerCase();
    const radiusMeters = Number.isFinite(Number(rawRadius)) && Number(rawRadius) > 0
      ? Math.min(Number(rawRadius), 3000)
      : DEFAULT_RADIUS_METERS;

    if (rawLat === undefined || rawLat === '') {
      return res.status(400).json({ ok: false, error: 'Query-parametern lat saknas.' });
    }

    if (rawLon === undefined || rawLon === '') {
      return res.status(400).json({ ok: false, error: 'Query-parametern lon saknas.' });
    }

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return res.status(400).json({
        ok: false,
        error: 'lat och lon måste vara nummer.',
        received: { lat: rawLat, lon: rawLon }
      });
    }

    const grid = gridKey(lat, lon);
    const cacheKey = cacheKeyFor(grid, category, radiusMeters);
    const memoryHit = memoryCache.get(cacheKey);

    if (isFreshSnapshot(memoryHit)) {
      const payload = await mergeManualRestaurantsIntoPayload(memoryHit.payload, lat, lon, category, radiusMeters);
      return res.status(200).json({ ok: true, ...payload, source: 'cache' });
    }

    const dbHit = await readDbSnapshot(cacheKey);
    if (isFreshSnapshot(dbHit)) {
      memoryCache.set(cacheKey, dbHit);
      const payload = await mergeManualRestaurantsIntoPayload(dbHit.payload, lat, lon, category, radiusMeters);
      return res.status(200).json({ ok: true, ...payload, source: 'cache' });
    }

    try {
      const payload = await buildPayload(lat, lon, category, radiusMeters);
      const snapshot = { payload, expiresAt: Date.now() + TTL_MS };
      memoryCache.set(cacheKey, snapshot);
      await writeDbSnapshot(cacheKey, grid, category, payload);
      return res.status(200).json({ ok: true, ...payload, source: 'fresh' });
    } catch (e) {
      console.error('[nearby] Fresh fetch failed', {
        message: e.message,
        stack: e.stack,
        cacheKey,
        grid,
        category,
        radiusMeters
      });

      const staleHit = memoryHit || dbHit;
      if (staleHit?.payload?.restaurants) {
        const payload = await mergeManualRestaurantsIntoPayload(staleHit.payload, lat, lon, category, radiusMeters);
        return res.status(200).json({
          ok: true,
          ...payload,
          source: 'stale-cache',
          warning: 'Fresh data failed, showing cached results'
        });
      }

      return res.status(502).json({
        ok: false,
        error: 'Kunde inte hämta restauranger just nu'
      });
    }
  } catch (e) {
    console.error('[nearby] Handler error', {
      message: e.message,
      stack: e.stack,
      query: req.query,
      method: req.method,
      hasSupabaseUrl: Boolean(process.env.SUPABASE_URL),
      hasSupabaseServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      hasSupabaseServiceKey: Boolean(process.env.SUPABASE_SERVICE_KEY),
      hasSupabaseAnonKey: Boolean(process.env.SUPABASE_ANON_KEY)
    });

    return res.status(502).json({
      ok: false,
      error: 'Kunde inte hämta restauranger just nu'
    });
  }
}
