import { createClient } from '@supabase/supabase-js';
import { applyCors } from './_cors.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  if (!applyCors(req, res, 'POST, OPTIONS')) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { osm_id, name, email, lat, lon, address } = req.body;

  if (!osm_id || !name || !email) {
    return res.status(400).json({ error: 'osm_id, name och email krävs' });
  }

  // Kolla om restaurangen redan är claimad
  const { data: existing } = await supabase
    .from('restaurants')
    .select('id, email')
    .eq('osm_id', osm_id)
    .single();

  if (existing) {
    return res.status(409).json({ error: 'Denna restaurang är redan claimad' });
  }

  // Spara restaurang i databasen. Konto skapas separat i dashboarden med samma e-post.
  const { data, error } = await supabase
    .from('restaurants')
    .insert([{ osm_id, name, email, lat, lon, address, verified: false }])
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  return res.status(201).json({
    success: true,
    message: 'Restaurang claimad! Skapa konto eller logga in på luunch.se/dashboard.html med samma e-postadress.'
  });
}
