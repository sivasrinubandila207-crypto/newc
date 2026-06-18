/**
 * @module theme
 * @description Dark/light theme toggle with localStorage persistence.
 */

/**
 * Toggles between light and dark themes and saves preference.
 */
export function toggleTheme() {
  const h = document.documentElement;
  const isLight = h.dataset.theme === 'light';
  h.dataset.theme = isLight ? 'dark' : 'light';
  const btn = document.getElementById('theme-btn');
  if (btn) btn.textContent = isLight ? '☀️' : '🌙';
  localStorage.setItem('ragTheme', h.dataset.theme);
}

/**
 * Restores the saved theme preference on page load.
 */
export function restoreTheme() {
  const saved = localStorage.getItem('ragTheme');
  if (saved) {
    document.documentElement.dataset.theme = saved;
    const btn = document.getElementById('theme-btn');
    if (btn) btn.textContent = saved === 'light' ? '🌙' : '☀️';
  }
}
