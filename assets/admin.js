(function () {
  const secretInput = document.getElementById('adminSecret');
  const statusFilter = document.getElementById('statusFilter');
  const loadBtn = document.getElementById('loadBtn');
  const claimsList = document.getElementById('claimsList');
  const adminMsg = document.getElementById('adminMsg');

  function setMsg(text, type = '') {
    adminMsg.className = `msg ${type}`.trim();
    adminMsg.textContent = text;
  }

  function getSecret() {
    return secretInput.value.trim();
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
    let data;
    try {
      data = await res.json();
    } catch (e) {
      data = { ok: false, error: 'API:t returnerade inte JSON.' };
    }
    const result = {
      status: res.status,
      ok: res.ok && data.ok !== false,
      data
    };

    if (!res.ok || data.ok === false) {
      const error = new Error(data.error || 'Adminanropet misslyckades.');
      error.result = result;
      throw error;
    }
    return data;
  }

  function field(label, value) {
    if (!value) return null;
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

  function renderClaims(claims) {
    claimsList.textContent = '';

    if (!claims.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'Inga ansökningar hittades.';
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
        field('Adress', claim.address),
        field('Postnummer', claim.postal_code),
        field('Ort', claim.city),
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
      lat.placeholder = 'Latitude';
      lat.inputMode = 'decimal';

      const lon = document.createElement('input');
      lon.className = 'form-input';
      lon.placeholder = 'Longitude';
      lon.inputMode = 'decimal';

      const locationHelp = document.createElement('div');
      locationHelp.className = 'field-help admin-location-help';
      locationHelp.textContent = 'Behövs för att restaurangen ska visas i nära dig-listan.';

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

      const locationGroup = document.createElement('div');
      locationGroup.className = 'admin-location-group';
      locationGroup.append(lat, lon, locationHelp);

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
      if (claim.address) params.set('address', claim.address);
      const res = await fetch(`/api/restaurants/search?${params.toString()}`);
      const data = await res.json().catch(() => ({ ok: false, error: 'API:t returnerade inte JSON.' }));
      if (!res.ok || data.ok === false) throw new Error(data.error || 'Kunde inte söka matchningar.');

      const restaurants = data.restaurants || [];
      container.textContent = '';
      if (!restaurants.length) {
        const empty = document.createElement('div');
        empty.className = 'admin-match-empty';
        empty.textContent = 'Ingen matchning hittades. Skapa ny med lat/lon.';
        container.appendChild(empty);
        onSelect('');
        return;
      }

      restaurants.slice(0, 8).forEach(restaurant => {
        const option = document.createElement('label');
        option.className = 'admin-match-option';
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = `match-${claim.id}`;
        radio.value = restaurant.id;
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
    } catch (e) {
      container.textContent = '';
      const error = document.createElement('div');
      error.className = 'admin-match-empty error';
      error.textContent = e.message;
      container.appendChild(error);
      onSelect('');
    }
  }

  async function loadClaims() {
    setMsg('Hämtar ansökningar...');
    try {
      const status = statusFilter.value;
      const data = await api(`/api/admin/claims?status=${encodeURIComponent(status)}`);
      renderClaims(data.claims || []);
      setMsg(`Visar ${data.claims?.length || 0} ärenden.`, 'success');
    } catch (e) {
      claimsList.textContent = '';
      setMsg(e.message, 'error');
    }
  }

  async function updateClaim(id, status, adminNote, lat = '', lon = '', restaurantId = '') {
    setMsg('Uppdaterar ansökan...');
    try {
      if (status === 'approved' && !restaurantId) {
        const latitude = Number(lat);
        const longitude = Number(lon);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          setMsg('Välj en matchning eller fyll i giltig latitude och longitude innan du godkänner.', 'error');
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
          latitude: lat || null,
          longitude: lon || null,
          restaurant_id: restaurantId || null
        })
      });
      await loadClaims();
      setMsg(status === 'approved' ? 'Restaurang godkänd' : (data.message || 'Ansökan uppdaterad'), 'success');
    } catch (e) {
      console.error('[admin update] failed:', e.result || e);
      const apiError = e.result?.data?.error || e.message;
      setMsg(`Kunde inte uppdatera ansökan: ${apiError}`, 'error');
    }
  }

  loadBtn.addEventListener('click', loadClaims);
  statusFilter.addEventListener('change', () => {
    if (getSecret()) loadClaims();
  });
})();
