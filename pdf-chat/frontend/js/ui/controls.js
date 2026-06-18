/**
 * @module controls
 * @description Model selector, usage tracking, response style, font size,
 *              user menu dropdown, and provider test.
 */
import { DAILY_LIMIT, MODEL_LABELS, LIVE_MODELS } from '../utils/constants.js';
import { showToast } from './notifications.js';
import { getUserInfo, getTokenPayload } from '../auth/auth.js';
import { apiFetch } from '../utils/api.js';


// ── MODEL ──

/**
 * Returns the capability type of a given model.
 * @param {string} model
 * @returns {'live'|'chat'}
 */
export function getModelCapability(model) {
  return LIVE_MODELS.has(model) ? 'live' : 'chat';
}

/**
 * Returns a human-readable provider label for a model.
 * @param {string} model
 * @returns {string}
 */
export function getProviderLabel(model) {
  if (getModelCapability(model) === 'live') return 'Live';
  return (model.startsWith('gemini') || model.startsWith('gemma') || model === 'auto-fallback')
    ? 'Google'
    : 'Groq';
}

/**
 * Updates the model badge in the sidebar footer to reflect the selected model.
 */
export function updateModelBadge() {
  const val = document.getElementById('model-select')?.value || '';
  const capability = getModelCapability(val);
  const noteEl = document.getElementById('model-capability-note');
  const badgeEl = document.getElementById('model-badge');

  if (noteEl) {
    noteEl.textContent = capability === 'live' ? 'Experimental: Live API integration required' : '';
  }
  if (badgeEl) {
    badgeEl.textContent = capability === 'live'
      ? 'Experimental: Live API integration required'
      : (MODEL_LABELS[val] || 'AI Model') + ' · ' + getProviderLabel(val);
  }
}

// ── TEMPERATURE ──

/**
 * Shows a toast describing the selected temperature/match mode.
 * @param {string} val - Temperature value string
 */
export function updateTemp(val) {
  const msgs = {
    '0.9': '🎨 Creative mode — AI adds its own ideas',
    '0.6': '⚖️ Balanced mode — mix of PDF + AI',
    '0.3': '📄 Precise mode — mostly from PDF',
    '0.05': '🎯 Exact mode — strictly from PDF',
  };
  showToast(msgs[val] || '');
}

// ── FONT SIZE ──

/**
 * Sets the root font size CSS variable.
 * @param {string} size - CSS size value e.g. '14px'
 */
export function setFontSize(size) {
  document.documentElement.style.setProperty('--font-size', size);
}

// ── RESPONSE STYLE ──

/**
 * Activates the given response style button and stores the choice in state.
 * @param {string} s - 'normal'|'short'|'detailed'|'bullets'
 */
export function setStyle(s) {
  // Delegates actual state update via window to avoid circular import with state
  if (window._setResponseStyle) window._setResponseStyle(s);
  ['normal', 'short', 'detailed', 'bullets'].forEach(id => {
    const el = document.getElementById('style-' + id);
    if (el) el.classList.toggle('active', id === s);
  });
}

// ── USAGE ──

export function getUsageData() {
  const d = JSON.parse(localStorage.getItem('ragUsage') || '{}');
  return d.date !== new Date().toDateString() ? { date: new Date().toDateString(), count: 0 } : d;
}

export function incrementUsage() {
  const d = getUsageData();
  d.count = (d.count || 0) + 1;
  localStorage.setItem('ragUsage', JSON.stringify(d));
  updateUsageUI(d.count);
}

export function manualSetUsage() {
  const cur = getUsageData().count || 0;
  const inp = prompt(`Requests used today?\n(Current: ${cur})`, cur);
  if (!inp) return;
  const v = parseInt(inp);
  if (isNaN(v) || v < 0) { showToast('⚠ Invalid number'); return; }
  const d = getUsageData();
  d.count = Math.min(v, DAILY_LIMIT);
  localStorage.setItem('ragUsage', JSON.stringify(d));
  updateUsageUI(d.count);
  showToast('✅ Usage updated!');
}

export function updateUsageUI(count) {
  const pct = Math.min((count / DAILY_LIMIT) * 100, 100);
  const countEl = document.getElementById('usage-count');
  const fillEl = document.getElementById('usage-fill');
  const resetEl = document.getElementById('usage-reset');
  if (countEl) countEl.innerHTML = `${count.toLocaleString()} <span>/ 14,400</span>`;
  if (fillEl) {
    fillEl.style.width = pct + '%';
    fillEl.className = 'usage-fill' + (pct >= 90 ? ' danger' : pct >= 60 ? ' warn' : '');
  }
  if (resetEl) {
    const now = new Date(), mid = new Date(now);
    mid.setHours(24, 0, 0, 0);
    const diff = mid - now;
    resetEl.textContent = `Resets in ${Math.floor(diff / 3600000)}h ${Math.floor((diff % 3600000) / 60000)}m`;
  }
}

export function initUsage() {
  updateUsageUI(getUsageData().count || 0);
  setInterval(() => updateUsageUI(getUsageData().count || 0), 60000);
}

// ── USER MENU DROPDOWN ──

export function toggleMenuDropdown(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('menu-dropdown');
  if (!menu) return;
  const isOpen = menu.classList.contains('open');
  closeAllDropdowns();
  if (!isOpen) {
    menu.classList.add('open');
    try {
      const user = getUserInfo();
      const payload = getTokenPayload();
      const nameEl = document.getElementById('dropdown-name');
      const emailEl = document.getElementById('dropdown-email');
      const avatarEl = document.getElementById('dropdown-avatar');
      if (nameEl) nameEl.textContent = user.name || payload?.name || 'User';
      if (emailEl) emailEl.textContent = user.email || payload?.email || '';
      if (avatarEl) avatarEl.textContent = (user.name || payload?.name || 'U').charAt(0).toUpperCase();
    } catch (_) {}
  }
}

export function closeAllDropdowns(e) {
  const menu = document.getElementById('menu-dropdown');
  const userPill = document.getElementById('user-pill');
  if (e && menu && userPill) {
    if (menu.contains(e.target) || userPill.contains(e.target)) return;
  }
  if (menu) menu.classList.remove('open');
}

// ── SCROLL TO BOTTOM ──

export function scrollToBottom() {
  const m = document.getElementById('messages');
  if (m) m.scrollTop = m.scrollHeight;
}

export function initScrollBtn() {
  const m = document.getElementById('messages');
  const btn = document.getElementById('scroll-btn');
  if (!m || !btn) return;
  m.addEventListener('scroll', () => {
    const atBottom = m.scrollHeight - m.scrollTop - m.clientHeight < 80;
    btn.classList.toggle('show', !atBottom && m.scrollHeight > m.clientHeight + 100);
  });
}

// ── SIDEBAR TABS ──

export function switchSidebarTab(tab) {
  ['docs', 'history', 'stats', 'favs', 'debug'].forEach((t, i) => {
    const btn = document.querySelectorAll('.sidebar-tab')[i];
    if (btn) btn.classList.toggle('active', t === tab);
    const panel = document.getElementById('sp-' + t);
    if (panel) panel.classList.toggle('active', t === tab);
  });
  if (tab === 'history' && window.renderHistory) window.renderHistory();
  if (tab === 'stats' && window.updateStats) window.updateStats();
  if (tab === 'favs' && window.renderFavs) window.renderFavs();
  if (tab === 'debug' && window.renderDebugPanel) window.renderDebugPanel();
}

// ── PROVIDER TEST ──

/**
 * Sends a minimal "Hi" test request to verify the selected provider is working.
 */
export async function runMinimalProviderTest() {
  const { startChatRequestMetrics, recordApiCall, finishChatRequestMetrics, debugState } = await import('../core/state.js');
  const selectedModel = document.getElementById('model-select')?.value || 'auto-fallback';
  const selectedProvider = getProviderLabel(selectedModel);
  const testModel = selectedModel === 'auto-fallback'
    ? (selectedProvider === 'Groq' ? 'llama-3.3-70b-versatile' : 'gemini-3.1-flash-lite')
    : selectedModel;
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const payload = {
    system: '',
    messages: [{ role: 'user', content: 'Hi' }],
    model: testModel,
    selectedModel,
    provider: selectedProvider,
    requestId,
    minimalTest: true,
    testMode: true,
    disableFallback: true,
    disableDocumentProcessing: true,
    disableEmbeddings: true,
    disableVectorSearch: true,
    disableOcr: true,
    temperature: 0.2,
  };
  startChatRequestMetrics(requestId, 'minimal-test');
  try {
    recordApiCall('chat');
    const data = await apiFetch('/api/chat-test', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    finishChatRequestMetrics();
    if (data.error) { showToast(`⚠ Minimal test failed: ${data.error}`, 5000); return; }
    const reply = data.content?.[0]?.text || '';
    showToast(`✅ Minimal test passed (${selectedProvider} / ${testModel})`, 4000);
    if (window.appendMsg) {
      window.appendMsg('user', 'Hi', false);
      window.appendMsg('ai', reply || 'No response received.', false);
    }
  } catch (err) {
    finishChatRequestMetrics();
    showToast(`⚠ Minimal test failed: ${err.message}`, 5000);
  }
}
