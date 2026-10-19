// No providers, analytics or app bundle run while the confirmation is in the URL.
(() => {
  const params = new URLSearchParams(window.location.hash.slice(1));
  window.history.replaceState(null, '', window.location.pathname);
  try {
    const key = 'lerne_auth_v2_pending';
    const pending = JSON.parse(sessionStorage.getItem(key) || 'null');
    const assertion = params.get('assertion');
    if (pending?.provider !== 'lerne' || pending.id !== params.get('request_id')
        || (!params.has('error') && (!assertion || assertion.length > 4096))) {
      sessionStorage.setItem('lerne_sso_callback_error', 'invalid_callback');
    } else {
      pending.assertion = params.has('error') ? null : assertion;
      pending.callbackError = params.has('error') ? 'cancelled' : null;
      pending.expiresAt = new Date(Math.min(Date.parse(pending.expiresAt), Date.now() + 60000)).toISOString();
      sessionStorage.setItem(key, JSON.stringify(pending));
    }
    window.location.replace('/');
  } catch {
    // Storage must be available to bind this tab to its original login request.
    document.body.textContent = 'Lerne: browser storage is unavailable. Return to Game Test and start sign-in again.';
  }
})();
