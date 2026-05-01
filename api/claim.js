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

const ALLOWED_TYPES = new Set([
  'Pizza',
  'Sushi',
  'Burgare',
  'Asiatiskt',
  'Thai',
  'Indiskt',
  'Vegetariskt',
  'CafÃ©',
  'Annat'
]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const POSTAL_CODE_RE = /^\d{3}\s?\d{2}$/;
const ORGANIZATION_NUMBER_RE = /^\d{6}-?\d{4}$/;

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
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
      return res.status(500).json({ ok: false, error: 'Claim API Ã¤r inte konfigurerat' });
    }

    const token = getBearerToken(req);
    if (!token) {
      return res.status(401).json({
        ok: false,
        error: 'Du mÃ¥ste vara inloggad fÃ¶r att ansÃ¶ka om restaurang'
      });
    }

    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    const user = authData?.user;
    if (authError || !user) {
      return res.status(401).json({
        ok: false,
        error: 'Du mÃ¥ste vara inloggad fÃ¶r att ansÃ¶ka om restaurang'
      });
    }

    const {
      restaurant_id = null,
      restaurant_name,
      address = null,
      postal_code = null,
      city = null,
      type = null,
      contact_person = null,
      email = null,
      phone = null,
      organization_number = null,
      website = null,
      message = null
    } = req.body || {};

    const payload = {
      restaurant_id: cleanText(restaurant_id) || null,
      restaurant_name: cleanText(restaurant_name),
      address: cleanText(address),
      postal_code: cleanText(postal_code),
      city: cleanText(city),
      type: cleanText(type),
      contact_person: cleanText(contact_person),
      email: cleanText(email) || user.email,
      phone: cleanText(phone) || null,
      organization_number: cleanText(organization_number) || null,
      website: cleanText(website) || null,
      message: cleanText(message) || null
    };

    if (!payload.restaurant_name) {
      return res.status(400).json({ ok: false, error: 'restaurant_name krävs' });
    }
    if (!payload.address) {
      return res.status(400).json({ ok: false, error: 'address krävs' });
    }
    if (!POSTAL_CODE_RE.test(payload.postal_code)) {
      return res.status(400).json({ ok: false, error: 'postal_code har ogiltigt format' });
    }
    if (!payload.city) {
      return res.status(400).json({ ok: false, error: 'city krävs' });
    }
    if (!ALLOWED_TYPES.has(payload.type)) {
      return res.status(400).json({ ok: false, error: 'type krävs' });
    }
    if (!payload.contact_person) {
      return res.status(400).json({ ok: false, error: 'contact_person krävs' });
    }
    if (!EMAIL_RE.test(payload.email)) {
      return res.status(400).json({ ok: false, error: 'email har ogiltigt format' });
    }
    if (payload.organization_number && !ORGANIZATION_NUMBER_RE.test(payload.organization_number)) {
      return res.status(400).json({ ok: false, error: 'organization_number har ogiltigt format' });
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
      return res.status(500).json({ ok: false, error: 'Kunde inte kontrollera ansÃ¶kan' });
    }

    if (pendingClaim) {
      return res.status(409).json({
        ok: false,
        error: 'Du har redan en ansÃ¶kan som vÃ¤ntar pÃ¥ granskning.'
      });
    }

    const { data: claim, error: insertError } = await supabase
      .from('claims')
      .insert({
        user_id: user.id,
        email: payload.email,
        restaurant_id: payload.restaurant_id,
        restaurant_name: payload.restaurant_name,
        address: payload.address,
        postal_code: payload.postal_code,
        city: payload.city,
        type: payload.type,
        contact_person: payload.contact_person,
        phone: payload.phone,
        organization_number: payload.organization_number,
        website: payload.website,
        message: payload.message,
        status: 'pending'
      })
      .select()
      .single();

    if (insertError) {
      console.error('[claim] Failed to create claim request', {
        message: insertError.message,
        user_id: user.id,
        restaurant_name: payload.restaurant_name
      });
      return res.status(500).json({ ok: false, error: 'Kunde inte skicka ansÃ¶kan' });
    }

    return res.status(201).json({
      ok: true,
      message: 'Tack! Din ansökan är skickad. Vi granskar den manuellt. Vi kontaktar dig via e-post.',
      claim
    });
  } catch (e) {
    console.error('[claim] Handler error', {
      message: e.message,
      stack: e.stack
    });
    return res.status(500).json({ ok: false, error: 'Kunde inte skicka ansÃ¶kan' });
  }
}

