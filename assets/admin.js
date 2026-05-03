(function () {
  const titles = {
    requests: ['Förfrågningar', 'Granska inkomna restaurangansökningar och koppla dem till rätt restaurang.'],
    restaurants: ['Alla restauranger', 'Sök och kontrollera restauranger som finns i Supabase.'],
    import: ['Importera restauranger', 'Fyll på restaurangdatabasen ort för ort.'],
    settings: ['Inställningar', 'Hantera adminsessionen.']
  };

  const loginView = document.getElementById('adminLogin');
  const appView = document.getElementById('adminApp');
  const secretInput = document.getElementById('adminSecret');
  const loginBtn = document.getElementById('loginBtn');
  const loginMsg = document.getElementById('loginMsg');
  const adminMsg = document.getElementById('adminMsg');
  const statusFilter = document.getElementById('statusFilter');
  const claimsList = document.getElementById('claimsList');
  const restaurantsList = document.getElementById('restaurantsList');
  const restaurantQuery = document.getElementById('restaurantQuery');
  const importCity = document.getElementById('importCity');
  const importResult = document.getElementById('importResult');

  function setMsg(target, text, type = '') {
    target.className = `msg ${type}`.trim();
    target.textContent = text;
  }

  function getSecret() {
    return sessionStorage.getItem('luunch_admin_secret') || secretInput.value.trim();
  }

  function setLoggedIn(isLoggedIn) {
    loginView.classList.toggle('active', !isLoggedIn);
    appView.classList.toggle('active', isLoggedIn);
  }

  async function api(path, options = {}) {
    const secret = getSecret();
    if (!secret) throw new Error('Skriv adminnyckel först.');

    const res = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'x-admin-secret': secret,
        ...(options.headers || {})
      }
    });
    const data = await res.json().catch(() => ({ ok: false, error: 'API:t returnerade inte JSON.' }));
    if (!res.ok || data.ok === false) {
      throw new Error(data.error || 'Adminanropet misslyckades.');
    }
    return data;
  }

  function field(label, value) {
    if (value === null || value === undefined || value === '') return null;
    const wrapper = document.createElement('div');
    wrapper.className = 'claim-field';
    const labelEl = document.createElement('div');
    labelEl.className = 'claim-label';
    labelEl.textContent = label;
    const valueEl = document.createElement('div');
    valueEl.className = 'claim-value';
    valueEl.textContent = value;
    wrapper.append(labelEl, valueEl);
    return wrapper;
  }

  function showSection(section) {
    document.querySelectorAll('.admin-nav').forEach(button => {
      button.classList.toggle('active', button.dataset.section === section);
    });
    document.querySelectorAll('.admin-section').forEach(panel => panel.classList.remove('active'));
    document.getElementById(`section${section[0].toUpperCase()}${section.slice(1)}`)?.classList.add('active');
    document.getElementById('sectionTitle').textContent = titles[section][0];
    document.getElementById('sectionSub').textContent = titles[section][1];
    adminMsg.textContent = '';
  }

  async function login() {
    const secret = secretInput.value.trim();
    if (!secret) {
      setMsg(loginMsg, 'Skriv adminnyckel.', 'error');
      return;
    }
    sessionStorage.setItem('luunch_admin_secret', secret);
    try {
      await loadClaims();
      setLoggedIn(true);
      showSection('requests');
    } catch (error) {
      sessionStorage.removeItem('luunch_admin_secret');
      setMsg(loginMsg, error.message, 'error');
    }
  }

  function renderClaims(claims) {
    claimsList.textContent = '';
    if (!claims.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'Inga förfrågningar hittades.';
      claimsList.appendChild(empty);
      return;
    }

    claims.forEach(claim => {
      const card = document.createElement('article');
      card.className = 'claim-card';

      const head = document.createElement('div');
      head.className = 'claim-head';
      const title = document.createElement('div');
      title.className = 'claim-title';
      title.textContent = claim.restaurant_name || 'Namnlös restaurang';
      const status = document.createElement('div');
      status.className = `status-pill ${claim.status || 'pending'}`;
      status.textContent = claim.status || 'pending';
      head.append(title, status);

      const grid = document.createElement('div');
      grid.className = 'claim-grid';
      [
        field('Adress', [claim.address, claim.postal_code, claim.city].filter(Boolean).join(', ')),
        field('Typ', claim.restaurant_type),
        field('Kontaktperson', claim.contact_person),
        field('E-post', claim.email),
        field('Telefon', claim.phone),
        field('Hemsida', claim.website),
        field('Organisationsnummer', claim.organization_number),
        field('Meddelande', claim.message),
        field('User ID', claim.user_id),
        field('Skapad', claim.created_at ? new Date(claim.created_at).toLocaleString('sv-SE') : ''),
        field('Adminnotering', claim.admin_note)
      ].filter(Boolean).forEach(el => grid.appendChild(el));

      const actions = document.createElement('div');
      actions.className = 'claim-actions';
      let selectedRestaurantId = '';

      const note = document.createElement('input');
      note.className = 'form-input';
      note.placeholder = 'Adminnotering';
      note.value = claim.admin_note || '';

      const matchGroup = document.createElement('div');
      matchGroup.className = 'admin-match-group';
      const matchBtn = document.createElement('button');
      matchBtn.className = 'btn-secondary';
      matchBtn.type = 'button';
      matchBtn.textContent = 'Sök matchningar';
      const matchList = document.createElement('div');
      matchList.className = 'admin-match-list';
      matchBtn.addEventListener('click', () => searchClaimMatches(claim, matchList, restaurantId => {
        selectedRestaurantId = restaurantId;
      }));
      matchGroup.append(matchBtn, matchList);

      const lat = document.createElement('input');
      lat.className = 'form-input';
      lat.placeholder = 'Latitude för ny';
      lat.inputMode = 'decimal';
      const lon = document.createElement('input');
      lon.className = 'form-input';
      lon.placeholder = 'Longitude för ny';
      lon.inputMode = 'decimal';
      const locationGroup = document.createElement('div');
      locationGroup.className = 'admin-location-group';
      locationGroup.append(lat, lon);

      const approve = document.createElement('button');
      approve.className = 'btn-primary';
      approve.type = 'button';
      approve.textContent = 'Godkänn';
      approve.addEventListener('click', () => updateClaim(claim.id, 'approved', note.value, lat.value, lon.value, selectedRestaurantId));

      const reject = document.createElement('button');
      reject.className = 'btn-secondary';
      reject.type = 'button';
      reject.textContent = 'Avvisa';
      reject.addEventListener('click', () => updateClaim(claim.id, 'rejected', note.value));

      actions.append(note, matchGroup, locationGroup, approve, reject);
      card.append(head, grid, actions);
      claimsList.appendChild(card);
    });
  }

  async function searchClaimMatches(claim, container, onSelect) {
    container.textContent = 'Söker...';
    try {
      const params = new URLSearchParams();
      if (claim.restaurant_name) params.set('q', claim.restaurant_name);
      if (claim.city) params.set('city', claim.city);
      params.set('refresh_external', '1');
      const res = await fetch(`/api/restaurants/search?${params.toString()}`);
      const data = await res.json().catch(() => ({ ok: false, error: 'API:t returnerade inte JSON.' }));
      if (!res.ok || data.ok === false) throw new Error(data.error || 'Kunde inte söka matchningar.');
      renderMatchOptions(container, data.restaurants || [], claim.id, onSelect);
    } catch (error) {
      container.textContent = '';
      const el = document.createElement('div');
      el.className = 'admin-match-empty error';
      el.textContent = error.message;
      container.appendChild(el);
      onSelect('');
    }
  }

  function renderMatchOptions(container, restaurants, claimId, onSelect) {
    container.textContent = '';
    if (!restaurants.length) {
      const empty = document.createElement('div');
      empty.className = 'admin-match-empty';
      empty.textContent = 'Ingen matchning hittades. Skapa ny med lat/lon.';
      container.appendChild(empty);
      onSelect('');
      return;
    }
    restaurants.slice(0, 10).forEach(restaurant => {
      const option = document.createElement('label');
      option.className = 'admin-match-option';
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = `match-${claimId}`;
      radio.addEventListener('change', () => onSelect(restaurant.id));
      const text = document.createElement('span');
      text.textContent = [
        restaurant.name,
        [restaurant.address, restaurant.postal_code, restaurant.city].filter(Boolean).join(', '),
        restaurant.status
      ].filter(Boolean).join(' - ');
      option.append(radio, text);
      container.appendChild(option);
    });
  }

  async function loadClaims() {
    setMsg(adminMsg, 'Hämtar förfrågningar...');
    try {
      const data = await api(`/api/admin/claims?status=${encodeURIComponent(statusFilter.value)}`);
      renderClaims(data.claims || []);
      setMsg(adminMsg, `Visar ${data.claims?.length || 0} förfrågningar.`, 'success');
    } catch (error) {
      claimsList.textContent = '';
      setMsg(adminMsg, error.message, 'error');
    }
  }

  async function updateClaim(id, status, adminNote, lat = '', lon = '', restaurantId = '') {
    setMsg(adminMsg, 'Uppdaterar förfrågan...');
    try {
      if (status === 'approved' && !restaurantId) {
        const latitude = Number(lat);
        const longitude = Number(lon);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          setMsg(adminMsg, 'Välj en matchning eller fyll i giltig latitude och longitude.', 'error');
          return;
        }
      }

      const data = await api('/api/admin/claims/update', {
        method: 'POST',
        body: JSON.stringify({
          id,
          status,
          admin_note: adminNote,
          lat: lat || null,
          lon: lon || null,
          restaurant_id: restaurantId || null
        })
      });
      await loadClaims();
      setMsg(adminMsg, data.message || 'Förfrågan uppdaterad.', 'success');
    } catch (error) {
      setMsg(adminMsg, error.message, 'error');
    }
  }

  function renderRestaurants(restaurants) {
    restaurantsList.textContent = '';
    if (!restaurants.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'Inga restauranger hittades.';
      restaurantsList.appendChild(empty);
      return;
    }
    restaurants.forEach(restaurant => {
      const row = document.createElement('article');
      row.className = 'restaurant-row';
      const title = document.createElement('div');
      title.className = 'restaurant-row-title';
      title.textContent = restaurant.name || 'Namnlös restaurang';
      const meta = document.createElement('div');
      meta.className = 'restaurant-row-meta';
      meta.textContent = [
        [restaurant.address, restaurant.postal_code, restaurant.city].filter(Boolean).join(', '),
        restaurant.category,
        restaurant.status || (restaurant.claimed ? 'claimed' : 'unclaimed'),
        restaurant.source
      ].filter(Boolean).join(' - ');
      row.append(title, meta);
      restaurantsList.appendChild(row);
    });
  }

  async function loadRestaurants() {
    setMsg(adminMsg, 'Hämtar restauranger...');
    try {
      const params = new URLSearchParams();
      if (restaurantQuery.value.trim()) params.set('q', restaurantQuery.value.trim());
      const data = await api(`/api/admin/restaurants?${params.toString()}`);
      renderRestaurants(data.restaurants || []);
      setMsg(adminMsg, `Visar ${data.restaurants?.length || 0} restauranger.`, 'success');
    } catch (error) {
      restaurantsList.textContent = '';
      setMsg(adminMsg, error.message, 'error');
    }
  }

  async function importCityRestaurants() {
    const city = importCity.value.trim();
    if (!city) {
      importResult.textContent = 'Ange ort.';
      return;
    }
    importResult.textContent = 'Importerar...';
    try {
      const params = new URLSearchParams({ city, refresh_external: '1', debug: '1' });
      const res = await fetch(`/api/restaurants/search?${params.toString()}`);
      const data = await res.json().catch(() => ({ ok: false, error: 'API:t returnerade inte JSON.' }));
      if (!res.ok || data.ok === false) throw new Error(data.error || 'Import misslyckades.');
      importResult.textContent = `Klart. ${data.restaurants?.length || 0} restauranger finns nu för ${city}. Importerade: ${data.debug?.imported ?? 'ok'}.`;
    } catch (error) {
      importResult.textContent = error.message;
    }
  }

  loginBtn.addEventListener('click', login);
  document.getElementById('logoutBtn').addEventListener('click', () => {
    sessionStorage.removeItem('luunch_admin_secret');
    setLoggedIn(false);
  });
  document.getElementById('clearSecretBtn').addEventListener('click', () => {
    sessionStorage.removeItem('luunch_admin_secret');
    setMsg(adminMsg, 'Adminnyckeln är borttagen från sessionen.', 'success');
  });
  document.getElementById('loadClaimsBtn').addEventListener('click', loadClaims);
  document.getElementById('loadRestaurantsBtn').addEventListener('click', loadRestaurants);
  document.getElementById('importCityBtn').addEventListener('click', importCityRestaurants);
  statusFilter.addEventListener('change', loadClaims);
  document.querySelectorAll('.admin-nav').forEach(button => {
    button.addEventListener('click', () => showSection(button.dataset.section));
  });

  const savedSecret = sessionStorage.getItem('luunch_admin_secret');
  if (savedSecret) {
    secretInput.value = savedSecret;
    setLoggedIn(true);
    showSection('requests');
    loadClaims();
  }
})();
