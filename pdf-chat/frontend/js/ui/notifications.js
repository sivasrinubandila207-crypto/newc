/**
 * @module notifications
 * @description Toast notifications and connection status indicator.
 */

/**
 * Shows a brief toast message at the bottom of the screen.
 * @param {string} msg - Message text
 * @param {number} [ms=2500] - Duration in milliseconds
 */
export function showToast(msg, ms = 2500) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), ms);
}

/**
 * Updates the connection status dot in the chat header.
 */
export function updateConnStatus() {
  const dot = document.getElementById('status-dot');
  if (!dot) return;
  if (navigator.onLine) {
    dot.className = 'status-dot online';
    dot.title = 'Online';
  } else {
    dot.className = 'status-dot offline';
    dot.title = 'Offline';
  }
}

/**
 * Registers online/offline event listeners and sets initial status.
 */
export function initConnStatus() {
  window.addEventListener('online', updateConnStatus);
  window.addEventListener('offline', updateConnStatus);
  updateConnStatus();
}
