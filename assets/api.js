(function () {
  function shouldForceNearby() {
    return new URLSearchParams(window.location.search).get('force') === '1';
  }

  async function getNearby({ lat, lon, category = 'alla', force = shouldForceNearby() }) {
    const params = new URLSearchParams({
      lat: String(lat),
      lon: String(lon),
      category
    });
    if (force) params.set('force', '1');
    const res = await fetch(`/api/nearby?${params.toString()}`);
    const data = await res.json();
    if (data?.source) console.log('Nearby source:', data.source, data.cached_at);
    if (!res.ok) throw new Error(data.error || 'Kunde inte hämta restauranger.');
    if (data.ok === false) throw new Error(data.error || 'Kunde inte hämta restauranger.');
    return data;
  }

  async function submitClaim(payload, accessToken) {
    const res = await fetch('/api/claim', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { 'Authorization': `Bearer ${accessToken}` } : {})
      },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Kunde inte claima restaurangen.');
    if (data.ok === false) throw new Error(data.error || 'Kunde inte claima restaurangen.');
    return data;
  }

  window.LuunchAPI = { getNearby, submitClaim };
})();
