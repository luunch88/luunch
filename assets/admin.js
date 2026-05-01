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
    const data = await res.json();
    if (!res.ok || data.ok === false) {
      throw new Error(data.error || 'Adminanropet misslyckades.');
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
        field('Skapad', claim.created_at ? new Date(claim.created_at).toLocaleString('sv-SE') : ''),
        field('Adminnotering', claim.admin_note)
      ].filter(Boolean).forEach(el => grid.appendChild(el));

      const actions = document.createElement('div');
      actions.className = 'claim-actions';
      const note = document.createElement('input');
      note.className = 'form-input';
      note.placeholder = 'Adminnotering';
      note.value = claim.admin_note || '';

      const approve = document.createElement('button');
      approve.className = 'btn-primary';
      approve.type = 'button';
      approve.textContent = 'Godkänn';
      approve.addEventListener('click', () => updateClaim(claim.id, 'approved', note.value));

      const reject = document.createElement('button');
      reject.className = 'btn-secondary';
      reject.type = 'button';
      reject.textContent = 'Avvisa';
      reject.addEventListener('click', () => updateClaim(claim.id, 'rejected', note.value));

      actions.append(note, approve, reject);
      card.append(head, grid, actions);
      claimsList.appendChild(card);
    });
  }

  async function loadClaims() {
    setMsg('Hämtar ansökningar...');
    try {
      const status = statusFilter.value;
      const data = await api(`/api/admin/claims?status=${encodeURIComponent(status)}`);
      renderClaims(data.claims || []);
      setMsg(`Visar ${data.claims?.length || 0} ansökningar.`, 'success');
    } catch (e) {
      claimsList.textContent = '';
      setMsg(e.message, 'error');
    }
  }

  async function updateClaim(id, status, adminNote) {
    setMsg('Uppdaterar ansökan...');
    try {
      await api('/api/admin/claims/update', {
        method: 'POST',
        body: JSON.stringify({ id, status, admin_note: adminNote })
      });
      await loadClaims();
    } catch (e) {
      setMsg(e.message, 'error');
    }
  }

  loadBtn.addEventListener('click', loadClaims);
  statusFilter.addEventListener('change', () => {
    if (getSecret()) loadClaims();
  });
})();
