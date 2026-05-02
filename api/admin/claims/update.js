import { applyCors } from '../../_cors.js';
import { cleanText, getSupabaseAdmin, requireAdminSecret } from '../_admin.js';

const VALID_STATUSES = new Set(['pending', 'approved', 'rejected']);

function optionalNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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

async function findExistingRestaurant(supabase, claim) {
  const { data, error } = await supabase
    .from('restaurants')
    .select('id')
    .eq('name', claim.restaurant_name)
    .eq('address', claim.address)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[admin claims] restaurant lookup failed', {
      message: error.message,
      details: error.details,
      hint: error.hint,
      claim_id: claim.id
    });
    throw new Error(error.message);
  }

  return data || null;
}

async function approveRestaurantClaim(supabase, claim, lat, lon) {
  const now = new Date().toISOString();
  const hasLocation = lat !== null && lon !== null;
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
    visible: hasLocation,
    updated_at: now
  };

  if (hasLocation) {
    restaurantPatch.lat = lat;
    restaurantPatch.lon = lon;
  }

  const existing = await findExistingRestaurant(supabase, claim);
  if (existing) {
    const { data, error } = await supabase
      .from('restaurants')
      .update(restaurantPatch)
      .eq('id', existing.id)
      .select('id, name, visible')
      .single();

    if (error) {
      console.error('[admin claims] restaurant approve update failed', {
        message: error.message,
        details: error.details,
        hint: error.hint,
        claim_id: claim.id,
        restaurant_id: existing.id
      });
      throw new Error(error.message);
    }

    return data;
  }

  const sourceId = `manual/${claim.id}`;
  const insertPayload = {
    ...restaurantPatch,
    source_id: sourceId,
    osm_id: sourceId,
    slug: slugify(`${claim.restaurant_name}-${claim.city || ''}`),
    lat: hasLocation ? lat : null,
    lon: hasLocation ? lon : null,
    created_at: now
  };

  const { data, error } = await supabase
    .from('restaurants')
    .insert(insertPayload)
    .select('id, name, visible')
    .single();

  if (error) {
    console.error('[admin claims] restaurant approve insert failed', {
      message: error.message,
      details: error.details,
      hint: error.hint,
      claim_id: claim.id,
      insertPayload
    });
    throw new Error(error.message);
  }

  return data;
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
    const lat = optionalNumber(req.body?.lat);
    const lon = optionalNumber(req.body?.lon);

    if (!id) return res.status(400).json({ ok: false, error: 'id krävs' });
    if (!VALID_STATUSES.has(status)) {
      return res.status(400).json({ ok: false, error: 'Ogiltig status' });
    }

    let restaurant = null;
    let message = 'Ansökan uppdaterad';

    if (status === 'approved') {
      const { data: claim, error: claimError } = await supabase
        .from('claims')
        .select('id, user_id, restaurant_name, address, postal_code, city, restaurant_type, email, status')
        .eq('id', id)
        .single();

      if (claimError || !claim) {
        console.error('[admin claims] claim lookup before approve failed', {
          message: claimError?.message,
          details: claimError?.details,
          hint: claimError?.hint,
          id
        });
        return res.status(404).json({ ok: false, error: 'Ansökan hittades inte' });
      }

      restaurant = await approveRestaurantClaim(supabase, claim, lat, lon);
      message = restaurant.visible
        ? 'Restaurang godkänd och kopplad'
        : 'Restaurangen är godkänd men visas inte förrän plats är angiven.';
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
        message: error.message,
        details: error.details,
        hint: error.hint,
        id,
        status
      });
      return res.status(500).json({ ok: false, error: 'Kunde inte uppdatera ansökan' });
    }

    return res.status(200).json({ ok: true, message, claim: data, restaurant });
  } catch (e) {
    console.error('[admin claims] update handler error', { message: e.message, stack: e.stack });
    return res.status(500).json({ ok: false, error: 'Kunde inte uppdatera ansökan' });
  }
}
