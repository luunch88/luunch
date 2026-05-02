import { createClient } from '@supabase/supabase-js';
import { applyCors } from './_cors.js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null;

const ALLOWED_STATUSES = new Set(['pending', 'approved', 'rejected']);
const CLAIM_COLUMNS = [
  'user_id',
  'restaurant_name',
  'address',
  'postal_code',
  'city',
  'restaurant_type',
  'contact_person',
  'email',
  'phone',
  'website',
  'organization_number',
  'message',
  'status'
];
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

function getBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || null;
}

function validatePayload(payload) {
  const required = [
    ['restaurant_name', 'Restaurangnamn krÃ¤vs'],
    ['address', 'Adress krÃ¤vs'],
    ['postal_code', 'Postnummer krÃ¤vs'],
    ['city', 'Ort krÃ¤vs'],
    ['restaurant_type', 'Typ av restaurang krÃ¤vs'],
    ['contact_person', 'Kontaktperson krÃ¤vs'],
    ['email', 'E-post krÃ¤vs']
  ];

  for (const [field, message] of required) {
    if (!payload[field]) return message;
  }

  if (!POSTAL_CODE_RE.test(payload.postal_code)) {
    return 'Postnummer ska vara 12345 eller 123 45';
  }

  if (!EMAIL_RE.test(payload.email)) {
    return 'E-postadressen Ã¤r ogiltig';
  }

  if (payload.organization_number && !ORGANIZATION_NUMBER_RE.test(payload.organization_number)) {
    return 'Organisationsnummer ska vara 556123-4567 eller 5561234567';
  }

  return null;
}

async function assertClaimsSchema() {
  const { error } = await supabase
    .from('claims')
    .select(CLAIM_COLUMNS.join(','))
    .limit(1);

  if (error) {
    console.error('[claim] claims schema/table check failed', {
      message: error.message,
      details: error.details,
      hint: error.hint,
      code: error.code,
      expectedColumns: CLAIM_COLUMNS
    });
    return error;
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
    return res.status(405).json({ ok: false, error: 'Endast POST stÃ¶ds' });
  }

  try {
    if (!supabase) {
      console.error('[claim] Missing Supabase env', {
        hasSupabaseUrl: Boolean(supabaseUrl),
        hasServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)
      });
      return res.status(500).json({
        ok: false,
        error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'
      });
    }

    const body = req.body || {};
    let authenticatedUserId = null;
    const token = getBearerToken(req);
    if (token) {
      const { data: authData, error: authError } = await supabase.auth.getUser(token);
      if (authError) {
        console.error('[claim] Could not verify optional user token', {
          message: authError.message
        });
      } else {
        authenticatedUserId = authData?.user?.id || null;
      }
    }

    const payload = {
      user_id: authenticatedUserId || optionalText(body.user_id),
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

    const schemaError = await assertClaimsSchema();
    if (schemaError) {
      return res.status(500).json({
        ok: false,
        error: schemaError.message,
        details: schemaError
      });
    }

    const { error } = await supabase
      .from('claims')
      .insert(payload);

    if (error) {
      console.error('[claim] Supabase insert failed', {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
        payload
      });
      return res.status(500).json({
        ok: false,
        error: error.message,
        details: error
      });
    }

    return res.status(201).json({
      ok: true,
      message: 'AnsÃ¶kan mottagen'
    });
  } catch (err) {
    console.error('[claim] Handler error', {
      message: err.message,
      stack: err.stack
    });
    return res.status(500).json({
      ok: false,
      error: err.message || 'Server error'
    });
  }
}

