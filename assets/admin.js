(function () {
  const secretInput = document.getElementById('adminSecret');
  const statusFilter = document.getElementById('statusFilter');
  const loadBtn = document.getElementById('loadBtn');
  const claimsList = document.getElementById('claimsList');
  const restaurantClaimsList = document.getElementById('restaurantClaimsList');
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
      const note = document.createElement('input');
      note.className = 'form-input';
      note.placeholder = 'Adminnotering';
      note.value = claim.admin_note || '';

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
      approve.addEventListener('click', () => updateClaim(claim.id, 'approved', note.value, lat.value, lon.value));

      const reject = document.createElement('button');
      reject.className = 'btn-secondary';
      reject.type = 'button';
      reject.textContent = 'Avvisa';
      reject.addEventListener('click', () => updateClaim(claim.id, 'rejected', note.value));

      const locationGroup = document.createElement('div');
      locationGroup.className = 'admin-location-group';
      locationGroup.append(lat, lon, locationHelp);

      actions.append(note, locationGroup, approve, reject);
      card.append(head, grid, actions);
      claimsList.appendChild(card);
    });
  }

  function renderRestaurantClaims(claims) {
    restaurantClaimsList.textContent = '';

    if (!claims.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'Inga anspråk på befintliga restauranger hittades.';
      restaurantClaimsList.appendChild(empty);
      return;
    }

    claims.forEach(claim => {
      const restaurant = claim.restaurant || {};
      const card = document.createElement('article');
      card.className = 'claim-card';

      const head = document.createElement('div');
      head.className = 'claim-head';
      const title = document.createElement('div');
      title.className = 'claim-title';
      title.textContent = restaurant.name || 'Restaurang';
      const status = document.createElement('div');
      status.className = `status-pill ${claim.status || 'pending'}`;
      status.textContent = claim.status || 'pending';
      head.append(title, status);

      const grid = document.createElement('div');
      grid.className = 'claim-grid';
      [
        field('Restaurang', restaurant.name),
        field('Adress', [restaurant.address, restaurant.postal_code, restaurant.city].filter(Boolean).join(', ')),
        field('Restaurangstatus', restaurant.status),
        field('Kontaktperson', claim.contact_name),
        field('Roll', claim.role),
        field('E-post', claim.email),
        field('Telefon', claim.phone),
        field('Organisationsnummer', claim.org_number),
        field('Meddelande', claim.message),
        field('User ID', claim.user_id),
        field('Restaurant ID', claim.restaurant_id),
        field('Skapad', claim.created_at ? new Date(claim.created_at).toLocaleString('sv-SE') : '')
      ].filter(Boolean).forEach(el => grid.appendChild(el));

      const actions = document.createElement('div');
      actions.className = 'claim-actions simple';
      const approve = document.createElement('button');
      approve.className = 'btn-primary';
      approve.type = 'button';
      approve.textContent = 'Godkänn';
      approve.disabled = claim.status !== 'pending';
      approve.addEventListener('click', () => updateRestaurantClaim(claim.id, 'approved'));

      const reject = document.createElement('button');
      reject.className = 'btn-secondary';
      reject.type = 'button';
      reject.textContent = 'Neka';
      reject.disabled = claim.status !== 'pending';
      reject.addEventListener('click', () => updateRestaurantClaim(claim.id, 'rejected'));

      actions.append(approve, reject);
      card.append(head, grid, actions);
      restaurantClaimsList.appendChild(card);
    });
  }

  async function loadClaims() {
    setMsg('Hämtar ansökningar...');
    try {
      const status = statusFilter.value;
      const [restaurantClaims, data] = await Promise.all([
        api(`/api/admin/restaurant-claims?status=${encodeURIComponent(status)}`),
        api(`/api/admin/claims?status=${encodeURIComponent(status)}`)
      ]);
      renderRestaurantClaims(restaurantClaims.claims || []);
      renderClaims(data.claims || []);
      setMsg(`Visar ${(restaurantClaims.claims?.length || 0) + (data.claims?.length || 0)} ärenden.`, 'success');
    } catch (e) {
      claimsList.textContent = '';
      restaurantClaimsList.textContent = '';
      setMsg(e.message, 'error');
    }
  }

  async function updateRestaurantClaim(id, status) {
    setMsg('Uppdaterar anspråk...');
    try {
      const data = await api('/api/admin/restaurant-claims/update', {
        method: 'POST',
        body: JSON.stringify({ id, status })
      });
      await loadClaims();
      setMsg(data.message || 'Anspråk uppdaterat', 'success');
    } catch (e) {
      console.error('[admin restaurant claim update] failed:', e.result || e);
      const apiError = e.result?.data?.error || e.message;
      setMsg(`Kunde inte uppdatera anspråk: ${apiError}`, 'error');
    }
  }

  async function updateClaim(id, status, adminNote, lat = '', lon = '') {
    setMsg('Uppdaterar ansökan...');
    try {
      if (status === 'approved') {
        const latitude = Number(lat);
        const longitude = Number(lon);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          setMsg('Fyll i giltig latitude och longitude innan du godkänner.', 'error');
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
          longitude: lon || null
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
