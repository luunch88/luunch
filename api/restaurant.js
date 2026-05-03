import { createClient } from '@supabase/supabase-js';
import { applyCors } from './_cors.js';

let supabase = null;
try {
  supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : null;
} catch (e) {
  console.error('[restaurant] Supabase init error', { message: e.message, stack: e.stack });
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
  if (closeMin < openMin) return currentTime >= openMin || currentTime < closeMin;
  return currentTime >= openMin && currentTime < closeMin;
}

function getHoursStatus(hours, currentTime) {
  if (!hours) return { today_hours: null, is_open_now: null, open_status: 'unknown' };
  const opens = hours.lunch_opens || hours.opens;
  const closes = hours.lunch_closes || hours.closes;
  const isOpen = isWithinTimeRange(opens, closes, currentTime);
  if (isOpen === null) return { today_hours: null, is_open_now: null, open_status: 'unknown' };
  return {
    today_hours: `${opens}-${closes}`,
    is_open_now: isOpen,
    open_status: isOpen ? 'open' : 'closed'
  };
}

async function fetchOpeningHours(restaurantId) {
  const withLunchColumns = await supabase
    .from('opening_hours')
    .select('day_of_week, opens, closes, lunch_opens, lunch_closes')
    .eq('restaurant_id', restaurantId)
    .order('day_of_week');

  if (!withLunchColumns.error) return withLunchColumns.data || [];

  console.warn('[restaurant] opening_hours lunch columns missing, using fallback', {
    message: withLunchColumns.error.message
  });

  const fallback = await supabase
    .from('opening_hours')
    .select('day_of_week, opens, closes')
    .eq('restaurant_id', restaurantId)
    .order('day_of_week');

  return fallback.data || [];
}

function normalizeId(value) {
  return String(value || '').replace(/^manual\//, '').trim();
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (!applyCors(req, res, 'GET, OPTIONS')) {
    return res.status(403).json({ ok: false, error: 'Origin not allowed' });
  }
  if (req.method === 'OPTIONS') return res.status(200).json({ ok: true });
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    if (!supabase) {
      return res.status(500).json({ ok: false, error: 'Supabase är inte konfigurerat' });
    }

    const rawId = req.query?.id || req.query?.osm_id;
    const id = normalizeId(rawId);
    if (!id) return res.status(400).json({ ok: false, error: 'id krävs' });

    let query = supabase.from('restaurants').select('*').limit(1);
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      query = query.eq('id', id);
    } else {
      query = query.eq('osm_id', rawId);
    }

    const { data: restaurant, error } = await query.maybeSingle();
    if (error) {
      console.error('[restaurant] lookup failed', {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
        id: rawId
      });
      return res.status(500).json({ ok: false, error: error.message });
    }

    if (!restaurant) return res.status(404).json({ ok: false, error: 'Restaurangen hittades inte' });

    const { today, dayIndex, currentTime } = swedenNowParts();
    const [openingHours, menusResult] = await Promise.all([
      fetchOpeningHours(restaurant.id),
      supabase
        .from('menus')
        .select('description, price')
        .eq('restaurant_id', restaurant.id)
        .order('created_at')
    ]);

    if (menusResult.error) {
      console.error('[restaurant] menu lookup failed', {
        message: menusResult.error.message,
        code: menusResult.error.code,
        details: menusResult.error.details,
        hint: menusResult.error.hint,
        id: restaurant.id
      });
    }

    const todayHours = openingHours.find(row => row.day_of_week === dayIndex);
    const hoursStatus = getHoursStatus(todayHours, currentTime);
    const hasLuunchHours = Boolean(todayHours && hoursStatus.open_status !== 'unknown');
    const dishes = (menusResult.data || []).map(dish => ({
      title: dish.description,
      description: dish.description,
      price: dish.price
    }));

    return res.status(200).json({
      ok: true,
      restaurant: {
        id: `manual/${restaurant.id}`,
        restaurant_id: restaurant.id,
        source: restaurant.source || 'manual',
        name: restaurant.name,
        lat: restaurant.lat === null || restaurant.lat === undefined ? null : Number(restaurant.lat),
        lon: restaurant.lon === null || restaurant.lon === undefined ? null : Number(restaurant.lon),
        address: restaurant.address || '',
        postal_code: restaurant.postal_code || null,
        city: restaurant.city || null,
        category: restaurant.category || 'restaurant',
        type_label: restaurant.category || 'Restaurang',
        claimed: Boolean(restaurant.claimed || restaurant.claimed_by_user_id),
        verified: Boolean(restaurant.verified),
        phone: restaurant.phone || null,
        dishes,
        has_luunch_hours: hasLuunchHours,
        opening_hours_source: hasLuunchHours ? 'luunch' : null,
        today_hours: hasLuunchHours ? hoursStatus.today_hours : null,
        today_opens: hasLuunchHours ? todayHours?.lunch_opens || todayHours?.opens || null : null,
        today_closes: hasLuunchHours ? todayHours?.lunch_closes || todayHours?.closes || null : null,
        is_open_now: hasLuunchHours ? hoursStatus.is_open_now : null,
        open_status: hasLuunchHours ? hoursStatus.open_status : 'unknown',
        week_hours: openingHours
      }
    });
  } catch (e) {
    console.error('[restaurant] handler error', { message: e.message, stack: e.stack, query: req.query });
    return res.status(500).json({ ok: false, error: e.message || 'Kunde inte hämta restaurang' });
  }
}
