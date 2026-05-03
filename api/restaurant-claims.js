import { applyCors } from './_cors.js';
import { getSupabaseAdmin } from './admin/_admin.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ORG_RE = /^\d{6}-?\d{4}$/;

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function optional(value) {
  return clean(value) || null;
}

function getBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || null;
}

function isClaimed(restaurant) {
  return restaurant?.owner_user_id ||
    restaurant?.claimed === true ||
    restaurant?.status === 'claimed' ||
    restaurant?.status === 'verified';
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (!applyCors(req, res, 'POST, OPTIONS')) {
    return res.status(403).json({ ok: false, error: 'Origin not allowed' });
  }
  if (req.method === 'OPTIONS') return res.status(200).json({ ok: true });
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Endast POST stöds' });

  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) return res.status(500).json({ ok: false, error: 'Supabase är inte konfigurerat' });

    const token = getBearerToken(req);
    if (!token) {
      return res.status(401).json({ ok: false, error: 'Du måste vara inloggad för att göra anspråk på restaurang' });
    }

    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData?.user) {
      return res.status(401).json({ ok: false, error: 'Du måste vara inloggad för att göra anspråk på restaurang' });
    }

    const body = req.body || {};
    const payload = {
      restaurant_id: clean(body.restaurant_id),
      user_id: authData.user.id,
      contact_name: clean(body.contact_name),
      role: optional(body.role),
      phone: optional(body.phone),
      email: clean(body.email || authData.user.email).toLowerCase(),
      org_number: optional(body.org_number || body.organization_number),
      message: optional(body.message),
      status: 'pending'
    };

    if (!payload.restaurant_id) return res.status(400).json({ ok: false, error: 'restaurant_id krävs' });
    if (!payload.contact_name) return res.status(400).json({ ok: false, error: 'Kontaktperson krävs' });
    if (!EMAIL_RE.test(payload.email)) return res.status(400).json({ ok: false, error: 'E-postadressen är ogiltig' });
    if (payload.org_number && !ORG_RE.test(payload.org_number)) {
      return res.status(400).json({ ok: false, error: 'Organisationsnummer ska vara 556123-4567 eller 5561234567' });
    }

    const { data: restaurant, error: restaurantError } = await supabase
      .from('restaurants')
      .select('id, name, address, city, status, owner_user_id, claimed, verified')
      .eq('id', payload.restaurant_id)
      .maybeSingle();

    if (restaurantError) return res.status(500).json({ ok: false, error: restaurantError.message });
    if (!restaurant) return res.status(404).json({ ok: false, error: 'Restaurangen hittades inte' });
    if (isClaimed(restaurant)) {
      return res.status(409).json({
        ok: false,
        error: 'Den här restaurangen är redan kopplad till ett konto.'
      });
    }

    const { data: pending, error: pendingError } = await supabase
      .from('restaurant_claims')
      .select('id')
      .eq('restaurant_id', payload.restaurant_id)
      .eq('status', 'pending')
      .limit(1)
      .maybeSingle();

    if (pendingError && pendingError.code !== 'PGRST116') {
      return res.status(500).json({ ok: false, error: pendingError.message });
    }
    if (pending) {
      return res.status(409).json({
        ok: false,
        error: 'Restaurangen har redan en begäran som väntar på granskning.'
      });
    }

    const { data: claim, error: insertError } = await supabase
      .from('restaurant_claims')
      .insert(payload)
      .select()
      .single();

    if (insertError) {
      console.error('[restaurant claim] insert failed', {
        message: insertError.message,
        code: insertError.code,
        details: insertError.details,
        hint: insertError.hint
      });
      return res.status(500).json({ ok: false, error: insertError.message });
    }

    const { error: statusError } = await supabase
      .from('restaurants')
      .update({ status: 'pending_claim', updated_at: new Date().toISOString() })
      .eq('id', payload.restaurant_id);

    if (statusError) {
      console.error('[restaurant claim] restaurant status update failed', {
        message: statusError.message,
        code: statusError.code
      });
    }

    return res.status(201).json({
      ok: true,
      message: 'Din begäran är skickad',
      claim,
      restaurant
    });
  } catch (e) {
    console.error('[restaurant claim] handler error', { message: e.message, stack: e.stack });
    return res.status(500).json({ ok: false, error: e.message || 'Kunde inte skicka begäran' });
  }
}
