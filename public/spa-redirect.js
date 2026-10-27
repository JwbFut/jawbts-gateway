/*
 * GitHub Pages serves 404.html for client-side routes. That page stores the
 * intended URL in sessionStorage and reloads the root; restore it before Vue
 * Router reads window.location.
 *
 * Kept as an external file (rather than inline) so a strict
 * `script-src 'self'` Content Security Policy can be used.
 */
(function () {
  try {
    var redirect = sessionStorage.getItem('jawbts.gateway.spa_redirect')
    if (redirect) {
      sessionStorage.removeItem('jawbts.gateway.spa_redirect')
      history.replaceState(null, '', redirect)
    }
  } catch {
    /* sessionStorage unavailable */
  }
})()
