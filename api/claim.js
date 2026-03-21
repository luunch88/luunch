import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY // Service key behövs för att skapa användare
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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

  // Skapa Supabase auth-konto med tillfälligt lösenord
  const tempPassword = Math.random().toString(36).slice(-10) + 'A1!';
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true
  });

  if (authError && !authError.message.includes('already registered')) {
    return res.status(500).json({ error: authError.message });
  }

  // Spara restaurang i databasen
  const { data, error } = await supabase
    .from('restaurants')
    .insert([{ osm_id, name, email, lat, lon, address, verified: false }])
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  return res.status(201).json({
    success: true,
    message: 'Restaurang claimad! Gå till luunch.se/dashboard.html för att logga in och sätta ditt lösenord.',
    tempPassword // Visas för användaren en gång
  });
}
