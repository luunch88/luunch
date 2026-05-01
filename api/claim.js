import { createClient } from '@supabase/supabase-js';
import { applyCors } from './_cors.js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const supabase = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null;

const ALLOWED_STATUSES = new Set(['pending', 'approved', 'rejected']);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const POSTAL_CODE_RE = /^\d{3}\s?\d{2}$/;
const ORGANIZATION_NUMBER_RE = /^\d{6}-?\d{4}$/;

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalText(value) {
  const cleaned = cleanText(value);
  return cleaned || null;
}

function validatePayload(payload) {
  const required = [
    ['restaurant_name', 'Restaurangnamn krävs'],
    ['address', 'Adress krävs'],
    ['postal_code', 'Postnummer krävs'],
    ['city', 'Ort krävs'],
    ['restaurant_type', 'Typ av restaurang krävs'],
    ['contact_person', 'Kontaktperson krävs'],
    ['email', 'E-post krävs']
  ];

  for (const [field, message] of required) {
    if (!payload[field]) return message;
  }

  if (!POSTAL_CODE_RE.test(payload.postal_code)) {
    return 'Postnummer ska vara 12345 eller 123 45';
  }

  if (!EMAIL_RE.test(payload.email)) {
    return 'E-postadressen är ogiltig';
  }

  if (payload.organization_number && !ORGANIZATION_NUMBER_RE.test(payload.organization_number)) {
    return 'Organisationsnummer ska vara 556123-4567 eller 5561234567';
  }

  return null;
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (!applyCors(req, res, 'POST, OPTIONS')) {
    return res.status(403).json({ ok: false, error: 'Origin not allowed' });
  }
  if (req.method === 'OPTIONS') return res.status(200).json({ ok: true });
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Endast POST stöds' });
  }

  try {
    if (!supabase) {
      console.error('[claim] Missing Supabase env', {
        hasSupabaseUrl: Boolean(supabaseUrl),
        hasServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
        hasLegacyServiceKey: Boolean(process.env.SUPABASE_SERVICE_KEY)
      });
      return res.status(500).json({
        ok: false,
        error: 'Supabase är inte konfigurerat för ansökningar'
      });
    }

    const body = req.body || {};
    const payload = {
      restaurant_name: cleanText(body.restaurant_name),
      address: cleanText(body.address),
      postal_code: cleanText(body.postal_code),
      city: cleanText(body.city),
      restaurant_type: cleanText(body.restaurant_type || body.type),
      contact_person: cleanText(body.contact_person),
      email: cleanText(body.email).toLowerCase(),
      phone: optionalText(body.phone),
      website: optionalText(body.website),
      organization_number: optionalText(body.organization_number),
      message: optionalText(body.message),
      status: 'pending'
    };

    const validationError = validatePayload(payload);
    if (validationError) {
      return res.status(400).json({ ok: false, error: validationError });
    }

    if (!ALLOWED_STATUSES.has(payload.status)) {
      return res.status(400).json({ ok: false, error: 'Ogiltig status' });
    }

    const { error } = await supabase
      .from('claims')
      .insert(payload);

    if (error) {
      console.error('[claim] Supabase insert failed', {
        message: error.message,
        details: error.details,
        hint: error.hint
      });
      return res.status(500).json({
        ok: false,
        error: 'Kunde inte spara ansökan'
      });
    }

    return res.status(201).json({
      ok: true,
      message: 'Ansökan mottagen'
    });
  } catch (e) {
    console.error('[claim] Handler error', {
      message: e.message,
      stack: e.stack
    });
    return res.status(500).json({
      ok: false,
      error: 'Kunde inte spara ansökan'
    });
  }
}
