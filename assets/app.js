let allRestaurants = [];
let filteredRestaurants = [];
let fallbackRestaurants = [];
let activeFilter = 'alla';
let openNowActive = false;
let currentView = 'find';
let userLat = null;
let userLon = null;
const MAX_DISTANCE_METERS = 800;
const FALLBACK_LIMIT = 3;

const { escapeHtml, escapeAttr, showToast, setStatus, showError, showInfo, hideNotice } = window.LuunchUI;
const { distLabel } = window.LuunchGeo;
const { filterRestaurants, sortByDistance } = window.LuunchRestaurants;

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

function createEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined && text !== null) el.textContent = text;
  return el;
}

function walkingLabel(distance) {
  if (!Number.isFinite(distance)) return null;
  return `ca ${Math.max(1, Math.round(distance / 80))} min promenad`;
}

function statusBadgeText(openStatus, hasOwnHours) {
  if (!hasOwnHours) return '⏰ Öppettider saknas';
  if (openStatus === 'open') return '🍽️ Lunch öppet nu';
  if (openStatus === 'closed') return '🌙 Lunch stängt';
  return '⏰ Öppettider saknas';
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
  const hasOwnHours = (place.claimed === true || place.verified === true) && place.has_luunch_hours === true;
  const todayHours = hasOwnHours
    ? place.today_hours || (place.today_opens && place.today_closes ? `${place.today_opens}-${place.today_closes}` : null)
    : null;
  const openStatus = hasOwnHours ? place.open_status || 'unknown' : 'unknown';
  const claimed = !!place.claimed;
  const mapsUrl = Number.isFinite(lat) && Number.isFinite(lon)
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lon}`)}`
    : '#';

  const card = document.createElement('div');
  card.className = 'card';

  const top = createEl('div', 'card-top');
  top.appendChild(createEl('div', 'card-emoji-box', emoji));

  const topInfo = createEl('div', 'card-top-info');
  topInfo.appendChild(createEl('div', 'card-name', name));

  const badges = createEl('div', 'card-badges');
  if (distance !== null) {
    const dist = createEl('span', 'badge badge-dist');
    const walk = walkingLabel(distance);
    dist.textContent = walk ? `${distLabel(distance)} · ${walk}` : distLabel(distance);
    badges.appendChild(dist);
  }

  const statusClass = openStatus === 'open' && hasOwnHours
    ? 'badge badge-status badge-open'
    : openStatus === 'closed' && hasOwnHours
    ? 'badge badge-status badge-closed'
    : 'badge badge-status badge-unknown';
  badges.appendChild(createEl('span', statusClass, statusBadgeText(openStatus, hasOwnHours)));
  badges.appendChild(createEl('span', 'badge badge-type', typeLabel));
  if (claimed) badges.appendChild(createEl('span', 'badge badge-claimed', '✓ Verifierad'));

  topInfo.appendChild(badges);
  top.appendChild(topInfo);
  card.appendChild(top);

  const body = createEl('div', 'card-body');

  if (dishes.length > 0) {
    const menu = createEl('div', 'card-menu');
    menu.appendChild(createEl('div', 'card-menu-label', 'Dagens lunch'));
    dishes.forEach(dish => {
      const item = createEl('div', 'card-menu-text');
      const price = dish.price ? ` — ${dish.price} kr` : '';
      item.textContent = `• ${dish.description || ''}${price}`;
      menu.appendChild(item);
    });
    body.appendChild(menu);
  } else {
    body.appendChild(createEl('div', 'card-missing', '🍽️ Ingen meny tillagd'));
  }

  if (todayHours) {
    body.appendChild(createEl('div', 'card-today-hours', `🕐 ${todayHours}`));
  }

  const footer = createEl('div', 'card-footer');
  if (address) {
    footer.appendChild(createEl('div', 'card-address', address));
  } else {
    const spacer = createEl('div', 'card-address card-address-empty', '');
    footer.appendChild(spacer);
  }

  const actions = createEl('div', 'card-actions');
  const favButton = createEl('button', 'btn-fav' + (isFavorite(osmId) ? ' saved' : ''), isFavorite(osmId) ? '❤️' : '♡');
  favButton.type = 'button';
  favButton.dataset.fav = osmId;
  actions.appendChild(favButton);

  const mapsLink = createEl('a', 'btn-maps', 'Vägbeskrivning →');
  mapsLink.href = mapsUrl;
  mapsLink.target = '_blank';
  mapsLink.rel = 'noopener';
  actions.appendChild(mapsLink);
  footer.appendChild(actions);
  body.appendChild(footer);

  if (!claimed) {
    const claimButton = createEl('button', 'btn-claim', 'Är detta din restaurang? Lägg till meny gratis');
    claimButton.type = 'button';
    body.appendChild(claimButton);
  }

  card.appendChild(body);

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

function renderList(restaurants) {
  const container = document.getElementById('results');
  const header = document.getElementById('sectionHeader');
  const countEl = document.getElementById('sectionCount');
  container.innerHTML = '';
  header.style.display = 'flex';
  countEl.textContent = restaurants.length + ' ställen';
  restaurants.forEach(place => container.appendChild(buildCard(place)));
}

function categoryLabel(category) {
  return {
    alla: 'ställen',
    asiatiskt: 'asiatiska ställen',
    burgare: 'burgarställen',
    pizza: 'pizzaställen',
    sushi: 'sushiställen',
    vegetariskt: 'vegetariska ställen',
    thai: 'thaiställen',
    indiskt: 'indiska ställen'
  }[category] || 'ställen';
}

function countText(count, category) {
  const label = categoryLabel(category);
  return openNowActive
    ? `${count} bekräftat öppna ${label} nära dig`
    : `${count} ${label} nära dig`;
}

function setActiveNav(view) {
  currentView = view;
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const activeId = { find: 'navHome', saved: 'navSaved', deals: 'navDeals' }[view];
  document.getElementById(activeId)?.classList.add('active');
}

function setFindControlsVisible(isVisible) {
  const display = isVisible ? '' : 'none';
  document.querySelector('.hero').style.display = display;
  document.querySelector('.locate-wrap').style.display = display;
  document.querySelector('.filter-wrap').style.display = display;
  document.querySelector('.status-bar').style.display = display;
}

function renderFindStartState() {
  const container = document.getElementById('results');
  const header = document.getElementById('sectionHeader');
  header.style.display = 'none';
  container.innerHTML = '';
  hideNotice();
  setStatus('Väntar på plats…');
}

function showFind() {
  setActiveNav('find');
  setFindControlsVisible(true);
  if (allRestaurants.length > 0) {
    renderRestaurantState();
  } else {
    renderFindStartState();
  }
}

function renderRestaurantState() {
  const container = document.getElementById('results');
  const header = document.getElementById('sectionHeader');

  filteredRestaurants = filterRestaurants(allRestaurants, {
    category: activeFilter,
    maxDistanceMeters: MAX_DISTANCE_METERS,
    openNow: openNowActive
  });

  if (filteredRestaurants.length > 0) {
    fallbackRestaurants = [];
    hideNotice();
    renderList(filteredRestaurants);
    setStatus(countText(filteredRestaurants.length, activeFilter), 'live');
    return;
  }

  if (allRestaurants.length > 0) {
    const nearbyCategoryMatches = filterRestaurants(allRestaurants, {
      category: activeFilter,
      maxDistanceMeters: MAX_DISTANCE_METERS,
      openNow: false
    });
    const unknownAlternatives = nearbyCategoryMatches.filter(restaurant => restaurant.open_status === 'unknown');
    fallbackRestaurants = sortByDistance(openNowActive ? unknownAlternatives : nearbyCategoryMatches).slice(0, FALLBACK_LIMIT);
    const filterText = activeFilter === 'alla' ? 'restauranger' : categoryLabel(activeFilter);

    if (fallbackRestaurants.length === 0) {
      hideNotice();
      header.style.display = 'none';
      container.innerHTML = '';
      renderEmpty(container, 'Inga träffar', `Vi hittade inga ${filterText} inom ${MAX_DISTANCE_METERS} m.`);
      setStatus('Inga resultat', '');
      return;
    }

    const message = openNowActive
      ? `Vi hittade inga bekräftat öppna ${filterText} nära dig – visar ${fallbackRestaurants.length} närmaste med okända öppettider.`
      : `Inga ${filterText} inom ${MAX_DISTANCE_METERS} m – visar ${fallbackRestaurants.length} närmaste alternativ.`;
    showInfo(message);
    renderList(fallbackRestaurants);
    setStatus(message, '');
    return;
  }

  filteredRestaurants = [];
  fallbackRestaurants = [];
  hideNotice();
  header.style.display = 'none';
  container.innerHTML = '';
  renderEmpty(container, 'Inga restauranger hittades', `Vi hittade inga restauranger inom ${MAX_DISTANCE_METERS} meter.`);
  setStatus('Inga resultat', '');
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
  if (btn) {
    const saved = isFavorite(osmId);
    btn.textContent = saved ? '❤️' : '♡';
    btn.classList.toggle('saved', saved);
  }
}

function showSaved() {
  setActiveNav('saved');
  setFindControlsVisible(false);
  hideNotice();

  const favs = getFavorites();
  const container = document.getElementById('results');
  const header = document.getElementById('sectionHeader');
  const countEl = document.getElementById('sectionCount');

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
  setActiveNav('deals');
  setFindControlsVisible(false);
  hideNotice();
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
  const params = new URLSearchParams({
    mode: 'signup',
    restaurant_id: osmId,
    restaurant_name: name
  });
  if (address) params.set('address', address);
  if (Number.isFinite(lat)) params.set('lat', String(lat));
  if (Number.isFinite(lon)) params.set('lon', String(lon));
  window.location.href = `/dashboard.html?${params.toString()}`;
}

async function loadNearby() {
  if (!userLat || !userLon) return;
  const label = document.getElementById('locateLabel');
  const sub = document.getElementById('locateSub');
  label.textContent = 'Söker restauranger…';
  sub.textContent = 'Kollar vad som är nära';
  setStatus('Söker lunchställen…');
  hideNotice();

  const payload = await window.LuunchAPI.getNearby({ lat: userLat, lon: userLon, category: 'alla' });
  allRestaurants = sortByDistance(payload.restaurants || []);
  renderRestaurantState();
  if (allRestaurants.length > 0) showToast(`${allRestaurants.length} lunchställen nära dig! 🍽️`);
}

async function filterChip(el, type) {
  if (currentView !== 'find') showFind();
  document.querySelectorAll('.filters .chip:not(#openNowChip)').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  activeFilter = type;
  if (allRestaurants.length > 0) {
    renderRestaurantState();
  } else if (userLat && userLon) {
    try {
      await loadNearby();
    } catch (e) {
      showError('Kunde inte uppdatera filtret. Försök igen.');
      setStatus('Anslutningsfel', 'err');
    }
  } else {
    renderRestaurantState();
  }
}

function toggleOpenNow(el) {
  if (currentView !== 'find') showFind();
  openNowActive = !openNowActive;
  el.classList.toggle('active', openNowActive);
  renderRestaurantState();
}

async function locate() {
  const btn = document.getElementById('locateBtn');
  const label = document.getElementById('locateLabel');
  const sub = document.getElementById('locateSub');
  if (!navigator.geolocation) {
    showError('Din webbläsare stöder inte platsinformation.');
    return;
  }

  setActiveNav('find');
  setFindControlsVisible(true);

  btn.classList.add('loading');
  label.textContent = 'Hämtar din plats…';
  sub.textContent = 'Aktiverar GPS';
  hideNotice();
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
