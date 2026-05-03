// -- Supabase init --
// Dessa värden är publika (anon key) — säkert att ha i frontend
const SUPABASE_URL = 'https://thibluvsuufpgxkcqewb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRoaWJsdXZzdXVmcGd4a2NxZXdiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwNDE4NjYsImV4cCI6MjA4OTYxNzg2Nn0.gHkkBI-2ZnaNbPNSsP4GHZkKK7uc5Q9wbuG948oaQe0'; // Byt ut mot din anon key
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const { escapeHtml, escapeAttr } = window.LuunchUI;

const days = ['Måndag','Tisdag','Onsdag','Torsdag','Fredag','Lördag','Söndag'];
let currentRestaurant = null;
let claimInProgress = false;
let currentUser = null;
let currentSession = null;
let currentDashboardSection = 'home';
let currentHours = [];
const RESTAURANT_TYPES = new Set([
  'Pizza',
  'Sushi',
  'Burgare',
  'Asiatiskt',
  'Thai',
  'Indiskt',
  'Vegetariskt',
  'Café',
  'Annat'
]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const POSTAL_CODE_RE = /^\d{3}\s?\d{2}$/;
const ORGANIZATION_NUMBER_RE = /^\d{6}-?\d{4}$/;

function setupAuthView() {
  const mode = new URLSearchParams(window.location.search).get('mode');
  if (mode === 'signup') showRegister();
}

// -- Build hours grid --
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

// -- Toggle forms --
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
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch('/api/claim', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {})
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
      console.error('[claim] failed response', data);
      const error = new Error(data.error || 'Server error');
      error.response = data;
      throw error;
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

function showDashboardSection(section) {
  currentDashboardSection = section;
  document.querySelectorAll('.side-nav').forEach(button => {
    button.classList.toggle('active', button.dataset.section === section);
  });
  document.querySelectorAll('.dash-section').forEach(panel => panel.classList.remove('active'));
  document.getElementById(`dashSection${section[0].toUpperCase()}${section.slice(1)}`)?.classList.add('active');
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
  const claimEmail = document.getElementById('claimEmail');
  if (claimEmail && currentUser?.email && !claimEmail.value) {
    claimEmail.value = currentUser.email;
  }
}

function setApplyFlow(flow) {
  const find = document.getElementById('findRestaurantFlow');
  const add = document.getElementById('newRestaurantFlow');
  if (find) find.style.display = flow === 'find' ? 'block' : 'none';
  if (add) add.style.display = flow === 'new' ? 'block' : 'none';
}

function showFindRestaurantFlow() {
  setApplyFlow('find');
  prepareApplyForm();
}

function showNewRestaurantFlow() {
  setApplyFlow('new');
  prepareApplyForm();
}

async function searchRestaurants({ name, city, address }) {
  const params = new URLSearchParams();
  if (name) params.set('q', name);
  if (city) params.set('city', city);
  if (address) params.set('address', address);
  const res = await fetch(`/api/restaurants/search?${params.toString()}`);
  const data = await res.json().catch(() => ({ ok: false, error: 'API:t returnerade inte JSON.' }));
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || 'Kunde inte söka restauranger.');
  }
  return data.restaurants || [];
}

function renderRestaurantSearchResults(restaurants) {
  const container = document.getElementById('restaurantSearchResults');
  if (!container) return;
  container.textContent = '';

  if (!restaurants.length) {
    const empty = document.createElement('div');
    empty.className = 'dishes-empty';
    empty.textContent = 'Ingen träff hittades.';
    container.appendChild(empty);
    return;
  }

  restaurants.forEach(restaurant => {
    const card = document.createElement('div');
    card.className = 'claim-result';
    const title = document.createElement('div');
    title.className = 'claim-result-title';
    title.textContent = restaurant.name || 'Namnlös restaurang';
    const meta = document.createElement('div');
    meta.className = 'claim-result-meta';
    meta.textContent = [restaurant.address, restaurant.postal_code, restaurant.city].filter(Boolean).join(', ');
    const status = document.createElement('div');
    status.className = 'claim-result-status';
    status.textContent = restaurant.status === 'claimed' || restaurant.claimed === true
      ? 'Redan kopplad till ett konto'
      : restaurant.status === 'pending_claim'
      ? 'Anspråk väntar redan på granskning'
      : 'Ej claimad';
    const button = document.createElement('button');
    button.className = 'btn-primary';
    button.type = 'button';
    button.textContent = 'Detta är min restaurang';
    button.disabled = restaurant.status === 'claimed' || restaurant.claimed === true || restaurant.status === 'pending_claim';
    button.addEventListener('click', () => claimExistingRestaurant(restaurant.id));
    card.append(title, meta, status, button);
    container.appendChild(card);
  });
}

async function searchExistingRestaurants() {
  const name = valueOf('restaurantSearchName');
  const city = valueOf('restaurantSearchCity');
  const address = valueOf('restaurantSearchAddress');
  if (!name && !city && !address) {
    showMsg('restaurantSearchMsg', 'Skriv namn, ort eller adress.', 'error');
    return;
  }

  try {
    const restaurants = await searchRestaurants({ name, city, address });
    renderRestaurantSearchResults(restaurants);
    showMsg('restaurantSearchMsg', restaurants.length ? `${restaurants.length} träffar hittades.` : 'Ingen träff. Du kan lägga till en ny restaurang.', restaurants.length ? 'success' : 'error');
  } catch (e) {
    showMsg('restaurantSearchMsg', e.message, 'error');
  }
}

async function claimExistingRestaurant(restaurantId) {
  const payload = {
    restaurant_id: restaurantId,
    contact_name: valueOf('claimContactName') || currentUser?.email || '',
    role: valueOf('claimRole'),
    phone: valueOf('claimPhone') || null,
    email: valueOf('claimEmail') || currentUser?.email || '',
    org_number: valueOf('claimOrgNumber') || null,
    message: valueOf('claimMessage') || null
  };

  if (!payload.contact_name || !payload.email) {
    showMsg('restaurantSearchMsg', 'Ange kontaktperson och e-post innan du skickar begäran.', 'error');
    return;
  }

  const { data: { session } } = await sb.auth.getSession();
  try {
    const res = await fetch('/api/restaurant-claims', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
      },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({ ok: false, error: 'API:t returnerade inte JSON.' }));
    if (!res.ok || data.ok === false) throw new Error(data.error || 'Kunde inte skicka begäran.');
    showMsg('restaurantSearchMsg', 'Din begäran är skickad. Vi granskar den så snart som möjligt.', 'success');
    await showPendingClaim({
      restaurant_name: data.restaurant?.name || 'Restaurang',
      address: data.restaurant?.address || '',
      city: data.restaurant?.city || '',
      status: 'pending'
    });
  } catch (e) {
    showMsg('restaurantSearchMsg', e.message, 'error');
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
    setFieldError('applyType', 'Välj typ av restaurang.');
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

// -- Login --
async function login() {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const btn = document.getElementById('loginBtn');
  if (!email || !password) { showMsg('loginMsg', 'Fyll i e-post och lösenord.', 'error'); return; }

  btn.disabled = true;
  btn.innerHTML = '<div class="spinner-sm"></div> Loggar in…';

  const { data, error } = await sb.auth.signInWithPassword({ email, password });

  if (error) {
    showMsg('loginMsg', 'Fel e-post eller lösenord.', 'error');
  } else if (data.session) {
    await handleSession(data.session, 'loginMsg');
  }
  btn.disabled = false;
  btn.innerHTML = 'Logga in';
}

// -- Register --
async function register() {
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;
  const confirm = document.getElementById('regConfirm').value;
  const btn = document.getElementById('regBtn');
  if (!email || !password) { showMsg('regMsg', 'Fyll i alla fält.', 'error'); return; }
  if (password.length < 6) { showMsg('regMsg', 'Lösenordet måste vara minst 6 tecken.', 'error'); return; }
  if (password !== confirm) { showMsg('regMsg', 'Lösenorden matchar inte.', 'error'); return; }

  btn.disabled = true;
  btn.innerHTML = '<div class="spinner-sm"></div> Skapar konto…';

  const { data, error } = await sb.auth.signUp({ email, password });

  if (error) {
    showMsg('regMsg', 'Något gick fel: ' + error.message, 'error');
  } else if (data.session) {
    showMsg('regMsg', '✓ Konto skapat! Skickar ansökan…', 'success');
    await handleSession(data.session, 'regMsg');
  } else {
    showMsg('regMsg', '✓ Konto skapat! Bekräfta din e-post och logga sedan in här.', 'success');
  }
  btn.disabled = false;
  btn.innerHTML = 'Skapa konto';
}

// -- Check session --
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

async function getPendingRestaurantClaim(userId) {
  const { data, error } = await sb
    .from('restaurant_claims')
    .select('id, restaurant_id, contact_name, role, phone, email, org_number, message, status, created_at')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  const { data: restaurant } = await sb
    .from('restaurants')
    .select('name, address, postal_code, city')
    .eq('id', data.restaurant_id)
    .maybeSingle();

  return {
    id: data.id,
    restaurant_name: restaurant?.name || 'Restaurang',
    address: restaurant?.address || '',
    postal_code: restaurant?.postal_code || '',
    city: restaurant?.city || '',
    contact_person: data.contact_name,
    email: data.email,
    phone: data.phone,
    organization_number: data.org_number,
    message: data.message,
    status: data.status
  };
}

async function showPendingClaim(claim) {
  document.getElementById('pendingSub').textContent = claim?.restaurant_name
    ? `Din ansökan för ${claim.restaurant_name} väntar på granskning.`
    : 'Din ansökan väntar på granskning.';
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

  if (rows.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'dishes-empty';
    empty.textContent = 'Ingen basinfo tillgänglig.';
    container.appendChild(empty);
    return;
  }

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

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function restaurantDisplayName(restaurant, user) {
  return restaurant?.name || user?.user_metadata?.name || user?.email || 'Restaurang';
}

function renderSummary() {
  const name = restaurantDisplayName(currentRestaurant, currentUser);
  const isVerified = currentRestaurant?.verified === true;
  const isClaimed = currentRestaurant?.claimed === true || Boolean(currentRestaurant?.claimed_by_user_id);
  setText('dashName', name);
  setText('dashSub', currentRestaurant?.address || 'Uppdatera din info nedan');
  setText('sidebarRestaurant', currentRestaurant?.name || 'Restaurang');
  setText('summaryRestaurantName', currentRestaurant?.name || '-');
  setText('summaryStatus', isVerified ? 'Verifierad' : isClaimed ? 'Claimad' : 'Väntar på granskning');
  setText('summaryMenuCount', `${todayDishes.length} rätt${todayDishes.length === 1 ? '' : 'er'}`);
  setText('summaryHours', currentHours.length > 0 ? 'Tillagda' : 'Ej tillagda');
}

function renderSettings() {
  const container = document.getElementById('settingsDetails');
  if (!container) return;
  container.textContent = '';
  const rows = [
    ['Namn', currentRestaurant?.name],
    ['Adress', [currentRestaurant?.address, currentRestaurant?.postal_code, currentRestaurant?.city].filter(Boolean).join(', ')],
    ['Kategori', currentRestaurant?.category || currentRestaurant?.type],
    ['E-post', currentRestaurant?.email || currentRestaurant?.claim_email || currentUser?.email],
    ['Telefon', currentRestaurant?.phone],
    ['Hemsida', currentRestaurant?.website]
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

// -- Load dashboard --
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
  let restaurant = null;
  try {
    restaurant = await fetchOwnedRestaurant(user.id);
  } catch (e) {
    console.warn('[dashboard] owned restaurant lookup crashed; showing apply view', e);
  }

  if (!restaurant) {
    prepareApplyForm();
    const pendingClaim = await getPendingClaim(user.id) || await getPendingRestaurantClaim(user.id);
    if (pendingClaim) {
      await showPendingClaim(pendingClaim);
      return;
    }
    setApplyFlow(null);
    showPage('pageApply');
    return;
  }

  currentRestaurant = restaurant;

  // Menyrätter ligger kvar tills ägaren tar bort dem.
  const { data: dishes } = await sb
    .from('menus')
    .select('id, description, price, is_featured, created_at')
    .eq('restaurant_id', restaurant.id)
    .order('created_at');

  todayDishes = dishes || [];
  renderDishes();

  // Hämta öppettider
  const { data: hours } = await sb
    .from('opening_hours')
    .select('*')
    .eq('restaurant_id', restaurant.id)
    .order('day_of_week');

  currentHours = hours || [];
  buildHoursGrid(hours || []);
  document.getElementById('hoursStatus').textContent = 'Ej tillagda';
  document.getElementById('hoursStatus').className = 'section-status missing';
  if (hours?.length > 0) {
    document.getElementById('hoursStatus').textContent = 'Tillagda ✓';
    document.getElementById('hoursStatus').className = 'section-status set';
  }
  renderSummary();
  renderSettings();
  showDashboardSection('home');

  // Visa dashboard
  showPage('pageDash');
}

// -- Dishes state --
let todayDishes = [];

function renderDishes() {
  const list = document.getElementById('dishesList');
  list.textContent = '';
  if (todayDishes.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'dishes-empty';
    empty.textContent = 'Inga rätter tillagda ännu';
    list.appendChild(empty);
    document.getElementById('menuStatus').textContent = 'Ej tillagd';
    document.getElementById('menuStatus').className = 'section-status missing';
    renderSummary();
    return;
  }
  const wrapper = document.createElement('div');
  wrapper.className = 'dish-list';
  todayDishes.forEach((dish, index) => {
    const item = document.createElement('div');
    item.className = 'dish-item';
    const info = document.createElement('div');
    info.className = 'dish-item-info';
    const name = document.createElement('div');
    name.className = 'dish-item-name';
    name.textContent = dish.description;
    info.appendChild(name);
    if (dish.price) {
      const price = document.createElement('div');
      price.className = 'dish-item-price';
      price.textContent = `${dish.price} kr`;
      info.appendChild(price);
    }
    const featured = document.createElement('label');
    featured.className = 'dish-featured';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = dish.is_featured === true;
    checkbox.addEventListener('change', () => toggleFeaturedDish(index, checkbox.checked));
    const featuredText = document.createElement('span');
    featuredText.textContent = 'Visa som populär rätt';
    featured.append(checkbox, featuredText);
    info.appendChild(featured);
    const remove = document.createElement('button');
    remove.className = 'dish-item-delete';
    remove.type = 'button';
    remove.textContent = 'Ta bort';
    remove.addEventListener('click', () => deleteDish(index));
    item.append(info, remove);
    wrapper.appendChild(item);
  });
  list.appendChild(wrapper);
  document.getElementById('menuStatus').textContent = `${todayDishes.length} rätt${todayDishes.length>1?'er':''}`;
  document.getElementById('menuStatus').className = 'section-status set';
  renderSummary();
}

async function toggleFeaturedDish(index, isFeatured) {
  const dish = todayDishes[index];
  if (!dish) return;

  const featuredCount = todayDishes.filter((item, itemIndex) => itemIndex !== index && item.is_featured === true).length;
  if (isFeatured && featuredCount >= 2) {
    showMsg('menuMsg', 'Du kan visa max 2 populära rätter på kortet.', 'error');
    renderDishes();
    return;
  }

  let query = sb.from('menus').update({ is_featured: isFeatured }).eq('restaurant_id', currentRestaurant.id);
  query = dish.id ? query.eq('id', dish.id) : query.eq('description', dish.description);
  const { error } = await query;
  if (error) {
    showMsg('menuMsg', 'Kunde inte uppdatera populär rätt: ' + error.message, 'error');
    renderDishes();
    return;
  }

  todayDishes[index].is_featured = isFeatured;
  renderDishes();
  showMsg('menuMsg', isFeatured ? 'Rätten visas nu som populär.' : 'Rätten visas inte längre som populär.', 'success');
}

async function addDish() {
  const desc = document.getElementById('dishDesc').value.trim();
  const price = parseInt(document.getElementById('dishPrice').value) || null;
  if (!desc) { showMsg('menuMsg', 'Ange en beskrivning.', 'error'); return; }

  const today = new Date().toISOString().split('T')[0];
  const { data, error } = await sb.from('menus').insert({
    restaurant_id: currentRestaurant.id,
    date: today,
    description: desc,
    price,
    is_featured: false
  }).select('id, description, price, is_featured, created_at').single();

  if (error) { showMsg('menuMsg', 'Fel: ' + error.message, 'error'); return; }

  todayDishes.push(data || { description: desc, price, is_featured: false });
  document.getElementById('dishDesc').value = '';
  document.getElementById('dishPrice').value = '';
  renderDishes();
  showMsg('menuMsg', '✓ Rätt tillagd!', 'success');
}

async function deleteDish(index) {
  const dish = todayDishes[index];
  let query = sb.from('menus').delete().eq('restaurant_id', currentRestaurant.id);
  query = dish.id ? query.eq('id', dish.id) : query.eq('description', dish.description);
  const { error } = await query;
  if (error) { showMsg('menuMsg', 'Kunde inte ta bort rätt: ' + error.message, 'error'); return; }
  todayDishes.splice(index, 1);
  renderDishes();
  showMsg('menuMsg', 'Rätt borttagen.', 'success');
}

// -- Save hours --
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

  currentHours = rows;
  document.getElementById('hoursStatus').textContent = 'Tillagda ✓';
  document.getElementById('hoursStatus').className = 'section-status set';
  renderSummary();
  showMsg('hoursMsg', '✓ Öppettiderna är sparade!', 'success');
}

// -- Logout --
async function logout() {
  await sb.auth.signOut();
  currentRestaurant = null;
  currentUser = null;
  currentSession = null;
  todayDishes = [];
  currentHours = [];
  showDashboardSection('home');
  showPage('pageLogin');
}

// -- Helper --
function showMsg(id, text, type) {
  const el = document.getElementById(id);
  el.className = 'msg ' + type;
  el.textContent = text;
  setTimeout(() => { el.textContent = ''; el.className = 'msg'; }, 5000);
}

// -- Init --
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
    user_id: currentUser.id,
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
    showMsg('applyMsg', 'Kontrollera fälten ovan.', 'error');
    return;
  }

  try {
    const matches = await searchRestaurants({
      name: claimPayload.restaurant_name,
      city: claimPayload.city,
      address: claimPayload.address
    });
    if (matches.length > 0) {
      setApplyFlow('find');
      document.getElementById('restaurantSearchName').value = claimPayload.restaurant_name;
      document.getElementById('restaurantSearchCity').value = claimPayload.city;
      document.getElementById('restaurantSearchAddress').value = claimPayload.address;
      renderRestaurantSearchResults(matches);
      showMsg('restaurantSearchMsg', 'Denna restaurang verkar redan finnas. Vill du göra anspråk på den istället?', 'error');
      return;
    }
  } catch (e) {
    console.warn('[dashboard] duplicate restaurant check failed', e);
    showMsg('applyMsg', 'Kunde inte kontrollera om restaurangen redan finns. Försök igen.', 'error');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<div class="spinner-sm"></div> Skickar...';

  try {
    await submitClaimRequest(claimPayload);
    showMsg('applyMsg', 'Tack! Din ansökan är skickad. Vi granskar den manuellt.', 'success');
    await showPendingClaim(claimPayload);
  } catch (e) {
    showMsg('applyMsg', `Kunde inte skicka ansökan: ${e.message}`, 'error');
  }

  btn.disabled = false;
  btn.innerHTML = 'Ansök om restaurang';
}


