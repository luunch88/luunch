import { applyCors } from '../../_cors.js';
import { cleanText, getSupabaseAdmin, requireAdminSecret } from '../_admin.js';

function isTrue(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

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
    if (!id) return res.status(400).json({ ok: false, error: 'id krävs' });

    const { data: restaurant, error: readError } = await supabase
      .from('restaurants')
      .select('id, name, claimed, verified, claimed_by_user_id, owner_user_id')
      .eq('id', id)
      .maybeSingle();

    if (readError) return res.status(500).json({ ok: false, error: readError.message });
    if (!restaurant) return res.status(404).json({ ok: false, error: 'Restaurangen hittades inte' });

    if (isTrue(restaurant.claimed) || isTrue(restaurant.verified) || restaurant.claimed_by_user_id || restaurant.owner_user_id) {
      return res.status(409).json({
        ok: false,
        error: 'Kan inte ta bort claimad/verifierad restaurang.'
      });
    }

    const { error } = await supabase
      .from('restaurants')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('[admin restaurants] delete failed', {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
        id
      });
      return res.status(500).json({ ok: false, error: error.message });
    }

    return res.status(200).json({ ok: true, message: 'Restaurang borttagen' });
  } catch (error) {
    console.error('[admin restaurants] delete handler error', { message: error.message, stack: error.stack });
    return res.status(500).json({ ok: false, error: error.message || 'Kunde inte ta bort restaurang' });
  }
}
