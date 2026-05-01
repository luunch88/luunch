// â”€â”€ Supabase init â”€â”€
// Dessa vÃ¤rden Ã¤r publika (anon key) â€” sÃ¤kert att ha i frontend
const SUPABASE_URL = 'https://thibluvsuufpgxkcqewb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRoaWJsdXZzdXVmcGd4a2NxZXdiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwNDE4NjYsImV4cCI6MjA4OTYxNzg2Nn0.gHkkBI-2ZnaNbPNSsP4GHZkKK7uc5Q9wbuG948oaQe0'; // Byt ut mot din anon key
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const { escapeHtml, escapeAttr } = window.LuunchUI;

const days = ['MÃ¥ndag','Tisdag','Onsdag','Torsdag','Fredag','LÃ¶rdag','SÃ¶ndag'];
let currentRestaurant = null;
let claimInProgress = false;
let currentUser = null;
let currentSession = null;
const RESTAURANT_TYPES = new Set([
  'Pizza',
  'Sushi',
  'Burgare',
  'Asiatiskt',
  'Thai',
  'Indiskt',
  'Vegetariskt',
  'CafÃ©',
  'Annat'
]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const POSTAL_CODE_RE = /^\d{3}\s?\d{2}$/;
const ORGANIZATION_NUMBER_RE = /^\d{6}-?\d{4}$/;

function setupAuthView() {
  const mode = new URLSearchParams(window.location.search).get('mode');
  if (mode === 'signup') showRegister();
}

// â”€â”€ Build hours grid â”€â”€
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
      <span class="hours-sep">â€“</span>
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

// â”€â”€ Toggle forms â”€â”€
function showRegister() {
  document.getElementById('formLogin').style.display = 'none';
  document.getElementById('formRegister').style.display = 'block';
}
function showLogin() {
  document.getElementById('formRegister').style.display = 'none';
  document.getElementById('formLogin').style.display = 'block';
}

async function submitClaimRequest(claimPayload) {
  if (claimInProgress) return null;
  claimInProgress = true;
  try {
    const res = await fetch('/api/claim', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(claimPayload)
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      data = { ok: false, error: text || 'Non-JSON response' };
    }
    console.log('[claim] request payload:', claimPayload);
    console.log('[claim] response:', {
      status: res.status,
      ok: res.ok,
      data
    });
    if (!res.ok || data.ok === false) {
      throw new Error('Kunde inte skicka ansökan just nu. Försök igen.');
    }
    return data.claim || null;
  } finally {
    claimInProgress = false;
  }
}

function showPage(pageId) {
  document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
  document.getElementById(pageId).classList.add('active');
}

function valueOf(id) {
  return document.getElementById(id)?.value.trim() || '';
}

function setFieldError(id, message) {
  const input = document.getElementById(id);
  const error = document.getElementById(`${id}Error`);
  if (input) input.classList.toggle('has-error', Boolean(message));
  if (error) error.textContent = message || '';
}

function clearApplyErrors() {
  [
    'applyName',
    'applyAddress',
    'applyPostalCode',
    'applyCity',
    'applyType',
    'applyContactPerson',
    'applyEmail',
    'applyOrganizationNumber'
  ].forEach(id => setFieldError(id, ''));
}

function prepareApplyForm() {
  const emailInput = document.getElementById('applyEmail');
  if (emailInput && currentUser?.email && !emailInput.value) {
    emailInput.value = currentUser.email;
  }
}

function validateApplyPayload(payload) {
  clearApplyErrors();
  let isValid = true;

  if (!payload.restaurant_name) {
    setFieldError('applyName', 'Ange restaurangnamn.');
    isValid = false;
  }
  if (!payload.address) {
    setFieldError('applyAddress', 'Ange gatuadress.');
    isValid = false;
  }
  if (!POSTAL_CODE_RE.test(payload.postal_code)) {
    setFieldError('applyPostalCode', 'Ange postnummer som 12345 eller 123 45.');
    isValid = false;
  }
  if (!payload.city) {
    setFieldError('applyCity', 'Ange ort.');
    isValid = false;
  }
  if (!RESTAURANT_TYPES.has(payload.restaurant_type)) {
    setFieldError('applyType', 'VÃ¤lj typ av restaurang.');
    isValid = false;
  }
  if (!payload.contact_person) {
    setFieldError('applyContactPerson', 'Ange kontaktperson.');
    isValid = false;
  }
  if (!EMAIL_RE.test(payload.email)) {
    setFieldError('applyEmail', 'Ange en giltig e-postadress.');
    isValid = false;
  }
  if (payload.organization_number && !ORGANIZATION_NUMBER_RE.test(payload.organization_number)) {
    setFieldError('applyOrganizationNumber', 'Ange organisationsnummer som 556123-4567 eller 5561234567.');
    isValid = false;
  }

  return isValid;
}

// â”€â”€ Login â”€â”€
async function login() {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const btn = document.getElementById('loginBtn');
  if (!email || !password) { showMsg('loginMsg', 'Fyll i e-post och lÃ¶senord.', 'error'); return; }

  btn.disabled = true;
  btn.innerHTML = '<div class="spinner-sm"></div> Loggar inâ€¦';

  const { data, error } = await sb.auth.signInWithPassword({ email, password });

  if (error) {
    showMsg('loginMsg', 'Fel e-post eller lÃ¶senord.', 'error');
  } else if (data.session) {
    await handleSession(data.session, 'loginMsg');
  }
  btn.disabled = false;
  btn.innerHTML = 'Logga in';
}

// â”€â”€ Register â”€â”€
async function register() {
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;
  const confirm = document.getElementById('regConfirm').value;
  const btn = document.getElementById('regBtn');
  if (!email || !password) { showMsg('regMsg', 'Fyll i alla fÃ¤lt.', 'error'); return; }
  if (password.length < 6) { showMsg('regMsg', 'LÃ¶senordet mÃ¥ste vara minst 6 tecken.', 'error'); return; }
  if (password !== confirm) { showMsg('regMsg', 'LÃ¶senorden matchar inte.', 'error'); return; }

  btn.disabled = true;
  btn.innerHTML = '<div class="spinner-sm"></div> Skapar kontoâ€¦';

  const { data, error } = await sb.auth.signUp({ email, password });

  if (error) {
    showMsg('regMsg', 'NÃ¥got gick fel: ' + error.message, 'error');
  } else if (data.session) {
    showMsg('regMsg', 'âœ“ Konto skapat! Skickar ansÃ¶kanâ€¦', 'success');
    await handleSession(data.session, 'regMsg');
  } else {
    showMsg('regMsg', 'âœ“ Konto skapat! BekrÃ¤fta din e-post och logga sedan in hÃ¤r.', 'success');
  }
  btn.disabled = false;
  btn.innerHTML = 'Skapa konto';
}

// â”€â”€ Check session â”€â”€
async function checkSession() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    await handleSession(session, 'loginMsg');
  }
}

async function handleSession(session, msgId = 'loginMsg') {
  try {
    currentSession = session;
    await loadDashboard(session.user);
  } catch (e) {
    console.error('[dashboard] Failed to load dashboard', e);
    showMsg(msgId, 'Kunde inte ladda dashboard just nu.', 'error');
  }
}

async function getPendingClaim(userId) {
  const { data, error } = await sb
    .from('claims')
    .select('id, restaurant_name, address, postal_code, city, restaurant_type, contact_person, email, phone, organization_number, website, message, status, created_at')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return null;
  return data || null;
}

async function showPendingClaim(claim) {
  document.getElementById('pendingSub').textContent = claim?.restaurant_name
    ? `Din ansÃ¶kan fÃ¶r ${claim.restaurant_name} vÃ¤ntar pÃ¥ granskning.`
    : 'Din ansÃ¶kan vÃ¤ntar pÃ¥ granskning.';
  renderPendingDetails(claim);
  showPage('pagePending');
}

function renderPendingDetails(claim) {
  const container = document.getElementById('pendingDetails');
  if (!container) return;
  container.textContent = '';
  if (!claim) return;

  const rows = [
    ['Restaurangnamn', claim.restaurant_name],
    ['Adress', [claim.address, claim.postal_code, claim.city].filter(Boolean).join(', ')],
    ['Typ', claim.restaurant_type],
    ['Kontaktperson', claim.contact_person],
    ['E-post', claim.email],
    ['Telefon', claim.phone],
    ['Organisationsnummer', claim.organization_number],
    ['Hemsida', claim.website],
    ['Meddelande', claim.message]
  ].filter(([, value]) => value);

  rows.forEach(([label, value]) => {
    const row = document.createElement('div');
    row.className = 'readonly-row';
    const labelEl = document.createElement('div');
    labelEl.className = 'readonly-label';
    labelEl.textContent = label;
    const valueEl = document.createElement('div');
    valueEl.className = 'readonly-value';
    valueEl.textContent = value;
    row.append(labelEl, valueEl);
    container.appendChild(row);
  });
}

// â”€â”€ Load dashboard â”€â”€
async function fetchOwnedRestaurant(userId) {
  const { data, error } = await sb
    .from('restaurants')
    .select('*')
    .eq('claimed_by_user_id', userId)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn('[dashboard] restaurants lookup failed; showing apply view', {
      message: error.message,
      details: error.details,
      code: error.code
    });
    return null;
  }

  return data || null;
}

async function loadDashboard(user) {
  currentUser = user;
  const restaurant = await fetchOwnedRestaurant(user.id);

  if (!restaurant) {
    prepareApplyForm();
    showPage('pageApply');
    return;
  }

  currentRestaurant = restaurant;
  document.getElementById('dashName').textContent = restaurant.name;
  document.getElementById('dashSub').textContent = restaurant.address || 'Uppdatera din info nedan';

  // HÃ¤mta dagens rÃ¤tter
  const today = new Date().toISOString().split('T')[0];
  const { data: dishes } = await sb
    .from('menus')
    .select('description, price')
    .eq('restaurant_id', restaurant.id)
    .eq('date', today)
    .order('created_at');

  todayDishes = dishes || [];
  renderDishes();

  // HÃ¤mta Ã¶ppettider
  const { data: hours } = await sb
    .from('opening_hours')
    .select('*')
    .eq('restaurant_id', restaurant.id)
    .order('day_of_week');

  buildHoursGrid(hours || []);
  if (hours?.length > 0) {
    document.getElementById('hoursStatus').textContent = 'Tillagda âœ“';
    document.getElementById('hoursStatus').className = 'section-status set';
  }

  // Visa dashboard
  showPage('pageDash');
}

// â”€â”€ Dishes state â”€â”€
let todayDishes = [];

function renderDishes() {
  const list = document.getElementById('dishesList');
  if (todayDishes.length === 0) {
    list.innerHTML = `<div class="dishes-empty">Inga rÃ¤tter tillagda Ã¤nnu</div>`;
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
      <button class="dish-item-delete" onclick="deleteDish(${i})">âœ•</button>
    </div>`).join('')}</div>`;
  document.getElementById('menuStatus').textContent = `${todayDishes.length} rÃ¤tt${todayDishes.length>1?'er':''}`;
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
  showMsg('menuMsg', 'âœ“ RÃ¤tt tillagd!', 'success');
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

// â”€â”€ Save hours â”€â”€
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

  document.getElementById('hoursStatus').textContent = 'Tillagda âœ“';
  document.getElementById('hoursStatus').className = 'section-status set';
  showMsg('hoursMsg', 'âœ“ Ã–ppettiderna Ã¤r sparade!', 'success');
}

// â”€â”€ Logout â”€â”€
async function logout() {
  await sb.auth.signOut();
  currentRestaurant = null;
  currentUser = null;
  currentSession = null;
  showPage('pageLogin');
}

// â”€â”€ Helper â”€â”€
function showMsg(id, text, type) {
  const el = document.getElementById(id);
  el.className = 'msg ' + type;
  el.textContent = text;
  setTimeout(() => { el.textContent = ''; el.className = 'msg'; }, 5000);
}

// â”€â”€ Init â”€â”€
sb.auth.onAuthStateChange((event, session) => {
  if (session && event !== 'INITIAL_SESSION') handleSession(session, 'loginMsg');
});
buildHoursGrid();
setupAuthView();
checkSession();

async function applyRestaurant() {
  if (!currentUser) return;
  const name = valueOf('applyName');
  const btn = document.getElementById('applyBtn');
  const claimPayload = {
    restaurant_name: name,
    address: valueOf('applyAddress'),
    postal_code: valueOf('applyPostalCode'),
    city: valueOf('applyCity'),
    restaurant_type: valueOf('applyType'),
    contact_person: valueOf('applyContactPerson'),
    email: valueOf('applyEmail'),
    phone: valueOf('applyPhone') || null,
    organization_number: valueOf('applyOrganizationNumber') || null,
    website: valueOf('applyWebsite') || null,
    message: valueOf('applyMessage') || null
  };

  if (!validateApplyPayload(claimPayload)) {
    showMsg('applyMsg', 'Kontrollera fÃ¤lten ovan.', 'error');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<div class="spinner-sm"></div> Skickar...';

  try {
    await submitClaimRequest(claimPayload);
    showMsg('applyMsg', 'Tack! Din ansökan är skickad. Vi granskar den manuellt.', 'success');
    await showPendingClaim(claimPayload);
  } catch (e) {
    showMsg('applyMsg', 'Kunde inte skicka ansökan just nu. Försök igen.', 'error');
  }

  btn.disabled = false;
  btn.innerHTML = 'AnsÃ¶k om restaurang';
}


