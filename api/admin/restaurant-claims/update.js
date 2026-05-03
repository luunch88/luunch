import { applyCors } from '../../_cors.js';
import { cleanText, getSupabaseAdmin, requireAdminSecret } from '../_admin.js';

const VALID_STATUSES = new Set(['approved', 'rejected']);

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (!applyCors(req, res, 'POST, OPTIONS')) {
    return res.status(403).json({ ok: false, error: 'Origin not allowed' });
  }
  if (req.method === 'OPTIONS') return res.status(200).json({ ok: true });
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Endast POST stöds' });

  try {
    const admin = requireAdminSecret(req);
    if (!admin.ok) return res.status(admin.status).json({ ok: false, error: admin.error });

    const supabase = getSupabaseAdmin();
    if (!supabase) return res.status(500).json({ ok: false, error: 'Supabase är inte konfigurerat' });

    const id = cleanText(req.body?.id);
    const status = cleanText(req.body?.status);
    if (!id) return res.status(400).json({ ok: false, error: 'id krävs' });
    if (!VALID_STATUSES.has(status)) return res.status(400).json({ ok: false, error: 'Ogiltig status' });

    const { data: claim, error: claimError } = await supabase
      .from('restaurant_claims')
      .select('id, restaurant_id, user_id, email, status')
      .eq('id', id)
      .maybeSingle();

    if (claimError) return res.status(500).json({ ok: false, error: claimError.message });
    if (!claim) return res.status(404).json({ ok: false, error: 'Anspråket hittades inte' });
    if (claim.status !== 'pending') {
      return res.status(409).json({ ok: false, error: 'Anspråket är redan hanterat' });
    }

    const now = new Date().toISOString();

    if (status === 'approved') {
      const { error: restaurantError } = await supabase
        .from('restaurants')
        .update({
          owner_user_id: claim.user_id,
          claimed_by_user_id: claim.user_id,
          claim_email: claim.email,
          claimed: true,
          verified: true,
          status: 'claimed',
          claimed_at: now,
          updated_at: now
        })
        .eq('id', claim.restaurant_id);

      if (restaurantError) {
        console.error('[admin restaurant claims] restaurant approve failed', {
          message: restaurantError.message,
          code: restaurantError.code,
          details: restaurantError.details,
          hint: restaurantError.hint
        });
        return res.status(500).json({
          ok: false,
          error: restaurantError.message,
          code: restaurantError.code,
          details: restaurantError.details,
          hint: restaurantError.hint
        });
      }
    } else {
      const { error: restaurantError } = await supabase
        .from('restaurants')
        .update({ status: 'unclaimed', updated_at: now })
        .eq('id', claim.restaurant_id)
        .eq('status', 'pending_claim');

      if (restaurantError) {
        console.error('[admin restaurant claims] restaurant reject status reset failed', {
          message: restaurantError.message,
          code: restaurantError.code
        });
      }
    }

    const { data, error } = await supabase
      .from('restaurant_claims')
      .update({
        status,
        reviewed_at: now,
        reviewed_by: 'admin'
      })
      .eq('id', id)
      .select()
      .single();

    if (error) return res.status(500).json({ ok: false, error: error.message });

    return res.status(200).json({
      ok: true,
      message: status === 'approved' ? 'Restaurang kopplad till användare' : 'Anspråk nekat',
      claim: data
    });
  } catch (e) {
    console.error('[admin restaurant claims] update handler error', { message: e.message, stack: e.stack });
    return res.status(500).json({ ok: false, error: e.message || 'Kunde inte uppdatera anspråk' });
  }
}
