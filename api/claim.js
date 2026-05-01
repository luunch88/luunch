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
        error: 'Du måste vara inloggad för att ansöka om restaurang'
      });
    }

    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    const user = authData?.user;
    if (authError || !user) {
      return res.status(401).json({
        ok: false,
        error: 'Du måste vara inloggad för att ansöka om restaurang'
      });
    }

    const {
      restaurant_id = null,
      restaurant_name,
      address = null,
      phone = null,
      website = null,
      message = null
    } = req.body || {};

    if (!restaurant_name) {
      return res.status(400).json({ ok: false, error: 'restaurant_name krävs' });
    }

    if (restaurant_id) {
      const { data: existing, error: existingError } = await supabase
        .from('restaurants')
        .select('id, osm_id, claimed_by_user_id')
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
    }

    const { data: pendingClaim, error: pendingError } = await supabase
      .from('claims')
      .select('id, status, restaurant_name')
      .eq('user_id', user.id)
      .eq('status', 'pending')
      .maybeSingle();

    if (pendingError) {
      console.error('[claim] Failed to read pending claim', {
        message: pendingError.message,
        user_id: user.id
      });
      return res.status(500).json({ ok: false, error: 'Kunde inte kontrollera ansökan' });
    }

    if (pendingClaim) {
      return res.status(409).json({
        ok: false,
        error: 'Du har redan en ansökan som väntar på granskning.'
      });
    }

    const { data: claim, error: insertError } = await supabase
      .from('claims')
      .insert({
        user_id: user.id,
        email: user.email,
        restaurant_id,
        restaurant_name,
        address,
        phone,
        website,
        message,
        status: 'pending'
      })
      .select()
      .single();

    if (insertError) {
      console.error('[claim] Failed to create claim request', {
        message: insertError.message,
        user_id: user.id,
        restaurant_name
      });
      return res.status(500).json({ ok: false, error: 'Kunde inte skicka ansökan' });
    }

    return res.status(201).json({
      ok: true,
      message: 'Tack! Din ansökan är skickad. Vi granskar den manuellt och återkommer.',
      claim
    });
  } catch (e) {
    console.error('[claim] Handler error', {
      message: e.message,
      stack: e.stack
    });
    return res.status(500).json({ ok: false, error: 'Kunde inte skicka ansökan' });
  }
}
