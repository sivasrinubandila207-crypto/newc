/**
 * @module auth
 * @description JWT authentication guard and session management.
 */

/**
 * Returns the auth header object for API requests.
 * @returns {{ 'Content-Type': string, 'Authorization': string }}
 */
export function getAuthHeaders() {
  const token = localStorage.getItem('ragToken') || '';
  return {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + token,
  };
}

/**
 * Decodes the stored JWT and returns the payload, or null if invalid/expired.
 * @returns {Object|null}
 */
export function getTokenPayload() {
  const token = localStorage.getItem('ragToken');
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    if (payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Returns stored user info (name, email) from localStorage.
 * @returns {{ name: string, email: string }}
 */
export function getUserInfo() {
  try {
    return JSON.parse(localStorage.getItem('ragUser') || '{}');
  } catch {
    return {};
  }
}

/**
 * Validates the JWT on page load. Redirects to login.html if invalid or expired.
 * Also populates the header name/avatar from the token payload.
 */
export function authGuard() {
  const payload = getTokenPayload();
  if (!payload) {
    localStorage.removeItem('ragToken');
    localStorage.removeItem('ragUser');
    window.location.href = 'login.html';
    return;
  }
  const user = getUserInfo();
  const name = user.name || payload.name || 'User';
  const nameEl = document.getElementById('user-name');
  const avatarEl = document.getElementById('user-avatar');
  if (nameEl) nameEl.textContent = name.split(' ')[0];
  if (avatarEl) avatarEl.textContent = name.charAt(0).toUpperCase();
}

/**
 * Clears all session data from localStorage and redirects to login.html.
 */
export function logout() {
  ['ragToken', 'ragUser', 'ragSessions', 'ragFavs'].forEach(key => {
    try { localStorage.removeItem(key); } catch (_) {}
  });
  try {
    window.location.href = 'login.html';
  } catch (_) {
    try { window.location.replace('login.html'); } catch (__) {}
  }
}
