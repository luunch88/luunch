(function () {
  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function escapeAttr(value) {
    return escapeHtml(value).replaceAll('`', '&#096;');
  }

  function showToast(msg) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2800);
  }

  function setStatus(msg, state = '') {
    const text = document.getElementById('statusText');
    const dot = document.getElementById('statusDot');
    if (text) text.textContent = msg;
    if (dot) dot.className = 'status-dot' + (state ? ' ' + state : '');
  }

  function showError(msg) {
    const b = document.getElementById('errorBox');
    if (!b) return;
    b.textContent = msg;
    b.classList.add('show');
  }

  function hideError() {
    document.getElementById('errorBox')?.classList.remove('show');
  }

  window.LuunchUI = {
    escapeHtml,
    escapeAttr,
    showToast,
    setStatus,
    showError,
    hideError
  };
})();
