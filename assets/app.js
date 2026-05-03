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

function restaurantRouteId(place) {
  return place.restaurant_id ? `manual/${place.restaurant_id}` : place.id || place.osm_id || '';
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
  const verified = place.claimed === true || place.verified === true;
  const mapsUrl = Number.isFinite(lat) && Number.isFinite(lon)
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lon}`)}`
    : '#';

  const card = document.createElement('div');
  card.className = verified ? 'card card-verified' : 'card card-unverified';
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', `Visa ${name}`);

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
  if (verified) {
    badges.appendChild(createEl('span', 'badge badge-claimed', '✓ Verifierad'));
  } else {
    badges.appendChild(createEl('span', 'badge badge-unconfirmed', 'Info ej bekräftad'));
  }

  topInfo.appendChild(badges);
  top.appendChild(topInfo);
  card.appendChild(top);

  const body = createEl('div', 'card-body');

  if (dishes.length > 0) {
    const menu = createEl('div', 'card-menu');
    const menuHead = createEl('div', 'card-menu-head');
    menuHead.appendChild(createEl('div', 'card-menu-label', 'DAGENS LUNCH'));
    if (verified) menuHead.appendChild(createEl('div', 'card-menu-fresh', 'Uppdaterad idag'));
    menu.appendChild(menuHead);

    dishes.forEach(dish => {
      const item = createEl('div', 'card-menu-item');
      const text = createEl('div', 'card-menu-text');
      text.textContent = dish.description || dish.title || '';
      item.appendChild(text);
      if (dish.price) {
        const price = createEl('div', 'card-menu-price');
        price.textContent = `${dish.price} kr`;
        item.appendChild(price);
      }
      menu.appendChild(item);
    });
    body.appendChild(menu);
  } else {
    body.appendChild(createEl('div', 'card-missing', verified ? 'Ingen meny tillagd' : 'Ingen bekräftad meny'));
  }

  if (todayHours) {
    body.appendChild(createEl('div', 'card-today-hours', `Idag ${todayHours}`));
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
  mapsLink.addEventListener('click', event => event.stopPropagation());
  actions.appendChild(mapsLink);
  footer.appendChild(actions);
  body.appendChild(footer);

  card.appendChild(body);

  card.querySelector('.btn-fav')?.addEventListener('click', event => {
    event.stopPropagation();
    toggleFavorite(osmId, name, address, emoji);
  });
  card.addEventListener('click', () => openRestaurantDetail(place));
  card.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openRestaurantDetail(place);
    }
  });

  return card;
}

function dayLabel(dayIndex) {
  return ['Mån', 'Tis', 'Ons', 'Tor', 'Fre', 'Lör', 'Sön'][dayIndex] || '';
}

function restaurantMapsUrl(place) {
  const lat = Number(place.lat);
  const lon = Number(place.lon);
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lon}`)}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([place.name, place.address, place.city].filter(Boolean).join(' '))}`;
}

function findRestaurantByRouteId(routeId) {
  return allRestaurants.find(place => restaurantRouteId(place) === routeId || place.id === routeId || place.osm_id === routeId);
}

function setRestaurantRoute(routeId) {
  const url = new URL(window.location.href);
  url.searchParams.set('restaurant', routeId);
  window.history.pushState({ restaurant: routeId }, '', url);
}

function clearRestaurantRoute() {
  const url = new URL(window.location.href);
  url.searchParams.delete('restaurant');
  window.history.pushState({}, '', url);
}

function closeRestaurantDetail({ updateRoute = true } = {}) {
  const overlay = document.querySelector('.detail-overlay');
  overlay?.remove();
  document.body.classList.remove('detail-open');
  if (updateRoute && new URLSearchParams(window.location.search).has('restaurant')) clearRestaurantRoute();
}

function renderDetailSection(title, children) {
  const section = createEl('section', 'detail-section');
  section.appendChild(createEl('h3', 'detail-section-title', title));
  children.forEach(child => section.appendChild(child));
  return section;
}

function renderRestaurantDetail(place) {
  document.querySelector('.detail-overlay')?.remove();

  const verified = place.claimed === true || place.verified === true;
  const dishes = Array.isArray(place.dishes) ? place.dishes : [];
  const hasOwnHours = verified && place.has_luunch_hours === true;
  const todayHours = hasOwnHours
    ? place.today_hours || (place.today_opens && place.today_closes ? `${place.today_opens}-${place.today_closes}` : null)
    : null;
  const distance = Number.isFinite(place.distance_m) ? place.distance_m : null;
  const osmId = place.id || place.osm_id || restaurantRouteId(place);

  const overlay = createEl('div', 'detail-overlay');
  const wrapper = createEl('div', 'detail-wrapper');
  const panel = createEl('article', 'detail-panel detail-card');

  const top = createEl('div', 'detail-top');
  const topBar = createEl('div', 'detail-topbar');
  const back = createEl('button', 'detail-back', '← Tillbaka');
  back.type = 'button';
  back.addEventListener('click', () => closeRestaurantDetail());
  topBar.appendChild(back);

  const contact = createEl('div', 'detail-contact');
  const addressLine = [place.address, [place.postal_code, place.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const contactParts = [];
  if (addressLine) contactParts.push(`📍 ${addressLine}`);
  if (place.phone) contactParts.push(`📞 ${place.phone}`);
  if (contactParts.length > 0) contact.appendChild(createEl('span', 'detail-contact-item', contactParts.join(' · ')));
  if (contact.children.length > 0) topBar.appendChild(contact);
  top.appendChild(topBar);

  const hero = createEl('div', 'detail-hero');
  const titleWrap = createEl('div', 'detail-title-wrap');
  titleWrap.appendChild(createEl('div', 'detail-kicker', verified ? 'Verifierad restaurang' : 'Restaurang'));
  titleWrap.appendChild(createEl('h2', 'detail-title', place.name || 'Okänt ställe'));

  const meta = createEl('div', 'detail-meta');
  if (distance !== null) meta.appendChild(createEl('span', 'detail-pill detail-distance', distLabel(distance)));
  meta.appendChild(createEl('span', 'detail-pill', place.type_label || place.category || 'Restaurang'));
  if (verified) meta.appendChild(createEl('span', 'detail-pill detail-verified', '✓ Verifierad'));
  meta.appendChild(createEl('span', 'detail-pill', statusBadgeText(place.open_status || 'unknown', hasOwnHours)));
  titleWrap.appendChild(meta);
  hero.appendChild(titleWrap);
  top.appendChild(hero);
  panel.appendChild(top);

  const content = createEl('div', 'detail-content');

  const hoursSection = createEl('section', 'detail-section detail-hours-section');
  const hoursToggle = createEl('button', 'detail-hours-toggle');
  hoursToggle.type = 'button';
  hoursToggle.setAttribute('aria-expanded', 'false');
  const hoursLabel = createEl('div', 'detail-hours-toggle-text');
  hoursLabel.appendChild(createEl('span', 'detail-section-title', 'Öppettider'));
  hoursLabel.appendChild(createEl('span', 'detail-hours-today', todayHours ? `Idag ${todayHours}` : 'Öppettider saknas'));
  const hoursChevron = createEl('span', 'detail-hours-chevron', 'Veckans öppettider ↓');
  hoursToggle.append(hoursLabel, hoursChevron);
  hoursSection.appendChild(hoursToggle);

  if (Array.isArray(place.week_hours) && place.week_hours.length > 0) {
    const week = createEl('div', 'detail-week-hours');
    place.week_hours.forEach(row => {
      const line = createEl('div', 'detail-week-row');
      line.appendChild(createEl('span', '', dayLabel(row.day_of_week)));
      line.appendChild(createEl('span', '', row.opens && row.closes ? `${row.lunch_opens || row.opens}-${row.lunch_closes || row.closes}` : 'Stängt'));
      week.appendChild(line);
    });
    hoursSection.appendChild(week);
    hoursToggle.addEventListener('click', () => {
      const expanded = hoursSection.classList.toggle('expanded');
      hoursToggle.setAttribute('aria-expanded', String(expanded));
      hoursChevron.textContent = expanded ? 'Dölj veckans öppettider ↑' : 'Veckans öppettider ↓';
    });
  } else {
    hoursToggle.disabled = true;
    hoursChevron.textContent = '';
  }
  content.appendChild(hoursSection);

  if (dishes.length > 0) {
    const rows = dishes.map(dish => {
      const row = createEl('div', 'detail-menu-row');
      row.appendChild(createEl('div', 'detail-menu-name', dish.description || dish.title || 'Dagens lunch'));
      if (dish.price) row.appendChild(createEl('div', 'detail-menu-price', `${dish.price} kr`));
      return row;
    });
    content.appendChild(renderDetailSection('Dagens meny', rows));
  } else {
    content.appendChild(renderDetailSection('Dagens meny', [
      createEl('p', 'detail-muted', verified ? 'Ingen meny tillagd idag.' : 'Ingen bekräftad meny.')
    ]));
  }

  const actions = createEl('div', 'detail-actions');
  const favButton = createEl('button', 'detail-fav' + (isFavorite(osmId) ? ' saved' : ''), isFavorite(osmId) ? '❤️ Sparad' : '♡ Spara');
  favButton.type = 'button';
  favButton.addEventListener('click', () => {
    toggleFavorite(osmId, place.name || 'Restaurang', place.address || '', place.emoji || '🍽️');
    const saved = isFavorite(osmId);
    favButton.classList.toggle('saved', saved);
    favButton.textContent = saved ? '❤️ Sparad' : '♡ Spara';
  });
  const maps = createEl('a', 'detail-maps', 'Vägbeskrivning →');
  maps.href = restaurantMapsUrl(place);
  maps.target = '_blank';
  maps.rel = 'noopener';
  actions.append(favButton, maps);
  content.appendChild(actions);

  panel.appendChild(content);
  wrapper.appendChild(panel);
  overlay.appendChild(wrapper);
  overlay.addEventListener('click', event => {
    if (event.target === overlay) closeRestaurantDetail();
  });
  document.body.appendChild(overlay);
  document.body.classList.add('detail-open');
}

async function openRestaurantDetail(place, { updateRoute = true } = {}) {
  // TODO: make restaurant detail pages indexable SEO pages when real routes are added.
  const routeId = restaurantRouteId(place);
  renderRestaurantDetail(place);
  if (updateRoute && routeId) setRestaurantRoute(routeId);

  if (routeId && window.LuunchAPI.getRestaurant) {
    try {
      const fresh = await window.LuunchAPI.getRestaurant(routeId);
      renderRestaurantDetail({ ...place, ...fresh, distance_m: place.distance_m });
    } catch (e) {
      console.warn('[detail] kunde inte hämta extra restaurangdata', e.message);
    }
  }
}

async function openRestaurantFromRoute() {
  const routeId = new URLSearchParams(window.location.search).get('restaurant');
  if (!routeId) return;

  const existing = findRestaurantByRouteId(routeId);
  if (existing) {
    await openRestaurantDetail(existing, { updateRoute: false });
    return;
  }

  try {
    const restaurant = await window.LuunchAPI.getRestaurant(routeId);
    renderRestaurantDetail(restaurant);
  } catch (e) {
    showError('Kunde inte hämta restaurangen.');
  }
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
  closeRestaurantDetail();
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
  closeRestaurantDetail();
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
  closeRestaurantDetail();
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

window.addEventListener('popstate', () => {
  const routeId = new URLSearchParams(window.location.search).get('restaurant');
  if (routeId) {
    openRestaurantFromRoute();
  } else {
    closeRestaurantDetail({ updateRoute: false });
  }
});

updateClock();
setInterval(updateClock, 30000);
openRestaurantFromRoute();
