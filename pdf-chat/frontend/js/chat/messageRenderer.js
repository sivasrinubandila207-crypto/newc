/**
 * @module messageRenderer
 * @description Handles rendering of chat bubbles, loading state, copy buttons, and citations.
 */
import { esc, fallbackCopy } from '../utils/helpers.js';
import { showToast } from '../ui/notifications.js';
import { buildSourceCardsHtml, parseCitationString } from './citations.js';

const msgsEl = () => document.getElementById('messages');

/**
 * Copies message text to clipboard.
 * @param {HTMLButtonElement} btn
 */
export function copyMsg(btn) {
  const text = decodeURIComponent(btn.dataset.text || '');
  if (!text) return;
  const doCopy = () => {
    btn.textContent = '✅ Copied!';
    btn.classList.add('copied');
    showToast('📋 Copied!');
    setTimeout(() => {
      btn.textContent = '📋 Copy';
      btn.classList.remove('copied');
    }, 2000);
  };
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(doCopy).catch(() => fallbackCopy(text, doCopy));
  } else {
    fallbackCopy(text, doCopy);
  }
}

// Expose copyMsg globally for inline onclick attributes
window.copyMsg = copyMsg;

/**
 * Converts a citations array (e.g. ["doc.pdf p.3"]) into citedSource objects.
 * Uses the shared parseCitationString helper to avoid duplication.
 * @param {string[]} citations
 * @returns {Array<{ docName: string, pageNum: number }>}
 */
function citationsToSources(citations) {
  if (!citations?.length) return [];
  const seen = new Set();
  const result = [];
  citations.forEach(c => {
    const parsed = parseCitationString(c);
    if (parsed) {
      const key = `${parsed.docName}||${parsed.pageNum}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(parsed);
      }
    }
  });
  return result;
}

/**
 * Builds a complete message row innerHTML string.
 * Single template used by appendMsgDirect, appendMsg, and renderChatHistory.
 * @param {'ai'|'user'} role
 * @param {string} parsedContent - HTML-safe parsed content
 * @param {string} [sourcesHtml=''] - Source cards HTML (AI only)
 * @param {boolean} [loading=false] - Show loading dots instead of content
 * @returns {string}
 */
function buildMsgRowHtml(role, parsedContent, sourcesHtml = '', loading = false) {
  const avatar = role === 'user' ? 'U' : '✦';
  const bubbleContent = loading
    ? '<div class="dots"><span></span><span></span><span></span></div>'
    : parsedContent + sourcesHtml;
  const actions = loading
    ? ''
    : `<div class="msg-actions">
        <button class="msg-copy" onclick="copyMsg(this)">📋 Copy</button>
        ${role === 'ai' ? '<button class="msg-star" onclick="window.toggleFav(this)">⭐ Star</button>' : ''}
      </div>`;
  return `
    <div class="avatar ${role}">${avatar}</div>
    <div class="bubble-wrap">
      <div class="bubble ${role}">${bubbleContent}</div>
      ${actions}
    </div>`;
}

/**
 * Parses content with marked if available, otherwise escapes HTML.
 * @param {string} content
 * @param {'ai'|'user'} role
 * @returns {string}
 */
function parseContent(content, role) {
  return role === 'ai' && typeof window.marked !== 'undefined'
    ? window.marked.parse(content)
    : esc(content);
}

/**
 * Appends a message bubble directly with citations and confidence.
 * Used for restoring saved sessions.
 * @param {'ai'|'user'} role
 * @param {string} content
 * @param {string[]} [citations]
 * @param {string} [confidence]
 */
export function appendMsgDirect(role, content, citations, confidence) {
  const el = msgsEl();
  if (!el) return;
  const row = document.createElement('div');
  row.className = 'msg-row ' + role;

  const citedSources = role === 'ai' ? citationsToSources(citations) : [];
  const sourcesHtml = role === 'ai' ? buildSourceCardsHtml(citedSources, confidence) : '';
  const parsedContent = parseContent(content, role);

  row.innerHTML = buildMsgRowHtml(role, parsedContent, sourcesHtml);

  const cb = row.querySelector('.msg-copy');
  if (cb) cb.dataset.text = encodeURIComponent(content);
  const sb = row.querySelector('.msg-star');
  if (sb) sb.dataset.encoded = encodeURIComponent(content);

  el.appendChild(row);
  el.scrollTop = el.scrollHeight;
}

/**
 * Appends a user or AI message bubble (optionally showing loading dots).
 * @param {'ai'|'user'} role
 * @param {string} content
 * @param {boolean} [loading=false]
 * @returns {HTMLElement} Bubble element
 */
export function appendMsg(role, content, loading = false) {
  const welcome = document.getElementById('welcome');
  if (welcome) welcome.remove();
  const el = msgsEl();
  if (!el) return null;
  const row = document.createElement('div');
  row.className = 'msg-row ' + role;

  const parsedContent = loading ? '' : parseContent(content, role);
  row.innerHTML = buildMsgRowHtml(role, parsedContent, '', loading);

  if (!loading) {
    const btn = row.querySelector('.msg-copy');
    if (btn) btn.dataset.text = encodeURIComponent(content);
  }

  el.appendChild(row);
  el.scrollTop = el.scrollHeight;
  return row.querySelector('.bubble');
}

/**
 * Renders the entire chat history in a single DOM update.
 * Highly optimized to avoid multiple reflows.
 * @param {Array<Object>} msgs
 */
export function renderChatHistory(msgs) {
  const el = msgsEl();
  if (!el) return;

  const welcome = document.getElementById('welcome');
  if (welcome) welcome.remove();

  el.innerHTML = '';

  const fragment = document.createDocumentFragment();

  msgs.forEach(m => {
    const role = m.role === 'assistant' ? 'ai' : 'user';
    const row = document.createElement('div');
    row.className = 'msg-row ' + role;

    const citedSources = role === 'ai' ? citationsToSources(m.citations) : [];
    const sourcesHtml = role === 'ai' ? buildSourceCardsHtml(citedSources, m.confidence) : '';
    const parsedContent = parseContent(m.content, role);

    row.innerHTML = buildMsgRowHtml(role, parsedContent, sourcesHtml);

    const cb = row.querySelector('.msg-copy');
    if (cb) cb.dataset.text = encodeURIComponent(m.content);
    const sb = row.querySelector('.msg-star');
    if (sb) sb.dataset.encoded = encodeURIComponent(m.content);

    fragment.appendChild(row);
  });

  el.appendChild(fragment);
  el.scrollTop = el.scrollHeight;
}
