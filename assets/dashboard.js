// ── Supabase init ──
// Dessa värden är publika (anon key) — säkert att ha i frontend
const SUPABASE_URL = 'https://thibluvsuufpgxkcqewb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRoaWJsdXZzdXVmcGd4a2NxZXdiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwNDE4NjYsImV4cCI6MjA4OTYxNzg2Nn0.gHkkBI-2ZnaNbPNSsP4GHZkKK7uc5Q9wbuG948oaQe0'; // Byt ut mot din anon key
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const { escapeHtml, escapeAttr } = window.LuunchUI;

const days = ['Måndag','Tisdag','Onsdag','Torsdag','Fredag','Lördag','Söndag'];
let currentRestaurant = null;

// ── Build hours grid ──
function buildHoursGrid(existing = []) {
  const grid = document.getElementById('hoursGrid');
  grid.innerHTML = '';
  days.forEach((day, i) => {
    const ex = existing.find(h => h.day_of_week === i);
    const isOn = !!ex;
    const row = document.createElement('div');
    row.className = 'hours-row';
    row.innerHTML = `
      <span class="hours-day">${day.slice(0,3)}</span>
      <button class="hours-toggle ${isOn?'on':''}" id="toggle_${i}" onclick="toggleDay(${i})" type="button"></button>
      <input class="hours-input" id="opens_${i}" type="time" value="${escapeAttr(ex?.opens || '11:00')}" ${isOn?'':'disabled'} style="opacity:${isOn?1:0.3}">
      <span class="hours-sep">–</span>
      <input class="hours-input" id="closes_${i}" type="time" value="${escapeAttr(ex?.closes || '14:00')}" ${isOn?'':'disabled'} style="opacity:${isOn?1:0.3}">
    `;
    grid.appendChild(row);
  });
}

function toggleDay(i) {
  const btn = document.getElementById(`toggle_${i}`);
  const opens = document.getElementById(`opens_${i}`);
  const closes = document.getElementById(`closes_${i}`);
  const isOn = btn.classList.toggle('on');
  opens.disabled = !isOn; opens.style.opacity = isOn ? 1 : 0.3;
  closes.disabled = !isOn; closes.style.opacity = isOn ? 1 : 0.3;
}

// ── Toggle forms ──
function showRegister() {
  document.getElementById('formLogin').style.display = 'none';
  document.getElementById('formRegister').style.display = 'block';
}
function showLogin() {
  document.getElementById('formRegister').style.display = 'none';
  document.getElementById('formLogin').style.display = 'block';
}

// ── Login ──
async function login() {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const btn = document.getElementById('loginBtn');
  if (!email || !password) { showMsg('loginMsg', 'Fyll i e-post och lösenord.', 'error'); return; }

  btn.disabled = true;
  btn.innerHTML = '<div class="spinner-sm"></div> Loggar in…';

  const { error } = await sb.auth.signInWithPassword({ email, password });

  if (error) {
    showMsg('loginMsg', 'Fel e-post eller lösenord.', 'error');
  }
  btn.disabled = false;
  btn.innerHTML = 'Logga in';
}

// ── Register ──
async function register() {
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;
  const btn = document.getElementById('regBtn');
  if (!email || !password) { showMsg('regMsg', 'Fyll i alla fält.', 'error'); return; }
  if (password.length < 6) { showMsg('regMsg', 'Lösenordet måste vara minst 6 tecken.', 'error'); return; }

  btn.disabled = true;
  btn.innerHTML = '<div class="spinner-sm"></div> Skapar konto…';

  const { error } = await sb.auth.signUp({ email, password });

  if (error) {
    showMsg('regMsg', 'Något gick fel: ' + error.message, 'error');
  } else {
    showMsg('regMsg', '✓ Konto skapat! Loggar in…', 'success');
    // Logga in direkt
    await sb.auth.signInWithPassword({ email, password });
  }
  btn.disabled = false;
  btn.innerHTML = 'Skapa konto';
}

// ── Check session ──
async function checkSession() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    await loadDashboard(session.user.email);
  }
}

// ── Load dashboard ──
async function loadDashboard(email) {
  // Hämta restaurang kopplad till denna email
  const { data: restaurant } = await sb
    .from('restaurants')
    .select('*')
    .eq('email', email)
    .single();

  if (!restaurant) {
    showMsg('loginMsg', 'Ingen restaurang hittades för denna e-post. Claima din restaurang på luunch.se först.', 'error');
    await sb.auth.signOut();
    return;
  }

  currentRestaurant = restaurant;
  document.getElementById('dashName').textContent = restaurant.name;
  document.getElementById('dashSub').textContent = restaurant.address || 'Uppdatera din info nedan';

  // Hämta dagens rätter
  const today = new Date().toISOString().split('T')[0];
  const { data: dishes } = await sb
    .from('menus')
    .select('description, price')
    .eq('restaurant_id', restaurant.id)
    .eq('date', today)
    .order('created_at');

  todayDishes = dishes || [];
  renderDishes();

  // Hämta öppettider
  const { data: hours } = await sb
    .from('opening_hours')
    .select('*')
    .eq('restaurant_id', restaurant.id)
    .order('day_of_week');

  buildHoursGrid(hours || []);
  if (hours?.length > 0) {
    document.getElementById('hoursStatus').textContent = 'Tillagda ✓';
    document.getElementById('hoursStatus').className = 'section-status set';
  }

  // Visa dashboard
  document.getElementById('pageLogin').classList.remove('active');
  document.getElementById('pageDash').classList.add('active');
}

// ── Dishes state ──
let todayDishes = [];

function renderDishes() {
  const list = document.getElementById('dishesList');
  if (todayDishes.length === 0) {
    list.innerHTML = `<div class="dishes-empty">Inga rätter tillagda ännu</div>`;
    document.getElementById('menuStatus').textContent = 'Ej tillagd';
    document.getElementById('menuStatus').className = 'section-status missing';
    return;
  }
  list.innerHTML = `<div class="dish-list">${todayDishes.map((d,i) => `
    <div class="dish-item">
      <div class="dish-item-info">
        <div class="dish-item-name">${escapeHtml(d.description)}</div>
        ${d.price ? `<div class="dish-item-price">${escapeHtml(d.price)} kr</div>` : ''}
      </div>
      <button class="dish-item-delete" onclick="deleteDish(${i})">✕</button>
    </div>`).join('')}</div>`;
  document.getElementById('menuStatus').textContent = `${todayDishes.length} rätt${todayDishes.length>1?'er':''}`;
  document.getElementById('menuStatus').className = 'section-status set';
}

async function addDish() {
  const desc = document.getElementById('dishDesc').value.trim();
  const price = parseInt(document.getElementById('dishPrice').value) || null;
  if (!desc) { showMsg('menuMsg', 'Ange en beskrivning.', 'error'); return; }

  const today = new Date().toISOString().split('T')[0];
  const { error } = await sb.from('menus').insert({
    restaurant_id: currentRestaurant.id,
    date: today,
    description: desc,
    price
  });

  if (error) { showMsg('menuMsg', 'Fel: ' + error.message, 'error'); return; }

  todayDishes.push({ description: desc, price });
  document.getElementById('dishDesc').value = '';
  document.getElementById('dishPrice').value = '';
  renderDishes();
  showMsg('menuMsg', '✓ Rätt tillagd!', 'success');
}

async function deleteDish(index) {
  const dish = todayDishes[index];
  const today = new Date().toISOString().split('T')[0];
  await sb.from('menus')
    .delete()
    .eq('restaurant_id', currentRestaurant.id)
    .eq('date', today)
    .eq('description', dish.description);
  todayDishes.splice(index, 1);
  renderDishes();
}

// ── Save hours ──
async function saveHours() {
  if (!currentRestaurant) return;
  const rows = [];
  days.forEach((_, i) => {
    const toggle = document.getElementById(`toggle_${i}`);
    if (toggle.classList.contains('on')) {
      rows.push({
        restaurant_id: currentRestaurant.id,
        day_of_week: i,
        opens: document.getElementById(`opens_${i}`).value,
        closes: document.getElementById(`closes_${i}`).value,
      });
    }
  });

  // Ta bort gamla och insert nya
  await sb.from('opening_hours').delete().eq('restaurant_id', currentRestaurant.id);
  if (rows.length > 0) {
    const { error } = await sb.from('opening_hours').insert(rows);
    if (error) { showMsg('hoursMsg', 'Fel: ' + error.message, 'error'); return; }
  }

  document.getElementById('hoursStatus').textContent = 'Tillagda ✓';
  document.getElementById('hoursStatus').className = 'section-status set';
  showMsg('hoursMsg', '✓ Öppettiderna är sparade!', 'success');
}

// ── Logout ──
async function logout() {
  await sb.auth.signOut();
  currentRestaurant = null;
  document.getElementById('pageDash').classList.remove('active');
  document.getElementById('pageLogin').classList.add('active');
}

// ── Helper ──
function showMsg(id, text, type) {
  const el = document.getElementById(id);
  el.className = 'msg ' + type;
  el.textContent = text;
  setTimeout(() => { el.textContent = ''; el.className = 'msg'; }, 5000);
}

// ── Init ──
sb.auth.onAuthStateChange((event, session) => {
  if (session) loadDashboard(session.user.email);
});
checkSession();
buildHoursGrid();
