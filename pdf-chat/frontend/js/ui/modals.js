/**
 * @module modals
 * @description All modal open/close handlers: shortcuts, page viewer,
 *              about, fav preview, and Gemini context inspector.
 *
 * Page viewer improvements:
 *  - Instant open: shows extracted text immediately, renders PDF canvas in background
 *  - Prev/Next navigation buttons + arrow key support
 *  - Pre-caches adjacent pages while current page is viewed
 *  - Canvas cache persists across modal opens (no re-render for visited pages)
 */
import { esc, renderThumb } from '../utils/helpers.js';
import { docs } from '../core/state.js';
import { debugState } from '../core/state.js';
import { showToast } from './notifications.js';
import { copyToClipboard } from '../utils/helpers.js';
import { closeAllDropdowns } from './controls.js';
import { docApi } from '../utils/storage.js';

// ── SHORTCUTS ──

export function openShortcuts() {
  closeAllDropdowns();
  document.getElementById('shortcuts-modal')?.classList.add('open');
}
export function closeShortcuts() {
  document.getElementById('shortcuts-modal')?.classList.remove('open');
}

// ── PAGE VIEWER ──────────────────────────────────────────────────────────────

/** Canvas cache: `${fingerprint}-${pageNum}` → canvas element */
const canvasCache = new Map();

/** Current viewer state — used by navigation and keyboard handler */
let _viewerState = {
  docName: null,
  pageNum: 1,
  totalPages: 1,
  pdfDoc: null,
};

/**
 * Renders a PDF page to a canvas at scale 1.5 and stores it in the cache.
 * Returns the canvas element (or null on failure).
 * @param {import('pdfjs-dist').PDFDocumentProxy} pdfDoc
 * @param {number} pageNum
 * @param {string} cacheKey
 * @returns {Promise<HTMLCanvasElement|null>}
 */
async function renderPageToCanvas(pdfDoc, pageNum, cacheKey) {
  if (canvasCache.has(cacheKey)) return canvasCache.get(cacheKey);
  try {
    const pg = await pdfDoc.getPage(pageNum);
    const vp = pg.getViewport({ scale: 1.5 });
    const c = document.createElement('canvas');
    c.width = vp.width;
    c.height = vp.height;
    await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    canvasCache.set(cacheKey, c);
    return c;
  } catch {
    return null;
  }
}

/**
 * Pre-caches adjacent pages in the background so navigating is instant.
 * @param {import('pdfjs-dist').PDFDocumentProxy} pdfDoc
 * @param {number} currentPage
 * @param {string} fingerprint
 */
function preCacheAdjacentPages(pdfDoc, currentPage, fingerprint) {
  const total = pdfDoc.numPages;
  [currentPage - 1, currentPage + 1].forEach(p => {
    if (p >= 1 && p <= total) {
      const key = `${fingerprint}-${p}`;
      if (!canvasCache.has(key)) {
        // Fire-and-forget background pre-cache
        renderPageToCanvas(pdfDoc, p, key);
      }
    }
  });
}

/**
 * Updates the navigation button visibility and title label.
 */
function _updateNavButtons() {
  const prevBtn = document.getElementById('page-modal-prev');
  const nextBtn = document.getElementById('page-modal-next');
  const titleEl = document.getElementById('page-modal-title');
  if (prevBtn) prevBtn.disabled = _viewerState.pageNum <= 1;
  if (nextBtn) nextBtn.disabled = _viewerState.pageNum >= _viewerState.totalPages;
  if (titleEl) {
    titleEl.textContent = _viewerState.totalPages > 1
      ? `${_viewerState.docName} — Page ${_viewerState.pageNum} / ${_viewerState.totalPages}`
      : `${_viewerState.docName} — Page ${_viewerState.pageNum}`;
  }
}

/**
 * Renders a page into the modal wrap. Shows skeleton loading UI, swaps canvas when ready.
 * @param {number} pageNum
 * @param {string|null} textFallback
 */
async function _renderPage(pageNum, textFallback) {
  const wrap = document.getElementById('page-canvas-wrap');
  if (!wrap) return;

  const pdfDoc = _viewerState.pdfDoc;
  const fingerprint = pdfDoc
    ? (pdfDoc.fingerprints?.[0] || pdfDoc.fingerprint || pdfDoc.loadingTask?.docId || '')
    : '';
  const cacheKey = pdfDoc ? `${fingerprint}-${pageNum}` : null;

  // ── CACHE HIT: instant canvas swap ──
  if (cacheKey && canvasCache.has(cacheKey)) {
    wrap.innerHTML = '';
    wrap.appendChild(canvasCache.get(cacheKey));
    preCacheAdjacentPages(pdfDoc, pageNum, fingerprint);
    return;
  }

  // ── LOADER TEMPLATE ──
  const getLoaderHtml = (statusText) => `
    <div class="page-loader-container">
      <div class="page-loading-spinner"></div>
      <div class="page-loading-status">${esc(statusText)}</div>
    </div>
  `;

  // ── INITIAL LOADING STATE ──
  if (!pdfDoc) {
    wrap.innerHTML = getLoaderHtml('Loading PDF document…');
    return;
  }

  wrap.innerHTML = getLoaderHtml(`Rendering page ${pageNum}…`);

  // ── BACKGROUND RENDER: swap canvas when done ──
  const canvas = await renderPageToCanvas(pdfDoc, pageNum, cacheKey);
  if (canvas) {
    // Only update if the user hasn't navigated away while we were rendering
    if (_viewerState.pageNum === pageNum) {
      wrap.innerHTML = '';
      wrap.appendChild(canvas);
    }
    preCacheAdjacentPages(pdfDoc, pageNum, fingerprint);
  } else if (textFallback) {
    // Display text fallback ONLY if PDF canvas rendering fails
    wrap.innerHTML = `
      <div style="font-size:11px;color:var(--danger);padding:8px 12px;background:rgba(248,113,113,0.08);border-radius:6px;margin-bottom:8px;text-align:center;border:1px solid rgba(248,113,113,0.15);width:100%">
        ⚠️ Failed to render PDF page. Showing extracted text fallback.
      </div>
      <div class="page-text-preview" style="width:100%">${esc(textFallback)}</div>
    `;
  } else {
    wrap.innerHTML = `<div style="color:var(--danger);padding:20px;text-align:center;width:100%">Error rendering page ${pageNum}.</div>`;
  }
}

/**
 * Opens the page viewer modal and renders a PDF page.
 * Shows extracted text immediately, then swaps to canvas render.
 *
 * @param {string} title - Document name (without page info)
 * @param {import('pdfjs-dist').PDFDocumentProxy|null} pdfDoc
 * @param {number} pageNum
 * @param {string|null} textFallback
 * @param {number} [totalPages=1]
 */
export function openPageModal(title, pdfDoc, pageNum, textFallback, totalPages = 1) {
  const modal = document.getElementById('page-modal');
  if (!modal) return;

  _viewerState.docName = title;
  _viewerState.pageNum = pageNum;
  _viewerState.totalPages = totalPages;
  _viewerState.pdfDoc = pdfDoc;

  modal.classList.add('open');
  _updateNavButtons();
  _renderPage(pageNum, textFallback);
}

export function closePageModal() {
  document.getElementById('page-modal')?.classList.remove('open');
}

/**
 * Navigate the page viewer by delta pages (+1 = next, -1 = prev).
 * @param {number} delta
 */
export function navigatePageModal(delta) {
  const { docName, pageNum, totalPages } = _viewerState;
  const newPage = Math.max(1, Math.min(totalPages, pageNum + delta));
  if (newPage === pageNum) return;

  _viewerState.pageNum = newPage;
  _updateNavButtons();

  const doc = docs.find(d => d.name === docName);
  const textFallback = doc?.pages?.[newPage - 1] || null;
  _renderPage(newPage, textFallback);
}

// ── KEYBOARD NAV: arrow keys when page modal is open ──────────────────────────
document.addEventListener('keydown', e => {
  const modal = document.getElementById('page-modal');
  if (!modal?.classList.contains('open')) return;
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); navigatePageModal(1); }
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); navigatePageModal(-1); }
  else if (e.key === 'Escape') closePageModal();
});

/**
 * Ensures the PDF document proxy (pdfDoc) is parsed and loaded in memory.
 * If it is already loaded, returns immediately.
 * If a load is already in progress, returns the existing promise.
 * Otherwise, starts fetching/parsing in the background.
 * @param {Object} doc - The document object
 * @returns {Promise<import('pdfjs-dist').PDFDocumentProxy>}
 */
export function ensurePdfDocLoaded(doc) {
  if (doc.pdfDoc) return Promise.resolve(doc.pdfDoc);
  if (doc._loadingPromise) return doc._loadingPromise;

  doc._loadingPromise = (async () => {
    try {
      // 1. If we don't have base64, fetch it from cloud
      if (!doc._fileBase64 && doc._id) {
        const data = await docApi.getFile(String(doc._id));
        doc._fileBase64 = data.fileBase64;
      }
      // 2. If we have base64, parse it
      if (doc._fileBase64 && window.pdfjsLib) {
        const binaryStr = atob(doc._fileBase64);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
        doc.pdfDoc = await window.pdfjsLib.getDocument({ data: bytes }).promise;

        // Render sidebar thumbnail once ready
        const idx = docs.indexOf(doc);
        if (idx >= 0) {
          const thumbEl = document.getElementById(`thumb-${idx}`);
          if (thumbEl) {
            thumbEl.className = 'doc-thumb';
            renderThumb(doc.pdfDoc, thumbEl);
          }
        }
      }
      return doc.pdfDoc;
    } catch (err) {
      console.warn(`[Lazy PDF] Failed to load "${doc.name}":`, err.message);
      throw err;
    } finally {
      // Clean up the promise if loading failed so it can be retried
      if (!doc.pdfDoc) {
        delete doc._loadingPromise;
      }
    }
  })();

  return doc._loadingPromise;
}

/**
 * Opens the page viewer for a named document and page.
 * Loads the PDF document data lazily from cloud storage if needed.
 * @param {string} docName
 * @param {number} pageNum
 */
export async function viewPage(docName, pageNum) {
  const doc = docs.find(d => d.name === docName);
  if (!doc) return;
  const textFallback = (doc.pages?.[pageNum - 1]) || null;
  const totalPages = doc.pages?.length || 1;

  // ── INSTANT OPEN: show skeleton right away while we wait for PDF ──
  openPageModal(docName, doc.pdfDoc, pageNum, textFallback, totalPages);

  // Await background preload if already running, or fetch on demand
  try {
    await ensurePdfDocLoaded(doc);
  } catch (err) {
    showToast(`⚠ Cloud load failed: ${err.message}`);
  }

  // Re-render with pdfDoc now available (if it was just loaded)
  if (doc.pdfDoc && _viewerState.pageNum === pageNum) {
    _viewerState.pdfDoc = doc.pdfDoc;
    _viewerState.totalPages = doc.pdfDoc.numPages;
    _updateNavButtons();
    _renderPage(pageNum, textFallback);
  }
}

// ── ABOUT ──

export function openAboutModal() {
  closeAllDropdowns();
  document.getElementById('about-modal')?.classList.add('open');
}
export function closeAboutModal() {
  document.getElementById('about-modal')?.classList.remove('open');
}

// ── FAV PREVIEW ──

let currentFavIdx = -1;

/**
 * Opens the fav preview modal for a given favourite index.
 * @param {number} i
 */
export function openFavModal(i) {
  const favs = window._getFavs ? window._getFavs() : [];
  if (!favs[i]) return;
  currentFavIdx = i;
  const f = favs[i];
  const dateEl = document.getElementById('fav-modal-date');
  const bodyEl = document.getElementById('fav-modal-body');
  const modal = document.getElementById('fav-modal');
  if (dateEl) dateEl.textContent = f.date;
  if (bodyEl) bodyEl.innerHTML = marked.parse(f.content);
  if (modal) modal.classList.add('open');
}

export function closeFavModal() {
  document.getElementById('fav-modal')?.classList.remove('open');
  currentFavIdx = -1;
}

export function copyFavModal() {
  if (currentFavIdx < 0) return;
  const favs = window._getFavs ? window._getFavs() : [];
  const text = favs[currentFavIdx]?.content || '';
  copyToClipboard(text, () => showToast('📋 Copied!'));
}

// ── GEMINI CONTEXT INSPECTOR ──

export function showGeminiContext() {
  const modal = document.getElementById('context-modal');
  const metadataEl = document.getElementById('context-modal-metadata');
  const bodyEl = document.getElementById('context-modal-body');
  if (!modal) return;

  if (!debugState.lastSentContext) {
    if (metadataEl) metadataEl.innerHTML = '<span>No prompt context has been sent yet. Send a chat message first.</span>';
    if (bodyEl) bodyEl.textContent = 'Prompt context is generated dynamically when you submit a message.';
    modal.classList.add('open');
    return;
  }

  const c = debugState.lastSentContext;
  if (metadataEl) {
    metadataEl.innerHTML = `
      <span><strong>Mode:</strong> ${c.retrievalMode === 'FULL CONTEXT' ? 'Full Context' : 'RAG'}</span>
      <span><strong>Chars:</strong> ${(c.contextCharCount || 0).toLocaleString()}</span>
      <span><strong>Words:</strong> ${(c.contextWordCount || 0).toLocaleString()}</span>
      <span><strong>Chunks:</strong> ${c.chunksSent || 0}</span>
      <span><strong>Bypass:</strong> ${c.fullContextBypass ? '✅ Yes' : '❌ No'}</span>
    `;
  }

  let output = `=== SYSTEM PROMPT ===\n${c.system || ''}\n\n=== MESSAGES SENT ===\n`;
  (c.messages || []).forEach(m => {
    output += `[${m.role.toUpperCase()}]: ${m.content}\n\n`;
  });
  if (bodyEl) bodyEl.textContent = output;
  modal.classList.add('open');
}

export function closeContextModal() {
  document.getElementById('context-modal')?.classList.remove('open');
}

export function copyContextModal() {
  const bodyEl = document.getElementById('context-modal-body');
  if (!bodyEl) return;
  copyToClipboard(bodyEl.textContent, () => showToast('📋 Prompt context copied!'));
}
