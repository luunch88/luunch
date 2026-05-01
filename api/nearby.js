import { createClient } from '@supabase/supabase-js';
import { applyCors } from './_cors.js';

const TTL_MS = 6 * 60 * 60 * 1000;
const GRID_SIZE = 0.005;
const MAX_RESULTS = 30;
const CACHE_VERSION = 3;
const OVERPASS_TIMEOUT_MS = 8000;
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
];

const memoryCache = globalThis.__luunchNearbyCache || new Map();
globalThis.__luunchNearbyCache = memoryCache;

let supabase = null;
try {
  supabase = process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)
    : null;
} catch (e) {
  console.error('[nearby] Supabase init error', {
    message: e.message,
    stack: e.stack,
    hasSupabaseUrl: Boolean(process.env.SUPABASE_URL),
    hasSupabaseAnonKey: Boolean(process.env.SUPABASE_ANON_KEY)
  });
}

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  console.warn('[nearby] Supabase env saknas. Kör utan DB-merge och persistent cache.', {
    hasSupabaseUrl: Boolean(process.env.SUPABASE_URL),
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

async function readDbSnapshot(cacheKey) {
  if (!supabase) return null;
  const now = new Date().toISOString();
  try {
    const { data, error } = await supabase
      .from('place_snapshots')
      .select('payload, cached_at, expires_at')
      .eq('cache_key', cacheKey)
      .gt('expires_at', now)
      .single();
    if (error || !data?.payload) return null;
    return { ...data.payload, cached_at: data.cached_at, source: 'cache' };
  } catch (e) {
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
      payload,
      cached_at: payload.cached_at,
      expires_at: new Date(Date.now() + TTL_MS).toISOString(),
      version: CACHE_VERSION
    });
  } catch (e) {
    // Optional DB cache. In-memory cache still keeps the endpoint working.
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

async function buildPayload(lat, lon, category) {
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
  const restaurants = baseRestaurants
    .map(restaurant => ({ ...restaurant, ...(claimedData.get(restaurant.osm_id) || {}) }))
    .filter(restaurant => matchesCategory(restaurant, category))
    .sort((a, b) => a.distance_m - b.distance_m)
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
    const lat = Number(rawLat);
    const lon = Number(rawLon);
    const category = String(rawCategory || 'alla').toLowerCase();

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
    const cacheKey = `${CACHE_VERSION}:${grid}:${category}`;
    const memoryHit = memoryCache.get(cacheKey);

    if (memoryHit && memoryHit.expiresAt > Date.now()) {
      return res.status(200).json({ ok: true, ...memoryHit.payload, source: 'cache' });
    }

    const dbHit = await readDbSnapshot(cacheKey);
    if (dbHit) {
      memoryCache.set(cacheKey, { payload: dbHit, expiresAt: Date.now() + TTL_MS });
      return res.status(200).json({ ok: true, ...dbHit, source: 'cache' });
    }

    const payload = await buildPayload(lat, lon, category);
    memoryCache.set(cacheKey, { payload, expiresAt: Date.now() + TTL_MS });
    await writeDbSnapshot(cacheKey, grid, category, payload);
    return res.status(200).json({ ok: true, ...payload });
  } catch (e) {
    console.error('[nearby] Handler error', {
      message: e.message,
      stack: e.stack,
      query: req.query,
      method: req.method,
      hasSupabaseUrl: Boolean(process.env.SUPABASE_URL),
      hasSupabaseAnonKey: Boolean(process.env.SUPABASE_ANON_KEY)
    });

    return res.status(200).json({
      ok: false,
      error: e.message || 'Kunde inte hämta restauranger just nu.'
    });
  }
}
