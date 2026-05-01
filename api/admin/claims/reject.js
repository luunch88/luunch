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

    const { claim_id, reason = null } = req.body || {};
    if (!claim_id) return res.status(400).json({ ok: false, error: 'claim_id krävs' });

    const { data: claim, error } = await supabase
      .from('claims')
      .update({
        status: 'rejected',
        review_reason: typeof reason === 'string' ? reason.trim() || null : null,
        reviewed_at: new Date().toISOString(),
        reviewed_by: admin.user?.id || null
      })
      .eq('id', claim_id)
      .eq('status', 'pending')
      .select()
      .single();

    if (error || !claim) {
      console.error('[admin claims] reject failed', { message: error?.message, claim_id });
      return res.status(404).json({ ok: false, error: 'Pending ansökan hittades inte' });
    }

    return res.status(200).json({
      ok: true,
      message: 'Ansökan är avvisad',
      claim
    });
  } catch (e) {
    console.error('[admin claims] reject handler error', { message: e.message, stack: e.stack });
    return res.status(500).json({ ok: false, error: 'Kunde inte avvisa ansökan' });
  }
}
