import { createClient } from '@supabase/supabase-js';
import { applyCors } from './_cors.js';

let supabase = null;
try {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );
  }
} catch (e) {
  console.error('[claim] Supabase init error', { message: e.message });
}

function getBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || null;
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (!applyCors(req, res, 'POST, OPTIONS')) {
    return res.status(403).json({ ok: false, error: 'Origin not allowed' });
  }
  if (req.method === 'OPTIONS') return res.status(200).json({ ok: true });
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    if (!supabase) {
      console.error('[claim] Missing Supabase service env', {
        hasSupabaseUrl: Boolean(process.env.SUPABASE_URL),
        hasSupabaseServiceKey: Boolean(process.env.SUPABASE_SERVICE_KEY)
      });
      return res.status(500).json({ ok: false, error: 'Claim API är inte konfigurerat' });
    }

    const token = getBearerToken(req);
    if (!token) {
      return res.status(401).json({
        ok: false,
        error: 'Du måste vara inloggad för att claima restaurang'
      });
    }

    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    const user = authData?.user;
    if (authError || !user) {
      return res.status(401).json({
        ok: false,
        error: 'Du måste vara inloggad för att claima restaurang'
      });
    }

    const {
      restaurant_id,
      restaurant_name,
      address = null,
      lat = null,
      lon = null
    } = req.body || {};

    if (!restaurant_id) {
      return res.status(400).json({ ok: false, error: 'restaurant_id krävs' });
    }

    const { data: existing, error: existingError } = await supabase
      .from('restaurants')
      .select('id, osm_id, name, address, lat, lon, verified, claimed_by_user_id, claim_email')
      .eq('osm_id', restaurant_id)
      .maybeSingle();

    if (existingError) {
      console.error('[claim] Failed to read restaurant', {
        message: existingError.message,
        restaurant_id
      });
      return res.status(500).json({ ok: false, error: 'Kunde inte kontrollera restaurangen' });
    }

    if (existing?.claimed_by_user_id && existing.claimed_by_user_id !== user.id) {
      return res.status(409).json({
        ok: false,
        error: 'Den här restaurangen är redan claimad. Kontakta support om detta är fel.'
      });
    }

    if (existing?.claimed_by_user_id === user.id) {
      return res.status(200).json({
        ok: true,
        message: 'Restaurangen är claimad',
        restaurant: existing
      });
    }

    const claimFields = {
      osm_id: restaurant_id,
      name: restaurant_name || existing?.name || 'Restaurang',
      address: address || existing?.address || null,
      lat: Number.isFinite(Number(lat)) ? Number(lat) : null,
      lon: Number.isFinite(Number(lon)) ? Number(lon) : null,
      claimed: true,
      claimed_by_user_id: user.id,
      claim_email: user.email,
      email: user.email,
      claimed_at: new Date().toISOString(),
      verified: existing?.verified || false
    };

    const query = existing
      ? supabase.from('restaurants').update(claimFields).eq('id', existing.id)
      : supabase.from('restaurants').insert(claimFields);

    const { data: restaurant, error: claimError } = await query.select().single();

    if (claimError) {
      console.error('[claim] Failed to claim restaurant', {
        message: claimError.message,
        restaurant_id,
        user_id: user.id
      });
      return res.status(500).json({ ok: false, error: 'Kunde inte claima restaurangen' });
    }

    return res.status(200).json({
      ok: true,
      message: 'Restaurangen är claimad',
      restaurant
    });
  } catch (e) {
    console.error('[claim] Handler error', {
      message: e.message,
      stack: e.stack
    });
    return res.status(500).json({ ok: false, error: 'Kunde inte claima restaurangen' });
  }
}
