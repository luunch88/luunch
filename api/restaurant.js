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

  // Dagens dag (0=måndag ... 6=söndag)
  const now = new Date();
  const todayIndex = (now.getDay() + 6) % 7; // JS: 0=söndag, vi vill 0=måndag
  const currentTime = now.getHours() * 60 + now.getMinutes();

  // Hämta dagens öppettider
  const { data: todayHours } = await supabase
    .from('opening_hours')
    .select('opens, closes')
    .eq('restaurant_id', restaurant.id)
    .eq('day_of_week', todayIndex)
    .single();

  // Räkna ut om öppet just nu
  let isOpenNow = null;
  let todayOpen = null;
  let todayClose = null;

  if (todayHours) {
    const [oh, om] = todayHours.opens.split(':').map(Number);
    const [ch, cm] = todayHours.closes.split(':').map(Number);
    const openMin = oh * 60 + om;
    const closeMin = ch * 60 + cm;
    isOpenNow = currentTime >= openMin && currentTime < closeMin;
    todayOpen = todayHours.opens;
    todayClose = todayHours.closes;
  }

  // Hämta dagens rätter (flera möjliga)
  const today = now.toISOString().split('T')[0];
  const { data: dishes } = await supabase
    .from('menus')
    .select('description, price')
    .eq('restaurant_id', restaurant.id)
    .eq('date', today);

  return res.status(200).json({
    claimed: true,
    verified: restaurant.verified,
    phone: restaurant.phone,
    is_open_now: isOpenNow,
    today_opens: todayOpen,
    today_closes: todayClose,
    dishes: dishes || []
  });
}

  return res.status(200).json({
    claimed: true,
    verified: restaurant.verified,
    phone: restaurant.phone,
    is_open_now: isOpenNow,      // true/false/null
    today_opens: todayOpen,       // "11:00"
    today_closes: todayClose,     // "14:00"
    menu: menu || null
  });
}
