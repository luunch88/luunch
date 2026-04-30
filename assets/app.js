let allPlaces = [];
let activeFilter = 'alla';
let userLat = null;
let userLon = null;

const { escapeHtml, escapeAttr, showToast, setStatus, showError, hideError } = window.LuunchUI;
const { distLabel } = window.LuunchGeo;
const { matchFilter } = window.LuunchRestaurants;

function updateClock() {
  const now = new Date();
  const h = now.getHours();
  const m = String(now.getMinutes()).padStart(2, '0');
  document.getElementById('timePill').textContent = `${h}:${m}`;
  const isLunch = h >= 11 && h < 14;
  document.getElementById('lunchDot').className = 'lunch-dot' + (isLunch ? ' active' : '');
  const tag = document.getElementById('heroTag');
  tag.textContent = isLunch ? '🟢 Lunch pågår just nu' : h < 11 ? `⏳ Lunch om ${11 - h} timmar` : '✅ Lunch avslutad';
}

function getFavorites() {
  try {
    return JSON.parse(localStorage.getItem('luunch_favs') || '[]');
  } catch (e) {
    return [];
  }
}

function saveFavorites(favs) {
  localStorage.setItem('luunch_favs', JSON.stringify(favs));
}

function isFavorite(osmId) {
  return getFavorites().some(f => f.osmId === osmId);
}

function buildCard(place) {
  const osmId = place.id || place.osm_id || '';
  const name = place.name || 'Okänt ställe';
  const lat = Number(place.lat);
  const lon = Number(place.lon);
  const distance = Number.isFinite(place.distance_m) ? place.distance_m : null;
  const emoji = place.emoji || '🍽️';
  const typeLabel = place.type_label || place.category || 'Restaurang';
  const address = place.address || '';
  const dishes = Array.isArray(place.dishes) ? place.dishes : [];
  const hasHours = !!place.today_opens;
  const isOpen = place.is_open_now;
  const claimed = !!place.claimed;
  const mapsUrl = Number.isFinite(lat) && Number.isFinite(lon)
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lon}`)}`
    : '#';

  const hoursHtml = hasHours
    ? `<div class="card-today-hours">🕐 Idag ${escapeHtml(place.today_opens)}–${escapeHtml(place.today_closes)}</div>`
    : '';

  const openBadge = !claimed ? '' : isOpen === true
    ? '<span class="badge badge-open">● Öppet nu</span>'
    : isOpen === false
    ? '<span class="badge badge-closed">● Stängt</span>'
    : '';

  const menuHtml = dishes.length > 0
    ? `<div class="card-menu">
        <div class="card-menu-label">Dagens lunch</div>
        ${dishes.map(d => `<div class="card-menu-text">• ${escapeHtml(d.description)}${d.price ? ` — <strong>${escapeHtml(d.price)} kr</strong>` : ''}</div>`).join('')}
      </div>`
    : '';

  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <div class="card-top">
      <div class="card-emoji-box">${escapeHtml(emoji)}</div>
      <div class="card-top-info">
        <div class="card-name">${escapeHtml(name)}</div>
        <div class="card-badges">
          ${distance !== null ? `<span class="badge badge-dist">${escapeHtml(distLabel(distance))}</span>` : ''}
          ${openBadge}
          <span class="badge badge-type">${escapeHtml(typeLabel)}</span>
          ${claimed ? '<span class="badge badge-claimed">✓ Verifierad</span>' : ''}
        </div>
      </div>
    </div>
    <div class="card-body">
      ${menuHtml}
      ${hoursHtml}
      <div class="card-missing-wrap">
        ${dishes.length === 0 ? '<span class="card-missing">🍽️ Ingen meny tillagd</span>' : ''}
        ${!claimed || (!hasHours && claimed) ? '<span class="card-missing">🕐 Inga öppettider inlagda</span>' : ''}
      </div>
      <div class="card-footer">
        <div class="card-address">${escapeHtml(address || 'Se på karta')}</div>
        <button class="btn-fav" data-fav="${escapeAttr(osmId)}" type="button">${isFavorite(osmId) ? '❤️' : '🤍'}</button>
        <a href="${escapeAttr(mapsUrl)}" target="_blank" rel="noopener" class="btn-maps">Vägbeskrivning →</a>
      </div>
      ${!claimed ? '<button class="btn-claim" type="button">🏪 Är detta din restaurang?</button>' : ''}
    </div>`;

  card.querySelector('.btn-fav')?.addEventListener('click', event => {
    event.stopPropagation();
    toggleFavorite(osmId, name, address, emoji);
  });

  card.querySelector('.btn-claim')?.addEventListener('click', event => {
    event.stopPropagation();
    openClaim(osmId, name, address, Number.isFinite(lat) ? lat : 0, Number.isFinite(lon) ? lon : 0);
  });

  return card;
}

function renderEmpty(container, title, text, emoji = '😔') {
  container.innerHTML = `
    <div class="empty-state">
      <div class="empty-emoji">${escapeHtml(emoji)}</div>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(text)}</p>
    </div>`;
}

function renderCards(places) {
  const container = document.getElementById('results');
  const header = document.getElementById('sectionHeader');
  const countEl = document.getElementById('sectionCount');
  container.innerHTML = '';

  const filtered = places.filter(p => matchFilter(p, activeFilter));
  if (filtered.length === 0) {
    header.style.display = 'none';
    renderEmpty(container, 'Inga träffar', 'Inga ställen matchade filtret. Prova ett annat alternativ.');
    return;
  }

  header.style.display = 'flex';
  countEl.textContent = filtered.length + ' ställen';
  filtered.forEach(place => container.appendChild(buildCard(place)));
  setStatus(`${filtered.length} ställen hittade nära dig`, 'live');
}

function toggleFavorite(osmId, name, address, emoji) {
  let favs = getFavorites();
  if (isFavorite(osmId)) {
    favs = favs.filter(f => f.osmId !== osmId);
    showToast('Borttagen från sparat');
  } else {
    favs.push({ osmId, name, address, emoji, savedAt: Date.now() });
    showToast('❤️ Sparat!');
  }
  saveFavorites(favs);
  const btn = [...document.querySelectorAll('[data-fav]')].find(item => item.dataset.fav === osmId);
  if (btn) btn.textContent = isFavorite(osmId) ? '❤️' : '🤍';
}

function showSaved() {
  const favs = getFavorites();
  const container = document.getElementById('results');
  const header = document.getElementById('sectionHeader');
  const countEl = document.getElementById('sectionCount');

  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('navSaved').classList.add('active');

  container.innerHTML = '';
  if (favs.length === 0) {
    header.style.display = 'none';
    renderEmpty(container, 'Inga sparade ställen', 'Tryck på hjärtat på ett restaurangkort för att spara det här.', '🤍');
    return;
  }

  header.style.display = 'flex';
  countEl.textContent = favs.length + ' sparade';

  favs.forEach(fav => {
    const card = document.createElement('div');
    card.className = 'card';
    card.style.animationDelay = '0s';
    card.innerHTML = `
      <div class="card-top">
        <div class="card-emoji-box">${escapeHtml(fav.emoji || '🍽️')}</div>
        <div class="card-top-info">
          <div class="card-name">${escapeHtml(fav.name)}</div>
          <div class="card-badges"><span class="badge badge-type">Sparat</span></div>
        </div>
      </div>
      <div class="card-body">
        <div class="card-footer">
          <div class="card-address">${escapeHtml(fav.address || 'Se på karta')}</div>
          <button class="btn-maps" type="button">Ta bort</button>
        </div>
      </div>`;
    card.querySelector('button')?.addEventListener('click', () => removeFav(fav.osmId, card));
    container.appendChild(card);
  });
  setStatus(`${favs.length} sparade ställen`, 'live');
}

function removeFav(osmId, card) {
  saveFavorites(getFavorites().filter(f => f.osmId !== osmId));
  card.remove();
  if (getFavorites().length === 0) showSaved();
  showToast('Borttagen från sparat');
}

function showDeals() {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('navDeals').classList.add('active');
  document.getElementById('sectionHeader').style.display = 'none';
  document.getElementById('results').innerHTML = `
    <div class="empty-state">
      <div class="empty-emoji">⚡</div>
      <h3>Deals kommer snart</h3>
      <p>Restauranger kan snart lägga till<br>luncherbjudanden här.</p>
    </div>`;
  setStatus('');
}

function openClaim(osmId, name, address, lat, lon) {
  document.getElementById('claimOsmId').value = osmId;
  document.getElementById('claimName').textContent = name;
  document.getElementById('claimAddress').textContent = address || '';
  document.getElementById('claimLat').value = lat;
  document.getElementById('claimLon').value = lon;
  document.getElementById('claimModal').classList.add('show');
}

function closeClaim() {
  document.getElementById('claimModal').classList.remove('show');
  document.getElementById('claimEmail').value = '';
  document.getElementById('claimResult').textContent = '';
}

async function submitClaim() {
  const osmId = document.getElementById('claimOsmId').value;
  const name = document.getElementById('claimName').textContent;
  const email = document.getElementById('claimEmail').value.trim();
  const lat = parseFloat(document.getElementById('claimLat').value);
  const lon = parseFloat(document.getElementById('claimLon').value);
  const address = document.getElementById('claimAddress').textContent;
  const resultEl = document.getElementById('claimResult');

  if (!email) {
    resultEl.textContent = 'Ange din e-postadress.';
    return;
  }

  const btn = document.getElementById('claimSubmitBtn');
  btn.textContent = 'Skickar…';
  btn.disabled = true;

  try {
    const data = await window.LuunchAPI.submitClaim({ osm_id: osmId, name, email, lat, lon, address });
    resultEl.style.color = 'var(--green)';
    resultEl.textContent = '✓ ' + data.message;
  } catch (e) {
    resultEl.style.color = 'var(--red)';
    resultEl.textContent = '✗ ' + e.message;
  }

  btn.textContent = 'Claima restaurang';
  btn.disabled = false;
}

async function loadNearby() {
  if (!userLat || !userLon) return;
  const label = document.getElementById('locateLabel');
  const sub = document.getElementById('locateSub');
  label.textContent = 'Söker restauranger…';
  sub.textContent = 'Kollar vad som är nära';
  setStatus('Söker lunchställen…');

  const payload = await window.LuunchAPI.getNearby({ lat: userLat, lon: userLon, category: activeFilter });
  allPlaces = payload.restaurants || [];
  if (allPlaces.length === 0) {
    showError('Inga restauranger hittades inom 800 meter.');
    setStatus('Inga resultat', 'err');
    renderCards([]);
    return;
  }
  renderCards(allPlaces);
  showToast(`${allPlaces.length} lunchställen nära dig! 🍽️`);
}

async function filterChip(el, type) {
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  activeFilter = type;
  if (userLat && userLon) {
    try {
      await loadNearby();
    } catch (e) {
      showError('Kunde inte uppdatera filtret. Försök igen.');
      setStatus('Anslutningsfel', 'err');
    }
  } else {
    renderCards(allPlaces);
  }
}

async function locate() {
  const btn = document.getElementById('locateBtn');
  const label = document.getElementById('locateLabel');
  const sub = document.getElementById('locateSub');
  if (!navigator.geolocation) {
    showError('Din webbläsare stöder inte platsinformation.');
    return;
  }

  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('navHome')?.classList.add('active');

  btn.classList.add('loading');
  label.textContent = 'Hämtar din plats…';
  sub.textContent = 'Aktiverar GPS';
  hideError();
  setStatus('Hämtar position…');

  navigator.geolocation.getCurrentPosition(async pos => {
    userLat = pos.coords.latitude;
    userLon = pos.coords.longitude;
    try {
      await loadNearby();
    } catch (err) {
      showError('Kunde inte hämta restauranger. Kontrollera din uppkoppling.');
      setStatus('Anslutningsfel', 'err');
    }
    btn.classList.remove('loading');
    label.textContent = 'Sök igen';
    sub.textContent = 'Uppdatera resultat';
  }, err => {
    btn.classList.remove('loading');
    label.textContent = 'Hitta lunch nära mig';
    sub.textContent = 'Öppna restauranger inom gångavstånd';
    showError({
      1: 'Platsbehörighet nekad — tillåt platsdelning i webbläsaren.',
      2: 'Kunde inte hämta position.',
      3: 'Timeout — försök igen.'
    }[err.code] || 'Okänt fel.');
    setStatus('Fel', 'err');
  }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 120000 });
}

updateClock();
setInterval(updateClock, 30000);
