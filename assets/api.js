(function () {
  async function getNearby({ lat, lon, category = 'alla' }) {
    const params = new URLSearchParams({
      lat: String(lat),
      lon: String(lon),
      category
    });
    const res = await fetch(`/api/nearby?${params.toString()}`);
    const data = await res.json();
    if (data?.source) console.log('Nearby source:', data.source, data.cached_at);
    if (!res.ok) throw new Error(data.error || 'Kunde inte hämta restauranger.');
    if (data.ok === false) throw new Error(data.error || 'Kunde inte hämta restauranger.');
    return data;
  }

  async function submitClaim(payload) {
    const res = await fetch('/api/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Kunde inte claima restaurangen.');
    return data;
  }

  window.LuunchAPI = { getNearby, submitClaim };
})();
