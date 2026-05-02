import { applyCors } from '../../_cors.js';
import { cleanText, getSupabaseAdmin, requireAdminSecret } from '../_admin.js';

const VALID_STATUSES = new Set(['pending', 'approved', 'rejected']);

function optionalNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function hasValidLocation(lat, lon) {
  return lat !== null &&
    lon !== null &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180;
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'restaurang';
}

function supabaseErrorPayload(error) {
  return {
    error: error?.message || 'Supabase error',
    code: error?.code || null,
    details: error?.details || null,
    hint: error?.hint || null
  };
}

function throwSupabaseError(label, error, meta = {}) {
  console.error(label, {
    ...supabaseErrorPayload(error),
    ...meta
  });

  const wrapped = new Error(error?.message || 'Supabase error');
  wrapped.supabaseError = error;
  wrapped.status = 500;
  throw wrapped;
}

function getMissingSchemaColumn(error) {
  const text = [error?.message, error?.details, error?.hint].filter(Boolean).join(' ');
  return text.match(/'([^']+)' column/)?.[1] || null;
}

async function writeRestaurantWithSchemaFallback(supabase, mode, payload, existingId = null) {
  let nextPayload = { ...payload };
  const strippedColumns = [];

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const query = mode === 'update'
      ? supabase.from('restaurants').update(nextPayload).eq('id', existingId)
      : supabase.from('restaurants').insert(nextPayload);
    const { data, error } = await query.select('id, name').single();

    if (!error) {
      if (strippedColumns.length) {
        console.warn('[admin claims] restaurant write succeeded after stripping missing schema columns', {
          mode,
          strippedColumns
        });
      }
      return data;
    }

    const missingColumn = getMissingSchemaColumn(error);
    if (error.code !== 'PGRST204' || !missingColumn || !(missingColumn in nextPayload)) {
      throwSupabaseError(`[admin claims] restaurant approve ${mode} failed`, error, {
        existingId,
        payload: nextPayload,
        strippedColumns
      });
    }

    strippedColumns.push(missingColumn);
    delete nextPayload[missingColumn];
    console.warn('[admin claims] retrying restaurant write without missing schema column', {
      mode,
      missingColumn,
      strippedColumns
    });
  }

  throw new Error('Kunde inte skriva restaurang efter schema-fallback.');
}

async function findExistingRestaurant(supabase, claim) {
  const { data, error } = await supabase
    .from('restaurants')
    .select('id')
    .eq('name', claim.restaurant_name)
    .eq('address', claim.address)
    .limit(1)
    .maybeSingle();

  if (error) {
    throwSupabaseError('[admin claims] restaurant lookup failed', error, {
      claim_id: claim.id
    });
  }

  return data || null;
}

async function approveRestaurantClaim(supabase, claim, lat, lon) {
  const now = new Date().toISOString();
  const restaurantPatch = {
    name: claim.restaurant_name,
    address: claim.address,
    postal_code: claim.postal_code,
    city: claim.city,
    category: claim.restaurant_type,
    type: claim.restaurant_type,
    source: 'manual',
    claimed: true,
    verified: true,
    claimed_by_user_id: claim.user_id || null,
    claim_email: claim.email,
    claimed_at: now,
    lat,
    lon,
    visible: true,
    updated_at: now
  };

  const existing = await findExistingRestaurant(supabase, claim);
  if (existing) {
    return writeRestaurantWithSchemaFallback(supabase, 'update', restaurantPatch, existing.id);
  }

  const sourceId = `manual/${claim.id}`;
  const insertPayload = {
    ...restaurantPatch,
    source_id: sourceId,
    osm_id: sourceId,
    slug: slugify(`${claim.restaurant_name}-${claim.city || ''}`),
    created_at: now
  };

  return writeRestaurantWithSchemaFallback(supabase, 'insert', insertPayload);
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
    const admin = requireAdminSecret(req);
    if (!admin.ok) return res.status(admin.status).json({ ok: false, error: admin.error });

    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return res.status(500).json({ ok: false, error: 'Supabase är inte konfigurerat' });
    }

    const id = cleanText(req.body?.id);
    const status = cleanText(req.body?.status);
    const adminNote = cleanText(req.body?.admin_note);
    const lat = optionalNumber(req.body?.lat ?? req.body?.latitude);
    const lon = optionalNumber(req.body?.lon ?? req.body?.longitude);

    if (!id) return res.status(400).json({ ok: false, error: 'id krävs' });
    if (!VALID_STATUSES.has(status)) {
      return res.status(400).json({ ok: false, error: 'Ogiltig status' });
    }

    let restaurant = null;
    let message = 'Ansökan uppdaterad';

    if (status === 'approved') {
      if (!hasValidLocation(lat, lon)) {
        return res.status(400).json({
          ok: false,
          error: 'Latitude och longitude krävs för att godkänna restaurangen'
        });
      }

      const { data: claim, error: claimError } = await supabase
        .from('claims')
        .select('id, user_id, restaurant_name, address, postal_code, city, restaurant_type, email, status')
        .eq('id', id)
        .maybeSingle();

      if (claimError) {
        return res.status(500).json({
          ok: false,
          ...supabaseErrorPayload(claimError)
        });
      }

      if (!claim) {
        return res.status(404).json({ ok: false, error: 'Ansökan hittades inte' });
      }

      if (!claim.user_id) {
        return res.status(400).json({
          ok: false,
          error: 'Ansökan saknar user_id. Be användaren skicka ansökan igen.'
        });
      }

      restaurant = await approveRestaurantClaim(supabase, claim, lat, lon);
      message = 'Restaurang skapad och kopplad';
    }

    const update = {
      status,
      admin_note: adminNote || null,
      reviewed_at: status === 'pending' ? null : new Date().toISOString(),
      reviewed_by: status === 'pending' ? null : 'admin'
    };

    const { data, error } = await supabase
      .from('claims')
      .update(update)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('[admin claims] update failed', {
        ...supabaseErrorPayload(error),
        id,
        status
      });
      return res.status(500).json({
        ok: false,
        ...supabaseErrorPayload(error)
      });
    }

    return res.status(200).json({ ok: true, message, claim: data, restaurant });
  } catch (e) {
    console.error('[admin claims] update handler error', { message: e.message, stack: e.stack });
    if (e.supabaseError) {
      return res.status(e.status || 500).json({
        ok: false,
        ...supabaseErrorPayload(e.supabaseError)
      });
    }

    return res.status(500).json({
      ok: false,
      error: e.message || 'Kunde inte uppdatera ansökan'
    });
  }
}

