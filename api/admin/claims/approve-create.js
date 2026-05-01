import { applyCors } from '../../_cors.js';
import { getSupabaseAdmin, requireAdmin, slugify } from '../_admin.js';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (!applyCors(req, res, 'POST, OPTIONS')) {
    return res.status(403).json({ ok: false, error: 'Origin not allowed' });
  }
  if (req.method === 'OPTIONS') return res.status(200).json({ ok: true });
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) return res.status(500).json({ ok: false, error: 'Admin API är inte konfigurerat' });

    const admin = await requireAdmin(req, supabase);
    if (!admin.ok) return res.status(admin.status).json({ ok: false, error: admin.error });

    const { claim_id, lat, lon } = req.body || {};
    const numericLat = Number(lat);
    const numericLon = Number(lon);

    if (!claim_id) return res.status(400).json({ ok: false, error: 'claim_id krävs' });
    if (!Number.isFinite(numericLat) || !Number.isFinite(numericLon)) {
      return res.status(400).json({ ok: false, error: 'lat och lon krävs för manuell restaurang' });
    }

    const { data: claim, error: claimError } = await supabase
      .from('claims')
      .select('*')
      .eq('id', claim_id)
      .single();

    if (claimError || !claim) return res.status(404).json({ ok: false, error: 'Ansökan hittades inte' });
    if (claim.status !== 'pending') return res.status(409).json({ ok: false, error: 'Ansökan är redan granskad' });
    if (!claim.user_id) return res.status(400).json({ ok: false, error: 'Ansökan saknar user_id' });

    const now = new Date().toISOString();
    const sourceId = `manual/${claim.id}`;
    const { data: restaurant, error: restaurantError } = await supabase
      .from('restaurants')
      .insert({
        source: 'manual',
        source_id: sourceId,
        osm_id: sourceId,
        name: claim.restaurant_name,
        slug: slugify(`${claim.restaurant_name}-${claim.city || ''}`),
        address: claim.address,
        postal_code: claim.postal_code,
        city: claim.city,
        category: claim.type,
        type: claim.type,
        lat: numericLat,
        lon: numericLon,
        claimed: true,
        verified: true,
        claimed_by_user_id: claim.user_id,
        claim_email: claim.email,
        claimed_at: now,
        created_at: now,
        updated_at: now
      })
      .select('id, name')
      .single();

    if (restaurantError || !restaurant) {
      console.error('[admin claims] manual restaurant insert failed', {
        message: restaurantError?.message,
        claim_id
      });
      return res.status(500).json({ ok: false, error: 'Kunde inte skapa manuell restaurang' });
    }

    const { data: updatedClaim, error: updateClaimError } = await supabase
      .from('claims')
      .update({
        restaurant_id: restaurant.id,
        status: 'approved',
        reviewed_at: now,
        reviewed_by: admin.user?.id || null
      })
      .eq('id', claim_id)
      .select()
      .single();

    if (updateClaimError) {
      console.error('[admin claims] manual approve claim update failed', {
        message: updateClaimError.message,
        claim_id
      });
      return res.status(500).json({ ok: false, error: 'Restaurangen skapades men ansökan kunde inte uppdateras' });
    }

    return res.status(200).json({
      ok: true,
      message: 'Manuell restaurang skapad och ansökan godkänd',
      claim: updatedClaim,
      restaurant
    });
  } catch (e) {
    console.error('[admin claims] approve-create handler error', { message: e.message, stack: e.stack });
    return res.status(500).json({ ok: false, error: 'Kunde inte skapa och godkänna restaurang' });
  }
}
