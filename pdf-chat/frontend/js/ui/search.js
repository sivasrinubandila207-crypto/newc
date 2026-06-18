/**
 * @module search
 * @description In-chat text search with highlight navigation.
 */
import { debounce } from '../utils/helpers.js';

let searchMatches = [];
let searchIdx = -1;

/** Clears all highlight marks from the chat. */
function clearSearchHighlights() {
  document.querySelectorAll('mark.sh').forEach(m => {
    const parent = m.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(m.textContent), m);
    parent.normalize();
  });
  searchMatches = [];
  searchIdx = -1;
}

/**
 * Highlights all occurrences of `q` in chat bubbles.
 * @param {string} q - Search query
 */
export function searchChat(q) {
  clearSearchHighlights();
  const countEl = document.getElementById('search-count');
  if (countEl) countEl.textContent = '';
  if (!q) return;

  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp('(' + escaped + ')', 'gi');

  document.querySelectorAll('.bubble').forEach(bubble => {
    const walker = document.createTreeWalker(bubble, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    let n;
    while ((n = walker.nextNode())) {
      const tag = n.parentElement?.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE') continue;
      if (n.textContent.toLowerCase().includes(q.toLowerCase())) textNodes.push(n);
    }
    textNodes.forEach(tn => {
      const parts = tn.textContent.split(regex);
      if (parts.length <= 1) return;
      const frag = document.createDocumentFragment();
      parts.forEach((part, i) => {
        if (i % 2 === 0) {
          frag.appendChild(document.createTextNode(part));
        } else {
          const mark = document.createElement('mark');
          mark.className = 'sh';
          mark.textContent = part;
          searchMatches.push(mark);
          frag.appendChild(mark);
        }
      });
      tn.parentNode.replaceChild(frag, tn);
    });
  });

  const total = searchMatches.length;
  if (!total) {
    if (countEl) countEl.textContent = 'No matches';
    return;
  }
  searchIdx = 0;
  searchMatches[0].classList.add('sh-active');
  searchMatches[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (countEl) countEl.textContent = `1 / ${total}`;
}

/** Debounced version of searchChat for input events. */
export const debouncedSearchChat = debounce(searchChat, 150);

/**
 * Navigates to the next or previous search match.
 * @param {1|-1} dir - Direction
 */
export function navigateSearch(dir) {
  if (!searchMatches.length) return;
  searchMatches[searchIdx]?.classList.remove('sh-active');
  searchIdx = (searchIdx + dir + searchMatches.length) % searchMatches.length;
  searchMatches[searchIdx].classList.add('sh-active');
  searchMatches[searchIdx].scrollIntoView({ behavior: 'smooth', block: 'center' });
  const countEl = document.getElementById('search-count');
  if (countEl) countEl.textContent = `${searchIdx + 1} / ${searchMatches.length}`;
}

/**
 * Opens or closes the search bar.
 */
export function toggleSearch() {
  const bar = document.getElementById('search-bar');
  const btn = document.getElementById('search-btn');
  const input = document.getElementById('search-input');
  if (!bar) return;
  const open = !bar.classList.contains('open');
  bar.classList.toggle('open', open);
  if (btn) btn.classList.toggle('active', open);
  if (open) {
    if (input) input.focus();
  } else {
    if (input) input.value = '';
    searchChat('');
  }
}
