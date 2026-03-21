import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { osm_id } = req.query;
  if (!osm_id) return res.status(400).json({ error: 'osm_id krävs' });

  // Hämta restauranginfo
  const { data: restaurant, error } = await supabase
    .from('restaurants')
    .select('id, name, phone, address, verified')
    .eq('osm_id', osm_id)
    .single();

  if (error || !restaurant) {
    return res.status(200).json({ claimed: false });
  }

  // Hämta öppettider
  const { data: hours } = await supabase
    .from('opening_hours')
    .select('day_of_week, opens, closes')
    .eq('restaurant_id', restaurant.id)
    .order('day_of_week');

  // Hämta dagens meny
  const today = new Date().toISOString().split('T')[0];
  const { data: menu } = await supabase
    .from('menus')
    .select('description, price')
    .eq('restaurant_id', restaurant.id)
    .eq('date', today)
    .single();

  return res.status(200).json({
    claimed: true,
    verified: restaurant.verified,
    phone: restaurant.phone,
    opening_hours: hours || [],
    menu: menu || null
  });
}
