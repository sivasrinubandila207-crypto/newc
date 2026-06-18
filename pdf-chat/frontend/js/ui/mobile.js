/**
 * @module mobile
 * @description Mobile tab switching, toolbar toggle, and responsive init.
 */

/**
 * Switches between the sidebar (Docs) and main chat area on mobile.
 * @param {'docs'|'chat'} tab
 */
export function mobileTab(tab) {
  const sidebar = document.getElementById('sidebar');
  const tabDocs = document.getElementById('mob-tab-docs');
  const tabChat = document.getElementById('mob-tab-chat');
  if (sidebar) sidebar.classList.toggle('mobile-open', tab === 'docs');
  if (tabDocs) tabDocs.classList.toggle('active', tab === 'docs');
  if (tabChat) tabChat.classList.toggle('active', tab === 'chat');
}

/**
 * Collapses or expands the chat input toolbar.
 */
export function toggleToolbar() {
  const toolbar = document.querySelector('.input-toolbar');
  const btn = document.getElementById('toggle-toolbar-btn');
  if (!toolbar) return;
  const isCollapsed = toolbar.classList.toggle('collapsed');
  if (btn) btn.classList.toggle('active', !isCollapsed);
}

/**
 * Sets the initial toolbar state based on viewport width.
 * On mobile (≤ 640 px) it starts collapsed; on desktop it starts open.
 */
export function initMobileToolbar() {
  if (window.innerWidth <= 640) {
    const tb = document.querySelector('.input-toolbar');
    if (tb) tb.classList.add('collapsed');
  } else {
    const btn = document.getElementById('toggle-toolbar-btn');
    if (btn) btn.classList.add('active');
  }
}
