import { applyCors } from '../../_cors.js';
import { getSupabaseAdmin, requireAdmin } from '../_admin.js';

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

    const { claim_id, restaurant_id } = req.body || {};
    if (!claim_id || !restaurant_id) {
      return res.status(400).json({ ok: false, error: 'claim_id och restaurant_id krävs' });
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
    const { data: restaurant, error: restaurantError } = await supabase
      .from('restaurants')
      .update({
        claimed: true,
        verified: true,
        claimed_by_user_id: claim.user_id,
        claim_email: claim.email,
        claimed_at: now,
        updated_at: now
      })
      .eq('id', restaurant_id)
      .select('id, name')
      .single();

    if (restaurantError || !restaurant) {
      console.error('[admin claims] approve restaurant update failed', {
        message: restaurantError?.message,
        restaurant_id,
        claim_id
      });
      return res.status(500).json({ ok: false, error: 'Kunde inte koppla restaurangen' });
    }

    const { data: updatedClaim, error: updateClaimError } = await supabase
      .from('claims')
      .update({
        restaurant_id,
        status: 'approved',
        reviewed_at: now,
        reviewed_by: admin.user?.id || null
      })
      .eq('id', claim_id)
      .select()
      .single();

    if (updateClaimError) {
      console.error('[admin claims] approve claim update failed', {
        message: updateClaimError.message,
        claim_id
      });
      return res.status(500).json({ ok: false, error: 'Restaurangen kopplades men ansökan kunde inte uppdateras' });
    }

    return res.status(200).json({
      ok: true,
      message: 'Ansökan är godkänd och kopplad',
      claim: updatedClaim,
      restaurant
    });
  } catch (e) {
    console.error('[admin claims] approve handler error', { message: e.message, stack: e.stack });
    return res.status(500).json({ ok: false, error: 'Kunde inte godkänna ansökan' });
  }
}
