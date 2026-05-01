import { applyCors } from '../../_cors.js';
import { cleanText, getSupabaseAdmin, requireAdminSecret } from '../_admin.js';

const VALID_STATUSES = new Set(['pending', 'approved', 'rejected']);

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

    if (!id) return res.status(400).json({ ok: false, error: 'id krävs' });
    if (!VALID_STATUSES.has(status)) {
      return res.status(400).json({ ok: false, error: 'Ogiltig status' });
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

    return res.status(200).json({ ok: true, claim: data });
  } catch (e) {
    console.error('[admin claims] update handler error', { message: e.message, stack: e.stack });
    return res.status(500).json({ ok: false, error: 'Kunde inte uppdatera ansökan' });
  }
}
